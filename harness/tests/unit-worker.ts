import './utils/transpile-only-env';
import { cleanupStrict } from './utils/test-trust-bootstrap';
import { performance } from 'perf_hooks';
import type { UnitWorkerResult } from './utils/unit-suite-processes';
import type { UnitCaseResult } from './run-unit';
import { executeUnitModule, SelectableUnitModule } from './utils/unit-case-selection';

const [id, modulePath, selectionJson] = process.argv.slice(2);
const result: UnitWorkerResult = {
  id, status: 'load-error', ok: false, results: [],
  loadMs: null, executionMs: null, startupMs: null, totalMs: null,
};

void (async () => {
  const loadedAt = performance.now();
  let executionStartedAt: number | undefined;
  try {
    const selection = selectionJson ? JSON.parse(selectionJson) as { selector?: string; requirePreselection?: boolean } : {};
    const mod = require(modulePath) as SelectableUnitModule;
    result.loadMs = performance.now() - loadedAt;
    if (typeof mod.runAll !== 'function') throw new Error('未导出 runAll()');
    process.send?.({ type: 'run-start' });
    executionStartedAt = performance.now();
    const selected = await executeUnitModule(mod, id, selection.selector, selection.requirePreselection);
    result.results = selected.results;
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
