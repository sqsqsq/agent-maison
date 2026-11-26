import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SpawnSyncReturns } from 'child_process';
import type { UnitCaseResult } from '../run-unit';

// R4 natural runs reached 18 minutes; a case can contain both seed and resume.
export const TEST_RUN_TIMEOUT_MS = 45 * 60_000;

export interface RuntimeTestControl {
  timeoutMs?: number;
  /** This invocation's existing deliberate fault message, never a suite-wide waiver. */
  expectedInterruption?: string;
  /** Existing logs explicitly owned by this fixture, relative to root or absolute within it. */
  evidenceFiles?: readonly string[];
}
interface Snapshot { dir: string; events: Buffer; control: Buffer }
interface Failure { error: string; evidenceDir?: string; caseNames?: readonly string[] }
const CONTROL_ENV = 'MAISON_TEST_CONTROL_DIR';
let activeCase: string[] = [];
function identifier(): string { return `${process.pid}-${process.hrtime.bigint()}`; }
export function testTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) throw new Error('test timeout must be a positive finite number');
  return value;
}
export function testPollInterval(fallback = 25): number {
  const configured = process.env.MAISON_TEST_POLL_MS;
  return testTimeout(configured === undefined ? undefined : Number(configured), fallback);
}
function read(file: string): Buffer { try { return fs.readFileSync(file); } catch { return Buffer.alloc(0); } }
function records(bytes: Buffer): Array<Record<string, unknown>> {
  return bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(line => {
    try { return JSON.parse(line) as Record<string, unknown>; } catch { return {}; }
  });
}
function runDirectories(root: string): string[] {
  let relative = '.';
  try {
    const configured = JSON.parse(fs.readFileSync(path.join(root, 'framework.config.json'), 'utf8')).paths?.features_dir;
    relative = typeof configured === 'string' ? configured : 'doc/features';
  } catch { /* A worker root can contain several isolated fixtures. */ }
  const features = path.resolve(root, relative);
  const scoped = path.relative(root, features);
  if (path.isAbsolute(scoped) || scoped.split(path.sep).includes('..')) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || ['.git', 'node_modules', 'framework'].includes(entry.name)) continue;
      const child = path.join(dir, entry.name);
      if (entry.name === 'goal-runs') {
        for (const run of fs.readdirSync(child, { withFileTypes: true })) if (run.isDirectory() && !run.isSymbolicLink()) out.push(path.join(child, run.name));
      } else walk(child);
    }
  };
  walk(features);
  return out;
}
function snapshots(root: string): Snapshot[] {
  return runDirectories(root).map(dir => ({ dir, events: read(path.join(dir, 'events.jsonl')), control: read(path.join(dir, 'run-control.json')) }));
}
function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && !relative.split(path.sep).includes('..');
}
export function preserveRuntimeTestEvidence(roots: readonly string[], reason: string, caseNames: readonly string[] = activeCase,
  evidenceFiles: readonly string[] = [], output?: { stdout?: unknown; stderr?: unknown }): string {
  const base = process.env.MAISON_TEST_EVIDENCE_DIR ?? path.resolve(__dirname, '../../reports/test-runtime-control');
  fs.mkdirSync(base, { recursive: true });
  const destination = fs.mkdtempSync(path.join(base, 'failure-'));
  const saved: Array<{ root: string; run: string; files: string[] }> = [];
  for (const root of [...new Set(roots)]) for (const dir of runDirectories(path.resolve(root))) {
    const target = path.join(destination, String(saved.length)); fs.mkdirSync(target);
    const files: string[] = [];
    for (const name of ['events.jsonl', 'manifest.json', 'run-control.json', 'goal-report.json']) {
      const original = path.join(dir, name);
      if (fs.existsSync(original)) { fs.copyFileSync(original, path.join(target, name)); files.push(name); }
    }
    saved.push({ root, run: dir, files });
  }
  const logs: Array<{ source: string; file: string }> = [];
  for (const original of new Set(evidenceFiles)) {
    const root = roots.find(root => within(path.resolve(root), path.resolve(original)));
    if (!root || !fs.existsSync(original) || !fs.statSync(original).isFile()
      || !within(fs.realpathSync(root), fs.realpathSync(original))) continue;
    const file = path.join('logs', `${logs.length}-${path.basename(original)}`);
    fs.mkdirSync(path.join(destination, 'logs'), { recursive: true });
    fs.copyFileSync(original, path.join(destination, file));
    logs.push({ source: original, file });
  }
  const childOutput: string[] = [];
  for (const stream of ['stdout', 'stderr'] as const) {
    const bytes = output?.[stream];
    if (typeof bytes !== 'string' && !Buffer.isBuffer(bytes)) continue;
    const file = `child.${stream}.log`;
    fs.writeFileSync(path.join(destination, file), bytes);
    childOutput.push(file);
  }
  fs.writeFileSync(path.join(destination, 'failure.json'), JSON.stringify({ reason, caseNames, saved, logs, childOutput }, null, 2) + '\n');
  return destination;
}
export function recordRuntimeTestFailure(error: string, roots: readonly string[], caseNames: readonly string[] = activeCase,
  evidenceFiles: readonly string[] = [], output?: { stdout?: unknown; stderr?: unknown }): Failure {
  let evidenceDir: string;
  try { evidenceDir = preserveRuntimeTestEvidence(roots, error, caseNames, evidenceFiles, output); }
  catch (copyError) { evidenceDir = `preservation failed: ${String(copyError)}`; }
  const failure = { error, evidenceDir, caseNames: [...caseNames] };
  const control = process.env[CONTROL_ENV] ?? (process.env[CONTROL_ENV] = fs.mkdtempSync(path.join(os.tmpdir(), 'test-runtime-control-')));
  fs.mkdirSync(control, { recursive: true });
  fs.writeFileSync(path.join(control, `${identifier()}.json`), JSON.stringify(failure));
  return failure;
}
function runtimeTestFailures(control = process.env[CONTROL_ENV]): Failure[] {
  if (!control || !fs.existsSync(control)) return [];
  return fs.readdirSync(control).filter(name => name.endsWith('.json')).map(name => {
    let failure: Failure;
    try { failure = JSON.parse(fs.readFileSync(path.join(control, name), 'utf8')); }
    catch { failure = { error: `invalid test failure original: ${name}`, evidenceDir: control }; }
    return failure;
  });
}
export function mergeRuntimeTestFailures(results: UnitCaseResult[], failures: readonly Failure[] = runtimeTestFailures()): boolean {
  for (const failure of failures) {
    const names = [...new Set(failure.caseNames ?? [])];
    const matching = names.length === 1 ? results.filter(row => row.name === names[0] && !row.name.startsWith('<suite-')) : [];
    let target = matching.length === 1 ? matching[0] : results.find(row => !row.ok
      && row.name.startsWith('<suite-') && row.error?.includes(failure.error));
    if (!target) { target = { name: '<suite-runtime>', ok: false, infrastructure: true }; results.push(target); }
    target.ok = false;
    target.infrastructure = true;
    for (const detail of [failure.error, ...(failure.evidenceDir ? [`originals: ${failure.evidenceDir}`] : [])]) {
      if (!target.error?.includes(detail)) target.error = target.error ? `${target.error}\n${detail}` : detail;
    }
  }
  return failures.length > 0;
}
export function setRuntimeTestCase(name: string): () => void {
  const previous = activeCase;
  activeCase = [name];
  return () => { activeCase = previous; };
}

function runtimeReply(stdout: unknown): boolean {
  const text = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : typeof stdout === 'string' ? stdout : '';
  const candidates = [text.trim(), text.slice(text.lastIndexOf('\n{') + 1).trim(), ...text.split(/\r?\n/)];
  for (const line of candidates) {
    const marker = line.indexOf('<<goal-run-result>>');
    try {
      const reply = JSON.parse(marker >= 0 ? line.slice(marker + '<<goal-run-result>>'.length) : line);
      if (reply && typeof reply === 'object' && (marker >= 0 && !('driverError' in reply)
        || reply.type === 'goal_session_result' || reply.type === 'phase_execute_request')) return true;
    } catch { /* Human logs are not a public result. */ }
  }
  return false;
}
function unexpectedTermination(before: Snapshot[], root: string, value: unknown, thrown: unknown): string[] {
  const errors: string[] = [];
  const result = (value ?? thrown) as { status?: unknown; pid?: unknown; stdout?: unknown; signal?: unknown; code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } } | undefined;
  const transportError = result?.error ?? (value === undefined ? result : undefined);
  const childResult = typeof result?.pid === 'number' && (typeof result.status === 'number' || result.status === null);
  for (const now of snapshots(root)) {
    const old = before.find(row => row.dir === now.dir);
    const prior = new Map<string, number>();
    for (const row of records(old?.events ?? Buffer.alloc(0))) { const key = JSON.stringify(row); prior.set(key, (prior.get(key) ?? 0) + 1); }
    const added = records(now.events).filter(row => { const key = JSON.stringify(row), count = prior.get(key) ?? 0; if (!count) return true; prior.set(key, count - 1); return false; });
    const changed = !old || !now.events.equals(old.events) || !now.control.equals(old.control);
    if (!changed) continue;
    const handoff = added.some(row => row.type === 'handoff_requested' || row.type === 'handoff_accepted');
    let owner: { state?: string } | undefined;
    try { owner = JSON.parse(now.control.toString('utf8')).owner; } catch { /* No owner was created before an entry rejection. */ }
    if (owner?.state === 'quiescing' && !handoff) errors.push(`unexpected quiesce: ${now.dir}`);
    const ends = added.filter(row => row.type === 'run_end');
    const started = added.some(row => ['run_start', 'resume', 'agent_invoke_start', 'agent_process_bound', 'harness_start'].includes(String(row.type)));
    for (const end of ends) if (end.status === 'INTERRUPTED') errors.push(`interrupted: ${end.reason ?? ''} ${end.error ?? ''}`);
    if (thrown && !ends.length && started) errors.push(`unfinished invocation: ${String(thrown)}`);
    if (childResult && !result?.signal && result?.status !== 0 && started && !ends.length && !handoff && !runtimeReply(result?.stdout)) errors.push(`test child exited without runtime result: ${now.dir}`);
  }
  if (childResult && result?.signal) errors.push(`test child terminated by signal: ${String(result.signal)}`);
  if (childResult && transportError?.code === 'ETIMEDOUT') errors.push(`test child timeout: ${transportError.message ?? ''}`);
  else if (childResult && typeof transportError?.code === 'string') errors.push(`test child transport error: ${transportError.code} ${transportError.message ?? ''}`);
  return errors;
}

/** One test-side entry for sync and async drivers. A settled WAITING/FAIL/yield is natural. */
export function withRuntimeTest<T>(options: RuntimeTestControl & { root: string }, action: () => T): T {
  const root = path.resolve(options.root), before = snapshots(root);
  const evidenceFiles = (options.evidenceFiles ?? []).map(file => {
    const resolved = path.resolve(root, file);
    if (!within(root, resolved)) throw new Error(`test evidence file is outside fixture root: ${file}`);
    return resolved;
  });
  const caseNames = [...activeCase];
  const timeoutMs = testTimeout(options.timeoutMs, TEST_RUN_TIMEOUT_MS);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    recordRuntimeTestFailure(`test invocation timeout after ${timeoutMs}ms`, [root], caseNames, evidenceFiles);
    if (!process.send || !process.connected) {
      void import('../../scripts/utils/agent-invoke').then(async ({ killProcessTree }) => {
        await killProcessTree(process.pid); process.exit(1);
      });
    }
  }, timeoutMs);
  const finish = (value: unknown, thrown?: unknown): void => {
    clearTimeout(timer);
    const unexpected = unexpectedTermination(before, root, value, thrown);
    const expected = options.expectedInterruption;
    const unmatched = unexpected.filter(error => !expected || !error.includes(expected));
    if (timedOut || unexpected.some(error => error.startsWith('test child timeout:')) || unmatched.length) {
      const failure = recordRuntimeTestFailure(unmatched.join('\n') || unexpected.join('\n') || 'test invocation timed out', [root], caseNames, evidenceFiles,
        (value ?? thrown) as { stdout?: unknown; stderr?: unknown } | undefined);
      throw new Error(`${failure.error}\noriginals: ${failure.evidenceDir}`);
    }
  };
  let value: T;
  try { value = action(); } catch (error) { finish(undefined, error); throw error; }
  if (value && typeof (value as { then?: unknown }).then === 'function') return Promise.resolve(value).then(
    result => { finish(result); return result; }, error => { finish(undefined, error); throw error; },
  ) as T;
  finish(value); return value;
}

/** Let the common outlet inspect the full synchronous child result before callers throw or parse it. */
export function runRuntimeTestChild<T>(options: RuntimeTestControl & { root: string }, action: () => SpawnSyncReturns<T>): SpawnSyncReturns<T> {
  const result = withRuntimeTest(options, action);
  if (result.error) throw result.error;
  return result;
}
