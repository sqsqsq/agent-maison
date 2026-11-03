import { unitCaseGroups } from '../utils/unit-case-selection';
import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { prepareGoalModeRun } from '../../scripts/goal-mode-entry';
import { readOriginalDeliveryActivity, readOriginalDeliveryRuns } from '../../scripts/utils/delivery-origin';
import { buildGoalManifestFromInput, buildInitialDesignGoalManifest,
  loadGoalRunManifestFromRun, type GoalManifest, type GoalRunManifest, type InitialDesignGoalManifest } from '../../scripts/utils/goal-manifest';
import { assertGoalRunAttachable, buildSupersedeAuditEvent, createGoalRun } from '../../scripts/utils/goal-run-creation';
import { casAcquireRunOwner, ensureRunControl } from '../../scripts/utils/goal-run-control';
import { readSupersededAncestorRuns, loadEventsJsonlStrict, partitionExecutionSessions, type GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, enumerateCanonicalChangeUnits } from '../../scripts/utils/change-unit-path';
import { validateChangeUnit } from '../../scripts/utils/change-unit-validator';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { fixture } from './blueprint-skill-projection.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';


const FRAMEWORK = path.resolve(__dirname, '../../..');
const BLUEPRINT = 'ledger-app-blueprint';
const MINUTE = 60_000;
const EPOCH = Date.now() + 24 * 60 * MINUTE;
const at = (minutes: number): string => new Date(EPOCH + minutes * MINUTE).toISOString();
const unattended = { write_mode: 'full-access' as const, approval_mode: 'never' as const, timeout_seconds: 900 };
const requirement = '按已批准账目设计完成本次交付，并保留原请求、授权、成果与真实截止。';
type Family = ReturnType<typeof fixture> & { original: InitialDesignGoalManifest };

function withFamily(run: (family: Family) => void, turns = 20,
  originalInputs: Partial<Pick<InitialDesignGoalManifest, 'adapter_model_pin' | 'visual_provider_pin' | 'fidelity' | 'requirement_source_files' | 'user_deadline_at'>> = {}): void {
  const project = fixture();
  try {
    const original = buildInitialDesignGoalManifest({ feature: BLUEPRINT, run_id: 'original-request', adapter: 'claude', requirement,
      initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: ['review'] },
      budget: { max_total_turns: turns, wall_clock_minutes: 120 }, unattended, ...originalInputs,
    }, { projectRoot: project.root });
    createGoalRun({ projectRoot: project.root, manifest: original, chain: [] });
    run({ ...project, original });
  } finally {
    clearFrameworkConfigCache();
    const directory = fs.realpathSync(project.root);
    assert(directory.startsWith(fs.realpathSync(os.tmpdir()) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const runDir = (family: Pick<Family, 'root'>, manifest: GoalRunManifest): string => path.join(family.root, manifest.report_dir);
const eventsFile = (family: Pick<Family, 'root'>, manifest: GoalRunManifest): string => path.join(runDir(family, manifest), 'events.jsonl');
const events = (family: Pick<Family, 'root'>, manifest: GoalRunManifest): GoalRunEvent[] => loadEventsJsonlStrict(eventsFile(family, manifest)).events;
function append(family: Pick<Family, 'root'>, manifest: GoalRunManifest, rows: Array<Record<string, unknown> | GoalRunEvent>): void {
  fs.appendFileSync(eventsFile(family, manifest), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}
const start = (minute: number): Record<string, unknown> => ({ type: 'run_start', ts: at(minute), session_started_at: at(minute), dry_run: false });
const end = (minute: number): GoalRunEvent => ({ type: 'run_end', ts: at(minute), status: 'HALTED', halt_reason: 'budget_turns' });
const invoke = (minute: number, invokeId = 'shared-invoke'): GoalRunEvent => ({ type: 'agent_invoke_start', ts: at(minute), phase: 'review', invoke_id: invokeId, command: 'phase_execute_request', effective_timeout_ms: 15 * MINUTE });
const settled = (minute: number, invokeId = 'shared-invoke'): GoalRunEvent => ({ type: 'agent_invoke_end', ts: at(minute), phase: 'review', invoke_id: invokeId });

function child(family: Family, unit = 'ledger-refresh', runId = 'child-run'): GoalManifest {
  const manifest = buildGoalManifestFromInput({ feature: deriveChangeUnitFeatureId(BLUEPRINT, unit), run_id: runId,
    adapter: 'claude', requirement, start_phase: 'review', end_phase: 'review', unattended,
    delivery_origin: { feature: family.original.feature, run_id: family.original.run_id },
  }, { projectRoot: family.root });
  createGoalRun({ projectRoot: family.root, manifest, chain: ['review'] });
  assertGoalRunAttachable(family.root, manifest);
  return manifest;
}

function activeOwner(family: Family, manifest: GoalRunManifest): void {
  const directory = runDir(family, manifest);
  ensureRunControl(directory, manifest.run_id);
  assert(casAcquireRunOwner(directory, manifest.run_id, 0, { kind: 'process', owner_id: 'budget-fixture-owner', pid: process.pid }).ok);
}

function pendingChild(family: Family): GoalManifest {
  const current = child(family);
  append(family, family.original, [start(0), invoke(0), settled(5), { type: 'heartbeat', ts: at(9) }]);
  append(family, current, [start(10), invoke(10), { type: 'phase_start', ts: at(10), phase: 'review', driver: 'session',
    invoke_id: 'shared-invoke', handoff_request: { path: 'phases/review/request.json', sha256: 'a' } }]);
  activeOwner(family, family.original);
  return current;
}

const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  ...[20, 60].map(turns => ({
    name: `f3b8e6a1 legacy quota input ${turns}: public child birth preserves real request pins and deadline without writing an allowance`,
    run() { withFamily(family => {
      prepareFeatureScopeCandidate({ projectRoot: family.root, frameworkRoot: FRAMEWORK, feature: family.feature,
        completionTarget: 'request', requestedResults: ['review'], requestedPhases: ['review'], requirement });
      const prepared = prepareGoalModeRun({ projectRoot: family.root, frameworkRoot: FRAMEWORK, feature: family.feature,
        runId: 'public-child', adapter: 'claude', requirement,
        deliveryOrigin: { feature: family.original.feature, run_id: family.original.run_id } });
      assert.equal(prepared.manifest.budget, undefined);
      assert.equal(prepared.manifest.unattended?.timeout_seconds, undefined);
      const raw = JSON.parse(fs.readFileSync(prepared.manifestPath, 'utf8')) as GoalManifest;
      for (const manifest of [prepared.manifest, raw]) {
        assert.equal(manifest.requirement, family.original.requirement);
        assert.deepEqual(manifest.requirement_source_files, family.original.requirement_source_files);
        assert.equal(manifest.adapter, family.original.adapter);
        assert.deepEqual(manifest.adapter_model_pin, family.original.adapter_model_pin);
        assert.deepEqual(manifest.visual_provider_pin, family.original.visual_provider_pin);
        assert.equal(manifest.fidelity, family.original.fidelity);
        assert.equal(manifest.user_deadline_at, family.original.user_deadline_at);
        assert.equal(manifest.budget, undefined);
        assert.equal(manifest.unattended?.timeout_seconds, undefined);
      }
      const childBytes = fs.readFileSync(prepared.manifestPath);
      const repeated = prepareGoalModeRun({ projectRoot: family.root, frameworkRoot: FRAMEWORK, feature: family.feature,
        runId: prepared.manifest.run_id, adapter: 'claude', requirement,
        deliveryOrigin: { feature: family.original.feature, run_id: family.original.run_id } });
      assert.equal(repeated.manifest.run_id, prepared.manifest.run_id);
      assert.deepEqual(fs.readFileSync(repeated.manifestPath), childBytes);
      const current = child(family, 'ledger-consumer', 'default-child');
      assert.equal(current.budget, undefined, 'a fresh child has no default quota');
      assert.equal(readOriginalDeliveryActivity(family.root, current, EPOCH + MINUTE)!.calls, 0);
    }, turns, { adapter_model_pin: { adapter: 'claude', value: 'claude-opus-5-5' },
      visual_provider_pin: { adapter: 'claude', model: 'claude-opus-5-5' }, fidelity: 'reference_only',
      requirement_source_files: ['requirements/ledger.md'], user_deadline_at: at(120) }); },
  })),
  {
    name: 'f3b8e6a1 family budget: equal cross-Feature run and invoke strings remain distinct and repeated reads never double-charge one invocation',
    run() { withFamily(family => {
      const first = child(family, 'ledger-refresh', family.original.run_id);
      const second = child(family, 'ledger-consumer', family.original.run_id);
      append(family, family.original, [start(0), invoke(0), settled(1), end(2)]);
      append(family, first, [start(3), invoke(3), settled(4), end(5)]);
      append(family, second, [start(6), invoke(6), settled(7), end(8)]);
      assert.equal(readOriginalDeliveryRuns(family.root, family.original).length, 3);
      const bytes = [family.original, first, second].map(manifest => fs.readFileSync(eventsFile(family, manifest)));
      for (const manifest of [family.original, first, second, family.original]) {
        const budget = readOriginalDeliveryActivity(family.root, manifest, EPOCH + 9 * MINUTE)!;
        assert.equal(budget.calls, 3);
        assert.equal(budget.active_ms, 6 * MINUTE);
      }
      [family.original, first, second].forEach((manifest, index) => assert.deepEqual(fs.readFileSync(eventsFile(family, manifest)), bytes[index]));
    }); },
  },
  {
    name: 'f3b8e6a1 family budget: child handoff bounds an overnight pending author and clips the live original interval at the real child start',
    run() { withFamily(family => {
      const current = pendingChild(family);
      const now = EPOCH + 840 * MINUTE;
      assert.equal(partitionExecutionSessions(events(family, current), { tailCapMs: now }).priorActiveMs, 15 * MINUTE);
      const budget = readOriginalDeliveryActivity(family.root, current, now)!;
      assert.equal(budget.calls, 2);
      assert.equal(budget.active_ms, 25 * MINUTE, '10m original work plus the granted 15m author window; overnight absence is not work');
      assert.equal(budget.firstAuthoritativeStartMs, EPOCH);
    }); },
  },
  {
    name: 'f3b8e6a1 family budget: a late report belongs to its old child window and only the returning CLI gate adds new active time',
    run() { withFamily(family => {
      const current = pendingChild(family);
      append(family, current, [{ ...settled(840), timed_out: true,
        handoff_report: { path: 'phases/review/report.json', sha256: 'report', request_sha256: 'a' } },
      start(840), { type: 'harness_start', ts: at(840), invoke_id: 'returning-gate' },
      { type: 'harness_end', ts: at(842), invoke_id: 'returning-gate' }, end(842)]);
      const now = EPOCH + 842 * MINUTE;
      assert.equal(partitionExecutionSessions(events(family, current), { tailCapMs: now }).priorActiveMs, 17 * MINUTE);
      const budget = readOriginalDeliveryActivity(family.root, current, now)!;
      assert.equal(budget.calls, 2);
      assert.equal(budget.active_ms, 27 * MINUTE, '10m original, 15m granted author, 2m actual returning gate');
    }); },
  },
  {
    name: 'f3b8e6a1 family budget: returning original machine work remains charged while overlapping child cleanup is unioned once',
    run() { withFamily(family => {
      const current = child(family);
      append(family, family.original, [start(0), invoke(0), settled(5), { type: 'heartbeat', ts: at(9) },
        start(12), { type: 'harness_start', ts: at(12), invoke_id: 'original-finalizer' },
        { type: 'harness_end', ts: at(17), invoke_id: 'original-finalizer' }, end(17)]);
      append(family, current, [start(10), invoke(10), settled(11), end(14)]);
      const budget = readOriginalDeliveryActivity(family.root, current, EPOCH + 17 * MINUTE)!;
      assert.equal(budget.calls, 2, 'machine-only finalization is not another model call');
      assert.equal(budget.active_ms, 17 * MINUTE, 'continuous [0m,17m] is charged once, including original work after the child report');
    }); },
  },
  {
    name: 'f3b8e6a1 family budget: a run without delivery origin retains the existing normal supersede lineage and duplicate seed handling',
    run() { withFamily(family => {
      const normal = (runId: string) => {
        const manifest = buildGoalManifestFromInput({ feature: 'legacy-budget', run_id: runId, adapter: 'claude', requirement,
          start_phase: 'review', end_phase: 'review', unattended }, { projectRoot: family.root });
        createGoalRun({ projectRoot: family.root, manifest, chain: ['review'], forceFresh: true });
        return manifest;
      };
      const first = normal('normal-a'), second = normal('normal-b');
      append(family, first, [start(0), invoke(0), settled(1), end(1)]);
      append(family, second, [start(2), buildSupersedeAuditEvent({ targetRunId: first.run_id, supersedingRunId: second.run_id }), invoke(2), settled(4), end(4)]);
      const loaded = loadGoalRunManifestFromRun(family.root, second.run_id, { feature: second.feature });
      assert.equal(readOriginalDeliveryActivity(family.root, loaded, EPOCH + 5 * MINUTE), null);
      const ancestors = readSupersededAncestorRuns({ projectRoot: family.root, featuresDir: 'doc/features', feature: second.feature,
        seedTargets: [first.run_id, first.run_id], currentEvents: events(family, second) });
      const activity = partitionExecutionSessions([...ancestors.flatMap(run => run.events), ...events(family, second)], { tailCapMs: EPOCH + 5 * MINUTE });
      assert.equal(ancestors.length, 1);
      assert.equal(activity.totalTurns, 2);
      assert.equal(activity.priorActiveMs, 3 * MINUTE);
    }); },
  },
  ...['other-blueprint', 'standalone'].map(target => ({
    name: `f3b8e6a1 foreign origin: ${target} cannot borrow this original request budget or create a public child`,
    run() { withFamily(family => {
      const current = child(family);
      append(family, family.original, [start(0), invoke(0), settled(1), end(1)]);
      append(family, current, [start(2), invoke(2), settled(3), end(3)]);
      let feature = 'standalone-budget';
      if (target === 'other-blueprint') {
        const foreignBlueprint = 'other-ledger-blueprint';
        feature = deriveChangeUnitFeatureId(foreignBlueprint, 'ledger-refresh');
        const rewrite = (file: string) => fs.readFileSync(file, 'utf8').split(BLUEPRINT).join(foreignBlueprint).split(family.feature).join(feature);
        const blueprintFile = path.join(family.root, 'doc/features', foreignBlueprint, 'blueprint/component-blueprint.yaml');
        fs.mkdirSync(path.dirname(blueprintFile), { recursive: true });
        fs.writeFileSync(blueprintFile, rewrite(family.blueprintFile));
        const unit = YAML.parse(rewrite(family.cuFile));
        const blueprintSha = 'sha256:' + createHash('sha256').update(fs.readFileSync(blueprintFile)).digest('hex');
        const bind = (value: unknown): void => {
          if (!value || typeof value !== 'object') return;
          const record = value as Record<string, unknown>;
          if (record.artifact === 'component-blueprint@1') record.artifact_sha256 = blueprintSha;
          for (const nested of Object.values(record)) bind(nested);
        };
        bind(unit);
        const unitFile = featureFilePath(family.root, feature, 'change-unit.yaml');
        fs.mkdirSync(path.dirname(unitFile), { recursive: true });
        fs.writeFileSync(unitFile, YAML.stringify(unit));
        const loaded = loadCanonicalChangeUnit(family.root, foreignBlueprint, 'ledger-refresh');
        const blockers = validateChangeUnit(loaded.changeUnit, { projectRoot: family.root, canonicalPath: loaded.canonicalPath }).filter(issue => issue.severity === 'BLOCKER');
        assert.deepEqual(blockers, [], 'the foreign CU must be valid, so rejection cannot be attributed to missing or broken canonical content');
      }
      const impostor = buildGoalManifestFromInput({ feature, run_id: 'misbound-existing-run', adapter: 'claude', requirement,
        start_phase: 'review', end_phase: 'review', unattended,
        delivery_origin: { feature: family.original.feature, run_id: family.original.run_id },
      }, { projectRoot: family.root });
      createGoalRun({ projectRoot: family.root, manifest: impostor, chain: ['review'] });
      assertGoalRunAttachable(family.root, impostor);
      append(family, impostor, [start(4), invoke(4), settled(5), end(5)]);
      const before = [family.original, current, impostor].map(manifest => fs.readFileSync(eventsFile(family, manifest)));
      const expected = target === 'other-blueprint' ? /outside the original blueprint workspace/ : /Feature id 非 CU/;
      assert.throws(() => readOriginalDeliveryActivity(family.root, impostor, EPOCH + 6 * MINUTE), expected,
        'an origin-bound call must be rejected instead of receiving an allowance that silently omits its actual invocation');
      assert.throws(() => prepareGoalModeRun({ projectRoot: family.root, frameworkRoot: FRAMEWORK, feature,
        runId: 'rejected-public-child', adapter: 'claude', requirement,
        deliveryOrigin: { feature: family.original.feature, run_id: family.original.run_id } }), expected);
      assert(!fs.existsSync(featureFilePath(family.root, feature, 'goal-runs/rejected-public-child')));
      [family.original, current, impostor].forEach((manifest, index) => assert.deepEqual(fs.readFileSync(eventsFile(family, manifest)), before[index]));
      assert.equal(readOriginalDeliveryActivity(family.root, current, EPOCH + 6 * MINUTE)!.calls, 2);
    }); },
  })),
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

export const listCaseGroups = () => unitCaseGroups(cases.map(c => c.name));
