import '../utils/transpile-only-env';
import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as YAML from 'yaml';
import { createHash } from 'crypto';
import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { withFreshCuHost } from './lifecycle-evolution.unit.test';
import { CU_REQUIREMENT, CU_SOURCE, writeCuPlanMaterials, writeCuCodingMaterials } from './real-chain.unit.test';
import { buildGoalManifestFromInput, buildInitialDesignGoalManifest, isInitialDesignManifest, type InitialDesignGoalManifest, type GoalManifest } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { prepareFeatureScopeCandidate } from '../../scripts/utils/feature-track';
import { prepareGoalModeRun, runGoalModeSessionStep } from '../../scripts/goal-mode-entry';
import { deriveChangeUnitFeatureId, enumerateCanonicalChangeUnits } from '../../scripts/utils/change-unit-path';
import { clearFrameworkConfigCache, featureFilePath } from '../../config';
import { readOriginalDeliveryBudget } from '../../scripts/utils/delivery-origin';
import { projectInitialDesignDelivery } from '../../scripts/utils/initial-design-delivery';
import { readSessionExecution, acceptedSessionReport, type SessionExecutionRequest } from '../../scripts/utils/session-execution-handoff';
import { readLockRecord, isLockStale, FEATURE_LOCK_NAME } from '../../scripts/utils/goal-run-lock';
import { readRunControl } from '../../scripts/utils/goal-run-control';
import { matchesUnitCase, selectedUnitCases, startCaseTiming, type UnitExecutionTiming } from '../utils/unit-case-selection';
import type { UnitCaseResult } from '../run-unit';

const BLUEPRINT = 'ledger-app-blueprint';
const ROOT_ID = 'control-root', CHILD_ID = 'control-child';
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const json = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));
const rows = (file: string): Array<Record<string, any>> => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }) : [];
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const write = (root: string, rel: string, body: string) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
type Host = { root: string; frameworkRoot: string; harnessDir: string };
type Family = Host & { original: InitialDesignGoalManifest; child: GoalManifest; rootDir: string; childDir: string; feature: string; copiedSourceHashes: Record<string, string> };

async function withFamily(run: (family: Family) => Promise<void>, turns = 20): Promise<void> {
  await withFreshCuHost(async host => {
    const priorTrust = process.env.MAISON_GOAL_CHECKPOINT_DIR;
    process.env.MAISON_GOAL_CHECKPOINT_DIR = path.join(host.root, '.trust');
    try {
      const feature = deriveChangeUnitFeatureId(BLUEPRINT, 'ledger-refresh');
      const engineering = { ...host, feature, module: 'ledger', modulePath: 'src/ledger' };
      write(host.root, 'src/ledger/index.ets', "export { LedgerFeature } from './LedgerFeature';\n");
      writeCuPlanMaterials(engineering);
      fs.rmSync(featureFilePath(host.root, feature, 'context/facts.md'), { force: true });
      const original = buildInitialDesignGoalManifest({ feature: BLUEPRINT, run_id: ROOT_ID, adapter: 'codex', requirement: CU_REQUIREMENT,
        requirement_source_files: ['requirements/ledger.md'], initial_design: { completion_target: 'feature', requested_results: [CU_REQUIREMENT], requested_phases: ['coding'] },
        budget: { max_total_turns: turns, wall_clock_minutes: 120, max_retries_per_phase: 2 },
        unattended: { write_mode: 'full-access', approval_mode: 'never', timeout_seconds: 900 } }, { projectRoot: host.root });
      createGoalRun({ projectRoot: host.root, manifest: original, chain: [] });
      prepareFeatureScopeCandidate({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature, completionTarget: 'request',
        requestedResults: ['coding'], requestedPhases: ['coding'], requirement: CU_REQUIREMENT, requirementSourceFiles: ['requirements/ledger.md'], overwrite: true,
        impact: { userVisibleBehaviorChange: false, reason: 'Prepared nonvisual CU control fixture', basisPaths: [CU_SOURCE] } });
      const prepared = prepareGoalModeRun({ projectRoot: host.root, frameworkRoot: host.frameworkRoot, feature, runId: CHILD_ID, adapter: 'codex',
        requirement: CU_REQUIREMENT, requirementSourceFiles: ['requirements/ledger.md'], deliveryOrigin: { feature: BLUEPRINT, run_id: ROOT_ID } });
      assert(!isInitialDesignManifest(prepared.manifest));
      write(host.root, 'observations/provider-guard.cjs', `const rt=require(${JSON.stringify(path.join(host.harnessDir, 'scripts/goal-phase-runtime'))});rt.__testing_setInvokeAgent(async()=>{throw Error('Unexpected model in control test')});rt.__testing_setCanaryProbeInvoke(async()=>{throw Error('Unexpected canary in nonvisual control test')});\n`);
      const copiedSourceHashes = Object.fromEntries(['scripts/goal-mode-entry.ts', 'scripts/goal-phase-runtime.ts', 'scripts/utils/goal-run-lock.ts',
        'scripts/utils/goal-run-control.ts', 'scripts/utils/session-execution-handoff.ts', 'scripts/utils/initial-design-delivery.ts']
        .map(file => [file, sha(fs.readFileSync(path.join(host.harnessDir, file)))]));
      await run({ ...host, original, child: prepared.manifest as GoalManifest, rootDir: path.join(host.root, original.report_dir), childDir: prepared.runDir, feature, copiedSourceHashes });
    } finally {
      if (priorTrust === undefined) delete process.env.MAISON_GOAL_CHECKPOINT_DIR; else process.env.MAISON_GOAL_CHECKPOINT_DIR = priorTrust;
    }
  });
}

function cliArgs(f: Family, action: string[]): string[] {
  return [path.join(f.harnessDir, 'node_modules/ts-node/dist/bin.js'), '--project', path.join(f.harnessDir, 'tsconfig.json'),
    '--require', path.join(f.root, 'observations/provider-guard.cjs'), path.join(f.harnessDir, 'scripts/goal-mode-entry.ts'),
    '--project-root', f.root, '--framework-root', f.frameworkRoot, '--feature', BLUEPRINT, '--run-id', ROOT_ID,
    '--adapter', 'codex', '--run-mode', 'attended', '--authorize-autonomy', ...action];
}
function env(f: Family): NodeJS.ProcessEnv {
  const value: NodeJS.ProcessEnv = { ...process.env, MAISON_GOAL_CHECKPOINT_DIR: path.join(f.root, '.trust') };
  for (const key of Object.keys(value)) if (/^MAISON_GOAL_(?!CHECKPOINT_DIR)/i.test(key)) delete value[key];
  return value;
}
function cli(f: Family, action: string[], label: string): any {
  const result = spawnSync(process.execPath, cliArgs(f, action), { cwd: f.harnessDir, env: env(f), encoding: 'utf8', timeout: 90_000, windowsHide: true });
  write(f.root, `observations/${label}.stdout.log`, result.stdout || ''); write(f.root, `observations/${label}.stderr.log`, result.stderr || '');
  assert(!result.error, String(result.error));
  const line = result.stdout.trim().split(/\r?\n/).reverse().find(line => line.startsWith('{'));
  assert(line, result.stderr + result.stdout); const value = JSON.parse(line);
  assert.equal(result.status, typeof value.exit_code === 'number' ? value.exit_code : 0, `${result.stderr}\n${result.stdout}`);
  return value;
}
function ownedReporter(f: Family, child: ChildProcess, tree: boolean): void {
  if (!child.pid || !alive(child.pid)) return;
  if (process.platform === 'win32') {
    const probe = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter 'ProcessId = ${child.pid}' | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(probe.status, 0, probe.stderr); const processInfo = JSON.parse(probe.stdout.trim());
    assert.equal(processInfo.ExecutablePath.toLowerCase(), process.execPath.toLowerCase());
    const command = processInfo.CommandLine.replace(/\\/g, '/').toLowerCase();
    assert(command.includes(f.root.replace(/\\/g, '/').toLowerCase()) && command.includes('goal-mode-entry.ts') && command.includes('--report-result'));
    const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), ...(tree ? ['/T'] : []), '/F'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.equal(killed.status, 0, killed.stderr + killed.stdout);
  } else if (tree) process.kill(-child.pid, 'SIGKILL');
  else child.kill('SIGKILL');
}
function prepareCoding(f: Family, request: SessionExecutionRequest): void {
  assert.equal(request.context.phase, 'coding');
  writeCuCodingMaterials({ ...f, module: 'ledger', modulePath: 'src/ledger', runId: request.context.runId });
  const file = featureFilePath(f.root, f.feature, 'context/facts.md');
  const content = fs.readFileSync(file, 'utf8'), match = /^---\s*\n([\s\S]*?)\n---/.exec(content)!;
  const facts = YAML.parse(match[1]); const entry = 'src/ledger/index.ets';
  fs.readFileSync(path.join(f.root, entry)); facts.source_code_paths = [...new Set([...facts.source_code_paths, entry])];
  fs.writeFileSync(file, '---\n' + YAML.stringify(facts) + '---' + content.slice(match[0].length) + `\n| ${entry} | 已完整读取实际模块导出 | 编码保持公开入口 |\n`);
}
function delayedCompile(f: Family): void {
  const active = path.join(f.frameworkRoot, 'profiles/test-chain/harness/coding-host-rules.js');
  const generic = path.join(f.frameworkRoot, 'profiles/generic/harness/coding-host-rules.js');
  fs.copyFileSync(active, generic);
  require('../utils/session-cli-interruption.cjs').instrumentSlowCompile(f.root);
  const text = fs.readFileSync(generic, 'utf8'); assert.equal(text.split('0, 0, 12000').length - 1, 1);
  fs.writeFileSync(generic, text.replace('0, 0, 12000', '0, 0, 60000'));
  fs.writeFileSync(active, `module.exports=require(${JSON.stringify(generic)});\n`);
}

function preserve(f: Family, label: string, extra: Record<string, unknown>): string {
  const directory = path.resolve(__dirname, `../../reports/f3b8e6a1/${label}-${Date.now()}`);
  fs.mkdirSync(directory, { recursive: true });
  for (const file of ['first-next.stdout.log', 'first-next.stderr.log', 'busy-next.stdout.log', 'busy-next.stderr.log', 'report.stdout.log', 'report.stderr.log',
    'dead-pid-next.stdout.log', 'dead-pid-next.stderr.log', 'budget-next.stdout.log', 'budget-report.stdout.log', 'native-gates.jsonl']) {
    const source = path.join(f.root, 'observations', file); if (fs.existsSync(source)) fs.copyFileSync(source, path.join(directory, file));
  }
  fs.copyFileSync(path.join(f.rootDir, 'events.jsonl'), path.join(directory, 'root.events.jsonl'));
  fs.copyFileSync(path.join(f.childDir, 'events.jsonl'), path.join(directory, 'child.events.jsonl'));
  write(directory, 'evidence.json', JSON.stringify({ project_root: f.root, copied_source_hashes: f.copiedSourceHashes, ...extra }, null, 2) + '\n');
  return directory;
}

const cases: Array<{ name: string; run(): Promise<void> }> = [{
  name: 'N1 original CLI waits for a live child machine gate without false events and immediately recovers a dead reporter before its session lease expires',
  async run() { await withFamily(async f => {
    delayedCompile(f);
    const first = cli(f, ['--next'], 'first-next'); assert.equal(first.type, 'phase_execute_request', JSON.stringify(first));
    assert.equal(first.run_id, CHILD_ID); const request = json(first.request.path) as SessionExecutionRequest;
    prepareCoding(f, request);
    const out = fs.openSync(path.join(f.root, 'observations/report.stdout.log'), 'w'), err = fs.openSync(path.join(f.root, 'observations/report.stderr.log'), 'w');
    const reporter = spawn(process.execPath, cliArgs(f, ['--request', first.request.path, '--report-result', JSON.stringify({ phase: 'coding', status: 'passed' })]),
      { cwd: f.harnessDir, env: env(f), stdio: ['ignore', out, err], windowsHide: true, detached: process.platform !== 'win32' });
    fs.closeSync(out); fs.closeSync(err);
    const exited = new Promise<void>((resolve, reject) => { reporter.once('exit', () => resolve()); reporter.once('error', reject); });
    try {
      const nativeFile = path.join(f.root, 'observations/native-gates.jsonl'), childEvents = path.join(f.childDir, 'events.jsonl'), rootEvents = path.join(f.rootDir, 'events.jsonl');
      const deadline = Date.now() + 40_000;
      while (Date.now() < deadline && !rows(nativeFile).some(row => row.kind === 'enter')) {
        assert(reporter.pid && alive(reporter.pid), fs.readFileSync(path.join(f.root, 'observations/report.stderr.log'), 'utf8'));
        await pause(50);
      }
      assert(rows(nativeFile).some(row => row.kind === 'enter'), 'the original machine gate must enter its native compile seam');
      const pending = readSessionExecution(f.childDir); assert(pending && acceptedSessionReport(f.childDir, pending));
      const featureLock = featureFilePath(f.root, f.feature, path.join('goal-runs', FEATURE_LOCK_NAME));
      const held = readLockRecord(featureLock)!; assert.equal(held.pid, reporter.pid); assert(!isLockStale(held));
      const rootBefore = fs.readFileSync(rootEvents), childBefore = rows(childEvents);
      const second = cli(f, ['--next'], 'busy-next');
      assert.equal(second.type, 'goal_session_result'); assert.equal(second.result.status, 'waiting');
      assert.equal(second.exit_code, 0); assert.equal(second.result.exit_code, 3);
      assert.equal(second.result.current.feature, f.feature); assert.equal(second.result.current.run_id, CHILD_ID);
      const rootAfterBusy = fs.readFileSync(rootEvents);
      assert.deepEqual(rootAfterBusy, rootBefore, 'busy next must not append a synthetic root terminal or start');
      assert.equal(rows(childEvents).filter(row => row.type === 'agent_invoke_start').length, childBefore.filter(row => row.type === 'agent_invoke_start').length);
      const oldControl = readRunControl(f.childDir, CHILD_ID)!;
      assert.equal(oldControl.owner?.kind, 'session'); assert(Date.parse(oldControl.owner!.lease_expires_at!) > Date.now());
      ownedReporter(f, reporter, false); await exited;
      assert(isLockStale(readLockRecord(featureLock)!));
      const leaseDeadline = Date.parse(oldControl.owner!.lease_expires_at!); assert(leaseDeadline > Date.now());
      const resumedAt = Date.now(); const resumed = cli(f, ['--next'], 'dead-pid-next');
      const after = rows(childEvents), native = rows(nativeFile);
      assert(native.filter(row => row.kind === 'enter').length >= 2, 'dead PID must immediately rejoin the accepted gate rather than wait for the logical lease');
      assert(resumedAt < leaseDeadline, 'the resume began before lease expiry');
      assert(native.filter(row => row.kind === 'enter')[1].at_ms < leaseDeadline, 'the replacement machine gate must actually enter before the still-valid lease expires');
      assert.equal(after.filter(row => row.type === 'agent_invoke_start' && row.phase === 'coding').length, 1, 'the accepted coding author is not replayed');
      assert(native.every(row => !row.live_prior_pids?.length), 'the original guardian must settle before its replacement gate runs');
      assert(!rows(rootEvents).some(row => row.type === 'run_end' && row.status === 'INTERRUPTED'));
      for (const [file, hash] of Object.entries(f.copiedSourceHashes)) assert.equal(sha(fs.readFileSync(path.join(f.harnessDir, file))), hash, 'all control processes must use one unchanged copied kernel');
      const artifacts = preserve(f, 'control-live-dead', { root_before_sha256: sha(rootBefore), root_after_busy_sha256: sha(rootAfterBusy), held_feature_lock: held, session_control_before_kill: oldControl,
        lease_deadline: new Date(leaseDeadline).toISOString(), resumed_at: new Date(resumedAt).toISOString(), native });
      write(artifacts, 'root.events.before.jsonl', rootBefore.toString('utf8')); write(artifacts, 'root.events.after-busy.jsonl', rootAfterBusy.toString('utf8'));
      write(path.resolve(__dirname, '../../..'), 'harness/reports/f3b8e6a1/initial-design-control-process.json', JSON.stringify({ status: 'PASS', root: f.root, first, busy: second, resumed,
        artifacts, copied_source_hashes: f.copiedSourceHashes,
        lease_deadline: new Date(leaseDeadline).toISOString(), resumed_at: new Date(resumedAt).toISOString(), native,
        boundary: 'Prepared CU control counterexample only. Real public CLI, locks, report acceptance, original harness/checkers and process guardian; bounded model and compile-tool transport substitutes. No paid model or device.' }, null, 2) + '\n');
    } finally { if (reporter.pid && alive(reporter.pid)) { ownedReporter(f, reporter, true); await exited; } }
  }); },
}, {
  name: 'N2 N3 public child budget halt exposes the real root manifest recovery guidance and shared projection fields',
  async run() { await withFamily(async f => {
    const first = cli(f, ['--next'], 'budget-next'); assert.equal(first.type, 'phase_execute_request', JSON.stringify(first));
    assert.equal(first.run_id, CHILD_ID); assert.equal(readOriginalDeliveryBudget(f.root, f.original)!.totalTurns, 1);
    const stopped = cli(f, ['--request', first.request.path, '--report-result', JSON.stringify({ phase: first.phase, status: 'failed', details: 'Control fixture author failed within the original one-call allowance.' })], 'budget-report');
    assert.equal(stopped.type, 'goal_session_result'); assert.equal(stopped.result.halt_reason, 'budget_turns');
    const view = projectInitialDesignDelivery({ projectRoot: f.root, frameworkRoot: f.frameworkRoot, manifest: f.original });
    assert.equal(view.status, 'HALTED'); assert.equal(view.complete, false);
    assert.deepEqual(stopped.result.recovery, view.recovery); assert.deepEqual(stopped.result.issues, view.issues); assert.deepEqual(stopped.result.current, view.current);
    assert.equal(stopped.result.halt_reason, view.halt_reason); assert.equal(stopped.result.next_action, view.next_action);
    const guidance = JSON.stringify(stopped.result.recovery);
    assert(guidance.includes(path.join(f.rootDir, 'manifest.json').replace(/\\/g, '\\\\')) || guidance.includes(path.join(f.rootDir, 'manifest.json').replace(/\\/g, '/')), guidance);
    assert(guidance.includes(ROOT_ID) && guidance.includes(BLUEPRINT), guidance);
    assert(!guidance.includes(path.join(f.childDir, 'manifest.json').replace(/\\/g, '\\\\')), 'child-only budget edits cannot be presented as the release condition');
    assert.equal(readOriginalDeliveryBudget(f.root, f.original)!.totalTurns, 1);
    preserve(f, 'control-budget', { first, stopped, shared_projection: view });
  }, 1); },

}];

export function getCases() { return cases; }
export async function runSelectedCases(filter?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const test of cases) {
    if (!matchesUnitCase(test.name, filter)) continue;
    const finish = startCaseTiming([test.name], timings);
    try { await test.run(); results.push({ name: test.name, ok: true }); }
    catch (error) { results.push({ name: test.name, ok: false, error: (error as Error).stack ?? String(error) }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, filter, timings);
}
export async function runAll() { return (await runSelectedCases()).results; }
