import './utils/transpile-only-env';
import { cleanupStrict } from './utils/test-trust-bootstrap';
import { performance } from 'perf_hooks';
import type { UnitWorkerResult } from './utils/unit-suite-processes';
import type { UnitCaseResult } from './run-unit';
import { executeUnitModule, SelectableUnitModule } from './utils/unit-case-selection';
import { mergeRuntimeTestFailures } from './utils/runtime-test-control';
import { observeTestInputs, guardFunctionProcesses } from './utils/test-input-observer';
import { assertFunctionDependencies, buildTestDependencyGraph, repoPath } from './utils/test-dependency-graph';

const [id, modulePath, selectionJson] = process.argv.slice(2);
const result: UnitWorkerResult = {
  id, status: 'load-error', ok: false, results: [],
  loadMs: null, executionMs: null, startupMs: null, totalMs: null,
};

void (async () => {
  const loadedAt = performance.now();
  let executionStartedAt: number | undefined;
  let observer: ReturnType<typeof observeTestInputs> | undefined;
  let restoreProcesses: ReturnType<typeof guardFunctionProcesses> | undefined;
  try {
    const selection = selectionJson ? JSON.parse(selectionJson) as { selector?: string; requirePreselection?: boolean; layer?: 'function' | 'capability'; enumerate?: boolean; collect?: boolean; kind?: 'fixture' } : {};
    if (selection.collect) observer = observeTestInputs();
    if (selection.layer === 'function') {
      assertFunctionDependencies(buildTestDependencyGraph([repoPath(modulePath)]), repoPath(modulePath));
      restoreProcesses = guardFunctionProcesses();
    }
    if (selection.kind === 'fixture') {
      const { runFixture } = require('./utils/fixture-runner') as typeof import('./utils/fixture-runner');
      process.send?.({ type: 'run-start' }); executionStartedAt = performance.now();
      result.loadMs = performance.now() - loadedAt;
      const fixture = await runFixture(modulePath);
      result.results = [{ name: fixture.name, ok: fixture.ok, ...(fixture.ok ? {} : { error: fixture.failures.join('\n') }) }];
      result.executionMs = performance.now() - executionStartedAt;
      result.matchedCaseCount = 1; result.status = 'completed'; result.ok = fixture.ok;
      return;
    }
    const mod = require(modulePath) as SelectableUnitModule;
    result.loadMs = performance.now() - loadedAt;
    if (typeof mod.runAll !== 'function') throw new Error('未导出 runAll()');
    if (selection.enumerate) {
      if (typeof mod.listCaseGroups !== 'function') throw new Error('未导出 listCaseGroups()');
      result.caseGroups = await mod.listCaseGroups(); result.status = 'completed'; result.ok = true;
      return;
    }
    process.send?.({ type: 'run-start' });
    executionStartedAt = performance.now();
    const selected = await executeUnitModule(mod, id, selection.selector, selection.requirePreselection);
    result.results = selected.results;
    if (selection.selector?.startsWith('\u001eexact:')) {
      const expected = JSON.parse(selection.selector.slice('\u001eexact:'.length)) as string[];
      const actual = selected.results.filter(item => !item.infrastructure && !item.name.startsWith('<suite-')).map(item => item.name);
      if (JSON.stringify([...expected].sort()) !== JSON.stringify([...actual].sort())) result.results.push({ name: '<suite-selection>', infrastructure: true, ok: false, error: `exact group case multiset mismatch: expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)}` });
    }
    result.matchedCaseCount = selected.matchedCaseCount;
    result.executionTimings = selected.executionTimings;
    result.executionMs = performance.now() - executionStartedAt;
    result.status = 'completed';
    result.ok = result.results.every(c => c.ok);
  } catch (error) {
    result.status = executionStartedAt === undefined ? 'load-error' : 'run-error';
    result.error = error instanceof Error ? error.stack ?? error.message : String(error);
    result.results = [{ name: executionStartedAt === undefined ? '<suite-load>' : '<suite-run>', ok: false, error: result.error }];
    if (executionStartedAt === undefined) result.loadMs = performance.now() - loadedAt;
    else result.executionMs = performance.now() - executionStartedAt;
  } finally {
    restoreProcesses?.();
    if (restoreProcesses?.violations.length) {
      result.results.push({ name: '<suite-layer>', infrastructure: true, ok: false, error: restoreProcesses.violations.join('\n') });
      result.ok = false; result.status = 'run-error';
    }
    if (observer) result.inputReads = observer.finish();
    if (mergeRuntimeTestFailures(result.results)) result.ok = false;
    const cleaned = cleanupStrict();
    if (!cleaned.ok) {
      const error = `临时 trust 根清理失败，遗留：${cleaned.leftoverPath}`;
      console.error(`[test-trust-bootstrap] ${error}`);
      result.results.push({ name: '<suite-cleanup>', ok: false, error });
      result.ok = false;
      result.error = result.error ? `${result.error}\n${error}` : error;
    }
    process.exitCode = result.status === 'completed' && cleaned.ok ? 0 : 1;
    if (process.send) {
      process.send({ type: 'result', result }, error => {
        if (error) { console.error(error); process.exitCode = 1; }
        if (process.connected) process.disconnect();
      });
    }
  }
})();
