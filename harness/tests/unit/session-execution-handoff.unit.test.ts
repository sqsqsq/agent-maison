import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { issueSessionExecution, readSessionExecution, acceptSessionExecution, acceptedSessionReport,
  readHandoffMaterial, sessionValidationOnlyEligibility, sessionEvents, resignSessionExecution,
  sessionRunMaterialPath, sessionReportInputPath,
  type SessionExecutionReport } from '../../scripts/utils/session-execution-handoff';
import { ensureRunControl, casAcquireRunOwner, readRunControl, releaseRunOwner, markExpiredSessionOrphaned } from '../../scripts/utils/goal-run-control';
import { capturePhaseInvocationSnapshot, type PhaseWriteBoundaryResolution } from '../../scripts/utils/phase-write-boundary';
import type { PhaseExecutionContext } from '../../scripts/utils/goal-phase-executor';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { repairInvocationCompleted } from '../../scripts/utils/goal-runner-phase';
import { runGoalRuntimeChain, setupGoalRuntimeHost } from './goal-runner-testing-integrity.unit.test';
import { runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { loadGoalManifestFromRun } from '../../scripts/utils/goal-manifest';
import * as goalManifest from '../../scripts/utils/goal-manifest';
import { execFileSync } from 'child_process';
import { interruptedIssuanceCli, reusedGatePidCli, junctionSessionCli } from '../utils/session-recovery-cli';
import { reconcileGuardianOwnership } from '../../scripts/utils/goal-containment-reconcile';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-handoff-'));
  const runDir = path.join(root, 'doc/features/demo/goal-runs/run-1'); fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src/value.ts'), 'before\n');
  ensureRunControl(runDir, 'run-1');
  const acquired = casAcquireRunOwner(runDir, 'run-1', 0, { kind: 'session', owner_id: 'session-one', lease_ms: 60_000 });
  assert(acquired.ok); if (!acquired.ok) throw new Error('fixture owner unavailable');
  const boundary: PhaseWriteBoundaryResolution = { projectRoot: root, feature: 'demo', phaseOrder: ['coding', 'ut'],
    domains: [{ owner: 'coding', kind: 'source', match: 'prefix', path: 'src', source: 'fixture product source domain' }],
    protectedRoots: ['src'], diagnostics: [], unresolvedSourcePhases: [] };
  const context: PhaseExecutionContext = { runId: 'run-1', feature: 'demo', workflowId: 'obligation-driven', track: 'full', chain: ['coding', 'ut'],
    phase: 'coding', attemptId: 'attempt-one', owner: { ...acquired.token, kind: 'session' }, projectRoot: root, frameworkRoot: path.join(root, 'framework'),
    runDir, reportDir: 'doc/features/demo/coding/reports', adapter: 'codex', instruction: 'Use the original issued snapshot and execute the requested coding change.',
    runtimeFacts: { runBaseSha: 'a'.repeat(40), receiptRequired: true, resume: false, successor: false },
    childEnv: { MAISON_GOAL_RUN_ID: 'run-1', PRIVATE_TEST_CREDENTIAL: 'must-never-be-persisted' } };
  const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  const start = (invokeId = 'invoke-one', ts = new Date().toISOString()) => emit({ type: 'agent_invoke_start', phase: context.phase, invoke_id: invokeId, attempt_id: context.attemptId, ts });
  const issue = (invokeId = 'invoke-one', emitter = emit, timeoutMs = 60_000) => issueSessionExecution({ context, invokeId, timeoutMs, gateTimeoutMs: 30_000, cleanupReserveMs: 500,
    preSnapshot: capturePhaseInvocationSnapshot(boundary), writeBoundary: boundary, emit: emitter });
  const report: SessionExecutionReport = { status: 'passed', phase: 'coding', details: 'executor completed; formal gate is still required' };
  const files = (): Record<string, string> => {
    const out: Record<string, string> = {};
    const visit = (dir: string) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) visit(file); else out[path.relative(root, file)] = fs.readFileSync(file).toString('base64'); } }; visit(root); return out;
  };
  return { root, runDir, context, boundary, emit, start, issue, report, files, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const cases: Array<{ name: string; run(): void | Promise<void> }> = [{
  name: '1804 real CLI junction project-root aliases share one signed request and waiting report without duplicate invocation',
  run: junctionSessionCli,
}, {
  name: '1804 real next recovers request commit throw and external kill before signing without another invocation or force',
  run: interruptedIssuanceCli,
}, {
  name: '1804 real gate ignores a reused live PID without killing it and actually runs its next gate',
  run: reusedGatePidCli,
}, {
  name: '1804 real CLI resumes a gate whose PID was reused by a SYSTEM process without killing it',
  run: () => reusedGatePidCli(true),
}, {
  name: '1804 session calls are excluded from legacy process cleanup while genuine unclosed headless invocations remain protected',
  run() {
    const probe = { identify: () => null, killTree: () => false };
    assert.equal(reconcileGuardianOwnership([{ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i1', command: 'phase_execute_request' }], probe).kind, 'no_unclosed_bounds');
    for (const command of ['codex exec task', undefined]) assert.equal(reconcileGuardianOwnership([{ type: 'agent_invoke_start', phase: 'coding', invoke_id: 'coding-i1', command }], probe).kind, 'legacy_run');
  },
}, {
  name: '1804 junction run material paths allow missing directories but reject parent escape and final symlinks',
  run() {
    const f = fixture();
    const alias = `${f.root}-alias`;
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'session-handoff-outside-'));
    try {
      fs.symlinkSync(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
      const aliasRun = path.join(alias, path.relative(f.root, f.runDir));
      const nested = path.join(aliasRun, 'not-created', 'nested', 'report.json');
      assert.equal(sessionRunMaterialPath(aliasRun, nested), path.join(fs.realpathSync(f.runDir), 'not-created', 'nested', 'report.json'));
      const aliasContext = { ...f.context, runDir: aliasRun, projectRoot: alias };
      f.start(); const issued = issueSessionExecution({ context: aliasContext, invokeId: 'invoke-one', timeoutMs: 60_000,
        gateTimeoutMs: 30_000, cleanupReserveMs: 500, preSnapshot: capturePhaseInvocationSnapshot(f.boundary), writeBoundary: f.boundary, emit: f.emit });
      assert.deepEqual(readSessionExecution(aliasRun)!.reference, issued.reference);
      acceptSessionExecution({ runDir: aliasRun, issued, report: f.report, emit: f.emit });
      assert(acceptedSessionReport(aliasRun, issued));
      assert.throws(() => sessionRunMaterialPath(aliasRun, path.join(outside, 'escape.json')), /inside this run|escapes this run/);
      fs.symlinkSync(outside, path.join(f.runDir, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => sessionRunMaterialPath(aliasRun, path.join(aliasRun, 'outside-link', 'missing', 'result.json')), /inside this run|escapes this run/);
      const material = path.join(f.runDir, issued.reference.path);
      const finalLink = path.join(f.runDir, 'linked-material');
      // A junction is a final symlink too, and can be created without Windows elevation.
      fs.symlinkSync(path.dirname(material), finalLink, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => sessionRunMaterialPath(aliasRun, path.join(aliasRun, 'linked-material')), /cannot be a symlink/);
    } finally {
      if (fs.existsSync(alias)) fs.unlinkSync(alias);
      if (fs.existsSync(path.join(f.runDir, 'outside-link'))) fs.unlinkSync(path.join(f.runDir, 'outside-link'));
      f.cleanup(); fs.rmSync(outside, { recursive: true, force: true });
    }
  },
}, {
  name: '1804 report input excludes only its exact current-fence file while neighboring run materials stay in the guarded snapshot',
  run() {
    const f = fixture();
    try {
      const runRelative = path.relative(f.root, f.runDir);
      const boundary = { ...f.boundary, protectedRoots: ['src', runRelative] };
      const options = { ownedPrefixes: [runRelative], runtimeExcluded: [`${runRelative}/existing-runtime-output.txt`] };
      f.start();
      const issued = issueSessionExecution({ context: f.context, invokeId: 'invoke-one', purpose: 'author', timeoutMs: 60_000,
        gateTimeoutMs: 30_000, cleanupReserveMs: 500, preSnapshot: capturePhaseInvocationSnapshot(boundary, options), writeBoundary: boundary, snapshotOptions: options, emit: f.emit });
      const input = sessionReportInputPath(f.runDir, issued);
      fs.writeFileSync(input, JSON.stringify(f.report));
      fs.writeFileSync(path.join(f.runDir, 'existing-runtime-output.txt'), 'still excluded by the original snapshot options\n');
      fs.writeFileSync(path.join(path.dirname(input), 'result-other-fence.json'), 'unapproved neighboring write\n');
      acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit });
      const accepted = acceptedSessionReport(f.runDir, issued)!;
      const archive = readHandoffMaterial<{ post_snapshot: { entries: Array<{ path: string }> } }>(f.runDir, accepted.event.handoff_report!);
      const entries = archive.post_snapshot.entries.map(entry => entry.path);
      assert(!entries.includes(path.relative(f.root, input).replace(/\\/g, '/')));
      assert(!entries.some(file => file.endsWith('/existing-runtime-output.txt')));
      assert(entries.some(file => file.endsWith('/result-other-fence.json')), 'an unrelated run file must remain visible to the existing design guard');
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 report archive precedes observed writes and replay freezes the original post after an observation crash',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue(); fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'original reported output\n');
      const archive = path.join(f.runDir, path.dirname(issued.reference.path), `execution-report-e${issued.request.context.owner.epoch}.json`);
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: event => {
        f.emit(event);
        if (event.type === 'phase_write_observed') {
          assert(fs.existsSync(archive), 'immutable report and post must exist before observation commit');
          throw new Error('observation committed before process interruption');
        }
      } }), /observation committed before process interruption/);
      const original = fs.readFileSync(archive);
      fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'later collaboration output\n');
      acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit });
      assert(fs.readFileSync(archive).equals(original));
      const observed = sessionEvents(f.runDir).filter(event => event.type === 'phase_write_observed');
      assert.equal(observed.length, 1);
      assert.equal((observed[0] as any).post_snapshot, JSON.parse(original.toString()).post_snapshot.sha256);
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_end').length, 1);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 unqueryable old gate identity waits without a fake harness end and later validates the accepted author',
  async run() {
    const root = setupGoalRuntimeHost('codex').root, runId = 'session-gate-identity-wait';
    const probes = require('../../scripts/utils/device-session') as typeof import('../../scripts/utils/device-session');
    const original = probes.defaultProcessProbe;
    try {
      await assert.rejects(() => runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
        onSpec: () => { throw new Error('pause before executor report'); } }), /pause before executor report/);
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' });
      const runDir = path.resolve(root, manifest.report_dir), issued = readSessionExecution(runDir)!;
      fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type: 'harness_start', phase: 'spec',
        invoke_id: `spec-${issued.request.context.attemptId}`, process_role: 'harness', run_id: runId,
        pid: process.pid, started_at_ms: 1, executable: process.execPath, token: 'old-gate-token' }) + '\n');
      probes.defaultProcessProbe = () => ({ ...original(), identify: () => null, readStartedAtMs: () => null });
      const parked = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true, realHarness: true });
      assert(acceptedSessionReport(runDir, issued), 'the real report must commit before the gate check');
      assert(!parked.events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), 'unavailable identity is a recoverable condition');
      assert(parked.events.some(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting'));
      assert(!parked.events.some(event => event.type === 'harness_end'), 'no new gate ran and the unknown old gate has not ended');
      assert.equal(sessionValidationOnlyEligibility(parked.events)?.invoke_id, issued.request.invoke_id);
      probes.defaultProcessProbe = original;
      const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
      assert.equal(resumed.exitCode, 0);
      assert.deepEqual(resumed.invokedPhases, [], 'the accepted executor must not be invoked again');
      assert.deepEqual(resumed.harnessPhases, ['spec']);
      assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start').length, 1);
    } finally { probes.defaultProcessProbe = original; fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 one-turn validation-only recovery runs the formal gate without spending a phantom author turn',
  async run() {
    const manifests = require('../../scripts/utils/goal-manifest') as typeof import('../../scripts/utils/goal-manifest');
    const budgets = require('../../scripts/utils/goal-runner-phase') as typeof import('../../scripts/utils/goal-runner-phase');
    const build = manifests.buildGoalManifestFromInput, check = budgets.checkRunBudget;
    for (const gatePasses of [true, false]) {
      const root = setupGoalRuntimeHost('codex').root, runId = `session-one-turn-gate-${gatePasses}`;
      const consumed: number[] = [];
      try {
        manifests.buildGoalManifestFromInput = (input, options) => build({ ...input, budget: { max_total_turns: 1 } }, options);
        let interrupted = false;
        await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
          afterHarnessPass: () => { interrupted = true; throw new Error('one-turn gate interruption after accepted report'); } });
        assert(interrupted);
        budgets.checkRunBudget = (...args: Parameters<typeof check>) => { consumed.push(args[0]); return check(...args); };
        const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true,
          ...(!gatePasses ? { onHarnessSummary: () => ({ checks: [{ id: 'acceptance_content_complete', category: 'structure' as const, severity: 'BLOCKER' as const, status: 'FAIL' as const,
            description: 'a real summary writer rejects the unfinished definition', details: 'acceptance remains incomplete', failure_kind: 'code_regression' as const }] }) } : {}),
        });
        assert.deepEqual(resumed.invokedPhases, []);
        assert.deepEqual(resumed.harnessPhases, ['spec'], 'the already accepted one permitted invocation must receive its formal gate');
        assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start').length, 1);
        assert.equal(resumed.exitCode === 0, gatePasses);
        assert(consumed.length > 0 && consumed.every(turns => turns === 1), `validation must leave the true consumed count at one: ${consumed}`);
        if (!gatePasses) assert(resumed.events.some(event => event.halt_reason === 'budget_turns'), 'a new author is still forbidden by the exhausted hard budget');
      } finally { manifests.buildGoalManifestFromInput = build; budgets.checkRunBudget = check; fs.rmSync(root, { recursive: true, force: true }); }
    }
  },
}, {
  name: '1804 cooperative owner re-sign preserves the original attempt, deadline and pre-snapshot while rejecting the old unconsumed report',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue(); const original = fs.readFileSync(path.join(f.runDir, issued.reference.path));
      fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'partial work before takeover\n');
      releaseRunOwner(f.runDir, f.context.owner);
      const acquired = casAcquireRunOwner(f.runDir, 'run-1', f.context.owner.epoch, { kind: 'session', owner_id: 'cooperative-new-owner', lease_ms: 120_000 });
      assert(acquired.ok); if (!acquired.ok) throw new Error('fixture cooperative takeover failed');
      const reissued = resignSessionExecution(f.runDir, issued, acquired.token, f.emit);
      assert.notEqual(reissued.reference.path, issued.reference.path);
      assert.equal(reissued.request.context.attemptId, issued.request.context.attemptId);
      assert.equal(reissued.request.invoke_id, issued.request.invoke_id);
      assert.equal(reissued.request.issued_at, issued.request.issued_at);
      assert.equal(reissued.request.deadline, issued.request.deadline);
      assert.deepEqual(reissued.request.pre_snapshot, issued.request.pre_snapshot);
      assert.deepEqual(fs.readFileSync(path.join(f.runDir, issued.reference.path)), original);
      assert.equal(readRunControl(f.runDir)!.owner!.lease_expires_at, issued.request.deadline, 're-sign cannot extend the issued execution window');
      const before = f.files();
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit }), /stale request/);
      assert.deepEqual(f.files(), before);
      acceptSessionExecution({ runDir: f.runDir, issued: reissued, report: f.report, emit: f.emit });
      const events = sessionEvents(f.runDir);
      assert.equal(events.filter(event => event.type === 'agent_invoke_start').length, 1);
      assert.equal(events.filter(event => event.type === 'phase_start' && event.handoff_request).length, 2);
      assert.equal(events.filter(event => event.type === 'agent_invoke_end').length, 1);
      const owned = (events.find(event => event.type === 'phase_write_observed') as unknown as { owned: Array<{ pre_sha256: string; post_sha256: string }> }).owned;
      assert.equal(owned[0].pre_sha256, hash('before\n')); assert.equal(owned[0].post_sha256, hash('partial work before takeover\n'));
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 unsigned material cannot dispatch; replaying committed reads preserves request bytes, deadline, snapshot and invocation count',
  run() {
    const f = fixture();
    try {
      f.start();
      assert.throws(() => f.issue('invoke-one', () => { throw new Error('crash before phase_start commit'); }), /crash before/);
      assert.equal(readSessionExecution(f.runDir), null, 'unreferenced request file grants no authority');
      const issued = f.issue(); const before = f.files();
      for (let i = 0; i < 3; i++) {
        const same = readSessionExecution(f.runDir)!;
        assert.deepEqual(same.reference, issued.reference); assert.deepEqual(same.request, issued.request);
      }
      assert.deepEqual(f.files(), before, 're-reading a request must be read only');
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'agent_invoke_start').length, 1);
      assert.equal(sessionEvents(f.runDir).filter(event => event.type === 'phase_start').length, 1);
      const bytes = fs.readFileSync(path.join(f.runDir, issued.reference.path), 'utf8');
      assert(!bytes.includes('must-never-be-persisted')); assert.equal(issued.request.context.childEnv.MAISON_GOAL_RUN_ID, 'run-1');
      assert.equal(issued.request.context.childEnv.PRIVATE_TEST_CREDENTIAL, undefined);
      assert.throws(() => f.issue('invoke-two'), /already outstanding/);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 handoff retains frozen device/provider identifiers and opaque credential references while excluding raw secret and ambient values',
  run() {
    const originalTarget = process.env.HARNESS_HDC_TARGET;
    try {
      for (const reference of ['maison/device/synthetic-1804/v2', 'SYNTHETIC_INVALID_CREDENTIAL_VALUE']) {
        const f = fixture();
        try {
          Object.assign(f.context.childEnv, { HARNESS_HDC_TARGET: 'synthetic-1804', MAISON_DEVICE_TARGET_KIND: 'physical', MAISON_DEVICE_SESSION_ID: 'device-session-one',
            MAISON_DEVICE_ATTEMPT_FROZEN: '1', MAISON_DEVICE_CREDENTIAL_REF: reference, MAISON_GOAL_ATTEMPT: 'attempt-one', MAISON_GOAL_ATTEMPT_PHASE: 'coding',
          MAISON_GOAL_VISUAL_PROVIDER_ADAPTER: 'claude', MAISON_GOAL_VISUAL_PROVIDER_MODEL: 'fixture-model', AMBIENT_UNAPPROVED: 'must-not-be-carried',
          MAISON_GOAL_AUTONOMY_AUTHORIZED: 'SYNTHETIC_EPHEMERAL_AUTHORITY', MAISON_GOAL_AUTHORIZE_AUTONOMY: 'SYNTHETIC_EPHEMERAL_AUTHORITY' });
          f.start(); const issued = f.issue();
          process.env.HARNESS_HDC_TARGET = 'different-current-default';
          const restored = readSessionExecution(f.runDir)!.request.context.childEnv;
          assert.equal(restored.HARNESS_HDC_TARGET, 'synthetic-1804'); assert.equal(restored.MAISON_DEVICE_ATTEMPT_FROZEN, '1');
          assert.equal(restored.MAISON_DEVICE_TARGET_KIND, 'physical'); assert.equal(restored.MAISON_DEVICE_SESSION_ID, 'device-session-one');
          assert.equal(restored.MAISON_GOAL_VISUAL_PROVIDER_ADAPTER, 'claude'); assert.equal(restored.MAISON_GOAL_VISUAL_PROVIDER_MODEL, 'fixture-model');
          assert.equal(restored.MAISON_GOAL_RUN_ID, 'run-1'); assert.equal(restored.MAISON_GOAL_ATTEMPT, 'attempt-one');
          assert.equal(restored.MAISON_DEVICE_CREDENTIAL_REF, reference.startsWith('maison/device/') ? reference : undefined);
          assert.equal(restored.AMBIENT_UNAPPROVED, undefined); assert.equal(restored.PRIVATE_TEST_CREDENTIAL, undefined);
        assert.equal(restored.MAISON_GOAL_AUTONOMY_AUTHORIZED, undefined); assert.equal(restored.MAISON_GOAL_AUTHORIZE_AUTONOMY, undefined);
          const material = fs.readFileSync(path.join(f.runDir, issued.reference.path), 'utf8');
        assert(!material.includes('SYNTHETIC_INVALID_CREDENTIAL_VALUE')); assert(!material.includes('must-never-be-persisted')); assert(!material.includes('must-not-be-carried'));
        assert(!material.includes('SYNTHETIC_EPHEMERAL_AUTHORITY'), 'nonpersistent autonomy cannot become request environment authority');
        } finally { f.cleanup(); }
      }
    } finally {
    if (originalTarget === undefined) delete process.env.HARNESS_HDC_TARGET; else process.env.HARNESS_HDC_TARGET = originalTarget;
    }
  },
}, {
  name: '1804 wrong phase, invalid report and stale owner fence reject before report or attribution writes',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue(); fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'after\n');
      let before = f.files();
      for (const report of [{ ...f.report, phase: 'ut' }, { ...f.report, status: 'success' }, { ...f.report, details: 42 }]) {
        assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: report as SessionExecutionReport, emit: f.emit }), /invalid execution/);
        assert.deepEqual(f.files(), before);
      }
      releaseRunOwner(f.runDir, f.context.owner);
      const next = casAcquireRunOwner(f.runDir, 'run-1', 1, { kind: 'session', owner_id: 'session-two', lease_ms: 60_000 }); assert(next.ok);
      before = f.files();
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit }), /stale owner fence/);
      assert.deepEqual(f.files(), before);
      assert.equal(acceptedSessionReport(f.runDir, issued), null);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 signed event identity mismatch and modified request bytes reject without side effects',
  run() {
    const f = fixture();
    try {
      f.start(); const issued = f.issue();
      const eventPath = path.join(f.runDir, 'events.jsonl'); const events = sessionEvents(f.runDir);
      events[events.length - 1].attempt_id = 'wrong-attempt'; fs.writeFileSync(eventPath, events.map(event => JSON.stringify(event)).join('\n') + '\n');
      let before = f.files(); assert.throws(() => readSessionExecution(f.runDir), /identity mismatch/); assert.deepEqual(f.files(), before);
      events[events.length - 1].attempt_id = f.context.attemptId; fs.writeFileSync(eventPath, events.map(event => JSON.stringify(event)).join('\n') + '\n');
      fs.appendFileSync(path.join(f.runDir, issued.reference.path), ' '); before = f.files();
      assert.throws(() => readSessionExecution(f.runDir), /digest mismatch/); assert.deepEqual(f.files(), before);
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 accepted report attributes writes against the issued pre-snapshot and duplicate reports do not recount or reattribute',
  run() {
    const f = fixture();
    try {
      f.start(); f.issue(); fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'after\n');
      const restored = readSessionExecution(f.runDir)!;
      const result = acceptSessionExecution({ runDir: f.runDir, issued: restored, report: f.report, emit: f.emit });
      assert.deepEqual(result, { duplicate: false, timedOut: false });
      const writes = sessionEvents(f.runDir).filter(event => event.type === 'phase_write_observed'); assert.equal(writes.length, 1);
      const owned = (writes[0] as { owned?: Array<{ path: string; pre_sha256: string; post_sha256: string }> }).owned!;
      assert.deepEqual(owned.map(write => ({ path: write.path, pre: write.pre_sha256, post: write.post_sha256 })), [{ path: 'src/value.ts', pre: hash('before\n'), post: hash('after\n') }]);
      const before = f.files();
      assert.deepEqual(acceptSessionExecution({ runDir: f.runDir, issued: restored, report: f.report, emit: f.emit }), { duplicate: true, timedOut: false });
      assert.deepEqual(f.files(), before);
      assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued: restored, report: { ...f.report, status: 'failed' }, emit: f.emit }), /conflicting execution report/);
      assert.deepEqual(f.files(), before);
      const events = sessionEvents(f.runDir); assert.equal(events.filter(event => event.type === 'agent_invoke_end').length, 1);
      assert(!events.some(event => event.type === 'agent_process_settled'));
      assert.deepEqual(sessionValidationOnlyEligibility(events), { phase: 'coding', invoke_id: 'invoke-one' });
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 same-fence expired and orphaned reports time out once without physical kill or validation eligibility',
  run() {
    const f = fixture();
    try {
      const startMs = Date.now() - 1000; f.start('invoke-one', new Date(startMs).toISOString()); const issued = f.issue('invoke-one', f.emit, 500);
      const expires = Date.parse(readRunControl(f.runDir)!.owner!.lease_expires_at!);
      markExpiredSessionOrphaned(f.runDir, 'run-1', expires + 1);
      const result = acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit, nowMs: expires + 1 });
      assert.deepEqual(result, { duplicate: false, timedOut: true });
      const end = sessionEvents(f.runDir).find(event => event.type === 'agent_invoke_end')!;
      assert.equal(end.timed_out, true); assert.equal(end.kill_reason, 'agent_timeout'); assert.equal(end.exit_code, 1);
      assert.equal(end.duration_ms, expires + 1 - startMs); assert.equal(end.effective_timeout_ms, 500);
      assert.equal((end as unknown as Record<string, unknown>).kill_attempted, undefined, 'a session timeout is not proof of a physical kill');
      assert.equal(sessionValidationOnlyEligibility(sessionEvents(f.runDir)), null);
      assert.equal(readRunControl(f.runDir)!.current_epoch, f.context.owner.epoch, 'module acceptance grants no takeover');
      const before = f.files(); acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: f.emit, nowMs: expires + 20_000 });
      assert.deepEqual(f.files(), before, 'duplicate timeout does not extend/recount its duration');
    } finally { f.cleanup(); }
  },
}, {
  name: '1804 waiting and failed reports remain truthful and a later retry or invalidation removes validation-only eligibility',
  run() {
    for (const status of ['waiting', 'failed', 'passed'] as const) {
      const f = fixture();
      try {
        f.start(); const issued = f.issue(); acceptSessionExecution({ runDir: f.runDir, issued, report: { ...f.report, status }, emit: f.emit });
        assert.equal(acceptedSessionReport(f.runDir, issued)!.report.status, status);
        assert.equal(Boolean(sessionValidationOnlyEligibility(sessionEvents(f.runDir))), status !== 'waiting');
        assert.equal(repairInvocationCompleted(sessionEvents(f.runDir), 'coding', issued.request.invoke_id), status === 'passed', 'waiting cannot complete a repair owner');
        assert(!sessionEvents(f.runDir).some(event => event.type === 'harness_end' || event.type === 'phase_verdict'), 'executor reports never manufacture formal PASS');
        f.emit({ type: 'phase_invalidated', phase: 'coding' }); assert.equal(sessionValidationOnlyEligibility(sessionEvents(f.runDir)), null);
      } finally { f.cleanup(); }
    }
  },
}, {
  name: '1804 crash after attribution or report material preserves exactly one write observation and one accepted report',
  run() {
    for (const crashAt of ['phase_write_observed', 'agent_invoke_end']) {
      const f = fixture();
      try {
        f.start(); const issued = f.issue(); fs.writeFileSync(path.join(f.root, 'src/value.ts'), 'after\n');
        let crashed = false;
        assert.throws(() => acceptSessionExecution({ runDir: f.runDir, issued, report: f.report, emit: event => {
          if (!crashed && event.type === crashAt) { crashed = true; if (crashAt === 'phase_write_observed') f.emit(event); throw new Error('injected report process interruption'); }
          f.emit(event);
        } }), /injected report process interruption/);
        assert.equal(acceptedSessionReport(f.runDir, issued), null);
        acceptSessionExecution({ runDir: f.runDir, issued: readSessionExecution(f.runDir)!, report: f.report, emit: f.emit });
        const events = sessionEvents(f.runDir);
        assert.equal(events.filter(event => event.type === 'phase_write_observed').length, 1);
        assert.equal(events.filter(event => event.type === 'agent_invoke_end').length, 1);
        const accepted = acceptedSessionReport(f.runDir, issued)!;
        const archive = readHandoffMaterial<{ post_snapshot: { entries: Array<{ path: string; sha256: string }> } }>(f.runDir, accepted.event.handoff_report!);
        assert.equal(archive.post_snapshot.entries.find(entry => entry.path === 'src/value.ts')!.sha256, hash('after\n'));
      } finally { f.cleanup(); }
    }
  },
}, {
  name: '1804 production session entry duplicate next/report and wrong-phase report preserve the same dispatch and formal gates',
  async run() {
    const root = setupGoalRuntimeHost('codex').root;
    const observations: Array<Promise<void>> = [];
    const options = { projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId: 'session-independent-entry', adapter: 'codex', runMode: 'attended' };
    try {
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: options.runId, freshEndPhase: 'ut', viaSessionStep: true,
        onSpec: () => {
          const manifest = loadGoalManifestFromRun(root, options.runId, { feature: options.feature }); const runDir = path.resolve(root, manifest.report_dir);
          const issued = readSessionExecution(runDir)!; const before = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
          observations.push(runGoalModeSessionStep(options).then(result => { assert.equal(result.type, 'phase_execute_request'); assert.equal((result.request as { sha256: string }).sha256, issued.reference.sha256); }));
          observations.push(runGoalModeSessionStep({ ...options, requestPath: path.join(runDir, issued.reference.path), report: { status: 'passed', phase: 'ut' } })
            .then(() => { throw new Error('wrong-phase report was accepted'); }, error => { assert.match(String(error), /invalid execution phase/); }));
          assert.equal(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'), before, 'entry queries/rejection cannot dispatch or write events');
        },
        afterHarnessPass: ({ phase }) => {
          if (phase !== 'spec') return;
          const manifest = loadGoalManifestFromRun(root, options.runId, { feature: options.feature }); const runDir = path.resolve(root, manifest.report_dir);
          const issued = readSessionExecution(runDir)!; const before = fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8');
          observations.push(runGoalModeSessionStep({ ...options, requestPath: path.join(runDir, issued.reference.path), report: { status: 'passed', phase } })
            .then(result => { assert.equal(result.type, 'goal_session_report_received'); assert.equal(result.duplicate, true); }));
          assert.equal(fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8'), before, 'duplicate report cannot rerun a live formal gate');
        },
      });
      await Promise.all(observations);
      assert.equal(probe.exitCode, 0);
      assert.equal(probe.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'spec').length, 1);
      assert.equal(probe.events.filter(event => event.type === 'agent_invoke_end' && event.phase === 'spec').length, 1);
      assert.equal(probe.harnessPhases.filter(phase => phase === 'spec').length, 1);
      assert(!probe.events.some(event => event.type === 'agent_process_settled'));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production session accepted report survives a gate interruption and resumes validation without author reinvocation',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const runId = 'session-independent-resume'; let interrupted = false;
    try {
      try {
        await runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'ut', viaSessionStep: true,
          afterHarnessPass: ({ phase }) => { if (phase === 'spec' && !interrupted) { interrupted = true; throw new Error('injected session formal gate interruption'); } },
        });
      } catch (error) { assert.match(String(error), /injected session formal gate interruption/); }
      assert(interrupted, 'must reach the production gate after report acceptance');
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' }); const runDir = path.resolve(root, manifest.report_dir);
      const before = sessionEvents(runDir);
      assert.equal(before.filter(event => event.type === 'agent_invoke_end' && event.phase === 'spec' && event.handoff_report).length, 1);
      assert(!before.some(event => event.type === 'phase_verdict' && event.phase === 'spec'));
      const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
      assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
      assert(!resumed.invokedPhases.includes('spec'), 'accepted executor must not be called again after gate interruption');
      assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'spec').length, 1);
      assert.equal(resumed.events.filter(event => event.type === 'phase_verdict' && event.phase === 'spec' && event.verdict === 'PASS').length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production session can report and formally verify its last permitted invocation without granting another author turn',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const original = goalManifest.buildGoalManifestFromInput;
    const exports = goalManifest as unknown as Record<string, unknown>;
    try {
      // Supply a real one-turn birth input to the production manifest parser/writer.
      exports.buildGoalManifestFromInput = (input: Record<string, unknown>, options: Parameters<typeof original>[1]) => original({ ...input, budget: { max_total_turns: 1 } }, options);
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'session-last-legal-turn', freshEndPhase: 'spec', viaSessionStep: true });
      assert.equal(probe.events.filter(event => event.type === 'agent_invoke_start').length, 1);
      assert.equal(probe.events.filter(event => event.type === 'agent_invoke_end' && event.handoff_report).length, 1);
      assert.equal(probe.harnessPhases.filter(phase => phase === 'spec').length, 1, 'dispatch budget cannot block the already-dispatched work from formal verification');
      assert(probe.events.some(event => event.type === 'phase_verdict' && event.phase === 'spec' && event.verdict === 'PASS'), JSON.stringify(probe.events.filter(event => event.type === 'run_end' || event.type === 'phase_halt')));
      assert.equal(probe.exitCode, 0);
    } finally { exports.buildGoalManifestFromInput = original; fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production expired session reports close the original fence, account time and never reset the two-turn hard budget',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const original = goalManifest.buildGoalManifestFromInput;
    const exports = goalManifest as unknown as Record<string, unknown>;
    try {
      exports.buildGoalManifestFromInput = (input: Record<string, unknown>, options: Parameters<typeof original>[1]) => original({ ...input,
        budget: { max_total_turns: 2, max_retries_per_phase: 1 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 0.01 } }, options);
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', runId: 'session-native-deadline', freshEndPhase: 'spec', viaSessionStep: true,
        onSpec: () => { execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 25)']); },
      });
      const starts = probe.events.filter(event => event.type === 'agent_invoke_start');
      const reports = probe.events.filter(event => event.type === 'agent_invoke_end' && event.handoff_report);
      assert.equal(starts.length, 2, 'one expired window must produce exactly one new attempt inside the real two-turn budget');
      assert.equal(reports.length, starts.length);
      assert(reports.every(event => event.timed_out === true && event.kill_reason === 'agent_timeout' && Number(event.duration_ms) >= 10));
      assert(!probe.events.some(event => event.type === 'agent_process_settled'));
      assert(!probe.events.some(event => event.type === 'force_takeover' || event.type === 'owner_force_takeover'));
      const signed = probe.events.filter(event => event.type === 'phase_start' && event.handoff_request);
      assert.equal(signed.length, 2); assert.equal(Number(signed[1].owner_epoch), Number(signed[0].owner_epoch) + 1);
      assert.equal(sessionValidationOnlyEligibility(probe.events), null);
      assert.notEqual(probe.exitCode, 0, 'a timeout-only run must not claim completed delivery');
    } finally { exports.buildGoalManifestFromInput = original; fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production waiting report parks without a gate or PASS and a later call executes the same phase before progressing',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const runId = 'session-real-waiting';
    try {
      await assert.rejects(() => runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
        onSpec: () => { throw new Error('client paused with the original pending request'); },
      }), /client paused/);
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' }); const runDir = path.resolve(root, manifest.report_dir);
      const issued = readSessionExecution(runDir)!; assert(issued);
      const parked = await runGoalModeSessionStep({ projectRoot: root, frameworkRoot: path.resolve(__dirname, '../../..'), feature: 'bc-openCard', runId, adapter: 'codex', runMode: 'attended',
        requestPath: path.join(runDir, issued.reference.path), report: { phase: 'spec', status: 'waiting', details: 'client is waiting for a real external condition' } });
      assert.equal(parked.type, 'goal_session_result'); assert.equal((parked.result as { status: string }).status, 'waiting');
      const waiting = sessionEvents(runDir);
      assert.equal(sessionValidationOnlyEligibility(waiting), null);
      assert(!waiting.some(event => event.type === 'harness_start' || event.type === 'harness_end' || event.type === 'phase_verdict' && event.verdict === 'PASS'));
      assert(waiting.some(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting'));
      const resumed = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
      assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.events.filter(event => event.type === 'phase_halt' || event.type === 'run_end')));
      assert(resumed.invokedPhases.includes('spec'), 'a waiting author has not earned validation-only recovery');
      assert.equal(resumed.events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'spec').length, 2);
      assert.equal(resumed.harnessPhases.filter(phase => phase === 'spec').length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
}, {
  name: '1804 production next closes an expired unreported window without force and preserves its original signed request',
  async run() {
    const root = setupGoalRuntimeHost('codex').root; const original = goalManifest.buildGoalManifestFromInput; const runId = 'session-next-no-report';
    const exports = goalManifest as unknown as Record<string, unknown>;
    try {
      exports.buildGoalManifestFromInput = (input: Record<string, unknown>, options: Parameters<typeof original>[1]) => original({ ...input,
        budget: { max_total_turns: 2, max_retries_per_phase: 1 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 0.01 } }, options);
      await assert.rejects(() => runGoalRuntimeChain(root, { adapter: 'codex', runId, freshEndPhase: 'spec', viaSessionStep: true,
        onSpec: () => { execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 25)']); throw new Error('client exited without reporting'); },
      }), /client exited without reporting/);
      const manifest = loadGoalManifestFromRun(root, runId, { feature: 'bc-openCard' }); const runDir = path.resolve(root, manifest.report_dir);
      const originalRequest = readSessionExecution(runDir)!;
      const requestBytes = fs.readFileSync(path.join(runDir, originalRequest.reference.path));
      assert.equal(acceptedSessionReport(runDir, originalRequest), null);
      const probe = await runGoalRuntimeChain(root, { adapter: 'codex', resume: runId, viaSessionStep: true, skipLegacySeal: true });
      const accepted = acceptedSessionReport(runDir, originalRequest)!;
      assert(accepted); assert.equal(accepted.event.timed_out, true); assert.equal(accepted.report.status, 'failed');
      assert.match(accepted.report.details ?? '', /no executor report received/);
      assert.deepEqual(fs.readFileSync(path.join(runDir, originalRequest.reference.path)), requestBytes, 'timeout closure must not rewrite the signed original');
      const starts = probe.events.filter(event => event.type === 'agent_invoke_start'); assert.equal(starts.length, 2);
      const signed = probe.events.filter(event => event.type === 'phase_start' && event.handoff_request); assert.equal(signed.length, 2);
      assert.equal(Number(signed[1].owner_epoch), Number(signed[0].owner_epoch) + 1);
      assert(!probe.events.some(event => event.type === 'agent_process_settled'), JSON.stringify(probe.events.filter(event => event.type === 'agent_process_settled')));
    } finally { exports.buildGoalManifestFromInput = original; fs.rmSync(root, { recursive: true, force: true }); }
  },
}];

export function getCases() { return cases; }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, filter)) continue;
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export async function runAll() { return (await runSelectedCases()).results; }
