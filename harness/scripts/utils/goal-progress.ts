/**
 * Goal progress projection — derive progress.json / progress.md from events.jsonl + manifest + locks.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GoalManifest } from './goal-manifest';
import {
  countAgentInvokeStarts,
  loadEventsJsonl,
  resolveEffectiveRunEnd,
  resolveResumedBudget,
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
import type { WorkflowSpec } from '../../workflow-loader';

export const PROGRESS_SCHEMA_VERSION = '1.0';
export const LOCK_HEARTBEAT_MS = 60_000;
/** Freshness degrade when generated_at older than this (2–3× heartbeat). */
export const FRESHNESS_STALE_MS = LOCK_HEARTBEAT_MS * 3;
/** Soft stall window — quiet but lock fresh. */
export const SOFT_STALL_MS = 10 * 60 * 1000;
export const SNAPSHOT_THROTTLE_MS = 4_000;

export type ProgressRunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'STALLED'
  | 'WAITING_EXTERNAL'
  | 'COMPLETED'
  | 'DEFERRED'
  | 'PARTIAL'
  | 'HALTED'
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
}

interface PhaseSpan {
  phase: FeaturePhase;
  attempt: number;
  started_at: string | null;
  status: ProgressPhaseStatus;
  substep: GoalProgressSnapshot['phase']['substep'];
  recovered: boolean;
  ended: boolean;
  deferred: boolean;
  halted: boolean;
}

const TERMINAL_RUN_STATUSES = new Set<ProgressRunStatus>([
  'COMPLETED',
  'DEFERRED',
  'PARTIAL',
  'HALTED',
]);

function relPath(projectRoot: string, abs: string): string {
  return path.relative(projectRoot, abs).replace(/\\/g, '/');
}

export function resolveChainFromEvents(
  events: GoalRunEvent[],
  fallbackChain: FeaturePhase[],
): FeaturePhase[] {
  for (const e of events) {
    if (e.type === 'run_start' && Array.isArray((e as { chain?: unknown }).chain)) {
      const raw = (e as { chain: string[] }).chain;
      const filtered = raw
        .map((p) => normalizePhaseId(p, p as FeaturePhase))
        .filter((p): p is FeaturePhase =>
          (['spec', 'plan', 'coding', 'review', 'ut', 'testing'] as string[]).includes(p),
        );
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
      spans[i].status = spans[i].deferred ? 'DEFERRED' : 'PASSED';
    }
  }

  return spans;
}

function findCurrentSpan(spans: PhaseSpan[]): PhaseSpan | null {
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
    const duration =
      s.started_at != null
        ? nowMs - new Date(s.started_at).getTime()
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

export function computeLiveness(input: LivenessInput): GoalProgressSnapshot['liveness'] {
  const { events, featureLock, nowMs, runEnded, terminalStatus } = input;

  if (runEnded || (terminalStatus && TERMINAL_RUN_STATUSES.has(terminalStatus))) {
    return {
      state: 'DONE',
      last_activity_at: events.length > 0 ? (events[events.length - 1].ts ?? null) : null,
      seconds_since_activity: 0,
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

  return {
    state,
    last_activity_at:
      lastActivityMs != null ? new Date(lastActivityMs).toISOString() : null,
    seconds_since_activity: secondsSince,
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
  const { projectRoot, manifest, events, workflow } = input;
  const reportDir = manifest.report_dir;
  const eventsPath = relPath(projectRoot, path.join(projectRoot, reportDir, 'events.jsonl'));

  const fallbackChain = resolveAutoChain(
    workflow,
    manifest.start_phase,
    manifest.end_phase,
    manifest.chain_override,
  );
  const chain = resolveChainFromEvents(events, fallbackChain);

  const hasRunStart = events.some((e) => e.type === 'run_start');
  const lastRunEnd = resolveEffectiveRunEnd(events);

  const spans = buildPhaseSpans(events, chain);
  const currentSpan = findCurrentSpan(spans);
  const currentPhase = currentSpan?.phase ?? null;
  const currentIndex = currentPhase ? chain.indexOf(currentPhase) : 0;

  const budgetBase = resolveResumedBudget(events);
  const turnsUsed = countAgentInvokeStarts(events);
  const wallStart = resolveWallClockStartMs(events);
  const wallElapsed = nowMs - wallStart;
  const wallLimitMs = manifest.budget.wall_clock_minutes * 60 * 1000;
  const phaseTimeoutMs = (manifest.unattended.timeout_seconds ?? 3600) * 1000;

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

  const { percent, kind } = computeEstimatedPercent(spans, currentSpan);

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const recentEvents = events.slice(-5).map((e) => ({
    ts: e.ts ?? '',
    type: e.type ?? '',
    phase: e.phase,
  }));

  let nextAction = 'wait';
  if (status === 'PENDING') nextAction = 'await_run_start';
  else if (lastRunEnd) nextAction = 'read_goal_report';
  else if (currentSpan?.substep === 'agent_invoke') nextAction = 'wait_for_agent_invoke_end';
  else if (currentSpan?.substep === 'harness') nextAction = 'wait_for_harness_end';
  else if (currentSpan?.status === 'RETRYING') nextAction = 'wait_for_retry';
  else nextAction = 'wait_for_phase_verdict';

  const goalReportRel = path.join(reportDir, 'goal-report.json').replace(/\\/g, '/');
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
      goal_report_path: lastRunEnd ? goalReportRel : null,
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
    resolveRunnerLockPath(opts.projectRoot, opts.featuresDir, opts.feature, opts.runId),
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
  });
  snapshot = applyFreshnessDegradation(snapshot, {
    liveProbe: true,
    featureLock,
    nowMs,
  });

  if (opts.tailN && opts.tailN > 0) {
    snapshot = {
      ...snapshot,
      recent_events: events.slice(-opts.tailN).map((e) => ({
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

export function formatGoalStatusText(
  snapshot: GoalProgressSnapshot,
  feature: string,
  runId: string,
): string {
  const pct =
    snapshot.chain.percent_kind === 'indeterminate'
      ? `${snapshot.chain.current_index + 1}/${snapshot.chain.total}`
      : `${snapshot.chain.estimated_percent ?? 0}%`;
  return (
    `Goal ${feature} · run ${runId} · ${snapshot.status}\n` +
    `Current: ${snapshot.phase.name ?? '—'} / ${snapshot.phase.status} (${snapshot.phase.substep ?? '—'})\n` +
    `Liveness: ${snapshot.liveness.state} · progress ${pct}\n` +
    `Budget: turns ${snapshot.budget.turns_used}/${snapshot.budget.turns_limit}`
  );
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
  return path.join(projectRoot, featuresDir, feature, 'goal-runs', FEATURE_LOCK_NAME);
}

export function resolveRunnerLockPath(
  projectRoot: string,
  featuresDir: string,
  feature: string,
  runId: string,
): string {
  return path.join(projectRoot, featuresDir, feature, 'goal-runs', runId, RUN_LOCK_NAME);
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
    resolveRunnerLockPath(projectRoot, featuresDir, manifest.feature, manifest.run_id),
  );
  return { events, featureLock, runnerLock };
}

export function resolveLatestRunId(
  projectRoot: string,
  featuresDir: string,
  feature: string,
): string | null {
  const runsDir = path.join(projectRoot, featuresDir, feature, 'goal-runs');
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
