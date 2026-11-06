import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import * as YAML from 'yaml';
import { clearFrameworkConfigCache } from '../../config';
import { prepareSessionCliProject } from '../utils/session-cli-project';
import { adaptNative, runGoal } from './session-transport-parity.unit.test';
import { preserveRuntimeTestEvidence } from '../utils/runtime-test-control';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, unitCaseGroups, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'clamp', RUN = 'session-cli', CHAIN = ['coding', 'review', 'ut'];
const featureDir = 'doc/features/clamp', runDir = `${featureDir}/goal-runs/${RUN}`;
const readJson = (root: string, file: string): any => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const copied = (root: string, file: string): any => require(path.join(root, 'framework/harness', file));
const originals = (root: string): string[] => [
  'src/math/src/main/clamp.ts', 'src/math/src/test/clamp.test.ts', `${featureDir}/acceptance.yaml`, `${featureDir}/contracts.yaml`,
  `${featureDir}/execution-scope.json`, `${featureDir}/feature-completion.json`, `${runDir}/feature-completion.json`,
  ...CHAIN.flatMap(phase => [`${featureDir}/${phase}/reports/summary.json`, `${featureDir}/${phase}/reports/script-report.json`, `${featureDir}/${phase}/reports/phase-evidence-manifest.json`]),
  `${featureDir}/ut/reports/node-tests.tap`,
].map(file => path.join(root, file));

async function currentCompletion(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-current-')), root = path.join(directory, 'host');
  const previousTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  try {
    prepareSessionCliProject(root, 'claude', true, false); adaptNative(root);
    await runGoal(root, 'session', 'normal');
    const assessment = () => copied(root, 'scripts/utils/feature-assessment').assessFeature(root, FEATURE, {
      expectedChain: CHAIN, expectedTrack: 'full', frameworkRoot: path.join(root, 'framework'),
    });
    const first = assessment(); assert.equal(first.complete, true, JSON.stringify(first));
    assert.equal(first.record.state, 'ok');
    assert.match(fs.readFileSync(path.join(root, `${featureDir}/ut/reports/node-tests.tap`), 'utf8'), /# fail 0/);
    const events = fs.readFileSync(path.join(root, `${runDir}/events.jsonl`), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert(events.some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'));
    const saved = preserveRuntimeTestEvidence([root], 'real current Node completion before lifecycle negative branches', [], originals(root));
    fs.writeFileSync(path.join(saved, 'assessment.json'), JSON.stringify(first, null, 2) + '\n');
    console.log('LIFECYCLE_CURRENT_ORIGINALS=' + saved);

    // Each branch mutates only its sandbox input, then restores the original production bytes.
    const manifest = readJson(root, `${runDir}/manifest.json`);
    const creation = copied(root, 'scripts/utils/goal-run-creation');
    const scope = creation.loadFrozenExecutionScope(root, FEATURE, RUN);
    assert(scope && scope.phase_chain.length > 0, 'the real signed birth scope retains its original native responsibilities');
    const laterId = 'later-unfinished';
    const later = copied(root, 'scripts/utils/goal-manifest').buildGoalManifestFromInput({
      feature: FEATURE, run_id: laterId, adapter: manifest.adapter, requirement: manifest.requirement,
      requirement_source_files: manifest.requirement_source_files, unattended: manifest.unattended,
      execution_scope: scope, chain_override: scope.phase_chain, start_phase: scope.phase_chain[0], end_phase: scope.phase_chain.at(-1),
    }, { projectRoot: root });
    creation.createGoalRun({ projectRoot: root, manifest: later, chain: scope.phase_chain });
    const blocked = assessment();
    assert.equal(blocked.complete, false); assert.equal(blocked.record.state, 'ok');
    assert(blocked.blocking.some((reason: string) => reason.includes(laterId)));
    assert.equal(blocked.obligations.filter((row: any) => row.status === 'uncovered').length, 0, 'unfinished later run must not invent a phase repair');
    const laterDir = path.join(root, later.report_dir);
    assert(path.resolve(laterDir).startsWith(path.resolve(root) + path.sep)); fs.rmSync(laterDir, { recursive: true, force: true });
    assert.equal(assessment().complete, true);

    const projectionFile = path.join(root, `${featureDir}/feature-completion.json`), projectionBytes = fs.readFileSync(projectionFile);
    const projection = JSON.parse(projectionBytes.toString('utf8'));
    const completionFile = path.join(root, projection.original_path), completionBytes = fs.readFileSync(completionFile);
    const invalid = JSON.parse(completionBytes.toString('utf8')); invalid.phases[0].run_id = 'forged-other-run';
    const invalidBytes = JSON.stringify(invalid); fs.writeFileSync(completionFile, invalidBytes);
    fs.writeFileSync(projectionFile, JSON.stringify({ ...projection, original_sha256: createHash('sha256').update(invalidBytes).digest('hex') }));
    assert.equal(assessment().record.state, 'broken'); assert.equal(assessment().complete, false);
    fs.writeFileSync(completionFile, completionBytes); fs.writeFileSync(projectionFile, projectionBytes);
    assert.equal(assessment().complete, true);

    const evidenceFile = path.join(root, `${featureDir}/ut/reports/phase-evidence-manifest.json`), evidenceBytes = fs.readFileSync(evidenceFile);
    fs.rmSync(evidenceFile);
    const missing = assessment(); assert.equal(missing.complete, false);
    assert(missing.obligations.some((row: any) => row.owner_phase === 'ut' && row.status === 'uncovered'));
    fs.writeFileSync(evidenceFile, evidenceBytes); assert.equal(assessment().complete, true);

    const sourceFile = path.join(root, 'src/math/src/main/clamp.ts'), sourceBytes = fs.readFileSync(sourceFile);
    fs.appendFileSync(sourceFile, '\nexport const newUnverifiedProduct = 1;\n');
    assert.equal(assessment().complete, false, 'unverified product changes cannot borrow previous completion');
    fs.writeFileSync(sourceFile, sourceBytes); assert.equal(assessment().complete, true);
    const acceptanceFile = path.join(root, `${featureDir}/acceptance.yaml`), acceptanceBytes = fs.readFileSync(acceptanceFile);
    const acceptance = YAML.parse(acceptanceBytes.toString('utf8'));
    acceptance.criteria.push({ ...acceptance.criteria[0], id: 'AC-NEW', description: 'new approved boundary', expected_result: 'new boundary must be verified' });
    fs.writeFileSync(acceptanceFile, YAML.stringify(acceptance));
    const extraTest = path.join(root, 'src/math/src/test/new-unexecuted.test.ts');
    fs.writeFileSync(extraTest, "import { it } from 'node:test'; it('new unexecuted acceptance', () => { throw new Error('not executed'); });\n");
    assert.equal(assessment().complete, false, 'new unexecuted tests cannot borrow old UT evidence');
    fs.rmSync(extraTest); fs.writeFileSync(acceptanceFile, acceptanceBytes); assert.equal(assessment().complete, true);
  } catch (error) {
    const saved = preserveRuntimeTestEvidence([root], String(error), [], originals(root));
    throw new Error(`${error instanceof Error ? error.stack : String(error)}\noriginals: ${saved}`);
  } finally {
    clearFrameworkConfigCache();
    for (const file of Object.keys(require.cache)) if (file.startsWith(root + path.sep)) delete require.cache[file];
    if (previousTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousTrust;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir())); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

const cases = [{ name: 'daily current completion: real Node delivery and shared unfinished-run, record and evidence guards', run: currentCompletion }];
export const getCases = () => cases;
export const listCaseGroups = () => unitCaseGroups(cases.map(test => test.name)).map(group => ({ ...group, releaseOnly: true }));
export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) {
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
