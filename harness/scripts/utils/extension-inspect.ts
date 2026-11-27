import * as fs from 'fs';
import * as path from 'path';

import { extensionSkillIdsForBridge, loadInstanceExtensions, readExtensionTimings, type ExtensionTiming } from '../../extension-loader';
import { loadFrameworkConfigWithSources } from '../../config';
import {
  loadReservedBridgeIds,
  inspectInstanceSkillBridgeArtifacts,
  parseInstanceSkillBridgeFromAdapter,
  resolveBridgeTargets,
  resolveSkillStubTargetDir,
  scanExtensionSkills,
} from './instance-skill-bridge';
import { inspectExtensionProduce } from './extension-runtime';
import { extensionKnowledgeRoutes } from './knowledge-context';
import { extensionActivationDrift, type ExtensionActivationDrift } from './extension-activation';
import type { ExtensionActivationResult } from './extension-activation-contract';
import { extensionRequestsUsingAbility } from './extension-requests';
import type { ExtensionPendingCleanup, ExtensionValidationError } from './types';

export type ExtensionStrength = 'available' | 'scheduled' | 'evidenced';

export interface ExtensionInspectRow {
  type: string;
  source: string;
  timing: string;
  consumer: string;
  state: ExtensionStrength;
  status: string;
  ability?: string;
  bindingId?: string;
  at?: string;
  phase?: string;
  packageSource?: string;
}

export interface ExtensionReconciliationFinding {
  code: string;
  message: string;
  path?: string;
  ability?: string;
}

interface InspectedInstallation {
  ability: string;
  source?: string;
  version?: string;
  state: 'installed' | 'enabled' | 'failed' | 'pending_cleanup';
  bindingOverrides?: Record<string, unknown>;
  activation?: ExtensionActivationResult;
  pendingCleanup?: ExtensionPendingCleanup & ReturnType<typeof extensionRequestsUsingAbility>;
  drift?: ExtensionActivationDrift[];
}

export interface ExtensionInspection {
  schemaVersion: '1.0';
  extensionRoot: string | null;
  manifest: string | null;
  targetFramework: string;
  timings: Array<ExtensionTiming & { phaseRequired: boolean }>;
  timingCatalogError?: string;
  installations: InspectedInstallation[];
  rows: ExtensionInspectRow[];
  findings: ExtensionReconciliationFinding[];
  manifestErrors: ExtensionValidationError[];
}

export interface ExtensionInspectOptions {
  toolVisibility?: Record<string, boolean>;
  ability?: string;
}

function rel(root: string, target: string): string {
  return path.relative(root, target).replace(/\\/g, '/');
}

function projectAdapters(projectRoot: string): string[] {
  const raw = loadFrameworkConfigWithSources(projectRoot).projectRaw;
  if (!Array.isArray(raw?.materialized_adapters)) return [];
  return [...new Set(raw.materialized_adapters
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim()))];
}

function bridgePaths(projectRoot: string, frameworkDir: string, adapter: string, bridgeId: string): string[] {
  const adapterPath = path.join(frameworkDir, 'agents', adapter, 'adapter.yaml');
  if (!fs.existsSync(adapterPath)) return [];
  const config = parseInstanceSkillBridgeFromAdapter(fs.readFileSync(adapterPath, 'utf8'));
  const out: string[] = [];
  const stubDir = resolveSkillStubTargetDir(projectRoot, frameworkDir, adapter);
  if (stubDir) out.push(path.join(projectRoot, ...stubDir.replace(/\\/g, '/').split('/'), bridgeId, 'SKILL.md'));
  if (config?.commands_target_dir) {
    out.push(path.join(projectRoot, ...config.commands_target_dir.replace(/\\/g, '/').split('/'), `${bridgeId}.md`));
  }
  return out;
}

export function inspectInstanceExtensions(
  projectRoot: string,
  frameworkDir: string,
  options: ExtensionInspectOptions = {},
): ExtensionInspection {
  const sources = loadFrameworkConfigWithSources(projectRoot);
  const extensionDir = sources.config.paths?.extension_dir ?? 'doc/extensions';
  const bundle = loadInstanceExtensions(projectRoot, extensionDir, { frameworkRoot: frameworkDir });
  const rows: ExtensionInspectRow[] = [];
  const findings: ExtensionReconciliationFinding[] = [];
  const timingCatalog = { targetFramework: frameworkDir, timings: [] as ExtensionInspection['timings'], timingCatalogError: undefined as string | undefined };
  if (!options.ability) {
    try {
      timingCatalog.timings = [...readExtensionTimings(frameworkDir).values()]
        .map(timing => ({ ...timing, phaseRequired: timing.scope !== 'project' }));
    } catch (error) {
      timingCatalog.timingCatalogError = (error as Error).message;
    }
  }
  const installations: InspectedInstallation[] = [];
  for (const [ability, installation] of Object.entries(bundle.installations)) {
    if (options.ability && options.ability !== ability) continue;
    const { source, version, pending_cleanup: pending, activation_result: activation } = installation;
    const pendingCleanup = pending && source
      ? { ...pending, ...extensionRequestsUsingAbility(projectRoot, ability, source, pending.binding) }
      : undefined;
    const drift = activation?.status === 'enabled' && bundle.rootDir ? extensionActivationDrift(bundle.rootDir, activation) : [];
    const state = pendingCleanup ? 'pending_cleanup' : activation?.status === 'failed' ? 'failed'
      : installation.enabled && (!bundle.activations[ability] || activation?.status === 'enabled') ? 'enabled' : 'installed';
    installations.push({ ability, source, version, state, bindingOverrides: installation.binding_overrides, activation, pendingCleanup,
      ...(drift.length ? { drift } : {}) });
    for (const item of drift) {
      const affected = bundle.bindings.filter(binding => binding.ability === ability && binding.selected).map(binding => binding.id);
      findings.push({ code: 'extension_activation_drift', ability,
        path: bundle.rootDir ? path.posix.join(rel(projectRoot, bundle.rootDir), item.path) : item.path,
        message: `${ability} 启用效果漂移：${item.kind}${item.reason ? `（${item.reason}）` : ''}。${affected.length ? `所选绑定：${affected.join(', ')}。` : ''}运行 extension enable ${ability} 修复。` });
    }
  }
  const scanned = bundle.manifestUsable ? scanExtensionSkills(projectRoot, extensionDir) : [];
  const declared = new Set(bundle.declaredSkills);
  const scannedIds = new Set(scanned.map(row => row.sourceSlug));
  const selectedIds = extensionSkillIdsForBridge(bundle);
  const selected = selectedIds ? new Set(selectedIds) : null;
  const materializedRows = selected ? scanned.filter(row => selected.has(row.sourceSlug)) : scanned;
  const materializedTargets = resolveBridgeTargets(materializedRows, loadReservedBridgeIds(frameworkDir)).targets;

  for (const skill of scanned) {
    const listed = declared.has(skill.sourceSlug);
    rows.push({
      type: 'skill', source: skill.skillMdRepoRel, timing: `/${skill.sourceSlug} 或 AGENTS.md 路由`,
      consumer: '当前 agent adapter', state: 'available', ability: skill.sourceSlug,
      status: selected && !selected.has(skill.sourceSlug)
        ? listed ? '未启用：能力已停用' : '未启用：目录未声明'
        : listed ? 'declared' : 'directory-only',
    });
    if (!listed && bundle.manifestPath) findings.push({
      code: 'extension_skill_unlisted', message: `目录 skill 未在 manifest provides.skills 声明：${skill.sourceSlug}`,
      path: skill.skillMdRepoRel, ability: skill.sourceSlug,
    });
  }
  for (const id of declared) {
    if (!scannedIds.has(id)) findings.push({
      code: 'extension_skill_declared_missing', message: `manifest skill 缺少 skills/${id}/SKILL.md`,
      path: bundle.manifestPath ? rel(projectRoot, bundle.manifestPath) : undefined, ability: id,
    });
  }

  for (const { entry: knowledge, path: source, routed, audience } of extensionKnowledgeRoutes(bundle, projectRoot)) {
    rows.push({
      type: 'knowledge', source,
      timing: routed
        ? knowledge.audience === 'global' ? 'AGENTS.md / CLAUDE.md 渲染时' : `Feature phases: ${audience.join(', ')}`
        : '仅保留目录索引',
      consumer: routed ? knowledge.audience === 'global' ? '全局 agent 指令' : '对应 phase 作者 / prepare / verifier；AGENTS 静态路由' : '无自动消费者',
      state: routed ? 'scheduled' : 'available', status: routed ? 'routed' : 'declared-unconsumed',
      ability: bundle.manifestName ?? undefined,
    });
  }
  for (const [id, capability] of Object.entries(bundle.extensionCapabilities)) rows.push({
    type: 'capability', source: capability.provider ? rel(projectRoot, capability.provider) : id,
    timing: 'capability resolution', consumer: 'harness capability registry', state: 'scheduled', status: id,
  });
  for (const [skillId, assets] of Object.entries(bundle.skillAssetAbsPaths)) {
    for (const [assetKey, file] of Object.entries(assets)) rows.push({
      type: 'skill_asset', source: rel(projectRoot, file), timing: `/${skillId} 执行时`,
      consumer: skillId === 'component-design' && assetKey === 'knowledge'
        ? 'assembleKnowledge → component-design/SKILL.md · P1 discovery 前读取' : `/${skillId} 的已声明 asset 消费者`,
      state: skillId === 'component-design' && assetKey !== 'knowledge' ? 'available' : 'scheduled', status: assetKey,
    });
  }
  for (const [phase, file] of Object.entries(bundle.phaseRuleOverlayPaths)) rows.push({
    type: 'phase_rules_overlay', source: rel(projectRoot, file), timing: `${phase} 规则合并`,
    consumer: `harness ${phase} checker`, state: 'scheduled', status: 'declared',
  });
  const scheduledActions = new Set<string>();
  for (const binding of bundle.bindings) {
    const action = binding.resource === 'mcp' ? bundle.mcpActions[binding.ref] : undefined;
    const missingTool = !!action && options.toolVisibility?.[action.id] === false;
    const scheduled = binding.enabled && !missingTool;
    if (action && scheduled) scheduledActions.add(action.id);
    const identity = `${binding.source} · ${binding.ability}/${binding.id}`;
    const resource = binding.absPath ? rel(projectRoot, binding.absPath) : binding.ref;
    const where = [binding.phase, binding.at, binding.timingDescription].filter(Boolean).join(' · ');
    rows.push({
      type: binding.legacy === 'hook' ? 'hook' : binding.legacy === 'phase' ? 'phase_binding' : 'binding',
      source: [identity, resource].filter(Boolean).join(' · '), timing: where || '时点未声明',
      consumer: binding.consumer ?? '无已识别消费者', state: scheduled ? 'scheduled' : 'available',
      status: scheduled ? 'declared' : `未启用：${binding.reason ?? `工具 ${action?.tool} 当前不可见（agent 自报）`}`,
      ability: binding.ability, bindingId: binding.id, at: binding.at, phase: binding.phase, packageSource: binding.source,
    });
  }
  for (const action of Object.values(bundle.mcpActions)) {
    const existing = action.produceAbsPaths.filter(target => fs.existsSync(target) && fs.statSync(target).isFile());
    const validations = existing.map(target => inspectExtensionProduce(projectRoot, target));
    const seam = validations.find(item => item.seam && item.issues.length === 0)?.seam ?? null;
    const visibility = options.toolVisibility?.[action.id];
    rows.push({
      type: 'mcp_action', source: action.produces.join(', '),
      timing: scheduledActions.has(action.id) ? 'phase binding 槽位' : 'extension skill 自身流程',
      consumer: seam === 'requirement-source-materialization'
        ? '/component-design · requirement-source-materialization seam'
        : seam === 'blueprint-review-feedback'
          ? '/component-design reconciliation · blueprint-review-feedback seam'
          : 'manifest 声明的下游',
      state: existing.length === action.produceAbsPaths.length && validations.every(item => item.issues.length === 0)
        ? 'evidenced' : scheduledActions.has(action.id) ? 'scheduled' : 'available',
      ability: action.id,
      status: `produces=${existing.length}/${action.produceAbsPaths.length}; invalid=${validations.reduce((sum, item) => sum + item.issues.length, 0)}; tool_visibility=${visibility === undefined ? 'not-reported' : visibility ? 'visible' : 'missing'}; source=agent_self_report; evidence_scope=filesystem_only`,
    });
  }

  for (const adapter of projectAdapters(projectRoot)) {
    for (const target of materializedTargets) {
      const paths = bridgePaths(projectRoot, frameworkDir, adapter, target.bridgeId);
      if (paths.length === 0) findings.push({
        code: 'extension_bridge_adapter_unsupported', message: `adapter 未声明 extension bridge：${adapter}`, ability: target.sourceSlug,
      });
    }
    for (const artifact of inspectInstanceSkillBridgeArtifacts({
      repoRoot: projectRoot, frameworkDir, agentAdapter: adapter, extensionDirRel: extensionDir,
      declaredSkillIds: selectedIds,
    })) {
      rows.push({
        type: 'bridge', source: artifact.path, timing: `adapter=${adapter} 物化`, consumer: `/${artifact.bridgeId}`,
        state: 'available', status: artifact.state, ability: path.posix.basename(path.posix.dirname(artifact.sourceRel)),
      });
      if (artifact.state !== 'present') findings.push({
        code: `extension_bridge_${artifact.state}`,
        message: `扩展 Skill 桥接 ${artifact.state}：${artifact.path}`,
        path: artifact.path, ability: path.posix.basename(path.posix.dirname(artifact.sourceRel)),
      });
    }
  }

  return {
    schemaVersion: '1.0', extensionRoot: bundle.rootDir ? rel(projectRoot, bundle.rootDir) : null,
    manifest: bundle.manifestPath ? rel(projectRoot, bundle.manifestPath) : null,
    ...timingCatalog, installations,
    rows: options.ability ? rows.filter(row => row.ability === options.ability) : rows,
    findings: options.ability ? findings.filter(item => item.ability === options.ability) : findings,
    manifestErrors: bundle.errors.filter(error => !options.ability || !error.ability || error.ability === options.ability)
      .map(error => ({ ...error, path: error.path ? rel(projectRoot, error.path) : undefined })),
  };
}

export function formatExtensionInspection(inspection: ExtensionInspection): string {
  const lines = [
    `extension_root: ${inspection.extensionRoot ?? '(absent)'}`,
    `manifest: ${inspection.manifest ?? '(absent)'}`,
  ];
  if (inspection.timingCatalogError || inspection.timings.length) {
    lines.push('', `目标发布件 ${inspection.targetFramework}`);
    if (inspection.timingCatalogError) lines.push(`时点清单不可用：${inspection.timingCatalogError}`);
    else lines.push('| 支持时点 | 触发时刻 | 适用范围及阶段 | 消费者 | 允许资源 |', '|---|---|---|---|---|',
      ...inspection.timings.map(timing => `| ${timing.id} | ${timing.description} | ${timing.scope} · ${timing.phaseRequired ? '需要 phase' : '省略 phase'} | ${timing.consumer ?? Object.entries(timing.consumers ?? {}).map(([resource, consumer]) => `${resource}：${consumer}`).join('；')} | ${timing.resources.join(', ')} |`));
  }
  if (inspection.installations.length) {
    lines.push('', '安装状态');
    const states = { installed: '已安装未启用', enabled: '已启用', failed: '启用失败', pending_cleanup: '已停止目标的新调度，待清理' };
    for (const item of inspection.installations) {
      lines.push(`- ${item.ability}${item.version ? ` ${item.version}` : ''}：${states[item.state]}`);
      if (item.activation?.status === 'running') lines.push(`  - 启用步骤尚未完成。恢复时运行 extension enable ${item.ability}。`);
      if (item.activation?.failure) lines.push(`  - 失败：${item.activation.failure}`);
      for (const step of item.activation?.steps ?? []) {
        lines.push(`  - ${step.id} · ${step.status}${step.outputs.length ? ` · 产物 ${step.outputs.map(out => out.path).join(', ')}` : ''}${step.failure ? ` · ${step.failure}` : ''}`);
      }
      for (const residual of item.activation?.residuals ?? []) {
        lines.push(`  - 残留 ${residual.path} · ${residual.how} · preSha256=${residual.preSha256 ?? '—'}`);
      }
      if (item.pendingCleanup) {
        const pending = item.pendingCleanup;
        lines.push(`  - ${pending.operation} ${pending.binding ?? '整项'}：${pending.requestIds.length
          ? `资源仍被请求 ${pending.requestIds.join(', ')} 占用，待清理` : '占用已解除，待清理'}。`);
        lines.push(`  - 重试原操作：extension ${pending.command.map(arg => JSON.stringify(arg)).join(' ')}`);
        for (const request of pending.inactiveRequests) lines.push(`  - ${request.requestId}：${request.reason}（${request.requestFile}）`);
      }
    }
  }
  lines.push('',
    '| 类型 | 来源 | 生效时机 | 消费者 | 强度 | 状态 |',
    '|---|---|---|---|---|---|',
    ...inspection.rows.map(row =>
      `| ${row.type} | ${row.source} | ${row.timing} | ${row.consumer} | ${row.state} | ${row.status} |`),
  );
  if (inspection.rows.length === 0) lines.push('| — | — | — | — | — | empty |');
  if (inspection.manifestErrors.length || inspection.findings.length) {
    lines.push('', '对账：');
    for (const item of [...inspection.manifestErrors, ...inspection.findings]) {
      lines.push(`- ${item.code}: ${item.message}${item.path ? ` (${item.path})` : ''}`);
    }
  }
  return lines.join('\n');
}
