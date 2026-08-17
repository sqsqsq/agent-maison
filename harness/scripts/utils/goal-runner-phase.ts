/**
 * Goal-runner phase helpers — summary freshness, resume chain, event parsing (unit-testable).
 */

import * as fs from 'fs';
import * as path from 'path';
import { featurePhaseReportsDir, receiptFilePath } from '../../config';
import type { GoalPhaseOutcome } from './goal-report-generator';
import type {
  FeaturePhase,
  HarnessVerdict,
  PhaseVerdictAction,
} from './phase-transition-policy';
import { FEATURE_PHASE_ORDER } from './phase-transition-policy';

const FEATURE_PHASE_SET = new Set<string>(FEATURE_PHASE_ORDER);

export function getSummaryMtime(summaryPath: string | null): number | null {
  if (!summaryPath || !fs.existsSync(summaryPath)) return null;
  return fs.statSync(summaryPath).mtimeMs;
}

/** Summary is fresh when newly created or mtime advanced since phase start. */
export function isSummaryFresh(beforeMtime: number | null, afterMtime: number | null): boolean {
  if (afterMtime === null) return false;
  if (beforeMtime === null) return true;
  return afterMtime > beforeMtime;
}

export interface PhaseVerdictResolveInput {
  dryRun: boolean;
  agentExitCode: number;
  agentSkipped?: boolean;
  harnessExitCode: number;
  summaryBeforeMtime: number | null;
  summaryAfterMtime: number | null;
  summaryVerdict?: HarnessVerdict;
  /** When false (global/disabled phase), closure gate is skipped. Default true. */
  receiptRequired?: boolean;
  closureStatus?: string;
  receiptStatus?: string;
  agentTimedOut?: boolean;
  /**
   * t4（openspec device-readiness-and-completion）：本次 invocation 因**完成证据确定性
   * 成立**而由框架主动收口。收口走 tree-kill，必然产生非零退出码——若不在此排除，
   * `agent_failed` 会为真，上层就会按失败路径重试一个证据已完整的阶段（正是 07-28
   * 事故的放大链）。收口不是失败，故显式排除。
   */
  completionObserved?: boolean;
}

export interface PhaseVerdictResolveResult {
  verdict: HarnessVerdict;
  stale_summary: boolean;
  agent_failed: boolean;
  /** True when harness PASS but phase must not advance (open closure / timeout). */
  advance_blocked?: boolean;
  advance_block_reason?: 'closure_open' | 'receipt_missing' | 'agent_timeout_unclosed';
}

export type ClosureAdvanceBlockReason = 'closure_open' | 'receipt_missing' | 'agent_timeout_unclosed';

// ============================================================================
// P0-5（plan 7c4f2e9b，codex 四/五轮）：closure_kind 确定性分类——**不得从
// advance_block_reason 映射**（本文件 resolveClosureAdvanceBlock 中 agentTimedOut 先于
// receiptStatus 返回，会掩盖 receipt 真值；advance_block_reason 仅作 telemetry）。
// 分类是只读 receipt 探针（tryValidateReceipt）真值上的 **total function**
// （ReceiptValidation 五态全集，phase-state.ts:36）：
//   passed          → deterministic_recheck（runner 不调 agent，执行正式 sync-closure）
//   missing/failed  → receipt_repair_with_verifier（agent attempt，沿用完整 effective 预算）
//   error           → 立即 HALT closure_probe_error（探针自身崩溃=framework/toolchain 坏，
//                     调 agent「修 receipt」只会空转回潮）
//   not_applicable（且仍 advance_blocked）→ 立即 HALT closure_state_invariant
//                    （lite track 本不产生 receipt，走到此即 runner 状态机 bug）
// ============================================================================

export type ClosureRoute =
  | { kind: 'deterministic_recheck' }
  | { kind: 'receipt_repair_with_verifier' }
  | { kind: 'halt'; reason: 'closure_probe_error' | 'closure_state_invariant' };

/**
 * post-impl review P1#5：closure-only attempt 超时 → 直接 closure_timeout 求人，
 * **不回内容重试**（OpenSpec 明文）。verdict=PASS 的超时不在此拦（advance_blocked 分支
 * 走 closure 分类，deterministic 大概率直接关环推进——比 halt 更好）。
 */
export function shouldHaltClosureTimeout(
  isClosureOnlyAttempt: boolean,
  failureKind: string,
  verdict: string,
): boolean {
  return isClosureOnlyAttempt && failureKind === 'agent_timeout' && verdict !== 'PASS';
}

/**
 * round4 P1#3：deterministic sync-closure 结果的完整分流（纯函数，runner 消费 + 控制流
 * 矩阵测试）。核心契约：closure-only attempt 一旦超时，**任何非 advance 出路都不得回
 * 内容重试**——sync 成功→advance；sync 失败+已超时→closure_timeout；sync 失败+未超时
 * →回落 repair（下一 attempt 仍是 closure 语境）。
 */
export function resolveClosureSyncOutcome(
  syncExitCode: number,
  isClosureOnlyAttempt: boolean,
  timedOut: boolean,
): 'advance' | 'closure_timeout' | 'repair_retry' {
  if (syncExitCode === 0) return 'advance';
  if (isClosureOnlyAttempt && timedOut) return 'closure_timeout';
  return 'repair_retry';
}

export function classifyClosureKind(
  probeStatus: 'passed' | 'failed' | 'missing' | 'error' | 'not_applicable',
): ClosureRoute {
  switch (probeStatus) {
    case 'passed':
      return { kind: 'deterministic_recheck' };
    case 'missing':
    case 'failed':
      return { kind: 'receipt_repair_with_verifier' };
    case 'error':
      return { kind: 'halt', reason: 'closure_probe_error' };
    case 'not_applicable':
      return { kind: 'halt', reason: 'closure_state_invariant' };
  }
}

/** Block goal advance when script PASS but receipt/closure incomplete or agent timed out unclosed. */
export function resolveClosureAdvanceBlock(input: {
  verdict: HarnessVerdict;
  receiptRequired?: boolean;
  closureStatus?: string;
  receiptStatus?: string;
  agentTimedOut?: boolean;
}): { blocked: boolean; reason?: ClosureAdvanceBlockReason } {
  if (input.verdict !== 'PASS') return { blocked: false };
  if (input.receiptRequired === false) return { blocked: false };
  if (input.closureStatus === 'closed') return { blocked: false };
  if (input.agentTimedOut) {
    return { blocked: true, reason: 'agent_timeout_unclosed' };
  }
  if (input.receiptStatus === 'missing') {
    return { blocked: true, reason: 'receipt_missing' };
  }
  return { blocked: true, reason: 'closure_open' };
}

/**
 * Resolve harness verdict for a phase run. Rejects stale on-disk summary.json
 * when agent/harness did not produce a fresh artifact.
 */
export function resolvePhaseHarnessVerdict(input: PhaseVerdictResolveInput): PhaseVerdictResolveResult {
  const fresh = isSummaryFresh(input.summaryBeforeMtime, input.summaryAfterMtime);
  // t4：完成观测收口的非零退出码由**框架自己的 tree-kill** 造成，不是 agent 失败
  const agentFailed =
    !input.agentSkipped && input.agentExitCode !== 0 && input.completionObserved !== true;

  if (input.dryRun) {
    const verdict = (input.summaryVerdict ?? 'PASS') as HarnessVerdict;
    return { verdict, stale_summary: false, agent_failed: false };
  }

  // Gate on fresh summary artifact — agent exit/timeout is observability only (cursor adapter norm).
  if (fresh && input.summaryVerdict) {
    const closureBlock = resolveClosureAdvanceBlock({
      verdict: input.summaryVerdict,
      receiptRequired: input.receiptRequired,
      closureStatus: input.closureStatus,
      receiptStatus: input.receiptStatus,
      agentTimedOut: input.agentTimedOut,
    });
    return {
      verdict: input.summaryVerdict,
      stale_summary: false,
      agent_failed: agentFailed,
      advance_blocked: closureBlock.blocked,
      advance_block_reason: closureBlock.reason,
    };
  }

  if (fresh && !input.summaryVerdict) {
    return { verdict: 'FAIL', stale_summary: false, agent_failed: agentFailed };
  }

  const stale = input.summaryAfterMtime !== null && !fresh;
  if (stale || input.harnessExitCode !== 0 || input.summaryAfterMtime === null) {
    return { verdict: 'FAIL', stale_summary: stale, agent_failed: agentFailed };
  }

  return { verdict: 'FAIL', stale_summary: false, agent_failed: agentFailed };
}

export interface GoalRunEvent {
  ts?: string;
  type?: string;
  phase?: string;
  action?: PhaseVerdictAction;
  verdict?: string;
  status?: string;
  blocking_class?: string;
  failure_kind?: string;
  failure_kind_classified?: string;
  /** E4：跨 attempt 累计统计（events.jsonl 回放，非内存计数）用——phase_verdict 已带的字段。 */
  blocker_signature?: string;
  halt_reason?: string;
  /** P0-5（plan d9b4f7e2）：framework_integrity_block 的多值 subtype（全 blocker 收集去重）。 */
  integrity_subtypes?: string[];
  advance_blocked?: boolean;
  advance_block_reason?: string;
  /** P0-3（plan 7c4f2e9b）：phase_invalidated 事件的事务锚——按 (tx_id, phase) 幂等，
   * 恢复资格 SSOT 在 trust-state journal，事件仅审计投影。 */
  invalidation_tx_id?: string;
  /** P1-6（plan 7c4f2e9b）：四轴时间线 artifact delta 轴（changed/unchanged；restored 由
   * pass_snapshot_restored 事件承载） */
  artifact_delta?: string;
  exit_code?: number;
  duration_ms?: number;
  timed_out?: boolean;
  /** P0-4（plan d9b4f7e2）：本 attempt 的有效超时（钳制/升档后）——timeout 单一事实源，
   * progress/status/dead-man 优先读本字段，manifest 解析仅旧日志 fallback。 */
  effective_timeout_ms?: number;
  /** P1-7：kill 诊断（agent_invoke_end）——runner 永不写 agent-output.log，诊断走事件。 */
  kill_reason?: string;
  output_bytes?: number;
  output_delivery?: string;
  /** P1-7：adapter 版本运行时探测（adapter_probe 事件；探测失败记 unknown 不阻塞）。 */
  adapter_version?: string;
  /** plan a8e5c3f9 t6：adapter_probe 事件带 effective 权限——旧 manifest 原文（如
   * workspace-write）不再反映实际执行权限，审计以本字段为准。 */
  effective_write_mode?: string;
  effective_approval_mode?: string;
  silent_killed?: boolean;
  lingering_pipe?: boolean;
  recovered?: boolean;
  /** agent_invoke_end 既有字段（dry-run invoke 写 true；"证据齐全即跳过"机制已删）。 */
  skipped?: boolean;
  invoke_id?: string;
  invoke_start_ts?: string;
  chain?: string[];
  attempt?: number;
  substep?: string;
  start_index?: number;
  start_phase?: string;
  /** t1（f7a3d9c2）：visual_round 事件字段——runner 把账本回执写入 events 做 integrity 对账 */
  loop_id?: string;
  visual_attempt?: string;
  row_hash?: string;
  disposition?: string;
  fused?: boolean;
}

export interface ResumedBudget {
  totalTurns: number;
  wallClockStartMs: number;
  /** plan e7c2a4d8 T2：历史活跃时长（Σ authoritative 段；崩溃段保守补收一个心跳周期）。 */
  priorActiveMs: number;
  /** 首个非 dry 段起点（sinceMs 消费面真实时间线；无 authoritative 段 → null）。 */
  firstAuthoritativeStartMs: number | null;
}

/** Count agent attempts from events (new start/end + legacy agent_invoke). */
export function countAgentInvokeStarts(events: GoalRunEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.type === 'agent_invoke_start') n++;
    else if (e.type === 'agent_invoke') n++;
  }
  return n;
}

// ============================================================================
// plan e7c2a4d8 T2：执行会话分段（wall-clock 预算改「活跃时间」的唯一真值来源）。
// 事实基础（codex 二轮确认 + 4035d4 实测）：run_start 每次进程启动无条件追加（含
// resume 会话）；heartbeat 事件 60s cadence 是持久化活跃检查点。
// ============================================================================

/** 与 goal-runner LOCK_HEARTBEAT_MS 同值（崩溃段保守补收周期；单独导出避免循环依赖）。 */
export const SESSION_HEARTBEAT_MS = 60_000;

export interface ExecutionSession {
  /** 段首事件下标（含） */
  startIndex: number;
  /** 段尾事件下标（含） */
  endIndex: number;
  startMs: number;
  /** 段时长（崩溃段=min(下一段首, 段内最大 ts + 心跳周期) − 段首；恒 ≥0） */
  activeMs: number;
  /** 段内是否有 run_end（无 = 崩溃/hard-kill 段，已保守补收） */
  clean: boolean;
  mode: 'dry' | 'authoritative';
}

export interface PartitionedSessions {
  sessions: ExecutionSession[];
  /** 仅 authoritative 段的事件（legacy 混写文件的权威消费面视图） */
  authoritativeEvents: GoalRunEvent[];
  /** Σ authoritative 段 activeMs */
  priorActiveMs: number;
  /** 仅 authoritative 段的 agent invoke 计数（修 dry 幻影 turn） */
  totalTurns: number;
  firstAuthoritativeStartMs: number | null;
}

function eventTsMs(e: GoalRunEvent): number | null {
  if (!e.ts) return null;
  const t = new Date(e.ts).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 按 run_start 切会话段（防御性容错：文件不以 run_start 开头的孤儿前缀以首个
 * resume/首事件兜底为段首）。段尾=本段 run_end；无 run_end 的段（崩溃/hard-kill）
 * 保守补收：end = min(下一段首 ts, 段内最大事件 ts + SESSION_HEARTBEAT_MS)——
 * 误差方向=多计 ≤1 心跳间隔（安全方向，预算只会更快耗尽，累计漏算为零）。
 * 段 mode：段首 run_start.dry_run===true 或段内全事件携 dry_run:true → dry。
 * 时间异常（乱序/回拨导致负时长）保守钳 0，不判负。
 */
export function partitionExecutionSessions(
  events: GoalRunEvent[],
  opts?: {
    /** codex 五轮 P1-②：resume 边界——priorEvents 里最后一个未闭合历史段的补收上界
     * （=当前进程 sessionStartMs），防与当前段（elapsed 另行承载）重复计时。 */
    tailCapMs?: number;
  },
): PartitionedSessions {
  const sessions: ExecutionSession[] = [];
  const starts: number[] = [];
  events.forEach((e, i) => {
    if (e.type === 'run_start') starts.push(i);
  });
  if (starts.length === 0 && events.length > 0) starts.push(0); // 孤儿前缀兜底
  for (let s = 0; s < starts.length; s++) {
    const startIndex = starts[s];
    const nextStartIndex = s + 1 < starts.length ? starts[s + 1] : events.length;
    const endIndex = nextStartIndex - 1;
    const seg = events.slice(startIndex, nextStartIndex);
    const startMs = eventTsMs(events[startIndex]) ?? NaN;
    const runEnd = seg.find((e) => e.type === 'run_end');
    let maxTs = Number.isNaN(startMs) ? 0 : startMs;
    for (const e of seg) {
      const t = eventTsMs(e);
      if (t !== null && t > maxTs) maxTs = t;
    }
    let endMs: number;
    let clean = false;
    if (runEnd) {
      endMs = eventTsMs(runEnd) ?? maxTs;
      clean = true;
    } else {
      // 崩溃段保守补收一个心跳周期，nextSessionStart/tailCap 截断防与后段重叠。
      const credited = maxTs + SESSION_HEARTBEAT_MS;
      const nextStartMs = nextStartIndex < events.length ? eventTsMs(events[nextStartIndex]) : null;
      const cap = nextStartMs ?? opts?.tailCapMs ?? null;
      endMs = cap !== null ? Math.min(cap, credited) : credited;
    }
    const startEvent = events[startIndex] as { dry_run?: unknown };
    const isDry =
      (events[startIndex].type === 'run_start' && startEvent.dry_run === true) ||
      (seg.length > 0 && seg.every((e) => (e as { dry_run?: unknown }).dry_run === true));
    const activeMs = Number.isNaN(startMs) ? 0 : Math.max(0, endMs - startMs);
    sessions.push({
      startIndex, endIndex, startMs: Number.isNaN(startMs) ? 0 : startMs, activeMs, clean,
      mode: isDry ? 'dry' : 'authoritative',
    });
  }
  const authSessions = sessions.filter((x) => x.mode === 'authoritative');
  const authoritativeEvents: GoalRunEvent[] = [];
  for (const x of authSessions) authoritativeEvents.push(...events.slice(x.startIndex, x.endIndex + 1));
  return {
    sessions,
    authoritativeEvents,
    priorActiveMs: authSessions.reduce((acc, x) => acc + x.activeMs, 0),
    totalTurns: countAgentInvokeStarts(authoritativeEvents),
    firstAuthoritativeStartMs: authSessions.length > 0 ? authSessions[0].startMs : null,
  };
}

/**
 * t1/rev6（f7a3d9c2）+ review-fix（cursor Critical）：events 回放——账本行期望 hash 集。
 * **含 duplicate**：主路径是"agent 自跑 harness append → 外层 gate 撞同 round_key 得
 * duplicate"，events 里只会出现 duplicate 事件，但其 row_hash 就是那条账本行——只收
 * appended 会让期望集恒空、整段 integrity 空转（删账本绕 fuse 不再被拦）。
 * append_failed 无 row_hash，天然不入期望。
 */
export function collectVisualRoundRowHashes(events: GoalRunEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type === 'visual_round' && typeof e.row_hash === 'string' && e.row_hash) {
      out.push(e.row_hash);
    }
  }
  return [...new Set(out)];
}

/**
 * t1/rev6 + review-fix（codex P1-1，两轮收窄）：pending 行可收养的 attempt id——
 * ①仅 **testing 阶段**的 invocation（spec/coding 等永不产 visual_round，入围会让其
 * attempt 永久 pending、孤儿行可借名永续）；②仅"已 start、未 commit"（无对应
 * visual_round 事件——含 reconciliation 收养后补写的 recovery 事件）；③仅**最后一个**
 * 这样的 invocation（更早的未闭合 invocation 由上一次对账收养并补写 recovery 关闭；
 * 若因故未关，其行按 orphan 拦下求人，不再默认收养）。
 */
export function collectUncommittedVisualAttemptIds(events: GoalRunEvent[]): string[] {
  const startedTesting: string[] = [];
  const committed = new Set<string>();
  for (const e of events) {
    if (e.type === 'agent_invoke_start' && e.phase === 'testing' && typeof e.invoke_id === 'string') {
      const m = e.invoke_id.match(/-(i\d+)$/);
      if (m) startedTesting.push(m[1]);
    }
    if (e.type === 'visual_round' && typeof e.visual_attempt === 'string' && e.visual_attempt) {
      committed.add(e.visual_attempt);
    }
  }
  const uncommitted = startedTesting.filter(id => !committed.has(id));
  return uncommitted.length > 0 ? [uncommitted[uncommitted.length - 1]] : [];
}

/**
 * P0-D：本 phase 已消耗的 API 断流重试次数——从 events.jsonl 派生，**非内存变量**。
 * 否则 continue/--resume 后计数清零，回到"每次续几秒又断又重试"的老坑；跨 resume
 * 不清零是有意为之（断流反复出现=网络仍不稳，早 halt 让人查，上限可调）。
 */
export function countTransientApiRetries(events: GoalRunEvent[], phase: FeaturePhase): number {
  let n = 0;
  for (const e of events) {
    if (e.type === 'transient_api_retry_scheduled' && e.phase === phase) n++;
  }
  return n;
}

/**
 * P0-D（codex P1）：本 phase 最近一次 phase_verdict 是否 transient_api_error——跨进程
 * --resume 首轮恢复"上轮断流"续作语义。内存变量 priorAttemptApiError 在新进程必然
 * false，若不恢复：prompt 归因错向 deterministic（"修 blocker"）、partial 续作块打不开。
 */
export function lastPhaseVerdictTransientApiError(
  events: GoalRunEvent[],
  phase: FeaturePhase,
): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'phase_verdict' || e.phase !== phase) continue;
    return e.failure_kind_classified === 'transient_api_error';
  }
  return false;
}

// 【已删除 · pass snapshot 退役】responsibilityRerunPending（"缓存失效后重跑责任阶段"
// 待办态）：其唯一置位源 phase_halt(pass_snapshot_unavailable) 已不再产生。

/**
 * E4（案B chrys 银行卡实证：8 attempt/4h19m，advance_blocked 两次分别以不同 reason
 * 出现——closure_open 类走 max_retries_per_phase 兜底但慢，agent_timeout_unclosed 类
 * 曾**无任何上限**、真无限重试）。从 events.jsonl 回放统计本 phase 累计 advance_blocked
 * 次数（跨 attempt，非内存计数——resume/detach 重启不丢），不看具体 reason：script 门禁
 * 反复"PASS 却关不了环"本身就是这个 phase 结构性关不了环的信号，与具体原因无关。
 */
export function countCumulativeAdvanceBlocked(
  events: GoalRunEvent[],
  phase: FeaturePhase,
): number {
  let n = 0;
  for (const e of events) {
    if (e.type !== 'phase_verdict' || e.phase !== phase) continue;
    if (e.advance_blocked) n++;
  }
  return n;
}

/**
 * E4：同一 blocker_signature 在给定 failure_kind 家族内跨 attempt **累计**（非仅连续）出现
 * 次数——basis for CUMULATIVE_HALT_FAMILY（toolchain/await_human_confirm 等）反复出现却被
 * 其他产物变化"冲淡"掩盖（spec.md 内容每轮在变 ≠ 这个具体 blocker 真的在改善）。
 */
export function countRepeatedSignatureInFamily(
  events: GoalRunEvent[],
  phase: FeaturePhase,
  signature: string,
  family: ReadonlySet<string>,
): number {
  if (!signature) return 0;
  let n = 0;
  for (const e of events) {
    if (e.type !== 'phase_verdict' || e.phase !== phase) continue;
    if (e.blocker_signature !== signature) continue;
    if (!e.failure_kind_classified || !family.has(e.failure_kind_classified)) continue;
    n++;
  }
  return n;
}

/**
 * P0-D §六-8（codex P2）：0 字节空产出判定。`duration_ms != null` 是关键前置——
 * invokeAgentHeadless 的 binary 不可 spawn 短路路径返回 {exitCode:1, stderr:诊断}
 * 但**无 duration_ms 也不写 output log**，若不排除会被误吞成 agent_no_output、
 * 真实 preflight 诊断（stderr）被丢。
 */
export function isAgentNoOutputSignal(
  invoke: {
    exitCode: number;
    duration_ms?: number;
    timed_out?: boolean;
    silent_killed?: boolean;
    skipped?: boolean;
  },
  outputLogBytes: number,
  maxDurationMs: number,
): boolean {
  return (
    !invoke.timed_out &&
    !invoke.silent_killed &&
    !invoke.skipped &&
    invoke.duration_ms != null &&
    invoke.duration_ms < maxDurationMs &&
    outputLogBytes === 0 &&
    invoke.exitCode !== 0
  );
}

/** First run_start timestamp as wall-clock baseline (ms since epoch). */
export function resolveWallClockStartMs(events: GoalRunEvent[]): number {
  for (const e of events) {
    if (e.type === 'run_start' && e.ts) {
      const t = new Date(e.ts).getTime();
      if (!Number.isNaN(t)) return t;
    }
  }
  return Date.now();
}

/** 从 events 提取 supersede 链的直接目标（audited supersede 事件才算，自报不生效）。 */
export function extractSupersedeTargets(events: GoalRunEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const t = (e as { type?: string; target_run_id?: unknown });
    if (t.type === 'supersede' && typeof t.target_run_id === 'string' && t.target_run_id.trim()) {
      out.push(t.target_run_id.trim());
    }
  }
  return out;
}

/**
 * T1④（e5d8a2c4）：沿 supersede 链折叠**祖先 run 的 events**——仅供预算 reducer
 * 消费（totalTurns / priorActiveMs / wall 起点 / 回退计数 / transient retry）。
 *
 * 硬约束语义：**supersede 不得刷新任何预算**。预算是 per-run 从各自 events 回放的，
 * 新 run_id 即清零——不折叠的话，"废弃旧 run 开后继"就是绕过
 * DEFAULT_MAX_BACKTRACKS 与 wall 熔断的无限循环通道（plan 判读 v3 教训原文）。
 *
 * 边界：
 * - **阶段完成状态不折叠**（resolveResumeState 只吃当前 run——预算跨 run 折叠、
 *   进度不跨 run 折叠，语义不同，plan T1④ 原文）；
 * - 递归祖先的祖先（链式 supersede），`visited` 防环；目标 events 缺失＝跳过
 *   （被清理的历史 run 不阻断新 run——只损失其预算记账，如实少算不如拒启）；
 * - 返回按 ts 升序（祖先在前），供 `resolveWallClockStartMs` 取最早 run_start。
 */
export function collectSupersededAncestorEvents(opts: {
  projectRoot: string;
  featuresDir: string;
  feature: string;
  seedTargets: string[];
  /** 注入供测试；缺省读盘（authoritative 口径——dry 段照常剔除） */
  loadEvents?: (absPath: string) => GoalRunEvent[];
}): GoalRunEvent[] {
  const load = opts.loadEvents ?? loadAuthoritativeEvents;
  const visited = new Set<string>();
  const chainEvents: GoalRunEvent[] = [];
  const queue = [...opts.seedTargets];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || visited.has(id)) continue;
    visited.add(id);
    const abs = path.join(
      opts.projectRoot, opts.featuresDir, opts.feature, 'goal-runs', id, 'events.jsonl');
    const evs = load(abs);
    chainEvents.push(...evs);
    queue.push(...extractSupersedeTargets(evs));
  }
  return chainEvents.sort((a, b) => String(a.ts ?? '').localeCompare(String(b.ts ?? '')));
}

export function resolveResumedBudget(
  events: GoalRunEvent[],
  opts?: {
    /** 当前进程会话起点（codex 五轮 P1-②）：仅作最后一个未闭合历史段补收的 min 上界，
     * **不创建、不计入当前段**（当前段由 elapsed = priorActiveMs + (now − sessionStart)
     * 在 goal-runner 侧承载）。 */
    nextSessionStartMs?: number;
  },
): ResumedBudget {
  const p = partitionExecutionSessions(events, { tailCapMs: opts?.nextSessionStartMs });
  return {
    // plan e7c2a4d8 T2：turns 只计 authoritative 段（修 dry 幻影 invoke——宿主 ut-i3 现象）。
    totalTurns: p.totalTurns,
    wallClockStartMs: resolveWallClockStartMs(events),
    priorActiveMs: p.priorActiveMs,
    firstAuthoritativeStartMs: p.firstAuthoritativeStartMs,
  };
}

export interface ResumeGuardInput {
  priorStatus?: string;
  lastRunEndTs?: string;
  forceResume?: boolean;
  cooldownMinutes?: number;
  /** Optional: summary mtime advanced after last run_end with changed blocking classification. */
  blockingCleared?: boolean;
}

export interface ResumeGuardResult {
  allowed: boolean;
  reason?: string;
}

const TERMINAL_STATUSES = new Set(['HALTED', 'DEFERRED']);

/**
 * Conservative resume guard — default refuse HALTED/DEFERRED unless --force-resume
 * or blocking classification demonstrably changed after last run_end.
 */
export function checkTerminalResumeGuard(input: ResumeGuardInput): ResumeGuardResult {
  const status = input.priorStatus;

  // Non-terminal prior runs (COMPLETED/PARTIAL/unknown) are not subject to terminal debounce.
  if (!status || !TERMINAL_STATUSES.has(status)) return { allowed: true };

  const cooldownMin = input.cooldownMinutes ?? 5;
  if (input.lastRunEndTs) {
    const endMs = new Date(input.lastRunEndTs).getTime();
    if (!Number.isNaN(endMs)) {
      const elapsed = Date.now() - endMs;
      const cooldownMs = cooldownMin * 60 * 1000;
      if (elapsed < cooldownMs) {
        return {
          allowed: false,
          reason: `resume cooldown: wait ${Math.ceil((cooldownMs - elapsed) / 1000)}s after run_end (${status})`,
        };
      }
    }
  }

  if (input.blockingCleared) return { allowed: true };
  if (input.forceResume) return { allowed: true };

  return {
    allowed: false,
    reason: `last run status ${status}; pass --force-resume to continue`,
  };
}

export function findLastRunEnd(events: GoalRunEvent[]): GoalRunEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'run_end') return events[i];
  }
  return undefined;
}

/** Last run_end not superseded by a later run_start or resume (projection SSOT). */
export function resolveEffectiveRunEnd(events: GoalRunEvent[]): GoalRunEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type !== 'run_end') continue;
    const superseded = events
      .slice(i + 1)
      .some((e) => e.type === 'run_start' || e.type === 'resume');
    if (!superseded) return events[i];
  }
  return undefined;
}

/** Check run budget before each phase attempt (turns + wall clock). */
export function checkRunBudget(
  totalTurns: number,
  maxTotalTurns: number,
  elapsedMs: number,
  wallClockMs: number,
): 'ok' | 'wall_clock' | 'turns' {
  if (elapsedMs > wallClockMs) return 'wall_clock';
  if (totalTurns >= maxTotalTurns) return 'turns';
  return 'ok';
}

/**
 * Rebuild terminal phase outcomes from events.jsonl (when goal-report.json is missing).
 * Ignores non-terminal `retry` verdicts; orders by chain.
 */
export function rebuildOutcomesFromEvents(
  events: GoalRunEvent[],
  chain: FeaturePhase[],
): GoalPhaseOutcome[] {
  const lastTerminal = new Map<FeaturePhase, GoalRunEvent>();
  // plan e7c2a4d8 T4b（codex 二轮 P1-4）：phase_halt 覆盖同 phase 在先的 provisional
  // phase_verdict——goal-report.json 缺失走 events-only 重建时，已 HALT 的 phase 不得
  // 被重建成合法 PASS（resume 会跳过它）；halt_reason/halt_guidance 一并保留。
  const lastHalt = new Map<FeaturePhase, GoalRunEvent>();
  for (const e of events) {
    if (!e.phase || !FEATURE_PHASE_SET.has(e.phase)) continue;
    if (e.type === 'phase_halt') {
      lastHalt.set(e.phase as FeaturePhase, e);
      continue;
    }
    if (e.type !== 'phase_verdict') continue;
    if (e.action === 'retry') continue;
    lastTerminal.set(e.phase as FeaturePhase, e);
    // verdict 晚于 halt（回退重跑后重新裁决）→ halt 不再覆盖
    lastHalt.delete(e.phase as FeaturePhase);
  }

  const outcomes: GoalPhaseOutcome[] = [];
  for (const phase of chain) {
    const halt = lastHalt.get(phase);
    if (halt) {
      const h = halt as { verdict?: string; halt_reason?: string; halt_guidance?: string };
      outcomes.push({
        phase,
        verdict: (h.verdict ?? 'FAIL') as string,
        halted: true,
        ...(h.halt_reason ? { halt_reason: h.halt_reason } : {}),
        ...(h.halt_guidance ? { halt_guidance: h.halt_guidance } : {}),
      });
      break;
    }
    const e = lastTerminal.get(phase);
    if (!e) break;

    const verdict = (e.verdict ?? 'FAIL') as string;
    if (e.action === 'advance') {
      outcomes.push({ phase, verdict });
      continue;
    }
    if (
      e.action === 'defer_external_and_continue_if_allowed' ||
      e.action === 'defer_external_and_halt'
    ) {
      outcomes.push({
        phase,
        verdict,
        deferred: true,
        deferred_reason: 'external_blocked',
      });
      continue;
    }
    if (e.action === 'halt') {
      outcomes.push({ phase, verdict, halted: true });
      break;
    }
    break;
  }
  return outcomes;
}

/** Resume state from events when goal-report.json is absent. */
export function resolveResumeFromEvents(
  chain: FeaturePhase[],
  events: GoalRunEvent[],
): ResumeState {
  const priorOutcomes = rebuildOutcomesFromEvents(events, chain);
  return resolveResumeState(chain, priorOutcomes);
}

/** Phases finished (PASS advance or DEFERRED) from events.jsonl. */
export function parseCompletedPhasesFromEvents(events: GoalRunEvent[]): Set<FeaturePhase> {
  const done = new Set<FeaturePhase>();
  for (const e of events) {
    if (e.type !== 'phase_verdict' || !e.phase || !FEATURE_PHASE_SET.has(e.phase)) continue;
    if (
      e.action === 'advance' ||
      e.action === 'defer_external_and_continue_if_allowed' ||
      e.action === 'defer_external_and_halt'
    ) {
      done.add(e.phase as FeaturePhase);
    }
  }
  return done;
}

export function loadEventsJsonl(absPath: string): GoalRunEvent[] {
  if (!fs.existsSync(absPath)) return [];
  const lines = fs.readFileSync(absPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const out: GoalRunEvent[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as GoalRunEvent);
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/** plan e7c2a4d8 T1c：权威消费面视图——按会话段剔除 dry-run 段（.dry 隔离后新文件
 * 天然纯净；本过滤专治 legacy 混写文件如宿主 ut2test 形态）。凡从 events 派生权威
 * 状态（预算/重试计数/棘轮/resume 重建/对账期望集）一律走本口径；纯审计/展示读取
 * 显式用 loadEventsJsonl 并注明。 */
export function filterAuthoritativeEvents(events: GoalRunEvent[]): GoalRunEvent[] {
  return partitionExecutionSessions(events).authoritativeEvents;
}

export function loadAuthoritativeEvents(absPath: string): GoalRunEvent[] {
  return filterAuthoritativeEvents(loadEventsJsonl(absPath));
}

export interface ResumeState {
  priorOutcomes: GoalPhaseOutcome[];
  startIndex: number;
  deferredUpstream: Array<{ phase: FeaturePhase; reason: string }>;
}

/**
 * Determine resume index and rehydrate prior outcomes from goal-report or events.
 */
export function resolveResumeState(
  chain: FeaturePhase[],
  priorOutcomes: GoalPhaseOutcome[],
): ResumeState {
  const deferredUpstream = priorOutcomes
    .filter((o) => o.deferred)
    .map((o) => ({
      phase: o.phase,
      reason: o.deferred_reason ?? 'external_blocked',
    }));

  if (priorOutcomes.length === 0) {
    return { priorOutcomes: [], startIndex: 0, deferredUpstream: [] };
  }

  const last = priorOutcomes[priorOutcomes.length - 1];
  if (last.halted) {
    const idx = chain.indexOf(last.phase);
    return {
      priorOutcomes: priorOutcomes.slice(0, -1),
      startIndex: idx >= 0 ? idx : 0,
      deferredUpstream,
    };
  }

  // e5d8a2c4 步骤 3（垂直恢复闭环）：**最早一个尚未完成的 `WAITING(external)` phase
  // 必须重新入队**。fa0663 实锤：设备停放的 outcome 是 `{verdict:'FAIL', halted:false,
  // run_disposition:'WAITING', run_wait_kind:'external'}`——旧逻辑把它计入 done，
  // resume `start_index=链长` 直接收口，停放话术承诺的"设备就绪后 --resume 继续"
  // 永不发生（同一 run 恒 PARTIAL 的吸收态）。判据**消费既有投影字段**（写盘层对每条
  // phase_halt 都落了 run_disposition/run_wait_kind，报告 phases 原样携带）；`halted`
  // 只表示"当前会话是否停止推进"（设备门仅 AMBIGUOUS 置 true），不是跨 run 完成判据。
  const isUnfinishedExternalWait = (o: GoalPhaseOutcome): boolean =>
    o.run_disposition === 'WAITING' && o.run_wait_kind === 'external';
  const firstWaitingIdx = chain.findIndex((p) =>
    priorOutcomes.some((o) => o.phase === p && isUnfinishedExternalWait(o)));
  if (firstWaitingIdx >= 0) {
    // codex 第九批 P0 订正（前缀规则）：从 phase k 重跑，**只保留严格位于 k 之前的
    // outcome**——初版只删后缀中的 WAITING、保留下游旧 PASS，会让重跑后的链把
    // 过期 PASS 当完成态；deferredUpstream 同理**从保留前缀重算**（初版沿用全量，
    // 会把正在重试的 phase 的旧 deferred 记录带进新一轮）。
    const prefix = priorOutcomes.filter((o) => {
      const i = chain.indexOf(o.phase);
      return i >= 0 && i < firstWaitingIdx;
    });
    return {
      priorOutcomes: prefix,
      startIndex: firstWaitingIdx,
      deferredUpstream: prefix
        .filter((o) => o.deferred)
        .map((o) => ({ phase: o.phase, reason: o.deferred_reason ?? 'external_blocked' })),
    };
  }

  const done = new Set(priorOutcomes.map((o) => o.phase));
  let startIndex = chain.length;
  for (let i = 0; i < chain.length; i++) {
    if (!done.has(chain[i])) {
      startIndex = i;
      break;
    }
  }

  return { priorOutcomes, startIndex, deferredUpstream };
}

export interface PhaseSummaryPassReceipt {
  verdict: string;
  receipt_status?: string;
  closure_status?: string;
  mtimeMs: number;
}

/** Read on-disk phase summary + receipt closure fields for half-phase recovery. */
export function readPhaseSummaryPassReceipt(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
): PhaseSummaryPassReceipt | null {
  const dir = featurePhaseReportsDir(projectRoot, feature, phase);
  const summaryPath = path.join(dir, 'summary.json');
  if (!fs.existsSync(summaryPath)) return null;
  try {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as {
      verdict?: string;
      receipt_status?: string;
      closure_status?: string;
    };
    return {
      verdict: summary.verdict ?? '',
      receipt_status: summary.receipt_status,
      closure_status: summary.closure_status,
      mtimeMs: fs.statSync(summaryPath).mtimeMs,
    };
  } catch {
    return null;
  }
}

/**
 * P0-4（plan d9b4f7e2）：同 phase **连续** agent_timeout 次数（自最近一次非超时 verdict
 * 起算，含 PASS+unclosed 型）。签名无关——07-13 chrys 案 i1/i2/i4/i5 FAIL 签名互异，
 * 签名基熔断 6 连超时零命中。events.jsonl 回放（SSOT，resume/detach 重启不丢）。
 */
export function countConsecutiveAgentTimeouts(events: GoalRunEvent[], phase: string): number {
  let n = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'phase_verdict' || e.phase !== phase) continue;
    if (e.failure_kind_classified === 'agent_timeout') {
      n++;
    } else {
      break;
    }
  }
  return n;
}

/** P0-4：最近一次 agent_invoke_start 的 effective_timeout_ms（timeout 单一事实源消费端）。 */
export function findLatestEffectiveTimeoutMs(
  events: GoalRunEvent[],
  phase: string | null,
): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'agent_invoke_start') continue;
    if (phase && e.phase !== phase) continue;
    return typeof e.effective_timeout_ms === 'number' && e.effective_timeout_ms > 0
      ? e.effective_timeout_ms
      : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// P0-1（plan d9b4f7e2 rev6）：continuation 五态 attempt 窗口
// ---------------------------------------------------------------------------

export type ContinuationCause =
  | 'agent_timeout'
  | 'transient_api_error'
  | 'content_retry'
  | 'unknown';

/**
 * 跨进程（--resume）continuation cause 派生——收敛到"当前 phase **最近一次** attempt
 * 窗口"，不做全 phase 历史按超时优先扫描（旧 timeout 不得盖过更新的 content failure）。
 * 五态（rev6 定稿，真实事件序 invoke_start → invoke_end → harness_start/end → phase_verdict）：
 *   1. 无任何 agent_invoke_start           → null（全新 phase，不注入任何续作块）
 *   2. 有 start、无 end                    → unknown（崩于 agent 段）
 *   3. end.timed_out=true、无 verdict      → agent_timeout（真因已在 end 事件里，不丢成 unknown）
 *   4. end 正常、无 verdict                → unknown（崩于 harness/verdict 段）
 *   5. 有 verdict                          → 用该 verdict 的 failure_kind_classified
 * invoke_id 精确配对优先；旧日志无 invoke_id 时按事件顺序分窗 fallback（verdict 窗口在
 * end 之后、下一 start 之前）。
 */
export function deriveContinuationFromEvents(
  events: GoalRunEvent[],
  phase: string,
): { cause: ContinuationCause; failureKind?: string } | null {
  let startIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === 'agent_invoke_start' && e.phase === phase) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return null;
  const start = events[startIdx];

  let end: GoalRunEvent | null = null;
  let endIdx = -1;
  for (let i = startIdx + 1; i < events.length; i++) {
    const e = events[i];
    if (e.type !== 'agent_invoke_end' || e.phase !== phase) continue;
    if (start.invoke_id && e.invoke_id && e.invoke_id !== start.invoke_id) continue;
    end = e;
    endIdx = i;
    break;
  }
  if (!end) return { cause: 'unknown' };

  for (let i = endIdx + 1; i < events.length; i++) {
    const e = events[i];
    // 防御：撞到下一 attempt 的 start 即关窗（正常不会发生——startIdx 已是最后一个 start）。
    if (e.type === 'agent_invoke_start' && e.phase === phase) break;
    if (e.type !== 'phase_verdict' || e.phase !== phase) continue;
    if (e.invoke_id && end.invoke_id && e.invoke_id !== end.invoke_id) continue;
    const fk = e.failure_kind_classified;
    if (fk === 'agent_timeout') return { cause: 'agent_timeout', failureKind: fk };
    if (fk === 'transient_api_error') return { cause: 'transient_api_error', failureKind: fk };
    return { cause: 'content_retry', ...(fk ? { failureKind: fk } : {}) };
  }
  return end.timed_out === true ? { cause: 'agent_timeout' } : { cause: 'unknown' };
}

/**
 * The next invocation is closure-only exactly when the latest authoritative
 * outcome for this phase requested a retry after PASS solely to finish closure.
 * Pass snapshots may protect frozen files, but are not workflow state.
 */
export function isClosureOnlyRetryPending(events: GoalRunEvent[], phase: string): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.phase !== phase) continue;
    if (event.type === 'phase_halt' || event.type === 'phase_invalidated') return false;
    if (event.type !== 'phase_verdict') continue;
    return event.verdict === 'PASS' && event.advance_blocked === true && event.action === 'retry';
  }
  return false;
}

/** Last agent_invoke_start without a matching agent_invoke_end (invoke_id first, phase fallback). */
export function findUnclosedAgentInvokeStart(events: GoalRunEvent[]): GoalRunEvent | null {
  const openStarts: GoalRunEvent[] = [];
  for (const e of events) {
    if (e.type === 'agent_invoke_start' && e.phase && FEATURE_PHASE_SET.has(e.phase)) {
      openStarts.push(e);
    } else if (e.type === 'agent_invoke_end' && e.phase && FEATURE_PHASE_SET.has(e.phase)) {
      let matched = false;
      if (e.invoke_id) {
        for (let i = openStarts.length - 1; i >= 0; i--) {
          if (openStarts[i].invoke_id === e.invoke_id) {
            openStarts.splice(i, 1);
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        for (let i = openStarts.length - 1; i >= 0; i--) {
          if (openStarts[i].phase === e.phase) {
            openStarts.splice(i, 1);
            break;
          }
        }
      }
    }
  }
  return openStarts.length > 0 ? openStarts[openStarts.length - 1]! : null;
}

/** Receipt on disk is from the same invoke window as summary (mtime + optional claimed_completion_at). */
export function isReceiptFreshForInvokeStart(
  projectRoot: string,
  feature: string,
  phase: FeaturePhase,
  invokeStartMs: number,
): boolean {
  if (Number.isNaN(invokeStartMs)) return false;
  const receiptPath = receiptFilePath(projectRoot, feature, phase);
  if (!fs.existsSync(receiptPath)) return false;

  const mtimeMs = fs.statSync(receiptPath).mtimeMs;
  if (mtimeMs <= invokeStartMs) return false;

  try {
    const raw = fs.readFileSync(receiptPath, 'utf-8');
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw.replace(/^\uFEFF/, ''));
    if (!fmMatch) return true;
    const claimedLine = fmMatch[1]
      .split(/\r?\n/)
      .find((line) => /^\s*claimed_completion_at\s*:/.test(line));
    if (!claimedLine) return true;
    const value = claimedLine.replace(/^\s*claimed_completion_at\s*:\s*/, '').replace(/^["']|["']$/g, '').trim();
    if (!value) return true;
    const claimedMs = new Date(value).getTime();
    if (Number.isNaN(claimedMs)) return false;
    return claimedMs > invokeStartMs;
  } catch {
    return false;
  }
}

function phaseHasTerminalVerdict(events: GoalRunEvent[], phase: FeaturePhase): boolean {
  for (const e of events) {
    if (e.type !== 'phase_verdict' || e.phase !== phase) continue;
    if (e.action === 'retry') continue;
    return true;
  }
  return false;
}

function phaseHasRecoveredVerdict(events: GoalRunEvent[], phase: FeaturePhase): boolean {
  for (const e of events) {
    if (e.type === 'phase_verdict' && e.phase === phase && e.recovered === true) return true;
  }
  return false;
}

/** Detect half-completed phase eligible for resume recovery (fresh PASS summary, unclosed invoke). */
export function detectHalfCompletedPhaseRecovery(
  events: GoalRunEvent[],
  projectRoot: string,
  feature: string,
): { phase: FeaturePhase; invokeStartTs: string } | null {
  const unclosed = findUnclosedAgentInvokeStart(events);
  if (!unclosed?.phase || !unclosed.ts) return null;

  const phase = unclosed.phase as FeaturePhase;
  if (phaseHasTerminalVerdict(events, phase) || phaseHasRecoveredVerdict(events, phase)) {
    return null;
  }

  const summary = readPhaseSummaryPassReceipt(projectRoot, feature, phase);
  if (!summary || summary.verdict !== 'PASS') return null;
  if (summary.receipt_status !== 'passed' || summary.closure_status !== 'closed') return null;

  const startMs = new Date(unclosed.ts).getTime();
  if (Number.isNaN(startMs) || summary.mtimeMs <= startMs) return null;
  if (!isReceiptFreshForInvokeStart(projectRoot, feature, phase, startMs)) return null;

  return { phase, invokeStartTs: unclosed.ts };
}

export interface HalfPhaseRecoveryEvent {
  type: string;
  phase: FeaturePhase;
  [key: string]: unknown;
}

/** Build compensation events for half-completed phase (orchestrator writes before rebuild). */
export function buildHalfPhaseRecoveryEvents(
  detected: { phase: FeaturePhase; invokeStartTs: string },
): HalfPhaseRecoveryEvent[] {
  const ts = new Date().toISOString();
  return [
    {
      type: 'agent_invoke_recovered',
      ts,
      phase: detected.phase,
      invoke_start_ts: detected.invokeStartTs,
    },
    {
      type: 'phase_verdict',
      ts,
      phase: detected.phase,
      verdict: 'PASS',
      action: 'advance',
      recovered: true,
    },
  ];
}
