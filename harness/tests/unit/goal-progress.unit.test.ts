// goal-progress.unit.test.ts — progress projection, stall, freshness

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadWorkflowSpec } from '../../workflow-loader';
import type { GoalManifest } from '../../scripts/utils/goal-manifest';
import {
  applyFreshnessDegradation,
  atomicRenameWithRetry,
  buildLiveGoalStatusSnapshot,
  computeLiveness,
  FRESHNESS_STALE_MS,
  formatGoalStatusJson,
  formatGoalStatusText,
  generateProgressMarkdown,
  projectGoalProgress,
  resolveChainFromEvents,
  resolveLatestRunId,
  runStatusWatchLoop,
  shouldThrottleSnapshot,
  writeProgressSnapshotAtomic,
} from '../../scripts/utils/goal-progress';
import { isLockStale } from '../../scripts/utils/goal-run-lock';
import type { GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
const HARNESS_ROOT = path.join(__dirname, '../..');
const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');

function runGoalStatusCli(
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  return runGoalCli('scripts/goal-status.ts', args);
}

function runGoalMonitorCli(
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  return runGoalCli('scripts/goal-monitor.ts', args);
}

function runGoalCli(
  scriptRel: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const localTsNode = path.join(HARNESS_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const cwd = HARNESS_ROOT;
  const r = fs.existsSync(localTsNode)
    ? spawnSync(process.execPath, [localTsNode, scriptRel, ...args], {
        cwd,
        encoding: 'utf-8',
        shell: false,
        timeout: 120_000,
      })
    : spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['ts-node', scriptRel, ...args], {
        cwd,
        encoding: 'utf-8',
        shell: process.platform === 'win32',
        timeout: 120_000,
      });
  return {
    status: r.status,
    stdout: (r.stdout ?? '').toString(),
    stderr: (r.stderr ?? '').toString(),
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function mkManifest(overrides: Partial<GoalManifest> = {}): GoalManifest {
  return {
    schema_version: '1.0',
    start_phase: 'spec',
    end_phase: 'testing',
    feature: 'feat-a',
    adapter: 'generic',
    budget: { max_retries_per_phase: 2, max_total_turns: 20, wall_clock_minutes: 240 },
    dependency_policy: {
      deferrable_blocking_classes: ['externalBlocked'],
      deferrable_failure_kinds: ['device_blocked'],
      propagate_to_downstream: true,
    },
    unattended: {
      write_mode: 'workspace-write',
      approval_mode: 'never',
      timeout_seconds: 3600,
    },
    run_id: '20260610T120000Z',
    report_dir: 'doc/features/feat-a/goal-runs/20260610T120000Z',
    created_at: '2026-06-10T12:00:00.000Z',
    ...overrides,
  };
}

function happyEvents(): GoalRunEvent[] {
  const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
  return [
    { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain },
    { ts: '2026-06-10T12:00:01.000Z', type: 'phase_start', phase: 'spec', attempt: 1 },
    { ts: '2026-06-10T12:00:02.000Z', type: 'agent_invoke_start', phase: 'spec', invoke_id: 'p1' },
    { ts: '2026-06-10T12:05:00.000Z', type: 'agent_invoke_end', phase: 'spec', invoke_id: 'p1', exit_code: 0 },
    { ts: '2026-06-10T12:05:01.000Z', type: 'harness_start', phase: 'spec' },
    { ts: '2026-06-10T12:08:00.000Z', type: 'harness_end', phase: 'spec', exit_code: 0 },
    {
      ts: '2026-06-10T12:08:01.000Z',
      type: 'phase_verdict',
      phase: 'spec',
      verdict: 'PASS',
      action: 'advance',
    },
    { ts: '2026-06-10T12:08:02.000Z', type: 'run_end', status: 'COMPLETED' },
  ] as GoalRunEvent[];
}

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'resolveChainFromEvents: prefers run_start.chain',
    run: () => {
      const events = [{ type: 'run_start', chain: ['spec', 'coding'] }] as GoalRunEvent[];
      const chain = resolveChainFromEvents(events, ['spec', 'plan', 'coding']);
      assert(chain.join(',') === 'spec,coding', `got ${chain.join(',')}`);
    },
  },
  {
    name: 'projectGoalProgress: happy path → COMPLETED',
    run: () => {
      const manifest = mkManifest();
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest,
        events: happyEvents(),
        workflow,
        nowMs: new Date('2026-06-10T12:10:00.000Z').getTime(),
      });
      assert(snap.status === 'COMPLETED', `status ${snap.status}`);
      assert(snap.chain.phases.length === 6, 'chain len');
    },
  },
  {
    name: 'projectGoalProgress: completed phase duration stops at phase_verdict',
    run: () => {
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest(),
        events: happyEvents(),
        workflow,
        nowMs: new Date('2026-06-10T13:00:00.000Z').getTime(),
      });
      const specRow = snap.phases_summary.find((p) => p.phase === 'spec');
      if (!specRow) throw new Error('spec row');
      assert(specRow.status === 'PASSED', `spec status ${specRow.status}`);
      assert(specRow.duration_ms === 480_000, `duration ${specRow.duration_ms}`);
    },
  },
  {
    name: 'projectGoalProgress: running phase duration still grows with now',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'phase_start', phase: 'coding', attempt: 1 },
        { ts: '2026-06-10T12:00:02.000Z', type: 'agent_invoke_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:05:01.000Z').getTime(),
      });
      const codingRow = snap.phases_summary.find((p) => p.phase === 'coding');
      if (!codingRow) throw new Error('coding row');
      assert(codingRow.status === 'AGENT_RUNNING', `coding status ${codingRow.status}`);
      assert(codingRow.duration_ms === 300_000, `duration ${codingRow.duration_ms}`);
    },
  },
  {
    name: 'soft window: quiet but lock fresh → SUSPECTED_STALL not STALLED run status',
    run: () => {
      const now = Date.now();
      const old = new Date(now - 12 * 60 * 1000).toISOString();
      const events: GoalRunEvent[] = [
        { ts: old, type: 'run_start', chain: ['coding'] },
        { ts: old, type: 'phase_start', phase: 'coding' },
        { ts: old, type: 'agent_invoke_start', phase: 'coding', invoke_id: 'c1' },
        { ts: new Date(now - 11 * 60 * 1000).toISOString(), type: 'heartbeat', phase: 'coding' },
      ];
      const manifest = mkManifest({ start_phase: 'coding', end_phase: 'coding' });
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest,
        events,
        workflow,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: old,
          updated_at: new Date(now - 30_000).toISOString(),
        },
        nowMs: now,
        liveProbe: true,
      });
      assert(snap.liveness.state === 'SUSPECTED_STALL', `liveness ${snap.liveness.state}`);
      assert(snap.status === 'RUNNING', `status ${snap.status}`);
    },
  },
  {
    name: 'half recovery: unclosed invoke + recovered verdict → not STALLED',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding', 'review'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding', invoke_id: 'c1' },
        {
          ts: '2026-06-10T12:30:00.000Z',
          type: 'phase_verdict',
          phase: 'coding',
          verdict: 'PASS',
          action: 'advance',
          recovered: true,
        },
        { ts: '2026-06-10T12:30:01.000Z', type: 'agent_invoke_recovered', phase: 'coding', invoke_id: 'c1' },
        { ts: '2026-06-10T12:30:02.000Z', type: 'phase_start', phase: 'review' },
      ];
      const manifest = mkManifest({ start_phase: 'coding', end_phase: 'review' });
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest,
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:35:00.000Z').getTime(),
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: '2026-06-10T12:00:00.000Z',
          updated_at: '2026-06-10T12:34:00.000Z',
        },
      });
      assert(snap.status !== 'STALLED', `status ${snap.status}`);
      assert(snap.phase.name === 'review', `phase ${snap.phase.name}`);
    },
  },
  {
    name: 'freshness: terminal snapshot not degraded',
    run: () => {
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest(),
        events: happyEvents(),
        workflow,
      });
      const stale = {
        ...snap,
        generated_at: new Date(Date.now() - FRESHNESS_STALE_MS * 2).toISOString(),
      };
      const out = applyFreshnessDegradation(stale, { liveProbe: false });
      assert(out.status === 'COMPLETED', `degraded terminal ${out.status}`);
    },
  },
  {
    name: 'freshness: non-terminal stale file consumer → UNKNOWN',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:01:00.000Z').getTime(),
      });
      const stale = {
        ...snap,
        generated_at: new Date(Date.now() - FRESHNESS_STALE_MS * 2).toISOString(),
      };
      const out = applyFreshnessDegradation(stale, { liveProbe: false });
      assert(out.status === 'UNKNOWN', `status ${out.status}`);
    },
  },
  {
    name: 'isLockStale: same host dead pid immediately stale',
    run: () => {
      const rec = {
        ownerId: 'a',
        pid: 99999999,
        hostname: os.hostname(),
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      assert(isLockStale(rec), 'dead pid stale');
    },
  },
  {
    name: 'writeProgressSnapshotAtomic: JSON parseable',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-progress-'));
      const manifest = mkManifest();
      const snap = projectGoalProgress({
        projectRoot: root,
        manifest,
        events: happyEvents(),
        workflow,
      });
      writeProgressSnapshotAtomic(root, manifest.report_dir, snap, true);
      const jsonPath = path.join(root, manifest.report_dir, 'progress.json');
      const mdPath = path.join(root, manifest.report_dir, 'progress.md');
      assert(fs.existsSync(jsonPath), 'progress.json');
      assert(fs.existsSync(mdPath), 'progress.md');
      JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'resolveLatestRunId: ignores dot dirs',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-latest-'));
      const runs = path.join(root, 'doc/features/f/goal-runs');
      fs.mkdirSync(path.join(runs, '20260101T000000Z'), { recursive: true });
      fs.mkdirSync(path.join(runs, '20260201T000000Z'), { recursive: true });
      fs.writeFileSync(
        path.join(runs, '20260201T000000Z', 'events.jsonl'),
        JSON.stringify({ ts: '2026-02-01T00:00:00.000Z', type: 'run_start' }) + '\n',
        'utf-8',
      );
      const latest = resolveLatestRunId(root, 'doc/features', 'f');
      assert(latest === '20260201T000000Z', `latest ${latest}`);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'shouldThrottleSnapshot respects interval',
    run: () => {
      const st = { lastWriteMs: 1000 };
      assert(shouldThrottleSnapshot(st, 2000), 'throttled');
      assert(!shouldThrottleSnapshot(st, 6000), 'not throttled');
    },
  },
  {
    name: 'lingering_pipe diagnostic not hard stall alone',
    run: () => {
      const now = Date.now();
      const events: GoalRunEvent[] = [
        { ts: new Date(now - 60_000).toISOString(), type: 'run_start', chain: ['coding'] },
        { ts: new Date(now - 50_000).toISOString(), type: 'agent_invoke_start', phase: 'coding' },
        {
          ts: new Date(now - 40_000).toISOString(),
          type: 'agent_invoke_end',
          phase: 'coding',
          lingering_pipe: true,
        },
      ];
      const lv = computeLiveness({
        events,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: new Date(now - 60_000).toISOString(),
          updated_at: new Date(now - 5_000).toISOString(),
        },
        runnerLock: null,
        agentOutputMtimeMs: now - 30_000,
        phaseTimeoutMs: 3600_000,
        runEnded: false,
        terminalStatus: null,
        nowMs: now,
        liveProbe: true,
        lastLingeringPipe: true,
      });
      assert(lv.signals.lingering_pipe === true, 'lingering');
      assert(lv.state !== 'STALLED', `state ${lv.state}`);
    },
  },
  {
    name: 'hard stall: timed_out agent_invoke_end before verdict → STALLED',
    run: () => {
      const now = new Date('2026-06-10T13:00:00.000Z').getTime();
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
        {
          ts: '2026-06-10T13:00:00.000Z',
          type: 'agent_invoke_end',
          phase: 'coding',
          timed_out: true,
          exit_code: 1,
        },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: now,
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: '2026-06-10T12:00:00.000Z',
          updated_at: '2026-06-10T12:59:00.000Z',
        },
      });
      assert(snap.liveness.state === 'STALLED', `liveness ${snap.liveness.state}`);
      assert(snap.status === 'STALLED', `status ${snap.status}`);
    },
  },
  {
    name: 'WAITING_EXTERNAL when upstream phase deferred (ended)',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['spec', 'coding'] },
        {
          ts: '2026-06-10T12:10:00.000Z',
          type: 'phase_verdict',
          phase: 'spec',
          verdict: 'INCOMPLETE',
          action: 'defer_external_and_continue_if_allowed',
        },
        { ts: '2026-06-10T12:11:00.000Z', type: 'phase_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'spec', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:15:00.000Z').getTime(),
      });
      assert(snap.status === 'WAITING_EXTERNAL', `status ${snap.status}`);
      assert(snap.status_reason === 'upstream_deferred', `reason ${snap.status_reason}`);
    },
  },
  {
    name: 'retry phase → percent_kind indeterminate',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'phase_start', phase: 'coding', attempt: 2 },
        { ts: '2026-06-10T12:00:02.000Z', type: 'agent_invoke_start', phase: 'coding' },
        { ts: '2026-06-10T12:00:03.000Z', type: 'agent_invoke_start', phase: 'coding' },
        {
          ts: '2026-06-10T12:05:00.000Z',
          type: 'phase_verdict',
          phase: 'coding',
          verdict: 'FAIL',
          action: 'retry',
        },
        { ts: '2026-06-10T12:05:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:10:00.000Z').getTime(),
      });
      assert(snap.chain.percent_kind === 'indeterminate', `kind ${snap.chain.percent_kind}`);
    },
  },
  {
    name: 'applyFreshnessDegradation liveProbe: pid dead → ORPHAN branch',
    run: () => {
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest(),
        events: [
          { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
          { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
        ],
        workflow,
        nowMs: new Date('2026-06-10T12:01:00.000Z').getTime(),
      });
      const stale = {
        ...snap,
        generated_at: new Date(Date.now() - FRESHNESS_STALE_MS * 2).toISOString(),
      };
      const out = applyFreshnessDegradation(stale, {
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: 99999999,
          hostname: os.hostname(),
          started_at: stale.generated_at,
          updated_at: stale.generated_at,
        },
        nowMs: Date.now(),
      });
      assert(out.liveness.state === 'ORPHAN_SUSPECTED', `state ${out.liveness.state}`);
    },
  },
  {
    name: 'ORPHAN_SUSPECTED projection: stale lock + dead pid + no run_end',
    run: () => {
      const now = new Date('2026-06-10T13:00:00.000Z').getTime();
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: now,
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: 99999999,
          hostname: os.hostname(),
          started_at: '2026-06-10T11:00:00.000Z',
          updated_at: '2026-06-10T11:00:00.000Z',
        },
      });
      assert(snap.liveness.state === 'ORPHAN_SUSPECTED', `liveness ${snap.liveness.state}`);
    },
  },
  {
    name: 'applyFreshnessDegradation liveProbe: cross-host → UNKNOWN',
    run: () => {
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest(),
        events: [
          { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
          { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
        ],
        workflow,
      });
      const stale = {
        ...snap,
        generated_at: new Date(Date.now() - FRESHNESS_STALE_MS * 2).toISOString(),
      };
      const out = applyFreshnessDegradation(stale, {
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: 12345,
          hostname: 'remote-host-not-local',
          started_at: stale.generated_at,
          updated_at: stale.generated_at,
        },
        nowMs: Date.now(),
      });
      assert(out.status === 'UNKNOWN', `status ${out.status}`);
      assert(out.status_reason === 'snapshot_stale_cross_host', `reason ${out.status_reason}`);
    },
  },
  {
    name: 'applyFreshnessDegradation liveProbe: pid alive → SUSPECTED_STALL branch',
    run: () => {
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest(),
        events: [
          { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
          { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
        ],
        workflow,
      });
      const stale = {
        ...snap,
        generated_at: new Date(Date.now() - FRESHNESS_STALE_MS * 2).toISOString(),
      };
      const out = applyFreshnessDegradation(stale, {
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: stale.generated_at,
          updated_at: stale.generated_at,
        },
        nowMs: Date.now(),
      });
      assert(out.status === 'RUNNING', `status ${out.status}`);
      assert(out.liveness.state === 'SUSPECTED_STALL', `state ${out.liveness.state}`);
    },
  },
  {
    name: 'recovery without agent_invoke_recovered: recovered verdict only',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding', 'review'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding', invoke_id: 'c1' },
        {
          ts: '2026-06-10T12:30:00.000Z',
          type: 'phase_verdict',
          phase: 'coding',
          verdict: 'PASS',
          action: 'advance',
          recovered: true,
        },
        { ts: '2026-06-10T12:30:02.000Z', type: 'phase_start', phase: 'review' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'review' }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:35:00.000Z').getTime(),
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: '2026-06-10T12:00:00.000Z',
          updated_at: '2026-06-10T12:34:00.000Z',
        },
      });
      assert(snap.status !== 'STALLED', `status ${snap.status}`);
      assert(snap.phase.name === 'review', `phase ${snap.phase.name}`);
    },
  },
  {
    name: 'long harness window + heartbeat → RUNNING not degraded',
    run: () => {
      const now = new Date('2026-06-10T12:20:00.000Z').getTime();
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
        { ts: '2026-06-10T12:05:00.000Z', type: 'agent_invoke_end', phase: 'coding', exit_code: 0 },
        { ts: '2026-06-10T12:05:01.000Z', type: 'harness_start', phase: 'coding' },
        { ts: '2026-06-10T12:15:00.000Z', type: 'heartbeat', phase: 'coding', substep: 'harness' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: now,
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: '2026-06-10T12:00:00.000Z',
          updated_at: '2026-06-10T12:19:00.000Z',
        },
      });
      assert(snap.status === 'RUNNING', `status ${snap.status}`);
      assert(snap.liveness.state !== 'STALLED', `liveness ${snap.liveness.state}`);
    },
  },
  {
    name: 'formatGoalStatusJson: valid JSON with schema_version',
    run: () => {
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest(),
        events: happyEvents(),
        workflow,
      });
      const json = formatGoalStatusJson(snap);
      const parsed = JSON.parse(json) as { schema_version: string; phases_summary: unknown[] };
      assert(parsed.schema_version === '1.0', 'schema');
      assert(Array.isArray(parsed.phases_summary), 'phases_summary');
    },
  },
  {
    name: 'generateProgressMarkdown: includes phase table and budget',
    run: () => {
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest(),
        events: happyEvents(),
        workflow,
      });
      const md = generateProgressMarkdown(snap);
      assert(md.includes('## Phases'), 'phases section');
      assert(md.includes('| Duration |'), 'duration col');
      assert(md.includes('Budget:'), 'budget');
      assert(md.includes('spec'), 'phase row');
    },
  },
  {
    name: 'hard stall: unclosed invoke exceeds phase_timeout_ms → STALLED',
    run: () => {
      const manifest = mkManifest({
        start_phase: 'coding',
        end_phase: 'coding',
        unattended: {
          write_mode: 'workspace-write',
          approval_mode: 'never',
          timeout_seconds: 600,
        },
      });
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest,
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:15:00.000Z').getTime(),
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: '2026-06-10T12:00:00.000Z',
          updated_at: '2026-06-10T12:14:00.000Z',
        },
      });
      assert(snap.liveness.state === 'STALLED', `liveness ${snap.liveness.state}`);
      assert(snap.status === 'STALLED', `status ${snap.status}`);
    },
  },
  {
    name: 'resume after run_end: old phase_verdict + HALTED not treated as terminal',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T11:00:00.000Z', type: 'run_start', chain: ['coding', 'review'] },
        { ts: '2026-06-10T11:05:00.000Z', type: 'phase_start', phase: 'coding', attempt: 1 },
        {
          ts: '2026-06-10T11:20:00.000Z',
          type: 'phase_verdict',
          phase: 'coding',
          verdict: 'PASS',
          action: 'advance',
        },
        { ts: '2026-06-10T11:21:00.000Z', type: 'phase_start', phase: 'review', attempt: 1 },
        { ts: '2026-06-10T11:22:00.000Z', type: 'agent_invoke_start', phase: 'review' },
        {
          ts: '2026-06-10T11:30:00.000Z',
          type: 'phase_verdict',
          phase: 'review',
          verdict: 'FAIL',
          action: 'halt',
        },
        {
          ts: '2026-06-10T11:30:01.000Z',
          type: 'run_end',
          status: 'HALTED',
        },
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding', 'review'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'resume', start_index: 1, start_phase: 'review' },
        { ts: '2026-06-10T12:00:02.000Z', type: 'phase_start', phase: 'review', attempt: 1 },
        { ts: '2026-06-10T12:00:03.000Z', type: 'agent_invoke_start', phase: 'review' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'review' }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:05:00.000Z').getTime(),
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: '2026-06-10T12:00:00.000Z',
          updated_at: '2026-06-10T12:04:00.000Z',
        },
      });
      assert(snap.status === 'RUNNING', `status ${snap.status}`);
      assert(snap.phase.name === 'review', `phase ${snap.phase.name}`);
      assert(snap.phase.status === 'AGENT_RUNNING', `phase status ${snap.phase.status}`);
      const codingRow = snap.phases_summary.find((p) => p.phase === 'coding');
      assert(codingRow?.status === 'PASSED', `coding ${codingRow?.status}`);
    },
  },
  {
    name: 'resume clears dangling invoke: no false STALLED before new agent_invoke_start',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T10:00:00.000Z', type: 'run_start', chain: ['review'] },
        { ts: '2026-06-10T10:00:01.000Z', type: 'agent_invoke_start', phase: 'review' },
        {
          ts: '2026-06-10T11:00:00.000Z',
          type: 'phase_verdict',
          phase: 'review',
          verdict: 'FAIL',
          action: 'halt',
        },
        { ts: '2026-06-10T11:00:01.000Z', type: 'run_end', status: 'HALTED' },
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['review'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'resume', start_index: 0, start_phase: 'review' },
        { ts: '2026-06-10T12:00:02.000Z', type: 'phase_start', phase: 'review', attempt: 1 },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({
          start_phase: 'review',
          end_phase: 'review',
          unattended: {
            write_mode: 'workspace-write',
            approval_mode: 'never',
            timeout_seconds: 600,
          },
        }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:00:05.000Z').getTime(),
        liveProbe: true,
        featureLock: {
          ownerId: 'x',
          pid: process.pid,
          hostname: os.hostname(),
          started_at: '2026-06-10T12:00:00.000Z',
          updated_at: '2026-06-10T12:00:04.000Z',
        },
      });
      assert(snap.status === 'RUNNING', `status ${snap.status}`);
      assert(snap.liveness.state !== 'STALLED', `liveness ${snap.liveness.state}`);
    },
  },
  {
    name: 'resume completed: latest run_end after resume wins',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T11:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T11:30:00.000Z', type: 'run_end', status: 'HALTED' },
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'resume', start_index: 0, start_phase: 'coding' },
        { ts: '2026-06-10T12:00:02.000Z', type: 'phase_start', phase: 'coding', attempt: 1 },
        { ts: '2026-06-10T12:05:00.000Z', type: 'run_end', status: 'COMPLETED' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:10:00.000Z').getTime(),
      });
      assert(snap.status === 'COMPLETED', `status ${snap.status}`);
    },
  },
  {
    name: 'legacy events: no phase_start/harness_start still projects RUNNING agent',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: new Date('2026-06-10T12:05:00.000Z').getTime(),
      });
      assert(snap.status === 'RUNNING', `status ${snap.status}`);
      assert(snap.phase.name === 'coding', `phase ${snap.phase.name}`);
      assert(snap.phase.status === 'AGENT_RUNNING', `phase status ${snap.phase.status}`);
    },
  },
  {
    name: 'atomicRenameWithRetry: EPERM twice then success',
    run: () => {
      let calls = 0;
      const renameFn = (): void => {
        calls += 1;
        if (calls < 3) {
          const err = new Error('EPERM') as NodeJS.ErrnoException;
          err.code = 'EPERM';
          throw err;
        }
      };
      const slept: number[] = [];
      const ok = atomicRenameWithRetry('a', 'b', {
        renameFn,
        sleepMs: (ms) => slept.push(ms),
      });
      assert(ok, 'should succeed');
      assert(calls === 3, `calls ${calls}`);
      assert(slept.length === 2, `slept ${slept.length}`);
    },
  },
  {
    name: 'atomicRenameWithRetry: EPERM exhaust → false',
    run: () => {
      const renameFn = (): void => {
        const err = new Error('EPERM') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      };
      const ok = atomicRenameWithRetry('a', 'b', { renameFn, sleepMs: () => {} });
      assert(!ok, 'should fail');
    },
  },
  {
    name: 'writeProgressSnapshotAtomic: writes parseable progress.json',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-snap-'));
      const reportDir = 'doc/features/f/goal-runs/r1';
      const snap = projectGoalProgress({
        projectRoot: root,
        manifest: mkManifest({ report_dir: reportDir }),
        events: happyEvents(),
        workflow,
      });
      writeProgressSnapshotAtomic(root, reportDir, snap);
      const jsonPath = path.join(root, reportDir, 'progress.json');
      assert(fs.existsSync(jsonPath), 'progress.json missing');
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as { status: string };
      assert(parsed.status === 'COMPLETED', `status ${parsed.status}`);
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  {
    name: 'formatGoalStatusText: human summary lines',
    run: () => {
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest(),
        events: happyEvents(),
        workflow,
      });
      const text = formatGoalStatusText(snap, 'feat-a', '20260610T120000Z');
      assert(text.includes('feat-a'), 'feature');
      assert(text.includes('COMPLETED'), 'status');
      assert(text.includes('Budget:'), 'budget');
    },
  },
  {
    name: 'runStatusWatchLoop: maxTicks=2 renders twice',
    run: async () => {
      let renders = 0;
      await runStatusWatchLoop({
        render: () => {
          renders += 1;
        },
        intervalMs: 10,
        maxTicks: 2,
      });
      assert(renders === 2, `renders ${renders}`);
    },
  },
  {
    name: 'runStatusWatchLoop: maxTicks=1 renders once without interval',
    run: async () => {
      let renders = 0;
      let intervals = 0;
      await runStatusWatchLoop({
        render: () => {
          renders += 1;
        },
        maxTicks: 1,
        setIntervalFn: () => {
          intervals += 1;
          return 0 as unknown as NodeJS.Timeout;
        },
      });
      assert(renders === 1, `renders ${renders}`);
      assert(intervals === 0, `intervals ${intervals}`);
    },
  },
  {
    name: 'goal-status CLI: --json smoke from repo fixture',
    run: () => {
      const feature = `goal-cli-${process.pid}`;
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(FRAMEWORK_ROOT, reportRel);
      const manifest = mkManifest({ feature, report_dir: reportRel });
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        happyEvents().map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      try {
        const r = runGoalStatusCli(['--feature', feature, '--run-id', runId, '--json']);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        const parsed = JSON.parse(r.stdout.trim()) as { status: string; schema_version: string };
        assert(parsed.schema_version === '1.0', 'schema');
        assert(parsed.status === 'COMPLETED', `status ${parsed.status}`);
      } finally {
        fs.rmSync(path.join(FRAMEWORK_ROOT, 'doc/features', feature), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: phase_verdict edge notification',
    run: () => {
      const feature = `goal-monitor-verdict-${process.pid}`;
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(FRAMEWORK_ROOT, reportRel);
      const manifest = mkManifest({ feature, report_dir: reportRel });
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        happyEvents().map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      try {
        const r = runGoalMonitorCli([
          '--feature',
          feature,
          '--run-id',
          runId,
          '--since-event',
          '5',
          '--max-seconds',
          '0',
          '--json',
        ]);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        const parsed = JSON.parse(r.stdout.trim()) as {
          notification_kind: string;
          event_index: number;
          phase_verdict: string;
        };
        assert(parsed.notification_kind === 'phase_verdict', `kind ${parsed.notification_kind}`);
        assert(parsed.event_index === 6, `event_index ${parsed.event_index}`);
        assert(parsed.phase_verdict === 'PASS', `verdict ${parsed.phase_verdict}`);
      } finally {
        fs.rmSync(path.join(FRAMEWORK_ROOT, 'doc/features', feature), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: no-op timeout when no new edge',
    run: () => {
      const feature = `goal-monitor-noop-${process.pid}`;
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(FRAMEWORK_ROOT, reportRel);
      const manifest = mkManifest({ feature, report_dir: reportRel });
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        happyEvents().map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      try {
        const r = runGoalMonitorCli([
          '--feature',
          feature,
          '--run-id',
          runId,
          '--since-event',
          '7',
          '--max-seconds',
          '0',
          '--json',
        ]);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        const parsed = JSON.parse(r.stdout.trim()) as {
          notification_kind: string;
          no_op_reason?: string;
        };
        assert(parsed.notification_kind === 'none', `kind ${parsed.notification_kind}`);
        assert(parsed.no_op_reason === 'timeout_no_notification', `reason ${parsed.no_op_reason}`);
      } finally {
        fs.rmSync(path.join(FRAMEWORK_ROOT, 'doc/features', feature), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: heartbeat uses 10m event-time threshold and dedupe',
    run: () => {
      const feature = `goal-monitor-heartbeat-${process.pid}`;
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(FRAMEWORK_ROOT, reportRel);
      const manifest = mkManifest({
        feature,
        report_dir: reportRel,
        start_phase: 'coding',
        end_phase: 'coding',
      });
      const baseMs = Date.now() - 11 * 60_000;
      const iso = (offsetMs: number): string => new Date(baseMs + offsetMs).toISOString();
      const events: GoalRunEvent[] = [
        { ts: iso(0), type: 'run_start', chain: ['coding'] },
        { ts: iso(1_000), type: 'phase_start', phase: 'coding', attempt: 1 },
        { ts: iso(2_000), type: 'agent_invoke_start', phase: 'coding' },
        { ts: iso(9 * 60_000 + 59_000), type: 'heartbeat', phase: 'coding' },
        { ts: iso(10 * 60_000 + 1_000), type: 'heartbeat', phase: 'coding' },
        { ts: iso(11 * 60_000), type: 'heartbeat', phase: 'coding' },
      ];
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        events.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      const lock = {
        ownerId: 'test',
        pid: process.pid,
        hostname: os.hostname(),
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        run_id: runId,
      };
      fs.writeFileSync(
        path.join(FRAMEWORK_ROOT, 'doc/features', feature, 'goal-runs', '.feature.lock'),
        JSON.stringify(lock, null, 2) + '\n',
        'utf-8',
      );
      fs.writeFileSync(
        path.join(reportDir, '.runner.lock'),
        JSON.stringify(lock, null, 2) + '\n',
        'utf-8',
      );
      try {
        const early = runGoalMonitorCli([
          '--feature',
          feature,
          '--run-id',
          runId,
          '--since-event',
          '2',
          '--max-seconds',
          '0',
          '--json',
        ]);
        assert(early.status === 0, `exit ${early.status} stderr=${early.stderr}`);
        const earlyParsed = JSON.parse(early.stdout.trim()) as {
          notification_kind: string;
          event_index: number;
        };
        assert(earlyParsed.notification_kind === 'heartbeat', `kind ${earlyParsed.notification_kind}`);
        assert(earlyParsed.event_index === 4, `event_index ${earlyParsed.event_index}`);

        const deduped = runGoalMonitorCli([
          '--feature',
          feature,
          '--run-id',
          runId,
          '--since-event',
          '4',
          '--max-seconds',
          '0',
          '--json',
        ]);
        assert(deduped.status === 0, `exit ${deduped.status} stderr=${deduped.stderr}`);
        const dedupedParsed = JSON.parse(deduped.stdout.trim()) as { notification_kind: string };
        assert(dedupedParsed.notification_kind === 'none', `kind ${dedupedParsed.notification_kind}`);
      } finally {
        fs.rmSync(path.join(FRAMEWORK_ROOT, 'doc/features', feature), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: latest run resolves from feature directory',
    run: () => {
      const feature = `goal-monitor-latest-${process.pid}`;
      const oldId = '20260609T120000Z';
      const runId = '20260610T120000Z';
      const oldRel = `doc/features/${feature}/goal-runs/${oldId}`;
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const oldDir = path.join(FRAMEWORK_ROOT, oldRel);
      const reportDir = path.join(FRAMEWORK_ROOT, reportRel);
      const oldManifest = mkManifest({
        feature,
        run_id: oldId,
        report_dir: oldRel,
        created_at: '2026-06-09T12:00:00.000Z',
      });
      const manifest = mkManifest({ feature, run_id: runId, report_dir: reportRel });
      fs.mkdirSync(oldDir, { recursive: true });
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(oldDir, 'manifest.json'), JSON.stringify(oldManifest, null, 2), 'utf-8');
      fs.writeFileSync(path.join(oldDir, 'events.jsonl'), '', 'utf-8');
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        happyEvents().map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      try {
        const r = runGoalMonitorCli([
          '--feature',
          feature,
          '--run-id',
          'latest',
          '--since-event',
          '5',
          '--max-seconds',
          '0',
          '--json',
        ]);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        const parsed = JSON.parse(r.stdout.trim()) as { run_id: string; notification_kind: string };
        assert(parsed.run_id === runId, `run_id ${parsed.run_id}`);
        assert(parsed.notification_kind === 'phase_verdict', `kind ${parsed.notification_kind}`);
      } finally {
        fs.rmSync(path.join(FRAMEWORK_ROOT, 'doc/features', feature), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: hard liveness anomaly edge-notifies once then dedupes',
    run: () => {
      const feature = `goal-monitor-liveness-${process.pid}`;
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(FRAMEWORK_ROOT, reportRel);
      const manifest = mkManifest({
        feature,
        report_dir: reportRel,
        start_phase: 'coding',
        end_phase: 'coding',
      });
      // Unclosed agent_invoke older than phase timeout (3600s) → hard STALLED,
      // with no run_end and a frozen event stream (no lock, no heartbeats).
      const stale = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
      const events: GoalRunEvent[] = [
        { ts: stale, type: 'run_start', chain: ['coding'] },
        { ts: stale, type: 'phase_start', phase: 'coding', attempt: 1 },
        { ts: stale, type: 'agent_invoke_start', phase: 'coding', invoke_id: 'p1' },
      ] as GoalRunEvent[];
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        events.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      try {
        // First call: anomaly is new relative to the default cursor → fires once.
        const first = runGoalMonitorCli([
          '--feature', feature, '--run-id', runId,
          '--since-event', '-1', '--max-seconds', '0', '--json',
        ]);
        assert(first.status === 0, `exit ${first.status} stderr=${first.stderr}`);
        const firstParsed = JSON.parse(first.stdout.trim()) as {
          notification_kind: string;
          status: string;
          liveness_state: string;
          event_index: number;
        };
        assert(firstParsed.notification_kind === 'liveness', `kind ${firstParsed.notification_kind}`);
        assert(firstParsed.status === 'STALLED', `status ${firstParsed.status}`);
        assert(firstParsed.liveness_state === 'STALLED', `liveness ${firstParsed.liveness_state}`);
        assert(firstParsed.event_index === 2, `event_index ${firstParsed.event_index}`);

        // Second call passing the returned cursor back, no newer events →
        // edge-trigger gate suppresses the repeat, bounded no-op instead of busy-spin.
        const second = runGoalMonitorCli([
          '--feature', feature, '--run-id', runId,
          '--since-event', String(firstParsed.event_index), '--max-seconds', '0', '--json',
        ]);
        assert(second.status === 0, `exit ${second.status} stderr=${second.stderr}`);
        const secondParsed = JSON.parse(second.stdout.trim()) as {
          notification_kind: string;
          no_op_reason?: string;
        };
        assert(secondParsed.notification_kind === 'none', `kind ${secondParsed.notification_kind}`);
        assert(
          secondParsed.no_op_reason === 'timeout_no_notification',
          `reason ${secondParsed.no_op_reason}`,
        );
      } finally {
        fs.rmSync(path.join(FRAMEWORK_ROOT, 'doc/features', feature), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-status CLI: --watch --max-ticks 1 exits',
    run: async () => {
      const feature = `goal-watch-${process.pid}`;
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(FRAMEWORK_ROOT, reportRel);
      const manifest = mkManifest({ feature, report_dir: reportRel });
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        happyEvents().map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      try {
        const r = runGoalStatusCli([
          '--feature',
          feature,
          '--run-id',
          runId,
          '--watch',
          '--max-ticks',
          '1',
        ]);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        assert(r.stdout.includes('COMPLETED'), `stdout ${r.stdout.slice(0, 200)}`);
      } finally {
        fs.rmSync(path.join(FRAMEWORK_ROOT, 'doc/features', feature), { recursive: true, force: true });
      }
    },
  },
  {
    name: 'buildLiveGoalStatusSnapshot: end-to-end from fixture dir',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-live-'));
      const manifest = mkManifest({
        report_dir: 'doc/features/feat-a/goal-runs/20260610T120000Z',
      });
      const reportDir = path.join(root, manifest.report_dir);
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8',
      );
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        happyEvents().map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      const snap = buildLiveGoalStatusSnapshot({
        projectRoot: root,
        manifest,
        workflow,
        featuresDir: 'doc/features',
        feature: 'feat-a',
        runId: manifest.run_id,
      });
      assert(snap.status === 'COMPLETED', `status ${snap.status}`);
      assert(snap.phases_summary.length > 0, 'phases_summary');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
