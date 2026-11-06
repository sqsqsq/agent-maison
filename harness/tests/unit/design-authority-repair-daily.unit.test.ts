import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { loadCanonicalBlueprint } from '../../scripts/utils/component-blueprint-path';
import { deriveChangeUnitFeatureId } from '../../scripts/utils/change-unit-path';
import { reconcileChangeUnitBlueprintRefs, BLUEPRINT_RECONCILE_LOCK_NAME } from '../../scripts/utils/change-unit-design-preparation';
import { diagnoseBlueprintSkillAuthority, deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { writeBackAdmission, reusableDesignQuestioning, questioningDependencyChanges, runUnattendedDesignRepair } from '../../scripts/utils/design-repair-unattended';
import { capturePhaseInvocationSnapshot, diffPhaseInvocationSnapshots } from '../../scripts/utils/phase-write-boundary';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { tryAcquireLock, releaseLock, FEATURE_LOCK_NAME } from '../../scripts/utils/goal-run-lock';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, unitCaseGroups, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';
import { fixture as projectionFixture } from './blueprint-skill-projection.unit.test';

type Json = Record<string, any>;
type Group = 'content' | 'runtime';
const FRAMEWORK = path.resolve(__dirname, '../../..'), BLUEPRINT = 'ledger-app-blueprint';
const FEATURE = deriveChangeUnitFeatureId(BLUEPRINT, 'ledger-refresh');
const read = (file: string): Json => YAML.parse(fs.readFileSync(file, 'utf8'));
const write = (file: string, value: unknown): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, YAML.stringify(value)); };
const node = (doc: Json): Json => {
  const find = (value: any): Json | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    if (value.node_id === 'ledger-domain') return value;
    for (const child of Object.values(value)) { const found = find(child); if (found) return found; }
    return undefined;
  };
  const found = find(doc); assert(found, 'valid fixture contains ledger-domain'); return found;
};

async function withProject(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-repair-daily-'));
  projectionFixture(root); // Approved author input only; no goal result or completion is supplied.
  fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({ schema_version: '1.1', project_name: 'design repair boundaries',
    project_profile: { name: 'generic' }, active_workflow: 'obligation-driven', paths: { features_dir: 'doc/features' },
    architecture: { outer_layers: [{ id: 'src', can_depend_on: [] }], module_inner_layers: ['shared', 'data', 'domain', 'presentation'] } }));
  try { clearFrameworkConfigCache(); await run(root); }
  finally { clearFrameworkConfigCache(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); }
}

function repairInput(root: string, runId: string, requirement?: string) {
  if (!fs.existsSync(path.join(root, '.git'))) {
    const git = (args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git(['init', '-q']); git(['add', '-A']);
    git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'actual repair input']);
  }
  const manifest = buildGoalManifestFromInput({ feature: FEATURE, run_id: runId, adapter: 'claude', requirement: requirement ?? '保留当前设计与原事务。',
    start_phase: 'spec', end_phase: 'spec', unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: root });
  const created = createGoalRun({ projectRoot: root, manifest, chain: ['spec'] });
  const runDir = path.join(root, manifest.report_dir), rows: Json[] = [];
  const input = { projectRoot: root, frameworkRoot: FRAMEWORK, feature: FEATURE, phase: 'spec', runId,
    reportDir: manifest.report_dir, signature: 'a'.repeat(64), brief: { class: 'B1' as const, items: [] },
    ...(requirement ? { requirement } : {}), heldFeatureLock: null, runtimeWrites: [],
    emit: (event: Json) => { rows.push(event); fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n'); },
    registerLockRelease: (_release: (() => void) | null) => {}, recordEventLines: () => () => [] as Array<{ file: string; line: string }> };
  void created;
  return { input, runDir, rows };
}

const cases: Array<{ name: string; group: Group; run: () => Promise<void> }> = [{
  name: 'daily design content: original requirement dispatch ignores the retired personal B1 switch and preserves authority', group: 'content',
  run: () => withProject(async root => {
    fs.writeFileSync(path.join(root, 'framework.local.json'), JSON.stringify({ schema_version: '1.0', design_repair: { unattended_b1: 'true' } }));
    const original = loadCanonicalBlueprint(root, BLUEPRINT);
    const defective = read(original.canonicalPath); node(defective).acceptance = '当前批准验收误写成一段文字'; write(original.canonicalPath, defective);
    const defectiveBytes = fs.readFileSync(original.canonicalPath);
    const requirement = '在原范围内修复当前设计，不改变产品承诺。';
    const { input, runDir, rows } = repairInput(root, 'daily-authorized-repair', requirement); let calls = 0;
    const result = await runUnattendedDesignRepair({ ...input, invoke: async (purpose, prompt) => {
      calls++; assert.equal(purpose, 'author'); assert(prompt.includes(requirement));
      return { started: false, ok: false, status: 'waiting', detail: 'controlled model boundary is waiting' };
    } });
    assert.equal(calls, 1); assert.equal(result.outcome, 'waiting');
    assert(fs.readFileSync(original.canonicalPath).equals(defectiveBytes));
    assert(!rows.some(row => row.stage === 'published'));
    const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.requirement, requirement); assert.equal(manifest.unattended.write_mode, 'full-access');
  }),
}, {
  name: 'daily design content: actual malformed authority is diagnosed and the owner repair restores projection', group: 'content',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), original = fs.readFileSync(loaded.canonicalPath);
    const before = deriveBlueprintSkillInput(root, FEATURE, FRAMEWORK, 'acceptance');
    assert.equal(before.state, 'resolved', JSON.stringify(before));
    const doc = read(loaded.canonicalPath); node(doc).acceptance = '当前验收误写成一段文字';
    write(loaded.canonicalPath, doc); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
    const broken = diagnoseBlueprintSkillAuthority(root, FRAMEWORK, FEATURE);
    assert(broken.findings.some(finding => finding.codes.includes('authority_content_not_machine_structure')), JSON.stringify(broken));
    fs.writeFileSync(loaded.canonicalPath, original); reconcileChangeUnitBlueprintRefs(root, BLUEPRINT);
    assert.equal(deriveBlueprintSkillInput(root, FEATURE, FRAMEWORK, 'acceptance').state, 'resolved');
  }),
}, {
  name: 'daily design content: author self-reported admission cannot hide missing required design evidence', group: 'content',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = structuredClone(loaded.blueprint) as Json;
    doc.review_summary.questioning.items = [];
    doc.review_summary.admission = { status: 'pass', root_questions_complete: true, current_slice: { contracts_ready: true, design_refs_ready: true }, blocker_refs: [] };
    const derived = writeBackAdmission(doc, { projectRoot: root, canonicalPath: loaded.canonicalPath });
    assert.equal(derived.status, 'blocker'); assert.equal(doc.review_summary.admission.status, 'blocker');
    assert(doc.review_summary.admission.blocker_refs.length > 0);
  }),
}, {
  name: 'daily design content: independent Q reuse requires a completed read-only original and retains a real blocker', group: 'content',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), doc = loaded.blueprint as Json;
    const pre = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'contracts'] });
    const input = { projectRoot: root, blueprintPath: loaded.canonicalPath, blueprint: doc, beforeBlueprint: fs.readFileSync(loaded.canonicalPath, 'utf8'),
      output: JSON.stringify(doc.review_summary.questioning), providerId: 'independent-design-questioning', completed: true, preSnapshot: pre, postSnapshot: pre };
    assert(reusableDesignQuestioning(input), 'current independent fixture Q has a usable read-only original');
    assert.equal(reusableDesignQuestioning({ ...input, completed: false }), null);
    assert.equal(reusableDesignQuestioning({ ...input, preSnapshot: undefined }), null);
    const changed = structuredClone(doc); changed.title = 'actual design change';
    assert.equal(reusableDesignQuestioning({ ...input, blueprint: changed }), null);
    const denial = structuredClone(doc.review_summary.questioning); denial.items[0].disposition = 'blocker';
    denial.items[0].answer = '当前必需设计仍缺原批准职责的依据，不允许降级验收。';
    const retained = reusableDesignQuestioning({ ...input, output: JSON.stringify(denial) }) as Json;
    assert(retained?.items.some((item: Json) => item.disposition === 'blocker' && item.answer === denial.items[0].answer));
  }),
}, {
  name: 'daily design runtime: snapshot distinguishes authorized draft and own heartbeat from protected input writes', group: 'runtime',
  run: () => withProject(root => {
    const draft = 'doc/features/repair/goal-runs/current/design-repair/draft.yaml', own = 'doc/features/repair/goal-runs/current/liveness.json';
    for (const file of [draft, own]) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), 'before'); }
    const resolution = { projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'framework.config.json'], executionRole: 'author' as const };
    const options = { ownedPrefixes: [path.dirname(draft)], runtimeExcluded: [own] };
    const before = capturePhaseInvocationSnapshot(resolution, options);
    fs.writeFileSync(path.join(root, draft), 'actual draft'); fs.writeFileSync(path.join(root, own), 'actual heartbeat');
    assert.equal(diffPhaseInvocationSnapshots(before, capturePhaseInvocationSnapshot(resolution, options)).kind, 'clean');
    const requirement = path.join(root, 'requirements/ledger.md'); fs.appendFileSync(requirement, '\nunauthorized requirement change\n');
    const change = diffPhaseInvocationSnapshots(before, capturePhaseInvocationSnapshot(resolution, options));
    assert(change.kind === 'changed' && change.changes.some(row => row.path === 'requirements/ledger.md'));
  }),
}, {
  name: 'daily design runtime: unreadable protected input is unverifiable rather than clean', group: 'runtime',
  run: () => withProject(root => {
    const target = path.join(root, 'requirements/ledger.md');
    const resolution = { projectRoot: root, protectedRoots: ['requirements'] };
    const before = capturePhaseInvocationSnapshot(resolution), nativeFs = require('fs') as typeof fs, readFile = fs.readFileSync;
    try {
      nativeFs.readFileSync = ((file: fs.PathOrFileDescriptor, ...args: any[]) => {
        if (typeof file !== 'number' && path.resolve(String(file)) === target) throw Object.assign(new Error('controlled EACCES'), { code: 'EACCES' });
        return (readFile as any)(file, ...args);
      }) as typeof fs.readFileSync;
      const after = capturePhaseInvocationSnapshot(resolution);
      assert(after.failureReason); assert.equal(diffPhaseInvocationSnapshots(before, after).kind, 'unverifiable');
    } finally { nativeFs.readFileSync = readFile; }
  }),
}, {
  name: 'daily design runtime: a newly referenced normally excluded input remains an unknown original', group: 'runtime',
  run: () => withProject(root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), before = capturePhaseInvocationSnapshot({ projectRoot: root, protectedRoots: ['doc', 'src', 'requirements', 'contracts'] });
    const file = path.join(root, 'context/new-contract.yaml'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'newly referenced original\n');
    const doc = structuredClone(loaded.blueprint) as Json; node(doc).contracts.source_ref = 'context/new-contract.yaml';
    const changed = questioningDependencyChanges(root, doc, before, loaded.canonicalPath);
    assert(changed.some(entry => path.resolve(entry.path) === file && entry.exists), JSON.stringify(changed));
  }),
}, {
  name: 'daily design runtime: unresolved containment cannot publish or start questioning', group: 'runtime',
  run: () => withProject(async root => {
    const loaded = loadCanonicalBlueprint(root, BLUEPRINT), defective = read(loaded.canonicalPath);
    node(defective).acceptance = '当前批准验收需要设计owner恢复机器结构'; write(loaded.canonicalPath, defective);
    const { input, rows } = repairInput(root, 'daily-containment'); const calls: string[] = [];
    const result = await runUnattendedDesignRepair({ ...input, invoke: async purpose => {
      calls.push(purpose); return { started: true, ok: false, detail: 'controlled external containment is unresolved', containmentUnresolved: true };
    } });
    assert.equal(result.outcome, 'containment_unresolved'); assert.deepEqual(calls, ['author']);
    assert(!rows.some(row => row.stage === 'published'));
  }),
}, {
  name: 'daily design runtime: failed second lock releases owned locks and retains the borrowed feature lock', group: 'runtime',
  run: () => withProject(root => {
    const doc = loadCanonicalBlueprint(root, BLUEPRINT); const changed = structuredClone(doc.blueprint) as Json; changed.revision++;
    for (const result of changed.derived_results ?? []) result.input_revision = changed.revision;
    write(doc.canonicalPath, changed);
    const lockPath = (id: string) => featureFilePath(root, deriveChangeUnitFeatureId(BLUEPRINT, id), path.join('goal-runs', FEATURE_LOCK_NAME));
    const lent = tryAcquireLock(lockPath('ledger-refresh'), { run_id: 'actual-caller' }); assert(lent);
    const nativeFs = require('fs') as typeof fs, open = fs.openSync; let injected = false;
    try {
      nativeFs.openSync = ((file: fs.PathLike, ...args: any[]) => {
        if (!injected && path.resolve(String(file)) === path.resolve(lockPath('ledger-recovery'))) {
          injected = true; throw Object.assign(new Error('controlled lock EACCES'), { code: 'EACCES' });
        }
        return (open as any)(file, ...args);
      }) as typeof fs.openSync;
      assert.throws(() => reconcileChangeUnitBlueprintRefs(root, BLUEPRINT, { heldFeatureLocks: [{ path: lockPath('ledger-refresh'), ownerId: lent.ownerId }] }), /EACCES/);
    } finally { nativeFs.openSync = open; }
    try {
      assert(injected); assert(fs.existsSync(lockPath('ledger-refresh')));
      assert(!fs.existsSync(path.join(featureFilePath(root, BLUEPRINT, ''), BLUEPRINT_RECONCILE_LOCK_NAME)));
      for (const id of ['ledger-consumer', 'ledger-recovery', 'ledger-summary']) assert(!fs.existsSync(lockPath(id)));
      const retry = reconcileChangeUnitBlueprintRefs(root, BLUEPRINT, { heldFeatureLocks: [{ path: lockPath('ledger-refresh'), ownerId: lent.ownerId }] });
      assert(!retry.busy && retry.bumped.length === 4, JSON.stringify(retry));
    } finally { releaseLock(lockPath('ledger-refresh'), lent.ownerId); }
  }),
}, {
  name: 'daily design runtime: copied canonical bytes cannot invent a publication transaction', group: 'runtime',
  run: () => withProject(async root => {
    const { input, runDir, rows } = repairInput(root, 'daily-no-transaction');
    const first = await runUnattendedDesignRepair({ ...input, invoke: async () => ({ started: true, ok: false, detail: 'request yielded', handoff: true }) });
    assert.equal(first.outcome, 'handoff');
    const draftFile = path.join(runDir, 'design-repair/component-blueprint.yaml'), draft = read(draftFile); draft.revision++;
    const bytes = YAML.stringify(draft); fs.writeFileSync(draftFile, bytes); fs.writeFileSync(loadCanonicalBlueprint(root, BLUEPRINT).canonicalPath, bytes);
    const result = await runUnattendedDesignRepair({ ...input, invoke: async () => ({ started: false, ok: false, detail: 'original report unreadable' }) });
    assert(result.outcome === 'failed' && result.step === 'author' && result.reason.includes('original report unreadable'), JSON.stringify(result));
    assert(fs.existsSync(draftFile)); assert(!rows.some(row => row.stage === 'published'));
  }),
}];

export const getCases = (group?: Group) => cases.filter(test => !group || test.group === group);
export const listCaseGroups = (group?: Group) => unitCaseGroups(getCases(group).map(test => test.name)).map(group => ({ ...group, releaseOnly: false }));
export async function runSelectedCases(selector?: string, group?: Group) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of getCases(group)) {
    if (!matchesUnitCase(test.name, selector)) continue;
    const stop = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
    finally { stop(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
if (require.main === module) void runSelectedCases().then(result => { console.log(JSON.stringify(result, null, 2)); process.exitCode = result.results.some(row => !row.ok) ? 1 : 0; });
