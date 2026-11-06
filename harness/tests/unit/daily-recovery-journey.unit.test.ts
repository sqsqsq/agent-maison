import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearFrameworkConfigCache } from '../../config';
import { prepareSessionCliProject } from '../utils/session-cli-project';
import { adaptNative, runGoal } from './session-transport-parity.unit.test';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, unitCaseGroups, type UnitExecutionTiming } from '../utils/unit-case-selection';
import { preserveRuntimeTestEvidence } from '../utils/runtime-test-control';
import type { UnitCaseResult } from '../run-unit';

// Only the external model/transport is controlled; native checks and completion remain production consumers.
const FEATURE = 'clamp', RUN = 'session-cli';
const moduleAt = (root: string, file: string): any => require(path.join(root, 'framework/harness', file));
const read = (root: string, file: string): string => fs.readFileSync(path.join(root, file), 'utf8');
const json = (root: string, file: string): any => JSON.parse(read(root, file));
const runPath = `doc/features/${FEATURE}/goal-runs/${RUN}`;
const events = (root: string): any[] => read(root, `${runPath}/events.jsonl`).split('\n').filter(Boolean).map(line => JSON.parse(line));
const evidenceFiles = (root: string): string[] => ['src/math/src/main/clamp.ts', 'src/math/src/test/clamp.test.ts', `${runPath}/feature-completion.json`,
  ...['coding', 'review', 'ut'].flatMap(phase => [`doc/features/${FEATURE}/${phase}/reports/summary.json`, `doc/features/${FEATURE}/${phase}/reports/script-report.json`]),
  `doc/features/${FEATURE}/ut/reports/node-tests.tap`, `doc/features/${FEATURE}/ut/reports/native-failure.tap`,
  `doc/features/${FEATURE}/coding/reports/native-compile-failure.json`].map(file => path.join(root, file));

async function withProject(run: (root: string) => Promise<void>, codingOnly = false): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-node-recovery-'));
  const root = path.join(directory, 'host');
  const previousTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  try {
    prepareSessionCliProject(root, 'claude', true, codingOnly ? 'coding' : false);
    adaptNative(root);
    await run(root);
  } catch (error) {
    const originals = preserveRuntimeTestEvidence([root], String(error), [], evidenceFiles(root));
    throw new Error(`${error instanceof Error ? error.stack : String(error)}\noriginals: ${originals}`);
  } finally {
    clearFrameworkConfigCache();
    for (const file of Object.keys(require.cache)) if (file.startsWith(root + path.sep)) delete require.cache[file];
    if (previousTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR;
    else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousTrust;
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

function assertCompleted(root: string): void {
  const assessment = moduleAt(root, 'scripts/utils/feature-assessment').assessFeature(root, FEATURE, {
    expectedChain: ['coding', 'review', 'ut'], expectedTrack: 'full', frameworkRoot: path.join(root, 'framework'),
  });
  assert.equal(assessment.complete, true, JSON.stringify(assessment));
  assert(fs.existsSync(path.join(root, runPath, 'feature-completion.json')));
  assert(events(root).some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'));
  assert.match(read(root, `doc/features/${FEATURE}/ut/reports/node-tests.tap`), /# tests 3/);
  assert.match(read(root, `doc/features/${FEATURE}/ut/reports/node-tests.tap`), /# fail 0/);
}

function assertRequestCompleted(root: string): void {
  const manifest = json(root, `${runPath}/manifest.json`);
  assert.equal(manifest.execution_scope.completion_target, 'request');
  assert.deepEqual(manifest.execution_scope.phase_chain, ['coding']);
  assert(events(root).some(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED'));
  const summary = json(root, `doc/features/${FEATURE}/coding/reports/summary.json`);
  assert.equal(summary.verdict, 'PASS');
  assert(!fs.existsSync(path.join(root, runPath, 'feature-completion.json')), 'a coding request must not claim complete Feature delivery');
}

const cases = [{
  name: 'daily recovery: actual Node assertion failure returns to its author and reaches formal completion',
  run: () => withProject(async root => {
    const result = await runGoal(root, 'session', 'daily-repair');
    assert(result.failedInputs.length > 0, 'a green recovery cannot replace the original native failing input');
    assert.match(read(root, `doc/features/${FEATURE}/ut/reports/native-failure.tap`), /# fail [1-9]/);
    assertCompleted(root);
    assert.equal(json(root, `${runPath}/manifest.json`).run_id, RUN);
  }),
}, {
  name: 'daily recovery: real TypeScript failure reaches its author and the original coding request completes',
  run: () => withProject(async root => {
    const result = await runGoal(root, 'session', 'daily-compile-repair');
    assert.equal(result.failedInputs.length, 1);
    const native = json(root, `doc/features/${FEATURE}/coding/reports/native-compile-failure.json`);
    assert(native.checks.some((check: any) => check.id === 'coding_compile' && check.status === 'FAIL' && /TS2322/.test(check.details)));
    assert(json(root, `doc/features/${FEATURE}/coding/reports/script-report.json`).checks.some((check: any) => check.id === 'coding_compile' && check.status === 'PASS'));
    assert.equal(result.invocations.filter(phase => phase === 'work-unit-author').length, 2, 'exactly one compiler feedback repair');
    assertRequestCompleted(root);
  }, true),
}, {
  name: 'daily recovery: one native transport failure preserves the original authority and completes the coding request',
  run: () => withProject(async root => {
    const before = json(root, `${runPath}/manifest.json`);
    const result = await runGoal(root, 'detached', 'transient');
    const history = events(root);
    assert.equal(history.filter(event => event.type === 'transient_api_retry_scheduled').length, 1);
    const failed = history.find(event => event.type === 'agent_invoke_end' && event.phase === 'work-unit-author' && event.exit_code === 1);
    assert(failed, 'the first real invocation must retain its native failure');
    assert.equal(moduleAt(root, 'scripts/utils/invocation-completion').invocationCompleted({ ...failed, exitCode: failed.exit_code }), false);
    assert.equal(result.invocations.filter(phase => phase === 'work-unit-author').length, 1, 'transport recovery cannot replay completed author work');
    const after = json(root, `${runPath}/manifest.json`);
    for (const key of ['run_id', 'requirement', 'requirement_source_files', 'unattended', 'user_deadline_at']) assert.deepEqual(after[key], before[key], `recovery changed original ${key}`);
    assertRequestCompleted(root);
  }, true),
}];

export const listCaseGroups = () => unitCaseGroups(cases.map(test => test.name)).map(group => ({ ...group,
  releaseOnly: group.caseNames[0].includes('actual Node assertion failure') }));
export async function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, selector)) continue;
    const stop = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({name: test.name, ok: true}); }
    catch (error) { results.push({name: test.name, ok: false, error: (error as Error).stack}); }
    finally { stop(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export const runAll = async () => (await runSelectedCases()).results;
