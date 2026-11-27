import { beginUnitCase, runUnitCasesAsync } from '../utils/unit-cases';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AttendedGoalPhaseExecutor, createWorkUnitExecutionContext, observeWorkUnitProviderSession, rebuildWorkUnitExecutionContext, DetachedGoalPhaseExecutor, validateWorkUnitExecutionContext, PHASE_EXECUTION_CONTEXT_FORBIDDEN_FIELDS, type WorkUnitExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { GoalPhaseRuntime } from '../../scripts/utils/goal-phase-runtime';
import { writePhaseExecutionRequestMaterial } from '../../scripts/utils/session-execution-handoff';
import { enrichOutcomesWithProjection } from '../../scripts/goal-phase-runtime';
import { projectCanonicalLifecycle } from '../../scripts/utils/goal-canonical-lifecycle';
import type { HeadlessInvokePlan } from '../../scripts/utils/agent-invoke';
import { recordDesignRepairInvocation } from '../../scripts/utils/design-repair-unattended';
import { invocationCompleted } from '../../scripts/utils/invocation-completion';
import { casAcquireRunOwner, ensureRunControl, releaseRunOwner } from '../../scripts/utils/goal-run-control';

export interface UnitCaseResult { name: string; ok: boolean; error?: string }
interface Case { name: string; run: () => void | Promise<void> }

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function context(overrides: Partial<WorkUnitExecutionContext> = {}): WorkUnitExecutionContext {
  return createWorkUnitExecutionContext({
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

const cases: Case[] = [                      {
    name: 'M2 structural zero: thin shells and executors contain no private lifecycle or gate path',
    run: () => {
      const scripts = path.resolve(__dirname, '../../scripts');
      const runnerShell = fs.readFileSync(path.join(scripts, 'goal-runner.ts'), 'utf-8');
      const driverShell = fs.readFileSync(path.join(scripts, 'utils/goal-in-session-driver.ts'), 'utf-8');
      const hostEntry = fs.readFileSync(path.join(scripts, 'goal-mode-entry.ts'), 'utf-8');
      const executor = fs.readFileSync(path.join(scripts, 'utils/goal-phase-executor.ts'), 'utf-8');
      const processRuntime = fs.readFileSync(path.join(scripts, 'goal-phase-runtime.ts'), 'utf-8');
      const supervisor = fs.readFileSync(path.join(scripts, 'goal-supervise.ts'), 'utf-8');
      assert(!/while\s*\(|for\s*\([^)]*phase/.test(runnerShell), 'goal-runner shell retained a phase loop');
      assert(!/assessFeature|runHarnessPhase|phase_verdict/.test(runnerShell), 'goal-runner shell retained lifecycle ownership');
      assert(!/assessFeature|runHarnessPhase|phase_verdict|for\s*\(|while\s*\(/.test(driverShell),
        'compatibility driver retained private progression');
      assert(!/for\s*\(let round|runInSessionRound|assessFeature/.test(hostEntry),
        'attended host entry retained independent progression');
      assert(!/runHarnessPhase|assessFeature|phase_verdict|writeReceiptScaffold/.test(executor),
        'executor owns a gate or lifecycle transition');
      assert(!/while\s*\(!phaseDone\)/.test(processRuntime)
        && /\bconst readWork = \([^)]*\) =>/.test(processRuntime)
        && /while \(!halted && !dryRun\)[\s\S]*?\breadWork\(\)/.test(processRuntime),
        'runtime must use current unit facts without retaining the retired phase-attempt queue');
      assert(processRuntime.includes('GoalPhaseRuntime') && processRuntime.includes('DetachedGoalPhaseExecutor'),
        'detached runtime is not wired through the shared runtime/executor boundary');
      assert(!executor.includes('--rebaseline-to') && !supervisor.includes('--rebaseline-to'),
        'executor or supervisor can construct management rebaseline');
    },
  },
  {
    name: 'M2 executor contract: WorkUnitExecutionContext is deeply immutable and provider-private fields are absent',
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
    name: 'M2 runtime preserves an absent historical baseline and rejects an invalid recorded SHA before execution',
    run: async () => {
      let invoked = false;
      const executor = new AttendedGoalPhaseExecutor(async (ctx) => {
        invoked = true;
        return { status: 'passed', phase: ctx.phase };
      });
      const runtime = new GoalPhaseRuntime();
      const legacy = context({
        owner: { run_id: 'run-1', owner_id: 'dry-run', epoch: 0, kind: 'session' },
        runtimeFacts: { receiptRequired: true, resume: false, successor: false },
      });
      const result = await runtime.executeExecutor(legacy, executor);
      assert(invoked && result.status === 'passed' && legacy.runtimeFacts.runBaseSha === undefined,
        'ordinary work must proceed without inventing a historical baseline');
      invoked = false;
      let error = '';
      try {
        await runtime.executeExecutor(context({ ...legacy, runtimeFacts: { ...legacy.runtimeFacts, runBaseSha: 'invalid' } }), executor);
      } catch (caught) {
        error = (caught as Error).message;
      }
      assert(error.includes('framework_corruption') && error.includes('run_base_sha'), error);
      assert(!invoked, 'runtime-owned fact failure must not be fed back to the agent');
    },
  },
  {
    name: 'M2 attended protocol has one host entry and runtime rejects missing injected executor',
    run: async () => {
      const code = await new GoalPhaseRuntime({
        args: [
          '--runtime-executor', 'attended',
          '--runtime-owner', 'session',
        ],
        ownerKind: 'session',
      }).run();
      assert(code === 1, `runtime accepted implicit attended stdio executor: ${code}`);
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
    name: 'P1 detached executor: old phase timeout is not an author deadline and invocation output stays truthful',
    run: async () => {
      const plan = { argv: ['codex'], label: 'codex exec', env: {}, adapterName: 'codex' } as HeadlessInvokePlan;
      let called = 0;
      const executor = new DetachedGoalPhaseExecutor(
        (ctx) => ({ plan, cwd: ctx.projectRoot, options: { timeoutMs: 1234, extraEnv: { ...ctx.childEnv } } }),
        async (actualPlan, cwd, options) => {
          called += 1;
          assert(actualPlan.argv === plan.argv && actualPlan.adapterName === 'codex' && actualPlan.modelBinding === context().adapterModel && cwd === '/project', 'invocation plan/cwd drift');
          assert(options?.timeoutMs === undefined && options?.deadlineMs === undefined, 'old phase timeout leaked into the dedicated author');
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
    name: 'P1 work-unit executor resumes only the exact author stream across milestones and isolates verifier or changed authority',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-native-recovery-'));
      const runDir = path.join(root, 'goal-runs', 'run-1');
      const dir = path.join(runDir, 'phases', 'coding', 'old-invoke');
      try {
        fs.mkdirSync(dir, { recursive: true });
        const authority = { write_mode: 'full-access' as const, approval_mode: 'never' as const };
        const old = context({ projectRoot: root, runDir, authority, attemptId: 'old-attempt' });
        const material = { issuedAt: new Date().toISOString(), gateTimeoutMs: 0, cleanupReserveMs: 0, preSnapshot: null, writeBoundary: null };
        writePhaseExecutionRequestMaterial({ ...material, context: old, invokeId: 'old-invoke' });
        fs.writeFileSync(path.join(dir, 'agent-events.jsonl'), JSON.stringify({ type: 'thread.started', thread_id: 'precise-alpha' }) + '\n');
        const starts = [{ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'old-invoke' }];
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), [...starts, { type: 'agent_invoke_end', invoke_id: 'old-invoke' }].map(row => JSON.stringify(row)).join('\n') + '\n');
        const observedContext = (overrides: Partial<WorkUnitExecutionContext> = {}) => {
          const requested = context({ projectRoot: root, runDir, authority, attemptId: 'new-invoke', ...overrides });
          const observed = observeWorkUnitProviderSession(requested);
          assert(!('status' in observed), `the original invocation is not yet reconciled: ${JSON.stringify(observed)}`);
          return createWorkUnitExecutionContext(requested, observed);
        };
        const continued = observedContext({ phase: 'ut' });
        validateWorkUnitExecutionContext(continued);
        assert(continued.provider_session_id === 'precise-alpha', 'UT milestone lost its author session');
        const rebuilt = rebuildWorkUnitExecutionContext(continued, '上下文压缩后缺少关键背景，按当前产物与上一反馈重建');
        assert(!rebuilt.provider_session_id && rebuilt.instruction?.includes('不等于无损'), 'context reconstruction claimed to preserve private native state');
        assert(observedContext({ phase: 'questioning' }).provider_session_id === undefined, 'verifier reused the author');
        assert(observedContext({ authority: { ...authority, write_mode: 'workspace-write' } }).provider_session_id === undefined, 'changed permissions reused native state');
        fs.writeFileSync(path.join(dir, 'agent-events.jsonl'), '');
        assert(observedContext().provider_session_id === undefined, 'missing native identity was invented');
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), starts.map(row => JSON.stringify(row)).join('\n') + '\n');
        const outstandingBytes = fs.readFileSync(path.join(runDir, 'events.jsonl'));
        const outstanding = observeWorkUnitProviderSession(context({ projectRoot: root, runDir, authority, attemptId: 'new-invoke' }));
        assert('status' in outstanding && outstanding.status === 'waiting' && outstanding.details?.includes('old-invoke'),
          'another author started before the outstanding call was reconciled');
        assert(fs.readFileSync(path.join(runDir, 'events.jsonl')).equals(outstandingBytes), 'waiting observation fabricated an end or changed the original');
        fs.writeFileSync(path.join(dir, 'agent-events.jsonl'), JSON.stringify({ type: 'thread.started', thread_id: 'precise-alpha' }) + '\n');
        fs.appendFileSync(path.join(runDir, 'events.jsonl'), '{damaged line\n' + JSON.stringify({ type: 'orphan_reclaimed', invoke_id: 'old-invoke' }) + '\n');
        assert(observedContext().provider_session_id === 'precise-alpha', 'the existing orphan reconciliation did not unlock exact continuation');
        fs.writeFileSync(path.join(runDir, 'events.jsonl'), [...starts, { type: 'legacy_run_override', run_id: 'run-1' }].map(row => JSON.stringify(row)).join('\n') + '\n');
        assert(observedContext().provider_session_id === 'precise-alpha', 'the explicit legacy cleanup acknowledgement was ignored');
        writePhaseExecutionRequestMaterial({ ...material, context: { ...old, attemptId: 'later-attempt' }, invokeId: 'unclosed-new' });
        fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'unclosed-new' }) + '\n');
        const laterOutstanding = observeWorkUnitProviderSession(context({ projectRoot: root, runDir, authority, attemptId: 'new-invoke' }));
        assert('status' in laterOutstanding && laterOutstanding.status === 'waiting' && laterOutstanding.details?.includes('unclosed-new'),
          'a historical cleanup acknowledgement cleared a later outstanding author');
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    },
  },
  {
    name: 'P1 work-unit executor accepts non-chain milestones and forwards absolute deadline, observation and cancellation',
    run: async () => {
      const deadline = '2099-10-29T12:30:00.000Z';
      const controller = new AbortController();
      const observations: string[] = [];
      const actualContext = context({ phase: 'repair-implementation-and-tests', user_deadline_at: deadline });
      validateWorkUnitExecutionContext(actualContext);
      const executor = new DetachedGoalPhaseExecutor(() => ({ plan: { argv: ['codex'], label: 'codex exec' }, cwd: '/project',
        options: { timeoutMs: 1, deadlineMs: 1 } }), async (_plan, _cwd, options) => {
        assert(options?.userDeadlineAt === deadline && options.signal === controller.signal, 'explicit user control was lost');
        options.onObservation?.({ type: 'stdout', chunk: 'actual native fact' });
        return { exitCode: 1, command: 'codex exec', stdout: '', stderr: '', interrupted: true, completion_observed: true };
      });
      const result = await executor.execute(actualContext, { signal: controller.signal,
        onObservation: observation => { observations.push(observation.invoke_id); } });
      assert(result.status === 'waiting' && result.interrupted === true, 'interrupted invocation became completed');
      assert(observations.length === 0, 'a missing original request must not produce invented observation facts');
      let expiredCalls = 0;
      const expired = new AttendedGoalPhaseExecutor(async () => { expiredCalls++; return { status: 'passed' }; });
      const stopped = await expired.execute(context({ user_deadline_at: '2000-01-01T00:00:00.000Z' }));
      assert(stopped.status === 'waiting' && expiredCalls === 0, 'expired user constraint started new work');
      const unlimited = new DetachedGoalPhaseExecutor(() => ({ plan: { argv: ['codex'], label: 'codex' }, cwd: '/project' }),
        async () => ({ exitCode: 0, stdout: '', stderr: '', command: 'codex' }));
      for (let i = 0; i < 35; i++) assert((await unlimited.execute(context())).status === 'passed', 'old cumulative call quota returned');
    },
  },
  {
    name: 'M2 detached executor: an explicit waiting result retains its reason instead of becoming failed',
    run: async () => {
      const detail = '独立提供方暂不可用；提供方恢复后继续原窗口。';
      const executor = new DetachedGoalPhaseExecutor(
        () => ({ plan: { argv: ['codex'], label: 'codex exec' } as HeadlessInvokePlan, cwd: '/project' }),
        async () => ({ status: 'waiting', details: detail, exitCode: 0, stdout: '', stderr: '', command: 'codex exec' }),
      );
      const result = await executor.execute(context());
      assert(result.status === 'waiting', JSON.stringify(result));
      assert(result.details === detail, JSON.stringify(result));
      assert(result.exitCode === 0, JSON.stringify(result));
      const withoutReason = new DetachedGoalPhaseExecutor(
        () => ({ plan: { argv: ['codex'], label: 'codex exec' } as HeadlessInvokePlan, cwd: '/project' }),
        async () => ({ status: 'waiting', details: '', exitCode: 0, stdout: '', stderr: '', command: 'codex exec' }),
      );
      const incomplete = await withoutReason.execute(context());
      assert(incomplete.status === 'waiting' && !!incomplete.details, 'an absent reason must not turn waiting into an author failure');
    },
  },
  {
    name: 'M2 design invocation originals stay readonly; real end facts preserve completed waiting and failed outcomes without restoring drafts',
    run: () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-result-replay-'));
      const invokeId = 'design-repair-author-i1';
      const eventFile = path.join(root, 'events.jsonl');
      fs.mkdirSync(path.join(root, 'design-repair'), { recursive: true });
      fs.mkdirSync(path.join(root, 'phases/design-repair-author', invokeId), { recursive: true });
      const draft = path.join(root, 'design-repair/component-blueprint.yaml');
      const rows = [{ type: 'design_authority_repair', stage: 'attempted', signature: 'real-design' },
        { type: 'agent_invoke_start', phase: 'design-repair-author', invoke_id: invokeId },
        { type: 'agent_invoke_end', phase: 'design-repair-author', invoke_id: invokeId, exit_code: 0, status: 'passed' }];
      try {
        fs.writeFileSync(eventFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
        fs.writeFileSync(draft, 'original author bytes\n');
        recordDesignRepairInvocation(root, 'author', invokeId, { started: true, ok: true, status: 'passed', detail: 'actual invocation output' });
        const originalFile = path.join(root, 'phases/design-repair-author', invokeId, 'design-result.json');
        const original = fs.readFileSync(originalFile);
        fs.writeFileSync(draft, 'later machine invalidation\n');
        const saved = JSON.parse(original.toString('utf8'));
        assert(saved.outcome.ok && Buffer.from(saved.draft_outputs['component-blueprint.yaml'], 'base64').toString('utf8') === 'original author bytes\n', 'the producer preserves real output for current-fact recovery');
        assert(invocationCompleted({ ...rows[2], exitCode: rows[2].exit_code }), 'actual completed facts remain reusable');
        for (const status of ['waiting', 'failed']) {
          fs.writeFileSync(eventFile, rows.map(row => JSON.stringify(row.type === 'agent_invoke_end' ? { ...row, status, exit_code: status === 'failed' ? 1 : 0 } : row)).join('\n') + '\n');
          const ended = JSON.parse(fs.readFileSync(eventFile, 'utf8').trim().split('\n').at(-1)!);
          assert(!invocationCompleted({ ...ended, exitCode: ended.exit_code }), 'an archived passed claim cannot overwrite current waiting or failed end facts');
          assert(fs.readFileSync(originalFile).equals(original) && fs.readFileSync(draft, 'utf8') === 'later machine invalidation\n', 'reading an original never restores old drafts over current work');
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
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
      ]);
      assert(JSON.stringify(projected) === JSON.stringify([
        { type: 'owner_handoff', from: 'session', to: 'process', outcome: 'success' },
        { type: 'owner_handoff', from: 'process', to: 'session', outcome: 'success' },
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
      const outcome: { phase: string; verdict: string; halted: boolean; run_disposition?: string; probe?: string } = {
        phase: 'testing', verdict: 'PASS', halted: false,
      };
      const history = [{ type: 'phase_halt', phase: 'testing', run_disposition: 'WAITING', run_wait_kind: 'external', probe: 'device_readiness' },
        { type: 'phase_verdict', phase: 'testing', verdict: 'PASS', harness_exit: 0, stale_summary: false }];
      const current = enrichOutcomesWithProjection([outcome], history)[0];
      assert(!current.run_disposition && !current.probe, 'current real PASS retained the old device wait projection');
      const unknown = enrichOutcomesWithProjection([outcome], [...history,
        { type: 'phase_halt', phase: 'testing', run_disposition: 'WAITING', run_wait_kind: 'external', probe: 'current_evidence_missing' }])[0];
      assert(unknown.run_disposition === 'WAITING' && unknown.probe === 'current_evidence_missing', 'a later real unknown was cleared by historical PASS');
    },
  },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  return runUnitCasesAsync(cases);
}
