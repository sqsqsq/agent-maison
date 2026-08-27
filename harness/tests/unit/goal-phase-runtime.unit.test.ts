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
import {
  casAcquireRunOwner,
  ensureRunControl,
  quiesceRunOwner,
  releaseRunOwner,
} from '../../scripts/utils/goal-run-control';
import {
  runGoalRuntimeChain,
  setupGoalRuntimeHost,
  type RunProbe,
} from './goal-runner-testing-integrity.unit.test';
import {
  buildGoalManifestFromInput,
  loadGoalManifestFromRun,
  writeGoalManifest,
} from '../../scripts/utils/goal-manifest';
import { resolveGoalRunBaseline } from '../../scripts/utils/goal-run-baseline';
import { resolveGoalRunHeadSha } from '../../scripts/utils/goal-run-creation';
import { handoffSessionToDetached } from '../../scripts/utils/goal-phase-runtime';
import { consumeHandoffAtBoundary, writeHandoffRequest } from '../../scripts/utils/goal-handoff';
import { appendGoalEventFenced } from '../../scripts/utils/goal-in-session-evidence';
import { resolveWorkflowSpec } from '../../workflow-loader';

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

function cloneHost(source: string, label: string): string {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), `goal-runtime-${label}-`));
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  return target;
}

function canonicalOf(probe: RunProbe): ReturnType<typeof projectCanonicalLifecycle> {
  return projectCanonicalLifecycle(probe.events);
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
      assert((processRuntime.match(/while\s*\(!phaseDone\)/g) ?? []).length === 1,
        'detached runtime must contain exactly one canonical phase-attempt loop');
      assert(processRuntime.includes('GoalPhaseRuntime') && processRuntime.includes('DetachedGoalPhaseExecutor'),
        'detached runtime is not wired through the shared runtime/executor boundary');
      assert(!executor.includes('--rebaseline-to') && !supervisor.includes('--rebaseline-to'),
        'executor or supervisor can construct management rebaseline');
    },
  },
  {
    name: 'M2 production parity: attended/detached fresh and retry run the same birth/runtime/gate/projection chain',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const roots: string[] = [base];
      try {
        for (const lifecycle of ['fresh', 'retry'] as const) {
          const detachedRoot = cloneHost(base, `${lifecycle}-detached`);
          const attendedRoot = cloneHost(base, `${lifecycle}-attended`);
          roots.push(detachedRoot, attendedRoot);
          const retrySummary = lifecycle === 'retry'
            ? ({ phase, attempt }: { phase: string; attempt: number }) =>
                phase === 'coding' && attempt === 1
                  ? { blockers: [{
                      id: 'file_completeness',
                      severity: 'BLOCKER',
                      status: 'FAIL',
                      classification: 'code_regression',
                      details_excerpt: '契约声明文件缺失',
                      actionability: 'agent_fixable',
                    }] }
                  : null
            : undefined;
          const detached = await runGoalRuntimeChain(detachedRoot, {
            adapter: 'codex', runId: `matrix-${lifecycle}`,
            executorMode: 'detached', onHarnessSummary: retrySummary,
          });
          const attended = await runGoalRuntimeChain(attendedRoot, {
            adapter: 'codex', runId: `matrix-${lifecycle}`,
            executorMode: 'attended', onHarnessSummary: retrySummary,
          });
          assert(detached.exitCode === 0 && attended.exitCode === 0,
            `${lifecycle} did not close: detached=${detached.exitCode} attended=${attended.exitCode}`);
          assert(JSON.stringify(canonicalOf(detached)) === JSON.stringify(canonicalOf(attended)),
            `${lifecycle} canonical projection drift`);
          assert(JSON.stringify(detached.harnessPhases) === JSON.stringify(attended.harnessPhases),
            `${lifecycle} gate sequence drift`);
          if (lifecycle === 'retry') {
            assert(detached.invokedPhases.filter(phase => phase === 'coding').length === 2,
              `retry did not reinvoke coding: ${detached.invokedPhases.join('→')}`);
          }
          assert(canonicalOf(attended)[0]?.type === 'run_created', `${lifecycle} lost birth`);
        }
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
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
    name: 'M2 production parity: attended/detached resume and automatic successor preserve lifecycle and lineage baseline',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const roots: string[] = [base];
      const blocker = {
        id: 'file_completeness',
        severity: 'BLOCKER',
        status: 'FAIL',
        classification: 'code_regression',
        details_excerpt: '契约声明文件缺失',
        actionability: 'agent_fixable',
      };
      try {
        const halted = await runGoalRuntimeChain(base, {
          adapter: 'codex', runId: 'matrix-resume', executorMode: 'detached',
          onHarnessSummary: ({ phase }) => phase === 'coding' ? { blockers: [blocker] } : null,
        });
        assert(halted.exitCode === 1, `resume fixture did not halt: ${halted.exitCode}`);
        const eventsPath = path.join(halted.reportDir, 'events.jsonl');
        const aged = fs.readFileSync(eventsPath, 'utf8').split('\n').map((line) => {
          if (!line.trim()) return line;
          const event = JSON.parse(line) as { type?: string; ts?: string };
          if (event.type === 'run_end' && event.ts) {
            event.ts = new Date(Date.parse(event.ts) - 10 * 60_000).toISOString();
          }
          return JSON.stringify(event);
        }).join('\n');
        fs.writeFileSync(eventsPath, aged, 'utf8');
        const sourceManifest = loadGoalManifestFromRun(base, 'matrix-resume', { feature: 'bc-openCard' });

        const detachedResumeRoot = cloneHost(base, 'resume-detached');
        const attendedResumeRoot = cloneHost(base, 'resume-attended');
        roots.push(detachedResumeRoot, attendedResumeRoot);
        const detachedResume = await runGoalRuntimeChain(detachedResumeRoot, {
          resume: 'matrix-resume', forceResume: true, adapter: 'codex', executorMode: 'detached',
        });
        const attendedResume = await runGoalRuntimeChain(attendedResumeRoot, {
          resume: 'matrix-resume', forceResume: true, adapter: 'codex', executorMode: 'attended',
        });
        assert(detachedResume.exitCode === 0 && attendedResume.exitCode === 0,
          `resume did not close: detached=${detachedResume.exitCode} attended=${attendedResume.exitCode}`);
        assert(JSON.stringify(canonicalOf(detachedResume)) === JSON.stringify(canonicalOf(attendedResume)),
          'resume canonical projection drift');
        assert(JSON.stringify(detachedResume.harnessPhases) === JSON.stringify(attendedResume.harnessPhases),
          'resume gate sequence drift');
        assert(
          loadGoalManifestFromRun(detachedResumeRoot, 'matrix-resume', { feature: 'bc-openCard' }).run_base_sha ===
            sourceManifest.run_base_sha &&
          loadGoalManifestFromRun(attendedResumeRoot, 'matrix-resume', { feature: 'bc-openCard' }).run_base_sha ===
            sourceManifest.run_base_sha,
          'resume changed immutable birth baseline',
        );

        const detachedSuccessorRoot = cloneHost(base, 'successor-detached');
        const attendedSuccessorRoot = cloneHost(base, 'successor-attended');
        roots.push(detachedSuccessorRoot, attendedSuccessorRoot);
        const detachedSuccessor = await runGoalRuntimeChain(detachedSuccessorRoot, {
          adapter: 'codex', runId: 'matrix-successor', executorMode: 'detached',
          supersede: ['matrix-resume'],
        });
        const attendedSuccessor = await runGoalRuntimeChain(attendedSuccessorRoot, {
          adapter: 'codex', runId: 'matrix-successor', executorMode: 'attended',
          supersede: ['matrix-resume'],
        });
        assert(detachedSuccessor.exitCode === 0 && attendedSuccessor.exitCode === 0,
          `successor did not close: detached=${detachedSuccessor.exitCode} attended=${attendedSuccessor.exitCode}`);
        assert(JSON.stringify(canonicalOf(detachedSuccessor)) === JSON.stringify(canonicalOf(attendedSuccessor)),
          'successor canonical projection drift');
        assert(JSON.stringify(detachedSuccessor.harnessPhases) === JSON.stringify(attendedSuccessor.harnessPhases),
          'successor gate sequence drift');
        const detachedSuccessorManifest = loadGoalManifestFromRun(
          detachedSuccessorRoot, 'matrix-successor', { feature: 'bc-openCard' },
        );
        const attendedSuccessorManifest = loadGoalManifestFromRun(
          attendedSuccessorRoot, 'matrix-successor', { feature: 'bc-openCard' },
        );
        assert(detachedSuccessorManifest.successor_of === 'matrix-resume' &&
          attendedSuccessorManifest.successor_of === 'matrix-resume', 'successor lineage missing');
        assert(detachedSuccessorManifest.run_base_sha === sourceManifest.run_base_sha &&
          attendedSuccessorManifest.run_base_sha === sourceManifest.run_base_sha,
        'successor washed out ancestor baseline');
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
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
    name: 'M2 production handoff parity: session→process and process→session resume through the same fenced runtime',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const roots: string[] = [base];
      try {
        const halted = await runGoalRuntimeChain(base, {
          adapter: 'codex', runId: 'matrix-handoff', executorMode: 'detached',
          onHarnessSummary: ({ phase }) => phase === 'coding' ? { blockers: [{
            id: 'file_completeness', severity: 'BLOCKER', status: 'FAIL',
            classification: 'code_regression', details_excerpt: '契约声明文件缺失',
            actionability: 'agent_fixable',
          }] } : null,
        });
        assert(halted.exitCode === 1, 'handoff fixture must halt before transfer');
        const eventFile = path.join(halted.reportDir, 'events.jsonl');
        fs.writeFileSync(eventFile, fs.readFileSync(eventFile, 'utf8').split('\n').map((line) => {
          if (!line.trim()) return line;
          const event = JSON.parse(line) as { type?: string; ts?: string };
          if (event.type === 'run_end' && event.ts) {
            event.ts = new Date(Date.parse(event.ts) - 10 * 60_000).toISOString();
          }
          return JSON.stringify(event);
        }).join('\n'), 'utf8');

        const sessionToProcessRoot = cloneHost(base, 'handoff-session-process');
        const processToSessionRoot = cloneHost(base, 'handoff-process-session');
        roots.push(sessionToProcessRoot, processToSessionRoot);
        const prepareTransfer = (root: string, from: 'session' | 'process'): void => {
          const manifest = loadGoalManifestFromRun(root, 'matrix-handoff', { feature: 'bc-openCard' });
          const runDir = path.resolve(root, manifest.report_dir);
          const control = ensureRunControl(runDir, manifest.run_id);
          const acquired = casAcquireRunOwner(runDir, manifest.run_id, control.current_epoch, {
            kind: from,
            owner_id: `matrix-${from}`,
            ...(from === 'process' ? { pid: process.pid } : { lease_ms: 60_000 }),
          });
          assert(acquired.ok, `${from} handoff source acquisition failed`);
          const workflow = resolveWorkflowSpec(root, { frameworkRoot: path.resolve(__dirname, '../../..') });
          if (from === 'session') {
            handoffSessionToDetached({
              projectRoot: root,
              frameworkRoot: path.resolve(__dirname, '../../..'),
              runDir,
              token: acquired.token,
              manifest,
              workflow,
              adapter: 'codex',
              mode: 'attended',
              authorization: { mode: 'goal_mode' },
            });
            return;
          }
          const request = writeHandoffRequest(runDir, {
            run_id: manifest.run_id,
            from_epoch: acquired.token.epoch,
            target_owner_kind: 'session',
          });
          const consumed = consumeHandoffAtBoundary(runDir, acquired.token, Date.now());
          assert(consumed.kind === 'consumed', 'process→session mailbox was not consumed');
          appendGoalEventFenced(root, manifest, runDir, acquired.token, {
            type: 'handoff_requested',
            request_id: request.request_id,
            target_owner_kind: 'session',
            from_epoch: acquired.token.epoch,
          });
          quiesceRunOwner(runDir, acquired.token);
          releaseRunOwner(runDir, acquired.token, { allowQuiescing: true });
        };
        prepareTransfer(sessionToProcessRoot, 'session');
        prepareTransfer(processToSessionRoot, 'process');

        const toProcess = await runGoalRuntimeChain(sessionToProcessRoot, {
          resume: 'matrix-handoff', forceResume: true, adapter: 'codex', executorMode: 'detached',
        });
        const toSession = await runGoalRuntimeChain(processToSessionRoot, {
          resume: 'matrix-handoff', forceResume: true, adapter: 'codex', executorMode: 'attended',
        });
        assert(toProcess.exitCode === 0 && toSession.exitCode === 0,
          `handoff targets did not close: process=${toProcess.exitCode} session=${toSession.exitCode}`);
        const processProjection = canonicalOf(toProcess);
        const sessionProjection = canonicalOf(toSession);
        assert(JSON.stringify(processProjection).includes('"from":"session","to":"process","outcome":"success"'),
          'session→process canonical handoff missing');
        assert(JSON.stringify(sessionProjection).includes('"from":"process","to":"session","outcome":"success"'),
          'process→session canonical handoff missing');
        assert(processProjection.filter(event => event.type === 'owner_handoff').length === 1 &&
          sessionProjection.filter(event => event.type === 'owner_handoff').length === 1,
        'handoff projected more than once');
        assert(JSON.stringify(processProjection.filter(event => event.type !== 'owner_handoff')) ===
          JSON.stringify(sessionProjection.filter(event => event.type !== 'owner_handoff')),
        'handoff modes drifted outside the required direction field');
        assert(JSON.stringify(toProcess.harnessPhases) === JSON.stringify(toSession.harnessPhases),
          'handoff gate sequence drift');
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
    },
  },
  {
    name: 'M5 incident closure: legacy HALTED acafa0 can start an audited rebaseline successor in both modes',
    run: async () => {
      const base = setupGoalRuntimeHost('codex').root;
      const roots: string[] = [base];
      try {
        const legacy = buildGoalManifestFromInput({
          feature: 'bc-openCard',
          run_id: 'acafa0',
          requirement: '历史 attended 事故占位者',
          start_phase: 'spec',
          end_phase: 'testing',
          adapter: 'codex',
          unattended: { write_mode: 'full-access', approval_mode: 'never' },
        }, { projectRoot: base });
        const legacyManifestPath = writeGoalManifest(legacy, base);
        const legacyEventsPath = path.join(path.dirname(legacyManifestPath), 'events.jsonl');
        fs.writeFileSync(legacyEventsPath, [
          JSON.stringify({
            type: 'run_start',
            ts: '2026-08-27T00:00:00.000Z',
            manifest_identity_fields: { feature: 'bc-openCard' },
          }),
          JSON.stringify({
            type: 'run_end',
            ts: '2026-08-27T00:01:00.000Z',
            status: 'HALTED',
            halt_reason: 'ui_scope_base_missing',
          }),
        ].join('\n') + '\n', 'utf8');
        const unresolved = resolveGoalRunBaseline(base, 'bc-openCard', 'acafa0');
        assert(!unresolved.available, 'incident source unexpectedly has a trusted legacy baseline');
        const head = resolveGoalRunHeadSha(base);

        const detachedRoot = cloneHost(base, 'incident-rebaseline-detached');
        const attendedRoot = cloneHost(base, 'incident-rebaseline-attended');
        roots.push(detachedRoot, attendedRoot);
        const detachedSourceBytes = fs.readFileSync(
          path.join(detachedRoot, legacy.report_dir, 'events.jsonl'), 'utf8');
        const attendedSourceBytes = fs.readFileSync(
          path.join(attendedRoot, legacy.report_dir, 'events.jsonl'), 'utf8');

        const detached = await runGoalRuntimeChain(detachedRoot, {
          adapter: 'codex',
          executorMode: 'detached',
          runId: 'incident-rebaseline',
          supersede: ['acafa0'],
          rebaselineTo: head,
          freshRequirement: '按当前 HEAD 重建问责边界并继续',
        });
        const attended = await runGoalRuntimeChain(attendedRoot, {
          adapter: 'codex',
          executorMode: 'attended',
          runId: 'incident-rebaseline',
          supersede: ['acafa0'],
          rebaselineTo: head,
          freshRequirement: '按当前 HEAD 重建问责边界并继续',
        });

        assert(detached.exitCode === 0 && attended.exitCode === 0,
          `rebaseline successor did not start/close: detached=${detached.exitCode} attended=${attended.exitCode}`);
        assert(JSON.stringify(canonicalOf(detached)) === JSON.stringify(canonicalOf(attended)),
          'incident canonical projection drift');
        assert(JSON.stringify(detached.harnessPhases) === JSON.stringify(attended.harnessPhases),
          'incident gate sequence drift');
        for (const [root, probe] of [[detachedRoot, detached], [attendedRoot, attended]] as const) {
          const manifest = loadGoalManifestFromRun(root, 'incident-rebaseline', { feature: 'bc-openCard' });
          assert(manifest.successor_of === 'acafa0', 'incident successor lineage missing');
          assert(manifest.run_base_sha === head, 'operator-supplied exact HEAD was not frozen');
          const created = probe.events.find(event => event.type === 'run_created');
          const supersede = probe.events.find(event => event.type === 'supersede');
          assert(created?.rebaseline_from_run_id === 'acafa0', 'run_created lacks rebaseline source audit');
          assert(supersede?.target_run_id === 'acafa0' && supersede?.rebaseline_to === head,
            `supersede audit incomplete: ${JSON.stringify(supersede)}`);
        }
        assert(fs.readFileSync(path.join(detachedRoot, legacy.report_dir, 'events.jsonl'), 'utf8') === detachedSourceBytes,
          'detached management command rewrote the source run');
        assert(fs.readFileSync(path.join(attendedRoot, legacy.report_dir, 'events.jsonl'), 'utf8') === attendedSourceBytes,
          'attended management command rewrote the source run');
      } finally {
        for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
      }
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
