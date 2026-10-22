import { resolveImplementationScope, classifyChangedFiles, layerDirPrefixes } from './diff-scope';
// UI 变更沿原 diff/契约身份读取；权限来自原需求边界，不按预测文件名封顶。
// 删除和重命名保留旧内容识别，正常与 runless 冻结入口共用判定。
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { resolveEffectiveDiffBaseline } from './git-diff';
import { resolveEffectiveScopeSource } from './goal-run-creation';
import { readRunBoundContracts, type ResolvedPhaseInputs } from './capability-resolution';
import {
  evidenceEntryMatchesCurrentFile,
  loadPhaseEvidenceManifest,
} from './phase-evidence-manifest';
import { diffChangedFilesWithStatus, readFileAtRef, StatusDiffEntry } from './git-diff';

// --------------------------------------------------------------------------
// UI 敏感文件三类判据（plan v14 G1）
// --------------------------------------------------------------------------

function sha256FileOrNull(abs: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}

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

  // ① diff 基线：runner 锚定的 coding_base_sha（缺失/损坏同罚，不回退 trace.start_commit）。
  // 注意顺序（round 19 P1）：**不做任何 live 文件前置探测**（曾按 live ui-spec 存在性
  // 决定适用面——agent 删掉 ui-spec 即可让门禁 SKIP，绕过成本为零）。适用面只由
  // 「diff 里有没有 UI 文件变更」决定：没有 → PASS；有 → 核实契约与原需求范围。
  const base = resolveEffectiveDiffBaseline(projectRoot, feature, runId);
  if (!base.available) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_base_missing',
      details: runId
        ? `本 run（${runId}）无可信 run_base_sha：${base.reason}。`
        : `无 run 路径的 diff 基线不可用：${base.reason}。`,
      suggestion: runId
        ? '请从 goal-runner 创建带出生基线的新 run；现代 run 不回退 env、trace 或 legacy coding-base。'
        : '修正 HARNESS_DIFF_BASE_REF（指向真实存在的 commit），或不设它按工作区比较。',
    };
  }

  const diff = diffChangedFilesWithStatus({ projectRoot, baseRef: base.baseSha });
  if (!diff.executed) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_diff_unavailable',
      details: `基线 diff 不可用：${diff.error}（base=${base.baseSha.slice(0, 12)}）`,
      suggestion: '核查项目 git 状态（基线 commit 是否被 rebase/gc 掉）；必要时从 plan 重新起跑。',
    };
  }

  // ③ 逐条 UI 分类（删除/rename 旧路径从 base 侧读内容）
  const uiChanged = new Set<string>();
  for (const entry of diff.entries) {
    for (const t of uiClassificationTargets(entry)) {
      const rel = normalizeRel(t.rel);
      if (uiChanged.has(rel)) continue;
      let content: string | null = null;
      if (rel.endsWith('.ets') && !isUiSensitivePath(rel)) {
        // 只有需要内容判据时才读内容
        if (t.side === 'disk') {
          const abs = path.join(projectRoot, rel);
          try {
            content = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf-8') : null;
          } catch {
            content = null;
          }
        } else {
          const buf = readFileAtRef(projectRoot, base.baseSha, rel);
          content = buf ? buf.toString('utf-8') : null;
        }
      }
      if (isUiSensitiveFile(rel, content)) uiChanged.add(rel);
    }
  }

  const baseShort = base.baseSha.slice(0, 12);

  // ③ 无 UI 变更时不咨询契约，避免误伤非 UI 改动
  if (uiChanged.size === 0) {
    return {
      status: 'PASS',
      details:
        `本次 diff 无 UI 文件变更（base=${baseShort}，diff 条目 ${diff.entries.length} 个）` +
        '——UI scope 门按定义 PASS（未咨询契约）。',
    };
  }

  try {
    let hints: Array<{ name?: string; package_path?: string }> = [];
    if (input.resolvedInputs) hints = readRunBoundContracts(projectRoot, input.frameworkRoot!, feature, runId).modules;
    else if (runId) {
      const evidence = loadPhaseEvidenceManifest(projectRoot, feature, 'plan');
      if (!evidence?.integrityOk) throw new Error('plan closure 缺失或完整性失配');
      const entry = [...evidence.manifest.inputs, ...evidence.manifest.outputs].find(row => path.posix.basename(row.path) === 'contracts.yaml');
      if (!entry?.sha256) throw new Error('plan closure 未绑定 contracts.yaml');
      const file = path.join(projectRoot, entry.path);
      if (sha256FileOrNull(file) !== entry.sha256) throw new Error('contracts.yaml 与原绑定失配；回责任方重签，不能改写绑定');
      hints = (YAML.parse(fs.readFileSync(file, 'utf8')) as { modules?: typeof hints })?.modules ?? [];
    }
    const scope = resolveImplementationScope(projectRoot, feature, hints, runId);
    const violations = classifyChangedFiles([...uiChanged], scope.allowedPrefixes, scope.sourcePrefixes).violations;
    return { status: violations.length ? 'FAIL' : 'PASS',
      details: `实际 UI 变更 ${uiChanged.size} 个；原请求明确范围外 ${violations.length} 个。预测文件表不作许可，实际行为仍由 review/真机验证。`,
      affectedFiles: violations,
      ...(violations.length ? { failureKind: 'scope_violation' as const, suggestion: '恢复不符合原请求边界的改动；确需改变真实约束时交责任方。' } : {}) };
  } catch (error) { return { status: 'FAIL', failureKind: 'ui_scope_frozen_contract_missing', details: String(error), suggestion: '恢复有效绑定和工程输入后复验。' }; }
}
