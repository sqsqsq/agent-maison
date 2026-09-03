import * as fs from 'fs';
import * as path from 'path';

import { extensionSkillIdsForBridge, loadInstanceExtensions } from '../../extension-loader';
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

export type ExtensionStrength = 'available' | 'scheduled' | 'evidenced';

export interface ExtensionInspectRow {
  type: string;
  source: string;
  timing: string;
  consumer: string;
  state: ExtensionStrength;
  status: string;
}

export interface ExtensionReconciliationFinding {
  code: string;
  message: string;
  path?: string;
}

export interface ExtensionInspection {
  schemaVersion: '1.0';
  extensionRoot: string | null;
  manifest: string | null;
  rows: ExtensionInspectRow[];
  findings: ExtensionReconciliationFinding[];
  manifestErrors: Array<{ code: string; message: string; path?: string }>;
}

export interface ExtensionInspectOptions {
  toolVisibility?: Record<string, boolean>;
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
  const scanned = scanExtensionSkills(projectRoot, extensionDir);
  const declared = new Set(bundle.skills);
  const scannedIds = new Set(scanned.map(row => row.sourceSlug));
  const selectedIds = extensionSkillIdsForBridge(bundle);
  const selected = selectedIds ? new Set(selectedIds) : null;
  const materializedRows = selected ? scanned.filter(row => selected.has(row.sourceSlug)) : scanned;
  const materializedTargets = resolveBridgeTargets(materializedRows, loadReservedBridgeIds(frameworkDir)).targets;

  for (const skill of scanned) {
    const listed = declared.has(skill.sourceSlug);
    rows.push({
      type: 'skill', source: skill.skillMdRepoRel, timing: `/${skill.sourceSlug} 或 AGENTS.md 路由`,
      consumer: '当前 agent adapter', state: 'available', status: listed ? 'declared' : 'directory-only',
    });
    if (!listed && bundle.manifestPath) findings.push({
      code: 'extension_skill_unlisted', message: `目录 skill 未在 manifest provides.skills 声明：${skill.sourceSlug}`,
      path: skill.skillMdRepoRel,
    });
  }
  for (const id of declared) {
    if (!scannedIds.has(id)) findings.push({
      code: 'extension_skill_declared_missing', message: `manifest skill 缺少 skills/${id}/SKILL.md`,
      path: bundle.manifestPath ?? undefined,
    });
  }

  for (const knowledge of bundle.knowledge) {
    const routed = bundle.manifestVersion === '1.1';
    rows.push({
      type: 'knowledge', source: rel(projectRoot, knowledge.absPath),
      timing: routed
        ? knowledge.audience === 'global' ? 'AGENTS.md 渲染时' : `Feature phases: ${(knowledge.audience as string[]).join(', ') || '全部'}`
        : '当前零消费（manifest 1.0）',
      consumer: routed ? knowledge.audience === 'global' ? '全局 agent 指令' : '对应 phase ai-prompt.md' : '无（1.0 兼容）',
      state: routed ? 'scheduled' : 'available', status: routed ? 'routed' : 'declared-unconsumed',
    });
  }
  for (const [phase, events] of Object.entries(bundle.hooks)) {
    for (const [event, files] of Object.entries(events)) for (const file of files) rows.push({
      type: 'hook', source: rel(projectRoot, file), timing: `${phase}.${event}`,
      consumer: 'harness lifecycle dispatcher', state: 'scheduled', status: 'declared',
    });
  }
  for (const [id, capability] of Object.entries(bundle.extensionCapabilities)) rows.push({
    type: 'capability', source: capability.provider ? rel(projectRoot, capability.provider) : id,
    timing: 'capability resolution', consumer: 'harness capability registry', state: 'scheduled', status: id,
  });
  for (const [skillId, assets] of Object.entries(bundle.skillAssetAbsPaths)) {
    for (const [assetKey, file] of Object.entries(assets)) rows.push({
      type: 'skill_asset', source: rel(projectRoot, file), timing: `/${skillId} 执行时`,
      consumer: `/${skillId}`, state: 'scheduled', status: assetKey,
    });
  }
  for (const [phase, file] of Object.entries(bundle.phaseRuleOverlayPaths)) rows.push({
    type: 'phase_rules_overlay', source: rel(projectRoot, file), timing: `${phase} 规则合并`,
    consumer: `harness ${phase} checker`, state: 'scheduled', status: 'declared',
  });
  const scheduledActions = new Set<string>();
  for (const [phase, slots] of Object.entries(bundle.phaseBindings)) {
    for (const [slot, bindings] of Object.entries(slots)) for (const binding of bindings ?? []) {
      if (binding.kind === 'mcp') scheduledActions.add(binding.ref);
      rows.push({
        type: 'phase_binding', source: `${binding.kind}:${binding.ref}`, timing: `${phase}.${slot}`,
        consumer: slot === 'after_phase_verify_before_close' ? 'check-receipt' : `harness ${phase} CheckResult`,
        state: 'scheduled', status: 'declared',
      });
    }
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
      status: `produces=${existing.length}/${action.produceAbsPaths.length}; invalid=${validations.reduce((sum, item) => sum + item.issues.length, 0)}; tool_visibility=${visibility === undefined ? 'not-reported' : visibility ? 'visible' : 'missing'}; source=agent_self_report`,
    });
  }

  for (const adapter of projectAdapters(projectRoot)) {
    for (const target of materializedTargets) {
      const paths = bridgePaths(projectRoot, frameworkDir, adapter, target.bridgeId);
      if (paths.length === 0) findings.push({
        code: 'extension_bridge_adapter_unsupported', message: `adapter 未声明 extension bridge：${adapter}`,
      });
    }
    for (const artifact of inspectInstanceSkillBridgeArtifacts({
      repoRoot: projectRoot, frameworkDir, agentAdapter: adapter, extensionDirRel: extensionDir,
      declaredSkillIds: selectedIds,
    })) {
      rows.push({
        type: 'bridge', source: artifact.path, timing: `adapter=${adapter} 物化`, consumer: `/${artifact.bridgeId}`,
        state: 'available', status: artifact.state,
      });
      if (artifact.state !== 'present') findings.push({
        code: `extension_bridge_${artifact.state}`,
        message: `扩展 Skill 桥接 ${artifact.state}：${artifact.path}`,
        path: artifact.path,
      });
    }
  }

  return {
    schemaVersion: '1.0', extensionRoot: bundle.rootDir ? rel(projectRoot, bundle.rootDir) : null,
    manifest: bundle.manifestPath ? rel(projectRoot, bundle.manifestPath) : null,
    rows, findings, manifestErrors: bundle.errors.map(error => ({ ...error, path: error.path ? rel(projectRoot, error.path) : undefined })),
  };
}

export function formatExtensionInspection(inspection: ExtensionInspection): string {
  const lines = [
    `extension_root: ${inspection.extensionRoot ?? '(absent)'}`,
    `manifest: ${inspection.manifest ?? '(absent)'}`,
    '',
    '| 类型 | 来源 | 生效时机 | 消费者 | 强度 | 状态 |',
    '|---|---|---|---|---|---|',
    ...inspection.rows.map(row =>
      `| ${row.type} | ${row.source} | ${row.timing} | ${row.consumer} | ${row.state} | ${row.status} |`),
  ];
  if (inspection.rows.length === 0) lines.push('| — | — | — | — | — | empty |');
  if (inspection.manifestErrors.length || inspection.findings.length) {
    lines.push('', '对账：');
    for (const item of [...inspection.manifestErrors, ...inspection.findings]) {
      lines.push(`- ${item.code}: ${item.message}${item.path ? ` (${item.path})` : ''}`);
    }
  }
  return lines.join('\n');
}
