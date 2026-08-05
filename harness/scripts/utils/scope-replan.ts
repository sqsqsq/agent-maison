// ============================================================================
// scope-replan.ts — scope 合法演进的**自动回退闭环**（plan b3e8d4c7 t5）
// ----------------------------------------------------------------------------
// 设计哲学（用户拍板，framework 级）：
//
//     允许发现、自动回退、重新签发；禁止原地自我授权。
//
// t4 只做了「禁止」那一半（内存锚接线，堵掉 agent 自建 pass_epoch）。于是 coding
// 发现范围不足时只能停——而这恰恰是开发中最常见的正常事，把它变成人工决策问题
// 违背无人值守的立项目标。本模块补「允许发现」那一半：
//
//     发现 plan 权责面的范围不足 / 授权不可信 / 产物漂移
//     → invalidation 从 **plan** 起算（既有事务，不新增机制）
//     → affected files 作为**未受信上下文**交给 plan（是"发现事实"，不是授权）
//     → plan 重跑并独立裁决 → PASS 后 runner 新签 snapshot → 回 coding
//
// **不新增**：注册表 / 签名服务 / 凭据配置 / 新权限系统 / 新预算面 / **额外的防震荡规则**。
// 收敛**只**由既有 DEFAULT_MAX_BACKTRACKS 负责；耗尽 / chain 不含 plan 时如实返回
// unavailable，由调用方落到**既有**等待机制——本模块不自造 halt 语义。
//
// 曾经加过一个「同一组越界文件只 replan 一次」的指纹集，**已删**：全局回退预算本就负责
// 收敛，它是重复机制；更糟的是它**削弱自愈**——plan 第一次没扩对时，第二次本还有机会
// 重新裁决，却被指纹提前拦掉、转去注定无效的 coding retry。
// 注意这与既有 seenRoundFingerprints / seenDriftFingerprints **不是一回事**：那两个针对
// 「完全相同的不可修复结果再次出现」，有明确 terminal 语义；scope 的正常演进不是那个东西。
//
// 与既有两处回退调用点（goal-runner.ts:8118 授权/漂移回退、:8369 缺陷回退）的关系：
// 那两处目标是 **coding**，本模块目标是 **plan**，触发面与失效下限都不同，故并存。
// 事件顺序按 pass-snapshot.ts:1327-1331 定下的不变量：
//
//     journal pending → heads → **events** → commit
//
// 即 commit **必须最后**——先 commit 再补事件时，「commit 后、事件补齐前」的二次崩溃
// 会让缺失事件永久不可修复（下次 resume 见 journal 已消失，直接 none）。
// ============================================================================

import {
  beginInvalidationTx,
  commitInvalidationTx,
  diffFrozenAgainstManifest,
  loadTrustedSnapshotContext,
} from './pass-snapshot';
import { validateProjectRelativePath } from './project-relative-path';

/** 触发面的**闭集**——跨 resume 回放时只认这三个值，未知一律不采信 */
export const SCOPE_REPLAN_TRIGGERS = [
  'ui_scope_violation',
  'plan_authority_unverifiable',
  'invalidation_journal_untrusted',
] as const;

/** 触发面。三者共用同一条通道，只在事件 reason 上留可区分的审计痕迹。 */
export type ScopeReplanTrigger =
  /** ① coding 改了 plan 冻结白名单外的 UI 文件（ui_scope_violation） */
  | 'ui_scope_violation'
  /** ④ coding spawn 前：plan 授权不可信，或宿主 live 产物已偏离冻结面 */
  | 'plan_authority_unverifiable'
  /** ⑤ 启动期：残留 invalidation journal 不可信，不读其 payload、从 plan 重建 */
  | 'invalidation_journal_untrusted';

export type ScopeReplanOutcome =
  | {
      kind: 'replanned';
      /** 调用方据此把执行指针拨回 plan */
      planIdx: number;
      invalidatedPhases: string[];
      txId: string;
    }
  /** 不可回退——调用方走**既有**等待机制，不得在此新造 halt 分类 */
  | {
      kind: 'unavailable';
      reason: 'chain_lacks_plan' | 'backtrack_budget_exhausted';
      detail: string;
    };

/** 只用到 delete——不耦合 runner 的内存锚具体形状 */
type AnchorMemory = { delete(key: string): boolean };

export interface ScopeReplanInput {
  projectRoot: string;
  feature: string;
  runId: string;
  chain: readonly string[];
  /**
   * 失效区间右端（**含**）。
   * · 触发于某 phase 内（①④）→ 该 phase 的下标，与既有两处回退调用点同构；
   * · 启动期重建（⑤）→ `chain.length - 1`，即 plan 到链尾全量。
   */
  endPhaseIdx: number;
  /**
   * 只失效**已有 outcome** 的阶段（对齐既有调用点的
   * `.filter(p => outcomes.some(o => o.phase === p))`）。
   * 启动期传 `null` = 不过滤：此时 outcome 视图本身可能还没重建完，而
   * `beginInvalidationTx` 对「无 PASS head 的 phase」本就跳过（pass-snapshot.ts:1277），
   * 全量传入是安全的。
   */
  phasesWithOutcome: readonly string[] | null;
  backtracksUsed: number;
  maxBacktracks: number;
  trigger: ScopeReplanTrigger;
  /** 触发点所在阶段（事件 cause_phase）；启动期用链首 */
  causePhase: string;
  /** 触发事实。**未受信上下文**——交给 plan 看，不构成任何授权 */
  affectedFiles?: readonly string[];
  /** 人类可读的触发说明，进事件供排障 */
  detail: string;
  dryRun: boolean;
  passSnapshotMemory: AnchorMemory;
  emit: (event: Record<string, unknown>) => void;
  /** 测试注入；缺省走真实事务 */
  begin?: typeof beginInvalidationTx;
  commit?: typeof commitInvalidationTx;
}

/**
 * 一次自动回退到 plan。**只做失效事务 + 事件**；执行指针 / 预算计数 / outcomes 裁剪
 * 由调用方按各自的循环状态应用（与既有两处回退调用点同款分工）。
 */
export function tryScopeReplan(input: ScopeReplanInput): ScopeReplanOutcome {
  const planIdx = input.chain.indexOf('plan');
  if (planIdx < 0) {
    // 边界：截断链不得 indexOf 后硬回退（-1 会把整条链算进失效区间）。
    return {
      kind: 'unavailable',
      reason: 'chain_lacks_plan',
      detail: `执行链不含 plan（chain=${input.chain.join('→')}），无处回退——需另起含 plan 的 run`,
    };
  }
  if (input.backtracksUsed >= input.maxBacktracks) {
    return {
      kind: 'unavailable',
      reason: 'backtrack_budget_exhausted',
      detail: `回退预算已耗尽（${input.backtracksUsed}/${input.maxBacktracks}，与其他回退共用）`,
    };
  }

  const endIdx = Math.min(input.endPhaseIdx, input.chain.length - 1);
  const span = input.chain.slice(planIdx, endIdx + 1).map(String);
  const invalidatedPhases =
    input.phasesWithOutcome === null
      ? span
      : span.filter(p => input.phasesWithOutcome!.includes(p));

  const ordinal = input.backtracksUsed + 1;
  const txId = `${input.runId}-scopebt${ordinal}`;
  const files = (input.affectedFiles ?? []).slice(0, 20);

  if (!input.dryRun) {
    (input.begin ?? beginInvalidationTx)({
      projectRoot: input.projectRoot,
      feature: input.feature,
      runId: input.runId,
      causePhase: input.causePhase,
      invalidatedPhases,
      txId,
    });
    // 合法 supersede：同进程内存锚必须一并清除，否则下一轮 loader 会拿旧锚判"盘上被换代"
    for (const p of invalidatedPhases) input.passSnapshotMemory.delete(p);
  }

  for (const p of invalidatedPhases) {
    input.emit({
      type: 'phase_invalidated',
      phase: p,
      cause_phase: input.causePhase,
      reason: input.trigger,
      invalidation_tx_id: txId,
    });
  }
  input.emit({
    type: 'phase_backtrack_requested',
    phase: input.causePhase,
    to_phase: 'plan',
    reason: input.trigger,
    // 保守恢复路**恒不产授权语义**——不冒充人工授权回退（对齐 goal-runner.ts:8155 惯例）
    authorized: false,
    detail: input.detail,
    files,
    invalidation_tx_id: txId,
  });

  // commit **最后**（见文件头顺序不变量）
  if (!input.dryRun) {
    (input.commit ?? commitInvalidationTx)(input.projectRoot, input.feature, input.runId, txId);
  }

  input.emit({ type: 'phase_backtrack_started', to_phase: 'plan' });
  return { kind: 'replanned', planIdx, invalidatedPhases, txId };
}

// ---------------------------------------------------------------------------
// ④ plan 授权检查 —— coding **spawn 前**与 **agent 返回后** 各调用一次
// ---------------------------------------------------------------------------

/** runner 内存锚的形状（goal-runner.ts:5418 的 passSnapshotMemory 值类型） */
export interface PlanScopeAnchor {
  epoch: number;
  memoryDigest: { manifestSha256: string; fileHashes: Record<string, string> };
}

export type PlanAuthorityOutcome =
  /** 授权成立——调用方须把 anchor 固定进 passSnapshotMemory 后再 spawn */
  | { kind: 'ok'; anchor: PlanScopeAnchor }
  /** 授权不成立 / live 已漂移——**不得 spawn coding**，走 tryScopeReplan */
  | {
      kind: 'replan';
      reason: 'snapshot_untrusted' | 'live_drift';
      detail: string;
      affectedFiles: string[];
    };

/**
 * plan 授权检查。coding 阶段**两个边界各调用一次**，缺一不可：
 *
 * · **spawn 前**（`agent_invoke_start` 之前）——防"拿着证明不了的旧授权开工"；
 * · **agent 返回后、harness 之前**——防"本轮 agent 自己把 plan 产物改了"。
 *   少了后一次，coding agent 改掉 `plan.md` / `contracts.yaml` 后只要 coding gate 仍 PASS
 *   就能直接 advance 到 review：既有 post-agent 冻结检查只看**当前 phase** 的
 *   trustedSnapshot，而普通 coding attempt 没有 coding 快照（kind='none'）→ 整块被跳过。
 *   两次调用同一个函数、同一条 `tryScopeReplan` 路由，**不另建检测器**。
 *
 * 为什么 spawn 前那次必须前移（三条事实，均已逐行核实）：
 * ① 既有 pre-spawn 可信加载读的是**当前 phase** 快照（goal-runner.ts:5795）——进 coding
 *    时它检 coding 快照，不检 plan scope 快照；
 * ② `passSnapshotMemory` 每进程新建（goal-runner.ts:5418），**resume 后恒空**；
 * ③ gate 的锚来自 `scopeAnchorEnv` → `memory.get('plan')`，取不到就不注入，gate 退回
 *    无锚行为，无 HMAC 时 `ok_unauthenticated` 弱信任放行。
 * 合起来即：**t4 的锚保护在 resume 后自然蒸发**。不前移的话，无可信 plan 授权的 resume
 * 会先跑完一轮 coding、再由 post-agent gate 发现问题——白烧一次 attempt，且 agent 在
 * 授权未确认时已经动过代码。
 *
 * 两条信任路径**收敛到同一次 loader 调用**：
 * · 同进程 → 传 `expectedAnchor`，loader 已内建「盘上消失/退位/换代即篡改」
 *   （pass-snapshot.ts:919-926），`kind='active'` 即锚已核对，无需另写比较；
 * · resume → `expectedAnchor` 为 null，改由**两个 MAC** 担保。
 * 两者随后消费**同一个 `ctx.manifest`**——不存在「先比 head、再重新读另一份 manifest」
 * 的 TOCTOU。
 *
 * live 漂移必须单独比（`loadTrustedSnapshotContext` 不做这件事）：它只证明**快照本身**
 * 可信、绑定正确、存储完整，读的是快照目录里的 manifest.json，**从不去哈希宿主 live 的
 * plan.md / contracts.yaml**（pass-snapshot.ts:983 直接返回 active）。而既有唯一
 * `diffFrozenAgainstManifest` 调用点在 **post-agent** 的 closure-only 块
 * （goal-runner.ts:6710），且吃的是**当前 phase** 的快照——普通 coding attempt 根本没有
 * coding 快照（kind='none'），整块被跳过。**即：一次普通 coding attempt 期间，plan 冻结面
 * 的 live 漂移在 spawn 前后都没有任何地方在比。**
 *
 * 有 diff 时**不先 restore**：`restoreFrozenFromSnapshot` 在无内存锚的 resume 面
 * （tier=resume）可能被拒，那会把「自动回退」重新变成求人；而 replan 本来就会重出 plan
 * 产物并由 runner 重新签发，restore 是多余动作。
 */
export function checkPlanAuthority(input: {
  projectRoot: string;
  feature: string;
  runId: string;
  /** `passSnapshotMemory.get('plan')`；resume 后恒为 undefined */
  memoryAnchor: PlanScopeAnchor | null | undefined;
  load?: typeof loadTrustedSnapshotContext;
  diff?: typeof diffFrozenAgainstManifest;
}): PlanAuthorityOutcome {
  const mem = input.memoryAnchor;
  // 显式投影：内存 map 存的是 memoryDigest 结构，loader 的 expectedAnchor 只要
  // { epoch, manifestSha256 }——整体传入是类型错误。仓内同款投影另见
  // goal-runner.ts:5805（既有 pre-spawn 加载）与 scopeAnchorEnv（goal-runner.ts:753）。
  const expectedAnchor = mem
    ? { epoch: mem.epoch, manifestSha256: mem.memoryDigest.manifestSha256 }
    : null;

  const ctx = (input.load ?? loadTrustedSnapshotContext)(
    input.projectRoot,
    input.feature,
    input.runId,
    'plan',
    expectedAnchor,
  );
  if (ctx.kind !== 'active') {
    return {
      kind: 'replan',
      reason: 'snapshot_untrusted',
      detail:
        `plan PASS 快照不可信（kind=${ctx.kind}` +
        (ctx.kind === 'fail_closed' ? `：${ctx.reason}` : '') +
        '）——证明不了旧授权，回 plan 重新签发',
      affectedFiles: [],
    };
  }
  // resume 面（无内存锚）改由 HMAC 担保；同进程面锚已在 loader 内核对过，不再要求 MAC
  // （HMAC 是可选加固，不参与正常流程硬门禁）。
  if (expectedAnchor === null && (ctx.headMac !== 'ok' || ctx.manifestMac !== 'ok')) {
    return {
      kind: 'replan',
      reason: 'snapshot_untrusted',
      detail:
        `resume 面无同进程内存锚，且 plan 快照未认证（head=${ctx.headMac} / manifest=${ctx.manifestMac}）` +
        '——不采信可疑旧授权，回 plan 重新签发',
      affectedFiles: [],
    };
  }

  const diffs = (input.diff ?? diffFrozenAgainstManifest)({
    projectRoot: input.projectRoot,
    feature: input.feature,
    phase: 'plan',
    manifest: ctx.manifest,
  });
  if (diffs.length > 0) {
    return {
      kind: 'replan',
      reason: 'live_drift',
      detail:
        `plan 快照可信，但宿主 live 产物已偏离冻结面（${diffs.length} 项：` +
        diffs.slice(0, 5).map(d => `${d.rel}[${d.class}]`).join('、') +
        '）——不在漂移的授权面上开工，回 plan 重新裁决',
      affectedFiles: diffs.map(d => d.rel),
    };
  }

  // **不读第三次盘**：锚直接由同一个 ctx 折出，与 takePassSnapshot 的 memoryDigest
  // 同构（pass-snapshot.ts:642-644 —— fileHashes[f.rel] = f.sha256，源就是 manifest.files）。
  const fileHashes: Record<string, string> = {};
  for (const f of ctx.manifest.files) fileHashes[f.rel] = f.sha256;
  return {
    kind: 'ok',
    anchor: {
      epoch: ctx.head.pass_epoch,
      memoryDigest: { manifestSha256: ctx.head.manifest_sha256, fileHashes },
    },
  };
}

// ---------------------------------------------------------------------------
// ② 交给 plan 的未受信上下文 —— **进 LLM prompt 前的净化**
// ---------------------------------------------------------------------------

/**
 * 进 plan prompt 的 scope 回退上下文。**刻意只有两个字段**：
 * · `reason` **只取闭集 `SCOPE_REPLAN_TRIGGERS`**——不在闭集时
 *   `resolveScopeReplanContext` 返回 `null`（什么都不注入），不存在"未知"这一态；
 * · `files` 每条都过路径校验 + 字符集 + 长度 + 数量上限。
 *
 * **没有自由文本字段**——散文 `detail` 只进事件与控制台（那不是 LLM 的输入面），
 * 提示词里的说明一律由 `reason` 查固定文案。
 */
export interface ScopeReplanPromptContext {
  reason: ScopeReplanTrigger;
  files: string[];
}

/** 单条路径的最大长度——超长本身就是可疑输入，不做截断（截断会掩盖异常） */
const MAX_REL_LEN = 200;
/** 进提示词的路径条数上限（与事件 files 截断口径一致） */
const MAX_FILES = 20;
/**
 * 允许的路径字符集：仅 ASCII 字母数字与 `. _ - /`。
 * 刻意**不**放行空格、引号、反引号、反斜杠与任何控制字符——
 * 换行是 prompt injection 的主载体（伪造事件在路径里塞 `\n## 新指令`）。
 * 代价：含中文/空格的合法文件名会被丢弃（如实少列，不会误导 plan）；
 * 收益：提示词里不可能出现攻击者控制的换行或标记语法。
 */
const SAFE_REL = /^[A-Za-z0-9._\-/]+$/;

/**
 * 净化一组待进提示词的路径。任何一条不合规 → **丢弃该条**（不抛错、不整体作废）：
 * 上下文是"辅助信息"，少列几条只是提示变弱，而放行一条恶意串是权限面被架空。
 */
export function sanitizeScopeReplanFiles(projectRoot: string, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const s = item.trim();
    if (!s || s.length > MAX_REL_LEN) continue;
    if (!SAFE_REL.test(s)) continue;
    try {
      out.push(validateProjectRelativePath(projectRoot, s, 'scope replan file'));
    } catch {
      continue; // 绝对路径 / 盘符 / `..` 段 / 越根
    }
    if (out.length >= MAX_FILES) break;
  }
  return [...new Set(out)];
}

/**
 * 由**任意来源**的 reason/files 得到可安全进提示词的上下文。
 *
 * 为什么两条路径都走它（比 codex 建议更严一格）：跨 resume 的 `events.jsonl` 无 MAC、
 * agent 可写自不必说；**同进程的 `affectedFiles` 也不是全可信**——它来自
 * `diffFrozenAgainstManifest` 对 watched_roots 的目录清点，文件名由 agent 决定。
 * 所以净化不分来源，统一在这里做一次。
 */
export function resolveScopeReplanContext(input: {
  projectRoot: string;
  reason: unknown;
  files: unknown;
}): ScopeReplanPromptContext | null {
  // reason 不在闭集 → **返回 null，什么都不注入**。合法生产路径只会产生这三个值，
  // 未知只能是伪造 / 损坏 / 不兼容的新版事件——此时凭空造一句「请自查 git diff」
  // 等于**在没有可信事实时发明行为**，仍是让不可信事件影响了 agent。
  // 事件本身留在日志里供排障，但不参与提示词。
  if (!(SCOPE_REPLAN_TRIGGERS as readonly string[]).includes(String(input.reason))) return null;
  return {
    reason: String(input.reason) as ScopeReplanTrigger,
    files: sanitizeScopeReplanFiles(input.projectRoot, input.files),
  };
}
