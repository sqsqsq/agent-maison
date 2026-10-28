import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { featureFilePath } from '../../config';
import { buildGoalManifestFromInput, buildInitialDesignGoalManifest, type GoalRunManifest } from '../../scripts/utils/goal-manifest';
import { assertGoalRunAttachable, createGoalRun } from '../../scripts/utils/goal-run-creation';
import { ensureRunControl } from '../../scripts/utils/goal-run-control';
import { FEATURE_LOCK_NAME, releaseLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { validateComponentBlueprint } from '../../scripts/utils/component-blueprint-validator';
import { deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { deriveDesignPreparationReadiness } from '../../scripts/utils/change-unit-design-preparation';
import { designRepairTarget, designRepairInvokeLabel, designRepairSignature, runUnattendedDesignRepair, type DesignRepairBriefLike } from '../../scripts/utils/design-repair-unattended';
import { headlessLedgerPath } from '../../scripts/utils/headless-assumptions';
import { resolveBlueprintTarget } from '../../scripts/utils/blueprint-addressing';
import { materializeBlueprintSkillInputs } from '../../scripts/utils/blueprint-skill-projection';
import { repairAdapter } from './design-authority-repair.unit.test';
import { BLUEPRINT_ID, withFreshCuHost } from './lifecycle-evolution.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

type Host = Parameters<Parameters<typeof withFreshCuHost>[0]>[0];
type Document = Record<string, any>;
type Scenario = 'root' | 'outside-write' | 'readiness-blocked' | 'normal';
const CU = deriveChangeUnitFeatureId(BLUEPRINT_ID, 'ledger-refresh');
const requirement = '在已准入账目蓝图的原目标内补齐CU设计引用，再继续账目刷新与恢复的完整交付；不得降低验收或修改框架。';
const read = (file: string): Document => YAML.parse(fs.readFileSync(file, 'utf8'));
const write = (file: string, value: unknown): void => fs.writeFileSync(file, YAML.stringify(value));

function assertNoChildRun(host: Host): void {
  for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
    const feature = deriveChangeUnitFeatureId(BLUEPRINT_ID, String(unit.changeUnit.change_unit_id));
    const directory = featureFilePath(host.root, feature, 'goal-runs');
    assert(!fs.existsSync(directory) || fs.readdirSync(directory).every(name => name.startsWith('.')), 'a design repair must not invent a construction child');
    assert(!fs.existsSync(featureFilePath(host.root, feature, 'execution-scope.json')), 'repair must not freeze a construction scope');
  }
}

async function scenario(host: Host, mode: Scenario): Promise<void> {
  const workspace = featureFilePath(host.root, BLUEPRINT_ID, '');
  for (const unit of enumerateCanonicalChangeUnits(host.root, BLUEPRINT_ID)) {
    if (unit.changeUnit.change_unit_id === 'ledger-refresh') continue;
    const directory = path.resolve(path.dirname(unit.canonicalPath));
    assert(directory.startsWith(path.resolve(workspace) + path.sep));
    fs.rmSync(directory, { recursive: true, force: true });
  }
  const canonical = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
  assert(!validateComponentBlueprint(canonical.blueprint, { projectRoot: host.root, canonicalPath: canonical.canonicalPath }).some(issue => issue.severity === 'BLOCKER'));
  assert(deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).ready, 'the unchanged design fixture must initially be ready');
  if (mode === 'normal') materializeBlueprintSkillInputs(host.root, CU, host.frameworkRoot);
  const unit = loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh');
  const approvedCu = read(unit.canonicalPath);
  const defective = structuredClone(approvedCu);
  defective.design_refs = defective.design_refs.filter((ref: Document) => ref.target.view_id !== 'development');
  write(unit.canonicalPath, defective);
  const before = deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID);
  assert(!before.ready && before.perUnit.some(row => row.changeUnitId === 'ledger-refresh' && row.verdict !== 'constructable'), 'the missing real development reference must block CU readiness');
  const issues = before.perUnit.find(row => row.changeUnitId === 'ledger-refresh')!;
  const brief: DesignRepairBriefLike = { class: 'B2', items: [{ check: 'plan:cu:design-basis', class: 'B2', codes: issues.issueIds,
    artifacts: [path.relative(host.root, unit.canonicalPath).split(path.sep).join('/')], basis: issues.issues.map(issue => issue.message).join('；'),
    needs: ['按已准入蓝图补回被遗漏的development设计引用，保留原CU身份和其它权威设计。'] }] };
  const normal = mode === 'normal';
  const feature = normal ? CU : BLUEPRINT_ID;
  const runId = normal ? 'normal-repair-run' : 'initial-repair-run';
  const common = { feature, run_id: runId, adapter: 'claude', requirement,
    budget: { max_total_turns: 30, wall_clock_minutes: 120 },
    unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 } };
  const manifest: GoalRunManifest = normal
    ? buildGoalManifestFromInput({ ...common, start_phase: 'plan', end_phase: 'plan' }, { projectRoot: host.root })
    : buildInitialDesignGoalManifest({ ...common, start_phase: 'plan', end_phase: 'ut', initial_design: { completion_target: 'feature', requested_results: ['账目刷新与恢复完整交付'], requested_phases: ['plan', 'coding', 'review', 'ut'] } }, { projectRoot: host.root });
  createGoalRun({ projectRoot: host.root, manifest, chain: normal ? ['plan'] : [] });
  assertGoalRunAttachable(host.root, manifest);
  const runDir = path.join(host.root, manifest.report_dir);
  ensureRunControl(runDir, runId);
  const eventFile = path.join(runDir, 'events.jsonl');
  let recording: Array<{ file: string; line: string }> | undefined;
  const emit = (value: Record<string, unknown>) => {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...value }) + '\n';
    fs.appendFileSync(eventFile, line);
    recording?.push({ file: eventFile, line });
  };
  emit({ type: 'run_start', ...(normal ? { chain: ['plan'] } : {}) });
  if (!normal) {
    assertNoChildRun(host);
    assert.equal(manifest.start_phase, 'plan', 'the original request domain is input, not a construction phase');
    assert.equal(manifest.end_phase, 'ut');
    assert.deepEqual((manifest as unknown as Document).initial_design.requested_phases, ['plan', 'coding', 'review', 'ut']);
    for (const key of ['execution_scope', 'run_base_sha', 'phase_chain', 'chain_override']) assert.equal((manifest as unknown as Document)[key], undefined);
  }
  const phase = normal ? 'plan' : 'initial-design-author';
  const lockPath = featureFilePath(host.root, feature, path.join('goal-runs', FEATURE_LOCK_NAME));
  const lock = tryAcquireLock(lockPath, {});
  assert(lock);
  const savedNode = structuredClone(resolveBlueprintTarget(canonical.blueprint, { kind: 'node', view_id: 'logical', id: 'ledger-domain' })) as Document;
  const originalBytes = fs.readFileSync(canonical.canonicalPath);
  const purposes: string[] = [];
  let readinessCalls = 0;
  let lateFault = false;
  const preparation = require('../../scripts/utils/change-unit-design-preparation') as typeof import('../../scripts/utils/change-unit-design-preparation');
  const realReconcile = preparation.reconcileHeldBlueprintRefs;
  if (mode === 'readiness-blocked') preparation.reconcileHeldBlueprintRefs = (...args) => {
    const result = realReconcile(...args);
    if (!lateFault) {
      lateFault = true;
      const current = loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh');
      const changed = read(current.canonicalPath);
      changed.design_refs = changed.design_refs.filter((ref: Document) => ref.target.view_id !== 'development');
      write(current.canonicalPath, changed);
    }
    return result;
  };
  const adapter = repairAdapter(host, () => savedNode, { author: (_doc, draft) => {
    write(path.join(path.dirname(draft), 'change-unit.yaml'), approvedCu);
    if (mode === 'outside-write') fs.appendFileSync(path.join(host.root, 'src/ledger/LedgerFeature.ets'), '\n// unauthorized product edit\n');
  } });
  try {
    const result = await runUnattendedDesignRepair({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature,
      ...(!normal ? { designTarget: designRepairTarget(host.root, CU) } : {}), phase, runId, reportDir: manifest.report_dir, requirement, brief,
      signature: designRepairSignature(feature, phase, brief.items), heldFeatureLock: { path: lockPath, ownerId: lock.ownerId }, runtimeWrites: [path.relative(host.root, lockPath)], emit,
      registerLockRelease: () => {}, recordEventLines: () => {
        const lines: Array<{ file: string; line: string }> = []; recording = lines;
        return () => { recording = undefined; return lines; };
      },
      ...(!normal ? { recheckReadiness: () => {
        readinessCalls++;
        const current = deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID);
        return { ready: current.ready, reason: current.ready ? '原P1/P2 readiness已通过' : JSON.stringify(current.perUnit.map(row => ({ id: row.changeUnitId, verdict: row.verdict, issues: row.issueIds }))) };
      } } : {}),
      invoke: async (purpose, prompt) => {
        purposes.push(purpose);
        assert(prompt.includes(requirement), 'the real original request must reach both responsibilities');
        const label = designRepairInvokeLabel(purpose);
        const invokeId = `${label}-1`;
        emit({ type: 'agent_invoke_start', phase: label, invoke_id: invokeId, command: 'bounded-design-adapter' });
        await adapter.onOutOfChain({ phase: label, prompt, attempt: 1, runId });
        emit({ type: 'agent_invoke_end', phase: label, invoke_id: invokeId, exit_code: 0 });
        return { started: true, ok: true, detail: 'bounded author/questioning completed its requested draft work' };
      } });
    const rows = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Document);
    if (mode === 'outside-write') {
      assert.equal(result.outcome, 'violation', JSON.stringify(result));
      assert.deepEqual(fs.readFileSync(canonical.canonicalPath), originalBytes);
      assert.deepEqual(purposes, ['author']);
      assert.equal(readinessCalls, 0);
      assert(result.outcome === 'violation' && result.changes.some(change => change.path === 'src/ledger/LedgerFeature.ets'));
    } else {
      assert.equal(result.outcome, 'published', JSON.stringify(result));
      assert(result.outcome === 'published');
      assert.equal(result.recovered, mode !== 'readiness-blocked', JSON.stringify(result));
      assert.deepEqual(purposes, ['author', 'questioning']);
      assert.equal(readinessCalls, normal ? 0 : 1);
      assert.equal(result.revision, Number(canonical.blueprint.revision) + 1);
      const published = loadCanonicalBlueprint(host.root, BLUEPRINT_ID);
      const rebound = loadCanonicalChangeUnit(host.root, BLUEPRINT_ID, 'ledger-refresh');
      assert.equal((rebound.changeUnit.component_blueprint_ref as Document).artifact_sha256, published.artifactSha256);
      assert(rows.some(row => row.type === 'design_authority_repair' && row.stage === 'published' && row.outcome === (mode === 'readiness-blocked' ? 'unrecovered' : 'recovered')));
      if (mode === 'readiness-blocked') assert.equal(result.step, 'probe');
      else assert(deriveDesignPreparationReadiness(host.root, BLUEPRINT_ID).ready);
      assert(fs.existsSync(headlessLedgerPath(host.root, feature, phase)), 'audit must stay on the real run carrier');
    }
    assert(adapter.log.lockedDuringAuthor?.attemptedBeforeInvoke);
    if (!normal) {
      assertNoChildRun(host);
      const actual = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
      assert(actual.initial_design && !actual.execution_scope && !actual.run_base_sha);
    }
  } finally {
    preparation.reconcileHeldBlueprintRefs = realReconcile;
    releaseLock(lockPath, lock.ownerId);
  }
}

const cases = [
  { name: 'f3b8e6a1 initial repair: real root repairs an admitted blueprint CU and reaches real readiness without a construction child', mode: 'root' },
  { name: 'f3b8e6a1 initial repair: root author writes outside its draft and the existing publication guard rejects it', mode: 'outside-write' },
  { name: 'f3b8e6a1 initial repair: actual readiness failure after publication remains unrecovered for an initial-design phase', mode: 'readiness-blocked' },
  { name: 'f3b8e6a1 initial repair: normal canonical run retains its default design subject and original recovery probe', mode: 'normal' },
] as const;

export function getCases() { return cases.map(test => ({ name: test.name, run: () => withFreshCuHost(host => scenario(host, test.mode)) })); }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of getCases()) {
    if (!matchesUnitCase(test.name, filter)) continue;
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export async function runAll() { return (await runSelectedCases()).results; }
