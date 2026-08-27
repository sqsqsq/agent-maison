// ============================================================================
// ui-scope-gate.ts — ui_diff_within_declared_files（c4e8b1d3 G1）
// ============================================================================
// UI 文件级 scope 门：越界 UI 文件 = 本次 changed UI files − 冻结 contracts.files。
//
// 钉死口径（plan v17；白名单来源经 runner-owned-machine-facts 裁剪修订）：
//   1. 白名单 = **plan closure（phase-evidence-manifest）冻结的 contracts.yaml**——
//      当前盘上文件 hash 与 closure 记录相等才读取；manifest 缺失/破损/指针断裂/hash
//      失配一律 BLOCKER，禁止退回未经核对的 live contracts（coding 期 agent 可写）。
//      （旧口径用 per-run pass snapshot——快照是 closure-retry 的 TOCTOU 缓存、不是授权
//      载体，跨 run 下游起点名下天然无快照，曾让合法 --start coding 结构性 FAIL。）
//   2. diff 基线 = runner 在首次 coding agent invoke 前锚定的 coding_base_sha
//      （覆盖 committed/staged/unstaged/untracked 四态；agent 自行 commit 的越界文件
//      同样检出）。缺失与缺快照同罚 BLOCKER，不回退 trace.start_commit（那是 agent
//      之后才写的）。
//   3. 删除/重命名从 base 侧读旧内容做 UI 分类（改后内容已不在盘上）。
//   4. expansion 唯一路径 = 更新 contracts.files 并重新取得 plan PASS snapshot。
//
// 适用面：goal run（MAISON_GOAL_RUN_ID 在场）。适用与否**只由 diff 里有无 UI 文件变更
// 决定**——不做任何 live 文件（如 ui-spec）前置探测：round 19 P1 实锤，按 live ui-spec
// 存在性决定适用面时，agent 删掉它即可让门禁 SKIP，绕过成本为零。无 UI 变更 → PASS
//（白名单不咨询）；有 UI 变更 → 冻结白名单缺失/损坏一律 FAIL。非 goal 起跑无 run 级
// 冻结锚 → SKIP（诚实声明 goal-only；normal 模式过渡按 plan 发布约束人工核对）。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { resolveGoalRunBaseline } from './goal-run-baseline';
import {
  loadPhaseEvidenceManifest,
  readReceiptManifestPointer,
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
  const { projectRoot, feature, runId } = input;

  if (!runId) {
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
  // 「diff 里有没有 UI 文件变更」决定：没有 → PASS；有 → 必须过冻结白名单。
  const base = resolveGoalRunBaseline(projectRoot, feature, runId);
  if (!base.available) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_base_missing',
      details: `本 run（${runId}）无可信 run_base_sha：${base.reason}。`,
      suggestion: '请从 goal-runner 创建带出生基线的新 run；现代 run 不回退 env、trace 或 legacy coding-base。',
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

  // ③ 无 UI 文件变更 → PASS（本门只管 UI 面；白名单无需咨询，也就不因缺快照误伤非 UI 改动）
  if (uiChanged.size === 0) {
    return {
      status: 'PASS',
      details:
        `本次 diff 无 UI 文件变更（base=${baseShort}，diff 条目 ${diff.entries.length} 个）` +
        '——UI scope 门按定义 PASS（冻结白名单未咨询）。',
    };
  }

  // ④ 有 UI 变更 → 冻结白名单必须可用（fail-closed，禁退未经核对的 live contracts）
  // runner-owned-machine-facts 裁剪（codex 定案；宿主实锤 run 20260815T162931Z-3aa520 同族）：
  // 白名单校验源=plan closure 的 phase-evidence-manifest（跨 run 稳定、由回执指针锚定
  // 完整性），不再依赖 per-run pass snapshot（那是 closure-retry 的 TOCTOU 缓存，跨 run
  // 下游起点名下天然没有）。当前盘上 contracts.yaml 与 closure 冻结 hash 相等才读取；
  // 失配=live 漂移，按越界同罚 FAIL（post-agent 的 plan 授权检查走既有 replan 处置）。
  const planEvidence = loadPhaseEvidenceManifest(projectRoot, feature, 'plan');
  if (!planEvidence) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details:
        `检出 ${uiChanged.size} 个 changed UI 文件，但 plan closure 的 evidence manifest 缺失——` +
        'UI scope 白名单必须来自 plan closure 冻结的 contracts.yaml（live contracts coding 期 agent 可写，不可作依据）。',
      suggestion: '请先完成 plan 闭环（含 plan 的 goal run 或重闭环 plan）后再进入 coding。',
    };
  }
  if (!planEvidence.integrityOk) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details: `plan evidence manifest 完整性破损：${(planEvidence.integrityErrors ?? []).join('；')}`,
      suggestion: '重跑 plan 重新闭环（manifest 由 closure 重新生成）。',
    };
  }
  const pointer = readReceiptManifestPointer(projectRoot, feature, 'plan');
  if (pointer === null || pointer !== planEvidence.fileSha256) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details:
        pointer === null
          ? 'plan 回执缺 evidence_manifest_sha256 指针——证据链断裂，白名单来源不可信。'
          : 'plan 回执指针与 evidence manifest 当前文件哈希失配（manifest 被整体改写）。',
      suggestion: '重跑 plan 重新闭环恢复证据链。',
    };
  }
  const contractsEntry = [...planEvidence.manifest.outputs, ...planEvidence.manifest.inputs].find(
    (f) => path.posix.basename(f.path.replace(/\\/g, '/')) === 'contracts.yaml',
  );
  if (!contractsEntry || !contractsEntry.sha256) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details: 'plan closure 记录中无 contracts.yaml 条目/无哈希——closure 与产出表不一致（不变量违例）。',
      suggestion: '重跑 plan 阶段产出 contracts.yaml 并重新闭环。',
    };
  }
  const contractsAbs = path.join(projectRoot, contractsEntry.path);
  const liveSha = sha256FileOrNull(contractsAbs);
  if (liveSha === null) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details: `盘上 ${contractsEntry.path} 缺失/不可读，而 plan closure 记录了它——冻结面已被破坏。`,
      suggestion: '恢复 contracts.yaml 或重跑 plan 重新闭环。',
    };
  }
  if (liveSha !== contractsEntry.sha256) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details:
        `盘上 ${contractsEntry.path} 与 plan closure 冻结哈希失配（live 漂移）——` +
        'coding 期不得以漂移后的 contracts 作白名单（expansion 唯一路径=回 plan 更新并重新闭环）。',
      suggestion: '若 scope 确需扩：回 plan 更新 contracts.files 并重新闭环；否则恢复文件后重跑。',
    };
  }
  let declaredFiles: Set<string>;
  try {
    const doc = YAML.parse(fs.readFileSync(contractsAbs, 'utf-8')) as { files?: unknown } | null;
    declaredFiles = new Set(
      Array.isArray(doc?.files) ? doc!.files.map(x => normalizeRel(String(x))).filter(Boolean) : [],
    );
  } catch (e) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details: `冻结 contracts.yaml 解析失败：${(e as Error).message}`,
      suggestion: '核查 plan 产出的 contracts.yaml 语法后重跑 plan。',
    };
  }

  const violations = [...uiChanged].filter(rel => !declaredFiles.has(rel)).sort();

  if (violations.length === 0) {
    return {
      status: 'PASS',
      details:
        `changed UI files ${uiChanged.size} 个全部在冻结 contracts.files 白名单内` +
        `（base=${baseShort}，diff 条目 ${diff.entries.length} 个，白名单源=plan closure 冻结 contracts.yaml ${contractsEntry.sha256.slice(0, 12)}）。`,
    };
  }

  return {
    status: 'FAIL',
    failureKind: 'ui_scope_violation',
    details:
      `${violations.length} 个 changed UI 文件不在冻结 contracts.files 白名单内（任何 strictness 均 BLOCKER）：\n` +
      violations.slice(0, 15).map(v => `  - ${v}`).join('\n') +
      (violations.length > 15 ? `\n  ... 还有 ${violations.length - 15} 项` : '') +
      `\n\nbase=${baseShort}（coding_base_sha，覆盖 committed/staged/unstaged/untracked 四态）；` +
      `白名单来源=plan closure 冻结 contracts.yaml（sha ${contractsEntry.sha256.slice(0, 12)}，${declaredFiles.size} 项）。`,
    suggestion:
      '未声明的 UI 文件默认就是受保护范围。确属本需求必改 → 回 plan 把文件加进 contracts.yaml files ' +
      '并重新闭环 plan（重新闭环是 expansion 的唯一路径，改 live contracts 无效）；' +
      '属误改 → git restore 撤销这些文件。',
    affectedFiles: violations,
  };
}
