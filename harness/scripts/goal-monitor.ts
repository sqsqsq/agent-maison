#!/usr/bin/env ts-node
// ============================================================================
// Goal monitor — bounded, read-only notification reader for goal runs.
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import { detectRepoLayout } from '../repo-layout';
import { loadFrameworkConfig } from '../config';
import { resolveWorkflowSpec } from '../workflow-loader';
import { loadGoalManifestFromRun } from './utils/goal-manifest';
import type { GoalRunEvent } from './utils/goal-runner-phase';
import {
  buildLiveGoalStatusSnapshot,
  resolveLatestRunId,
  SOFT_STALL_MS,
  type GoalProgressSnapshot,
} from './utils/goal-progress';

const DEFAULT_MAX_SECONDS = 240;
const POLL_MS = 2_000;

type NotificationKind = 'phase_verdict' | 'run_end' | 'liveness' | 'heartbeat' | 'none';

interface IndexedEvent {
  index: number;
  event: GoalRunEvent;
}

interface MonitorNotification {
  schema_version: '1.0';
  run_id: string;
  feature: string;
  event_index: number;
  notification_kind: NotificationKind;
  status: GoalProgressSnapshot['status'];
  phase: string | null;
  phase_verdict?: string;
  phase_action?: string;
  next_phase?: string | null;
  liveness_state?: GoalProgressSnapshot['liveness']['state'];
  no_op_reason?: string;
  markdown: string;
}

function usage(): string {
  return `
Goal monitor — bounded, read-only goal notification reader

  npx ts-node scripts/goal-monitor.ts --feature <f> [--run-id latest|id] [--since-event N] [--max-seconds 240] [--json|--markdown]
`;
}

function loadIndexedEvents(absPath: string): IndexedEvent[] {
  if (!fs.existsSync(absPath)) return [];
  const lines = fs.readFileSync(absPath, 'utf-8').split(/\r?\n/);
  const out: IndexedEvent[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    try {
      out.push({ index, event: JSON.parse(line) as GoalRunEvent });
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

function eventTimeMs(e: GoalRunEvent | null | undefined): number | null {
  if (!e?.ts) return null;
  const t = new Date(e.ts).getTime();
  return Number.isNaN(t) ? null : t;
}

function isPhaseChangeEvent(e: GoalRunEvent): boolean {
  return (
    e.type === 'run_start' ||
    e.type === 'resume' ||
    e.type === 'phase_start' ||
    e.type === 'phase_verdict' ||
    e.type === 'run_end'
  );
}

function nextPhase(snapshot: GoalProgressSnapshot, phase: string | null | undefined): string | null {
  if (!phase) return null;
  const idx = snapshot.chain.phases.indexOf(phase as never);
  if (idx < 0) return snapshot.phase.name ?? null;
  return snapshot.chain.phases[idx + 1] ?? null;
}

function formatDurationMs(ms: number | null): string {
  if (ms == null || Number.isNaN(ms)) return 'unknown';
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  if (min <= 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function phaseEvidence(snapshot: GoalProgressSnapshot, phase: string | null | undefined): string | null {
  if (!phase) return null;
  const row = snapshot.phases_summary.find((p) => p.phase === phase);
  return row?.evidence ?? null;
}

function buildMarkdown(n: Omit<MonitorNotification, 'markdown'>, snapshot: GoalProgressSnapshot): string {
  const header = `Goal ${n.feature} · run ${n.run_id}`;
  if (n.notification_kind === 'phase_verdict') {
    const evidence = phaseEvidence(snapshot, n.phase);
    const next = n.next_phase ? ` Next: ${n.next_phase}.` : '';
    return [
      `## ${header}`,
      '',
      `${n.phase} phase verdict: **${n.phase_verdict ?? 'UNKNOWN'}** (${n.phase_action ?? 'unknown'}).${next}`,
      `Status: ${n.status}. Liveness: ${snapshot.liveness.state}.`,
      evidence ? `Evidence: \`${evidence}\`` : null,
    ].filter(Boolean).join('\n') + '\n';
  }

  if (n.notification_kind === 'run_end') {
    return [
      `## ${header}`,
      '',
      `Goal run ended: **${n.status}**.`,
      snapshot.artifacts.goal_report_path ? `Report: \`${snapshot.artifacts.goal_report_path}\`` : null,
    ].filter(Boolean).join('\n') + '\n';
  }

  if (n.notification_kind === 'liveness') {
    return [
      `## ${header}`,
      '',
      `Goal run needs attention: **${snapshot.liveness.state}**.`,
      `Current: ${snapshot.phase.name ?? 'none'} / ${snapshot.phase.status}.`,
      snapshot.status_reason ? `Reason: ${snapshot.status_reason}.` : null,
      `Next action: ${snapshot.next_action}.`,
    ].filter(Boolean).join('\n') + '\n';
  }

  if (n.notification_kind === 'heartbeat') {
    return [
      `## ${header}`,
      '',
      `Still running: ${snapshot.phase.name ?? 'none'} / ${snapshot.phase.status}.`,
      `Last activity: ${
        snapshot.liveness.seconds_since_activity != null
          ? `${snapshot.liveness.seconds_since_activity}s ago`
          : 'unknown'
      }.`,
      `Phase elapsed: ${formatDurationMs(snapshot.phase.elapsed_ms)}.`,
      `Progress: ${snapshot.chain.current_index + 1}/${snapshot.chain.total}.`,
    ].join('\n') + '\n';
  }

  return [
    `Goal ${n.feature} · run ${n.run_id} · no notification`,
    `Status: ${snapshot.status}. Current: ${snapshot.phase.name ?? 'none'} / ${snapshot.phase.status}.`,
    n.no_op_reason ? `Reason: ${n.no_op_reason}.` : null,
  ].filter(Boolean).join('\n') + '\n';
}

function notificationBase(
  kind: NotificationKind,
  eventIndex: number,
  snapshot: GoalProgressSnapshot,
): Omit<MonitorNotification, 'markdown'> {
  return {
    schema_version: '1.0',
    run_id: snapshot.run_id,
    feature: snapshot.feature,
    event_index: eventIndex,
    notification_kind: kind,
    status: snapshot.status,
    phase: snapshot.phase.name,
    liveness_state: snapshot.liveness.state,
  };
}

function withMarkdown(
  base: Omit<MonitorNotification, 'markdown'>,
  snapshot: GoalProgressSnapshot,
): MonitorNotification {
  return { ...base, markdown: buildMarkdown(base, snapshot) };
}

function lastPhaseChangeBefore(events: IndexedEvent[], index: number): IndexedEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const item = events[i];
    if (item.index > index) continue;
    if (isPhaseChangeEvent(item.event)) return item;
  }
  return null;
}

function heartbeatNotification(
  events: IndexedEvent[],
  sinceEvent: number,
  snapshot: GoalProgressSnapshot,
): MonitorNotification | null {
  const candidates = events.filter(
    (item) => item.index > sinceEvent && item.event.type === 'heartbeat',
  );
  for (const item of candidates) {
    const heartbeatMs = eventTimeMs(item.event);
    if (heartbeatMs == null) continue;
    const phaseChange = lastPhaseChangeBefore(events, item.index);
    const phaseChangeMs = eventTimeMs(phaseChange?.event);
    if (phaseChangeMs == null) continue;

    const elapsed = heartbeatMs - phaseChangeMs;
    if (elapsed < SOFT_STALL_MS) continue;

    const prior = events
      .filter((e) => e.index <= sinceEvent)
      .reverse()
      .find((e) => e.event.type === 'heartbeat' || isPhaseChangeEvent(e.event));
    const priorMs = eventTimeMs(prior?.event);
    const priorPhaseChange = prior ? lastPhaseChangeBefore(events, prior.index) : phaseChange;
    const priorPhaseChangeMs = eventTimeMs(priorPhaseChange?.event) ?? phaseChangeMs;
    const priorElapsed = priorMs != null ? priorMs - priorPhaseChangeMs : 0;
    const priorBucket = Math.floor(Math.max(0, priorElapsed) / SOFT_STALL_MS);
    const bucket = Math.floor(elapsed / SOFT_STALL_MS);
    if (bucket <= priorBucket) continue;

    return withMarkdown(notificationBase('heartbeat', item.index, snapshot), snapshot);
  }
  return null;
}

function classifyNotification(
  events: IndexedEvent[],
  sinceEvent: number,
  snapshot: GoalProgressSnapshot,
): MonitorNotification | null {
  for (const item of events) {
    if (item.index <= sinceEvent) continue;
    const e = item.event;
    if (e.type === 'phase_verdict') {
      return withMarkdown(
        {
          ...notificationBase('phase_verdict', item.index, snapshot),
          phase: e.phase ?? snapshot.phase.name,
          phase_verdict: e.verdict,
          phase_action: e.action,
          next_phase: nextPhase(snapshot, e.phase),
        },
        snapshot,
      );
    }
    if (e.type === 'run_end') {
      return withMarkdown(
        {
          ...notificationBase('run_end', item.index, snapshot),
          phase: null,
        },
        snapshot,
      );
    }
  }

  const latestIndex = events.length > 0 ? events[events.length - 1].index : -1;
  if (
    (snapshot.liveness.state === 'STALLED' || snapshot.liveness.state === 'ORPHAN_SUSPECTED') &&
    latestIndex > sinceEvent
  ) {
    // Edge-trigger: only surface a hard liveness anomaly when new evidence has
    // appeared past the cursor. Without this gate an orphaned run (process dead,
    // event stream frozen) keeps `latestIndex === sinceEvent`, so every loop
    // iteration would re-emit an identical liveness notification in ~0s — the
    // bounded wait collapses into a busy-spin. With it, the anomaly fires once;
    // a follow-up call with no newer events falls through to the bounded no-op.
    return withMarkdown(notificationBase('liveness', latestIndex, snapshot), snapshot);
  }

  return heartbeatNotification(events, sinceEvent, snapshot);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<number> {
  const argv = minimist(process.argv.slice(2), {
    string: ['feature', 'run-id', 'since-event', 'max-seconds'],
    boolean: ['json', 'markdown', 'help'],
    alias: { f: 'feature', h: 'help' },
    default: { 'run-id': 'latest' },
  });

  if (argv.help) {
    console.log(usage());
    return 0;
  }

  const feature = argv.feature ? String(argv.feature) : '';
  if (!feature) {
    console.error('[goal-monitor] BLOCKER: --feature required');
    return 1;
  }

  const layout = detectRepoLayout(__dirname);
  const projectRoot = layout.projectRoot;
  const cfg = loadFrameworkConfig(projectRoot);
  const featuresDir = cfg.paths.features_dir ?? 'doc/features';
  const workflow = resolveWorkflowSpec(projectRoot, { config: cfg, frameworkRoot: layout.frameworkRoot });

  let runId = String(argv['run-id'] ?? 'latest');
  if (runId === 'latest') {
    const latest = resolveLatestRunId(projectRoot, featuresDir, feature);
    if (!latest) {
      console.error(`[goal-monitor] no goal runs for feature ${feature}`);
      return 1;
    }
    runId = latest;
  }

  const sinceEvent = Number(argv['since-event'] ?? -1);
  const maxSecondsRaw = argv['max-seconds'] === undefined
    ? DEFAULT_MAX_SECONDS
    : Number(argv['max-seconds']);
  const maxSeconds = Number.isFinite(maxSecondsRaw) ? Math.max(0, maxSecondsRaw) : DEFAULT_MAX_SECONDS;
  const deadline = Date.now() + maxSeconds * 1000;
  const wantJson = Boolean(argv.json);

  let manifest;
  try {
    manifest = loadGoalManifestFromRun(projectRoot, runId, { feature, featuresDir });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const eventsPath = path.join(projectRoot, manifest.report_dir, 'events.jsonl');

  while (true) {
    const snapshot = buildLiveGoalStatusSnapshot({
      projectRoot,
      manifest,
      workflow,
      featuresDir,
      feature,
      runId,
      tailN: 5,
    });
    const events = loadIndexedEvents(eventsPath);
    const notification = classifyNotification(events, sinceEvent, snapshot);
    if (notification) {
      if (wantJson) console.log(JSON.stringify(notification, null, 2));
      else console.log(notification.markdown);
      return 0;
    }

    if (Date.now() >= deadline) {
      const latestIndex = events.length > 0 ? events[events.length - 1].index : -1;
      const base = {
        ...notificationBase('none', latestIndex, snapshot),
        no_op_reason: 'timeout_no_notification',
      };
      const noOp = withMarkdown(base, snapshot);
      if (wantJson) console.log(JSON.stringify(noOp, null, 2));
      else console.log(noOp.markdown);
      return 0;
    }

    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  }
}

void main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error((err as Error).message ?? err);
    process.exit(1);
  });
