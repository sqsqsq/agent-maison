// ============================================================================
// ui-scope-gate.ts — ui_diff_within_declared_files（c4e8b1d3 G1）
// ============================================================================
// UI 文件级 scope 门：越界 UI 文件 = 本次 changed UI files − 冻结 contracts.files。
//
// 钉死口径（plan v17）：
//   1. 白名单 = **同 run plan PASS snapshot 冻结的 contracts.files**——快照缺失/失效/
//      损坏一律 BLOCKER，禁止退回 live ctx.featureSpec.contracts（coding 期 agent 可写，
//      读它=门禁形同虚设）。
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

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import {
  PASS_SNAPSHOT_ANCHOR_ENV,
  loadTrustedSnapshotContext,
  parseSnapshotAnchorEnv,
  readCodingBase,
  readFrozenSnapshotFile,
} from './pass-snapshot';
import { diffChangedFilesWithStatus, readFileAtRef, StatusDiffEntry } from './git-diff';

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
  const base = readCodingBase(projectRoot, feature, runId);
  if (!base.body || base.status === 'invalid') {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_base_missing',
      details:
        base.status === 'invalid'
          ? 'coding_base 记录损坏/上下文不匹配——diff 基线不可信。'
          : `本 run（${runId}）无 coding_base_sha——应由 runner 在首次 coding agent invoke 前锚定。`,
      suggestion: '请通过 goal-runner 从 plan 起跑（runner 会在 coding agent 起跑前锚定基线）；不使用 trace.start_commit 回退（其记录时点在 agent 之后）。',
    };
  }

  const diff = diffChangedFilesWithStatus({ projectRoot, baseRef: base.body.base_sha });
  if (!diff.executed) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_diff_unavailable',
      details: `基线 diff 不可用：${diff.error}（base=${base.body.base_sha.slice(0, 12)}）`,
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
          const buf = readFileAtRef(projectRoot, base.body.base_sha, rel);
          content = buf ? buf.toString('utf-8') : null;
        }
      }
      if (isUiSensitiveFile(rel, content)) uiChanged.add(rel);
    }
  }

  const baseShort = base.body.base_sha.slice(0, 12);

  // ③ 无 UI 文件变更 → PASS（本门只管 UI 面；白名单无需咨询，也就不因缺快照误伤非 UI 改动）
  if (uiChanged.size === 0) {
    return {
      status: 'PASS',
      details:
        `本次 diff 无 UI 文件变更（base=${baseShort}，diff 条目 ${diff.entries.length} 个）` +
        '——UI scope 门按定义 PASS（冻结白名单未咨询）。',
    };
  }

  // ④ 有 UI 变更 → 冻结白名单必须可用（fail-closed，禁退 live contracts）
  // b3e8d4c7 t4：**内存锚接线**。此前恒传 null，把 loadTrustedSnapshotContext 的
  // 换代检测整个关掉——agent 自建 epoch/head 也会被当授权面（宿主实锤自我扩权）。
  // 锚由 runner 经 MAISON_GOAL_SCOPE_ANCHOR 注入本 gate harness；缺 env（非 goal /
  // 人工跑）时仍为 null，既有行为不变。
  const anchorParse = parseSnapshotAnchorEnv(process.env[PASS_SNAPSHOT_ANCHOR_ENV], 'plan');
  if (anchorParse.kind === 'invalid') {
    // env 在场但损坏 → **fail-closed**，绝不降级为"没有锚"再去相信盘上的 head
    //（codex 复核 P1：本仓已多次实锤 env 传播缺失，静默降级等于把 t4 防线还回去）。
    return {
      status: 'FAIL',
      // **责任类别必须是框架侧**：锚 env 损坏是 runner→gate 的传播异常，不是产品代码问题。
      // 用 ui_scope_frozen_contract_missing（未登记在 FailureKind 分类表）会退化成
      // code_regression → 把环境问题丢给 coding agent 重试，t5 落地后还可能被误送 replan。
      failureKind: 'framework_bug',
      details: `scope 锚 env（${PASS_SNAPSHOT_ANCHOR_ENV}）在场但不可解析：${anchorParse.reason}`,
      suggestion: '这是 runner→gate 的锚传播异常（非产品问题）。核查 goal-runner 的 env 注入后重跑。',
    };
  }
  const snap = loadTrustedSnapshotContext(
    projectRoot,
    feature,
    runId,
    'plan',
    anchorParse.kind === 'ok' ? anchorParse.anchor : null,
  );
  if (snap.kind === 'none') {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details:
        `检出 ${uiChanged.size} 个 changed UI 文件，但本 run（${runId}）无 plan PASS snapshot——` +
        'UI scope 白名单必须来自冻结的 contracts.files（live contracts coding 期 agent 可写，不可作依据）。',
      suggestion: '请从 plan 阶段起跑 goal run（plan 正常 PASS 时 runner 必建快照）；第一版不做跨 run 自动寻找快照。',
    };
  }
  if (snap.kind === 'inactive') {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details: '本 run 的 plan PASS snapshot 已失效（superseded）——plan 须重新 PASS 后再进入 coding。',
      suggestion: '重跑 plan 阶段取得新的 PASS snapshot（scope expansion 的唯一合法路径）。',
    };
  }
  if (snap.kind === 'fail_closed') {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details: `plan PASS snapshot 可信加载失败：${snap.reason}`,
      suggestion: '人工核查 trust-state（~/.maison/goal-checkpoints）后重跑 plan 或 --resume。',
    };
  }
  const contractsEntry = snap.manifest.files.find(f => path.posix.basename(f.rel) === 'contracts.yaml');
  if (!contractsEntry) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details: 'plan PASS snapshot 内无 contracts.yaml 条目——PASS 态与产出表不一致（不变量违例）。',
      suggestion: '重跑 plan 阶段产出 contracts.yaml 并重新取得 PASS snapshot。',
    };
  }
  const contractsBuf = readFrozenSnapshotFile(snap.phaseDir, contractsEntry.rel, contractsEntry.sha256);
  if (!contractsBuf) {
    return {
      status: 'FAIL',
      failureKind: 'ui_scope_frozen_contract_missing',
      details: `快照存储的 ${contractsEntry.rel} 缺失或字节验哈希失败——快照被改毁。`,
      suggestion: '人工核查 trust-state 后重跑 plan 重建快照。',
    };
  }
  let declaredFiles: Set<string>;
  try {
    const doc = YAML.parse(contractsBuf.toString('utf-8')) as { files?: unknown } | null;
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
        `（base=${baseShort}，diff 条目 ${diff.entries.length} 个，快照 epoch=${snap.head.pass_epoch}）。`,
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
      `白名单来源=plan PASS snapshot epoch=${snap.head.pass_epoch} 的 contracts.files（${declaredFiles.size} 项）。`,
    suggestion:
      '未声明的 UI 文件默认就是受保护范围。确属本需求必改 → 回 plan 把文件加进 contracts.yaml files ' +
      '并重新通过 plan（重取 PASS snapshot 是 expansion 的唯一路径，改 live contracts 无效）；' +
      '属误改 → git restore 撤销这些文件。',
    affectedFiles: violations,
  };
}
