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
  const agentFailed = !input.agentSkipped && input.agentExitCode !== 0;

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
  advance_blocked?: boolean;
  advance_block_reason?: string;
  exit_code?: number;
  duration_ms?: number;
  timed_out?: boolean;
  silent_killed?: boolean;
  lingering_pipe?: boolean;
  recovered?: boolean;
  invoke_id?: string;
  invoke_start_ts?: string;
  chain?: string[];
  attempt?: number;
  substep?: string;
  start_index?: number;
  start_phase?: string;
}

export interface ResumedBudget {
  totalTurns: number;
  wallClockStartMs: number;
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

export function resolveResumedBudget(events: GoalRunEvent[]): ResumedBudget {
  return {
    totalTurns: countAgentInvokeStarts(events),
    wallClockStartMs: resolveWallClockStartMs(events),
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
  for (const e of events) {
    if (e.type !== 'phase_verdict' || !e.phase || !FEATURE_PHASE_SET.has(e.phase)) continue;
    if (e.action === 'retry') continue;
    lastTerminal.set(e.phase as FeaturePhase, e);
  }

  const outcomes: GoalPhaseOutcome[] = [];
  for (const phase of chain) {
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
