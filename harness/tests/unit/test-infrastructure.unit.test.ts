import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { buildImpactPlan, changedInputs, GroupFootprint, includeAdditionalGroups, InputSnapshot, registryFingerprint, snapshotTestInputs, TestGroup, TestRunState, updateTestState } from '../utils/test-impact';
import { execFileSync, spawnSync } from 'child_process';
import { assertFunctionDependencies, buildTestDependencyGraph, inferTestLayer, REPO_ROOT } from '../utils/test-dependency-graph';
import { guardFunctionProcesses, observeTestInputs } from '../utils/test-input-observer';
import { mergeGroupCoverage } from '../utils/test-coverage';
import { exactCaseSelector, matchesUnitCase } from '../utils/unit-case-selection';
import { groupTimingHints, mergeOverlappingGroups, readExecutionTimingResults } from '../utils/unit-case-groups';
import { orderSuiteTasks, runSuiteProcesses, UnitWorkerResult } from '../utils/unit-suite-processes';
import type { UnitCaseResult } from '../run-unit';
import { testPollInterval } from '../utils/runtime-test-control';

const cases: Array<{ name: string; run(): void | Promise<void> }> = [];
const pass = (id: string): UnitWorkerResult => ({ id, ok: true, status: 'completed', results: [{ name: id, ok: true }], loadMs: 0, executionMs: 1, startupMs: 0, totalMs: 1 });
const footprint = (extra: Partial<GroupFootprint> = {}): GroupFootprint => ({ executed: [], files: [], directories: [], executionComplete: true, readsComplete: true, reasons: [], coverageBytes: 0, coveragePeakBytes: 0, mergeMs: 0, ...extra });
async function temporary(run: (root: string) => void | Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'test-infra-'));
  try { await run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function setup(root: string) {
  fs.mkdirSync(path.join(root, 'harness/tests/unit'), { recursive: true });
  fs.mkdirSync(path.join(root, 'harness/scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'harness/tests/unit/a.unit.test.ts'), "import '../../scripts/a';\n");
  fs.writeFileSync(path.join(root, 'harness/scripts/a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(root, 'harness/scripts/b.ts'), 'export const b = 1;\n');
  const before: InputSnapshot = { head: 'same', id: 'before', files: { 'harness/tests/unit/a.unit.test.ts': 'test1', 'harness/scripts/a.ts': 'a1', 'harness/scripts/b.ts': 'b1', 'docs/runbook.md': 'd1' } };
  const groups: TestGroup[] = [
    { id: 'function', suiteId: 'function', modulePath: path.join(root, 'harness/tests/unit/a.unit.test.ts'), layer: 'function' },
    ...['cap-a', 'cap-b', 'unknown', 'text-only', 'old-red'].map(id => ({ id, suiteId: id, modulePath: path.join(root, `harness/tests/unit/${id}.unit.test.ts`), layer: 'capability' as const })),
  ];
  const state: TestRunState = { version: 1, registry: registryFingerprint(groups, root), snapshots: { before }, graph: buildTestDependencyGraph(Object.keys(before.files), root), groups: {} };
  for (const group of groups) state.groups[group.id] = { result: pass(group.id), snapshotId: 'before', modulePath: path.relative(root, group.modulePath).replace(/\\/g, '/'), layer: group.layer, footprint: footprint({ executed: group.id === 'cap-a' ? ['harness/scripts/a.ts'] : [] }) };
  state.groups['unknown'].footprint = footprint({ executionComplete: false, reasons: ['killed descendant'] });
  state.groups['text-only'].footprint = footprint({ files: ['harness/scripts/a.ts', 'docs/runbook.md'], directories: ['.cursor/plans'] });
  state.groups['old-red'].result.ok = false;
  return { before, groups, state };
}
cases.push({ name: 'impact: both layers include imports, executed source and text-only source reads; unknown and old red stay local', run: () => temporary(root => {
  const { before, groups, state } = setup(root);
  const after = { ...before, id: 'after', files: { ...before.files, 'harness/scripts/a.ts': 'a2' } };
  const plan = buildImpactPlan(groups, after, state, root);
  assert.deepStrictEqual(plan.selected.map(row => row.group.id), ['function', 'cap-a', 'unknown', 'text-only', 'old-red']);
  assert(plan.reused.includes('cap-b')); assert(plan.typecheck);
}) });
cases.push({ name: 'impact: document reads, directory membership, unknown reads and no blanket plan exemption', run: () => temporary(root => {
  const { before, groups, state } = setup(root);
  state.groups.unknown.footprint = footprint({ readsComplete: false });
  const doc = { ...before, id: 'doc', files: { ...before.files, 'docs/runbook.md': 'd2' } };
  assert.deepStrictEqual(buildImpactPlan(groups, doc, state, root).selected.map(row => row.group.id), ['cap-a', 'cap-b', 'unknown', 'text-only', 'old-red']);
  const addedPlan = { ...before, id: 'added', files: { ...before.files, '.cursor/plans/new.plan.md': 'p' } };
  assert.deepStrictEqual(buildImpactPlan(groups, addedPlan, state, root).selected.map(row => row.group.id), ['cap-a', 'cap-b', 'unknown', 'text-only', 'old-red']);
  const unexplained = { ...before, files: { ...before.files, 'unrecognized.md': 'new' } };
  assert.equal(buildImpactPlan(groups, unexplained, state, root).selected.length, groups.filter(group => group.layer === 'capability').length);
}) });
cases.push({ name: 'impact: proved development-rule contents can be exempt, while membership, readers and old failures remain required', run: () => temporary(root => {
  const {before, groups, state} = setup(root);
  const file = '.cursor/rules/plan-execution.mdc';
  fs.mkdirSync(path.join(root, '.cursor/rules'), {recursive: true});
  fs.writeFileSync(path.join(root, file), 'approved development instructions\n');
  before.files[file] = 'old contents';
  state.groups['text-only'].footprint = footprint({directories: ['.cursor/rules']});
  state.groups['old-red'].result.ok = true;
  const after = {...before, id: 'content-only', files: {...before.files, [file]: 'new contents'}};
  const pure = buildImpactPlan(groups, after, state, root);
  assert.equal(pure.selected.length, 0); assert.equal(pure.typecheck, false);
  assert(pure.exempt.some(item => item.file === file && item.reason.includes('names/counts')));
  const deleted: InputSnapshot = {...after, files: {...after.files}}; delete deleted.files[file];
  assert(buildImpactPlan(groups, deleted, state, root).selected.some(item => item.group.id === 'text-only'));
  const renamed = {...deleted, files: {...deleted.files, '.cursor/rules/renamed.mdc': 'new contents'}};
  assert(buildImpactPlan(groups, renamed, state, root).selected.some(item => item.group.id === 'text-only'));
  delete before.files[file];
  const added = buildImpactPlan(groups, after, state, root);
  assert(!added.exempt.length && added.selected.some(item => item.group.id === 'text-only'));
  before.files[file] = 'old contents';
  state.groups['cap-a'].footprint!.files.push(file);
  const read = buildImpactPlan(groups, after, state, root);
  assert.equal(read.exempt.length, 0); assert(read.selected.some(item => item.group.id === 'cap-a' && item.reasons.includes('file-read: ' + file)));
  state.groups['cap-a'].footprint!.files = [];
  state.groups['cap-b'].footprint!.executed.push(file);
  assert.equal(buildImpactPlan(groups, after, state, root).exempt.length, 0);
  state.groups['cap-b'].footprint!.executed = [];
  state.groups['old-red'].result.ok = false;
  assert.deepEqual(buildImpactPlan(groups, after, state, root).selected.map(item => item.group.id), ['old-red']);
}) });
cases.push({ name: 'impact: additions, deletion/rename endpoints, local imports and local test invalidation', run: () => temporary(root => {
  const { before, groups, state } = setup(root);
  fs.writeFileSync(path.join(root, 'harness/scripts/a.ts'), "import './b'; export const a = 2;\n");
  const after = { ...before, files: { ...before.files, 'harness/scripts/a.ts': 'a2', 'harness/scripts/b.ts': 'b2' } };
  const plan = buildImpactPlan(groups, after, state, root);
  assert(plan.selected.find(row => row.group.id === 'cap-a')!.reasons.some(reason => reason.startsWith('new import edge:')));
  assert(plan.reused.includes('cap-b')); assert.equal(plan.full, false);
  const deleted = { ...before, files: { ...before.files } }; delete deleted.files['harness/scripts/a.ts'];
  fs.unlinkSync(path.join(root, 'harness/scripts/a.ts'));
  assert(buildImpactPlan(groups, deleted, state, root).selected.some(row => row.group.id === 'function'));
  const renamed = { ...deleted, files: { ...deleted.files, 'harness/scripts/new.ts': 'a1' } };
  assert.deepStrictEqual(changedInputs(before, renamed), ['harness/scripts/a.ts', 'harness/scripts/new.ts']);
  assert(buildImpactPlan(groups, renamed, state, root).selected.some(row => row.group.id === 'cap-b'));
  const testChanged = { ...before, files: { ...before.files, 'harness/tests/unit/a.unit.test.ts': 'test2' } };
  const onlyTest = buildImpactPlan(groups, testChanged, state, root);
  assert.deepStrictEqual(onlyTest.selected.map(row => row.group.id), ['function', 'old-red']);
}) });
cases.push({ name: 'facts: partial green advances independently, old red remains mandatory and drift never advances passing bytes', run: () => temporary(root => {
  const { before, groups, state } = setup(root);
  const current = { ...before, id: 'current', files: { ...before.files, 'harness/scripts/a.ts': 'a2' } };
  const result = { ...pass('cap-a'), footprint: footprint({ executed: ['harness/scripts/a.ts'] }) };
  const updated = updateTestState(groups, current, current, [result], state, false, root);
  const next = buildImpactPlan(groups, current, updated, root);
  assert(next.reused.includes('cap-a')); assert(next.selected.some(row => row.group.id === 'old-red'));
  const drift = { ...current, id: 'drift', files: { ...current.files, 'harness/scripts/a.ts': 'a3', 'docs/new.md': 'new' } };
  const drifted = updateTestState(groups, current, drift, [result], updated, false, root);
  assert.equal(drifted.groups['cap-a'].result.ok, false);
  assert.equal(drifted.groups['cap-a'].snapshotId, 'current');
}) });
cases.push({ name: 'groups: exact display names, overlap multiplicity and no-timing groups never disappear', run() {
  const selector = exactCaseSelector(['same']);
  assert(matchesUnitCase('same', selector)); assert(!matchesUnitCase('same suffix', selector));
  assert.deepStrictEqual(mergeOverlappingGroups([{ caseNames: ['a', 'a'] }, { caseNames: ['b'] }]).map(group => group.caseNames), [['a', 'a'], ['b']]);
  const tasks = ['a', 'b', 'c'].map(id => ({ id, modulePath: id }));
  assert.deepStrictEqual(orderSuiteTasks(tasks, { a: 1, b: 10 }).map(task => task.id), ['c', 'b', 'a']);
} });
cases.push({ name: 'timings: old full execution blocks feed group priority without producing passing facts', run: () => temporary(root => {
  const file = path.join(root, 'old-full.json');
  fs.writeFileSync(file, JSON.stringify({ groups: [{ id: 'suite', totalMs: 100, executionTimings: [{ caseNames: ['fast'], durationMs: 1 }, { caseNames: ['slow'], durationMs: 80 }] }] }));
  const groups: TestGroup[] = ['fast', 'slow'].map(name => ({ id: `suite:${name}`, suiteId: 'suite', modulePath: 'unused', layer: 'capability', caseNames: [name] }));
  const hints = groupTimingHints(groups, readExecutionTimingResults(file), {});
  assert.deepStrictEqual(orderSuiteTasks(groups, hints).map(group => group.id), ['suite:slow', 'suite:fast']);
  assert.deepStrictEqual(readExecutionTimingResults(path.join(root, 'missing.json')), []);
}) });
cases.push({ name: 'pacing: only test polling is configurable; missing value keeps the old default and zero is rejected', run() {
  const prior = process.env.MAISON_TEST_POLL_MS;
  try {
    delete process.env.MAISON_TEST_POLL_MS; assert.equal(testPollInterval(), 25);
    process.env.MAISON_TEST_POLL_MS = '10'; assert.equal(testPollInterval(), 10);
    process.env.MAISON_TEST_POLL_MS = '0'; assert.throws(() => testPollInterval(), /positive finite/);
  } finally { if (prior === undefined) delete process.env.MAISON_TEST_POLL_MS; else process.env.MAISON_TEST_POLL_MS = prior; }
} });
cases.push({ name: 'full entry: --plan-only cannot turn npm test into a zero-test success', run() {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../compiled-entry.cjs'), path.resolve(__dirname, '../run-test-plan.ts'), '--full', '--plan-only'], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30_000, env: { ...process.env } });
  assert.equal(result.status, 1); assert((result.stdout + result.stderr).includes('完整全量不支持 --plan-only'));
} });
cases.push({ name: 'inputs: committed, staged, unstaged and untracked bytes are captured, including rename endpoints', run: () => temporary(root => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q'); fs.writeFileSync(path.join(root, 'tracked.md'), 'before'); git('add', '.'); git('-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base');
  const before = snapshotTestInputs(root);
  fs.writeFileSync(path.join(root, 'tracked.md'), 'staged'); git('add', '.'); fs.writeFileSync(path.join(root, 'tracked.md'), 'unstaged'); fs.writeFileSync(path.join(root, 'untracked.md'), 'new');
  const after = snapshotTestInputs(root);
  assert.deepStrictEqual(changedInputs(before, after), ['tracked.md', 'untracked.md']);
  git('mv', '-f', 'tracked.md', 'renamed.md');
  assert.deepStrictEqual(changedInputs(before, snapshotTestInputs(root)), ['renamed.md', 'tracked.md', 'untracked.md']);
}) });
cases.push({ name: 'inputs: ignored root and harness dependency locks remain tested inputs and require typecheck/all capabilities', run: () => temporary(root => {
  const { groups, state } = setup(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q'); fs.writeFileSync(path.join(root, '.gitignore'), '**/package-lock.json\npackage-lock.json\n');
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{"version":1}');
  fs.writeFileSync(path.join(root, 'harness/package-lock.json'), '{"version":1}');
  git('add', '.'); git('-c', 'user.name=F', '-c', 'user.email=f@e.test', 'commit', '-qm', 'base');
  const before = snapshotTestInputs(root);
  assert(before.files['package-lock.json'] && before.files['harness/package-lock.json']);
  state.snapshots = { [before.id]: before }; Object.values(state.groups).forEach(fact => { fact.snapshotId = before.id; });
  fs.writeFileSync(path.join(root, 'harness/package-lock.json'), '{"version":2}');
  const after = snapshotTestInputs(root);
  assert.deepStrictEqual(changedInputs(before, after), ['harness/package-lock.json']);
  const plan = buildImpactPlan(groups, after, state, root);
  assert(plan.typecheck); assert(groups.filter(group => group.layer === 'capability').every(group => plan.selected.some(item => item.group.id === group.id)));
}) });
cases.push({ name: 'plans: independent fixture and release-only selection retain mandatory groups; additions cannot subtract', run: () => temporary(root => {
  const { before, groups, state } = setup(root);
  const fixture: TestGroup = { id: 'fixture:sample', suiteId: 'fixture:sample', modulePath: path.join(root, 'harness/tests/fixtures/sample'), layer: 'capability', kind: 'fixture' };
  const release: TestGroup = { id: 'release', suiteId: 'release', modulePath: path.join(root, 'harness/tests/unit/release.unit.test.ts'), layer: 'capability', releaseOnly: true };
  groups.push(fixture, release); state.registry = registryFingerprint(groups, root);
  state.groups[fixture.id] = { result: pass(fixture.id), snapshotId: 'before', modulePath: 'harness/tests/fixtures/sample', layer: 'capability', footprint: footprint() };
  state.groups.release = { result: pass('release'), snapshotId: 'before', modulePath: 'harness/tests/unit/release.unit.test.ts', layer: 'capability', footprint: footprint({ files: ['docs/runbook.md'] }) };
  const after = { ...before, files: { ...before.files, 'harness/tests/fixtures/sample/EXPECTED.json': 'new' } };
  const plan = buildImpactPlan(groups, after, state, root);
  assert.deepStrictEqual(plan.selected.map(row => row.group.id), ['old-red', 'fixture:sample']);
  includeAdditionalGroups(plan, groups, ['release']);
  assert.deepStrictEqual(plan.selected.map(row => row.group.id), ['old-red', 'fixture:sample', 'release']);
  const docs = buildImpactPlan(groups, { ...before, files: { ...before.files, 'docs/runbook.md': 'new' } }, state, root);
  assert(docs.selected.some(row => row.group.id === 'release' && row.group.releaseOnly));
}) });
cases.push({ name: 'function: goal dependency and all native child process variants are mechanically rejected', run: () => temporary(root => {
  fs.writeFileSync(path.join(root, 'entry.ts'), 'export const goalMain = () => {}; goalMain();\n');
  const graph = buildTestDependencyGraph(['entry.ts'], root);
  assert.equal(inferTestLayer(graph, 'entry.ts'), 'capability');
  assert.throws(() => assertFunctionDependencies(graph, 'entry.ts'), /goal entry/);
  const restore = guardFunctionProcesses();
  try { for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) assert.throws(() => require('child_process')[name]('unused'), /function suite cannot/); }
  finally { restore(); }
}) });
cases.push({ name: 'reads: sync, callback, promises, streams, failed paths and directory queries are recorded before module loading', run: () => temporary(async root => {
  const file = path.join(root, 'read.md'); fs.writeFileSync(file, 'input');
  const observer = observeTestInputs();
  let reads;
  try {
    fs.readFileSync(file); fs.existsSync(path.join(root, 'missing.md')); fs.statSync(file); fs.readdirSync(root);
    await fs.promises.readFile(file); await new Promise<void>((resolve, reject) => fs.readFile(file, error => error ? reject(error) : resolve()));
    await new Promise<void>((resolve, reject) => fs.createReadStream(file).on('data', () => undefined).once('end', resolve).once('error', reject));
  } finally { reads = observer.finish(); }
  assert(reads.complete); assert(reads.files.includes(file)); assert(reads.files.includes(path.join(root, 'missing.md'))); assert(reads.directories.includes(root));
}) });
cases.push({ name: 'coverage: a missing descendant invalidates one group, source aliases normalize and raw reports are promptly removed', run: () => temporary(root => {
  const source = path.join(REPO_ROOT, 'harness/scripts/a.ts');
  const copy = path.join(root, 'copy/a.ts');
  fs.writeFileSync(path.join(root, 'coverage-123-1-0.json'), JSON.stringify({ result: [{ url: pathToFileURL(copy).href }] }));
  const result = mergeGroupCoverage(root, 123, { files: [], directories: [], complete: true, reasons: [], expectedPids: [456], aliases: [[copy, source]] });
  assert.deepStrictEqual(result.executed, ['harness/scripts/a.ts']); assert.equal(result.executionComplete, false); assert(result.reasons.some(reason => reason.includes('456'))); assert.equal(fs.readdirSync(root).length, 0);
  fs.writeFileSync(path.join(root, 'coverage-123-2-0.json'), JSON.stringify({ result: [] }));
  const probe = path.join(root, 'missing-hvigorfile.ts');
  const queried = mergeGroupCoverage(root, 123, { files: [probe], directories: [], complete: true, reasons: [] });
  assert(queried.executionComplete, 'an external file query is not an executed unmapped script');
  fs.writeFileSync(path.join(root, 'coverage-123-3-0.json'), JSON.stringify({ result: [{ url: pathToFileURL(probe).href }] }));
  const executed = mergeGroupCoverage(root, 123, { files: [], directories: [], complete: true, reasons: [] });
  assert.equal(executed.executionComplete, false); assert(executed.reasons.some(reason => reason.includes(probe)), 'actual external execution stays unknown with its path');
}) });
cases.push({ name: 'review regressions: normal guardian coverage stays complete, prompt runtime inputs select every capability, group identity changes stay local', run: () => temporary(root => {
  const source = path.join(REPO_ROOT, 'harness/scripts/example.ts');
  fs.writeFileSync(path.join(root, 'coverage-123-1-0.json'), JSON.stringify({ result: [] }));
  fs.writeFileSync(path.join(root, 'coverage-456-1-0.json'), JSON.stringify({ result: [{ url: pathToFileURL(source).href }] }));
  const normal = mergeGroupCoverage(root, 123, { files: [], directories: [], complete: true, reasons: [], nodeLaunches: [{ entry: source, exited: true, code: 0 }] });
  assert(normal.executionComplete, normal.reasons.join(';'));
  const { before, groups, state } = setup(root);
  for (const file of ['harness/prompts/verify-review.md', 'profiles/hmos-app/harness/prompts/verify-review.overlay.md']) {
    const after = { ...before, files: { ...before.files, [file]: 'new' } };
    const plan = buildImpactPlan(groups, after, state, root);
    assert(groups.filter(group => group.layer === 'capability').every(group => plan.selected.some(row => row.group.id === group.id)));
  }
  const unchanged = registryFingerprint(groups, root);
  const added = { ...groups[1], id: 'new-case', caseNames: ['new case'] }; groups.push(added);
  assert.equal(registryFingerprint(groups, root), unchanged);
  const plan = buildImpactPlan(groups, before, state, root);
  assert.equal(plan.full, false); assert(plan.reused.includes('cap-a')); assert(plan.selected.some(row => row.group.id === 'new-case'));
  groups[1] = { ...groups[1], modulePath: path.join(root, 'harness/tests/unit/moved.unit.test.ts') };
  const moved = buildImpactPlan(groups, before, state, root);
  assert(moved.selected.some(row => row.group.id === 'cap-a' && row.reasons.includes('group module path or layer changed'))); assert(moved.reused.includes('cap-b'));
}) });
cases.push({ name: 'scheduler: explicit shared resources serialize; enumeration does not execute; an exact group excludes substring neighbours', run: () => temporary(async root => {
  const log = path.join(root, 'order.log');
  const module = path.join(root, 'module.js');
  fs.writeFileSync(module, `exports.runAll=async()=>{const fs=require('fs');fs.appendFileSync(${JSON.stringify(log)},'start\\n');await new Promise(r=>setTimeout(r,30));fs.appendFileSync(${JSON.stringify(log)},'end\\n');return[{name:'case',ok:true}]};`);
  const tasks = ['one', 'two'].map(id => ({ id, modulePath: module, serialResources: ['fixed-output'] }));
  const results = await runSuiteProcesses(tasks, 2, {});
  assert(results.every(result => result.ok)); assert.equal(fs.readFileSync(log, 'utf8'), 'start\nend\nstart\nend\n');
  const enumeration = path.join(root, 'enumeration.js');
  fs.writeFileSync(enumeration, "exports.listCaseGroups=()=>[{caseNames:['one']}];exports.runAll=()=>{throw Error('must not execute')};");
  const listed = await runSuiteProcesses([{ id: 'enum', modulePath: enumeration, enumerate: true }], 1, {});
  assert(listed[0].ok); assert.deepStrictEqual(listed[0].caseGroups, [{ caseNames: ['one'] }]);
}) });
cases.push({ name: 'guardian: a real normal Windows Node descendant has complete coverage and no test preload', async run() {
  if (process.platform !== 'win32') return;
  const [result] = await runSuiteProcesses([{ id: 'normal-guardian', modulePath: path.resolve(__dirname, '../utils/guardian-coverage-probe.ts'), layer: 'capability', collect: true }], 1, {});
  assert(result.ok, result.error); assert(result.footprint?.executionComplete, result.footprint?.reasons.join('; '));
} });

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) try { await test.run(); results.push({ name: test.name, ok: true }); }
  catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack }); }
  return results;
}
