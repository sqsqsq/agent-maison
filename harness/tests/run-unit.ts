// ============================================================================
// run-unit.ts — Framework Harness 单元测试 runner
// ============================================================================
//
// 与 run-tests.ts 的区别：
//   - run-tests.ts：扫 fixtures/，对 framework checker 跑端到端断言
//   - run-unit.ts ：直接 import 工具函数（hdc-runner / spec-loader 等的纯函数），
//                   做白盒级断言，DevEco / hypium 升级时第一时间挂出来
//
// 用法（在 harness/）：
//   npm run test:unit                              默认每套件独立进程，最多 min(12, 可用逻辑核数) 并发
//   npm run test:unit -- --workers 1                单套件独立进程，顺序派发
//   npm run test:unit -- --serial                   原单进程、登记顺序
//   npm run test:unit -- --filter parseHypium
//   npm run test:unit -- --filter real-chain --case "完整显示名的字面子串"
//   npm run test:unit -- --release --results-out reports/ut-results.json
//
// 退出码：0 全部通过；1 至少一个用例失败。
// ============================================================================

import './utils/transpile-only-env'; // 须为首个 import：本进程+子进程走 transpile-only（见 plan a7c3e1f9 P0）
// b7e4d2a9 Todo1：第二个 import 必须是 trust 隔离 bootstrap——在任何可能读
// MAISON_GOAL_CHECKPOINT_DIR 的模块加载之前无条件覆写到独立临时根（测试零泄漏）。
import { cleanupStrict } from './utils/test-trust-bootstrap';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { performance } from 'perf_hooks';
import { selectSuites } from './utils/select-suites';
import { writeUnitFailureReport } from './utils/unit-failure-report';
import { runSuiteProcesses, UnitSuiteTask } from './utils/unit-suite-processes';
import { filterLegacyCases, UnitExecutionTiming } from './utils/unit-case-selection';
import { enumerateUnitGroups, groupTimingHints, readExecutionTimingResults } from './utils/unit-case-groups';
import { readSuiteTimings } from './utils/unit-suite-processes';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
  infrastructure?: boolean;
}

import { SUITES, EXPLICIT_SUITE_IDS } from './utils/unit-suite-registry';
interface SuiteSummary {
  id: string;
  results: UnitCaseResult[];
}

interface SuiteMeasurement extends SuiteSummary {
  matchedCaseCount?: number;
  executionTimings?: UnitExecutionTiming[];
  releaseOnly: boolean;
  status: 'not-run' | 'completed' | 'skipped' | 'missing' | 'load-error' | 'run-error' | 'worker-error';
  ok: boolean | null;
  error?: string;
  loadMs: number | null;
  executionMs: number | null;
  totalMs: number | null;
  startupMs?: number | null;
}

const runStartedAt = performance.now();
let resultsOut: string | undefined;
const measurements: SuiteMeasurement[] = [];
let scope: { filter: string | null; release: boolean; caseNameFilter: string | null; suiteIds: string[] } = {
  filter: null, release: false, caseNameFilter: null, suiteIds: [],
};
let runError: string | undefined;
let mode: 'serial' | 'workers' = 'serial';
let workers = 1;

function printSuiteTiming(suite: SuiteMeasurement): void {
  console.log(`  [TIME] suite ${suite.id} (${suite.status})：load=${suite.loadMs === null ? '未加载' : `${(suite.loadMs / 1000).toFixed(3)}s`}, run=${suite.executionMs === null ? '未执行' : `${(suite.executionMs / 1000).toFixed(3)}s`}, total=${((suite.totalMs ?? 0) / 1000).toFixed(3)}s`);
}

async function main(): Promise<void> {
  mode = process.argv.includes('--serial') ? 'serial' : 'workers';
  const workersIdx = process.argv.indexOf('--workers');
  if (mode === 'serial' && workersIdx >= 0) throw new Error('--serial 不能与 --workers 同用');
  workers = workersIdx >= 0 ? Number(process.argv[workersIdx + 1]) : Math.max(1, Math.min(12, os.availableParallelism()));
  if (!Number.isInteger(workers) || workers < 1) throw new Error('--workers 需要正整数');
  if (mode === 'serial') workers = 1;
  const resultsIdx = process.argv.indexOf('--results-out');
  if (resultsIdx >= 0) {
    const value = process.argv[resultsIdx + 1];
    if (!value || value.startsWith('--')) throw new Error('--results-out 需要文件路径');
    resultsOut = path.resolve(value);
  }
  const filterIdx = process.argv.indexOf('--filter');
  const filter = filterIdx >= 0 ? process.argv[filterIdx + 1] : undefined;
  if (filterIdx >= 0 && (!filter || filter.startsWith('--'))) throw new Error('--filter 需要字面字符串');
  const caseIdx = process.argv.indexOf('--case');
  const caseSelector = caseIdx >= 0 ? process.argv[caseIdx + 1] : undefined;
  if (caseIdx >= 0 && (!caseSelector || caseSelector.startsWith('--'))) throw new Error('--case 需要非空字面字符串');
  // `--release`：发布门（release-all / candidate-release）与手动全量跑传它，含 release-only 套件。
  const release = process.argv.includes('--release');
  const { toRun, caseNameFilter, skipExecution } = selectSuites(filter, SUITES, { release, case: caseSelector });
  scope = { filter: filter ?? null, release, caseNameFilter: caseNameFilter ?? null, suiteIds: toRun.map(s => s.id) };
  measurements.push(...toRun.map(s => ({
    id: s.id, releaseOnly: s.releaseOnly === true, status: 'not-run' as const, ok: null,
    loadMs: null, executionMs: null, totalMs: null, results: [],
  })));

  console.log('\nFramework Harness Unit Tests\n');
  console.log('='.repeat(72));
  if (caseSelector === undefined && caseNameFilter !== undefined) {
    console.log(`[SELECT] --filter 未命中任何套件 ID，改为在全部 ${toRun.length} 个套件中按用例名执行（本次执行 ${toRun.length - skipExecution.size} 个，release-only 跳过 ${skipExecution.size} 个）`);
  }
  const suiteScope = toRun.length > 10 ? `${toRun.length} 个套件` : toRun.map(s => s.id).join(', ');
  console.log(`[SELECT] mode=${mode}, workers=${workers}；suites=${suiteScope}；case=${caseNameFilter === undefined ? '未指定' : JSON.stringify(caseNameFilter)}；release-only 跳过=${skipExecution.size}`);

  const summaries: SuiteSummary[] = [];
  const tasks: UnitSuiteTask[] = [];

  for (const [index, suite] of toRun.entries()) {
    const measurement = measurements[index];
    const suiteStartedAt = performance.now();
    const fullPath = path.resolve(__dirname, suite.modulePath + '.ts');
    if (!fs.existsSync(fullPath)) {
      // review P1：显式注册的 CORE 套件缺失 = 测试基建回归，必须 FAIL（静默 SKIP 会假绿）；
      // 自动发现（profile）套件缺失则 SKIP 属正常（profile 可能未带该测试）。
      if (EXPLICIT_SUITE_IDS.has(suite.id)) {
        console.log(`  [FAIL] suite ${suite.id} 缺失：${fullPath}`);
        measurement.results = [{ name: '<suite-load>', ok: false, error: `显式注册的 CORE 套件文件缺失：${fullPath}` }];
        measurement.ok = false;
        summaries.push(measurement);
      } else {
        console.log(`  [SKIP] suite ${suite.id} 不存在：${fullPath}`);
      }
      measurement.status = 'missing';
      measurement.error = `套件文件缺失：${fullPath}`;
      measurement.totalMs = performance.now() - suiteStartedAt;
      printSuiteTiming(measurement);
      continue;
    }
    // release-only：文件存在性已在上面校验过（缺失仍 FAIL），这里只跳过执行。
    if (skipExecution.has(suite.id)) {
      console.log(`  [SKIP] suite ${suite.id}：release-only（加 --release 或 --filter ${suite.id} 执行）`);
      measurement.status = 'skipped';
      measurement.totalMs = performance.now() - suiteStartedAt;
      printSuiteTiming(measurement);
      continue;
    }
    // Serial remains one-at-a-time, with the same outer protection against a blocked event loop.
    tasks.push({ id: suite.id, modulePath: fullPath, selector: caseNameFilter, requirePreselection: caseSelector !== undefined, layer: suite.layer });
  }

  {
    const groups = await enumerateUnitGroups(toRun.filter(suite => tasks.some(task => task.id === suite.id)), mode === 'serial' ? 1 : workers, caseNameFilter, caseSelector !== undefined);
    const timingIndex = process.argv.indexOf('--timings-from');
    const history = readExecutionTimingResults(timingIndex < 0 ? undefined : process.argv[timingIndex + 1]);
    const groupResults = await runSuiteProcesses(groups, mode === 'serial' ? 1 : workers, groupTimingHints(groups, history, readSuiteTimings()));
    const workerResults = new Map(tasks.map(task => {
      const mine = groupResults.filter(result => groups.find(group => group.id === result.id)?.suiteId === task.id);
      const first = mine[0];
      return [task.id, first ? { ...first, id: task.id, ok: mine.every(result => result.ok), results: mine.flatMap(result => result.results),
        executionTimings: mine.flatMap(result => result.executionTimings ?? []), matchedCaseCount: mine.reduce((sum, result) => sum + (result.matchedCaseCount ?? 0), 0),
        loadMs: mine.reduce((sum, result) => sum + (result.loadMs ?? 0), 0), executionMs: mine.reduce((sum, result) => sum + (result.executionMs ?? 0), 0), totalMs: mine.reduce((sum, result) => sum + (result.totalMs ?? 0), 0) } : undefined] as const;
    }));
    summaries.length = 0;
    for (const measurement of measurements) {
      const result = workerResults.get(measurement.id);
      if (result) {
        Object.assign(measurement, result);
        if (caseNameFilter !== undefined && caseSelector === undefined) {
          measurement.results = filterLegacyCases(measurement.results, caseNameFilter);
          measurement.ok = measurement.results.every(c => c.ok);
        }
      }
      if (measurement.ok !== null) summaries.push(measurement);
    }
  }

  console.log('');
  let totalPass = 0;
  let totalFail = 0;
  for (const s of summaries) {
    const passed = s.results.filter(r => r.ok).length;
    const failed = s.results.length - passed;
    totalPass += passed;
    totalFail += failed;
    console.log(`Suite [${s.id}]  PASS=${passed}  FAIL=${failed}`);
    for (const r of s.results) {
      if (r.ok) {
        console.log(`  PASS  ${r.name}`);
      } else {
        console.log(`  FAIL  ${r.name}`);
        if (r.error) {
          for (const line of r.error.split('\n')) {
            console.log(`        ${line}`);
          }
        }
      }
    }
    console.log('');
  }

  console.log('='.repeat(72));
  console.log(`\n结果：${totalPass} passed, ${totalFail} failed (共 ${totalPass + totalFail})\n`);

  try {
    const report = writeUnitFailureReport(summaries);
    if (report.failureCount > 0) {
      console.log(`失败用例明细已写入：${report.path}（${report.failureCount} case）`);
    }
  } catch (error) {
    console.error(`[run-unit] 写失败用例报告失败：${(error as Error).message}`);
  }

  // b7e4d2a9 Todo1：不再直接 process.exit——exitCode + finally 严格清理（see 底部）
  const matchedCaseCount = measurements.reduce((sum, s) => sum + (s.matchedCaseCount ?? 0), 0);
  const noMatch = caseNameFilter !== undefined && matchedCaseCount === 0;
  if (noMatch) console.error(`[SELECT] 用例零命中：${JSON.stringify(caseNameFilter)}；suites=${scope.suiteIds.join(', ')}`);
  process.exitCode = totalFail > 0 || noMatch ? 1 : 0;
}

void (async () => {
  try {
    await main();
  } catch (err) {
    runError = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(err);
    process.exitCode = 1;
  } finally {
    // 严格语义：临时 trust 根删不掉=测试留了垃圾——非零退出并打印路径（不许静默）；
    // process.once('exit') 的 best-effort 后备兜异常路径。
    const r = cleanupStrict();
    if (!r.ok) {
      console.error(`[test-trust-bootstrap] 临时 trust 根清理失败，遗留：${r.leftoverPath}`);
      process.exitCode = 1;
    }
    console.log(`\n最慢套件 Top 20（${mode === 'serial' ? '加载 + 执行' : '完整进程占用'}）：`);
    const slowest = measurements.filter(s => mode === 'serial' ? s.loadMs !== null
      : s.totalMs !== null && s.status !== 'skipped' && s.status !== 'missing')
      .sort((a, b) => (b.totalMs ?? 0) - (a.totalMs ?? 0)).slice(0, 20);
    for (const suite of slowest) printSuiteTiming(suite);
    const wallMs = performance.now() - runStartedAt;
    console.log(`整轮墙钟：${(wallMs / 1000).toFixed(3)}s`);
    if (resultsOut) {
      try {
        fs.mkdirSync(path.dirname(resultsOut), { recursive: true });
        fs.writeFileSync(resultsOut, JSON.stringify({
          mode, workers, scope, wallMs, ok: process.exitCode === 0,
          ...(runError ? { error: runError } : {}), suites: measurements,
        }, null, 2) + '\n', 'utf-8');
        console.log(`完整结果已写入：${resultsOut}`);
      } catch (error) {
        console.error(`[run-unit] 写完整结果失败：${(error as Error).message}`);
        process.exitCode = 1;
      }
    }
  }
})();
