import './utils/transpile-only-env';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { performance } from 'node:perf_hooks';
import * as path from 'node:path';
import { collectSuites, filterSuites } from './utils/unit-suite-registry';
import type { InputSnapshot } from './utils/test-input-snapshot';
import { discoverCases, mapQueued, ProcessSupervisor, runDiscoveredSuite, superviseProcess } from './utils/unit-suite-processes';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
  infrastructure?: boolean;
}

const FULL_TIMEOUT_MS = 30 * 60_000;
const REPORT = path.resolve(__dirname, '../reports/test-run/full.json');

async function snapshot(supervisor: ProcessSupervisor): Promise<InputSnapshot> {
  const { stdout } = await superviseProcess([
    '-r', require.resolve('ts-node/register/transpile-only'), path.join(__dirname, 'utils/test-input-snapshot.ts'),
  ], { supervisor, label: 'test input snapshot', capture: true });
  return JSON.parse(stdout);
}

export async function main(args: string[]): Promise<void> {
  if (args.length && (args.length !== 2 || args[0] !== '--filter' || !args[1])) {
    throw new Error('usage: npm test [-- --filter <suite name>]');
  }
  const filter = args[1];
  const started = BigInt(process.env.MAISON_TEST_STARTED_NS ?? process.hrtime.bigint());
  const wallMs = () => Number(process.hrtime.bigint() - started) / 1e6;
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(new Error('full test run exceeded 30 minutes')), Math.max(1, FULL_TIMEOUT_MS - wallMs()));
  const interrupted = () => control.abort(new Error('test run interrupted'));
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  let root: string | undefined;
  try {
    if (filter === undefined) await fs.rm(REPORT, { force: true });
    const workers = Math.min(6, os.availableParallelism());
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'maison-tests-'));
    const supervisor = { signal: control.signal, root };
    process.env.MAISON_TEST_BUILD_DIR = path.join(root, 'build');
    const inputSnapshot = filter === undefined ? await snapshot(supervisor) : undefined;
    const suites = filterSuites(collectSuites(), filter);
    const build = await superviseProcess([path.join(__dirname, 'build-test-runtime.cjs')], { supervisor, label: 'typecheck and compile' });
    const discoveries = await mapQueued(suites, workers, async suite => {
      const discoveryStarted = performance.now();
      try {
        if (suite.kind === 'fixture') return { suite, expected: [suite.id.slice('fixture:'.length)], workMs: 0 };
        const expected = await discoverCases(suite, supervisor);
        return { suite, expected, workMs: performance.now() - discoveryStarted };
      } catch (error) {
        console.error(`FAIL [${suite.id}] discovery\n${String(error)}`);
        return { suite, expected: [], workMs: performance.now() - discoveryStarted };
      }
    });
    control.signal.throwIfAborted();
    console.log(`[DISCOVERY] ${suites.length} suites, ${discoveries.reduce((sum, item) => sum + item.expected.length, 0)} cases; concurrency=${workers}`);
    const runs = await mapQueued(discoveries, workers, async ({ suite, expected }) => {
      if (!expected.length || control.signal.aborted) return;
      const run = await runDiscoveredSuite(suite, supervisor, expected);
      for (const row of run.rows) {
        if (!row.ok) console.error(`FAIL [${suite.id}] ${row.name}\n${row.error ?? ''}`);
      }
      if (run.error) console.error(`FAIL [${suite.id}] ${run.error}`);
      else if (!run.failed) console.log(`PASS [${suite.id}] ${run.passed} cases`);
      return run;
    });
    control.signal.throwIfAborted();
    const endingSnapshot = inputSnapshot ? await snapshot(supervisor) : undefined;
    if (inputSnapshot?.id !== endingSnapshot?.id) console.error('test inputs changed during the run');
    const registered = discoveries.reduce((sum, item) => sum + item.expected.length, 0);
    const passed = runs.reduce((sum, run) => sum + (run?.passed ?? 0), 0);
    const failed = runs.reduce((sum, run) => sum + (run?.failed ?? 0), 0);
    const executed = runs.reduce((sum, run) => sum + (run?.executed ?? 0), 0);
    const missed = registered - executed;
    const missingResults = runs.reduce((sum, run) => sum + (run?.missingResults ?? 0), 0);
    const timedOut = runs.reduce((sum, run) => sum + (run?.timedOut ?? 0), 0);
    const skipped = 0;
    const infrastructureFailed = runs.filter(run => !run || run.error).length;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    root = undefined;
    control.signal.throwIfAborted();
    if (wallMs() >= FULL_TIMEOUT_MS) throw new Error('full test run exceeded 30 minutes');
    const ok = registered > 0 && !failed && !missed && !missingResults && !infrastructureFailed && inputSnapshot?.id === endingSnapshot?.id;
    const discoveryMs = discoveries.reduce((sum, item) => sum + item.workMs, 0);
    const executionMs = runs.reduce((sum, run) => sum + (run?.workMs ?? 0), 0);
    const report = {
      ok, inputSnapshot, endingSnapshot, suites: suites.length, workers, wallMs: wallMs(), buildMs: build.elapsedMs,
      registered, executed, passed, failed, missed, missingResults, skipped, timedOut, infrastructureFailed,
      workMs: discoveryMs + executionMs, discoveryMs, executionMs,
      longestCaseMs: Math.max(0, ...runs.map(run => run?.longestCaseMs ?? 0)),
    };
    if (filter === undefined) {
      await fs.mkdir(path.dirname(REPORT), { recursive: true });
      const pending = path.join(path.dirname(REPORT), `full.${process.pid}.tmp`);
      try {
        await fs.writeFile(pending, JSON.stringify(report, null, 2) + '\n');
        control.signal.throwIfAborted();
        await fs.rename(pending, REPORT);
        if (control.signal.aborted || wallMs() >= FULL_TIMEOUT_MS) {
          await fs.rm(REPORT, { force: true });
          throw new Error('full test report exceeded 30 minutes');
        }
      } finally {
        await fs.rm(pending, { force: true });
      }
    }
    console.log(`[RESULT] ${ok ? 'PASS' : 'FAIL'}; ${registered} registered, ${executed} completed, ${passed} passed, ${failed} failed, ${missed} incomplete, ${missingResults} missing results, ${timedOut} timed out, ${infrastructureFailed} suite errors; wall=${(report.wallMs / 1000).toFixed(3)}s`);
    if (!ok) process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
