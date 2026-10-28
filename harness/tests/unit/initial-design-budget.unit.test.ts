import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { prepareGoalModeRun, runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { readOriginalDeliveryBudget, readOriginalDeliveryRuns } from '../../scripts/utils/delivery-origin';
import { buildGoalManifestFromInput, buildInitialDesignGoalManifest, computeManifestIdentityFields,
  loadGoalRunManifestFromRun, type GoalManifest, type GoalRunManifest, type InitialDesignGoalManifest } from '../../scripts/utils/goal-manifest';
import { assertGoalRunAttachable, buildSupersedeAuditEvent, createGoalRun, decideRunContinuation } from '../../scripts/utils/goal-run-creation';
import { casAcquireRunOwner, ensureRunControl } from '../../scripts/utils/goal-run-control';
import { foldBudgetLineage, loadEventsJsonlStrict, partitionExecutionSessions, resolveResumedBudget, type GoalRunEvent } from '../../scripts/utils/goal-runner-phase';
import { deriveChangeUnitFeatureId, loadCanonicalChangeUnit, enumerateCanonicalChangeUnits } from '../../scripts/utils/change-unit-path';
import { validateChangeUnit } from '../../scripts/utils/change-unit-validator';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { fixture } from './blueprint-skill-projection.unit.test';
import { withFreshCuHost } from './lifecycle-evolution.unit.test';
import { withRunDisposition } from '../../scripts/utils/adjudication';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK = path.resolve(__dirname, '../../..');
const BLUEPRINT = 'ledger-app-blueprint';
const MINUTE = 60_000;
const EPOCH = Date.now() + 24 * 60 * MINUTE;
const at = (minutes: number): string => new Date(EPOCH + minutes * MINUTE).toISOString();
const unattended = { write_mode: 'full-access' as const, approval_mode: 'never' as const, timeout_seconds: 900 };
const requirement = '按已批准账目设计完成本次交付，并保留原请求总预算。';
type Family = ReturnType<typeof fixture> & { original: InitialDesignGoalManifest };

function withFamily(run: (family: Family) => void, turns = 20,
  originalInputs: Partial<Pick<InitialDesignGoalManifest, 'adapter_model_pin' | 'visual_provider_pin' | 'fidelity' | 'requirement_source_files'>> = {}): void {
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

function child(family: Family, unit = 'ledger-refresh', runId = 'child-run', budget?: GoalManifest['budget']): GoalManifest {
  const manifest = buildGoalManifestFromInput({ feature: deriveChangeUnitFeatureId(BLUEPRINT, unit), run_id: runId,
    adapter: 'claude', requirement, start_phase: 'review', end_phase: 'review', unattended,
    delivery_origin: { feature: family.original.feature, run_id: family.original.run_id }, ...(budget ? { budget } : {}),
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
    name: `f3b8e6a1 family budget ${turns}: public child birth and effective policy retain the original allowance instead of fresh defaults`,
    run() { withFamily(family => {
      prepareFeatureScopeCandidate({ projectRoot: family.root, frameworkRoot: FRAMEWORK, feature: family.feature,
        completionTarget: 'request', requestedResults: ['review'], requestedPhases: ['review'], requirement });
      const prepared = prepareGoalModeRun({ projectRoot: family.root, frameworkRoot: FRAMEWORK, feature: family.feature,
        runId: 'public-child', adapter: 'claude', requirement,
        deliveryOrigin: { feature: family.original.feature, run_id: family.original.run_id } });
      assert.equal(prepared.manifest.budget.max_total_turns, turns);
      assert.equal(prepared.manifest.budget.wall_clock_minutes, 120);
      assert.equal(prepared.manifest.unattended?.timeout_seconds, 900);
      const raw = JSON.parse(fs.readFileSync(prepared.manifestPath, 'utf8')) as GoalManifest;
      for (const manifest of [prepared.manifest, raw]) {
        assert.equal(manifest.requirement, family.original.requirement);
        assert.deepEqual(manifest.requirement_source_files, family.original.requirement_source_files);
        assert.equal(manifest.adapter, family.original.adapter);
        assert.deepEqual(manifest.adapter_model_pin, family.original.adapter_model_pin);
        assert.deepEqual(manifest.visual_provider_pin, family.original.visual_provider_pin);
        assert.equal(manifest.fidelity, family.original.fidelity);
        assert.equal(manifest.unattended?.timeout_seconds, 900);
      }
      const childBytes = fs.readFileSync(prepared.manifestPath);
      const repeated = prepareGoalModeRun({ projectRoot: family.root, frameworkRoot: FRAMEWORK, feature: family.feature,
        runId: prepared.manifest.run_id, adapter: 'claude', requirement,
        deliveryOrigin: { feature: family.original.feature, run_id: family.original.run_id } });
      assert.equal(repeated.manifest.run_id, prepared.manifest.run_id);
      assert.deepEqual(fs.readFileSync(repeated.manifestPath), childBytes);
      const current = child(family, 'ledger-consumer', 'default-child');
      assert.equal(current.budget.max_total_turns, 30, 'fixture must expose the actual fresh default');
      assert.equal(readOriginalDeliveryBudget(family.root, current, EPOCH + MINUTE)!.budget.max_total_turns, turns);
    }, turns, { adapter_model_pin: { adapter: 'claude', value: 'claude-opus-5-5' },
      visual_provider_pin: { adapter: 'claude', model: 'claude-opus-5-5' }, fidelity: 'reference_only',
      requirement_source_files: ['requirements/ledger.md'] }); },
  })),
  {
    name: 'f3b8e6a1 family budget: an authorized original override reaches the current child without changing its birth snapshot or resetting usage',
    run() { withFamily(family => {
      const current = child(family);
      append(family, family.original, [start(0), invoke(0), settled(1), end(1)]);
      append(family, current, [start(2), invoke(2), settled(3), end(3)]);
      const childBytes = fs.readFileSync(path.join(runDir(family, current), 'manifest.json'));
      const updated = { ...family.original, budget: { ...family.original.budget, max_total_turns: 42 } };
      fs.writeFileSync(path.join(runDir(family, family.original), 'manifest.json'), JSON.stringify(updated, null, 2) + '\n');
      append(family, family.original, [{ type: 'manifest_identity_rebase', ts: at(4), to_fields: computeManifestIdentityFields(updated),
        changed_fields: ['budget'], authorized_by: '--override-manifest' }]);
      const budget = readOriginalDeliveryBudget(family.root, current, EPOCH + 5 * MINUTE)!;
      assert.equal(budget.budget.max_total_turns, 42);
      assert.equal(budget.totalTurns, 2);
      assert.deepEqual(fs.readFileSync(path.join(runDir(family, current), 'manifest.json')), childBytes);
      const unauthorized = { ...updated, budget: { ...updated.budget, max_total_turns: 43 } };
      fs.writeFileSync(path.join(runDir(family, family.original), 'manifest.json'), JSON.stringify(unauthorized, null, 2) + '\n');
      assert.throws(() => readOriginalDeliveryBudget(family.root, current, EPOCH + 5 * MINUTE), /budget changed without/);
    }); },
  },
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
        const budget = readOriginalDeliveryBudget(family.root, manifest, EPOCH + 9 * MINUTE)!;
        assert.equal(budget.totalTurns, 3);
        assert.equal(budget.priorActiveMs, 6 * MINUTE);
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
      const budget = readOriginalDeliveryBudget(family.root, current, now)!;
      assert.equal(budget.totalTurns, 2);
      assert.equal(budget.priorActiveMs, 25 * MINUTE, '10m original work plus the granted 15m author window; overnight absence is not work');
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
      const budget = readOriginalDeliveryBudget(family.root, current, now)!;
      assert.equal(budget.totalTurns, 2);
      assert.equal(budget.priorActiveMs, 27 * MINUTE, '10m original, 15m granted author, 2m actual returning gate');
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
      const budget = readOriginalDeliveryBudget(family.root, current, EPOCH + 17 * MINUTE)!;
      assert.equal(budget.totalTurns, 2, 'machine-only finalization is not another model call');
      assert.equal(budget.priorActiveMs, 17 * MINUTE, 'continuous [0m,17m] is charged once, including original work after the child report');
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
      assert.equal(readOriginalDeliveryBudget(family.root, loaded, EPOCH + 5 * MINUTE), null);
      const folded = foldBudgetLineage({ projectRoot: family.root, featuresDir: 'doc/features', feature: second.feature,
        seedTargets: [first.run_id, first.run_id], currentEvents: events(family, second) });
      const budget = resolveResumedBudget(folded.budgetFoldEvents, { nextSessionStartMs: EPOCH + 5 * MINUTE });
      assert.equal(folded.ancestorRuns.length, 1);
      assert.equal(budget.totalTurns, 2);
      assert.equal(budget.priorActiveMs, 3 * MINUTE);
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
      assert.throws(() => readOriginalDeliveryBudget(family.root, impostor, EPOCH + 6 * MINUTE), expected,
        'an origin-bound call must be rejected instead of receiving an allowance that silently omits its actual invocation');
      assert.throws(() => prepareGoalModeRun({ projectRoot: family.root, frameworkRoot: FRAMEWORK, feature,
        runId: 'rejected-public-child', adapter: 'claude', requirement,
        deliveryOrigin: { feature: family.original.feature, run_id: family.original.run_id } }), expected);
      assert(!fs.existsSync(featureFilePath(family.root, feature, 'goal-runs/rejected-public-child')));
      [family.original, current, impostor].forEach((manifest, index) => assert.deepEqual(fs.readFileSync(eventsFile(family, manifest)), before[index]));
      assert.equal(readOriginalDeliveryBudget(family.root, current, EPOCH + 6 * MINUTE)!.totalTurns, 2);
    }); },
  })),
  {
    name: 'f3b8e6a1 public budget control: a real root override resumes its exhausted original child once and the exhausted new limit cannot revive it again',
    async run() { await withFreshCuHost(async host => {
      const workspace = path.resolve(featureFilePath(host.root, BLUEPRINT, ''));
      for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT)) {
        if (unit.changeUnit.change_unit_id === 'ledger-refresh') continue;
        const directory = path.resolve(path.dirname(unit.canonicalPath));
        assert(directory.startsWith(workspace + path.sep));
        fs.rmSync(directory, { recursive: true, force: true });
      }
      const original = buildInitialDesignGoalManifest({ feature: BLUEPRINT, run_id: 'public-policy-root', adapter: 'codex', requirement,
        initial_design: { completion_target: 'feature', requested_results: [requirement], requested_phases: ['plan', 'coding', 'review', 'ut'] },
        budget: { max_total_turns: 20, wall_clock_minutes: 120 }, unattended }, { projectRoot: host.root });
      createGoalRun({ projectRoot: host.root, manifest: original, chain: [] });
      const feature = deriveChangeUnitFeatureId(BLUEPRINT, 'ledger-refresh');
      prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
        completionTarget: 'feature', requestedResults: [requirement], requestedPhases: ['plan', 'coding', 'review', 'ut'], requirement, overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: '既有账目领域职责，不含UI或设备行为', basisPaths: ['src/ledger/LedgerFeature.ets'] } });
      const prepared = prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
        runId: 'public-policy-child', adapter: 'codex', requirement, deliveryOrigin: { feature: original.feature, run_id: original.run_id } });
      assert(!('initial_design' in prepared.manifest));
      const current = prepared.manifest as GoalManifest;
      const childBytes = fs.readFileSync(prepared.manifestPath);
      assert.equal(current.budget.max_total_turns, 20);
      const phase = current.start_phase;
      const seedCalls = (count: number, prefix: string): void => {
        const ts = new Date().toISOString();
        append(host, current, Array.from({ length: count }, (_, index) => [
          { type: 'agent_invoke_start', ts, phase, invoke_id: `${prefix}-${index}`, command: 'fixture-budget-history' },
          { type: 'agent_invoke_end', ts, phase, invoke_id: `${prefix}-${index}`, exit_code: 1 },
        ]).flat());
      };
      const stop = (): void => {
        const ts = new Date().toISOString();
        append(host, current, [withRunDisposition({ type: 'phase_halt', ts, phase, halt_reason: 'budget_turns', verdict: 'FAIL', reason: 'fixture history reached the effective total model-call limit' }),
          withRunDisposition({ type: 'run_end', ts, status: 'HALTED', halt_reason: 'budget_turns' })]);
      };
      append(host, current, [{ type: 'run_start', ts: new Date().toISOString(), dry_run: false, chain: current.phase_chain }]);
      seedCalls(20, 'first-allowance'); stop();
      const controls = { projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature: original.feature, runId: original.run_id,
        adapter: 'codex', runMode: 'attended' as const, authorization: { mode: 'goal_mode' as const, autonomyAuthorized: true } };
      const oldRebases = events(host, original).filter(row => row.type === 'manifest_identity_rebase').length;
      const rootFile = path.join(runDir(host, original), 'manifest.json');
      const updated = { ...original, budget: { ...original.budget, max_total_turns: 60 } };
      fs.writeFileSync(rootFile, JSON.stringify(updated, null, 2) + '\n');
      const priorCalls = events(host, current).filter(row => row.type === 'agent_invoke_start').length;
      await assert.rejects(() => runGoalModeSessionStep(controls), /original budget changed without its existing override authorization/,
        'a public reader cannot project an unauthorized budget as a trusted run result');
      assert.equal(events(host, original).filter(row => row.type === 'manifest_identity_rebase').length, oldRebases, 'unapproved bytes must not become an authorized budget event');
      assert.equal(events(host, current).filter(row => row.type === 'agent_invoke_start').length, priorCalls, 'rejected unapproved budget cannot dispatch a child invocation');
      assert.deepEqual(fs.readFileSync(prepared.manifestPath), childBytes);
      assert.throws(() => readOriginalDeliveryBudget(host.root, current), /changed without/);
      const resumed = await runGoalModeSessionStep({ ...controls, overrideManifest: true });
      assert.equal(events(host, original).filter(row => row.type === 'manifest_identity_rebase').length, oldRebases + 1, 'the public runtime, not this test, must accept the override');
      assert.equal(resumed.type, 'phase_execute_request', JSON.stringify(resumed));
      assert.equal(resumed.run_id, current.run_id, 'the signed request must continue the same canonical child');
      assert.equal(resumed.feature, current.feature);
      const afterChild = fs.readFileSync(prepared.manifestPath);
      if (!afterChild.equals(childBytes)) {
        const before = JSON.parse(childBytes.toString('utf8')), after = JSON.parse(afterChild.toString('utf8'));
        const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
        const directory = path.join(FRAMEWORK, 'harness/reports/f3b8e6a1');
        fs.writeFileSync(path.join(directory, 'public-control-child-before.json'), childBytes);
        fs.writeFileSync(path.join(directory, 'public-control-child-after.json'), afterChild);
        fs.writeFileSync(path.join(directory, 'public-control-child-diff.json'), JSON.stringify({ project_root: host.root, child_manifest: prepared.manifestPath,
          changed: changed.map(key => ({ key, before: before[key], after: after[key] })) }, null, 2) + '\n');
        assert.deepEqual(afterChild, childBytes, `child manifest changed: ${changed.join(', ')}`);
      }
      const beforeFinal = readOriginalDeliveryBudget(host.root, current)!;
      assert.equal(beforeFinal.budget.max_total_turns, 60);
      assert.equal(beforeFinal.totalTurns, 21, '20 consumed calls plus the actual newly signed child request');
      seedCalls(60 - beforeFinal.totalTurns, 'second-allowance');
      const reference = resumed.request as { path: string };
      await runGoalModeSessionStep({ ...controls, requestPath: reference.path,
        report: { status: 'failed', phase: String(resumed.phase), details: 'The seeded family history reached 60 calls; no product completion is claimed.' } });
      const spent = readOriginalDeliveryBudget(host.root, current)!;
      assert.equal(spent.totalTurns, 60);
      const stopped = events(host, current).filter(row => row.type === 'run_end').at(-1);
      assert.equal(stopped?.halt_reason, 'budget_turns');
      const childDirectory = path.dirname(prepared.runDir);
      const runIds = fs.readdirSync(childDirectory).filter(name => !name.startsWith('.')).sort();
      const decision = decideRunContinuation({ projectRoot: host.root, feature: current.feature, call: { requirement } });
      assert.equal(decision.kind, 'hold', 'the already-consumed root increase is not a new budget change after the later stop');
      await assert.rejects(() => runGoalModeSessionStep(controls), /本次请求没有带来任何变化[\s\S]*budget_turns/,
        'the public preparation API must preserve the normal no-change refusal after the new allowance is exhausted');
      assert.equal(readOriginalDeliveryBudget(host.root, current)!.totalTurns, 60);
      assert.deepEqual(fs.readdirSync(childDirectory).filter(name => !name.startsWith('.')).sort(), runIds);
      assert.deepEqual(fs.readFileSync(prepared.manifestPath), childBytes);
    }); },
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
