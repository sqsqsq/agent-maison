// Fixture-only timing fault and external observer; all production verdicts stay native.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const rows = file => !fs.existsSync(file) ? [] : fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function instrumentSlowCompile(root) {
  fs.mkdirSync(path.join(root, 'observations'), { recursive: true });
  fs.appendFileSync(path.join(root, 'framework/profiles/generic/harness/coding-host-rules.js'), `
// Acceptance timing only: the original compiler and its result always execute.
const fs = require('fs'), path = require('path');
const compileOriginal = exports.profileCodingHost.checkCodingCompile;
exports.profileCodingHost.checkCodingCompile = ctx => {
  if (process.env.MAISON_GOAL_RUNNER !== '1' || !process.env.MAISON_GOAL_GATE_DEADLINE_MS) return compileOriginal(ctx);
  const log = path.join(ctx.projectRoot, 'observations/native-gates.jsonl');
  const prior = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse) : [];
  const livePrior = prior.filter(row => row.kind === 'enter' && row.pid !== process.pid && (() => { try { process.kill(row.pid, 0); return true; } catch { return false; } })());
  fs.appendFileSync(log, JSON.stringify({ kind: 'enter', pid: process.pid, ppid: process.ppid, phase: ctx.phase, live_prior_pids: livePrior.map(row => row.pid), at_ms: Date.now() }) + '\\n');
  if (prior.length === 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 12000);
  try { return compileOriginal(ctx); }
  finally { fs.appendFileSync(log, JSON.stringify({ kind: 'exit', pid: process.pid, phase: ctx.phase, at_ms: Date.now() }) + '\\n'); }
};
`);
}

async function observeAndInterrupt(root, evidenceFile, timeoutMs = 45 * 60_000) {
  assert.equal(process.platform, 'win32', 'this acceptance must exercise the real Windows guardian');
  assert(!fs.existsSync(evidenceFile), 'refusing to repeat a recorded interruption');
  const runDir = path.join(root, 'doc/features/clamp/goal-runs/session-cli');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = rows(path.join(runDir, 'events.jsonl'));
    const binding = [...events].reverse().find(event => event.type === 'harness_start' && event.phase === 'coding' && event.process_role === 'harness');
    const native = rows(path.join(root, 'observations/native-gates.jsonl'));
    const entered = native.find(row => row.kind === 'enter');
    if (binding && entered && events.some(event => event.type === 'agent_invoke_end' && event.phase === 'coding' && event.handoff_report)
      && !events.some(event => event.type === 'harness_end' && event.invoke_id === binding.invoke_id)) {
      const pid = Number(binding.pid); assert(Number.isSafeInteger(pid) && pid > 0);
      const script = `$taskGate=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if (!$taskGate) { throw 'bound guardian disappeared' }; $taskReporter=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$taskGate.ParentProcessId); [PSCustomObject]@{guardian_pid=$taskGate.ProcessId; guardian_started_ms=([DateTimeOffset]$taskGate.CreationDate).ToUnixTimeMilliseconds(); reporter_pid=$taskReporter.ProcessId; reporter_executable=$taskReporter.ExecutablePath; reporter_command=$taskReporter.CommandLine} | ConvertTo-Json -Compress`;
      const probe = cp.spawnSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      assert.equal(probe.status, 0, probe.stderr);
      const identity = JSON.parse(probe.stdout.trim());
      assert.equal(identity.guardian_pid, pid);
      assert(Math.abs(identity.guardian_started_ms - Number(binding.started_at_ms)) < 2000, 'guardian PID identity changed');
      assert.equal(identity.reporter_executable.toLowerCase(), process.execPath.toLowerCase());
      const command = identity.reporter_command.replace(/\\/g, '/').toLowerCase();
      assert(command.includes(root.replace(/\\/g, '/').toLowerCase()) && command.includes('goal-mode-entry.ts')
        && command.includes('--report-result') && command.includes('--request'), 'bound guardian parent is not this report CLI');
      const target = Number(identity.reporter_pid); assert(Number.isSafeInteger(target) && target > 0);
      const killArgv = ['/PID', String(target), '/F'];
      const killed = cp.spawnSync('taskkill.exe', killArgv, { encoding: 'utf8', timeout: 10_000, windowsHide: true });
      const evidence = { at: new Date().toISOString(), root, binding, native_enter: entered, identity, kill_argv: ['taskkill.exe', ...killArgv],
        kill_status: killed.status, stdout: killed.stdout, stderr: killed.stderr,
        boundary: 'Only the bound report CLI parent is killed once. Production Windows guardian, containment, report acceptance, gates and finalizer remain unchanged; the real Claude session must recover itself.' };
      write(evidenceFile, evidence);
      assert.equal(killed.status, 0, killed.stderr + killed.stdout);
      return evidence;
    }
    await pause(50);
  }
  throw new Error('No accepted coding report entered its real delayed gate before the observer deadline');
}

function assertInterruptedCodingReuse(events, cut) {
  const invoke = cut.binding.invoke_id;
  assert.equal(events.filter(event => event.type === 'agent_invoke_start' && event.phase === 'coding' && event.invoke_id === invoke).length, 1,
    'the interrupted accepted coding invocation must have one original start');
  assert.equal(events.filter(event => event.type === 'agent_invoke_end' && event.phase === 'coding' && event.invoke_id === invoke && event.handoff_report).length, 1);
  const gateIndex = events.findIndex(event => event.type === 'harness_start' && event.invoke_id === invoke && event.pid === cut.binding.pid && event.ts === cut.binding.ts);
  assert(gateIndex >= 0, 'the interrupted gate must be present in production events');
  const passOffset = events.slice(gateIndex + 1).findIndex(event => event.type === 'phase_verdict' && event.phase === 'coding' && event.verdict === 'PASS');
  assert(passOffset >= 0, 'coding must formally pass after its interrupted gate');
  const recovery = events.slice(gateIndex + 1, gateIndex + passOffset + 2);
  assert(!recovery.some(event => event.type === 'agent_invoke_start' && event.phase === 'coding'), 'interrupted accepted coding author was replayed before formal PASS');
  assert(recovery.some(event => event.type === 'harness_start' && event.invoke_id === invoke), 'the same accepted invocation must resume its gate');
  return invoke;
}

function verifyCompletion(root, interruptionFile, outputFile) {
  const runDir = path.join(root, 'doc/features/clamp/goal-runs/session-cli');
  const events = rows(path.join(runDir, 'events.jsonl'));
  const native = rows(path.join(root, 'observations/native-gates.jsonl'));
  const cut = JSON.parse(fs.readFileSync(interruptionFile, 'utf8'));
  assert.equal(cut.kill_status, 0);
  const interruptedInvoke = assertInterruptedCodingReuse(events, cut);
  assert.equal(events.filter(event => event.type === 'run_end' && event.status === 'CHAIN_SLICE_COMPLETED').length, 1);
  assert(!events.some(event => event.type === 'agent_process_settled'), 'session cannot fake process settlement');
  assert(native.filter(event => event.kind === 'enter').length >= 2, 'recovery must rerun the real compiler gate');
  assert(native.every(event => !event.live_prior_pids?.length), 'native gates overlapped');
  const summaries = Object.fromEntries(['coding', 'review', 'ut'].map(phase => {
    const summary = JSON.parse(fs.readFileSync(path.join(root, `doc/features/clamp/${phase}/reports/summary.json`), 'utf8'));
    assert.equal(summary.verdict, 'PASS', phase + ' native gate');
    assert(summary.verifier_subject_id, phase + ' must have a bound independent-verifier subject');
    return [phase, summary];
  }));
  const tap = fs.readFileSync(path.join(root, 'doc/features/clamp/ut/reports/node-tests.tap'), 'utf8');
  assert(/^# tests 3$/m.test(tap) && /^# pass 3$/m.test(tap) && /^# fail 0$/m.test(tap) && /^# skipped 0$/m.test(tap), tap);
  const completionPath = path.join(runDir, 'feature-completion.json');
  const completion = JSON.parse(fs.readFileSync(completionPath, 'utf8'));
  const controlLog = fs.readFileSync(path.join(runDir, 'session-control.log'), 'utf8');
  assert.equal((controlLog.match(/^GOAL_RUN event=feature_completion_generated /gm) || []).length, 1);
  const result = { status: 'PASS', root, interruption: cut, interrupted_invoke: interruptedInvoke, completion_path: completionPath, completion,
    native_gate_observations: native, phase_summaries: summaries, node_tests_tap: tap,
    author_invokes: events.filter(event => event.type === 'agent_invoke_start').map(event => ({ phase: event.phase, invoke_id: event.invoke_id })),
    boundary: 'Actual model identities and independent verifier invocations must additionally be confirmed in the real Claude transcript; this verifier only reads production evidence.' };
  write(outputFile, result); return result;
}

module.exports = { instrumentSlowCompile, observeAndInterrupt, verifyCompletion, assertInterruptedCodingReuse };
if (require.main === module) {
  const [mode, root, evidence, output] = process.argv.slice(2);
  Promise.resolve(mode === 'observe' ? observeAndInterrupt(path.resolve(root), path.resolve(evidence))
    : mode === 'verify' ? verifyCompletion(path.resolve(root), path.resolve(evidence), path.resolve(output))
      : Promise.reject(new Error('Usage: session-cli-interruption.cjs observe <root> <interruption.json> | verify <root> <interruption.json> <result.json>')))
    .then(result => console.log(JSON.stringify(result)), error => { console.error(error.stack); process.exitCode = 1; });
}
