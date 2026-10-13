import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fork, ChildProcess } from 'child_process';
import { performance } from 'perf_hooks';
import { StringDecoder } from 'string_decoder';
import type { Readable, Writable } from 'stream';
import type { UnitCaseResult } from '../run-unit';
import type { UnitExecutionTiming } from './unit-case-selection';

export interface UnitSuiteTask { id: string; modulePath: string; selector?: string; requirePreselection?: boolean }
export interface UnitWorkerResult {
  id: string;
  status: 'completed' | 'load-error' | 'run-error' | 'worker-error' | 'not-run';
  ok: boolean;
  error?: string;
  results: UnitCaseResult[];
  loadMs: number | null;
  executionMs: number | null;
  startupMs: number | null;
  totalMs: number | null;
  matchedCaseCount?: number;
  executionTimings?: UnitExecutionTiming[];
}

export function readSuiteTimings(): Record<string, number> {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(__dirname, 'unit-suite-timings.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.values(value).some(ms => typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0)) return {};
    return value;
  } catch { return {}; }
}

export function orderSuiteTasks<T extends UnitSuiteTask>(tasks: T[], timings: Record<string, number>): T[] {
  return tasks.map((task, index) => ({ task, index })).sort((a, b) => {
    const left = timings[a.task.id];
    const right = timings[b.task.id];
    if (left === undefined || right === undefined) {
      return left === undefined && right === undefined ? a.index - b.index : left === undefined ? -1 : 1;
    }
    return right - left || a.index - b.index;
  }).map(item => item.task);
}

export function forwardSuiteLines(stream: Readable, target: Writable, id: string): void {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const write = (chunk: string): void => {
    pending += chunk;
    let end: number;
    while ((end = pending.indexOf('\n')) >= 0) {
      target.write(`[${id}] ${pending.slice(0, end + 1)}`);
      pending = pending.slice(end + 1);
    }
  };
  stream.on('data', (chunk: Buffer) => write(decoder.write(chunk)));
  const flush = (): void => {
    write(decoder.end());
    if (pending) target.write(`[${id}] ${pending}\n`);
    pending = '';
  };
  stream.once('end', flush);
  stream.once('close', flush);
}

function workerFailure(id: string, error: string): UnitWorkerResult {
  return { id, status: 'worker-error', ok: false, error,
    results: [{ name: '<suite-worker>', ok: false, error }],
    loadMs: null, executionMs: null, startupMs: null, totalMs: null };
}

// 异常 worker 可能没来得及 finally；仅回收本轮私有 TMP 里的 trust，仍须严格失败。
function cleanupWorkerTemp(dir: string): string | undefined {
  if (!fs.existsSync(dir)) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    // 嵌套 runner 的 trust 也在私有 TMP 内；只在总根回收失败时扫描残留，不跟随 junction。
    const findTrust = (root: string): string | undefined => {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const child = path.join(root, entry.name);
        if (entry.name.startsWith('maison-test-trust-') || entry.name === 'trust-cp') return child;
        const nested = findTrust(child);
        if (nested) return nested;
      }
    };
    try {
      const trust = findTrust(dir);
      if (trust) return `临时 trust 根清理失败，遗留：${trust}`;
    } catch (scanError) { return `无法检查本轮 trust 根 ${dir}：${String(scanError)}`; }
    console.warn(`[run-unit] 临时目录回收失败：${dir}：${String(error)}`);
  }
}

export async function runSuiteProcesses(
  tasks: UnitSuiteTask[], workers: number, timings = readSuiteTimings(),
): Promise<UnitWorkerResult[]> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mu-'));
  const queue = orderSuiteTasks(tasks, timings);
  const active = new Set<ChildProcess>();
  const results = new Map<string, UnitWorkerResult>();
  let next = 0;
  let interrupted: string | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (signal: string): void => {
    if (interrupted) return;
    interrupted = `收到 ${signal}，单元测试中断`;
    console.error(`[run-unit] ${interrupted}`);
    stopping = Promise.all([...active].map(async child => {
      if (child.pid) {
        const { killProcessTree } = await import('../../scripts/utils/agent-invoke');
        if (!active.has(child) || child.exitCode !== null || child.signalCode !== null) return;
        const killed = await killProcessTree(child.pid);
        if (killed.kill_error) console.error(`[run-unit] worker ${child.pid} 回收失败：${killed.kill_error}`);
      }
    })).then(() => undefined);
  };
  const onSigint = (): void => stop('SIGINT');
  const onSigterm = (): void => stop('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);

  const runOne = (task: UnitSuiteTask, index: number): Promise<void> => new Promise(resolve => {
    const tmp = path.join(root, index.toString(36));
    fs.mkdirSync(tmp);
    const started = performance.now();
    let result: UnitWorkerResult | undefined;
    let startupMs: number | null = null;
    let spawnError: string | undefined;
    let child: ChildProcess;
    const finish = (code: number | null, signal: string | null): void => {
      active.delete(child);
      const totalMs = performance.now() - started;
      const cleanupError = cleanupWorkerTemp(tmp);
      if (!result) result = workerFailure(task.id, spawnError ?? interrupted ?? `worker 未返回结果（exit=${code}, signal=${signal}）`);
      if (code !== 0 || signal || cleanupError) {
        const error = cleanupError ?? spawnError ?? interrupted ?? `worker 非零退出（exit=${code}, signal=${signal}）`;
        result.ok = false;
        result.error = result.error ? `${result.error}\n${error}` : error;
        if (!result.results.some(c => !c.ok && c.name.startsWith('<suite-'))) {
          result.results.push({ name: '<suite-worker>', ok: false, error });
        }
        if (result.status === 'completed') result.status = 'worker-error';
      }
      result.totalMs = totalMs;
      result.startupMs = startupMs;
      results.set(task.id, result);
      console.log(`[TIME] suite ${task.id} (${result.status})：startup=${startupMs === null ? '未执行' : `${(startupMs / 1000).toFixed(3)}s`}, process=${(totalMs / 1000).toFixed(3)}s`);
      resolve();
    };
    try {
      child = fork(path.join(__dirname, '..', 'unit-worker.ts'), [task.id, task.modulePath,
        JSON.stringify({ selector: task.selector, requirePreselection: task.requirePreselection })], {
        cwd: path.resolve(__dirname, '..', '..'),
        execArgv: ['-r', 'ts-node/register'],
        env: { ...process.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      results.set(task.id, workerFailure(task.id, String(error)));
      cleanupWorkerTemp(tmp);
      resolve();
      return;
    }
    active.add(child);
    if (child.stdout) forwardSuiteLines(child.stdout, process.stdout, task.id);
    if (child.stderr) forwardSuiteLines(child.stderr, process.stderr, task.id);
    child.on('message', message => {
      if (!message || typeof message !== 'object') return;
      const packet = message as { type?: string; result?: UnitWorkerResult };
      if (packet.type === 'run-start') startupMs = performance.now() - started;
      if (packet.type === 'result' && packet.result) result = packet.result;
    });
    child.on('error', error => { spawnError = String(error); });
    // close 在退出及两条输出流收尾之后；收到 IPC 结果不能提前判 PASS。
    child.once('close', finish);
  });

  try {
    await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => {
      while (!interrupted && next < queue.length) {
        const index = next++;
        try { await runOne(queue[index], index); }
        catch (error) {
          results.set(queue[index].id, workerFailure(queue[index].id, String(error)));
          stop('调度异常');
        }
      }
    }));
    await stopping;
    for (const task of tasks) {
      if (!results.has(task.id)) {
        const result = workerFailure(task.id, interrupted ?? '套件未派发');
        result.status = 'not-run';
        results.set(task.id, result);
      }
    }
    return tasks.map(task => results.get(task.id)!);
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    let trustLeftover = false;
    for (const name of fs.readdirSync(root)) {
      const error = cleanupWorkerTemp(path.join(root, name));
      if (!error) continue;
      trustLeftover = true;
      console.error(`[run-unit] ${error}`);
      const task = queue[parseInt(name, 36)];
      const result = task ? results.get(task.id) : undefined;
      if (!result) throw new Error(error);
      result.ok = false;
      result.status = 'worker-error';
      result.results.push({ name: '<suite-cleanup>', ok: false, error });
    }
    if (!trustLeftover) {
      try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
      catch (error) { console.warn(`[run-unit] 临时总根回收失败：${root}：${String(error)}`); }
    }
  }
}
