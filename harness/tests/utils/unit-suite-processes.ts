import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { killProcessTree } from '../../scripts/utils/agent-invoke';
import type { UnitCaseResult } from '../run-unit';

export const CASE_TIMEOUT_MS = 30_000;
const HARNESS = path.resolve(__dirname, '../..');
const WORKER = path.join(HARNESS, 'tests/unit-worker.ts');
const COMPILED_ENTRY = path.join(HARNESS, 'tests/compiled-entry.cjs');

export interface Suite {
  id: string;
  modulePath: string;
  kind: 'unit' | 'fixture' | 'root';
}

interface CaseResultPacket {
  type: 'result';
  names: string[];
  results: UnitCaseResult[];
}

export interface ProcessSupervisor {
  signal: AbortSignal;
  root: string;
}

interface ProcessOptions {
  supervisor: ProcessSupervisor;
  capture?: boolean;
  monitor?: (message: unknown, watchdog: Watchdog) => void;
  limit?: number;
  started?: number;
  label: string;
  cwd?: string;
  temp?: string;
}

interface Watchdog {
  next(label: string): void;
  label(label: string): void;
}

export async function superviseProcess(args: string[], options: ProcessOptions): Promise<{ stdout: string; elapsedMs: number }> {
  const { signal } = options.supervisor;
  signal.throwIfAborted();
  const started = options.started ?? performance.now();
  let deadline = options.limit === undefined ? Infinity : started + options.limit;
  let label = options.label;
  let failure: Error | undefined;
  let timer: NodeJS.Timeout | undefined;
  let termination: Promise<void> | undefined;
  let child: ChildProcess;
  let finishCancellation!: (value: null) => void;
  const cancelledResult = new Promise<null>(resolve => { finishCancellation = resolve; });

  const cancelled = (error: Error): void => {
    if (failure) return;
    failure = error;
    termination = (async () => {
      try {
        child.stdout?.destroy();
        child.stderr?.destroy();
        child.channel?.unref();
        if (child.connected) child.disconnect();
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
        const pid = child.pid;
        await killProcessTree(pid);
        if (process.platform !== 'win32') {
          try { process.kill(-pid, 'SIGKILL'); } catch { /* Already exited. */ }
        }
        try { child.kill('SIGKILL'); } catch { /* Already exited. */ }
      } catch (recoveryError) {
        failure = new Error(error.message + '\nworker termination failed: ' + String(recoveryError));
      } finally {
        // Closing parent IPC can prevent Node from ever emitting the combined close event.
        child.unref();
        finishCancellation(null);
      }
    })();
  };

  const expired = (): boolean => {
    if (performance.now() < deadline || failure) return false;
    cancelled(new Error(`${label} timed out after ${options.limit}ms`));
    return true;
  };
  const arm = (): void => {
    clearTimeout(timer);
    if (deadline !== Infinity) timer = setTimeout(() => { if (!expired() && !failure) arm(); }, Math.max(1, deadline - performance.now()));
  };
  const watchdog: Watchdog = {
    next(nextLabel) {
      label = nextLabel;
      if (options.limit !== undefined) deadline = performance.now() + options.limit;
      arm();
    },
    label(nextLabel) { label = nextLabel; },
  };
  const abort = (): void => cancelled(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
  let stdout = '';
  try {
    child = spawn(process.execPath, args, {
      cwd: options.cwd ?? HARNESS,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: options.temp ? { ...process.env, TMP: options.temp, TEMP: options.temp, TMPDIR: options.temp,
        MAISON_TEST_CONTROL_DIR: path.join(options.temp, 'runtime-test-failures') } : process.env,
      stdio: ['ignore', options.capture ? 'pipe' : 'inherit', 'inherit', ...(options.monitor ? ['ipc' as const] : [])],
    });
    signal.addEventListener('abort', abort, { once: true });
    arm();
    child.stdout?.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.on('message', message => {
      if (failure || expired()) return;
      try { options.monitor?.(message, watchdog); }
      catch (error) { cancelled(error instanceof Error ? error : new Error(String(error))); }
    });
    const closedEvent = new Promise<{ code: number | null; signal: string | null }>(resolve => {
      child.on('error', cancelled);
      child.once('close', (code, exitSignal) => resolve({ code, signal: exitSignal }));
    });
    const closed = await Promise.race([closedEvent, cancelledResult]);
    expired();
    await termination;
    if (failure) throw failure;
    if (!closed) throw new Error('worker stopped without an exit result');
    if (closed.code !== 0) throw new Error(`${label}: worker exited with ${closed.signal ?? closed.code}${stdout ? '\n' + stdout : ''}`);
    return { stdout, elapsedMs: performance.now() - started };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

export async function mapQueued<T, R>(items: readonly T[], workers: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await run(items[index]);
    }
  }));
  return output;
}

export function verifyCaseResults(
  expected: readonly string[], completed: readonly string[], rows: readonly UnitCaseResult[],
): { passed: number; failed: number; missed: number; error?: string } {
  const finished = new Set(completed);
  const names = new Set<string>();
  const valid = new Set(expected);
  const errors: string[] = [];
  let passed = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row || !valid.has(row.name) || !finished.has(row.name) || names.has(row.name) || typeof row.ok !== 'boolean') {
      errors.push(`unexpected or repeated case result: ${row?.name ?? '(missing name)'}${row?.error ? '\n' + row.error : ''}`);
      continue;
    }
    names.add(row.name);
    if (row.ok) passed++;
    else failed++;
  }
  const missing = expected.filter(name => !names.has(name));
  if (missing.length) errors.push(`missing case results: ${missing.join(', ')}`);
  return { passed, failed, missed: missing.length, ...(errors.length ? { error: errors.join('\n') } : {}) };
}

export interface SuiteRun {
  expected: readonly string[];
  rows: UnitCaseResult[];
  passed: number;
  failed: number;
  executed: number;
  missed: number;
  missingResults: number;
  timedOut: number;
  workMs: number;
  longestCaseMs: number;
  error?: string;
}

async function runOne(suite: Suite, supervisor: ProcessSupervisor, expected: readonly string[] | undefined, limit = CASE_TIMEOUT_MS) {
  supervisor.signal.throwIfAborted();
  const started = performance.now();
  const temp = await fs.mkdtemp(path.join(supervisor.root, 'w-'));
  let packet: CaseResultPacket | undefined;
  let active: string | undefined;
  const completed: string[] = [];
  let longestCaseMs = 0;
  let caseStarted = started;
  let finalCaseStarted: number | undefined;
  let error: string | undefined;
  try {
    const processResult = await superviseProcess([COMPILED_ENTRY, WORKER, suite.kind, suite.modulePath, expected ? 'run' : 'discover'], {
      supervisor, limit, temp, started,
      capture: suite.kind === 'root',
      cwd: suite.kind === 'root' ? path.dirname(HARNESS) : HARNESS,
      label: expected ? `[${suite.id}] ${expected[0]}` : `[${suite.id}] discovery`,
      monitor(message, watchdog) {
        if (!message || typeof message !== 'object') throw new Error('invalid worker message');
        const event = message as { type: string; name: string };
        if (event.type === 'result') {
          if (packet) throw new Error('worker repeated its result');
          packet = message as CaseResultPacket;
          return;
        }
        if (!expected) throw new Error('discovery ran a case');
        const name = expected[completed.length];
        if (packet || !name || event.name !== name) {
          throw new Error(`unexpected case ${event.type}: ${event.name}; expected ${name ?? 'end of suite'}`);
        }
        if (event.type === 'start' && active === undefined) {
          active = name;
        } else if (event.type === 'end' && active === name) {
          longestCaseMs = Math.max(longestCaseMs, performance.now() - caseStarted);
          completed.push(name);
          active = undefined;
          const next = expected[completed.length];
          if (next !== undefined) {
            caseStarted = performance.now();
            watchdog.next(`[${suite.id}] ${next}`);
          } else {
            finalCaseStarted = caseStarted;
            watchdog.label(`[${suite.id}] ${name} (cleanup)`);
          }
        } else {
          throw new Error(`unexpected case ${event.type}: ${event.name}`);
        }
      },
    });
    if (!expected && suite.kind === 'root' && processResult.stdout.trim()) throw new Error(`unexpected native execution during discovery:\n${processResult.stdout}`);
    if (!packet || !Array.isArray(packet.names) || !Array.isArray(packet.results)) throw new Error('worker exited without a complete result');
  } catch (failure) {
    error = failure instanceof Error ? failure.message : String(failure);
  } finally {
    try { await fs.rm(temp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (failure) { error = [error, `worker cleanup failed: ${String(failure)}`].filter(Boolean).join('\n'); }
  }
  if (finalCaseStarted !== undefined) {
    const elapsed = performance.now() - finalCaseStarted;
    longestCaseMs = Math.max(longestCaseMs, elapsed);
    if (elapsed >= limit && !error) error = `[${suite.id}] ${expected?.at(-1)} (cleanup) timed out after ${limit}ms`;
  }
  return { packet, error, completed, longestCaseMs, workMs: performance.now() - started };
}

export async function discoverCases(suite: Suite, supervisor: ProcessSupervisor): Promise<string[]> {
  const run = await runOne(suite, supervisor, undefined);
  if (run.error) throw new Error(run.error);
  const names = run.packet!.names;
  if (!names.length || new Set(names).size !== names.length || names.some(name => typeof name !== 'string' || !name)) {
    throw new Error(`discovery must return unique nonempty case names: ${JSON.stringify(names)}`);
  }
  return names;
}

export async function runDiscoveredSuite(
  suite: Suite, supervisor: ProcessSupervisor, expected: readonly string[], limit = CASE_TIMEOUT_MS,
): Promise<SuiteRun> {
  const run = await runOne(suite, supervisor, expected, limit);
  const rows = run.packet?.results ?? [];
  const checked = verifyCaseResults(expected, run.completed, rows);
  return {
    expected, rows, passed: checked.passed, failed: checked.failed,
    executed: run.completed.length,
    missed: expected.length - run.completed.length,
    missingResults: checked.missed,
    timedOut: run.error?.includes(`timed out after ${limit}ms`) ? 1 : 0,
    workMs: run.workMs, longestCaseMs: run.longestCaseMs,
    error: [run.error, checked.error].filter(Boolean).join('\n') || undefined,
  };
}
