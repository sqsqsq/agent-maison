import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as YAML from 'yaml';
import { spawnSync } from 'child_process';
import { clearFrameworkConfigCache } from '../../config';
import * as supervisor from '../../scripts/goal-supervise';
import { superviseRun } from '../../scripts/utils/goal-supervisor';
import { buildGoalManifestFromInput, buildInitialDesignGoalManifest, type GoalManifest, type GoalRunManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { casAcquireRunOwner, ensureRunControl, releaseRunOwner } from '../../scripts/utils/goal-run-control';
import { deriveChangeUnitFeatureId, asChangeUnitArtifact, createChangeUnitRef, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { resolveOriginalDeliveryExecution } from '../../scripts/utils/delivery-origin';
import { runGoalModeSessionStep as runGoalModeSessionStepUnchecked } from '../../scripts/goal-mode-entry';
import * as phaseRuntime from '../../scripts/goal-phase-runtime';
import { readInitialDesignDelivery } from '../../scripts/utils/initial-design-delivery';
import { enumerateCanonicalChangeUnits } from '../../scripts/utils/change-unit-path';
import { reviseChangeUnitContent } from '../../scripts/utils/change-unit-design-preparation';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { withFreshCuHost } from './lifecycle-evolution.unit.test';
import { CU_REQUIREMENT, CU_SOURCE } from './real-chain.unit.test';
import { livenessBeaconPath, writeLivenessBeacon } from '../../scripts/utils/liveness-beacon';
import { fixture } from './blueprint-skill-projection.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import type { ProcessProbe } from '../../scripts/utils/device-session';
import { withRuntimeTest, type RuntimeTestControl } from '../utils/runtime-test-control';
const runGoalModeSessionStep = (options: Parameters<typeof runGoalModeSessionStepUnchecked>[0], testControl: RuntimeTestControl = {}) =>
  withRuntimeTest({ root: options.projectRoot, ...testControl }, () => runGoalModeSessionStepUnchecked(options));


const BLUEPRINT = 'ledger-app-blueprint';
const FRAMEWORK = path.resolve(__dirname, '../../..');
const DEAD_PID = 987654321;
const processIdentity = (pid: number) => ({ pid, startedAtMs: 123456, executable: process.execPath });
const processProbe = (live: number[]): ProcessProbe => ({ identify: pid => live.includes(pid) ? processIdentity(pid) : null,
  killTree: () => { throw new Error('supervisor liveness probes must not kill a process'); } });
type Family = ReturnType<typeof fixture> & { original: ReturnType<typeof buildInitialDesignGoalManifest> };
const directory = (family: Family, manifest: GoalRunManifest) => path.join(family.root, manifest.report_dir);
const eventFile = (family: Family, manifest: GoalRunManifest) => path.join(directory(family, manifest), 'events.jsonl');
const events = (family: Family, manifest: GoalRunManifest): Record<string, unknown>[] => fs.readFileSync(eventFile(family, manifest), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const emit = (family: Family, manifest: GoalRunManifest, value: Record<string, unknown>) => fs.appendFileSync(eventFile(family, manifest), JSON.stringify({ ts: new Date().toISOString(), ...value }) + '\n');

async function withFamily(run: (family: Family) => Promise<void>): Promise<void> {
  const project = fixture();
  try {
    const original = buildInitialDesignGoalManifest({ feature: BLUEPRINT, run_id: 'supervision-root', adapter: 'claude', requirement: '完成已授权部件交付',
      initial_design: { completion_target: 'feature', requested_results: ['完整部件交付'], requested_phases: ['plan'] },
      budget: { max_total_turns: 20, wall_clock_minutes: 120 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 },
    }, { projectRoot: project.root });
    createGoalRun({ projectRoot: project.root, manifest: original, chain: [] });
    await run({ ...project, original });
  } finally {
    clearFrameworkConfigCache();
    const root = fs.realpathSync(project.root);
    assert(root.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function acquire(family: Family, manifest: GoalRunManifest, kind: 'process' | 'session' = 'process', pid = process.pid) {
  const runDir = directory(family, manifest);
  const current = ensureRunControl(runDir, manifest.run_id);
  const result = casAcquireRunOwner(runDir, manifest.run_id, current.current_epoch, { kind, owner_id: `owner-${manifest.run_id}`, pid, lease_ms: 60_000 });
  assert(result.ok);
  return result.token;
}

function child(family: Family, pid = process.pid): GoalManifest {
  const rootToken = acquire(family, family.original);
  emit(family, family.original, { type: 'run_start' });
  releaseRunOwner(directory(family, family.original), rootToken);
  const manifest = buildGoalManifestFromInput({ feature: deriveChangeUnitFeatureId(BLUEPRINT, 'ledger-refresh'), run_id: 'supervision-child',
    adapter: 'claude', requirement: family.original.requirement, start_phase: 'plan', end_phase: 'plan', budget: family.original.budget,
    delivery_origin: { feature: family.original.feature, run_id: family.original.run_id }, unattended: family.original.unattended,
  }, { projectRoot: family.root });
  createGoalRun({ projectRoot: family.root, manifest, chain: ['plan'] });
  acquire(family, manifest, 'process', pid);
  emit(family, manifest, { type: 'run_start' });
  return manifest;
}

function liveBeacon(family: Family, manifest: GoalRunManifest): void {
  assert(writeLivenessBeacon({ projectRoot: family.root, reportDir: manifest.report_dir, runId: manifest.run_id,
    probe: processProbe([process.pid]), now: () => new Date('2020-01-01T00:00:00Z') }));
}

function deadBeacon(family: Family, manifest: GoalRunManifest): void {
  fs.writeFileSync(livenessBeaconPath(family.root, manifest.report_dir), JSON.stringify({ schema_version: '1.0', run_id: manifest.run_id,
    proc: { ...processIdentity(DEAD_PID), profile: manifest.run_id }, refreshed_at: '2020-01-01T00:00:00Z' }) + '\n');
}

async function superviseOnce(family: Family, target: GoalRunManifest, live: number[]) {
  const previousArgv = process.argv;
  const spawned: string[][] = [], output: string[] = [];
  const savedLog = console.log;
  try {
    supervisor.__testing_setProcessProbe(processProbe(live));
    supervisor.__testing_setPidExists(() => false);
    supervisor.__testing_setSpawnImpl((_file, args) => { spawned.push([...args]); return { pid: 4242, unref() {} }; });
    process.argv = ['node', 'goal-supervise.ts', '--feature', target.feature, '--run-id', target.run_id, '--project-root', family.root];
    console.log = (...values: unknown[]) => output.push(values.join(' '));
    const code = await supervisor.__testing_main();
    return { code, spawned, output: output.join('\n') };
  } finally {
    process.argv = previousArgv;
    console.log = savedLog;
    supervisor.__testing_setProcessProbe(null);
    supervisor.__testing_setPidExists(null);
    supervisor.__testing_setSpawnImpl(null);
  }
}

const cases: Array<{ name: string; run(): Promise<void> }> = [
  {
    name: 'f3b8e6a1 public root readiness: an admitted blueprint with only an execution-blocked CU cannot birth construction',
    run: () => withFreshCuHost(async host => {
      for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT)) {
        if (unit.changeUnit.change_unit_id === 'ledger-refresh') continue;
        const target = path.dirname(unit.canonicalPath), rel = path.relative(host.root, target);
        assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
        fs.rmSync(target, { recursive: true, force: true });
      }
      const current = loadCanonicalChangeUnit(host.root, BLUEPRINT, 'ledger-refresh');
      const candidate = structuredClone(asChangeUnitArtifact(current.changeUnit));
      const template = asChangeUnitArtifact(YAML.parse(fs.readFileSync(path.join(__dirname, '../fixtures/component-blueprint/valid/doc/features', BLUEPRINT, 'ledger-summary/change-unit.yaml'), 'utf8')));
      candidate.blockers = template.blockers;
      const revised = reviseChangeUnitContent(host.root, BLUEPRINT, [{ expectedRef: createChangeUnitRef(current),
        candidate: { providerId: candidate.provenance.extraction_method, artifact: candidate } }]);
      assert.equal(revised.revised.length, 1);
      try {
        prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: deriveChangeUnitFeatureId(BLUEPRINT, 'ledger-refresh'),
          completionTarget: 'feature', requestedResults: [CU_REQUIREMENT], requestedPhases: ['plan', 'coding', 'review', 'ut'], requirement: CU_REQUIREMENT, overwrite: true,
          impact: { userVisibleBehaviorChange: false, reason: 'Existing nonvisual ledger domain fixture', basisPaths: [CU_SOURCE] } });
      } catch (error) {
        assert.match(String(error), /block|release|unresolved|许可|阻塞|未就绪/, 'an unrelated fixture failure is not a readiness protection');
      }
      const original = buildInitialDesignGoalManifest({ feature: BLUEPRINT, run_id: 'unready-root', adapter: 'codex', requirement: CU_REQUIREMENT,
        initial_design: { completion_target: 'feature', requested_results: [CU_REQUIREMENT], requested_phases: ['plan', 'coding', 'review', 'ut'] },
        budget: { max_total_turns: 20, wall_clock_minutes: 120 }, unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 } }, { projectRoot: host.root });
      const created = createGoalRun({ projectRoot: host.root, manifest: original, chain: [] });
      const observed = readInitialDesignDelivery({ projectRoot: host.root, manifest: original });
      assert.equal(observed.kind, 'construction', observed.issues.join('\n'));
      assert.equal(observed.progression!.readySet.ready.length, 0);
      assert.equal(observed.progression!.readySet.units.length, 1);
      assert(observed.progression!.readySet.units[0].blockers.length > 0);
      let externalCalls = 0;
      phaseRuntime.__testing_setInvokeAgent(async () => { externalCalls++; throw new Error('No headless construction actor may run for an unready CU'); });
      phaseRuntime.__testing_setCanaryProbeInvoke(async () => { externalCalls++; throw new Error('No canary actor is needed for this control-only readiness test'); });
      try {
        const result = await runGoalModeSessionStep({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: BLUEPRINT, runId: original.run_id,
          adapter: 'codex', runMode: 'attended', authorization: { mode: 'goal_mode', autonomyAuthorized: true } });
        assert.equal(externalCalls, 0);
        if (result.type === 'phase_execute_request') {
          assert.equal(result.feature, BLUEPRINT);
          assert(/^(?:initial-design|design-repair)-/.test(String(result.phase)), 'only the original design responsibility may receive a request before CU readiness');
        }
        for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT)) {
          const runs = path.join(path.dirname(unit.canonicalPath), 'goal-runs');
          assert(!fs.existsSync(runs) || fs.readdirSync(runs).length === 0, 'an unready canonical CU must not receive a normal construction run');
        }
        const rootEvents = fs.readFileSync(created.eventsPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
        assert(!rootEvents.some(row => row.type === 'run_end' && row.status === 'COMPLETED'));
      } finally {
        phaseRuntime.__testing_setInvokeAgent(null);
        phaseRuntime.__testing_setCanaryProbeInvoke(null);
      }
    }),
  },
  {
    name: 'f3b8e6a1 public readers: an old root halt cannot hide current child work in status or monitor',
    run: () => withFamily(async family => {
      fs.cpSync(path.join(FRAMEWORK, 'workflows'), path.join(family.root, 'workflows'), { recursive: true });
      const current = child(family);
      emit(family, current, { type: 'agent_invoke_start', phase: 'plan', invoke_id: 'current-child-author', effective_timeout_ms: 900_000 });
      emit(family, family.original, { type: 'run_end', status: 'HALTED', halt_reason: 'execution_scope_unresolved', error: 'Previous original controller stopped; the bound child still owns its active work.' });
      const rootBefore = fs.readFileSync(eventFile(family, family.original)), childBefore = fs.readFileSync(eventFile(family, current));
      const read = (script: string, extra: string[] = []) => {
        const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', path.join(FRAMEWORK, 'harness/scripts', script + '.ts'),
          '--feature', BLUEPRINT, '--run-id', family.original.run_id, '--project-root', family.root, '--json', ...extra],
        { cwd: path.join(FRAMEWORK, 'harness'), encoding: 'utf8', timeout: 30_000, windowsHide: true,
          env: { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(family.root, '.trust') } });
        assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}\n${result.error ?? ''}`);
        return JSON.parse(result.stdout.trim());
      };
      const status = read('goal-status');
      const monitor = read('goal-monitor', ['--max-seconds', '0']);
      assert(status.current, 'public status must expose the current bound child despite an old original terminal');
      assert.equal(status.current.feature, current.feature); assert.equal(status.current.run_id, current.run_id);
      assert.equal(status.current.phase, 'plan'); assert.equal(status.complete, false);
      assert.notEqual(status.status, 'COMPLETED'); assert.equal(status.budget.total_turns, 1);
      assert.equal(monitor.phase, 'plan', 'monitor must read the current child instead of the old original terminal phase');
      assert(monitor.markdown.includes(current.feature) && monitor.markdown.includes(current.run_id));
      assert.deepEqual(fs.readFileSync(eventFile(family, family.original)), rootBefore);
      assert.deepEqual(fs.readFileSync(eventFile(family, current)), childBefore);
    }),
  },
  {
    name: 'f3b8e6a1 supervision: a real live initial author does not restart because an old diagnostic refresh timestamp elapsed',
    run: () => withFamily(async family => {
      acquire(family, family.original);
      emit(family, family.original, { type: 'run_start' });
      emit(family, family.original, { type: 'agent_invoke_start', phase: 'initial-design-author', invoke_id: 'initial-author' });
      liveBeacon(family, family.original);
      const before = fs.readFileSync(eventFile(family, family.original));
      const result = await superviseOnce(family, family.original, [process.pid]);
      assert.equal(result.code, 0);
      assert.equal(result.spawned.length, 0);
      assert(result.output.includes('存活'));
      assert.deepEqual(fs.readFileSync(eventFile(family, family.original)), before);
    }),
  },
  {
    name: 'f3b8e6a1 supervision: live child signals replace an absent root beacon while restart accounting remains on the original request',
    run: () => withFamily(async family => {
      const current = child(family);
      emit(family, current, { type: 'agent_invoke_start', phase: 'plan', invoke_id: 'child-author' });
      emit(family, family.original, { type: 'supervisor_restart', restart_seq: 1 });
      liveBeacon(family, current);
      assert.equal(resolveOriginalDeliveryExecution(family.root, family.original).manifest.run_id, current.run_id);
      const before = fs.readFileSync(eventFile(family, family.original));
      const result = await superviseOnce(family, family.original, [process.pid]);
      assert.equal(result.spawned.length, 0);
      assert(result.output.includes('存活'));
      assert.deepEqual(fs.readFileSync(eventFile(family, family.original)), before);
      const stale = superviseRun({ projectRoot: family.root, feature: current.feature, reportDir: current.report_dir, runId: current.run_id,
        events: events(family, current), restartEvents: events(family, family.original), probe: processProbe([]) });
      assert(stale.action === 'resume' && stale.restart_seq === 2, 'switching to a child must not reset the existing restart limit');
    }),
  },
  {
    name: 'f3b8e6a1 supervision: a genuinely stale child is recovered through the original request even when the old root beacon still looks alive',
    run: () => withFamily(async family => {
      const current = child(family, DEAD_PID);
      liveBeacon(family, family.original);
      deadBeacon(family, current);
      const result = await superviseOnce(family, current, [process.pid]);
      assert.equal(result.spawned.length, 1);
      const argv = result.spawned[0];
      assert.equal(argv[argv.indexOf('--feature') + 1], family.original.feature);
      assert.equal(argv[argv.indexOf('--resume') + 1], family.original.run_id);
      assert(!argv.includes(current.run_id));
      assert.equal(events(family, family.original).filter(row => row.type === 'supervisor_restart').length, 1);
      assert(!events(family, current).some(row => row.type === 'supervisor_restart'));
    }),
  },
  {
    name: 'f3b8e6a1 supervision: completed child execution returns to the root machine window and cannot seal pending P3 work',
    run: () => withFamily(async family => {
      const current = child(family);
      emit(family, current, { type: 'run_end', status: 'CHAIN_SLICE_COMPLETED' });
      liveBeacon(family, current);
      acquire(family, family.original, 'process', DEAD_PID);
      emit(family, family.original, { type: 'run_start', substep: 'component-closure' });
      deadBeacon(family, family.original);
      assert.equal(resolveOriginalDeliveryExecution(family.root, family.original).manifest.run_id, family.original.run_id);
      const result = await superviseOnce(family, family.original, [process.pid]);
      assert.equal(result.spawned.length, 1, 'the unfinished root must recover instead of reading the sealed child disposition');
      assert.equal(result.spawned[0][result.spawned[0].indexOf('--resume') + 1], family.original.run_id);
      assert(!events(family, family.original).some(row => row.type === 'run_end' && row.status === 'COMPLETED'));
    }),
  },
  {
    name: 'f3b8e6a1 supervision: session ownership without a process signal remains the existing explicit bridge boundary, never synthetic health',
    run: () => withFamily(async family => {
      acquire(family, family.original, 'session');
      emit(family, family.original, { type: 'run_start' });
      const result = await superviseOnce(family, family.original, []);
      assert.equal(result.spawned.length, 0);
      assert(result.output.includes('session owner') && !result.output.includes('进程仍存活'));
    }),
  },
  {
    name: 'f3b8e6a1 supervision: a normal run without delivery origin keeps its original recovery target',
    run: () => withFamily(async family => {
      const normal = buildGoalManifestFromInput({ feature: 'normal-supervisor', run_id: 'normal-run', adapter: 'claude', start_phase: 'plan', end_phase: 'plan',
        unattended: family.original.unattended }, { projectRoot: family.root });
      createGoalRun({ projectRoot: family.root, manifest: normal, chain: ['plan'] });
      acquire(family, normal, 'process', DEAD_PID);
      emit(family, normal, { type: 'run_start' });
      deadBeacon(family, normal);
      const result = await superviseOnce(family, normal, []);
      assert.equal(result.spawned.length, 1);
      assert.equal(result.spawned[0][result.spawned[0].indexOf('--feature') + 1], normal.feature);
      assert.equal(result.spawned[0][result.spawned[0].indexOf('--resume') + 1], normal.run_id);
    }),
  },
];

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
