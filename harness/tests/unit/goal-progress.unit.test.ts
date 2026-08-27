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
  type GoalProgressSnapshot,
  projectGoalProgress as projectGoalProgressRaw,
  resolveChainFromEvents,
  resolveLatestRunId,
  resolveRunOutputDelivery,
  SOFT_STALL_MS,
  runStatusWatchLoop,
  shouldThrottleSnapshot,
  writeProgressSnapshotAtomic,
} from '../../scripts/utils/goal-progress';
// e9d4b7a3 t4（二轮 review P1）：featuresDir 为必传参数——测试统一注入默认
// 'doc/features'（与 fixtures 的布局一致）；显式传入的 featuresDir 优先。
type ProgressInput = Parameters<typeof projectGoalProgressRaw>[0];
function projectGoalProgress(input: ProgressInput | Omit<ProgressInput, 'featuresDir'>) {
  return projectGoalProgressRaw({
    ...input,
    featuresDir: 'featuresDir' in input && input.featuresDir ? input.featuresDir : 'doc/features',
  });
}
import { isLockStale } from '../../scripts/utils/goal-run-lock';
import { loadEventsJsonl, type GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '../../..');
const HARNESS_ROOT = path.join(__dirname, '../..');
const workflow = loadWorkflowSpec(FRAMEWORK_ROOT, 'spec-driven');

function runGoalStatusCli(
  args: string[],
  projectRoot?: string,
): { status: number | null; stdout: string; stderr: string } {
  return runGoalCli('scripts/goal-status.ts', args, projectRoot);
}

function runGoalMonitorCli(
  args: string[],
  projectRoot?: string,
): { status: number | null; stdout: string; stderr: string } {
  return runGoalCli('scripts/goal-monitor.ts', args, projectRoot);
}

function runGoalCli(
  scriptRel: string,
  args: string[],
  projectRoot?: string,
): { status: number | null; stdout: string; stderr: string } {
  const localTsNode = path.join(HARNESS_ROOT, 'node_modules', 'ts-node', 'dist', 'bin.js');
  const cwd = HARNESS_ROOT;
  const cliArgs = projectRoot ? [...args, '--project-root', projectRoot] : args;
  const r = fs.existsSync(localTsNode)
    ? spawnSync(process.execPath, [localTsNode, scriptRel, ...cliArgs], {
        cwd,
        encoding: 'utf-8',
        shell: false,
        timeout: 120_000,
      })
    : spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['ts-node', scriptRel, ...cliArgs], {
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

function mkGoalCliProjectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-progress-cli-'));
  const workflowDir = path.join(root, 'framework', 'workflows');
  fs.mkdirSync(workflowDir, { recursive: true });
  fs.copyFileSync(
    path.join(FRAMEWORK_ROOT, 'workflows', 'spec-driven.workflow.yaml'),
    path.join(workflowDir, 'spec-driven.workflow.yaml'),
  );
  return root;
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
    budget: {
      max_retries_per_phase: 2,
      max_total_turns: 20,
      wall_clock_minutes: 240,
      max_transient_api_retries: 3,
    },
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

function mkStatusSnapshot(
  liveness: GoalProgressSnapshot['liveness'],
): GoalProgressSnapshot {
  return {
    schema_version: '1.0',
    run_id: 'r1',
    feature: 'f',
    status: 'RUNNING',
    status_reason: null,
    run_disposition: 'RESUME_READY',
    generated_at: new Date(0).toISOString(),
    source: { events_path: 'e', events_count: 1, last_event_at: null, last_event_type: null },
    chain: { phases: [], current_phase: null, current_index: 0, total: 0, estimated_percent: null, percent_kind: 'indeterminate' },
    phase: { name: null, status: 'NOT_STARTED', attempt: 0, started_at: null, elapsed_ms: null, substep: null },
    liveness,
    budget: { turns_used: 0, turns_limit: 3, wall_elapsed_ms: 0, wall_limit_ms: 1, phase_timeout_ms: 1 },
    artifacts: { agent_output_log: null, summary_path: null, goal_report_path: null, progress_path: null },
    recent_events: [],
    next_action: 'wait',
    phases_summary: [],
  };
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
    name: 'projectGoalProgress: phase write violation 显示自动 owner backtrack',
    run: () => {
      const manifest = mkManifest();
      const events = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] },
        {
          ts: '2026-06-10T12:00:01.000Z', type: 'phase_write_violation', phase: 'plan', fingerprint: 'fp',
          violations: [{ path: 'doc/features/demo/spec/acceptance.yaml', owner: 'spec', pre_sha256: 'a', post_sha256: 'b' }],
        },
        {
          ts: '2026-06-10T12:00:02.000Z', type: 'phase_backtrack_requested', phase: 'plan',
          to_phase: 'spec', reason: 'phase_write_violation', files: ['doc/features/demo/spec/acceptance.yaml'],
          fingerprint: 'fp', backtracks_used: 1, backtracks_limit: 2, run_disposition: 'RECOVERY_PENDING',
        },
      ] as GoalRunEvent[];
      const snap = projectGoalProgress({
        projectRoot: '/tmp', manifest, events, workflow,
        nowMs: new Date('2026-06-10T12:00:03.000Z').getTime(),
      });
      assert(snap.run_disposition === 'RECOVERY_PENDING', snap.run_disposition);
      assert(snap.status_reason === 'phase_write_violation', String(snap.status_reason));
      assert(snap.recovery?.target_phase === 'spec', JSON.stringify(snap.recovery));
      assert(snap.next_action === 'wait_for_framework_recovery', snap.next_action);
      const md = generateProgressMarkdown(snap);
      assert(md.includes('phase_write_violation') && md.includes('owner=spec') && md.includes('pre=a post=b'), md);
    },
  },
  {
    name: 'e9d4b7a3 t4: progress.json 与 runner 同源——supersede lineage 折叠（25 祖先 + 5 当前 = 30/30），非当前 run 假象',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-progress-lineage-'));
      try {
        const mkEvents = (pathRel: string, lines: string[]): void => {
          const abs = path.join(root, pathRel);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, lines.join('\n') + '\n', 'utf-8');
        };
        // 祖先 run：25 次 invoke，10 分钟活跃段（run_end 闭合）
        const anc: string[] = [
          JSON.stringify({ ts: '2026-08-03T00:00:00.000Z', type: 'run_start', dry_run: false, chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] }),
        ];
        for (let i = 1; i <= 25; i++) {
          anc.push(JSON.stringify({ ts: `2026-08-03T00:00:${String(i).padStart(2, '0')}.000Z`, type: 'agent_invoke', phase: 'spec' }));
        }
        anc.push(JSON.stringify({ ts: '2026-08-03T00:10:00.000Z', type: 'run_end', status: 'HALTED' }));
        mkEvents('doc/features/feat-a/goal-runs/run-ancestor/events.jsonl', anc);
        // 当前 run：supersede 祖先 + 5 次 invoke + run_end
        const cur: string[] = [
          JSON.stringify({ ts: '2026-08-03T01:00:00.000Z', type: 'run_start', dry_run: false, chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] }),
          JSON.stringify({ ts: '2026-08-03T01:00:01.000Z', type: 'supersede', target_run_id: 'run-ancestor' }),
        ];
        for (let i = 1; i <= 5; i++) {
          cur.push(JSON.stringify({ ts: `2026-08-03T01:00:0${i}.000Z`, type: 'agent_invoke', phase: 'spec' }));
        }
        cur.push(JSON.stringify({ ts: '2026-08-03T01:05:00.000Z', type: 'run_end', status: 'AWAITING_HUMAN_REVIEW' }));
        mkEvents('doc/features/feat-a/goal-runs/run-current/events.jsonl', cur);

        const manifest = mkManifest({
          run_id: 'run-current',
          report_dir: 'doc/features/feat-a/goal-runs/run-current',
          budget: { ...mkManifest().budget, max_total_turns: 30 },
        });
        mkEvents('doc/features/feat-a/goal-runs/run-current/manifest.json', [
          JSON.stringify({ run_id: 'run-current' }),
        ]);
        const snap = projectGoalProgress({
          projectRoot: root,
          manifest,
          events: loadEventsJsonl(path.join(root, 'doc/features/feat-a/goal-runs/run-current/events.jsonl')),
          workflow,
          nowMs: new Date('2026-08-03T01:06:00.000Z').getTime(),
          featuresDir: 'doc/features',
        });
        assert(snap.budget.turns_used === 30,
          `lineage turns 应折叠累计 30（25 祖先 + 5 当前），实得 ${snap.budget.turns_used}（旧实现=当前 run 5）`);
        assert(snap.budget.turns_limit === 30, `turns_limit=${snap.budget.turns_limit}`);
        assert(snap.budget.wall_elapsed_ms === 15 * 60 * 1000,
          `wall 应折叠累计 15m（祖先 10m + 当前 5m），实得 ${snap.budget.wall_elapsed_ms}`);
        // 无 supersede 的普通视图：折叠空 → 恒等于当前 run（既有断言不回归）
        const noSup = projectGoalProgress({
          projectRoot: root,
          manifest,
          events: cur.filter((l) => !l.includes('"supersede"')).map((l) => JSON.parse(l) as GoalRunEvent),
          workflow,
          nowMs: new Date('2026-08-03T01:06:00.000Z').getTime(),
          featuresDir: 'doc/features',
        });
        assert(noSup.budget.turns_used === 5, `无 supersede 时只计当前 run：${noSup.budget.turns_used}`);
      } finally {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
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
    name: 'incident replay (detection): dangling harness_start + lock cleaned 11h → STALLED not RUNNING',
    run: () => {
      // 2026-06-25 homepage run: plan agent_invoke_end → harness_start, runner died, locks
      // released on graceful exit, 11h silence. Must NOT project as RUNNING (the user bug).
      const now = new Date('2026-06-25T13:53:03.091Z').getTime() + 11 * 3600 * 1000;
      const events: GoalRunEvent[] = [
        { ts: '2026-06-25T13:37:06.329Z', type: 'run_start', chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'] },
        { ts: '2026-06-25T13:37:06.332Z', type: 'phase_start', phase: 'spec', attempt: 1 },
        { ts: '2026-06-25T13:43:58.626Z', type: 'phase_verdict', phase: 'spec', verdict: 'PASS', action: 'advance' },
        { ts: '2026-06-25T13:43:58.632Z', type: 'phase_start', phase: 'plan', attempt: 1 },
        { ts: '2026-06-25T13:43:58.662Z', type: 'agent_invoke_start', phase: 'plan', invoke_id: 'plan-1' },
        { ts: '2026-06-25T13:53:03.089Z', type: 'agent_invoke_end', phase: 'plan', invoke_id: 'plan-1', exit_code: 0 },
        { ts: '2026-06-25T13:53:03.091Z', type: 'harness_start', phase: 'plan' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ feature: 'homepage' }),
        events,
        workflow,
        nowMs: now,
        liveProbe: true,
        // featureLock omitted: released on graceful exit — the lock-cleaned signature.
      });
      assert(snap.status !== 'RUNNING', `must not be RUNNING, got ${snap.status}`);
      assert(snap.status === 'STALLED', `expected STALLED, got ${snap.status}`);
      assert(snap.liveness.state === 'STALLED', `liveness ${snap.liveness.state}`);
    },
  },
  {
    name: 'unclosed harness past phase_timeout (before dead-man) → STALLED',
    run: () => {
      // 70min after harness_start: > 60min phase timeout but < 90min dead-man.
      // Isolates the unclosed-harness path from the absolute dead-man.
      const now = new Date('2026-06-10T12:05:01.000Z').getTime() + 70 * 60 * 1000;
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start', phase: 'coding' },
        { ts: '2026-06-10T12:05:00.000Z', type: 'agent_invoke_end', phase: 'coding', exit_code: 0 },
        { ts: '2026-06-10T12:05:01.000Z', type: 'harness_start', phase: 'coding' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }),
        events,
        workflow,
        nowMs: now,
        liveProbe: true,
      });
      assert(snap.status === 'STALLED', `expected STALLED, got ${snap.status}`);
    },
  },
  {
    name: 'absolute dead-man: all events closed but 2h silence + no lock → STALLED not RUNNING',
    run: () => {
      // Phase advanced but next phase_start never arrived (runner died between phases),
      // locks cleaned, 2h silence. No unclosed invoke/harness — only the dead-man catches it.
      const now = new Date('2026-06-10T14:08:01.000Z').getTime(); // 2h after the verdict
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['spec', 'plan'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'phase_start', phase: 'spec', attempt: 1 },
        { ts: '2026-06-10T12:00:02.000Z', type: 'agent_invoke_start', phase: 'spec', invoke_id: 'p1' },
        { ts: '2026-06-10T12:05:00.000Z', type: 'agent_invoke_end', phase: 'spec', invoke_id: 'p1', exit_code: 0 },
        { ts: '2026-06-10T12:05:01.000Z', type: 'harness_start', phase: 'spec' },
        { ts: '2026-06-10T12:08:00.000Z', type: 'harness_end', phase: 'spec', exit_code: 0 },
        { ts: '2026-06-10T12:08:01.000Z', type: 'phase_verdict', phase: 'spec', verdict: 'PASS', action: 'advance' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'spec', end_phase: 'plan' }),
        events,
        workflow,
        nowMs: now,
        liveProbe: true,
      });
      assert(snap.status !== 'RUNNING', `must not be RUNNING, got ${snap.status}`);
      assert(snap.status === 'STALLED', `expected STALLED, got ${snap.status}`);
    },
  },
  {
    name: 'terminal event: run_end INTERRUPTED → INTERRUPTED status, liveness DONE, not degraded',
    run: () => {
      // writeTerminalEvent path: a graceful kill (signal/.catch) writes run_end{INTERRUPTED}
      // mid-harness. Projection must treat it as terminal, never RUNNING, never degraded.
      const now = new Date('2026-06-10T20:00:00.000Z').getTime();
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['spec', 'plan'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'phase_start', phase: 'spec', attempt: 1 },
        { ts: '2026-06-10T12:00:02.000Z', type: 'agent_invoke_start', phase: 'spec', invoke_id: 'p1' },
        { ts: '2026-06-10T12:05:00.000Z', type: 'agent_invoke_end', phase: 'spec', invoke_id: 'p1', exit_code: 0 },
        { ts: '2026-06-10T12:05:01.000Z', type: 'harness_start', phase: 'spec' },
        { ts: '2026-06-10T12:05:02.000Z', type: 'run_end', status: 'INTERRUPTED' },
      ];
      const snap = projectGoalProgress({
        projectRoot: '/tmp',
        manifest: mkManifest({ start_phase: 'spec', end_phase: 'plan' }),
        events,
        workflow,
        nowMs: now,
        liveProbe: true,
      });
      assert(snap.status === 'INTERRUPTED', `expected INTERRUPTED, got ${snap.status}`);
      assert(snap.liveness.state === 'DONE', `expected liveness DONE, got ${snap.liveness.state}`);
      // INTERRUPTED writes no goal-report.json → must not point the user at a missing file.
      assert(snap.artifacts.goal_report_path === null, `goal_report_path ${snap.artifacts.goal_report_path}`);
      assert(
        snap.next_action === 'inspect_events_or_resume',
        `next_action ${snap.next_action} (must not be read_goal_report)`,
      );
      const degraded = applyFreshnessDegradation(snap, { liveProbe: true, nowMs: now });
      assert(degraded.status === 'INTERRUPTED', `terminal must not degrade, got ${degraded.status}`);
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
      const cliRoot = mkGoalCliProjectRoot();
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(cliRoot, reportRel);
      const manifest = mkManifest({ feature, report_dir: reportRel });
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        happyEvents().map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      try {
        const r = runGoalStatusCli(['--feature', feature, '--run-id', runId, '--json'], cliRoot);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        const parsed = JSON.parse(r.stdout.trim()) as { status: string; schema_version: string };
        assert(parsed.schema_version === '1.0', 'schema');
        assert(parsed.status === 'COMPLETED', `status ${parsed.status}`);
      } finally {
        fs.rmSync(cliRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-status CLI: 默认文本显示 streaming agent 工作面停滞',
    run: () => {
      const feature = `goal-cli-stall-${process.pid}`;
      const cliRoot = mkGoalCliProjectRoot();
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(cliRoot, reportRel);
      const phaseDir = path.join(reportDir, 'phases', 'coding');
      const manifest = mkManifest({
        feature,
        report_dir: reportRel,
        start_phase: 'coding',
        end_phase: 'coding',
      });
      const now = Date.now();
      const events: GoalRunEvent[] = [
        { ts: new Date(now - 30 * 60 * 1000).toISOString(), type: 'run_start', chain: ['coding'] },
        { ts: new Date(now - 30 * 60 * 1000).toISOString(), type: 'adapter_probe', output_delivery: 'streaming' },
        { ts: new Date(now - 30 * 60 * 1000).toISOString(), type: 'phase_start', phase: 'coding', attempt: 1 },
        { ts: new Date(now - 30 * 60 * 1000).toISOString(), type: 'agent_invoke_start', phase: 'coding', invoke_id: 'c1' },
        { ts: new Date(now - 1000).toISOString(), type: 'heartbeat', phase: 'coding' },
      ];
      fs.mkdirSync(phaseDir, { recursive: true });
      fs.writeFileSync(path.join(reportDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        events.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      const agentLog = path.join(phaseDir, 'agent-output.log');
      fs.writeFileSync(agentLog, 'old output\n', 'utf-8');
      const old = new Date(now - 65 * 60 * 1000);
      fs.utimesSync(agentLog, old, old);
      try {
        const r = runGoalStatusCli(['--feature', feature, '--run-id', runId], cliRoot);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        assert(
          /agent 输出已停滞 65 分钟/.test(r.stdout),
          `默认 goal-status 须显示工作面停滞：\n${r.stdout}`,
        );
        assert(/控制面 heartbeat 不计入/.test(r.stdout), '默认文本须声明工作面口径');
      } finally {
        fs.rmSync(cliRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: phase_verdict edge notification',
    run: () => {
      const feature = `goal-monitor-verdict-${process.pid}`;
      const cliRoot = mkGoalCliProjectRoot();
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(cliRoot, reportRel);
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
        ], cliRoot);
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
        fs.rmSync(cliRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: no-op timeout when no new edge',
    run: () => {
      const feature = `goal-monitor-noop-${process.pid}`;
      const cliRoot = mkGoalCliProjectRoot();
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(cliRoot, reportRel);
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
        ], cliRoot);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        const parsed = JSON.parse(r.stdout.trim()) as {
          notification_kind: string;
          no_op_reason?: string;
        };
        assert(parsed.notification_kind === 'none', `kind ${parsed.notification_kind}`);
        assert(parsed.no_op_reason === 'timeout_no_notification', `reason ${parsed.no_op_reason}`);
      } finally {
        fs.rmSync(cliRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: heartbeat uses 10m event-time threshold and dedupe',
    run: () => {
      const feature = `goal-monitor-heartbeat-${process.pid}`;
      const cliRoot = mkGoalCliProjectRoot();
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(cliRoot, reportRel);
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
        path.join(cliRoot, 'doc/features', feature, 'goal-runs', '.feature.lock'),
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
        ], cliRoot);
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
        ], cliRoot);
        assert(deduped.status === 0, `exit ${deduped.status} stderr=${deduped.stderr}`);
        const dedupedParsed = JSON.parse(deduped.stdout.trim()) as { notification_kind: string };
        assert(dedupedParsed.notification_kind === 'none', `kind ${dedupedParsed.notification_kind}`);
      } finally {
        fs.rmSync(cliRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: latest run resolves from feature directory',
    run: () => {
      const feature = `goal-monitor-latest-${process.pid}`;
      const cliRoot = mkGoalCliProjectRoot();
      const oldId = '20260609T120000Z';
      const runId = '20260610T120000Z';
      const oldRel = `doc/features/${feature}/goal-runs/${oldId}`;
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const oldDir = path.join(cliRoot, oldRel);
      const reportDir = path.join(cliRoot, reportRel);
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
        ], cliRoot);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        const parsed = JSON.parse(r.stdout.trim()) as { run_id: string; notification_kind: string };
        assert(parsed.run_id === runId, `run_id ${parsed.run_id}`);
        assert(parsed.notification_kind === 'phase_verdict', `kind ${parsed.notification_kind}`);
      } finally {
        fs.rmSync(cliRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-monitor CLI: hard liveness anomaly edge-notifies once then dedupes',
    run: () => {
      const feature = `goal-monitor-liveness-${process.pid}`;
      const cliRoot = mkGoalCliProjectRoot();
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(cliRoot, reportRel);
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
        ], cliRoot);
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
        ], cliRoot);
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
        fs.rmSync(cliRoot, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'goal-status CLI: --watch --max-ticks 1 exits',
    run: async () => {
      const feature = `goal-watch-${process.pid}`;
      const cliRoot = mkGoalCliProjectRoot();
      const runId = '20260610T120000Z';
      const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
      const reportDir = path.join(cliRoot, reportRel);
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
        ], cliRoot);
        assert(r.status === 0, `exit ${r.status} stderr=${r.stderr}`);
        assert(r.stdout.includes('COMPLETED'), `stdout ${r.stdout.slice(0, 200)}`);
      } finally {
        fs.rmSync(cliRoot, { recursive: true, force: true });
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
  {
    name: 'plan c6a9e4d2: snapshot 只读投影未闭合 guardian 绑定与存活性（无副作用）',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-live-g-'));
      const manifest = mkManifest({
        report_dir: 'doc/features/feat-a/goal-runs/20260610T120000Z-g',
      });
      const reportDir = path.join(root, manifest.report_dir);
      fs.mkdirSync(reportDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8',
      );
      const boundEvents = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start' },
        {
          ts: '2026-06-10T12:00:01.000Z', type: 'agent_invoke_start',
          phase: 'spec', invoke_id: 'i1',
        },
        {
          ts: '2026-06-10T12:00:02.000Z', type: 'agent_process_bound',
          phase: 'spec', invoke_id: 'i1', run_id: manifest.run_id,
          pid: 99999999, started_at_ms: 1, executable: 'C:\\x\\powershell.exe',
          token: `${manifest.run_id}/i1`,
        },
      ];
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        boundEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
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
      assert(snap.guardian !== undefined, 'guardian 投影缺失');
      assert(snap.guardian!.unclosed_bounds === 1, `unclosed_bounds=${snap.guardian!.unclosed_bounds}`);
      assert(snap.guardian!.bounds.length === 1, 'bounds 应为 1（P0-1 全量投影）');
      assert(snap.guardian!.bounds[0].pid === 99999999, 'bound[0].pid 不匹配');
      assert(snap.guardian!.bounds[0].token === `${manifest.run_id}/i1`, 'bound[0].token 不匹配');
      if (process.platform === 'win32') {
        // 99999999 不存在 → win32 下应报 alive=false（探针只读）
        assert(snap.guardian!.bounds[0].alive === false, `alive 应为 false（备用 pid），实得 ${snap.guardian!.bounds[0].alive}`);
      }
      // settled 闭合后不再投影未闭合绑定
      const settledEvents = [
        ...boundEvents,
        {
          ts: '2026-06-10T12:05:00.000Z', type: 'agent_invoke_end',
          phase: 'spec', invoke_id: 'i1', exit_code: 0,
        },
        {
          ts: '2026-06-10T12:05:01.000Z', type: 'agent_process_settled',
          phase: 'spec', invoke_id: 'i1', run_id: manifest.run_id, exit_code: 0,
        },
      ];
      fs.writeFileSync(
        path.join(reportDir, 'events.jsonl'),
        settledEvents.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf-8',
      );
      const snap2 = buildLiveGoalStatusSnapshot({
        projectRoot: root,
        manifest,
        workflow,
        featuresDir: 'doc/features',
        feature: 'feat-a',
        runId: manifest.run_id,
      });
      assert(snap2.guardian === undefined, 'settled 后 guardian 投影不应存在（绑定已闭合）');
      fs.rmSync(root, { recursive: true, force: true });
    },
  },
  // ==========================================================================
  // plan e6b3f8d2 t4：活性分离工作面与控制面（fake clock，观测不干预）
  // --------------------------------------------------------------------------
  // 立项事故：coding i3 输出停滞 65 分钟，而 runner 自写 heartbeat 让控制面口径恒新鲜，
  // 活性一路 ACTIVE。修复=三合取降级到既有枚举 SUSPECTED_STALL，且只在 streaming 下降。
  // ==========================================================================
  {
    name: 't4 liveness: streaming + 未闭合 invoke + 输出停滞 → SUSPECTED_STALL（heartbeat 不再遮蔽）',
    run: () => {
      const now = 1_800_000_000_000; // fake clock（固定值，杜绝真实时钟抖动）
      const startedAt = new Date(now - 70 * 60 * 1000).toISOString();
      const events: GoalRunEvent[] = [
        { ts: startedAt, type: 'run_start', chain: ['coding'] },
        { ts: startedAt, type: 'adapter_probe', output_delivery: 'streaming' },
        { ts: startedAt, type: 'phase_start', phase: 'coding' },
        { ts: startedAt, type: 'agent_invoke_start', phase: 'coding', invoke_id: 'c1' },
        // 控制面：runner heartbeat 一直在写（就在 1 秒前）
        { ts: new Date(now - 1000).toISOString(), type: 'heartbeat', phase: 'coding' },
      ];
      const liveness = computeLiveness({
        events,
        featureLock: null,
        runnerLock: null,
        // 工作面：agent-output.log 65 分钟没动
        agentOutputMtimeMs: now - 65 * 60 * 1000,
        phaseTimeoutMs: 90 * 60 * 1000,
        runEnded: false,
        terminalStatus: null,
        nowMs: now,
        liveProbe: false,
        lastLingeringPipe: false,
      });
      assert(
        liveness.state === 'SUSPECTED_STALL',
        `heartbeat 恒新鲜也不得遮蔽工作面停滞，实得 ${liveness.state}`,
      );
      assert(liveness.signals.agent_output_log === 'unchanged', 'outputSignal 须为 unchanged');
      assert(
        liveness.agent_output_stalled_ms === 65 * 60 * 1000,
        `工作面停滞时长须为 now−mtime：${liveness.agent_output_stalled_ms}`,
      );
      // 控制面口径不得被工作面污染（两轴分立）
      assert(
        liveness.seconds_since_activity !== null && liveness.seconds_since_activity <= 2,
        `控制面口径仍应新鲜（含 heartbeat）：${liveness.seconds_since_activity}`,
      );
    },
  },
  {
    name: 't4 liveness: buffered / unknown 不降级（日志本就可能整段憋着，据此降级即误报）',
    run: () => {
      const now = 1_800_000_000_000;
      const startedAt = new Date(now - 70 * 60 * 1000).toISOString();
      const mk = (probe?: string): GoalRunEvent[] => [
        { ts: startedAt, type: 'run_start', chain: ['coding'] },
        ...(probe ? [{ ts: startedAt, type: 'adapter_probe', output_delivery: probe } as GoalRunEvent] : []),
        { ts: startedAt, type: 'phase_start', phase: 'coding' },
        { ts: startedAt, type: 'agent_invoke_start', phase: 'coding', invoke_id: 'c1' },
        { ts: new Date(now - 1000).toISOString(), type: 'heartbeat', phase: 'coding' },
      ];
      for (const probe of ['buffered', 'unknown', undefined]) {
        const liveness = computeLiveness({
          events: mk(probe),
          featureLock: null,
          runnerLock: null,
          agentOutputMtimeMs: now - 65 * 60 * 1000,
          phaseTimeoutMs: 90 * 60 * 1000,
          runEnded: false,
          terminalStatus: null,
          nowMs: now,
          liveProbe: false,
          lastLingeringPipe: false,
        });
        assert(
          liveness.state === 'ACTIVE',
          `output_delivery=${String(probe)} 不得降级，实得 ${liveness.state}`,
        );
        assert(
          liveness.agent_output_stalled_ms === null,
          `output_delivery=${String(probe)} 不得投影工作面停滞时长`,
        );
        const rendered = [
          formatGoalStatusText(mkStatusSnapshot(liveness), 'f', 'r1'),
          generateProgressMarkdown(mkStatusSnapshot(liveness)),
        ].join('\n');
        assert(!rendered.includes('agent 输出已停滞'), `豁免场景不得渲染停滞说明：\n${rendered}`);
      }
    },
  },
  {
    name: 't4 liveness: 无未闭合 invoke / 输出仍在更新 → 不降级（三合取缺一不降）',
    run: () => {
      const now = 1_800_000_000_000;
      const startedAt = new Date(now - 70 * 60 * 1000).toISOString();
      const base: GoalRunEvent[] = [
        { ts: startedAt, type: 'run_start', chain: ['coding'] },
        { ts: startedAt, type: 'adapter_probe', output_delivery: 'streaming' },
        { ts: startedAt, type: 'phase_start', phase: 'coding' },
        { ts: startedAt, type: 'agent_invoke_start', phase: 'coding', invoke_id: 'c1' },
        { ts: new Date(now - 1000).toISOString(), type: 'heartbeat', phase: 'coding' },
      ];
      const call = (events: GoalRunEvent[], mtime: number | null): ReturnType<typeof computeLiveness> =>
        computeLiveness({
          events,
          featureLock: null,
          runnerLock: null,
          agentOutputMtimeMs: mtime,
          phaseTimeoutMs: 90 * 60 * 1000,
          runEnded: false,
          terminalStatus: null,
          nowMs: now,
          liveProbe: false,
          lastLingeringPipe: false,
        });
      // ① invoke 已闭合 → 没有"正在跑的 agent"可谈停滞
      const closed = call(
        [...base, { ts: new Date(now - 2000).toISOString(), type: 'agent_invoke_end', phase: 'coding', invoke_id: 'c1' }],
        now - 65 * 60 * 1000,
      );
      assert(closed.state === 'ACTIVE', `已闭合 invoke 不得降级：${closed.state}`);
      assert(closed.agent_output_stalled_ms === null, '已闭合 invoke 不得投影工作面停滞时长');
      const closedRendered = [
        formatGoalStatusText(mkStatusSnapshot(closed), 'f', 'r1'),
        generateProgressMarkdown(mkStatusSnapshot(closed)),
      ].join('\n');
      assert(!closedRendered.includes('agent 输出已停滞'), `已闭合 invoke 不得渲染停滞说明：\n${closedRendered}`);
      // ② 输出仍在软阈内更新 → outputSignal='updated'
      const fresh = call(base, now - Math.floor(SOFT_STALL_MS / 2));
      assert(fresh.state === 'ACTIVE', `输出仍在更新不得降级：${fresh.state}`);
      assert(fresh.signals.agent_output_log === 'updated', fresh.signals.agent_output_log);
      assert(fresh.agent_output_stalled_ms === null, '输出仍更新时不得投影停滞时长');
      // ③ 无 agent-output.log（工作面无事实）→ 不猜
      const missing = call(base, null);
      assert(missing.state === 'ACTIVE', `无工作面事实不得降级：${missing.state}`);
      assert(missing.agent_output_stalled_ms === null, '无日志时停滞时长须为 null');
    },
  },
  {
    name: 't4 liveness: 读源是本 run 的 adapter_probe 事件（历史 run 不被现行 adapter.yaml 重释）',
    run: () => {
      assert(resolveRunOutputDelivery([]) === 'unknown', '无事件即 unknown');
      assert(
        resolveRunOutputDelivery([{ type: 'adapter_probe' } as GoalRunEvent]) === 'unknown',
        'adapter_probe 缺字段即 unknown（历史 run 形态）',
      );
      assert(
        resolveRunOutputDelivery([
          { type: 'adapter_probe', output_delivery: 'buffered' } as GoalRunEvent,
          { type: 'adapter_probe', output_delivery: 'streaming' } as GoalRunEvent,
        ]) === 'streaming',
        '多条时取最后一条（同 run 内 resume 后的最新声明）',
      );
      assert(
        resolveRunOutputDelivery([{ type: 'adapter_probe', output_delivery: 'nonsense' } as GoalRunEvent]) === 'unknown',
        '非法值即 unknown，不得猜',
      );
    },
  },
  {
    name: 't4 查进度：工作面停滞独立成行，且**不复用**含 heartbeat 的 seconds_since_activity',
    run: () => {
      const snapshot = mkStatusSnapshot({
        state: 'SUSPECTED_STALL',
        last_activity_at: null,
        seconds_since_activity: 1,
        agent_output_stalled_ms: 65 * 60 * 1000,
        signals: {
          feature_lock_heartbeat: 'fresh',
          runner_lock: 'present',
          agent_output_log: 'unchanged',
          child_process: 'unknown',
          lingering_pipe: false,
        },
      });
      const text = formatGoalStatusText(snapshot, 'f', 'r1');
      const md = generateProgressMarkdown(snapshot);
      assert(/agent 输出已停滞 65 分钟/.test(text), `默认查进度须给出工作面停滞分钟数：\n${text}`);
      assert(/agent 输出已停滞 65 分钟/.test(md), `查进度须给出工作面停滞分钟数：\n${md}`);
      assert(/控制面 heartbeat 不计入/.test(text), '默认文本须显式声明口径，防再次与控制面混用');
      assert(/控制面 heartbeat 不计入/.test(md), 'Markdown 须显式声明口径，防再次与控制面混用');
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
