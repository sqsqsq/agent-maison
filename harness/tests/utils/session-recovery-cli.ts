/** Real next processes and OS PIDs; no author, verifier, verdict or gate substitute. */
import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import { prepareSessionCliProject } from './session-cli-project';
import { defaultProcessProbe } from '../../scripts/utils/device-session';

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const rows = (runDir: string): any[] => fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
function args(root: string): string[] {
  const harness = path.join(root, 'framework/harness');
  return [path.join(harness, 'node_modules/ts-node/dist/bin.js'), '--project', path.join(harness, 'tsconfig.json'),
    path.join(harness, 'scripts/goal-mode-entry.ts'), '--project-root', root, '--framework-root', path.join(root, 'framework'),
    '--feature', 'clamp', '--run-id', 'session-cli', '--adapter', 'claude', '--run-mode', 'attended'];
}
function environment(root: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(root, '.trust') };
  for (const key of Object.keys(env)) if (/^MAISON_GOAL_(?!CHECKPOINT_DIR)/i.test(key)) delete env[key];
  return env;
}
function next(root: string, extra: string[] = []): { status: number | null; value: any; output: string } {
  const result = spawnSync(process.execPath, [...args(root), ...extra], { cwd: path.join(root, 'framework/harness'), env: environment(root), encoding: 'utf8', timeout: 60_000, windowsHide: true });
  if (result.error) throw result.error;
  const line = result.stdout.trim().split(/\r?\n/).reverse().find(value => value.startsWith('{'));
  return { status: result.status, value: line ? JSON.parse(line) : null, output: result.stderr + result.stdout };
}

export async function junctionSessionCli(): Promise<void> {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-junction-cli-'));
  const root = path.join(container, 'actual project'), alias = path.join(container, 'alias project');
  const previousTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  try {
    prepareSessionCliProject(root, 'claude', false);
    fs.symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const runRelative = 'doc/features/clamp/goal-runs/session-cli';
    const runDir = path.join(root, runRelative), aliasRun = path.join(alias, runRelative);
    assert.notEqual(alias, root); assert.equal(fs.realpathSync(alias), fs.realpathSync(root));
    // Both calls execute the copied production CLI; the first passes the junction as --project-root.
    const first = next(alias, ['--next']);
    assert.equal(first.status, 0, first.output); assert.equal(first.value?.type, 'phase_execute_request', first.output);
    const originalBytes = fs.readFileSync(first.value.request.path);
    const request = JSON.parse(originalBytes.toString('utf8'));
    const signed = rows(aliasRun).find(event => event.type === 'phase_start' && event.handoff_request);
    assert(signed);
    const realRequestPath = path.join(runDir, signed.handoff_request.path);
    assert.equal(fs.realpathSync(first.value.request.path), fs.realpathSync(realRequestPath));
    assert.equal(fs.realpathSync(request.context.projectRoot), fs.realpathSync(root));
    const beforeReplay = fs.readFileSync(path.join(runDir, 'events.jsonl'));
    const replay = next(root, ['--next']);
    assert.equal(replay.status, 0, replay.output); assert.equal(replay.value?.type, 'phase_execute_request', replay.output);
    assert.equal(replay.value.request.sha256, first.value.request.sha256);
    assert(fs.readFileSync(replay.value.request.path).equals(originalBytes));
    assert(fs.readFileSync(path.join(runDir, 'events.jsonl')).equals(beforeReplay), 'the canonical alias must read the same signed request without dispatch');
    const report = { phase: request.context.phase, status: 'waiting', details: 'CLI junction regression intentionally waits before author execution' };
    const parked = next(alias, ['--request', realRequestPath, '--report-result', JSON.stringify(report)]);
    assert.equal(parked.status, 0, parked.output);
    assert.equal(parked.value?.type, 'goal_session_result', parked.output); assert.equal(parked.value.result.status, 'waiting', parked.output);
    const acceptedBytes = fs.readFileSync(path.join(runDir, 'events.jsonl'));
    const duplicate = next(root, ['--request', realRequestPath, '--report-result', JSON.stringify(report)]);
    assert.equal(duplicate.status, 0, duplicate.output); assert.equal(duplicate.value?.duplicate, true, duplicate.output);
    assert(fs.readFileSync(path.join(aliasRun, 'events.jsonl')).equals(acceptedBytes), 'both aliases must see the same idempotently consumed report');
    const events = rows(runDir);
    assert.deepEqual(rows(aliasRun), events);
    assert.equal(events.filter(event => event.type === 'agent_invoke_start').length, 1);
    assert.equal(events.filter(event => event.type === 'agent_invoke_end' && event.handoff_report).length, 1);
    assert.equal(events.find(event => event.type === 'agent_invoke_end').invoke_id, request.invoke_id);
    assert(!events.some(event => event.type === 'harness_start'), 'a waiting executor has not earned a formal gate');
    assert(!fs.existsSync(path.join(runDir, 'feature-completion.json')));
  } finally {
    if (fs.existsSync(alias)) fs.unlinkSync(alias);
    if (previousTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousTrust;
    fs.rmSync(container, { recursive: true, force: true });
  }
}

export async function interruptedIssuanceCli(): Promise<void> {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-issuance-cli-'));
  const previousTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  try {
    for (const cut of ['throw', 'kill'] as const) {
      const root = path.join(container, cut);
      prepareSessionCliProject(root, 'claude', false);
      const runDir = path.join(root, 'doc/features/clamp/goal-runs/session-cli');
      const marker = path.join(root, 'issuance-cut.json');
      const preload = path.join(root, 'issuance-cut.cjs');
      // Stop immediately before the production append commits the signed request.
      fs.writeFileSync(preload, `const fs=require('fs'); const append=fs.appendFileSync;
fs.appendFileSync=function(file, bytes, ...rest) {
  if (String(file).endsWith('events.jsonl') && String(bytes).includes('"handoff_request"') && String(bytes).includes('"driver":"session"')) {
    fs.writeFileSync(${JSON.stringify(marker)}, String(bytes));
    ${cut === 'throw' ? 'throw new Error("fixture interrupted request commit");' : 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);'}
  }
  return append.call(fs,file,bytes,...rest);
};\n`);
      const child = spawn(process.execPath, ['-r', preload, ...args(root), '--next'], { cwd: path.join(root, 'framework/harness'), env: environment(root), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout?.on('data', bytes => { output += bytes.toString(); }); child.stderr?.on('data', bytes => { output += bytes.toString(); });
      const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', () => resolve()); });
      try {
        const deadline = Date.now() + 30_000;
        while (!fs.existsSync(marker) && child.exitCode === null && Date.now() < deadline) await pause(25);
        assert(fs.existsSync(marker), `the real next process did not reach the request commit: ${output}`);
        if (cut === 'kill') {
          assert(child.pid && child.exitCode === null);
          if (process.platform === 'win32') {
            const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/F'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
            assert.equal(killed.status, 0, killed.stderr + killed.stdout);
          } else assert(child.kill('SIGKILL'));
        }
        await exited;
      } finally { if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; } }
      const barrier = JSON.parse(fs.readFileSync(marker, 'utf8'));
      const before = rows(runDir), started = before.find(event => event.type === 'agent_invoke_start');
      assert(started && started.command === 'phase_execute_request');
      assert(!before.some(event => event.handoff_request || event.type === 'agent_process_bound'));
      const recovered = next(root, ['--next']);
      assert.equal(recovered.status, 0, recovered.output);
      assert.equal(recovered.value?.type, 'phase_execute_request', recovered.output);
      const issued = JSON.parse(fs.readFileSync(recovered.value.request.path, 'utf8'));
      assert.equal(issued.invoke_id, started.invoke_id, 'recovery must reuse the original invocation');
      assert.equal(issued.context.attemptId, barrier.attempt_id, 'recovery must not allocate another attempt');
      assert.equal(issued.issued_at, started.ts, 'recovery must not renew the start or deadline');
      assert.equal(rows(runDir).filter(event => event.type === 'agent_invoke_start').length, 1);
      assert(!rows(runDir).some(event => event.type === 'legacy_run_override' || event.type === 'force_takeover'));
    }
  } finally {
    if (previousTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousTrust;
    fs.rmSync(container, { recursive: true, force: true });
  }
}

export async function reusedGatePidCli(systemProcess = false): Promise<void> {
  if (systemProcess && process.platform !== 'win32') return;
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-reused-gate-cli-'));
  const root = path.join(container, 'project');
  const previousTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
  const unrelated = systemProcess ? null : spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { windowsHide: true, stdio: 'ignore', detached: process.platform !== 'win32' });
  const exited = unrelated ? new Promise<void>((resolve, reject) => { unrelated.once('error', reject); unrelated.once('exit', () => resolve()); }) : Promise.resolve();
  const readSystemProcess = (): { pid: number; startedAtMs: number; executable: string } => {
    const query = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process -Filter "Name=\'services.exe\'" | Select-Object ProcessId, @{Name="startedAtMs";Expression={([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()}} | ConvertTo-Json -Compress'],
    { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    assert.equal(query.status, 0, query.stderr);
    const observed = JSON.parse(query.stdout.trim());
    assert(Number.isInteger(observed.ProcessId) && observed.ProcessId > 0);
    return { pid: observed.ProcessId, startedAtMs: observed.startedAtMs, executable: process.execPath };
  };
  try {
    prepareSessionCliProject(root, 'claude', false);
    const runDir = path.join(root, 'doc/features/clamp/goal-runs/session-cli');
    const first = next(root, ['--next']); assert.equal(first.status, 0, first.output);
    assert.equal(first.value?.type, 'phase_execute_request', first.output);
    const request = JSON.parse(fs.readFileSync(first.value.request.path, 'utf8'));
    const actual = systemProcess ? readSystemProcess() : process.platform === 'win32' ? defaultProcessProbe().identify(unrelated!.pid!) : {
      pid: unrelated!.pid!,
      startedAtMs: Date.parse(spawnSync('ps', ['-p', String(unrelated!.pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 5000 }).stdout.trim()),
      executable: process.execPath,
    };
    assert(actual, 'the unrelated live child must have a real OS identity');
    assert(Number.isFinite(actual.startedAtMs));
    if (systemProcess) {
      // 普通权限实测 identify=null 覆盖 fallback；管理员可读完整身份时仍跑同一真实 CLI。
      assert.equal(defaultProcessProbe().readStartedAtMs?.(actual.pid), actual.startedAtMs, 'the shared probe must agree with the actual SYSTEM CreationDate');
    }
    fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), type: 'harness_start', phase: request.context.phase,
      invoke_id: `${request.context.phase}-${request.context.attemptId}`, process_role: 'harness', run_id: request.context.runId,
      pid: actual.pid, started_at_ms: actual.startedAtMs - 1000, executable: actual.executable, token: 'expired-native-gate-token' }) + '\n');
    const resumed = next(root, ['--request', first.value.request.path, '--report-result', JSON.stringify({ phase: request.context.phase, status: 'failed', details: 'fixture author did not implement the product; real gate must decide' })]);
    const events = rows(runDir);
    assert(!events.some(event => event.type === 'run_end' && event.status === 'INTERRUPTED'), resumed.output);
    assert(events.some(event => event.type === 'harness_start' && event.process_role === 'harness' && event.pid !== actual.pid), 'the production gate must actually spawn after the stale PID is classified');
    assert(events.some(event => event.type === 'harness_end'), 'the new production gate must settle normally');
    if (unrelated) assert.equal(unrelated.exitCode, null, 'the unrelated live process must never be killed');
    if (systemProcess) assert.deepEqual(readSystemProcess(), actual, 'SYSTEM survives with the same PID/CreationDate, verified read-only');
    assert.equal(events.filter(event => event.type === 'agent_invoke_start' && event.invoke_id === request.invoke_id).length, 1);
  } finally {
    if (unrelated && unrelated.exitCode === null && unrelated.signalCode === null) unrelated.kill();
    await exited;
    if (previousTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = previousTrust;
    assert(path.resolve(container).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(container, { recursive: true, force: true });
  }
}
