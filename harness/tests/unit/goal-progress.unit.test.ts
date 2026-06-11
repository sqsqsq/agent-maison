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
  const scriptRel = 'scripts/goal-status.ts';
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
    start_phase: 'prd',
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
  const chain = ['prd', 'design', 'coding', 'review', 'ut', 'testing'];
  return [
    { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain },
    { ts: '2026-06-10T12:00:01.000Z', type: 'phase_start', phase: 'prd', attempt: 1 },
    { ts: '2026-06-10T12:00:02.000Z', type: 'agent_invoke_start', phase: 'prd', invoke_id: 'p1' },
    { ts: '2026-06-10T12:05:00.000Z', type: 'agent_invoke_end', phase: 'prd', invoke_id: 'p1', exit_code: 0 },
    { ts: '2026-06-10T12:05:01.000Z', type: 'harness_start', phase: 'prd' },
    { ts: '2026-06-10T12:08:00.000Z', type: 'harness_end', phase: 'prd', exit_code: 0 },
    {
      ts: '2026-06-10T12:08:01.000Z',
      type: 'phase_verdict',
      phase: 'prd',
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
      const events = [{ type: 'run_start', chain: ['prd', 'coding'] }] as GoalRunEvent[];
      const chain = resolveChainFromEvents(events, ['prd', 'design', 'coding']);
      assert(chain.join(',') === 'prd,coding', `got ${chain.join(',')}`);
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
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['prd', 'coding'] },
        {
          ts: '2026-06-10T12:10:00.000Z',
          type: 'phase_verdict',
          phase: 'prd',
          verdict: 'INCOMPLETE',
          action: 'defer_external_and_continue_if_allowed',
        },
        { ts: '2026-06-10T12:11:00.000Z', type: 'phase_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'prd', end_phase: 'coding' }),
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
      assert(md.includes('prd'), 'phase row');
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
