import './utils/transpile-only-env';
import { cleanupStrict } from './utils/test-trust-bootstrap';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { performance } from 'perf_hooks';
import { SUITES } from './utils/unit-suite-registry';
import { enumerateUnitGroups, groupTimingHints, readExecutionTimingResults } from './utils/unit-case-groups';
import { collectAllFixtureDirs } from './utils/fixture-registry';
import { fixtureDisplayName } from './utils/fixture-runner';
import { runSuiteProcesses, readSuiteTimings } from './utils/unit-suite-processes';
import { buildImpactPlan, includeAdditionalGroups, readTestState, snapshotTestInputs, TEST_REPORT_DIR, TEST_STATE_FILE, TestGroup, updateTestState } from './utils/test-impact';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}
async function main(): Promise<void> {
  const started = performance.now();
  const full = process.argv.includes('--full');
  const daily = process.argv.includes('--daily');
  if (full && daily) throw new Error('--full and --daily are mutually exclusive');
  if (full && process.argv.includes('--plan-only')) throw new Error('完整全量不支持 --plan-only；仅 test:changed 可只生成计划');
  const workers = Number(argument('--workers') ?? Math.max(1, Math.min(12, os.availableParallelism())));
  if (!Number.isInteger(workers) || workers < 1) throw new Error('--workers needs a positive integer');
  const before = snapshotTestInputs();
  const previous = readTestState();
  const groups: TestGroup[] = [
    ...await enumerateUnitGroups(SUITES, workers),
    ...collectAllFixtureDirs().map(directory => ({ id: `fixture:${fixtureDisplayName(directory)}`, suiteId: `fixture:${fixtureDisplayName(directory)}`, modulePath: directory, layer: 'capability' as const, kind: 'fixture' as const })),
  ];
  const scope = full ? 'full' : daily ? 'daily' : 'changed';
  const plan = buildImpactPlan(groups, before, previous, undefined, scope);
  // Additions are unioned with a newly calculated minimum; no editable plan can subtract it.
  const additions = argument('--add') ?? [];
  includeAdditionalGroups(plan, groups, additions);
  fs.mkdirSync(TEST_REPORT_DIR, { recursive: true });
  const planFile = path.resolve(argument('--plan-out') ?? path.join(TEST_REPORT_DIR, 'plan.json'));
  fs.mkdirSync(path.dirname(planFile), { recursive: true });
  fs.writeFileSync(planFile, JSON.stringify({ snapshot: before.id, workers, ...plan }, null, 2) + '\n');
  console.log(`[PLAN] ${plan.selected.length}/${groups.length} groups; reuse=${plan.reused.length}; typecheck=${plan.typecheck}; ${planFile}`);
  for (const item of plan.selected) console.log(`[PLAN] ${item.group.id} [${item.group.layer}]: ${item.reasons.join('; ')}`);
  if (process.argv.includes('--plan-only')) return;
  let typecheckOk = true;
  if (plan.typecheck) {
    const checked = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.typecheck.json'], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', shell: false });
    typecheckOk = checked.status === 0 && !checked.error;
    if (!typecheckOk) { process.exitCode = 1; return; }
  }
  const tasks = plan.selected.map(item => ({ ...item.group, collect: true }));
  const timingsFrom = argument('--timings-from');
  const timings = groupTimingHints(groups, [...Object.values(previous?.groups ?? {}).map(fact => fact.result), ...readExecutionTimingResults(timingsFrom)], readSuiteTimings());
  const results = await runSuiteProcesses(tasks, workers, timings);
  const after = snapshotTestInputs();
  const state = updateTestState(groups, before, after, results, previous, full, undefined, scope);
  fs.writeFileSync(TEST_STATE_FILE, JSON.stringify(state, null, 2) + '\n');
  const valid = results.every(result => state.groups[result.id]?.result.ok);
  const passed = results.flatMap(result => result.results).filter(result => result.ok).length;
  const failed = results.flatMap(result => result.results).filter(result => !result.ok).length;
  const unknown = results.filter(result => !result.footprint?.executionComplete || !result.footprint.readsComplete);
  const runtimeStarted = process.env.MAISON_TEST_RUN_STARTED_NS;
  const wallMs = runtimeStarted && /^\d+$/.test(runtimeStarted) ? Number(process.hrtime.bigint() - BigInt(runtimeStarted)) / 1e6 : performance.now() - started;
  const report = { scope, full, ok: typecheckOk && valid, inputSnapshot: before, endingSnapshotId: after.id, plan, workers, timingsFrom: timingsFrom ?? null, buildMs: Number(process.env.MAISON_TEST_BUILD_MS ?? 0), wallMs,
    passed, failed, groups: results, coverage: { bytes: results.reduce((sum, result) => sum + (result.footprint?.coverageBytes ?? 0), 0), peakDiskBytes: Math.max(0, ...results.map(result => result.coverageRunPeakBytes ?? 0)), peakPerGroupBytes: Math.max(0, ...results.map(result => result.footprint?.coveragePeakBytes ?? 0)), mergeMs: results.reduce((sum, result) => sum + (result.footprint?.mergeMs ?? 0), 0), unknownGroups: unknown.map(result => ({ id: result.id, reasons: result.footprint?.reasons ?? ['missing'], totalMs: result.totalMs })), unknownDurationMs: unknown.reduce((sum, result) => sum + (result.totalMs ?? 0), 0) } };
  const out = path.resolve(argument('--results-out') ?? path.join(TEST_REPORT_DIR, `${scope}.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  for (const result of results) for (const item of result.results) console.log(`${item.ok ? 'PASS' : 'FAIL'} [${tasks.find(task => task.id === result.id)?.suiteId}] ${item.name}${item.ok ? '' : '\n' + (item.error ?? '')}`);
  console.log(`[RESULT] ${scope}: ${report.ok ? 'PASS' : 'FAIL'}; ${passed} passed, ${failed} failed; formal not executed=${plan.formal.length}; wall=${(report.wallMs / 1000).toFixed(3)}s; ${out}`);
  if (!report.ok) process.exitCode = 1;
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  const cleaned = cleanupStrict();
  if (!cleaned.ok) { console.error(`test trust cleanup failed: ${cleaned.leftoverPath}`); process.exitCode = 1; }
});
