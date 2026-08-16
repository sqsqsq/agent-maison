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
//     → 一条 phase_backtrack_requested 记录从 **plan** 起算，缓存随后可重复丢弃
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
// 事件顺序：**事件先落盘，缓存副作用后做**。事件本身是失效事实的原子记录；缓存
// 退位/内存锚清理都可重复执行，崩溃后 resume 只需重放同一条记录。
// ============================================================================

import { discardPassSnapshotCache } from './pass-snapshot';
import { recomputePhaseEvidenceStaleness } from './phase-evidence-manifest';
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

/** 测试缝：原子失效 record 落盘、缓存副作用开始前的崩溃窗。 */
let injectedAfterInvalidationRequested: (() => void) | null = null;

export function __testing_setAfterInvalidationRequested(fn: (() => void) | null): void {
  injectedAfterInvalidationRequested = fn;
}

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
  defects?: readonly string[];
  fingerprint?: string;
  /** 人类可读的触发说明，进事件供排障 */
  detail: string;
  dryRun: boolean;
  passSnapshotMemory: AnchorMemory;
  emit: (event: Record<string, unknown>) => void;
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

  // 这条记录必须是失效事实的唯一落点：invalidated_phases/to_phase/reason 及交接上下文
  // 同时写入；后续缓存退位只是可重复副作用，不再有 pending/completed journal。
  input.emit({
    type: 'phase_backtrack_requested',
    phase: input.causePhase,
    to_phase: 'plan',
    reason: input.trigger,
    invalidated_phases: invalidatedPhases,
    // 保守恢复路**恒不产授权语义**——不冒充人工授权回退（对齐 goal-runner.ts:8155 惯例）
    authorized: false,
    detail: input.detail,
    files,
    defects: (input.defects ?? []).slice(0, 20),
    fingerprint: input.fingerprint ?? null,
    invalidation_tx_id: txId,
  });
  // 只用于子进程故障回放：record 已落盘即逻辑失效已生效，下面动作必须可重复。
  injectedAfterInvalidationRequested?.();

  if (!input.dryRun) {
    for (const phase of invalidatedPhases) input.passSnapshotMemory.delete(phase);
    discardPassSnapshotCache({
      projectRoot: input.projectRoot,
      feature: input.feature,
      runId: input.runId,
      phases: invalidatedPhases,
    });
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
  /** 授权成立（plan closure fresh——closure 即授权，无需内存锚） */
  | { kind: 'ok' }
  /** 授权不成立 / live 已漂移——**不得 spawn coding**，走 tryScopeReplan */
  | {
      kind: 'replan';
      reason: 'closure_untrusted' | 'live_drift';
      detail: string;
      affectedFiles: string[];
    };

/**
 * plan 授权检查。coding 阶段**两个边界各调用一次**，缺一不可：
 *
 * · **spawn 前**（`agent_invoke_start` 之前）——防"拿着证明不了的旧授权开工"；
 * · **agent 返回后、harness 之前**——防"本轮 agent 自己把 plan 产物改了"。
 *   两次调用同一个函数、同一条 `tryScopeReplan` 路由，**不另建检测器**。
 *
 * runner-owned-machine-facts 裁剪（codex 定案）后语义统一为一句话：
 * **授权 = 仓内 fresh 的 plan closure**。检查复用 recomputePhaseEvidenceStaleness
 * （与截断链 preflight / assess 同一把尺）：manifest 完整性 + 回执指针锚 + 冻结面
 * （plan.md / contracts.yaml 等 outputs∪inputs）逐文件哈希比对 + 环境重算——覆盖面
 * 较旧的 per-run 快照方案只多不少，且跨 run 稳定：fresh 的 --start coding 无需本 run
 * 快照即可开工；resume 语义相同（无内存态依赖）。pass snapshot 从此只承担同阶段
 * PASS 后 closure-only retry 的 TOCTOU 保护，与授权彻底解耦。
 *
 * 下面的历史注释保留背景（旧快照方案的动机与缺陷分析，均已被上述统一语义取代）：
 *
 * 为什么 spawn 前那次必须前移（三条事实，均已逐行核实）：
 * ① 既有 pre-spawn 可信加载读的是**当前 phase** 快照（goal-runner.ts:5795）——进 coding
 *    时它检 coding 快照，不检 plan scope 快照；
 * ② `passSnapshotMemory` 每进程新建（goal-runner.ts:5418），**resume 后恒空**；
 * ③ gate 的锚来自 `scopeAnchorEnv` → `memory.get('plan')`，取不到就不注入，gate 退回
 *    无锚行为会被视为缓存不可用并重建，不以凭据或弱信任放行。
 * 合起来即：**t4 的锚保护在 resume 后自然蒸发**。不前移的话，无可信 plan 授权的 resume
 * 会先跑完一轮 coding、再由 post-agent gate 发现问题——白烧一次 attempt，且 agent 在
 * 授权未确认时已经动过代码。
 *
 * 两条信任路径**收敛到同一次 loader 调用**：
 * · 同进程 → 传 `expectedAnchor`，loader 已内建「盘上消失/退位/换代即篡改」
 *   （pass-snapshot.ts:919-926），`kind='active'` 即锚已核对，无需另写比较；
 * · resume → `expectedAnchor` 为 null，按无内存锚读取 unsigned cache；内容或绑定异常
 *   直接判 cache miss，由责任阶段重跑。
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
 * 有 diff 时直接进入 replan：缓存只提供观察基线，不能把宿主旧字节写回；replan 会重出
 * plan 产物并由 runner 重新建立缓存。
 */
export function checkPlanAuthority(input: {
  projectRoot: string;
  feature: string;
  /** framework 根（gate 指纹重算口径）；缺省由 recompute 侧从 projectRoot 推导 */
  frameworkRoot?: string;
}): PlanAuthorityOutcome {
  // runner-owned-machine-facts 裁剪（codex 定案；宿主实锤 run 20260815T162931Z-3aa520）：
  // 授权唯一依据=仓内 fresh 的 **plan closure**（phase-evidence-manifest + 回执指针，
  // 跨 run 稳定）。per-run pass snapshot 只是同阶段 closure-retry 的 TOCTOU 缓存，
  // 不是授权载体——旧实现按当前 runId 查快照，跨 run 下游起点（--start coding）必得
  // kind=none → 无处回退 → halt，合法分段续跑结构性跑不通。
  // 复用 recomputePhaseEvidenceStaleness（与 assess/preflight 同一把尺）：
  //   fresh → ok（closure 即授权，live 冻结面逐文件哈希已由它比对）；
  //   stale → live_drift replan（changed_paths 即漂移面）；
  //   missing/tampered → closure_untrusted replan。
  const plan = recomputePhaseEvidenceStaleness(input.projectRoot, input.feature, ['plan'], {
    ...(input.frameworkRoot ? { frameworkRoot: input.frameworkRoot } : {}),
  })[0];
  if (!plan || plan.verdict === 'missing' || plan.verdict === 'tampered') {
    return {
      kind: 'replan',
      reason: 'closure_untrusted',
      detail:
        `plan closure 不可信（${plan?.verdict ?? 'unresolved'}` +
        (plan?.integrity_errors?.length ? `：${plan.integrity_errors.join('；')}` : '') +
        '）——证明不了授权，回 plan 重新闭环',
      affectedFiles: [],
    };
  }
  if (plan.verdict === 'stale') {
    // role=both 的条目（如 contracts.yaml）在 manifest.inputs 与 outputs 各有一份——去重
    const uniquePaths = [...new Set(plan.changed_paths)];
    const fileChanges = uniquePaths.filter((p) => !p.startsWith('<environment:'));
    const envChanges = uniquePaths.filter((p) => p.startsWith('<environment:'));
    return {
      kind: 'replan',
      reason: 'live_drift',
      detail:
        `plan closure 冻结面已偏离（${[...fileChanges, ...envChanges, ...(plan.receipt_changed ? ['<receipt>'] : [])].join('、')}）` +
        '——不在漂移的授权面上开工，回 plan 重新裁决',
      affectedFiles: fileChanges,
    };
  }
  return { kind: 'ok' };
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
 * 为什么两条路径都走它：跨 resume 的 `events.jsonl` 无凭据面、
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
