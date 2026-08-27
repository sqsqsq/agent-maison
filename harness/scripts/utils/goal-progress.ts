/**
 * Goal progress projection — derive progress.json / progress.md from events.jsonl + manifest + locks.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// M5A §4.3：逻辑 featureId → 物理相对路径唯一 SSOT（锁/run 路径必须经它展开）
import { featureRelativePath } from './feature-identity';
import { isDryReportDir, type GoalManifest } from './goal-manifest';
import {
  LEGACY_FEATURE_PHASE_ORDER,
  resolveFeatureTrack,
  workflowFeaturePhases,
} from './runtime-policy';
import { loadFeatureTrackDecl } from './feature-track';
import {
  countAgentInvokeStarts,
  filterAuthoritativeEvents,
  findLatestEffectiveTimeoutMs,
  foldBudgetLineage,
  loadEventsJsonl,
  partitionExecutionSessions,
  resolveEffectiveRunEnd,
  resolveWallClockStartMs,
  type GoalRunEvent,
} from './goal-runner-phase';
import {
  FEATURE_LOCK_NAME,
  isLockStale,
  isPidAlive,
  readLockRecord,
  RUN_LOCK_NAME,
  STALE_LOCK_MS,
  type LockRecord,
} from './goal-run-lock';
import {
  resolveAutoChain,
  type FeaturePhase,
  type GoalRunStatus,
} from './phase-transition-policy';
import { normalizePhaseId } from './phase-alias';
import { resolvePhaseTimeoutMs, resolveWallClockMs } from './goal-timeout';
import type { WorkflowSpec } from '../../workflow-loader';
import { reduceRunState, type RecoveryDiagnostic } from './run-state-reducer';
import { findUnclosedGuardianBounds } from './goal-containment-reconcile';
import { defaultProcessProbe } from './device-session';
import type { Disposition, WaitKind } from './adjudication';

export const PROGRESS_SCHEMA_VERSION = '1.0';
export const LOCK_HEARTBEAT_MS = 60_000;
/** Freshness degrade when generated_at older than this (2–3× heartbeat). */
export const FRESHNESS_STALE_MS = LOCK_HEARTBEAT_MS * 3;
/** Soft stall window — quiet but lock fresh. */
export const SOFT_STALL_MS = 10 * 60 * 1000;

/**
 * Absolute dead-man factor. A live runner heartbeats every ~60s (LOCK_HEARTBEAT_MS),
 * so silence beyond DEAD_MAN_FACTOR×phaseTimeout means the runner is gone, not slow.
 * Lock-independent backstop so a killed-and-lock-cleaned run never projects as RUNNING.
 */
export const DEAD_MAN_FACTOR = 1.5;
export const SNAPSHOT_THROTTLE_MS = 4_000;

export type ProgressRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'STALLED'
  | 'WAITING_EXTERNAL'
  | 'CHAIN_SLICE_COMPLETED'
  | 'AWAITING_HUMAN_REVIEW'
  | 'DEFERRED_CAPABILITY_MISSING'
  | 'COMPLETED' // legacy 事件读取兼容（旧 run）；新 run 写 CHAIN_SLICE_COMPLETED
  | 'DEFERRED'
  | 'PARTIAL'
  | 'HALTED'
  | 'INTERRUPTED'
  | 'UNKNOWN';

export type ProgressPhaseStatus =
  | 'NOT_STARTED'
  | 'PROMPT_READY'
  | 'AGENT_RUNNING'
  | 'AGENT_DONE'
  | 'HARNESS_RUNNING'
  | 'PASSED'
  | 'DEFERRED'
  | 'FAILED'
  | 'RETRYING'
  | 'HALTED';

export type LivenessState =
  | 'ACTIVE'
  | 'QUIET'
  | 'ATTENTION'
  | 'SUSPECTED_STALL'
  | 'STALLED'
  | 'ORPHAN_SUSPECTED'
  | 'DONE';

export type PercentKind = 'estimated' | 'indeterminate';

export interface GoalProgressSnapshot {
  schema_version: string;
  run_id: string;
  feature: string;
  status: ProgressRunStatus;
  status_reason: string | null;
  /**
   * plan d6b1a8e3 t5⓪-b：**裁决轴**投影（与 `status` 的 liveness 轴正交，刻意不合并——
   * 合并成一个大枚举会得到两轴笛卡尔积状态机）。由单一 run-state reducer 折叠事件里
   * 已落盘的 `run_disposition` 得出，**不读 halt_reason 自行判类**。
   * monitor / supervisor 只消费本字段，不再各自从事件类型推导。
   */
  run_disposition: Disposition;
  run_wait_kind?: WaitKind;
  recovery?: RecoveryDiagnostic;
  generated_at: string;
  source: {
    events_path: string;
    events_count: number;
    last_event_at: string | null;
    last_event_type: string | null;
  };
  chain: {
    phases: FeaturePhase[];
    current_phase: FeaturePhase | null;
    current_index: number;
    total: number;
    estimated_percent: number | null;
    percent_kind: PercentKind;
  };
  phase: {
    name: FeaturePhase | null;
    status: ProgressPhaseStatus;
    attempt: number;
    started_at: string | null;
    elapsed_ms: number | null;
    substep: 'agent_invoke' | 'harness' | 'prompt' | 'verdict' | null;
    recovered?: boolean;
  };
  liveness: {
    state: LivenessState;
    last_activity_at: string | null;
    seconds_since_activity: number | null;
    /**
     * plan e6b3f8d2 t4：**工作面**停滞时长（now − agent-output.log mtime），毫秒。
     * 刻意与 `seconds_since_activity` 分立——后者是**控制面**口径，含 runner 自写
     * heartbeat，agent 一字不吐它也恒新鲜（立项事故：i3 输出 65 分钟零变化，
     * 活性却一路 ACTIVE）。仅在“未闭合 invoke + 输出未变 + streaming”三合取成立时
     * 有值；其余为 null，避免把 buffered/unknown/已闭合 invoke 误报成输出停滞。
     */
    agent_output_stalled_ms: number | null;
    signals: {
      feature_lock_heartbeat: 'fresh' | 'stale' | 'missing';
      runner_lock: 'present' | 'missing';
      agent_output_log: 'updated' | 'unchanged' | 'missing';
      child_process: 'unknown' | 'alive' | 'dead';
      lingering_pipe: boolean;
    };
  };
  budget: {
    turns_used: number;
    turns_limit: number;
    wall_elapsed_ms: number;
    wall_limit_ms: number;
    phase_timeout_ms: number;
  };
  artifacts: {
    agent_output_log: string | null;
    summary_path: string | null;
    goal_report_path: string | null;
    progress_path: string | null;
  };
  recent_events: Array<{ ts: string; type: string; phase?: string }>;
  next_action: string;
  /**
   * plan c6a9e4d2 t3：guardian 接管**只读投影**——报告**全部**未闭合 invoke 的绑定
   * guardian 及各自存活性（P0-1 review：只聚合最后一个会漏报更早孤儿）。goal-status/
   * monitor 只读消费它（识别绑定/存活性），**绝不据其回收**；回收只发生在 goal-runner
   * resume 对账 / goal-supervise 的受控 force 决策里。
   * alive=null 表示无法探测（非 win32 / 探针不可用）。
   */
  guardian?: {
    unclosed_bounds: number;
    any_alive: boolean | null;
    bounds: Array<{
      pid: number;
      token: string;
      invoke_id: string;
      phase: string;
      alive: boolean | null;
    }>;
  };
  phases_summary: Array<{
    phase: FeaturePhase;
    status: ProgressPhaseStatus;
    attempts: number;
    duration_ms: number | null;
    evidence: string | null;
  }>;
}

export interface ProjectProgressInput {
  projectRoot: string;
  manifest: GoalManifest;
  events: GoalRunEvent[];
  workflow: WorkflowSpec;
  featureLock?: LockRecord | null;
  runnerLock?: LockRecord | null;
  nowMs?: number;
  /** When projecting for goal-status with live lock probe. */
  liveProbe?: boolean;
  /**
   * e9d4b7a3 t4（二轮 review P1）：预算 lineage 折叠所需的 featuresDir，**必传**——
   * 不接受反向推导（旧实现从 report_dir 反推会多带 feature 段，in-session 路径
   * 折叠错到 `.../feat-a/feat-a/goal-runs`；真实来源是 cfg.paths.features_dir）。
   */
  featuresDir: string;
}

interface PhaseSpan {
  phase: FeaturePhase;
  attempt: number;
  started_at: string | null;
  ended_at: string | null;
  status: ProgressPhaseStatus;
  substep: GoalProgressSnapshot['phase']['substep'];
  recovered: boolean;
  ended: boolean;
  deferred: boolean;
  halted: boolean;
}

const TERMINAL_RUN_STATUSES = new Set<ProgressRunStatus>([
  'CHAIN_SLICE_COMPLETED',
  'AWAITING_HUMAN_REVIEW',
  'DEFERRED_CAPABILITY_MISSING',
  'COMPLETED', // legacy
  'DEFERRED',
  'PARTIAL',
  'HALTED',
  'INTERRUPTED',
]);

function relPath(projectRoot: string, abs: string): string {
  return path.relative(projectRoot, abs).replace(/\\/g, '/');
}

export function resolveChainFromEvents(
  events: GoalRunEvent[],
  fallbackChain: FeaturePhase[],
  allowedPhases: readonly string[] = LEGACY_FEATURE_PHASE_ORDER,
): FeaturePhase[] {
  for (const e of events) {
    if (e.type === 'run_start' && Array.isArray((e as { chain?: unknown }).chain)) {
      const raw = (e as { chain: string[] }).chain;
      const filtered = raw
        .map((p) => normalizePhaseId(p, p))
        .filter((p): p is FeaturePhase => allowedPhases.includes(p));
      if (filtered.length > 0) return filtered;
    }
  }
  return fallbackChain;
}

function countPhaseAttempts(events: GoalRunEvent[], phase: FeaturePhase): number {
  let n = 0;
  for (const e of events) {
    if (e.type === 'agent_invoke_start' && e.phase === phase) n++;
  }
  return Math.max(n, 1);
}

function buildPhaseSpans(events: GoalRunEvent[], chain: FeaturePhase[]): PhaseSpan[] {
  const spans: PhaseSpan[] = chain.map((phase) => ({
    phase,
    attempt: 0,
    started_at: null,
    ended_at: null,
    status: 'NOT_STARTED' as ProgressPhaseStatus,
    substep: null,
    recovered: false,
    ended: false,
    deferred: false,
    halted: false,
  }));

  const spanByPhase = new Map(chain.map((p, i) => [p, i]));

  for (let i = 0; i < events.length; i++) {
    const e = events[i];

    if (e.type === 'resume') {
      const startIndex = Math.max(0, Math.min(e.start_index ?? 0, spans.length));
      for (let j = startIndex; j < spans.length; j++) {
        spans[j] = {
          phase: chain[j],
          attempt: 0,
          started_at: null,
          ended_at: null,
          status: 'NOT_STARTED',
          substep: null,
          recovered: false,
          ended: false,
          deferred: false,
          halted: false,
        };
      }
      continue;
    }

    const phase = e.phase as FeaturePhase | undefined;
    if (!phase || !spanByPhase.has(phase)) continue;
    const idx = spanByPhase.get(phase)!;
    const span = spans[idx];

    if (e.type === 'phase_start') {
      span.started_at = e.ts ?? span.started_at;
      span.attempt = (e as { attempt?: number }).attempt ?? countPhaseAttempts(events, phase);
      if (!span.ended) span.status = 'PROMPT_READY';
    }
    if (e.type === 'prompt_written' && !span.ended) {
      span.status = 'PROMPT_READY';
      span.substep = 'prompt';
    }
    if (e.type === 'agent_invoke_start' && !span.ended) {
      span.attempt = countPhaseAttempts(events.slice(0, i + 1), phase);
      span.started_at = span.started_at ?? e.ts ?? null;
      span.status = 'AGENT_RUNNING';
      span.substep = 'agent_invoke';
    }
    if (e.type === 'agent_invoke_end' && !span.ended) {
      span.status = 'AGENT_DONE';
      span.substep = 'agent_invoke';
    }
    if (e.type === 'harness_start' && !span.ended) {
      span.status = 'HARNESS_RUNNING';
      span.substep = 'harness';
    }
    if (e.type === 'harness_end' && !span.ended) {
      span.substep = 'harness';
    }
    if (e.type === 'phase_verdict') {
      span.recovered = e.recovered === true;
      if (
        e.action === 'advance' ||
        e.action === 'defer_external_and_continue_if_allowed' ||
        e.action === 'defer_external_and_halt'
      ) {
        span.ended = true;
        span.ended_at = e.ts ?? span.ended_at;
        if (e.action === 'advance') {
          span.status = 'PASSED';
        } else {
          span.status = 'DEFERRED';
          span.deferred = true;
        }
        span.substep = 'verdict';
      } else if (e.action === 'retry') {
        span.status = 'RETRYING';
        span.substep = null;
      } else if (e.action === 'halt') {
        span.ended = true;
        span.ended_at = e.ts ?? span.ended_at;
        span.status = 'HALTED';
        span.halted = true;
        span.substep = 'verdict';
      } else if (e.verdict === 'FAIL') {
        span.status = 'FAILED';
      }
    }
    if (e.type === 'agent_invoke_recovered') {
      span.recovered = true;
    }
    // plan e7c2a4d8 T4a（codex 二轮 P1-4）：phase_halt 覆盖同 phase 在先的
    // provisional verdict——「harness PASS → runner 拦截 halt」时面板不得撕裂成
    // 「ut PASSED · 当前 testing · run HALTED」；current phase 固定为 halt 发生 phase。
    if (e.type === 'phase_halt') {
      span.ended = true;
      span.ended_at = e.ts ?? span.ended_at;
      span.status = 'HALTED';
      span.halted = true;
      span.deferred = false;
      span.substep = 'verdict';
    }
  }

  // Mark prior phases as PASSED when later phases started
  let lastActive = -1;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].started_at || spans[i].ended || spans[i].status !== 'NOT_STARTED') {
      lastActive = i;
    }
  }
  for (let i = 0; i < lastActive; i++) {
    if (!spans[i].ended && spans[i].status !== 'HALTED') {
      spans[i].ended = true;
      spans[i].ended_at = spans[i].ended_at ?? spans[i + 1]?.started_at ?? null;
      spans[i].status = spans[i].deferred ? 'DEFERRED' : 'PASSED';
    }
  }

  const effectiveRunEnd = resolveEffectiveRunEnd(events);
  if (effectiveRunEnd?.ts) {
    for (const span of spans) {
      if (span.ended && !span.ended_at) span.ended_at = effectiveRunEnd.ts;
    }
  }

  return spans;
}

function findCurrentSpan(spans: PhaseSpan[]): PhaseSpan | null {
  // plan e7c2a4d8 T4a：HALTED 优先——current phase 固定为 halt 发生 phase（面板不得
  // 显示「ut PASSED · 当前 testing · run HALTED」撕裂；后续 span 未真正开跑）。
  for (const s of spans) {
    if (s.halted) return s;
  }
  for (const s of spans) {
    if (!s.ended && s.status !== 'NOT_STARTED') return s;
  }
  for (const s of spans) {
    if (!s.ended) return s;
  }
  return spans.length > 0 ? spans[spans.length - 1] : null;
}

function computeEstimatedPercent(
  spans: PhaseSpan[],
  current: PhaseSpan | null,
): { percent: number | null; kind: PercentKind } {
  const total = spans.length;
  if (total === 0) return { percent: null, kind: 'indeterminate' };

  let completed = 0;
  for (const s of spans) {
    if (s.ended && (s.status === 'PASSED' || s.status === 'DEFERRED')) completed++;
  }

  if (!current || current.ended) {
    const p = Math.round((completed / total) * 100);
    return { percent: p, kind: 'estimated' };
  }

  // Retry regresses substep weights — downgrade to indeterminate per plan.
  if (current.status === 'RETRYING' || current.attempt > 1) {
    return { percent: null, kind: 'indeterminate' };
  }

  const base = completed / total;
  const weights: Record<string, number> = {
    PROMPT_READY: 0.05,
    AGENT_RUNNING: 0.35,
    AGENT_DONE: 0.45,
    HARNESS_RUNNING: 0.75,
  };
  const w = weights[current.status] ?? 0.1;
  const p = Math.round((base + w / total) * 100);
  return { percent: Math.min(p, 99), kind: 'estimated' };
}

function getAgentOutputStat(
  projectRoot: string,
  reportDir: string,
  phase: FeaturePhase | null,
): { mtimeMs: number | null; bytes: number; rel: string | null } {
  if (!phase) return { mtimeMs: null, bytes: 0, rel: null };
  const abs = path.join(projectRoot, reportDir, 'phases', phase, 'agent-output.log');
  if (!fs.existsSync(abs)) return { mtimeMs: null, bytes: 0, rel: relPath(projectRoot, abs) };
  const st = fs.statSync(abs);
  return { mtimeMs: st.mtimeMs, bytes: st.size, rel: relPath(projectRoot, abs) };
}

function resolvePhaseEvidence(
  projectRoot: string,
  reportDir: string,
  phase: FeaturePhase,
  span: PhaseSpan,
): string | null {
  const agentLog = path.join(projectRoot, reportDir, 'phases', phase, 'agent-output.log');
  const harnessSummary = path.join(projectRoot, reportDir, 'phases', phase, 'harness', 'summary.json');
  if (
    span.substep === 'agent_invoke' ||
    span.status === 'AGENT_RUNNING' ||
    span.status === 'AGENT_DONE'
  ) {
    if (fs.existsSync(agentLog)) return relPath(projectRoot, agentLog);
  }
  if (fs.existsSync(harnessSummary)) return relPath(projectRoot, harnessSummary);
  if (fs.existsSync(agentLog)) return relPath(projectRoot, agentLog);
  return null;
}

function buildPhasesSummary(
  projectRoot: string,
  reportDir: string,
  spans: PhaseSpan[],
  nowMs: number,
): GoalProgressSnapshot['phases_summary'] {
  return spans.map((s) => {
    const startedMs = s.started_at != null ? new Date(s.started_at).getTime() : NaN;
    const endedMs = s.ended_at != null ? new Date(s.ended_at).getTime() : NaN;
    const duration = !Number.isNaN(startedMs)
      ? (s.ended && !Number.isNaN(endedMs) ? endedMs : nowMs) - startedMs
      : null;
    return {
      phase: s.phase,
      status: s.status,
      attempts: s.attempt,
      duration_ms: duration != null && !Number.isNaN(duration) ? duration : null,
      evidence: resolvePhaseEvidence(projectRoot, reportDir, s.phase, s),
    };
  });
}

function findUnclosedInvoke(
  events: GoalRunEvent[],
): { event: GoalRunEvent; idx: number } | null {
  let open: { event: GoalRunEvent; idx: number } | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'agent_invoke_start') {
      open = { event: e, idx: i };
    }
    if (e.type === 'agent_invoke_end' || e.type === 'agent_invoke_recovered') {
      open = null;
    }
    if (e.type === 'phase_verdict' && e.recovered === true) {
      open = null;
    }
    // New session supersedes dangling invoke from a prior crash/halt.
    if (e.type === 'resume') {
      open = null;
    }
  }
  return open;
}

/**
 * A `harness_start` with no matching `harness_end`/`phase_verdict` after it: the
 * orchestrator died mid-verification. `findUnclosedInvoke` cannot see this because the
 * `agent_invoke` was already closed (the 2026-06-25 incident signature).
 */
function findUnclosedHarness(
  events: GoalRunEvent[],
): { event: GoalRunEvent; idx: number } | null {
  let open: { event: GoalRunEvent; idx: number } | null = null;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'harness_start') {
      open = { event: e, idx: i };
    }
    // harness_end closes it; phase_verdict implies the harness completed and was judged;
    // resume supersedes a dangling start from a prior crash.
    if (e.type === 'harness_end' || e.type === 'phase_verdict' || e.type === 'resume') {
      open = null;
    }
  }
  return open;
}

function lastEventOfTypes(events: GoalRunEvent[], types: Set<string>): GoalRunEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type && types.has(events[i].type!)) return events[i];
  }
  return null;
}

function resolveLockHeartbeatSignal(
  record: LockRecord | null | undefined,
  nowMs: number,
): 'fresh' | 'stale' | 'missing' {
  if (!record) return 'missing';
  const updated = new Date(record.updated_at).getTime();
  if (Number.isNaN(updated)) return 'stale';
  return nowMs - updated <= LOCK_HEARTBEAT_MS * 2 ? 'fresh' : 'stale';
}

export interface LivenessInput {
  events: GoalRunEvent[];
  featureLock: LockRecord | null | undefined;
  runnerLock: LockRecord | null | undefined;
  agentOutputMtimeMs: number | null;
  phaseTimeoutMs: number;
  runEnded: boolean;
  terminalStatus: ProgressRunStatus | null;
  nowMs: number;
  liveProbe: boolean;
  lastLingeringPipe: boolean;
}

/**
 * plan e6b3f8d2 t4：**本 run events** 里 `adapter_probe` 声明的输出交付方式。
 * 刻意读事件而不是现行 `adapter.yaml`——历史 run 不得被今天的声明重新解释
 *（一个 run 的活性判据只能用它自己当时落盘的事实）。缺失即 unknown。
 */
export function resolveRunOutputDelivery(events: GoalRunEvent[]): 'streaming' | 'buffered' | 'unknown' {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'adapter_probe') continue;
    const v = e.output_delivery;
    return v === 'streaming' || v === 'buffered' ? v : 'unknown';
  }
  return 'unknown';
}

export function computeLiveness(input: LivenessInput): GoalProgressSnapshot['liveness'] {
  const { events, featureLock, nowMs, runEnded, terminalStatus } = input;

  if (runEnded || (terminalStatus && TERMINAL_RUN_STATUSES.has(terminalStatus))) {
    return {
      state: 'DONE',
      last_activity_at: events.length > 0 ? (events[events.length - 1].ts ?? null) : null,
      seconds_since_activity: 0,
      agent_output_stalled_ms: null,
      signals: {
        feature_lock_heartbeat: 'missing',
        runner_lock: 'missing',
        agent_output_log: 'missing',
        child_process: 'unknown',
        lingering_pipe: false,
      },
    };
  }

  const activityTypes = new Set([
    'heartbeat',
    'agent_invoke_start',
    'agent_invoke_end',
    'harness_start',
    'harness_end',
    'phase_verdict',
    'phase_start',
    'prompt_written',
    'run_start',
    'resume',
  ]);

  let lastActivityMs: number | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type && activityTypes.has(e.type) && e.ts) {
      const t = new Date(e.ts).getTime();
      if (!Number.isNaN(t)) {
        lastActivityMs = t;
        break;
      }
    }
  }
  if (input.agentOutputMtimeMs != null) {
    lastActivityMs = Math.max(lastActivityMs ?? 0, input.agentOutputMtimeMs);
  }

  const secondsSince =
    lastActivityMs != null ? Math.round((nowMs - lastActivityMs) / 1000) : null;

  const lockHeartbeat = resolveLockHeartbeatSignal(featureLock, nowMs);
  const runnerPresent = input.runnerLock ? 'present' : 'missing';

  let childProcess: 'unknown' | 'alive' | 'dead' = 'unknown';
  let orphanSuspected = false;
  let runnerUnresponsive = false;

  if (featureLock && input.liveProbe) {
    const sameHost = featureLock.hostname === os.hostname();
    if (sameHost) {
      const alive = isPidAlive(featureLock.pid);
      childProcess = alive ? 'alive' : 'dead';
      if (isLockStale(featureLock, STALE_LOCK_MS, nowMs)) {
        if (!alive) orphanSuspected = true;
        else runnerUnresponsive = true;
      }
    } else if (isLockStale(featureLock, STALE_LOCK_MS, nowMs)) {
      childProcess = 'unknown';
    }
  }

  const unclosed = findUnclosedInvoke(events);
  let hardStall = false;
  if (unclosed && unclosed.event.ts) {
    const startMs = new Date(unclosed.event.ts).getTime();
    if (!Number.isNaN(startMs) && nowMs - startMs > input.phaseTimeoutMs) {
      const lastEnd = lastEventOfTypes(
        events.slice(unclosed.idx),
        new Set(['agent_invoke_end', 'agent_invoke_recovered']),
      );
      const recoveredVerdict = events
        .slice(unclosed.idx)
        .some((e) => e.type === 'phase_verdict' && e.recovered === true);
      if (!lastEnd && !recoveredVerdict) hardStall = true;
    }
  }

  // timed_out / silent_killed on closed invoke — before phase_verdict, unclosed is null.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'agent_invoke_end') continue;
    if (!e.timed_out && !e.silent_killed) break;
    const phase = e.phase;
    const verdictAfter = events
      .slice(i + 1)
      .some((ev) => ev.type === 'phase_verdict' && ev.phase === phase);
    if (!verdictAfter) hardStall = true;
    break;
  }

  // harness_start with no harness_end/phase_verdict past the phase timeout → orchestrator
  // died mid-verification (incident: agent_invoke already closed, so findUnclosedInvoke
  // misses it; the dangling harness_start is the only stall signal).
  const unclosedHarness = findUnclosedHarness(events);
  if (unclosedHarness?.event.ts) {
    const hsMs = new Date(unclosedHarness.event.ts).getTime();
    if (!Number.isNaN(hsMs) && nowMs - hsMs > input.phaseTimeoutMs) {
      hardStall = true;
    }
  }

  // Absolute dead-man (lock-independent backstop). A live runner heartbeats ~every 60s, so
  // silence beyond DEAD_MAN_FACTOR×phaseTimeout means the runner is gone — never a slow
  // phase. Guarantees a killed-and-lock-cleaned run cannot project as RUNNING.
  if (secondsSince != null && secondsSince * 1000 > input.phaseTimeoutMs * DEAD_MAN_FACTOR) {
    hardStall = true;
  }

  const outputSignal =
    input.agentOutputMtimeMs == null
      ? 'missing'
      : secondsSince != null && nowMs - input.agentOutputMtimeMs > SOFT_STALL_MS
        ? 'unchanged'
        : 'updated';

  let state: LivenessState = 'ACTIVE';
  if (orphanSuspected) {
    state = 'ORPHAN_SUSPECTED';
  } else if (hardStall || runnerUnresponsive) {
    state = 'STALLED';
  } else if (secondsSince != null && secondsSince * 1000 >= SOFT_STALL_MS) {
    state = lockHeartbeat === 'fresh' ? 'SUSPECTED_STALL' : 'ATTENTION';
  } else if (secondsSince != null && secondsSince * 1000 >= SOFT_STALL_MS / 2) {
    state = 'QUIET';
  }

  // plan e6b3f8d2 t4：**工作面与控制面分离**。控制面（runner heartbeat）恒新鲜会把
  // 「agent 一字不吐」盖成 ACTIVE（立项事故：i3 输出停滞 65 分钟仍报 ACTIVE）。
  // 判据三合取，缺一不降：
  //   ① 存在未闭合 invoke（确实有个 agent 正在跑）；
  //   ② 工作面信号 outputSignal='unchanged'（agent-output.log 超软阈未变）；
  //   ③ 本 run 事件声明 output_delivery='streaming'——**只有流式交付**才能从"日志不长"
  //      推出"agent 没吐字"；buffered/unknown 下日志本就可能整段憋着，据此降级即误报。
  // **只观测不干预**：降级到既有枚举 SUSPECTED_STALL，不触发 kill/恢复，不新增枚举或
  // 第二 reducer；且只从 ACTIVE/QUIET 抬（ORPHAN/STALLED/ATTENTION 是更强的控制面结论）。
  const outputDelivery = resolveRunOutputDelivery(events);
  const outputStallObserved =
    unclosed !== null &&
    outputSignal === 'unchanged' &&
    outputDelivery === 'streaming';
  const agentOutputStalledMs =
    outputStallObserved && input.agentOutputMtimeMs != null
      ? Math.max(0, nowMs - input.agentOutputMtimeMs)
      : null;
  if ((state === 'ACTIVE' || state === 'QUIET') && outputStallObserved) {
    state = 'SUSPECTED_STALL';
  }

  return {
    state,
    last_activity_at:
      lastActivityMs != null ? new Date(lastActivityMs).toISOString() : null,
    seconds_since_activity: secondsSince,
    agent_output_stalled_ms: agentOutputStalledMs,
    signals: {
      feature_lock_heartbeat: lockHeartbeat,
      runner_lock: runnerPresent,
      agent_output_log: outputSignal,
      child_process: childProcess,
      lingering_pipe: input.lastLingeringPipe,
    },
  };
}

export function mapGoalStatusToProgress(status: GoalRunStatus): ProgressRunStatus {
  return status;
}

export function projectGoalProgress(input: ProjectProgressInput): GoalProgressSnapshot {
  const nowMs = input.nowMs ?? Date.now();
  const { projectRoot, manifest, workflow } = input;
  const reportDir = manifest.report_dir;
  // 实施 round2 P1：普通 run 的投影单点走权威视图——legacy 混写文件里的 dry 段
  //（span/turn/run_start 基点/recent_events）不得进面板真值，修「面板显示旧 dry-run
  // PASSED」原始事故形态；.dry 视图（dry 自己的 progress）保留 raw 事件。
  const isDryView = isDryReportDir(reportDir);
  const partition = isDryView ? null : partitionExecutionSessions(input.events);
  const events = partition ? partition.authoritativeEvents : input.events;
  const eventsPath = relPath(projectRoot, path.join(projectRoot, reportDir, 'events.jsonl'));

  // C1：链投影按 feature track（lite 走显式 lite 链）；事件链过滤放宽到 workflow 全部 feature phase
  const progressTrack = resolveFeatureTrack(loadFeatureTrackDecl(projectRoot, manifest.feature));
  const fallbackChain = resolveAutoChain(
    workflow,
    manifest.start_phase,
    manifest.end_phase,
    manifest.chain_override,
    progressTrack,
  );
  const allowedPhases = [
    ...new Set([...workflowFeaturePhases(workflow, 'full'), ...workflowFeaturePhases(workflow, 'lite')]),
  ];
  const chain = resolveChainFromEvents(events, fallbackChain, allowedPhases);

  const hasRunStart = events.some((e) => e.type === 'run_start');
  const lastRunEnd = resolveEffectiveRunEnd(events);

  const spans = buildPhaseSpans(events, chain);
  const currentSpan = findCurrentSpan(spans);
  const currentPhase = currentSpan?.phase ?? null;
  const currentIndex = currentPhase ? chain.indexOf(currentPhase) : 0;

  // 实施 round2 P1：预算轴与 runner T2 同构——turns 只计权威段；wall_elapsed=活跃时间
  //（Σ 历史段 activeMs + 直播段 now−段首），不再用「首个 run_start→now」日历跨度
  //（隔夜 resume 面板秒报预算耗尽=4035d4 形态）。dry 视图保留 raw 口径。
  // e9d4b7a3 t4：与 runner 熔断/heartbeat 同一折叠入口（foldBudgetLineage 沿 supersede
  // 链收祖先 events）——supersede 链下 progress 显示 lineage 累计（30/30），不再 5/30。
  let turnsUsed: number;
  let wallElapsed: number;
  if (!partition) {
    turnsUsed = countAgentInvokeStarts(events);
    wallElapsed = nowMs - resolveWallClockStartMs(events);
  } else {
    const featuresDir = input.featuresDir;
    const fold = foldBudgetLineage({
      projectRoot,
      featuresDir,
      feature: input.manifest.feature,
      currentEvents: events,
    });
    const foldPartition = partitionExecutionSessions(fold.budgetFoldEvents);
    const auth = foldPartition.sessions.filter((s) => s.mode === 'authoritative');
    const last = auth.length > 0 ? auth[auth.length - 1] : null;
    turnsUsed = foldPartition.totalTurns;
    if (!last) {
      wallElapsed = 0;
    } else if (!lastRunEnd && Number.isFinite(last.startMs) && last.startMs > 0) {
      // 直播段（无 run_end）：活跃计时随 now 前进，与 runner 的
      // elapsed = priorActive + (now − sessionStart) 同构（崩溃段的保守补收只在
      // 段后出现新段/终局时收敛，面板侧宁多计不漏计）。
      wallElapsed =
        auth.slice(0, -1).reduce((a, s) => a + s.activeMs, 0) +
        Math.max(0, nowMs - last.startMs);
    } else {
      wallElapsed = foldPartition.priorActiveMs;
    }
  }
  // 与 goal-runner 共用同一 resolver，杜绝"runner 等 90min 但 progress 按 60min 报 STALLED"脑裂。
  const wallLimitMs = resolveWallClockMs(manifest);
  const stallPhase: FeaturePhase = currentPhase ?? chain[0] ?? 'review';
  // P0-4（plan d9b4f7e2）：timeout 单一事实源——优先读最近 agent_invoke_start 的
  // effective_timeout_ms（钳制/升档后的真值；runner 升档而 progress 静态解析 manifest
  // 会把合法运行 attempt 误报 STALLED）；旧日志无该字段时回落 manifest 解析。
  const phaseTimeoutMs =
    findLatestEffectiveTimeoutMs(events, currentPhase) ??
    resolvePhaseTimeoutMs(stallPhase, manifest);

  const outputStat = getAgentOutputStat(projectRoot, reportDir, currentPhase);

  let lastLingeringPipe = false;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'agent_invoke_end') {
      lastLingeringPipe = (events[i] as { lingering_pipe?: boolean }).lingering_pipe === true;
      break;
    }
  }

  const liveness = computeLiveness({
    events,
    featureLock: input.featureLock,
    runnerLock: input.runnerLock,
    agentOutputMtimeMs: outputStat.mtimeMs,
    phaseTimeoutMs,
    runEnded: Boolean(lastRunEnd),
    terminalStatus: lastRunEnd?.status as ProgressRunStatus | null,
    nowMs,
    liveProbe: input.liveProbe ?? false,
    lastLingeringPipe,
  });

  // d6 t5⓪-b：裁决轴由单一 reducer 给出（total function——空序列/仅 run_start 亦有值）。
  // 与下面的 liveness 轴各算各的，报告侧同时如实展示两轴。
  const runState = reduceRunState(events as unknown[]);

  let status: ProgressRunStatus = 'PENDING';
  let statusReason: string | null = null;

  if (!hasRunStart) {
    status = 'PENDING';
  } else if (lastRunEnd?.status) {
    status = lastRunEnd.status as ProgressRunStatus;
  } else if (liveness.state === 'ORPHAN_SUSPECTED') {
    status = 'UNKNOWN';
    statusReason = 'feature_lock_orphan_suspected';
  } else if (liveness.state === 'STALLED') {
    status = 'STALLED';
    statusReason = 'hard_stall_threshold';
  } else {
    const hasDeferredUpstream = spans.some((s) => s.deferred);
    if (hasDeferredUpstream) {
      status = 'WAITING_EXTERNAL';
      statusReason = 'upstream_deferred';
    } else {
      status = 'RUNNING';
    }
    if (
      !statusReason &&
      (liveness.state === 'SUSPECTED_STALL' || liveness.state === 'ATTENTION')
    ) {
      statusReason = 'soft_quiet_window';
    }
  }
  if (!statusReason && runState.recovery) statusReason = runState.recovery.reason;

  const { percent, kind } = computeEstimatedPercent(spans, currentSpan);

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const recentEvents = events.slice(-5).map((e) => ({
    ts: e.ts ?? '',
    type: e.type ?? '',
    phase: e.phase,
  }));

  const goalReportRel = path.join(reportDir, 'goal-report.json').replace(/\\/g, '/');
  // A terminal run_end only implies a goal-report.json on the *normal* completion path.
  // An INTERRUPTED / abnormal exit writes no report — never point the user at a missing file.
  const goalReportExists = fs.existsSync(path.join(projectRoot, reportDir, 'goal-report.json'));

  // plan d6b1a8e3 t5①（codex 订正）：**next_action 是控制语义，必须由统一投影决定**。
  // 此前 runState 只被复制进快照字段、nextAction 仍按 run_end/substep 独立推导——
  // 那样 reducer 只是展示字段而不是控制真值：WAITING(human) 与 WAITING(external)
  // 没有不同动作、RECOVERY_PENDING 不显示恢复中、TERMINAL 还在劝人 resume。
  // liveness 轴保持正交：它只影响下面的等待细分，不覆盖四态给出的控制结论。
  let nextAction = 'wait';
  if (status === 'PENDING') nextAction = 'await_run_start';
  else if (runState.run_disposition === 'TERMINAL') {
    nextAction = goalReportExists ? 'read_goal_report' : 'inspect_events_terminal';
  } else if (runState.run_disposition === 'RECOVERY_PENDING') {
    nextAction = 'wait_for_framework_recovery';
  } else if (runState.run_disposition === 'WAITING') {
    nextAction = runState.run_wait_kind === 'external'
      ? 'await_external_condition'
      : 'await_human_action';
  } else if (lastRunEnd) nextAction = goalReportExists ? 'read_goal_report' : 'inspect_events_or_resume';
  else if (currentSpan?.substep === 'agent_invoke') nextAction = 'wait_for_agent_invoke_end';
  else if (currentSpan?.substep === 'harness') nextAction = 'wait_for_harness_end';
  else if (currentSpan?.status === 'RETRYING') nextAction = 'wait_for_retry';
  else nextAction = 'wait_for_phase_verdict';
  const progressRel = path.join(reportDir, 'progress.json').replace(/\\/g, '/');

  const phaseStartedAt = currentSpan?.started_at ?? null;
  const phaseElapsed =
    phaseStartedAt != null
      ? nowMs - new Date(phaseStartedAt).getTime()
      : null;

  return {
    schema_version: PROGRESS_SCHEMA_VERSION,
    run_id: manifest.run_id,
    feature: manifest.feature,
    status,
    status_reason: statusReason,
    // 裁决轴（正交于上面的 liveness 轴）——supervisor 按 beacon × run_disposition 决策
    run_disposition: runState.run_disposition,
    ...(runState.run_wait_kind ? { run_wait_kind: runState.run_wait_kind } : {}),
    ...(runState.recovery ? { recovery: runState.recovery } : {}),
    generated_at: new Date(nowMs).toISOString(),
    source: {
      events_path: eventsPath,
      events_count: events.length,
      last_event_at: lastEvent?.ts ?? null,
      last_event_type: lastEvent?.type ?? null,
    },
    chain: {
      phases: chain,
      current_phase: currentPhase,
      current_index: currentIndex >= 0 ? currentIndex : 0,
      total: chain.length,
      estimated_percent: percent,
      percent_kind: kind,
    },
    phase: {
      name: currentPhase,
      status: currentSpan?.status ?? 'NOT_STARTED',
      attempt: currentSpan?.attempt ?? 0,
      started_at: phaseStartedAt,
      elapsed_ms: phaseElapsed != null && !Number.isNaN(phaseElapsed) ? phaseElapsed : null,
      substep: currentSpan?.substep ?? null,
      recovered: currentSpan?.recovered,
    },
    liveness,
    budget: {
      turns_used: turnsUsed,
      turns_limit: manifest.budget.max_total_turns,
      wall_elapsed_ms: wallElapsed,
      wall_limit_ms: wallLimitMs,
      phase_timeout_ms: phaseTimeoutMs,
    },
    artifacts: {
      agent_output_log: outputStat.rel,
      summary_path: null,
      goal_report_path: goalReportExists ? goalReportRel : null,
      progress_path: progressRel,
    },
    recent_events: recentEvents,
    next_action: nextAction,
    phases_summary: buildPhasesSummary(projectRoot, reportDir, spans, nowMs),
  };
}

/** goal-status 真源：实时重算 liveness + 新鲜度降级。 */
export function buildLiveGoalStatusSnapshot(opts: {
  projectRoot: string;
  manifest: GoalManifest;
  workflow: WorkflowSpec;
  /** e9d4b7a3 t4：必传（cfg.paths.features_dir 派生）——折叠 lineage 与锁路径共用 */
  featuresDir: string;
  feature: string;
  runId: string;
  tailN?: number;
  nowMs?: number;
}): GoalProgressSnapshot {
  const eventsPath = path.join(opts.projectRoot, opts.manifest.report_dir, 'events.jsonl');
  const events = loadEventsJsonl(eventsPath);
  const featureLock = readLockRecord(
    resolveFeatureLockPath(opts.projectRoot, opts.featuresDir, opts.feature),
  );
  const runnerLock = readLockRecord(
    resolveRunnerLockPath(opts.projectRoot, opts.featuresDir, opts.feature, opts.runId, opts.manifest.report_dir),
  );
  const nowMs = opts.nowMs ?? Date.now();

  let snapshot = projectGoalProgress({
    projectRoot: opts.projectRoot,
    manifest: opts.manifest,
    events,
    workflow: opts.workflow,
    featureLock,
    runnerLock,
    nowMs,
    liveProbe: true,
    featuresDir: opts.featuresDir,
  });
  snapshot = applyFreshnessDegradation(snapshot, {
    liveProbe: true,
    featureLock,
    nowMs,
  });

  // plan c6a9e4d2 t3：guardian 只读投影（**全部**未闭合绑定 + 各自存活性；探针只读，
  // 不杀进程）。非 win32 或探针不可用 → alive=null；any_alive 为聚合三态。
  const guardianBounds = findUnclosedGuardianBounds(events);
  if (guardianBounds.length > 0) {
    const bounds = guardianBounds.map((b) => {
      let alive: boolean | null = null;
      if (process.platform === 'win32') {
        try {
          alive = defaultProcessProbe().identify(b.pid) !== null;
        } catch {
          alive = null;
        }
      }
      return { pid: b.pid, token: b.token, invoke_id: b.invoke_id, phase: b.phase, alive };
    });
    const hasAlive = bounds.some((b) => b.alive === true);
    const hasDead = bounds.some((b) => b.alive === false);
    snapshot = {
      ...snapshot,
      guardian: {
        unclosed_bounds: bounds.length,
        any_alive: hasAlive ? true : hasDead ? false : null,
        bounds,
      },
    };
  }

  if (opts.tailN && opts.tailN > 0) {
    // 实施 round2 P1：tail 与投影同视图（普通 run 权威过滤、dry 视图 raw）——
    // 面板 recent_events 混入 dry 行会与 status/phase 真值脑裂。
    const viewEvents = isDryReportDir(opts.manifest.report_dir)
      ? events
      : filterAuthoritativeEvents(events);
    snapshot = {
      ...snapshot,
      recent_events: viewEvents.slice(-opts.tailN).map((e) => ({
        ts: e.ts ?? '',
        type: e.type ?? '',
        phase: e.phase,
      })),
    };
  }
  return snapshot;
}

export function formatGoalStatusJson(snapshot: GoalProgressSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

function formatAgentOutputStall(liveness: GoalProgressSnapshot['liveness']): string | null {
  if (
    liveness.agent_output_stalled_ms == null ||
    liveness.agent_output_stalled_ms < SOFT_STALL_MS
  ) {
    return null;
  }
  return (
    `agent 输出已停滞 ${Math.floor(liveness.agent_output_stalled_ms / 60000)} 分钟` +
    '（工作面口径：now − agent-output.log mtime；控制面 heartbeat 不计入）'
  );
}

export function formatGoalStatusText(
  snapshot: GoalProgressSnapshot,
  feature: string,
  runId: string,
): string {
  const pct =
    snapshot.chain.percent_kind === 'indeterminate'
      ? `${snapshot.chain.current_index + 1}/${snapshot.chain.total}`
      : `${snapshot.chain.estimated_percent ?? 0}%`;
  const outputStall = formatAgentOutputStall(snapshot.liveness);
  return [
    `Goal ${feature} · run ${runId} · ${snapshot.status}`,
    `Current: ${snapshot.phase.name ?? '—'} / ${snapshot.phase.status} (${snapshot.phase.substep ?? '—'})`,
    `Liveness: ${snapshot.liveness.state} · progress ${pct}`,
    ...(outputStall ? [outputStall] : []),
    `Budget: turns ${snapshot.budget.turns_used}/${snapshot.budget.turns_limit}`,
  ].join('\n');
}

export interface StatusWatchOptions {
  render: () => void;
  intervalMs?: number;
  maxTicks?: number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

/** Watch loop with optional maxTicks (testable without hanging). */
export async function runStatusWatchLoop(opts: StatusWatchOptions): Promise<void> {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxTicks = opts.maxTicks ?? 0;
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  let ticks = 0;

  const tick = (): void => {
    opts.render();
    ticks += 1;
  };

  tick();
  if (maxTicks > 0 && ticks >= maxTicks) return;

  await new Promise<void>((resolve) => {
    const timer = setIntervalFn(() => {
      tick();
      if (maxTicks > 0 && ticks >= maxTicks) {
        clearIntervalFn(timer);
        resolve();
      }
    }, intervalMs);
  });
}

export function applyFreshnessDegradation(
  snapshot: GoalProgressSnapshot,
  opts: { liveProbe: boolean; featureLock?: LockRecord | null; nowMs?: number },
): GoalProgressSnapshot {
  if (TERMINAL_RUN_STATUSES.has(snapshot.status)) return snapshot;

  const nowMs = opts.nowMs ?? Date.now();
  const generatedMs = new Date(snapshot.generated_at).getTime();
  if (Number.isNaN(generatedMs)) return { ...snapshot, status: 'UNKNOWN', status_reason: 'invalid_generated_at' };

  if (nowMs - generatedMs <= FRESHNESS_STALE_MS) return snapshot;

  if (!opts.liveProbe) {
    return {
      ...snapshot,
      status: 'UNKNOWN',
      status_reason: 'snapshot_stale_no_live_probe',
    };
  }

  const lock = opts.featureLock;
  if (!lock) {
    return {
      ...snapshot,
      status: 'UNKNOWN',
      status_reason: 'snapshot_stale_no_lock',
    };
  }

  const sameHost = lock.hostname === os.hostname();
  if (!sameHost) {
    return {
      ...snapshot,
      status: 'UNKNOWN',
      status_reason: 'snapshot_stale_cross_host',
    };
  }

  const alive = isPidAlive(lock.pid);
  if (!alive) {
    return {
      ...snapshot,
      status: 'UNKNOWN',
      status_reason: 'orphan_suspected_stale_snapshot',
      liveness: { ...snapshot.liveness, state: 'ORPHAN_SUSPECTED' },
    };
  }

  return {
    ...snapshot,
    status: 'RUNNING',
    status_reason: 'snapshot_stale_runner_alive',
    liveness: { ...snapshot.liveness, state: 'SUSPECTED_STALL' },
  };
}

export function generateProgressMarkdown(snapshot: GoalProgressSnapshot): string {
  const outputStall = formatAgentOutputStall(snapshot.liveness);
  const lines: string[] = [
    `# Goal Progress - ${snapshot.feature}`,
    '',
    `- Run ID: ${snapshot.run_id}`,
    `- Status: ${snapshot.status}`,
    `- Current: ${snapshot.phase.name ?? '—'} / ${snapshot.phase.status}`,
    `- Liveness: ${snapshot.liveness.state}${
      snapshot.liveness.seconds_since_activity != null
        ? `, last activity ${snapshot.liveness.seconds_since_activity}s ago`
        : ''
    }`,
    // plan e6b3f8d2 t4：工作面口径单列。**不复用 seconds_since_activity**——那条含
    // runner 自写 heartbeat，会把"agent 早不吐字了"读成"刚刚还活着"。
    ...(outputStall ? [`- ${outputStall}`] : []),
    `- Budget: turns ${snapshot.budget.turns_used}/${snapshot.budget.turns_limit}, wall ${Math.round(snapshot.budget.wall_elapsed_ms / 60000)}m/${Math.round(snapshot.budget.wall_limit_ms / 60000)}m`,
    '',
    '## Phases',
    '',
    '| Phase | Status | Attempts | Duration | Evidence |',
    '|-------|--------|----------|----------|----------|',
  ];

  for (const row of snapshot.phases_summary) {
    const dur =
      row.duration_ms != null ? `${Math.round(row.duration_ms / 60000)}m` : '—';
    const evidence = row.evidence ?? '—';
    lines.push(
      `| ${row.phase} | ${row.status} | ${row.attempts || '—'} | ${dur} | ${evidence} |`,
    );
  }

  if (snapshot.recovery) {
    const r = snapshot.recovery;
    lines.push(
      '',
      '## Recovery',
      '',
      `- Reason: ${r.reason}`,
      `- Action: ${r.action}`,
      `- Current / owner target: ${r.current_phase ?? '—'} / ${r.target_phase ?? r.owner_phase ?? '—'}`,
      `- Gap: ${r.gap_kind ?? '—'}`,
      `- Budget: ${r.backtracks_used ?? '—'} / ${r.backtracks_limit ?? '—'}`,
      `- Fingerprint: ${r.fingerprint ?? '—'}`,
    );
    for (const item of r.changed_paths.slice(0, 20)) {
      lines.push(
        `- ${item.path}${item.owner ? ` owner=${item.owner}` : ''}` +
        `${item.pre_sha256 || item.post_sha256 ? ` pre=${item.pre_sha256 ?? 'missing'} post=${item.post_sha256 ?? 'missing'}` : ''}`,
      );
    }
  }

  lines.push('', '## Recent Activity', '');
  for (const e of snapshot.recent_events) {
    lines.push(`- ${e.ts} ${e.type}${e.phase ? ` ${e.phase}` : ''}`);
  }

  if (snapshot.status_reason) {
    lines.push('', `> ${snapshot.status_reason}`);
  }

  return lines.join('\n') + '\n';
}

export const RENAME_MAX_ATTEMPTS = 3;
export const RENAME_BACKOFF_MS = 80;

export type RenameSyncFn = (from: string, to: string) => void;

export interface AtomicRenameOptions {
  renameFn?: RenameSyncFn;
  maxAttempts?: number;
  backoffMs?: number;
  /** Injectable for tests; default brief sync spin. */
  sleepMs?: (ms: number) => void;
}

function defaultSleepMs(ms: number): void {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    /* intentional brief spin — <100ms */
  }
}

/** tmp→target rename with EPERM/EACCES retry (testable via renameFn injection). */
export function atomicRenameWithRetry(
  from: string,
  to: string,
  opts: AtomicRenameOptions = {},
): boolean {
  const rename = opts.renameFn ?? fs.renameSync.bind(fs);
  const maxAttempts = opts.maxAttempts ?? RENAME_MAX_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? RENAME_BACKOFF_MS;
  const sleep = opts.sleepMs ?? defaultSleepMs;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      rename(from, to);
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EACCES') && attempt < maxAttempts - 1) {
        sleep(backoffMs);
        continue;
      }
      return false;
    }
  }
  return false;
}

export function writeProgressSnapshotAtomic(
  projectRoot: string,
  reportDir: string,
  snapshot: GoalProgressSnapshot,
  writeMd = false,
): void {
  const base = path.join(projectRoot, reportDir);
  fs.mkdirSync(base, { recursive: true });
  const jsonPath = path.join(base, 'progress.json');
  const tmpPath = `${jsonPath}.${process.pid}.tmp`;
  const payload = JSON.stringify(snapshot, null, 2) + '\n';
  fs.writeFileSync(tmpPath, payload, 'utf-8');

  const renamed = atomicRenameWithRetry(tmpPath, jsonPath);
  if (!renamed) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      /* skip */
    }
    return;
  }

  if (writeMd) {
    const mdPath = path.join(base, 'progress.md');
    fs.writeFileSync(mdPath, generateProgressMarkdown(snapshot), 'utf-8');
  }
}

export interface ProgressWriterState {
  lastWriteMs: number;
}

export function shouldThrottleSnapshot(state: ProgressWriterState, nowMs: number): boolean {
  return nowMs - state.lastWriteMs < SNAPSHOT_THROTTLE_MS;
}

export function resolveFeatureLockPath(
  projectRoot: string,
  featuresDir: string,
  feature: string,
): string {
  return path.join(projectRoot, featuresDir, featureRelativePath(feature), 'goal-runs', FEATURE_LOCK_NAME);
}

export function resolveRunnerLockPath(
  projectRoot: string,
  featuresDir: string,
  feature: string,
  runId: string,
  /** plan e7c2a4d8 T1b''（v22 P0-2）：per-run lock 从 canonical manifest.report_dir
   * 派生（dry 落 goal-runs/.dry/<run_id>）；未提供时按普通目录（legacy 调用面）。 */
  reportDir?: string,
): string {
  if (reportDir) {
    return path.join(projectRoot, ...reportDir.replace(/\\/g, '/').split('/'), RUN_LOCK_NAME);
  }
  return path.join(projectRoot, featuresDir, featureRelativePath(feature), 'goal-runs', runId, RUN_LOCK_NAME);
}

export function loadProgressContext(
  projectRoot: string,
  manifest: GoalManifest,
  featuresDir: string,
): {
  events: GoalRunEvent[];
  featureLock: LockRecord | null;
  runnerLock: LockRecord | null;
} {
  const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');
  const events = loadEventsJsonl(eventsPath);
  const featureLock = readLockRecord(
    resolveFeatureLockPath(projectRoot, featuresDir, manifest.feature),
  );
  const runnerLock = readLockRecord(
    resolveRunnerLockPath(projectRoot, featuresDir, manifest.feature, manifest.run_id, manifest.report_dir),
  );
  return { events, featureLock, runnerLock };
}

export function resolveLatestRunId(
  projectRoot: string,
  featuresDir: string,
  feature: string,
): string | null {
  const runsDir = path.join(projectRoot, featuresDir, featureRelativePath(feature), 'goal-runs');
  if (!fs.existsSync(runsDir)) return null;

  let best: { runId: string; ts: number } | null = null;
  for (const ent of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (ent.name.startsWith('.')) continue;
    const manifestPath = path.join(runsDir, ent.name, 'manifest.json');
    const eventsPath = path.join(runsDir, ent.name, 'events.jsonl');
    let ts = 0;
    if (fs.existsSync(eventsPath)) {
      const events = loadEventsJsonl(eventsPath);
      for (const e of events) {
        if (e.type === 'run_start' && e.ts) {
          const t = new Date(e.ts).getTime();
          if (!Number.isNaN(t)) ts = Math.max(ts, t);
        }
      }
    }
    if (ts === 0 && fs.existsSync(manifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { created_at?: string };
        if (m.created_at) {
          const t = new Date(m.created_at).getTime();
          if (!Number.isNaN(t)) ts = t;
        }
      } catch {
        /* skip */
      }
    }
    if (!best || ts > best.ts) best = { runId: ent.name, ts };
  }
  return best?.runId ?? null;
}

export { STALE_LOCK_MS, isLockStale, isPidAlive };
