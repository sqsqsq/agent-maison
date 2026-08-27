import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AttendedGoalPhaseExecutor,
  createPhaseExecutionContext,
  DetachedGoalPhaseExecutor,
  PHASE_EXECUTION_CONTEXT_FORBIDDEN_FIELDS,
  type PhaseExecutionContext,
} from '../../scripts/utils/goal-phase-executor';
import { GoalPhaseRuntime } from '../../scripts/utils/goal-phase-runtime';
import { projectCanonicalLifecycle } from '../../scripts/utils/goal-canonical-lifecycle';
import type { HeadlessInvokePlan } from '../../scripts/utils/agent-invoke';
import { casAcquireRunOwner, ensureRunControl, releaseRunOwner } from '../../scripts/utils/goal-run-control';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';

export interface UnitCaseResult { name: string; ok: boolean; error?: string }
interface Case { name: string; run: () => void | Promise<void> }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(overrides: Partial<PhaseExecutionContext> = {}): PhaseExecutionContext {
  return createPhaseExecutionContext({
    runId: 'run-1',
    feature: 'demo',
    workflowId: 'spec-driven',
    track: 'full',
    chain: ['spec', 'plan', 'coding'],
    phase: 'coding',
    attemptId: 'i1',
    owner: { run_id: 'run-1', owner_id: 'owner-1', epoch: 1, kind: 'process' },
    projectRoot: '/project',
    frameworkRoot: '/project/framework',
    runDir: '/project/doc/features/demo/goal/runs/run-1',
    reportDir: 'doc/features/demo/goal/runs/run-1',
    adapter: 'codex',
    adapterModel: 'gpt-test',
    runtimeFacts: {
      runBaseSha: 'a'.repeat(40),
      receiptRequired: true,
      resume: false,
      successor: false,
    },
    childEnv: { MAISON_GOAL_RUN_ID: 'run-1' },
    ...overrides,
  });
}

const cases: Case[] = [
  {
    name: 'M2 structural zero: thin shells and executors contain no private lifecycle or gate path',
    run: () => {
      const scripts = path.resolve(__dirname, '../../scripts');
      const runnerShell = fs.readFileSync(path.join(scripts, 'goal-runner.ts'), 'utf-8');
      const driverShell = fs.readFileSync(path.join(scripts, 'utils/goal-in-session-driver.ts'), 'utf-8');
      const hostEntry = fs.readFileSync(path.join(scripts, 'goal-mode-entry.ts'), 'utf-8');
      const executor = fs.readFileSync(path.join(scripts, 'utils/goal-phase-executor.ts'), 'utf-8');
      const processRuntime = fs.readFileSync(path.join(scripts, 'goal-phase-runtime-process.ts'), 'utf-8');
      const supervisor = fs.readFileSync(path.join(scripts, 'goal-supervise.ts'), 'utf-8');
      assert(!/while\s*\(|for\s*\([^)]*phase/.test(runnerShell), 'goal-runner shell retained a phase loop');
      assert(!/assessFeature|runHarnessPhase|phase_verdict/.test(runnerShell), 'goal-runner shell retained lifecycle ownership');
      assert(!/assessFeature|runHarnessPhase|phase_verdict|for\s*\(|while\s*\(/.test(driverShell),
        'compatibility driver retained private progression');
      assert(!/for\s*\(let round|runInSessionRound|assessFeature/.test(hostEntry),
        'attended host entry retained independent progression');
      assert(!/runHarnessPhase|assessFeature|phase_verdict|writeReceiptScaffold/.test(executor),
        'executor owns a gate or lifecycle transition');
      assert((processRuntime.match(/while\s*\(!phaseDone\)/g) ?? []).length === 1,
        'detached runtime must contain exactly one canonical phase-attempt loop');
      assert(processRuntime.includes('GoalPhaseRuntime') && processRuntime.includes('DetachedGoalPhaseExecutor'),
        'detached runtime is not wired through the shared runtime/executor boundary');
      assert(!executor.includes('--rebaseline-to') && !supervisor.includes('--rebaseline-to'),
        'executor or supervisor can construct management rebaseline');
    },
  },
  {
    name: 'M2 lifecycle matrix: attended/detached fresh/retry/resume/handoff/successor use production birth/runtime/projection APIs',
    run: async () => {
      type Lifecycle = 'fresh' | 'retry' | 'resume' | 'handoff' | 'successor';
      const lifecycles: Lifecycle[] = ['fresh', 'retry', 'resume', 'handoff', 'successor'];
      const projections = new Map<string, ReturnType<typeof projectCanonicalLifecycle>>();
      for (const lifecycle of lifecycles) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `goal-runtime-${lifecycle}-`));
        try {
          const manifest = buildGoalManifestFromInput({
            feature: 'demo',
            run_id: `${lifecycle}-run`,
            start_phase: 'coding',
            end_phase: 'coding',
            unattended: { write_mode: 'full-access', approval_mode: 'never' },
          }, { projectRoot: root });
          if (lifecycle === 'successor') {
            manifest.successor_of = 'ancestor-run';
            manifest.run_base_sha = 'a'.repeat(40);
          }
          const created = createGoalRun({
            projectRoot: root,
            manifest,
            chain: ['coding'],
            resolveHead: () => 'a'.repeat(40),
          });
          for (const mode of ['attended', 'detached'] as const) {
            const ctx = context({
              runId: manifest.run_id,
              owner: {
                run_id: manifest.run_id,
                owner_id: 'dry-run',
                epoch: 0,
                kind: mode === 'attended' ? 'session' : 'process',
              },
              projectRoot: root,
              runDir: path.join(root, manifest.report_dir),
              reportDir: manifest.report_dir,
              runtimeFacts: {
                runBaseSha: manifest.run_base_sha,
                receiptRequired: true,
                resume: lifecycle === 'resume',
                successor: lifecycle === 'successor',
              },
            });
            const runtime = new GoalPhaseRuntime();
            if (mode === 'attended') {
              await runtime.executeExecutor(ctx, new AttendedGoalPhaseExecutor(async (actual) => ({
                status: 'passed', phase: actual.phase,
              })));
            } else {
              const plan = { argv: ['adapter'], label: 'adapter', env: {}, adapterName: 'codex' } as HeadlessInvokePlan;
              await runtime.executeExecutor(ctx, new DetachedGoalPhaseExecutor(
                () => ({ plan, cwd: root }),
                async () => ({ exitCode: 0, stdout: '', stderr: '', command: 'adapter' }),
              ));
            }
            const events: Array<Record<string, unknown>> = [created.runCreated];
            if (lifecycle === 'handoff') {
              const target = mode === 'attended' ? 'process' : 'session';
              events.push(
                { type: 'handoff_requested', request_id: `${mode}-h`, target_owner_kind: target },
                { type: 'handoff_accepted', request_id: `${mode}-h`, owner_kind: target },
              );
            }
            events.push({ type: 'phase_start', phase: 'coding', owner_id: mode, attempt: 1 });
            if (lifecycle === 'retry') {
              events.push(
                { type: 'phase_verdict', phase: 'coding', verdict: 'FAIL', action: 'retry' },
                { type: 'phase_start', phase: 'coding', owner_id: mode, attempt: 2 },
              );
            }
            events.push(
              { type: mode === 'attended' ? 'stdio_response' : 'agent_invoke_end', exit_code: 0 },
              { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance' },
              { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' },
            );
            const projection = projectCanonicalLifecycle(events);
            projections.set(`${mode}:${lifecycle}`, projection);
            assert(projection[0]?.type === 'run_created', `${mode}/${lifecycle} lost birth`);
            assert(JSON.stringify(projection).includes('CHAIN_SLICE_COMPLETED'), `${mode}/${lifecycle} lost close`);
          }
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      }
      for (const lifecycle of ['fresh', 'retry', 'resume', 'successor'] as const) {
        assert(
          JSON.stringify(projections.get(`attended:${lifecycle}`)) ===
            JSON.stringify(projections.get(`detached:${lifecycle}`)),
          `${lifecycle} canonical parity drift`,
        );
      }
      const sessionHandoff = projections.get('attended:handoff') ?? [];
      const processHandoff = projections.get('detached:handoff') ?? [];
      assert(JSON.stringify(sessionHandoff).includes('"from":"session","to":"process"'),
        'session→process handoff missing');
      assert(JSON.stringify(processHandoff).includes('"from":"process","to":"session"'),
        'process→session handoff missing');
    },
  },
  {
    name: 'M2 executor contract: PhaseExecutionContext is deeply immutable and provider-private fields are absent',
    run: () => {
      const ctx = context();
      assert(Object.isFrozen(ctx), 'context must be frozen');
      assert(Object.isFrozen(ctx.chain), 'chain must be frozen');
      assert(Object.isFrozen(ctx.owner), 'owner must be frozen');
      assert(Object.isFrozen(ctx.runtimeFacts), 'runtime facts must be frozen');
      assert(Object.isFrozen(ctx.childEnv), 'child env must be frozen');
      const serialized = JSON.stringify(ctx).toLowerCase();
      for (const field of PHASE_EXECUTION_CONTEXT_FORBIDDEN_FIELDS) {
        assert(!serialized.includes(field), `provider-private field leaked: ${field}`);
      }
      const scrubbed = context({ childEnv: { HARNESS_DIFF_BASE_REF: 'attacker', KEEP: 'yes' } });
      assert(!('HARNESS_DIFF_BASE_REF' in scrubbed.childEnv), 'goal baseline env override was not scrubbed');
      assert(scrubbed.childEnv.KEEP === 'yes', 'unrelated child env changed');
    },
  },
  {
    name: 'M2 runtime precondition: missing immutable baseline stops before executor without agent retry',
    run: async () => {
      let invoked = false;
      const executor = new AttendedGoalPhaseExecutor(async (ctx) => {
        invoked = true;
        return { status: 'passed', phase: ctx.phase };
      });
      let error = '';
      try {
        await new GoalPhaseRuntime().executeExecutor(context({
          owner: { run_id: 'run-1', owner_id: 'dry-run', epoch: 0, kind: 'session' },
          runtimeFacts: { receiptRequired: true, resume: false, successor: false },
        }), executor);
      } catch (caught) {
        error = (caught as Error).message;
      }
      assert(error.includes('framework_corruption') && error.includes('run_base_sha'), error);
      assert(!invoked, 'runtime-owned fact failure must not be fed back to the agent');
    },
  },
  {
    name: 'M2 owner fence: stale executor result cannot cross the runtime post-invoke boundary',
    run: async () => {
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-runtime-fence-'));
      try {
        const control = ensureRunControl(runDir, 'run-1');
        const acquired = casAcquireRunOwner(runDir, 'run-1', control.current_epoch, {
          kind: 'process', owner_id: 'owner-1', pid: process.pid,
        });
        assert(acquired.ok, 'initial owner acquisition failed');
        const ctx = context({ runDir, owner: { ...acquired.token, kind: 'process' } });
        const executor = new AttendedGoalPhaseExecutor(async (actual) => {
          releaseRunOwner(runDir, actual.owner);
          const next = ensureRunControl(runDir, 'run-1');
          const replacement = casAcquireRunOwner(runDir, 'run-1', next.current_epoch, {
            kind: 'session', owner_id: 'owner-2',
          });
          assert(replacement.ok, 'replacement owner acquisition failed');
          return { status: 'passed', phase: actual.phase };
        });
        let rejected = false;
        try { await new GoalPhaseRuntime().executeExecutor(ctx, executor); }
        catch { rejected = true; }
        assert(rejected, 'stale executor result crossed the post-invoke fence');
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M2 attended executor: callback transport returns normalized output and cannot own a gate',
    run: async () => {
      let receivedPhase = '';
      const executor = new AttendedGoalPhaseExecutor(async (ctx) => {
        receivedPhase = ctx.phase;
        return { status: 'passed', phase: ctx.phase, details: 'host callback done' };
      });
      const result = await executor.execute(context({ owner: {
        run_id: 'run-1', owner_id: 'session-1', epoch: 2, kind: 'session',
      } }));
      assert(receivedPhase === 'coding', 'callback did not receive immutable context');
      assert(result.status === 'passed' && result.exitCode === 0, JSON.stringify(result));
      assert(result.command === 'phase_execute_request', JSON.stringify(result));
    },
  },
  {
    name: 'M2 detached executor: existing spawn/timeout/output result is behavior-equivalent after extraction',
    run: async () => {
      const plan = { argv: ['codex'], label: 'codex exec', env: {}, adapterName: 'codex' } as HeadlessInvokePlan;
      let called = 0;
      const executor = new DetachedGoalPhaseExecutor(
        (ctx) => ({ plan, cwd: ctx.projectRoot, options: { timeoutMs: 1234, extraEnv: { ...ctx.childEnv } } }),
        async (actualPlan, cwd, options) => {
          called += 1;
          assert(actualPlan === plan && cwd === '/project', 'invocation plan/cwd drift');
          assert(options?.timeoutMs === 1234, 'timeout drift');
          return {
            exitCode: 7,
            stdout: 'stdout',
            stderr: 'stderr',
            command: actualPlan.label,
            timed_out: true,
            duration_ms: 55,
            kill_attempted: true,
          };
        },
      );
      const result = await executor.execute(context());
      assert(called === 1, `called=${called}`);
      assert(result.status === 'failed', JSON.stringify(result));
      assert(result.exitCode === 7 && result.timed_out === true && result.duration_ms === 55, JSON.stringify(result));
      assert(result.stdout === 'stdout' && result.stderr === 'stderr', JSON.stringify(result));
    },
  },
  {
    name: 'M2 canonical projection: attended/detached lifecycle is equal while executor telemetry and volatile identity differ',
    run: () => {
      const birth = { type: 'run_created', ts: 'A', manifest_identity_hash: 'hash', run_base_sha_digest: 'base' };
      const detached = [
        birth,
        { type: 'adapter_probe', pid: 10 },
        { type: 'phase_start', phase: 'coding', ts: 'A', pid: 10, epoch: 1, attempt: 1 },
        { type: 'agent_invoke_start', phase: 'coding', invoke_id: 'detached-i1' },
        { type: 'agent_invoke_end', phase: 'coding', invoke_id: 'detached-i1', exit_code: 0 },
        { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance', ts: 'A' },
        { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED', ts: 'A', pid: 10 },
      ];
      const attended = [
        { ...birth, ts: 'B' },
        { type: 'phase_start', phase: 'coding', ts: 'B', owner_id: 'session', epoch: 99, round: 3 },
        { type: 'stdio_request', phase: 'coding', request_id: 'stdio-1' },
        { type: 'phase_verdict', phase: 'coding', verdict: 'PASS', action: 'advance', ts: 'B' },
        { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED', ts: 'B', pid: 99 },
      ];
      const a = projectCanonicalLifecycle(detached);
      const b = projectCanonicalLifecycle(attended);
      assert(JSON.stringify(a) === JSON.stringify(b), `detached=${JSON.stringify(a)}\nattended=${JSON.stringify(b)}`);
      assert(a.map(event => event.type).join(',') === 'run_created,phase_start,phase_verdict,run_end', JSON.stringify(a));
    },
  },
  {
    name: 'M2 canonical projection: bidirectional handoff direction/outcome is preserved exactly once',
    run: () => {
      const projected = projectCanonicalLifecycle([
        { type: 'handoff_requested', request_id: 'a', target_owner_kind: 'process', from_epoch: 1 },
        { type: 'lease_poll', request_id: 'a' },
        { type: 'handoff_accepted', request_id: 'a', owner_kind: 'process', epoch: 2 },
        { type: 'handoff_requested', request_id: 'b', target_owner_kind: 'session', from_epoch: 2 },
        { type: 'handoff_accepted', request_id: 'b', owner_kind: 'session', epoch: 3 },
        { type: 'handoff_requested', request_id: 'c', target_owner_kind: 'process', from_epoch: 3 },
        { type: 'handoff_rejected', request_id: 'c', target_owner_kind: 'process', reason: 'stale_epoch' },
      ]);
      assert(JSON.stringify(projected) === JSON.stringify([
        { type: 'owner_handoff', from: 'session', to: 'process', outcome: 'success' },
        { type: 'owner_handoff', from: 'process', to: 'session', outcome: 'success' },
        { type: 'owner_handoff', from: 'session', to: 'process', outcome: 'failed' },
      ]), JSON.stringify(projected));
    },
  },
  {
    name: 'M2 canonical projection: halt/backtrack semantics are retained without volatile fields',
    run: () => {
      const projected = projectCanonicalLifecycle([
        { type: 'phase_halt', phase: 'review', halt_reason: 'source_drift', ts: 'x', owner_id: 'p' },
        { type: 'phase_backtrack_requested', phase: 'review', from_phase: 'review', to_phase: 'coding', invalidated_phases: ['review', 'ut'], epoch: 4 },
      ]);
      assert(JSON.stringify(projected) === JSON.stringify([
        { type: 'phase_halt', phase: 'review', halt_reason: 'source_drift' },
        { type: 'phase_backtrack_requested', phase: 'review', from_phase: 'review', to_phase: 'coding', invalidated_phases: ['review', 'ut'] },
      ]), JSON.stringify(projected));
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const testCase of cases) {
    try {
      await testCase.run();
      results.push({ name: testCase.name, ok: true });
    } catch (error) {
      results.push({ name: testCase.name, ok: false, error: (error as Error).stack ?? String(error) });
    }
  }
  return results;
}
