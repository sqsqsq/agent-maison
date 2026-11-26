import { resolveImplementationScope, classifyChangedFiles, implementationPathSelector, readCurrentImplementationDiff } from './diff-scope';
// UI 变更沿原 diff/契约身份读取；权限来自原需求边界，不按预测文件名封顶。
// 删除和重命名保留旧内容识别，正常与 runless 冻结入口共用判定。
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { loadLineageRunEvents, resolveEffectiveScopeSource } from './goal-run-creation';
import { resolveProbeFrameworkRoot } from '../../repo-layout';
import { unresolvedPhaseWrites } from './phase-write-boundary';
import { readRunBoundContracts, type ResolvedPhaseInputs } from './capability-resolution';
import { evidenceEntryMatchesCurrentFile, loadPhaseEvidenceManifest } from './phase-evidence-manifest';
import { readFileAtRef, resolveEffectiveDiffBaseline, StatusDiffEntry } from './git-diff';

// --------------------------------------------------------------------------
// UI 敏感文件三类判据（plan v14 G1）
// --------------------------------------------------------------------------

/** 路径判据：pages/components/presentation 目录下的 .ets */
export function isUiSensitivePath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  if (!p.endsWith('.ets')) return false;
  return /(^|\/)(pages|components|presentation)\//.test(p);
}

/** 内容判据：ArkUI UI 结构标志（只对 .ets 生效） */
export function hasUiContentMarkers(content: string): boolean {
  return (
    content.includes('@Entry') ||
    content.includes('@Component') ||
    /\bbuild\s*\(\s*\)/.test(content) ||
    content.includes('NavDestination') ||
    /\bTabs\b/.test(content) ||
    content.includes('bindSheet')
  );
}

/** 资源判据：UI media/resource 文件（resources/<qualifier>/media/**） */
export function isUiMediaResourcePath(rel: string): boolean {
  return /(^|\/)resources\/[^/]+\/media\//.test(rel.replace(/\\/g, '/'));
}

/** 单个变更条目的 UI 分类（内容由调用方按 disk/base 侧提供；null=读不到，仅按路径判） */
export function isUiSensitiveFile(rel: string, content: string | null): boolean {
  const p = rel.replace(/\\/g, '/');
  if (isUiMediaResourcePath(p)) return true;
  if (!p.endsWith('.ets')) return false;
  if (isUiSensitivePath(p)) return true;
  return content !== null && hasUiContentMarkers(content);
}

// --------------------------------------------------------------------------
// 门禁主体
// --------------------------------------------------------------------------

export interface UiScopeGateInput {
  projectRoot: string;
  feature: string;
  /** goal run 身份（MAISON_GOAL_RUN_ID）；null = 非 goal 起跑 */
  runId: string | null;
  frameworkRoot?: string;
  resolvedInputs?: ResolvedPhaseInputs;
}

export interface UiScopeGateResult {
  status: 'PASS' | 'FAIL' | 'SKIP';
  details: string;
  affectedFiles?: string[];
  suggestion?: string;
  failureKind?: string;
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** changed 条目 → 待分类的 (rel, 内容来源) 对：rename 拆成旧删+新增两条 UI 判定。 */
export function uiClassificationTargets(e: StatusDiffEntry): Array<{ rel: string; side: 'disk' | 'base' }> {
  if (e.status === 'D') return [{ rel: e.path, side: 'base' }];
  if ((e.status === 'R' || e.status === 'C') && e.oldPath) {
    // rename：旧路径按 base 侧内容判（被移走=被改动的受保护面），新路径按盘上判
    return [
      { rel: e.oldPath, side: 'base' },
      { rel: e.path, side: 'disk' },
    ];
  }
  return [{ rel: e.path, side: 'disk' }];
}

export function runUiDiffWithinDeclaredFiles(input: UiScopeGateInput): UiScopeGateResult {
  const { projectRoot, feature } = input;
  // 本门的 runId 形状是 `string | null`（无 run 显式写 null）；统一入口与基线取 `string | undefined`。
  const runId = input.runId ?? undefined;

  // D1 §6.4 G6：**现代 feature 权威在场时不得再走这条历史 SKIP**。
  // 条件从「无 run」收窄为「既无 run、也无 feature 冻结记录」——旧 normal 模式（两者皆无）
  const authority = resolveEffectiveScopeSource(projectRoot, feature, runId);
  if (!runId && !authority) {
    return {
      status: 'SKIP',
      details:
        '非 goal run（无 MAISON_GOAL_RUN_ID）：本门依赖 runner 的 run 级冻结锚（plan PASS snapshot + ' +
        'coding_base_sha），normal 模式无此锚，SKIP。过渡期涉及 UI 范围的交付按 plan c4e8b1d3 发布约束' +
        '以人工核对 golden 十固定屏 + 无新增页面为准。',
    };
  }

  const diff = readCurrentImplementationDiff(projectRoot, runId);
  const frameworkRoot = input.frameworkRoot ?? resolveProbeFrameworkRoot(projectRoot);
  const candidates = new Set<string>();
  const related = new Set<string>();
  const isUi = (relative: string, baseSha?: string): boolean => {
    let content: string | null = null;
    if (relative.endsWith('.ets') && !isUiSensitivePath(relative)) {
      try {
        content = baseSha ? readFileAtRef(projectRoot, baseSha, relative)?.toString('utf8') ?? null
          : fs.readFileSync(path.join(projectRoot, relative), 'utf8');
      } catch { /* File kind can also be proven by its path. */ }
    }
    return isUiSensitiveFile(relative, content);
  };
  try {
    if (runId) {
      const events = loadLineageRunEvents(projectRoot, feature, runId);
      const confirmed = unresolvedPhaseWrites(projectRoot, events, { feature, frameworkRoot, runId });
      const baseline = confirmed.size ? resolveEffectiveDiffBaseline(projectRoot, feature, runId) : undefined;
      for (const file of confirmed.keys()) {
        if (isUi(file) || baseline?.available && isUi(file, baseline.baseSha)) {
          candidates.add(file);
          related.add(file);
        }
      }
    }
    for (const entry of diff.entries) {
      for (const target of uiClassificationTargets(entry)) {
        const relative = normalizeRel(target.rel);
        if (isUi(relative, target.side === 'base' ? diff.baseSha : undefined)) candidates.add(relative);
      }
    }
    if (!candidates.size) return { status: 'PASS', details: diff.executed
      ? '本次未发现 UI 文件变化，无需咨询范围证据。' : '比较路径未取得，继续按当前目标核对实际 UI。' };

    let contracts: Pick<import('./types').ContractsSpec, 'files' | 'modules'> | undefined;
    if (input.resolvedInputs || authority?.source === 'feature') {
      contracts = readRunBoundContracts(projectRoot, frameworkRoot, feature, runId);
    } else if (runId) {
      const evidence = loadPhaseEvidenceManifest(projectRoot, feature, 'plan');
      const entry = evidence?.integrityOk ? [...evidence.manifest.inputs, ...evidence.manifest.outputs]
        .find(row => path.posix.basename(row.path) === 'contracts.yaml') : undefined;
      if (!entry?.exists || !evidenceEntryMatchesCurrentFile(projectRoot, entry, feature)) {
        throw new Error('plan 的 contracts.yaml 原绑定缺失或失配；由原责任方核对。');
      }
      contracts = YAML.parse(fs.readFileSync(path.join(projectRoot, entry.path), 'utf8')) as typeof contracts;
    }

    const select = implementationPathSelector(projectRoot, contracts, input.resolvedInputs);
    for (const entry of diff.entries) {
      if (!select(entry.path) && !(entry.oldPath && select(entry.oldPath))) continue;
      for (const target of uiClassificationTargets(entry)) if (candidates.has(normalizeRel(target.rel))) related.add(normalizeRel(target.rel));
    }
    const scope = resolveImplementationScope(projectRoot, feature, contracts?.modules, runId);
    const violations = scope.explicit ? classifyChangedFiles([...related], scope.allowedPrefixes, scope.sourcePrefixes).violations : [];
    return { status: violations.length ? 'FAIL' : 'PASS',
      details: `本次 UI 变化 ${related.size} 个；待核实际关联的工作区候选 ${candidates.size - related.size} 个；原请求明确范围外 ${violations.length} 个。`,
      affectedFiles: violations,
      ...(violations.length ? { failureKind: 'scope_violation', suggestion: '交原责任方核对实际 UI 范围和相关验收。' } : {}) };
  } catch (error) { return { status: 'FAIL', failureKind: 'ui_scope_frozen_contract_missing', details: String(error), suggestion: '恢复有效绑定和工程输入后复验。' }; }
}
