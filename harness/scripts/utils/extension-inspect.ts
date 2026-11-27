import * as fs from 'fs';
import * as path from 'path';

import { loadInstanceExtensions, readExtensionTimings, type ExtensionTiming } from '../../extension-loader';
import { loadFrameworkConfigWithSources } from '../../config';
import {
  loadReservedBridgeIds,
  inspectInstanceSkillBridgeArtifacts,
  parseInstanceSkillBridgeFromAdapter,
  resolveBridgeTargets,
  resolveSkillStubTargetDir,
  extensionSkillRows,
} from './instance-skill-bridge';
import { inspectExtensionProduce } from './extension-runtime';
import { inspectExtensionActivation, type ExtensionActivationResult } from './extension-activation';
import { extensionActivationContext, pendingExtensionUpgrades } from './extension-lifecycle';
import { extensionRequestsUsingAbility } from './extension-requests';
import type { ExtensionValidationError } from './types';

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
  pendingCleanup?: ReturnType<typeof extensionRequestsUsingAbility>;
  pendingUpgrade?: string;
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
  const upgrades = pendingExtensionUpgrades(bundle);
  const effective = upgrades.size
    ? loadInstanceExtensions(projectRoot, extensionDir, { frameworkRoot: frameworkDir, excludedPlugins: upgrades })
    : bundle;
  for (const [ability, installation] of Object.entries(bundle.plugins)) {
    if (options.ability && options.ability !== ability) continue;
    const { source, version, enabled } = installation;
    const steps = bundle.activations[ability] ?? [];
    const use = !enabled ? extensionRequestsUsingAbility(projectRoot, ability, source) : undefined;
    const pendingCleanup = use?.requestIds.length ? use : undefined;
    const pendingUpgrade = upgrades.get(ability);
    const activation = enabled && !pendingUpgrade && steps.length
      ? inspectExtensionActivation(extensionActivationContext(projectRoot, installation), steps) : undefined;
    const state = pendingCleanup || pendingUpgrade ? 'pending_cleanup' : activation?.failure ? 'failed' : enabled ? 'enabled' : 'installed';
    installations.push({ ability, source, version, state, bindingOverrides: installation.binding_overrides,
      activation, pendingCleanup, pendingUpgrade });
    for (const step of activation?.steps ?? []) {
      if (!step.failure) continue;
      findings.push({ code: 'extension_activation_readiness', ability,
        path: rel(projectRoot, installation.manifestPath), message: step.failure });
    }
    for (const skill of installation.skills) rows.push({
      type: 'skill', source: rel(projectRoot, skill.absPath), timing: `/${skill.skillId} 或 AGENTS.md 路由`,
      consumer: '当前 agent adapter', state: 'available', ability,
      status: pendingUpgrade ?? (enabled ? 'declared' : '未启用：插件已停用'),
    });
  }
  const materializedTargets = resolveBridgeTargets(extensionSkillRows(projectRoot, effective.manualSkills),
    loadReservedBridgeIds(frameworkDir)).targets;
  for (const [id, capability] of Object.entries(effective.extensionCapabilities)) rows.push({
    type: 'capability', source: capability.provider ? rel(projectRoot, capability.provider) : id,
    timing: 'capability resolution', consumer: 'harness capability registry', state: 'scheduled', status: id,
  });
  for (const [skillId, assets] of Object.entries(effective.skillAssetAbsPaths)) {
    for (const [assetKey, file] of Object.entries(assets)) rows.push({
      type: 'skill_asset', source: rel(projectRoot, file), timing: `/${skillId} 执行时`,
      consumer: skillId === 'component-design' && assetKey === 'knowledge'
        ? 'assembleKnowledge → component-design/SKILL.md · P1 discovery 前读取' : `/${skillId} 的已声明 asset 消费者`,
      state: skillId === 'component-design' && assetKey !== 'knowledge' ? 'available' : 'scheduled', status: assetKey,
    });
  }
  for (const [phase, file] of Object.entries(effective.phaseRuleOverlayPaths)) rows.push({
    type: 'phase_rules_overlay', source: rel(projectRoot, file), timing: `${phase} 规则合并`,
    consumer: `harness ${phase} checker`, state: 'scheduled', status: 'declared',
  });
  const scheduledActions = new Set<string>();
  for (const binding of effective.bindings) {
    const action = binding.action;
    const missingTool = !!action && options.toolVisibility?.[action.id] === false;
    const readiness = installations.find(item => item.ability === binding.ability)?.activation?.failure;
    const scheduled = binding.enabled && !missingTool && !readiness;
    if (action && scheduled) scheduledActions.add(action.id);
    const identity = `${binding.source} · ${binding.ability}/${binding.id}`;
    const resource = binding.absPath ? rel(projectRoot, binding.absPath) : binding.ref;
    const where = [binding.phase, binding.at, binding.timingDescription].filter(Boolean).join(' · ');
    rows.push({
      type: binding.kind === 'knowledge' ? 'knowledge' : binding.resource?.startsWith('hook_') ? 'hook' : 'binding',
      source: [identity, resource].filter(Boolean).join(' · '), timing: where || '时点未声明',
      consumer: binding.consumer ?? '无已识别消费者', state: scheduled ? 'scheduled' : 'available',
      status: scheduled ? 'declared' : `未启用：${readiness ?? binding.reason ?? `工具 ${action?.tool} 当前不可见（agent 自报）`}`,
      ability: binding.ability, bindingId: binding.id, at: binding.at, phase: binding.phase, packageSource: binding.source,
    });
  }
  for (const [plugin, action] of Object.values(effective.plugins).flatMap(plugin => Object.values(plugin.mcpActions).map(action => [plugin.id, action] as const))) {
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
      ability: plugin,
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
      repoRoot: projectRoot, frameworkDir, agentAdapter: adapter,
      skills: effective.manualSkills,
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
      if (item.activation?.failure) lines.push(`  - 失败：${item.activation.failure}`);
      for (const step of item.activation?.steps ?? []) {
        lines.push(`  - ${step.id} · ${step.status}${step.outputs.length ? ` · 产物 ${step.outputs.join(', ')}` : ''}${step.failure ? ` · ${step.failure}` : ''}`);
      }
      for (const residual of item.activation?.residuals ?? []) {
        lines.push(`  - 残留 ${residual.path} · ${residual.how} · preSha256=${residual.preSha256 ?? '—'}`);
      }
      if (item.pendingUpgrade) lines.push(`  - ${item.pendingUpgrade}`);
      if (item.pendingCleanup) {
        const pending = item.pendingCleanup;
        lines.push(`  - 资源仍被请求 ${pending.requestIds.join(', ')} 占用，交回后重试原操作。`);
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
