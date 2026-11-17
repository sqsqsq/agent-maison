import { DEFAULT_GOAL_WAIT_TIMEOUT_MS, goalStatusWaitCommand, createGoalWaitReader, waitForGoalStatus, readGoalWaitObservation, type GoalWaitObservation } from '../../scripts/utils/goal-status-wait';
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
import { issueSessionExecution, acceptSessionExecution, acceptedSessionReport, readHandoffMaterial } from '../../scripts/utils/session-execution-handoff';
import { ensureRunControl, casAcquireRunOwner } from '../../scripts/utils/goal-run-control';
import type { WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';

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
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ active_workflow: 'spec-driven' }));
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
    name: 'heartbeat projection reuses acceptance while refreshing progress; explicit observation still recomputes',
    run: () => {
      const completion = require('../../scripts/utils/verify-feature-completion') as typeof import('../../scripts/utils/verify-feature-completion');
      const original = completion.resolveCompletionDisposition;
      let evaluations = 0;
      completion.resolveCompletionDisposition = input => { evaluations += 1; return original(input); };
      try {
        const manifest = mkManifest({ start_phase: 'coding', end_phase: 'coding' });
        const started = Date.parse(manifest.created_at);
        const events: GoalRunEvent[] = [
          { ts: manifest.created_at, type: 'run_start', chain: ['coding'] },
          { ts: new Date(started + 1000).toISOString(), type: 'phase_start', phase: 'coding', attempt: 1 },
          { ts: new Date(started + 2000).toISOString(), type: 'agent_invoke_start', phase: 'coding', invoke_id: 'heartbeat-i1' },
        ];
        const input = { projectRoot: '/tmp', manifest, workflow, events, nowMs: started + 3000 };
        const observed = projectGoalProgress(input);
        assert(evaluations === 1 && !!observed.current_disposition, '正式投影读取当前验收结论');
        events.push({ ts: new Date(started + 9000).toISOString(), type: 'heartbeat', phase: 'coding' });
        const heartbeat = projectGoalProgress({ ...input, nowMs: started + 10_000, currentDisposition: observed.current_disposition });
        assert(evaluations === 1 && heartbeat.current_disposition === observed.current_disposition, '心跳复用最近验收观测，不重新收集材料');
        assert(heartbeat.source.events_count === 4 && heartbeat.source.last_event_type === 'heartbeat', '仍读取最新事件');
        assert(heartbeat.liveness.state === 'ACTIVE' && heartbeat.liveness.seconds_since_activity === 1, '仍刷新活性');
        assert(heartbeat.phase.status === 'AGENT_RUNNING' && heartbeat.phase.elapsed_ms === 9000
          && heartbeat.next_action === 'wait_for_agent_invoke_end', '仍保留当前阶段、时长和等待动作');
        const unobserved = projectGoalProgress({ ...input, currentDisposition: null });
        assert(evaluations === 1 && unobserved.current_disposition === undefined && unobserved.chain.estimated_percent === null,
          '无最近验收观测的心跳保持未知，不补跑验收或推断通过');
        projectGoalProgress({ ...input, nowMs: started + 11_000 });
        assert(Number(evaluations) === 2, '正式观测仍实时重算，不能复用心跳缓存');
      } finally { completion.resolveCompletionDisposition = original; }
    },
  },
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
          budget: { ...mkManifest().budget!, max_total_turns: 30 },
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
        assert(snap.budget!.turns_used === 30,
          `lineage turns 应折叠累计 30（25 祖先 + 5 当前），实得 ${snap.budget!.turns_used}（旧实现=当前 run 5）`);
        assert(snap.budget!.turns_limit === 30, `turns_limit=${snap.budget!.turns_limit}`);
        assert(snap.budget!.wall_elapsed_ms === 15 * 60 * 1000,
          `wall 应折叠累计 15m（祖先 10m + 当前 5m），实得 ${snap.budget!.wall_elapsed_ms}`);
        // 无 supersede 的普通视图：折叠空 → 恒等于当前 run（既有断言不回归）
        const noSup = projectGoalProgress({
          projectRoot: root,
          manifest,
          events: cur.filter((l) => !l.includes('"supersede"')).map((l) => JSON.parse(l) as GoalRunEvent),
          workflow,
          nowMs: new Date('2026-08-03T01:06:00.000Z').getTime(),
          featuresDir: 'doc/features',
        });
        assert(noSup.budget!.turns_used === 5, `无 supersede 时只计当前 run：${noSup.budget!.turns_used}`);
      } finally {
        try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    },
  },
  {
    name: '1804 progress keeps the original signed invocation start across re-sign and validation resume',
    run: () => {
      const events: GoalRunEvent[] = [
        { ts: '2026-06-10T12:00:00.000Z', type: 'run_start', chain: ['coding'] },
        { ts: '2026-06-10T12:00:01.000Z', type: 'phase_start', phase: 'coding', attempt: 1 },
        { ts: '2026-06-10T12:00:02.000Z', type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i1' },
        { ts: '2026-06-10T12:00:03.000Z', type: 'phase_start', phase: 'coding', driver: 'session', invoke_id: 'coding-i1', handoff_request: { path: 'first.json', sha256: 'a'.repeat(64) } },
        { ts: '2026-06-10T12:03:00.000Z', type: 'phase_start', phase: 'coding', driver: 'session', invoke_id: 'coding-i1', handoff_request: { path: 'resigned.json', sha256: 'b'.repeat(64) } },
        { ts: '2026-06-10T12:04:00.000Z', type: 'agent_invoke_end', phase: 'coding', invoke_id: 'coding-i1' },
        { ts: '2026-06-10T12:04:01.000Z', type: 'resume', start_index: 0 },
        { ts: '2026-06-10T12:04:02.000Z', type: 'phase_start', phase: 'coding', attempt: 1 },
      ];
      const snapshot = projectGoalProgress({ projectRoot: '/tmp', manifest: mkManifest({ start_phase: 'coding', end_phase: 'coding' }), events, workflow,
        nowMs: Date.parse('2026-06-10T12:05:02.000Z') });
      const row = snapshot.phases_summary.find(phase => phase.phase === 'coding');
      assert(row?.duration_ms === 300000, `original execution start must survive re-sign and post-agent resume: ${JSON.stringify(row)}`);
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
        path.join(runs, '20260201T000000Z', 'manifest.json'),
        JSON.stringify({ run_id: '20260201T000000Z' }),
        'utf-8',
      );
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
    name: 'D-1（plan c4e7a9b2 §3.5）testing FAIL → phase_backtrack_requested(invalidated coding/review/ut) → coding phase_start：当前阶段 = coding',
    run: () => {
      const chain = ['spec', 'plan', 'coding', 'review', 'ut', 'testing'];
      let t = 0;
      const ts = (): string => new Date(Date.UTC(2026, 5, 10, 12, 0, t++)).toISOString();
      const events: Array<Record<string, unknown>> = [{ ts: ts(), type: 'run_start', chain }];
      for (const phase of chain.slice(0, -1)) {
        events.push(
          { ts: ts(), type: 'phase_start', phase, attempt: 1 },
          { ts: ts(), type: 'phase_verdict', phase, verdict: 'PASS', action: 'advance' },
        );
      }
      events.push(
        { ts: ts(), type: 'phase_start', phase: 'testing', attempt: 1 },
        { ts: ts(), type: 'phase_verdict', phase: 'testing', verdict: 'FAIL', action: 'backtrack_to_phase' },
        {
          ts: ts(), type: 'phase_backtrack_requested', phase: 'testing', from_phase: 'testing', to_phase: 'coding',
          invalidated_phases: ['coding', 'review', 'ut'], reason: 'repair_candidates', backtracks_used: 1, backtracks_limit: 2,
        },
        { ts: ts(), type: 'phase_start', phase: 'coding', attempt: 2 },
        { ts: ts(), type: 'agent_invoke_start', phase: 'coding' },
      );
      const snap = projectGoalProgress({
        projectRoot: '/tmp', manifest: mkManifest(), events: events as unknown as GoalRunEvent[], workflow,
        nowMs: Date.UTC(2026, 5, 10, 12, 1, 0),
      });
      assert(snap.chain.current_phase === 'coding', `current_phase=${snap.chain.current_phase}`);
      assert(snap.phase.name === 'coding' && snap.phase.status === 'AGENT_RUNNING', JSON.stringify(snap.phase));
      const status = Object.fromEntries(snap.phases_summary.map(p => [p.phase, p.status]));
      assert(status.spec === 'PASSED' && status.plan === 'PASSED', JSON.stringify(status));
      assert(status.review === 'NOT_STARTED' && status.ut === 'NOT_STARTED' && status.testing === 'NOT_STARTED', JSON.stringify(status));
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
      assert(snap.status === 'UNKNOWN', `missing actual execution grant must remain unknown, got ${snap.status}`);
      assert(snap.liveness.state !== 'ACTIVE', `old activity is not a live execution proof: ${snap.liveness.state}`);
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
      assert(snap.status === 'UNKNOWN', `missing actual execution grant must remain unknown, got ${snap.status}`);
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
      assert(snap.status === 'UNKNOWN', `missing actual execution grant must remain unknown, got ${snap.status}`);
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
    name: 'generateProgressMarkdown: includes check milestones and activity',
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
      assert(md.includes('Activity:'), 'activity');
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
      assert(snap.liveness.state !== 'STALLED', 'old manifest timeout cannot create a current author deadline');
      assert(snap.status === 'RUNNING', `fresh live control remains running without a declared deadline: ${snap.status}`);
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
      assert(text.includes('Activity:'), 'activity');
    },
  },
  {
    name: '28e31f53 real b632bb events project the budget halt reason and lineage wall time',
    run: () => {
      const history = path.resolve(__dirname, '../fixtures/host-recovery-history/20261016');
      const runId = '20261016T121435Z-b632bb';
      const manifest = JSON.parse(fs.readFileSync(path.join(history, runId, 'manifest.json'), 'utf8')) as GoalManifest;
      const events = loadEventsJsonl(path.join(history, runId, 'events.jsonl'));
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-budget-history-'));
      try {
        // Preserve raw records, including ancestors required by the production budget fold.
        fs.cpSync(history, path.dirname(path.join(root, manifest.report_dir)), { recursive: true });
        const snap = projectGoalProgress({ projectRoot: root, manifest, events, workflow,
          nowMs: Date.parse(events.at(-1)!.ts!) });
        assert(snap.status === 'HALTED' && snap.status_reason === 'budget_wall_clock', JSON.stringify(snap));
        for (const rendered of [formatGoalStatusText(snap, manifest.feature, runId), generateProgressMarkdown(snap)]) {
          assert(rendered.includes('Reason: budget_wall_clock'), rendered);
          assert(rendered.includes('Historical limits (read only): turns 23/30, wall 479m/480m'), rendered);
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
        { ts: stale, type: 'agent_invoke_start', phase: 'coding', invoke_id: 'p1', effective_timeout_ms: 3_600_000 },
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

cases.push({ name: '395 等待一开始显示引导原因，ready/timeout 清除，不伪造 phase_halt', run: () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-setup-progress-'));
  try {
    const manifest = mkManifest();
    const reason = '设备处于系统开机/升级引导，请在手机上完成引导';
    const events: GoalRunEvent[] = [
      { ts: manifest.created_at, type: 'run_start', chain: ['ut', 'testing'] },
      { ts: manifest.created_at, type: 'phase_start', phase: 'ut', attempt: 1 },
      { ts: manifest.created_at, type: 'condition_wait_started', phase: 'ut', reason, probe: 'device_readiness' } as GoalRunEvent,
    ];
    const project = () => projectGoalProgress({ projectRoot: root, manifest, events, workflow, nowMs: Date.parse(manifest.created_at) + 1000 });
    const snapshot = project();
    assert(formatGoalStatusText(snapshot, manifest.feature, manifest.run_id).includes(reason), 'text 在等待开始就显示动作');
    assert(generateProgressMarkdown(snapshot).includes(reason), 'Markdown 同源');
    for (const end of ['condition_wait_ready', 'condition_wait_timeout']) {
      events.push({ ts: manifest.created_at, type: end, phase: 'ut' });
      assert(!generateProgressMarkdown(project()).includes(reason), end + ' 必须清除旧等待说明');
      events.pop();
    }
    assert(!events.some(e => e.type === 'phase_halt'), '无需虚假 halt');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
} });

cases.push({ name: 'session budget projection: 有效窗内睡眠、隔夜迟到收口和后续 gate 与累计预算同源', run: () => {
  const minute = 60_000;
  const origin = Date.parse('2026-10-23T08:00:00Z');
  const at = (minutes: number): string => new Date(origin + minutes * minute).toISOString();
  const manifest = mkManifest({ start_phase: 'coding', end_phase: 'coding' });
  const events: GoalRunEvent[] = [
    { type: 'run_start', ts: at(0), chain: ['coding'] },
    { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i1', command: 'phase_execute_request', ts: at(0), effective_timeout_ms: 44 * minute },
    { type: 'phase_start', phase: 'coding', invoke_id: 'coding-i1', driver: 'session', ts: at(0),
      handoff_request: { path: 'phases/coding/request.json', sha256: 'a' } },
  ];
  const project = (now: number) => projectGoalProgress({ projectRoot: '/tmp', manifest, workflow, events, nowMs: origin + now * minute }).budget!.wall_elapsed_ms / minute;
  assert(project(20) === 20, '有效窗内睡眠不得扣除');
  assert(project(840) === 44, `未报告隔夜必须封窗：${project(840)}`);
  events.push({ type: 'phase_write_observed', phase: 'coding', ts: at(839) },
    { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'coding-i1', ts: at(840), timed_out: true,
      handoff_report: { path: 'phases/coding/report.json', sha256: 'report', request_sha256: 'a' } });
  assert(project(840) === 44, '迟到观察/report不能拉长旧段');
  events.push({ type: 'run_start', ts: at(840), chain: ['coding'] }, { type: 'harness_start', phase: 'coding', ts: at(840), invoke_id: 'gate' });
  assert(project(842) === 46, '当前 CLI/gate 直播继续计时');
  events.push({ type: 'harness_end', phase: 'coding', ts: at(842), invoke_id: 'gate' }, { type: 'run_end', ts: at(842), status: 'HALTED' });
  assert(project(900) === 46, '收口后停机等待不再计时');
} });

const A7_FIXTURE = path.join(__dirname, '../fixtures/host-recovery-history/20261027-fe4512-invocation');

function a7Project(run: (ctx: {
  root: string; manifest: GoalManifest; events: GoalRunEvent[]; now: number;
  log: (label: string, id?: string, ageMs?: number) => string;
  project: () => GoalProgressSnapshot;
}) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a7-progress-'));
  const now = Date.parse('2026-10-27T07:15:56.571Z');
  const manifest = mkManifest({ start_phase: 'plan', end_phase: 'plan' });
  const events: GoalRunEvent[] = [
    { type: 'run_start', ts: new Date(now - 60_000).toISOString(), chain: ['plan'] },
    { type: 'adapter_probe', output_delivery: 'streaming' },
    { type: 'phase_start', phase: 'plan', attempt: 1, ts: new Date(now - 50_000).toISOString() },
    { type: 'agent_invoke_start', phase: 'plan', invoke_id: 'plan-i1', ts: new Date(now - 40_000).toISOString(), effective_timeout_ms: 99 * 60_000 },
    { type: 'agent_invoke_end', phase: 'plan', invoke_id: 'plan-i1', ts: new Date(now - 35_000).toISOString(), exit_code: 0 },
    { type: 'harness_start', phase: 'plan', ts: new Date(now - 30_000).toISOString() },
    { type: 'harness_end', phase: 'plan', ts: new Date(now - 25_000).toISOString() },
    { type: 'heartbeat', phase: 'plan', ts: new Date(now - 1000).toISOString() },
  ];
  const log = (label: string, id?: string, ageMs = 1000): string => {
    const rel = path.posix.join(manifest.report_dir, 'phases', label, ...(id ? [id] : []), 'agent-output.log');
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'constructed isolated output');
    fs.utimesSync(file, new Date(now - ageMs), new Date(now - ageMs));
    return rel;
  };
  const project = () => projectGoalProgress({ projectRoot: root, manifest, events, workflow, nowMs: now });
  try { run({ root, manifest, events, now, log, project }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

cases.push({
  name: 'a7 real minimal event prefix: auxiliary progress owns its log; omitted history is not full-run budget evidence',
  run: () => a7Project(({ root, log, now }) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(A7_FIXTURE, 'manifest.projection.json'), 'utf-8')) as GoalManifest;
    const events = loadEventsJsonl(path.join(A7_FIXTURE, 'events.prefix.jsonl'));
    const oldFile = path.join(root, manifest.report_dir, 'phases/plan/agent-output.log');
    const label = 'plan-verifier-format-repair';
    const id = 'plan-verifier-format-repair-i28-7611d248ab56';
    const ownRel = path.posix.join(manifest.report_dir, 'phases', label, id, 'agent-output.log');
    for (const [rel, mtime] of [[oldFile, Date.parse('2026-10-26T08:35:53.849Z')], [path.join(root, ownRel), now - 1000]] as const) {
      fs.mkdirSync(path.dirname(rel), { recursive: true });
      fs.writeFileSync(rel, 'constructed isolated output; cutoff mtime is not a captured host stat');
      fs.utimesSync(rel, new Date(mtime), new Date(mtime));
    }
    const snapshot = projectGoalProgress({ projectRoot: root, manifest, events, workflow, nowMs: now });
    assert(snapshot.phase.name === 'plan' && snapshot.phase.status === 'AGENT_RUNNING', JSON.stringify(snapshot.phase));
    assert(snapshot.phase.substep === 'agent_invoke' && snapshot.next_action === 'wait_for_agent_invoke_end', snapshot.next_action);
    assert(snapshot.artifacts.agent_output_log === ownRel && snapshot.phases_summary.find(s => s.phase === 'plan')?.evidence === ownRel, '工作面和证据须同一次调用');
    assert(snapshot.liveness.state === 'ACTIVE' && snapshot.liveness.agent_output_stalled_ms === null, JSON.stringify(snapshot.liveness));
    assert(snapshot.phase.attempt === 1 && snapshot.budget!.turns_used === 1, '局部 fixture 修前修后均为 attempt=1/turns=1，不凑历史30轮');
    assert(snapshot.phase.started_at === '2026-10-27T07:11:37.125Z' && snapshot.budget!.phase_timeout_ms === 5_400_000, '保原里程碑起点及当前实际调用记录的5400000ms工具授予，不借manifest默认值');
  }),
});

cases.push({
  name: 'a7 production projection: ordinary, verifier repair, design repair and canary follow matching start/end/harness/verdict',
  run: () => {
    for (const label of ['plan', 'plan-verifier-format-repair', 'design-repair-author', 'vision-canary']) {
      a7Project(({ events, now, log, project }) => {
        const before = project();
        const auxiliary = label !== 'plan';
        const ownRel = log(label, auxiliary ? 'current-i2' : undefined);
        if (auxiliary) log('plan', undefined, 23 * 60 * 60_000);
        events.push({ type: 'agent_invoke_start', phase: label, ...(auxiliary ? { chain_phase: 'plan', purpose: label } : {}),
          invoke_id: 'current-i2', ts: new Date(now - 10_000).toISOString(), effective_timeout_ms: 20 * 60_000 } as GoalRunEvent);
        const active = project();
        assert(active.phase.status === 'AGENT_RUNNING' && active.next_action === 'wait_for_agent_invoke_end', label);
        assert(active.artifacts.agent_output_log === ownRel && active.phases_summary[0].evidence === ownRel, label + ' evidence');
        assert(active.budget!.phase_timeout_ms === 20 * 60_000 && active.liveness.state === 'ACTIVE', label + ' timeout/liveness');
        assert(active.phase.started_at === before.phase.started_at, label + ' 不重置阶段起点');
        assert(active.phase.attempt === (auxiliary ? before.phase.attempt : before.phase.attempt + 1), label + ' 不把辅助调用计阶段尝试');
        events.push({ type: 'agent_invoke_end', phase: label, invoke_id: 'other', ts: new Date(now - 8000).toISOString() });
        assert(project().phase.status === 'AGENT_RUNNING', label + ' 不匹配ID不得关闭');
        events.push({ type: 'agent_invoke_end', phase: label, invoke_id: 'current-i2', ts: new Date(now - 7000).toISOString() });
        assert(project().phase.status === 'AGENT_DONE', label + ' 对应结束');
        events.push({ type: 'harness_start', phase: 'plan', ts: new Date(now - 6000).toISOString() });
        assert(project().phase.status === 'HARNESS_RUNNING' && project().next_action === 'wait_for_harness_end', label + ' harness');
        events.push({ type: 'phase_verdict', phase: 'plan', verdict: 'PASS', action: 'advance', ts: new Date(now - 5000).toISOString() });
        assert(project().phase.status === 'PASSED', label + ' verdict');
        events.push({ type: 'agent_invoke_start', phase: 'vision-canary', chain_phase: 'plan', invoke_id: 'after-pass', ts: new Date(now - 3000).toISOString() } as GoalRunEvent);
        assert(project().phase.status === 'PASSED', label + ' 不重开已结束span');
        assert(project().artifacts.agent_output_log === null, label + ' canary不借已结束span日志');
      });
    }
  },
});

cases.push({
  name: 'a7 production projection: session handoff evidence never borrows a background log or its static mtime',
  run: () => a7Project(({ root, manifest, events, now, log, project }) => {
    const label = 'plan-verifier-format-repair', id = 'session-i2';
    log('plan', undefined, 23 * 60 * 60_000);
    log(label, id, 23 * 60 * 60_000);
    events.push({ type: 'agent_invoke_start', phase: label, chain_phase: 'plan', invoke_id: id, command: 'phase_execute_request',
      effective_timeout_ms: 300_000, ts: new Date(now - 10_000).toISOString() } as GoalRunEvent);
    const request = { path: `phases/${label}/${id}/request-e1.json`, sha256: 'a'.repeat(64) };
    const file = path.join(root, manifest.report_dir, request.path);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '{}');
    fs.utimesSync(file, new Date(now - 24 * 60 * 60_000), new Date(now - 24 * 60 * 60_000));
    events.push({ type: 'phase_start', phase: label, driver: 'session', invoke_id: id, handoff_request: request } as GoalRunEvent);
    const active = project();
    assert(active.phase.status === 'AGENT_RUNNING' && active.artifacts.agent_output_log === null, JSON.stringify(active.phase));
    assert(active.liveness.signals.agent_output_log === 'missing' && active.liveness.agent_output_stalled_ms === null && active.liveness.state === 'ACTIVE', JSON.stringify(active.liveness));
    assert(active.phases_summary[0].evidence === `${manifest.report_dir}/${request.path}`, String(active.phases_summary[0].evidence));
    const report = { path: `phases/${label}/${id}/report.json`, sha256: 'b'.repeat(64), request_sha256: request.sha256 };
    events.push({ type: 'agent_invoke_end', phase: label, invoke_id: id, handoff_report: report, ts: new Date(now - 1000).toISOString() });
    const done = project();
    assert(done.phase.status === 'AGENT_DONE' && done.phases_summary[0].evidence === `${manifest.report_dir}/${report.path}`, '结束后指向原报告引用');
  }),
});

cases.push({
  name: 'a7 production projection: current invocation timeout falls back to manifest and never borrows an earlier grant',
  run: () => a7Project(({ events, now, project, log }) => {
    events.push({ type: 'agent_invoke_start', phase: 'plan-verifier-format-repair', chain_phase: 'plan', invoke_id: 'legacy-aux',
      ts: new Date(now - 1000).toISOString() } as GoalRunEvent);
    assert(project().budget!.phase_timeout_ms === 0, '缺实际调用授予时保持未知，不借manifest默认或上次99分钟');
    assert(project().artifacts.agent_output_log === null && project().phases_summary[0].evidence === null, '无本调用日志，不借旧阶段证据');
    delete events[events.length - 1].invoke_id;
    log('plan-verifier-format-repair');
    assert(project().artifacts.agent_output_log === null, '链外旧记录缺编号时不猜测阶段平级日志');
  }),
});

cases.push({
  name: 'a7 production projection: streaming auxiliary genuinely stale, buffered and missing output keep existing policy',
  run: () => {
    for (const delivery of ['streaming', 'buffered', 'unknown']) {
      a7Project(({ events, now, log, project }) => {
        events[1].output_delivery = delivery;
        const label = 'plan-verifier-format-repair';
        log('plan', undefined, 1000);
        log(label, 'quiet-i2', SOFT_STALL_MS + 60_000);
        events.push({ type: 'agent_invoke_start', phase: label, chain_phase: 'plan', invoke_id: 'quiet-i2',
          effective_timeout_ms: 90 * 60_000, ts: new Date(now - 20 * 60_000).toISOString() } as GoalRunEvent);
        events.push({ type: 'heartbeat', ts: new Date(now - 1000).toISOString() });
        const snap = project();
        assert(snap.liveness.state === (delivery === 'streaming' ? 'SUSPECTED_STALL' : 'ACTIVE'), delivery + JSON.stringify(snap.liveness));
        assert(snap.liveness.agent_output_stalled_ms === (delivery === 'streaming' ? SOFT_STALL_MS + 60_000 : null), delivery);
      });
    }
  },
});

cases.push({
  name: 'a7 production projection: legacy anonymous pairing survives, while two explicit different IDs stay open',
  run: () => {
    for (const [startId, endId, expected] of [[undefined, undefined, 'AGENT_DONE'], ['new', undefined, 'AGENT_DONE'],
      [undefined, 'new', 'AGENT_DONE'], ['new', 'other', 'AGENT_RUNNING'], ['new', 'new', 'AGENT_DONE']] as const) {
      a7Project(({ events, now, project }) => {
        events.push({ type: 'agent_invoke_start', phase: 'plan', ...(startId ? { invoke_id: startId } : {}), ts: new Date(now - 10_000).toISOString() });
        events.push({ type: 'agent_invoke_end', phase: 'plan', ...(endId ? { invoke_id: endId } : {}), ts: new Date(now - 1000).toISOString() });
        assert(project().phase.status === expected, `${startId}/${endId}: ${project().phase.status}`);
      });
    }
    a7Project(({ events, now, project }) => {
      events.push({ type: 'agent_invoke_start', phase: 'plan', invoke_id: 'older', ts: new Date(now - 20_000).toISOString() },
        { type: 'agent_invoke_start', phase: 'plan', ts: new Date(now - 10_000).toISOString() },
        { type: 'agent_invoke_end', phase: 'plan', ts: new Date(now - 1000).toISOString() });
      assert(project().phase.status === 'AGENT_DONE', '匿名end仍关闭最近start');
    });
  },
});

cases.push({
  name: 'a7 production projection: resume/backtrack clears stale auxiliary windows without resetting budgets',
  run: () => {
    for (const reset of [{ type: 'resume', start_index: 0 }, { type: 'phase_backtrack_requested', from_phase: 'plan', invalidated_phases: ['plan'] },
      { type: 'phase_invalidated', phase: 'plan' }]) {
      a7Project(({ events, now, project }) => {
        events.push({ type: 'agent_invoke_start', phase: 'design-repair-author', chain_phase: 'plan', invoke_id: 'stale-aux',
          effective_timeout_ms: 1000, ts: new Date(now - 30 * 60_000).toISOString() } as GoalRunEvent);
        events.push({ ...reset, ts: new Date(now - 1000).toISOString() } as GoalRunEvent,
          { type: 'phase_start', phase: 'plan', attempt: 1, ts: new Date(now - 500).toISOString() });
        const snap = project();
        assert(snap.phase.status === 'PROMPT_READY' && snap.liveness.state === 'ACTIVE', JSON.stringify(snap.phase));
        assert(snap.budget!.phase_timeout_ms === 0 && snap.activity?.calls === 2, '清调用窗口不清真实调用统计，也不重建默认作者期限');
      });
    }
  },
});

cases.push({
  name: 'a7 production projection: real hard timeout and dead runner remain visible without output',
  run: () => a7Project(({ events, now, project, root, manifest }) => {
    events.push({ type: 'agent_invoke_start', phase: 'vision-canary', chain_phase: 'plan', invoke_id: 'canary-open',
      effective_timeout_ms: 1000, ts: new Date(now - 2000).toISOString() } as GoalRunEvent,
      { type: 'agent_invoke_end', phase: 'vision-canary', invoke_id: 'unrelated', ts: new Date(now - 1000).toISOString() });
    assert(project().liveness.state === 'STALLED', '无关end不得遮蔽硬超时');
    const dead = projectGoalProgress({ projectRoot: root, manifest, events, workflow, nowMs: now, liveProbe: true,
      featureLock: { pid: 2_147_483_647, hostname: os.hostname(), updated_at: new Date(now - 10 * 60_000).toISOString() } as Parameters<typeof computeLiveness>[0]['featureLock'] });
    assert(dead.liveness.state === 'ORPHAN_SUSPECTED', JSON.stringify(dead.liveness));
  }),
});

cases.push({
  name: 'a7 production projection: pre-phase canary does not invent a span; WAITING/TERMINAL action keeps priority',
  run: () => a7Project(({ events, now, project, root, manifest, log }) => {
    const canary: GoalRunEvent = { type: 'agent_invoke_start', phase: 'vision-canary', chain_phase: 'plan', invoke_id: 'canary-pre',
      effective_timeout_ms: 120_000, ts: new Date(now - 1000).toISOString() } as GoalRunEvent;
    const pre = projectGoalProgress({ projectRoot: root, manifest, workflow, events: [canary], nowMs: now });
    assert(pre.status === 'PENDING' && pre.phase.status === 'NOT_STARTED' && pre.phase.started_at === null && pre.phase.attempt === 0, JSON.stringify(pre.phase));
    assert(pre.artifacts.agent_output_log === null, 'canary无日志保持missing');
    log('plan', undefined, 24 * 60 * 60_000);
    events.push(canary);
    assert(project().artifacts.agent_output_log === null, '运行中canary不得借之前的阶段日志');
    for (const disposition of ['WAITING', 'TERMINAL'] as const) {
      events.push({ type: 'run_end', status: disposition === 'TERMINAL' ? 'CHAIN_SLICE_COMPLETED' : 'HALTED',
        run_disposition: disposition, run_wait_kind: 'human', ts: new Date(now - 500).toISOString() } as GoalRunEvent);
      const snap = project();
      assert(snap.phase.status === 'AGENT_RUNNING', '保留活动子步来验证裁决优先级');
      assert(snap.run_disposition === disposition && snap.next_action === (disposition === 'WAITING' ? 'await_human_action' : 'inspect_events_terminal'), JSON.stringify({ d: snap.run_disposition, next: snap.next_action }));
      events.pop();
    }
  }),
});

cases.push({
  name: 'a7 production session issue-accept progress wiring uses signed request and accepted report with no background log',
  run: () => a7Project(({ root, manifest, log }) => {
    const now = Date.now(), label = 'plan-verifier-format-repair', invokeId = 'session-production-i1';
    const runDir = path.join(root, manifest.report_dir);
    fs.mkdirSync(runDir, { recursive: true });
    ensureRunControl(runDir, manifest.run_id);
    const acquired = casAcquireRunOwner(runDir, manifest.run_id, 0, { kind: 'session', owner_id: 'a7-progress-session', lease_ms: 120_000 });
    assert(acquired.ok, '沿现有session-handoff fixture建立真实owner');
    if (!acquired.ok) throw new Error('session owner unavailable');
    const context: WorkUnitExecutionContext = {
      runId: manifest.run_id, feature: manifest.feature, workflowId: 'spec-driven', track: 'full', chain: ['plan'],
      phase: label, attemptId: invokeId, owner: { ...acquired.token, kind: 'session' }, projectRoot: root,
      frameworkRoot: FRAMEWORK_ROOT, runDir, reportDir: manifest.report_dir, adapter: 'codex',
      instruction: 'Complete this verifier format repair and report its result.',
      runtimeFacts: { receiptRequired: false, resume: false, successor: false }, childEnv: {},
    };
    let eventTime = now;
    const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'),
      JSON.stringify({ ts: new Date(eventTime).toISOString(), ...event }) + '\n');
    // Only seed the runtime's dispatch prerequisites; issuance and completion rows come from production.
    emit({ type: 'run_start', chain: ['plan'], ts: new Date(now - 3000).toISOString() });
    emit({ type: 'phase_start', phase: 'plan', attempt: 1, ts: new Date(now - 2000).toISOString() });
    emit({ type: 'agent_invoke_start', phase: label, chain_phase: 'plan', purpose: 'verifier_format_repair', invoke_id: invokeId,
      command: 'phase_execute_request', effective_timeout_ms: 120_000, ts: new Date(now - 1000).toISOString() });
    const oldLog = log('plan', undefined, 23 * 60 * 60_000);
    const issued = issueSessionExecution({ context, invokeId, chainPhase: 'plan', purpose: 'verifier_format_repair', timeoutMs: 120_000,
      gateTimeoutMs: 30_000, cleanupReserveMs: 500, preSnapshot: null, writeBoundary: null, emit });
    const project = () => projectGoalProgress({ projectRoot: root, manifest, workflow, events: loadEventsJsonl(path.join(runDir, 'events.jsonl')), nowMs: eventTime });
    assert(readHandoffMaterial<{ invoke_id: string }>(runDir, issued.reference).invoke_id === invokeId, '读取并验证生产签发的真实request材料');
    const running = project();
    assert(running.phase.name === 'plan' && running.phase.status === 'AGENT_RUNNING' && running.phase.substep === 'agent_invoke', JSON.stringify(running.phase));
    assert(running.next_action === 'wait_for_agent_invoke_end', running.next_action);
    assert(running.phases_summary[0].evidence === `${manifest.report_dir}/${issued.reference.path}`, '运行中证据来自生产签发request');
    assert(running.artifacts.agent_output_log === null && running.liveness.signals.agent_output_log === 'missing'
      && running.liveness.agent_output_stalled_ms === null, '会话没有后台log，不能借旧阶段log');
    assert(running.liveness.state === 'ACTIVE' && fs.existsSync(path.join(root, oldLog)), '旧阶段log存在但不参与当前活性');
    eventTime = now + 1000;
    const accepted = acceptSessionExecution({ runDir, issued, report: { phase: label, status: 'passed', details: 'verification reply completed' }, emit, nowMs: eventTime });
    assert(!accepted.duplicate && !accepted.timedOut, '生产接受本次有效报告');
    const committed = acceptedSessionReport(runDir, issued);
    assert(committed?.report.status === 'passed' && !!committed.event.handoff_report, '真实报告材料与生产end事件绑定');
    const done = project();
    assert(done.phase.status === 'AGENT_DONE' && done.phase.substep === 'agent_invoke', JSON.stringify(done.phase));
    assert(done.phases_summary[0].evidence === `${manifest.report_dir}/${committed!.event.handoff_report!.path}`, '结束证据来自生产接受的报告归档');
    assert(done.artifacts.agent_output_log === null && done.liveness.signals.agent_output_log === 'missing', '接受报告后仍不借旧日志');
    assert(!fs.existsSync(path.join(runDir, 'phases', label, invokeId, 'agent-output.log')), '生产session签发/接受没有生成后台log');
    console.log('[a7-session-progress] ' + JSON.stringify({ invoke_id: invokeId, request: issued.reference,
      report: committed!.event.handoff_report, start: { phase: running.phase, next_action: running.next_action, evidence: running.phases_summary[0].evidence,
        log: running.artifacts.agent_output_log, output_signal: running.liveness.signals.agent_output_log },
      end: { phase: done.phase, evidence: done.phases_summary[0].evidence, log: done.artifacts.agent_output_log } }));
  }),
});

cases.push({
  name: 'a7 closed auxiliary preserves unresolved formal timeout without stalling active recovery',
  run: () => {
    for (const failure of ['timed_out', 'silent_killed'] as const) {
      a7Project(({ events, now, log, project }) => {
        events[4].exit_code = 1;
        events[4][failure] = true;
        const label = 'design-repair-author', id = 'repair-i2';
        log(label, id);
        events.push({ type: 'agent_invoke_start', phase: label, chain_phase: 'plan', purpose: 'author', invoke_id: id,
          effective_timeout_ms: 120_000, ts: new Date(now - 10_000).toISOString() } as GoalRunEvent);
        const active = project();
        assert(active.phase.status === 'AGENT_RUNNING' && active.liveness.state === 'ACTIVE', failure + ': 活跃辅助调用不被原正式失败盖成停滞');
        events.push({ type: 'agent_invoke_end', phase: label, chain_phase: 'plan', purpose: 'author', invoke_id: id,
          exit_code: 0, ts: new Date(now - 1000).toISOString() } as GoalRunEvent);
        const closed = project();
        assert(closed.phase.status === 'AGENT_DONE' && closed.liveness.state === 'STALLED', failure + ': 辅助已闭合而正式调用尚无verdict，保留原硬停滞信号');
        events.push({ type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance', ts: new Date(now - 500).toISOString() });
        assert(project().liveness.state === 'STALLED', failure + ': 别的阶段verdict不能收掉plan的超时');
        events.push({ type: 'phase_verdict', phase: 'plan', verdict: 'FAIL', action: 'retry', ts: new Date(now - 100).toISOString() });
        assert(project().liveness.state === 'ACTIVE', failure + ': 正式阶段已有verdict，原超时不再保持未收口停滞');
      });
    }
  },
});

cases.push({
  name: '4c8 wait acknowledged live attention remains bounded while new causes, human action and child changes remain visible',
  run: async () => {
    const root = mkGoalCliProjectRoot();
    try {
      const snapshot = mkStatusSnapshot({ state: 'STALLED', last_activity_at: null, seconds_since_activity: 300,
        agent_output_stalled_ms: null, signals: { feature_lock_heartbeat: 'fresh', runner_lock: 'present',
          agent_output_log: 'unchanged', child_process: 'alive', lingering_pipe: false } });
      snapshot.status = 'STALLED'; snapshot.status_reason = 'hard_stall_threshold';
      const original: GoalWaitObservation = { feature: 'demo', run_id: 'same-run', status: 'STALLED', complete: false,
        event_count: 1, attention: true, stopped: true, snapshot };
      const first = await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'same-run', read: () => original });
      assert(first.reason === 'attention' && !!first.cursor, 'first attention is always delivered');
      let now = 0, reads = 0;
      const continued = await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'same-run', after: first.cursor, timeoutMs: 25,
        now: () => now, read: () => { reads++; return { ...original, event_count: reads + 1,
          snapshot: { ...snapshot, generated_at: new Date(reads).toISOString(), liveness: { ...snapshot.liveness, seconds_since_activity: 300 + reads } } }; },
        sleep: async ms => { now += ms; } });
      assert(continued.reason === 'timeout' && continued.elapsed_ms === 25 && reads > 1, 'heartbeats and elapsed time cannot repurchase the same attention');
      const probe = (observation: GoalWaitObservation, after = first.cursor) => waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'same-run', after, read: () => observation });
      assert((await probe({ ...original, snapshot: { ...snapshot, status_reason: 'different blocker' } })).reason === 'attention', 'a changed cause is reported immediately');
      assert((await probe({ ...original, snapshot: { ...snapshot, run_disposition: 'WAITING', run_wait_kind: 'human' } })).reason === 'attention', 'human action is never acknowledged away');
      assert((await probe({ ...original, snapshot: { ...snapshot, liveness: { ...snapshot.liveness, signals: { ...snapshot.liveness.signals, child_process: 'dead' } } } })).reason === 'attention', 'a dead producer cannot hide behind the same cursor');
      const recovered = await probe({ ...original, feature: 'child', run_id: 'next-run', status: 'RUNNING', attention: false, stopped: false });
      assert(recovered.reason === 'changed' && recovered.observation?.run_id === 'next-run', 'a healthy current child is reported once');
      now = 0;
      assert((await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'same-run', after: recovered.cursor, timeoutMs: 10,
        read: () => ({ ...original, feature: 'child', run_id: 'next-run', status: 'RUNNING', attention: false, stopped: false }),
        now: () => now, sleep: async ms => { now += ms; } })).reason === 'timeout', 'the returned changed cursor resumes normal waiting');
      assert((await probe({ ...original, status: 'HALTED', attention: false })).reason === 'stopped', 'a terminal state retains its original return reason');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
});

cases.push({
  name: '4c8 wait production CLI accepts an acknowledged live warning across restarts without mutating producer events',
  run: () => {
    const results: Array<Record<string, unknown>> = [];
    for (const kind of ['WAITING_EXTERNAL', 'STALLED']) {
      const root = mkGoalCliProjectRoot(), feature = 'wait-ack', runId = 'original';
      const runDir = (id: string) => path.join(root, 'doc/features', feature, 'goal-runs', id);
      const line = (value: unknown) => JSON.stringify(value) + '\n';
      const now = () => new Date().toISOString(), old = new Date(Date.now() - FRESHNESS_STALE_MS - 5000).toISOString();
      const runs = new Set<string>();
      const writeRun = (id: string, events: unknown[], extra: Partial<GoalManifest> = {}) => {
        runs.add(id); fs.mkdirSync(runDir(id), { recursive: true });
        fs.writeFileSync(path.join(runDir(id), 'manifest.json'), JSON.stringify(mkManifest({ feature, run_id: id,
          report_dir: path.relative(root, runDir(id)).replace(/\\/g, '/'), start_phase: 'spec', end_phase: 'coding',
          unattended: { write_mode: 'workspace-write', approval_mode: 'never', timeout_seconds: 1 }, ...extra })));
        fs.writeFileSync(path.join(runDir(id), 'events.jsonl'), events.map(line).join(''));
        fs.writeFileSync(path.join(root, 'doc/features', feature, 'goal-runs/.feature.lock'), JSON.stringify({ ownerId: 'isolated-producer',
          pid: process.pid, hostname: os.hostname(), run_id: id, started_at: now(), updated_at: now() }));
      };
      const call = (label: string, after?: string) => {
        const files = [...runs].flatMap(id => ['events.jsonl', 'manifest.json', 'progress.json', 'run-control.json'].map(name => path.join(runDir(id), name)));
        files.push(path.join(root, 'doc/features', feature, 'goal-runs/.feature.lock'));
        const before = files.map(file => fs.existsSync(file) ? fs.readFileSync(file) : null);
        const cli = runGoalStatusCli(['--feature', feature, '--run-id', runId, '--wait', '--json', '--timeout-ms', '100', ...(after ? ['--after', after] : [])], root);
        assert(cli.status === 0, cli.stderr + cli.stdout);
        for (let i = 0; i < files.length; i++) assert(before[i] === null ? !fs.existsSync(files[i]) : fs.readFileSync(files[i]).equals(before[i]!), 'wait never writes producer events, locks, control or progress');
        const value = JSON.parse(cli.stdout);
        results.push({ kind, label, reason: value.reason, status: value.observation.status, run_id: value.observation.run_id,
          elapsed_ms: value.elapsed_ms, cursor: value.cursor, eventsUnchanged: true });
        return value;
      };
      try {
        writeRun(runId, kind === 'WAITING_EXTERNAL'
          ? [{ ts: now(), type: 'run_start', chain: ['spec', 'coding'] }, { ts: now(), type: 'phase_verdict', phase: 'spec', verdict: 'INCOMPLETE', action: 'defer_external_and_continue_if_allowed' }, { ts: now(), type: 'phase_start', phase: 'coding' }]
          : [{ ts: old, type: 'run_start', chain: ['coding'] }, { ts: old, type: 'agent_invoke_start', phase: 'coding' }, { ts: old, type: 'agent_invoke_end', phase: 'coding', exit_code: 1, timed_out: true }]);
        const first = call('first'); assert(first.reason === 'attention' && first.observation.status === kind, JSON.stringify(first));
        const continued = call('same-state-new-cli', first.cursor); assert(continued.reason === 'timeout', 'same warning accepts explicit continuation in a new CLI process');
        const journal = path.join(runDir(runId), 'events.jsonl');
        fs.appendFileSync(journal, line({ ts: kind === 'STALLED' ? old : now(), type: 'heartbeat', phase: 'coding' }));
        assert(call('heartbeat-same-cursor', first.cursor).reason === 'timeout', 'same cursor ignores heartbeat-only changes');
        const legacy = JSON.parse(Buffer.from(first.cursor, 'base64url').toString('utf8')); delete legacy.attention;
        assert(call('legacy-cursor', Buffer.from(JSON.stringify(legacy)).toString('base64url')).reason === 'attention', 'legacy cursors do not pretend a warning was received');
        if (kind === 'WAITING_EXTERNAL') {
          fs.appendFileSync(journal, line({ ts: now(), type: 'condition_wait_started', phase: 'coding', reason: 'a different external dependency' }));
          const changedCause = call('new-cause', continued.cursor); assert(changedCause.reason === 'attention', 'a new obstacle is reported');
          fs.appendFileSync(journal, line({ ts: now(), type: 'resume' }) + line({ ts: now(), type: 'run_start', chain: ['coding'] }));
          const healthy = call('recovered', changedCause.cursor); assert(healthy.reason === 'changed' && healthy.observation.status === 'RUNNING', JSON.stringify(healthy));
          assert(call('changed-cursor', healthy.cursor).reason === 'timeout', 'the returned cursor waits without repeating changed');
          writeRun('next', [{ ts: now(), type: 'supersede', target_run_id: runId, superseding_run_id: 'next' }, { ts: now(), type: 'run_start', chain: ['spec', 'coding'] }], { successor_of: runId });
          const successor = call('healthy-successor', changedCause.cursor); assert(successor.reason === 'changed' && successor.observation.run_id === 'next', JSON.stringify(successor));
          fs.appendFileSync(path.join(runDir('next'), 'events.jsonl'), line({ ts: now(), type: 'phase_verdict', phase: 'spec', verdict: 'INCOMPLETE', action: 'defer_external_and_continue_if_allowed' }) + line({ ts: now(), type: 'phase_start', phase: 'coding' }));
          const warning = call('successor-warning', changedCause.cursor); assert(warning.reason === 'attention', 'another run cannot inherit the acknowledged obstacle');
          fs.appendFileSync(path.join(runDir('next'), 'events.jsonl'), line({ ts: now(), type: 'run_end', status: 'HALTED' }));
          assert(call('terminal', warning.cursor).reason === 'stopped', 'terminal transition always returns');
          fs.appendFileSync(path.join(runDir('next'), 'events.jsonl'), line({ ts: now(), type: 'resume' }) + line({ ts: now(), type: 'run_start', chain: ['coding'] }) + line({ ts: now(), type: 'run_end', status: 'AWAITING_HUMAN_REVIEW' }));
          assert(call('human-review', warning.cursor).reason === 'attention', 'human review is never suppressed');
          fs.appendFileSync(path.join(runDir('next'), 'events.jsonl'), line({ ts: now(), type: 'resume' }) + line({ ts: now(), type: 'run_start', chain: ['coding'] })
            + line({ ts: now(), type: 'phase_halt', phase: 'coding', run_disposition: 'WAITING', run_wait_kind: 'human' }));
          assert(call('active-human-action', warning.cursor).reason === 'attention', 'human control is reported before run_end even when liveness remains running');
          fs.appendFileSync(path.join(runDir('next'), 'events.jsonl'), line({ ts: now(), type: 'phase_halt', phase: 'coding', run_disposition: 'TERMINAL' }));
          assert(call('active-terminal-control', warning.cursor).reason === 'stopped', 'terminal control is reported before its settling producer exits');
        } else {
          fs.writeFileSync(path.join(root, 'doc/features', feature, 'goal-runs/.feature.lock'), JSON.stringify({ ownerId: 'isolated-producer',
            pid: 2_147_483_647, hostname: os.hostname(), run_id: runId, started_at: old, updated_at: new Date(Date.now() - 7_200_000).toISOString() }));
          assert(call('dead-producer', continued.cursor).reason === 'attention', 'a dead producer remains an immediate concern');
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
    const output = path.resolve(__dirname, '../../reports/4c8d73b1-dev/wait-after-cli-results.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
  },
});

cases.push({
  name: '4c8 wait stays in one call across heartbeats and child completion; explicit tool timeouts resume its cursor without stopping work',
  run: async () => {
    const root = mkGoalCliProjectRoot();
    try {
      let now = 0, reads = 0, sleeps = 0;
      const observation = (stopped = false): GoalWaitObservation => ({ feature: 'demo', run_id: 'root-run',
        status: stopped ? 'HALTED' : 'RUNNING', complete: false, event_count: reads, attention: false, stopped,
        snapshot: { next_action: stopped ? 'inspect' : 'wait', current: { feature: 'child' } } as never });
      const result = await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'root-run',
        read: () => { reads++; return observation(reads === 4); }, now: () => now,
        sleep: async () => { sleeps++; now += 180_000; } });
      assert(result.reason === 'stopped' && reads === 4 && sleeps === 3, JSON.stringify(result));
      assert(result.elapsed_ms === 540_000, 'default is not a periodic 55-second return');
      reads = 0; now = 0;
      const first = await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'root-run', timeoutMs: 100,
        read: () => observation(), now: () => now, sleep: async ms => { now += ms; } });
      assert(first.reason === 'timeout' && !!first.cursor, 'explicit limited tool wait returns its cursor');
      const second = await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'root-run', after: first.cursor,
        read: () => observation(true) });
      assert(second.reason === 'stopped', 'a stop written between tools is consumed');
      const mismatch = await waitForGoalStatus({ projectRoot: root, feature: 'other', runId: 'root-run', after: first.cursor,
        read: () => observation(true) });
      assert(mismatch.reason === 'read_error', 'cursor cannot select another request');
      const cancel = new AbortController(); cancel.abort();
      assert((await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'root-run', signal: cancel.signal,
        read: () => { throw new Error('cancelled reader must not run'); } })).reason === 'cancelled', 'cancellation is a reader result only');
      assert((await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'root-run',
        read: () => { throw new Error('events unavailable'); } })).reason === 'read_error', 'read errors return explicitly');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
});

cases.push({
  name: '4c8 wait production CLI ignores old run_end after resume, follows audited successor and binds cursor to directory',
  run: () => {
    const root = mkGoalCliProjectRoot(), other = mkGoalCliProjectRoot();
    const feature = 'wait-production', runId = 'wait-run';
    const reportRel = `doc/features/${feature}/goal-runs/${runId}`;
    const reportDir = path.join(root, reportRel);
    const eventsFile = path.join(reportDir, 'events.jsonl');
    const now = () => new Date().toISOString();
    const line = (value: unknown) => JSON.stringify(value) + '\n';
    const writeRun = (base: string, id: string, events: unknown[], extra: Record<string, unknown> = {}) => {
      const report = `doc/features/${feature}/goal-runs/${id}`;
      fs.mkdirSync(path.join(base, report), { recursive: true });
      fs.writeFileSync(path.join(base, report, 'manifest.json'), JSON.stringify(mkManifest({ feature, run_id: id, report_dir: report,
        start_phase: 'coding', end_phase: 'coding', ...extra })));
      fs.writeFileSync(path.join(base, report, 'events.jsonl'), events.map(line).join(''));
      const lock = { ownerId: 'wait-test', pid: process.pid, hostname: os.hostname(), started_at: now(), updated_at: now(), run_id: id };
      fs.writeFileSync(path.join(base, `doc/features/${feature}/goal-runs/.feature.lock`), JSON.stringify(lock));
    };
    try {
      const stopped = [{ ts: now(), type: 'run_start', chain: ['coding'] }, { ts: now(), type: 'run_end', status: 'HALTED' }];
      writeRun(root, runId, stopped);
      const args = ['--feature', feature, '--run-id', runId, '--wait', '--json'];
      const terminal = runGoalStatusCli(args, root); assert(terminal.status === 0, terminal.stderr);
      const prior = JSON.parse(terminal.stdout); assert(prior.observation.status === 'HALTED', terminal.stdout);
      fs.appendFileSync(eventsFile, line({ ts: now(), type: 'resume' }) + line({ ts: now(), type: 'run_start', chain: ['coding'] }));
      const running = runGoalStatusCli([...args, '--after', prior.cursor, '--timeout-ms', '30'], root);
      assert(running.status === 0, running.stderr);
      const cursor = JSON.parse(running.stdout); assert(cursor.reason === 'timeout' && cursor.observation.status === 'RUNNING', running.stdout);
      writeRun(other, runId, stopped);
      const wrong = runGoalStatusCli([...args, '--after', cursor.cursor], other);
      assert(wrong.status === 1 && JSON.parse(wrong.stdout).reason === 'read_error', wrong.stderr + wrong.stdout);
      const successor = 'wait-next';
      writeRun(root, successor, [{ ts: now(), type: 'supersede', target_run_id: runId, superseding_run_id: successor },
        { ts: now(), type: 'run_start', chain: ['coding'] }], { successor_of: runId });
      const followed = runGoalStatusCli([...args, '--after', cursor.cursor, '--timeout-ms', '30'], root);
      const follow = JSON.parse(followed.stdout); assert(follow.reason === 'timeout' && follow.observation.run_id === successor, followed.stderr + followed.stdout);
      const nextFile = path.join(root, `doc/features/${feature}/goal-runs/${successor}/events.jsonl`);
      fs.appendFileSync(nextFile, line({ ts: now(), type: 'run_end', status: 'HALTED' }));
      const before = fs.readFileSync(nextFile, 'utf8');
      const ended = runGoalStatusCli([...args, '--after', follow.cursor], root);
      assert(JSON.parse(ended.stdout).observation.run_id === successor, ended.stderr + ended.stdout);
      assert(fs.readFileSync(nextFile, 'utf8') === before, 'observer does not write business or run events');
      fs.appendFileSync(nextFile, '{unreadable\n');
      const unreadable = runGoalStatusCli([...args, '--after', follow.cursor, '--timeout-ms', '50'], root);
      assert(unreadable.status === 1 && JSON.parse(unreadable.stdout).reason === 'read_error', unreadable.stderr + unreadable.stdout);
    } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); }
  },
});

cases.push({
  name: '4c8 wait light polling reads no business files on unchanged state or heartbeat; resumed child, successor and preserved-mtime corruption reach the authority reader',
  run: () => {
    const root = mkGoalCliProjectRoot(), feature = 'wait-light', runId = 'root';
    const directory = path.join(root, 'doc/features', feature, 'goal-runs', runId);
    const eventsFile = path.join(directory, 'events.jsonl');
    const line = (value: unknown) => JSON.stringify(value) + '\n';
    const lockModule = require('../../scripts/utils/goal-run-lock') as typeof import('../../scripts/utils/goal-run-lock');
    const oldAlive = lockModule.isPidAlive;
    const fsRuntime = require('fs') as typeof import('fs');
    const oldReadFile = fsRuntime.readFileSync, oldRead = fsRuntime.readSync;
    let fileReads = 0, boundedBytes = 0;
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(mkManifest({ feature, run_id: runId,
        report_dir: `doc/features/${feature}/goal-runs/${runId}`, start_phase: 'coding', end_phase: 'coding' })));
      fs.writeFileSync(eventsFile, line({ ts: new Date().toISOString(), type: 'run_start', chain: ['coding'] }));
      fs.writeFileSync(path.join(directory, 'run-control.json'), JSON.stringify({ current_epoch: 1, owner: {
        kind: 'process', state: 'active', pid: process.pid, hostname: os.hostname(), owner_id: 'light-test', epoch: 1 } }));
      const read = createGoalWaitReader({ projectRoot: root, frameworkRoot: path.join(root, 'framework'), featuresDir: 'doc/features', feature, runId });
      const first = read(); assert(first.status === 'RUNNING', JSON.stringify(first));
      (fsRuntime as any).readFileSync = (...args: any[]) => { fileReads++; return (oldReadFile as any)(...args); };
      (fsRuntime as any).readSync = (...args: any[]) => { const bytes = (oldRead as any)(...args); boundedBytes += bytes; return bytes; };
      assert(read() === first && read() === first, 'unchanged state keeps the authoritative observation');
      assert(fileReads === 0 && boundedBytes === 0, `static reads=${fileReads}, bytes=${boundedBytes}`);
      fs.appendFileSync(eventsFile, line({ ts: new Date().toISOString(), type: 'heartbeat' }));
      assert(read() === first, 'heartbeat does not repurchase business projection');
      assert(fileReads === 0 && boundedBytes > 0 && boundedBytes < 2048, `heartbeat file reads=${fileReads}, bounded=${boundedBytes}`);
      const beforeDeath = fileReads;
      (lockModule as any).isPidAlive = () => false;
      read(); assert(fileReads > beforeDeath, 'a live-to-dead owner transition triggers the existing authority reader');
      (lockModule as any).isPidAlive = oldAlive;
      fs.appendFileSync(eventsFile, line({ ts: new Date().toISOString(), type: 'run_end', status: 'HALTED' }));
      assert(read().stopped, 'same-run stop reaches authoritative projection');
      fs.appendFileSync(eventsFile, line({ ts: new Date().toISOString(), type: 'resume' }) + line({ ts: new Date().toISOString(), type: 'run_start', chain: ['coding'] }));
      assert(read().status === 'RUNNING', 'real resume clears the old terminal');
      const child = path.join(root, 'doc/features', feature, 'existing-child/goal-runs/child');
      fs.mkdirSync(child, { recursive: true });
      fs.writeFileSync(path.join(child, 'events.jsonl'), line({ type: 'heartbeat', ts: new Date().toISOString() }));
      read(); fileReads = 0;
      fs.appendFileSync(path.join(child, 'events.jsonl'), line({ type: 'resume', ts: new Date().toISOString() }));
      read(); assert(fileReads > 0, 'an existing child switch cannot hide behind an unchanged root journal');
      const successor = path.join(root, 'doc/features', feature, 'goal-runs/next');
      fs.mkdirSync(successor, { recursive: true });
      fs.writeFileSync(path.join(successor, 'manifest.json'), JSON.stringify(mkManifest({ feature, run_id: 'next', successor_of: runId,
        report_dir: `doc/features/${feature}/goal-runs/next`, start_phase: 'coding', end_phase: 'coding' })));
      fs.writeFileSync(path.join(successor, 'events.jsonl'), line({ type: 'supersede', ts: new Date().toISOString(), target_run_id: runId, superseding_run_id: 'next' })
        + line({ type: 'run_start', ts: new Date().toISOString(), chain: ['coding'] }));
      assert(read().run_id === 'next', 'new audited successor is discovered');
      const target = path.join(successor, 'events.jsonl'), stat = fs.statSync(target);
      const text = oldReadFile(target, 'utf8'); fs.writeFileSync(target, '!' + text.slice(1)); fs.utimesSync(target, stat.atime, stat.mtime);
      let failed = false; try { read({ feature, runId: 'next' }); } catch { failed = true; }
      assert(failed, 'same-size corruption with restored mtime is checked against the real previously observed source');
    } finally {
      (fsRuntime as any).readFileSync = oldReadFile; (fsRuntime as any).readSync = oldRead; (lockModule as any).isPidAlive = oldAlive;
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
});

cases.push({
  name: '4c8 wait default segment is sixty minutes; explicit positive limits can shorten or extend it',
  run: async () => {
    const root = mkGoalCliProjectRoot();
    try {
      let now = 0;
      const observation: GoalWaitObservation = { feature: 'demo', run_id: 'same-run', status: 'RUNNING', complete: false,
        event_count: 1, attention: false, stopped: false, snapshot: { next_action: 'wait' } as never };
      const run = (timeoutMs?: number) => waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'same-run', timeoutMs,
        read: () => observation, now: () => now, pollMs: DEFAULT_GOAL_WAIT_TIMEOUT_MS,
        sleep: async ms => { now += ms; } });
      const initial = await run();
      assert(initial.reason === 'timeout' && initial.elapsed_ms === 3_600_000 && !!initial.cursor, JSON.stringify(initial));
      assert(initial.observation === observation, 'latest status remains associated with the same live run');
      now = 0; const shorter = await run(25);
      assert(shorter.reason === 'timeout' && shorter.elapsed_ms === 25, 'explicit shorter positive segment');
      now = 0; const longer = await run(DEFAULT_GOAL_WAIT_TIMEOUT_MS * 2);
      assert(longer.reason === 'timeout' && longer.elapsed_ms === 7_200_000, 'explicit positive segment may exceed the default');
      now = 0; const again = await waitForGoalStatus({ projectRoot: root, feature: 'demo', runId: 'same-run', after: initial.cursor, timeoutMs: 10,
        read: () => observation, now: () => now, sleep: async ms => { now += ms; } });
      assert(again.reason === 'timeout' && again.observation?.run_id === 'same-run', 'timeout does not restart or finish the producer');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
});

cases.push({
  name: '4c8 wait runner clock expires without new files or observer self-renewal; unknown and live successors remain bounded',
  run: () => {
    const root = mkGoalCliProjectRoot(), feature = 'wait-orphan', runId = 'old';
    const runDir = path.join(root, 'doc/features', feature, 'goal-runs', runId);
    const eventsFile = path.join(runDir, 'events.jsonl');
    const lockModule = require('../../scripts/utils/goal-run-lock') as typeof import('../../scripts/utils/goal-run-lock');
    const primary = path.join(root, 'doc/features', feature, 'goal-runs', lockModule.FEATURE_LOCK_NAME);
    const base = Date.now(), realNow = Date.now;
    let now = base;
    const write = (file: string, value: unknown) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
    const fsRuntime = require('fs') as typeof import('fs'); const realRead = fsRuntime.readFileSync;
    try {
      Date.now = () => now;
      write(path.join(runDir, 'manifest.json'), mkManifest({ feature, run_id: runId, report_dir: path.relative(root, runDir).replace(/\\/g, '/'), start_phase: 'coding', end_phase: 'coding' }));
      fs.writeFileSync(eventsFile, JSON.stringify({ type: 'run_start', ts: new Date(base).toISOString(), chain: ['coding'] }) + '\n');
      const lock = { ownerId: 'fixture', pid: process.pid, hostname: os.hostname(), run_id: runId, started_at: new Date(base).toISOString(), updated_at: new Date(base).toISOString() };
      write(primary, lock);
      const manifest = mkManifest({ feature, run_id: runId, report_dir: path.relative(root, runDir).replace(/\\/g, '/'), start_phase: 'coding', end_phase: 'coding' });
      const snapshot = buildLiveGoalStatusSnapshot({ projectRoot: root, featuresDir: 'doc/features', feature, runId,
        manifest, workflow, nowMs: base });
      write(path.join(runDir, 'progress.json'), snapshot);
      write(primary, { ...lock, pid: 2_147_483_647 });
      const read = createGoalWaitReader({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, featuresDir: 'doc/features', feature, runId });
      assert(!read().attention, 'fresh runner observation is not an invented old orphan');
      now = base + 60_000;
      const refreshed = readGoalWaitObservation({ projectRoot: root, frameworkRoot: FRAMEWORK_ROOT, featuresDir: 'doc/features', feature, runId });
      assert(!refreshed.attention, 'observer recomputation is still within the producer freshness window');
      let contents = 0;
      (fsRuntime as any).readFileSync = (...args: any[]) => { contents++; return (realRead as any)(...args); };
      now = base + FRESHNESS_STALE_MS + 1;
      const orphan = read();
      assert(orphan.attention && orphan.status === 'UNKNOWN' && orphan.detail?.includes('orphan_suspected_stale_snapshot') === true, JSON.stringify(orphan));
      assert(contents === 0, 'time-only orphan check must not repurchase blueprint or admission reads');
      (fsRuntime as any).readFileSync = realRead;
      // A foreign fresh snapshot cannot renew this run's producer time.
      write(path.join(runDir, 'progress.json'), { ...snapshot, run_id: 'unrelated', generated_at: new Date(now).toISOString() });
      assert(read().attention, 'mismatching progress binding cannot hide the orphan');
      write(primary, { ...lock, hostname: 'different-host' });
      const foreign = read();
      assert(foreign.status === 'UNKNOWN' && !foreign.attention && !foreign.stopped, 'cross-host uncertainty waits within its observation segment');
      fs.rmSync(primary);
      const missing = read();
      assert(missing.status === 'UNKNOWN' && !missing.attention && !missing.stopped, 'no reliable lock does not manufacture a dead PID');
      const successor = 'next', nextDir = path.join(root, 'doc/features', feature, 'goal-runs', successor);
      write(path.join(nextDir, 'manifest.json'), mkManifest({ feature, run_id: successor, successor_of: runId,
        report_dir: path.relative(root, nextDir).replace(/\\/g, '/'), start_phase: 'coding', end_phase: 'coding' }));
      fs.writeFileSync(path.join(nextDir, 'events.jsonl'), [{ type: 'supersede', target_run_id: runId, superseding_run_id: successor },
        { type: 'run_start', chain: ['coding'] }].map(event => JSON.stringify({ ...event, ts: new Date(base).toISOString() })).join('\n') + '\n');
      write(primary, { ...lock, pid: 2_147_483_647 }); // stale predecessor ownership
      write(path.join(nextDir, lockModule.RUN_LOCK_NAME), { ...lock, run_id: successor }); // actual live successor
      const next = read();
      assert(next.run_id === successor && !next.attention && next.status === 'RUNNING', 'a live audited successor is not the dead predecessor');
    } finally {
      Date.now = realNow; (fsRuntime as any).readFileSync = realRead; fs.rmSync(root, { recursive: true, force: true });
    }
  },
});

cases.push({
  name: '4c8 wait command executes unchanged in PowerShell and Git Bash with space paths',
  run: () => {
    if (process.platform !== 'win32') return;
    const initial = mkGoalCliProjectRoot(), root = initial + ' with spaces';
    fs.renameSync(initial, root);
    const feature = 'receipt-shell', runId = 'same-receipt';
    const directory = path.join(root, 'doc/features', feature, 'goal-runs', runId);
    try {
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(mkManifest({ feature, run_id: runId,
        report_dir: path.relative(root, directory).replace(/\\/g, '/') })));
      fs.writeFileSync(path.join(directory, 'events.jsonl'), happyEvents().map(event => JSON.stringify(event)).join('\n') + '\n');
      const command = goalStatusWaitCommand(root, FRAMEWORK_ROOT, feature, runId);
      assert(command.startsWith('node '), 'a quoted executable expression is not a portable shell command');
      const ps = path.join(root, 'original-command.ps1'), sh = path.join(root, 'original-command.sh');
      fs.writeFileSync(ps, command + '\n'); fs.writeFileSync(sh, command + '\n');
      const check = (file: string, args: string[]) => {
        const result = spawnSync(file, args, { windowsHide: true, encoding: 'utf8', timeout: 30_000 });
        assert(result.status === 0, result.stderr + result.stdout);
        assert(JSON.parse(result.stdout).observation.run_id === runId, 'execute the original command without a rewritten prefix');
      };
      check('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps]);
      const bash = ['D:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe'].find(file => fs.existsSync(file));
      if (bash) check(bash, [sh]);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
});

export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [];
  const timings: UnitExecutionTiming[] = [];
  for (const c of cases) {
    if (!matchesUnitCase(c.name, selector)) continue;
    const finish = startCaseTiming([c.name], timings);
    try {
      await c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    } finally { finish(); }
  }
  return selectedUnitCases(results, selector, timings);
}

export async function runAll(): Promise<UnitCaseResult[]> { return (await runSelectedCases()).results; }
