import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import { createBlueprintReviewDesignFixture } from '../fixtures/blueprint-review-design';
import { loadHostSnapshot, SNAPSHOT_CU_FEATURE } from '../fixtures/host-snapshot-3.1.0/generate';
import { featureFilePath, clearFrameworkConfigCache } from '../../config';
import { asChangeUnitArtifact, createChangeUnitRef, deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits, loadCanonicalChangeUnit } from '../../scripts/utils/change-unit-path';
import { acceptChangeUnitCandidates, ChangeUnitCandidateRejected } from '../../scripts/utils/change-unit-provider-boundary';
import { BLUEPRINT_RECONCILE_LOCK_NAME, reviseChangeUnitContent, type ChangeUnitContentRevision } from '../../scripts/utils/change-unit-design-preparation';
import { deriveBlueprintSkillInput } from '../../scripts/utils/blueprint-skill-projection';
import { observeChangeUnitCompletion, resolveChangeUnitExpectedExecution } from '../../scripts/utils/change-unit-completion';
import { assessFeature } from '../../scripts/utils/feature-assessment';
import { FEATURE_LOCK_NAME, releaseLock, tryAcquireLock } from '../../scripts/utils/goal-run-lock';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import type { ChangeUnitArtifact } from '../../scripts/utils/change-unit-model';
import type { ContractsSpec } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
const blueprintId = 'ledger-app-blueprint';
const provider = 'consumer-validated-decomposition';
type Fixture = ReturnType<typeof createBlueprintReviewDesignFixture>;
const feature = (id: string) => deriveChangeUnitFeatureId(blueprintId, id);
function revision(root: string, id = 'ledger-refresh', mutate: (cu: ChangeUnitArtifact) => void = cu => { cu.purpose += ' 同一切片补齐账户切换语义。'; }): ChangeUnitContentRevision {
  const loaded = loadCanonicalChangeUnit(root, blueprintId, id);
  const artifact = structuredClone(asChangeUnitArtifact(loaded.changeUnit));
  mutate(artifact);
  return { expectedRef: createChangeUnitRef(loaded), candidate: { providerId: provider, artifact } };
}
function files(f: Fixture, extra: string[] = []): string[] {
  return [f.blueprintFile, ...f.cuFiles, ...['ledger-refresh', 'ledger-report'].flatMap(id =>
    ['acceptance.yaml', 'contracts.yaml', 'use-cases.yaml', 'spec/spec.md', 'plan/plan.md'].map(name => featureFilePath(f.root, feature(id), name))), ...extra];
}
function bytes(paths: string[]): Map<string, Buffer | undefined> {
  return new Map(paths.map(file => [file, fs.existsSync(file) ? fs.readFileSync(file) : undefined]));
}
function unchanged(before: Map<string, Buffer | undefined>): void {
  for (const [file, previous] of before) {
    assert.equal(fs.existsSync(file), previous !== undefined, file);
    if (previous) assert(fs.readFileSync(file).equals(previous), file);
  }
}
function reject(f: Fixture, rows: ChangeUnitContentRevision[], message?: RegExp): void {
  const before = bytes(files(f));
  assert.throws(() => reviseChangeUnitContent(f.root, blueprintId, rows), error => {
    assert(error instanceof Error);
    if (message) assert(message.test(error.message), error.message);
    return true;
  });
  unchanged(before);
}
function writeStageOutputs(f: Fixture, id: string): string[] {
  const projected = deriveBlueprintSkillInput(f.root, feature(id), frameworkRoot, 'contracts');
  assert.equal(projected.state, 'resolved', projected.detail);
  const contracts = structuredClone(projected.value as ContractsSpec);
  const loaded = loadCanonicalChangeUnit(f.root, blueprintId, id); const cu = asChangeUnitArtifact(loaded.changeUnit);
  const implementation_refs = ['planned:' + contracts.files.find(file => file.startsWith('src/') && !file.endsWith('LedgerShared.ets'))];
  const test_refs = ['planned:' + contracts.files.find(file => file.startsWith('test/'))];
  contracts.change_unit = { change_unit_ref: createChangeUnitRef(loaded),
    predicate_mappings: cu.target_predicates.map(row => ({ predicate_id: row.predicate_id, implementation_refs, test_refs })),
    provide_mappings: cu.provides.map(row => ({ provide_id: row.provide_id, implementation_refs, test_refs })),
    design_ref_mappings: cu.design_refs.map(design_ref => ({ design_ref, implementation_refs, verification_refs: test_refs })) };
  const values = { 'acceptance.yaml': projected.artifacts!['acceptance@1'], 'contracts.yaml': contracts, 'use-cases.yaml': projected.artifacts!['use-cases@1'] };
  for (const [name, value] of Object.entries(values)) fs.writeFileSync(featureFilePath(f.root, feature(id), name), YAML.stringify(value));
  return Object.keys(values).map(name => featureFilePath(f.root, feature(id), name));
}
function runFixture(f: Fixture, status: 'running' | 'halted') {
  const manifest = buildGoalManifestFromInput({ feature: f.feature, run_id: '20261011T000000Z-c0ffee', requirement: 'revise the same unfinished ledger slice',
    start_phase: 'plan', end_phase: 'plan', unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
  const born = createGoalRun({ projectRoot: f.root, manifest, chain: ['plan'], resolveHead: () => 'a'.repeat(40) });
  // Run qualification inputs only; no business PASS or completion fact is manufactured.
  const events: Record<string, unknown>[] = [{ ts: '2026-10-11T00:00:00Z', type: 'run_start', run_id: manifest.run_id }];
  if (status === 'halted') events.push({ ts: '2026-10-11T00:01:00Z', type: 'run_end', run_id: manifest.run_id, status: 'HALTED' });
  fs.appendFileSync(born.eventsPath, events.map(event => JSON.stringify(event) + '\n').join(''));
  return born;
}
function addDependency(f: Fixture): void {
  const providerUnit = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, blueprintId, 'ledger-refresh').changeUnit);
  const row = revision(f.root, 'ledger-report', cu => { cu.requires.push({ require_id: 'committed-ledger', from_change_unit_id: 'ledger-refresh', provide_id: providerUnit.provides[0].provide_id }); });
  assert.equal(reviseChangeUnitContent(f.root, blueprintId, [row]).revised.length, 1);
}

const cases: Array<{ name: string; run(f: Fixture): void }> = [
  { name: 'unfinished content keeps CU/Feature/directory, increments once, preserves stage bytes and rejects stale refs and ordinary reaccept', run(f) {
    const outputs = writeStageOutputs(f, 'ledger-refresh'); const stageBefore = bytes(outputs);
    const row = revision(f.root, 'ledger-refresh', cu => {
      const owner = cu.target_predicates.find(predicate => predicate.role === 'owner')!;
      cu.target_predicates.push({ ...structuredClone(owner), predicate_id: 'account-reset-owner', description: '账户切换后丢弃旧账户消费者缓存。' });
      cu.revision = 999;
    });
    const result = reviseChangeUnitContent(f.root, blueprintId, [row]);
    assert.equal(result.revised.length, 1); const loaded = result.revised[0]; const cu = asChangeUnitArtifact(loaded.changeUnit);
    assert.equal(cu.revision, row.expectedRef.revision + 1); assert.equal(cu.change_unit_id, row.expectedRef.change_unit_id);
    assert.equal(cu.component_id, row.expectedRef.component_id); assert.equal(cu.blueprint_id, blueprintId); assert.equal(loaded.canonicalPath, f.cuFiles[0]);
    assert.equal(feature(cu.change_unit_id), f.feature); assert(cu.target_predicates.some(predicate => predicate.predicate_id === 'account-reset-owner'));
    assert.equal(row.candidate.artifact.revision, 999, 'framework must not mutate the caller candidate');
    assert(result.reviewDocument && result.reviewDocument.status !== 'failed');
    assert.equal(enumerateCanonicalChangeUnits(f.root, blueprintId).length, 2); unchanged(stageBefore);
    reject(f, [row], /revision|artifact_sha256/);
    assert.throws(() => acceptChangeUnitCandidates(f.root, [revision(f.root, 'ledger-refresh', () => {}).candidate]),
      error => error instanceof ChangeUnitCandidateRejected && error.code === 'change_unit_candidate_already_exists');
  } },
  { name: 'noop returns unchanged without increment or writes, then the same expected ref still accepts one real change', run(f) {
    const row = revision(f.root, 'ledger-refresh', () => {}); const before = bytes(files(f));
    for (let i = 0; i < 2; i++) {
      const result = reviseChangeUnitContent(f.root, blueprintId, [row]);
      assert.deepStrictEqual(result.unchanged, ['ledger-refresh']); assert.deepStrictEqual(result.revised, []); assert.equal(result.reviewDocument, undefined); unchanged(before);
    }
    row.candidate.artifact.purpose += ' 补充同一交付说明。';
    assert.equal(reviseChangeUnitContent(f.root, blueprintId, [row]).revised[0].changeUnit.revision, row.expectedRef.revision + 1);
  } },
  { name: 'running returns busy while halted run can revise with its birth manifest/events and stage bytes preserved', run(f) {
    const born = runFixture(f, 'running'); const row = revision(f.root); const before = bytes(files(f, [born.manifestPath, born.eventsPath]));
    const result = reviseChangeUnitContent(f.root, blueprintId, [row]); assert(result.busy); assert.deepStrictEqual(result.revised, []); unchanged(before);
    fs.appendFileSync(born.eventsPath, JSON.stringify({ ts: '2026-10-11T00:01:00Z', type: 'run_end', run_id: '20261011T000000Z-c0ffee', status: 'HALTED' }) + '\n');
    const stoppedBytes = bytes([born.manifestPath, born.eventsPath]);
    assert.equal(reviseChangeUnitContent(f.root, blueprintId, [row]).revised.length, 1); unchanged(stoppedBytes);
  } },
  { name: 'blueprint and Feature lock competition returns busy without releasing another owner or changing artifacts', run(f) {
    for (const lockPath of [path.join(path.dirname(path.dirname(f.blueprintFile)), BLUEPRINT_RECONCILE_LOCK_NAME), featureFilePath(f.root, f.feature, path.join('goal-runs', FEATURE_LOCK_NAME))]) {
      const lock = tryAcquireLock(lockPath, { run_id: 'another-writer' }); assert(lock);
      try {
        const before = bytes(files(f)); const result = reviseChangeUnitContent(f.root, blueprintId, [revision(f.root)]);
        assert(result.busy); assert.deepStrictEqual(result.revised, []); assert(fs.existsSync(lockPath)); unchanged(before);
      } finally { releaseLock(lockPath, lock.ownerId); }
    }
  } },
  { name: 'broken completion, original-only Feature completion, corrupt run and corrupt events all reject without writes', run(f) {
    const projection = featureFilePath(f.root, f.feature, 'feature-completion.json');
    fs.writeFileSync(projection, '{broken'); reject(f, [revision(f.root)], /INVALID|不能按未完成/); fs.rmSync(projection);
    const original = featureFilePath(f.root, f.feature, 'completion/original.json'); fs.mkdirSync(path.dirname(original), { recursive: true }); fs.writeFileSync(original, '{broken original');
    reject(f, [revision(f.root)], /completion 原件/); fs.rmSync(original);
    const born = runFixture(f, 'halted'); fs.appendFileSync(born.eventsPath, '{broken event\n');
    reject(f, [revision(f.root)], /事件损坏|events.jsonl.*损坏|run 记录损坏/);
    fs.rmSync(born.manifestPath); reject(f, [revision(f.root)], /run 记录损坏|manifest/);
  } },
  { name: 'retired predecessor remains byte-identical and only its active successor can be revised', run(f) {
    const prior = loadCanonicalChangeUnit(f.root, blueprintId, 'ledger-refresh'); const next = revision(f.root, 'ledger-refresh', () => {}).candidate;
    next.artifact.change_unit_id = 'ledger-refresh-next'; next.artifact.supersedes = createChangeUnitRef(prior);
    const accepted = acceptChangeUnitCandidates(f.root, [next]); assert.equal(accepted.length, 1);
    const oldBytes = fs.readFileSync(prior.canonicalPath); reject(f, [revision(f.root)], /精确替代|历史字节/);
    const result = reviseChangeUnitContent(f.root, blueprintId, [revision(f.root, 'ledger-refresh-next')]); assert.equal(result.revised.length, 1);
    assert(fs.readFileSync(prior.canonicalPath).equals(oldBytes)); assert.deepStrictEqual(result.revised[0].changeUnit.supersedes, createChangeUnitRef(prior));
  } },
  { name: 'an invalid batch writes no candidate or stage output, and identity/retirement changes cannot overwrite canonical history', run(f) {
    writeStageOutputs(f, 'ledger-refresh'); writeStageOutputs(f, 'ledger-report');
    const invalid = revision(f.root, 'ledger-report', cu => { cu.target_predicates = []; }); reject(f, [revision(f.root), invalid], /校验|predicate/);
    reject(f, [revision(f.root, 'ledger-refresh', cu => { cu.change_unit_id = 'new-identity'; })], /identity|目录/);
    const prior = createChangeUnitRef(loadCanonicalChangeUnit(f.root, blueprintId, 'ledger-report'));
    reject(f, [revision(f.root, 'ledger-refresh', cu => { cu.supersedes = prior; })], /identity|替代历史/);
  } },
  { name: 'second rename failure rolls back the first canonical write and preserves every old Feature artifact', run(f) {
    writeStageOutputs(f, 'ledger-refresh'); writeStageOutputs(f, 'ledger-report'); const before = bytes(files(f));
    const nodeFs = require('fs') as typeof fs; const rename = nodeFs.renameSync; let writes = 0;
    try {
      nodeFs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
        if (f.cuFiles.includes(String(to))) { writes++; if (String(to) === f.cuFiles[1]) throw new Error('injected second CU rename failure'); }
        return rename(from, to);
      }) as typeof fs.renameSync;
      assert.throws(() => reviseChangeUnitContent(f.root, blueprintId, [revision(f.root), revision(f.root, 'ledger-report')]),
        error => error instanceof ChangeUnitCandidateRejected && error.code === 'change_unit_decomposition_write_failed');
    } finally { nodeFs.renameSync = rename; }
    assert.equal(writes, 2); unchanged(before);
    for (const file of f.cuFiles) assert(!fs.readdirSync(path.dirname(file)).some(name => name.includes('.candidate-')), 'temporary candidate leaked');
  } },
  { name: 'missing provider/provide, self dependency and two-CU dependency cycles reject atomically', run(f) {
    for (const [from_change_unit_id, provide_id] of [['missing-provider', 'missing-provide'], ['ledger-report', 'missing-provide']]) {
      reject(f, [revision(f.root, 'ledger-refresh', cu => { cu.requires.push({ require_id: 'missing', from_change_unit_id, provide_id }); })], /provider_missing|provide_mismatch/);
    }
    reject(f, [revision(f.root, 'ledger-refresh', cu => { cu.requires.push({ require_id: 'self', from_change_unit_id: cu.change_unit_id, provide_id: cu.provides[0].provide_id }); })], /self|自.*依赖|cycle|循环/);
    const a = revision(f.root); const b = revision(f.root, 'ledger-report');
    a.candidate.artifact.requires.push({ require_id: 'report', from_change_unit_id: 'ledger-report', provide_id: b.candidate.artifact.provides[0].provide_id });
    b.candidate.artifact.requires.push({ require_id: 'ledger', from_change_unit_id: 'ledger-refresh', provide_id: a.candidate.artifact.provides[0].provide_id });
    reject(f, [a, b], /cycle|依赖环/);
  } },
  { name: 'changed provide promise requires an actually revised consumer in the same batch and takes the consumer Feature lock', run(f) {
    addDependency(f);
    const provideChange = revision(f.root, 'ledger-refresh', cu => { cu.provides[0].description += ' 显式确认账户隔离与失败保留旧快照。'; });
    reject(f, [provideChange], /同批.*消费者|承诺变化/);
    reject(f, [provideChange, revision(f.root, 'ledger-report', () => {})], /同批.*消费者|承诺变化/);
    const lockPath = featureFilePath(f.root, f.reportFeature, path.join('goal-runs', FEATURE_LOCK_NAME)); const lock = tryAcquireLock(lockPath, { run_id: 'consumer-running' }); assert(lock);
    try {
      const before = bytes(files(f)); assert(reviseChangeUnitContent(f.root, blueprintId, [provideChange]).busy); unchanged(before);
    } finally { releaseLock(lockPath, lock.ownerId); }
    const consumer = revision(f.root, 'ledger-report', cu => { cu.target_predicates.find(row => row.role === 'consumer')!.description += ' 消费明确账户隔离的已提交账目。'; });
    const result = reviseChangeUnitContent(f.root, blueprintId, [provideChange, consumer]); assert.equal(result.revised.length, 2);
  } },
  { name: 'linked predicate promise changes require consumer revision even when the provides row itself stays unchanged', run(f) {
    addDependency(f);
    const linkedChange = revision(f.root, 'ledger-refresh', cu => { cu.target_predicates[0].description += ' 改变提供给消费者的可观察结果承诺。'; });
    const current = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, blueprintId, 'ledger-refresh').changeUnit);
    assert.deepStrictEqual(linkedChange.candidate.artifact.provides, current.provides);
    assert(linkedChange.candidate.artifact.target_predicates[0].provide_ids.includes(current.provides[0].provide_id));
    reject(f, [linkedChange], /承诺|消费者|provide/);
    reject(f, [linkedChange, revision(f.root, 'ledger-report', () => {})], /承诺|消费者|provide/);
    const consumer = revision(f.root, 'ledger-report', cu => { cu.target_predicates.find(row => row.role === 'consumer')!.description += ' 按当前提供承诺消费。'; });
    assert.equal(reviseChangeUnitContent(f.root, blueprintId, [linkedChange, consumer]).revised.length, 2);
  } },
  { name: 'a predicate linked only to an unconsumed internal provide can change without revising unrelated consumers', run(f) {
    addDependency(f);
    const internal = revision(f.root, 'ledger-refresh', cu => {
      cu.provides.push({ provide_id: 'ledger-local-detail', description: '本单元内部缓存细节，不由报表消费者认领。' });
      const owner = cu.target_predicates.find(row => row.role === 'owner')!;
      cu.target_predicates.push({ ...structuredClone(owner), predicate_id: 'internal-cache-detail', provide_ids: ['ledger-local-detail'], description: '内部缓存说明。' });
    });
    assert.equal(reviseChangeUnitContent(f.root, blueprintId, [internal]).revised.length, 1);
    const consumerBefore = fs.readFileSync(f.cuFiles[1]);
    const unrelated = revision(f.root, 'ledger-refresh', cu => { cu.target_predicates.find(row => row.predicate_id === 'internal-cache-detail')!.description += ' 细化本侧缓存清理职责。'; });
    assert.equal(reviseChangeUnitContent(f.root, blueprintId, [unrelated]).revised.length, 1);
    assert(fs.readFileSync(f.cuFiles[1]).equals(consumerBefore));
  } },
  { name: 'new provide id explicitly rewires consumers in the same atomic revision batch', run(f) {
    addDependency(f);
    const providerRevision = revision(f.root, 'ledger-refresh', cu => {
      const old = cu.provides[0].provide_id; cu.provides[0].provide_id = 'ledger-isolated-snapshot';
      for (const predicate of cu.target_predicates) predicate.provide_ids = predicate.provide_ids.map(id => id === old ? 'ledger-isolated-snapshot' : id);
    });
    reject(f, [providerRevision], /provide_mismatch|provider_missing/);
    const consumer = revision(f.root, 'ledger-report', cu => { cu.requires[0].provide_id = 'ledger-isolated-snapshot'; });
    const result = reviseChangeUnitContent(f.root, blueprintId, [providerRevision, consumer]); assert.equal(result.revised.length, 2);
    const required = asChangeUnitArtifact(loadCanonicalChangeUnit(f.root, blueprintId, 'ledger-report').changeUnit).requires[0]; assert.equal(required.provide_id, 'ledger-isolated-snapshot');
  } },
];

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = cases.map(test => {
    const f = createBlueprintReviewDesignFixture();
    try { clearFrameworkConfigCache(); test.run(f); return { name: test.name, ok: true }; }
    catch (error) { return { name: test.name, ok: false, error: (error as Error).stack }; }
    finally { clearFrameworkConfigCache(); fs.rmSync(f.root, { recursive: true, force: true }); }
  });
  const historical = loadHostSnapshot();
  const name = 'real historical completion cannot become unfinished through stale/broken/missing projections or a retained successful terminal';
  try {
    const loaded = loadCanonicalChangeUnit(historical.root, blueprintId, 'ledger-refresh'); const cu = asChangeUnitArtifact(loaded.changeUnit);
    assert.equal(observeChangeUnitCompletion(historical.root, cu).state, 'VALID');
    const oldCU = fs.readFileSync(loaded.canonicalPath);
    fs.appendFileSync(path.join(historical.root, 'src/ledger/LedgerFeature.ets'), '\n// isolated implementation change after completion\n');
    const expected = resolveChangeUnitExpectedExecution(historical.root, SNAPSHOT_CU_FEATURE);
    const assessment = assessFeature(historical.root, SNAPSHOT_CU_FEATURE, { ...expected, frameworkRoot: historical.frameworkRoot });
    assert.equal(assessment.record.state, 'ok'); assert(!assessment.complete);
    assert.equal(observeChangeUnitCompletion(historical.root, cu).state, 'INCOMPLETE');
    assert.throws(() => reviseChangeUnitContent(historical.root, blueprintId, [revision(historical.root)]), /成功终局|不能按未完成/);
    const projection = featureFilePath(historical.root, SNAPSHOT_CU_FEATURE, 'feature-completion.json'); fs.writeFileSync(projection, '{broken');
    assert.throws(() => reviseChangeUnitContent(historical.root, blueprintId, [revision(historical.root)]), /成功终局|不能按未完成/);
    fs.rmSync(projection); assert.equal(observeChangeUnitCompletion(historical.root, cu).state, 'INVALID');
    assert.throws(() => reviseChangeUnitContent(historical.root, blueprintId, [revision(historical.root)]), /成功终局/);
    assert(fs.readFileSync(loaded.canonicalPath).equals(oldCU)); results.push({ name, ok: true });
  } catch (error) { results.push({ name, ok: false, error: (error as Error).stack }); }
  finally { clearFrameworkConfigCache(); fs.rmSync(historical.root, { recursive: true, force: true }); }
  const resumed = loadHostSnapshot();
  const resumedName = 'a real successful run resumed to HALTED cannot become unfinished when only its Feature projection is missing';
  try {
    const projectionFile = featureFilePath(resumed.root, SNAPSHOT_CU_FEATURE, 'feature-completion.json');
    const projection = JSON.parse(fs.readFileSync(projectionFile, 'utf8'));
    const originalFile = path.resolve(resumed.root, projection.original_path); const original = fs.readFileSync(originalFile);
    const record = JSON.parse(original.toString('utf8'));
    const eventsFile = featureFilePath(resumed.root, SNAPSHOT_CU_FEATURE, `goal-runs/${record.run_id}/events.jsonl`);
    fs.appendFileSync(eventsFile, [{ type: 'run_start', run_id: record.run_id, ts: '2026-10-11T00:00:00Z' },
      { type: 'run_end', run_id: record.run_id, status: 'HALTED', ts: '2026-10-11T00:01:00Z' }].map(event => JSON.stringify(event) + '\n').join(''));
    fs.rmSync(projectionFile);
    const row = revision(resumed.root); row.candidate.providerId = row.candidate.artifact.provenance.extraction_method;
    const cuFile = loadCanonicalChangeUnit(resumed.root, blueprintId, 'ledger-refresh').canonicalPath;
    const preserved = bytes([cuFile, originalFile, path.join(path.dirname(originalFile), 'manifest.json'), eventsFile]);
    assert.throws(() => reviseChangeUnitContent(resumed.root, blueprintId, [row]), /成功|完成|历史/);
    assert.notEqual(observeChangeUnitCompletion(resumed.root, asChangeUnitArtifact(loadCanonicalChangeUnit(resumed.root, blueprintId, 'ledger-refresh').changeUnit)).state, 'ABSENT');
    unchanged(preserved); assert(fs.readFileSync(originalFile).equals(original)); assert(!fs.existsSync(projectionFile));
    results.push({ name: resumedName, ok: true });
  } catch (error) { results.push({ name: resumedName, ok: false, error: (error as Error).stack }); }
  finally { clearFrameworkConfigCache(); fs.rmSync(resumed.root, { recursive: true, force: true }); }
  return results;
}
