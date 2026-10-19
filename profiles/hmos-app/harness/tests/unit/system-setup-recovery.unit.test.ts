import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { parseLockScreenTree, readLockScreenSnapshot } from '../../../../../harness/scripts/utils/device-readiness-deps';
import { ensureDeviceReady, evaluateDeviceReadinessProbe } from '../../../../../harness/scripts/utils/device-readiness-gate';
import { ensureDeviceReadyAtRuntime } from '../../../../../harness/scripts/utils/device-runtime-recovery';
import { credentialRefOf } from '../../../../../harness/scripts/utils/device-credential-store';
import { FakeCredentialProvider } from '../../../../../harness/tests/helpers/fake-credential-provider';
import { DEVICE_SETUP_GUIDANCE, type UnlockDeps } from '../../../../../harness/scripts/utils/device-unlock-helper';
import { buildSummaryBlockers } from '../../../../../harness/scripts/utils/summary-blockers';
import { resolveVerdictFromChecks } from '../../../../../harness/scripts/utils/report-generator';
import { checkUtHvigorTest, utBuildCollectorKey } from '../../ut-host-impl';
import { buildUtHvigorTestFailDetails } from '../../ut-hvigor-test-failure';
import { runAaTest, resetHdcExecutableCache, resetHdcServerWarmState } from '../../hdc-runner';
import { listExecutionKeyRuns } from '../../execution-key';
import { withDefaultLayoutFields } from '../../../../../harness/tests/utils/layout-test-helper';
import type { CheckContext, CheckResult } from '../../../../../harness/scripts/utils/types';
import type { HvigorRunResult } from '../../hvigor-runner';

const repo = path.resolve(__dirname, '../../../../..');
const fixture = path.join(repo, 'harness/tests/fixtures/host-recovery-history/20261018-oobe');
export const oobeTree = () => JSON.parse(require('zlib').gunzipSync(fs.readFileSync(path.join(fixture, 'testing-oobe.json.gz'))).toString('utf8')).tree;
const lockedTree = () => JSON.parse(fs.readFileSync(path.join(fixture, 'readiness-layout.json'), 'utf8'));
const clearTree = () => { const tree = oobeTree(); tree.children[0].attributes.bundleName = 'example.normal.app'; return tree; };
const rawResult = (): HvigorRunResult => JSON.parse(fs.readFileSync(path.join(fixture, '20261018T080553Z-115/frozen.ut-result.WalletMain.json'), 'utf8'));
const cases: Array<{ name: string; run: () => void | Promise<void> }> = [];
const test = (name: string, run: () => void | Promise<void>) => cases.push({ name, run });

test('395 raw evidence hashes and focused windows: guide, lock cover, ordinary app, unfocused guide', () => {
  const sources = JSON.parse(fs.readFileSync(path.join(fixture, 'sources.json'), 'utf8'));
  for (const file of sources.sources) {
    const bytes = fs.readFileSync(path.join(fixture, file.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
    if (file.encoding === 'gzip') assert.equal(crypto.createHash('sha256').update(require('zlib').gunzipSync(bytes)).digest('hex'), file.source_sha256);
  }
  assert.equal(parseLockScreenTree(oobeTree()).systemSetup?.bundleName, 'com.huawei.hmos.hwstartupguide');
  assert.equal(parseLockScreenTree(lockedTree()).locked, true);
  assert(!parseLockScreenTree(lockedTree()).systemSetup);
  assert(!parseLockScreenTree(clearTree()).systemSetup);
  const background = oobeTree(); background.children[0].attributes.focused = 'false';
  assert(!parseLockScreenTree(background).systemSetup);
  const calls: string[][] = [];
  const snapshot = readLockScreenSnapshot('fixture', args => { calls.push(args); return { ok: true, out: args.includes('dumpLayout') ? '/data/local/tmp/layout_123.json' : JSON.stringify(oobeTree()) }; });
  assert(snapshot.systemSetup);
  assert.deepEqual(calls.map(a => a.slice(2, 4)), [['shell', 'uitest'], ['shell', 'cat']]);
  assert.equal(readLockScreenSnapshot('fixture', () => ({ ok: false, out: '' })).locked, undefined);
});

test('395 entry gate re-samples after unlock; probe remains read-only and original gate retains OOBE', async () => {
  let unlocked = false, unlocks = 0;
  const snapshot = () => parseLockScreenTree(unlocked ? oobeTree() : lockedTree());
  const input = { emulatorFallback: 'disabled' as const, deps: {
    listTargets: () => ['fixture'], wake: () => {}, isLocked: () => !unlocked, snapshot,
    unlockWithCredential: () => { unlocks++; unlocked = true; return { ok: true, note: 'fixture unlock' }; },
  } };
  const lockProbe = evaluateDeviceReadinessProbe({ targets: ['fixture'], snapshot: snapshot(), credentialReady: true });
  assert.equal(unlocks, 0);
  assert(!snapshot().systemSetup);
  const gate = await ensureDeviceReady(input);
  assert.equal(gate.state, 'BLOCKED'); assert.equal(unlocks, 1);
  assert(gate.state === 'BLOCKED' && gate.reason === DEVICE_SETUP_GUIDANCE);
  assert.equal(evaluateDeviceReadinessProbe({ targets: ['fixture'], snapshot: snapshot() }).ready, false);
  assert(lockProbe.reason, '锁屏探针保留原语义');
  assert.equal(evaluateDeviceReadinessProbe({ targets: ['fixture'], snapshot: parseLockScreenTree(clearTree()) }).ready, true);
  assert.equal(evaluateDeviceReadinessProbe({ targets: [], snapshot: parseLockScreenTree(clearTree()) }).ready, false);
});

test('395 runtime bridge unlock uses fresh snapshot and never reports ready while guide is visible', () => {
  const id = { serial: '395-fixture', version: 1 }; let unlocked = false, taps = 0;
  const provider = new FakeCredentialProvider({ onClick: () => { taps++; unlocked = true; return true; } });
  provider.seedReady(id, '123456');
  const keypad = JSON.parse(fs.readFileSync(path.join(repo, 'harness/tests/fixtures/device-lockscreen/keypad-stable.json'), 'utf8'));
  const deps: UnlockDeps = { wake: () => {}, reveal: () => ({ ok: true, timedOut: false }), settle: () => {}, tap: () => {},
    snapshot: () => parseLockScreenTree(unlocked ? oobeTree() : keypad) };
  const result = ensureDeviceReadyAtRuntime({ serial: id.serial, credentialRef: credentialRefOf(id), deps, provider });
  assert(taps > 0); assert(!result.recovered && result.systemSetup); assert.equal(result.note, DEVICE_SETUP_GUIDANCE);
});

test('395 actual unsigned + no-result is not missing signed; known OOBE survives summary and real assertion still fails', () => {
  const result = rawResult(); assert.equal(result.onDeviceFailureEvidence?.unsignedPresent, true);
  const unknown = buildUtHvigorTestFailDetails([{ module: 'WalletMain', result }]);
  assert(!/signed 缺失|仅产出 unsigned|签名环境缺口/.test(unknown.lines[0]));
  result.onDeviceFailureEvidence!.runDiagnosis!.systemSetup = parseLockScreenTree(oobeTree()).systemSetup;
  const blocked = buildUtHvigorTestFailDetails([{ module: 'WalletMain', result }]);
  assert.equal(blocked.lines[0], DEVICE_SETUP_GUIDANCE);
  const check: CheckResult = { id: 'ut_hvigor_test', severity: 'BLOCKER', status: 'FAIL', category: 'structure', description: 'UT',
    details: blocked.lines.join('\n'), failure_kind: blocked.failureKind, blocking_class: blocked.blockingClass, device_setup: blocked.systemSetup };
  assert.equal(resolveVerdictFromChecks([{ ...check, id: 'ut_hvigor_build', status: 'PASS', device_setup: undefined }, check]), 'INCOMPLETE');
  assert.deepEqual(buildSummaryBlockers([check], s => s, () => undefined)[0].device_setup, blocked.systemSetup);
  result.testResult = { total: 1, passed: 0, failed: 1, skipped: 0, failures: [{ suite: 's', test: 't', message: 'assertion failed' }] };
  result.onDeviceFailureEvidence!.runDiagnosis!.kind = 'test_failed';
  assert.notEqual(buildUtHvigorTestFailDetails([{ module: 'WalletMain', result }]).blockingClass, 'externalBlocked');
});

test('395 aa test no-result diagnoses focused guide without whitelist line; crash remains code evidence', () => {
  const old = process.env.HARNESS_HDC_TARGET; process.env.HARNESS_HDC_TARGET = 'fixture';
  try {
    for (const crash of [false, true]) {
      let ls = 0;
      const aa = runAaTest({ bundleName: 'example.app', ohosTestModuleName: 'test', testRunner: '/runner', testTimeoutMs: 1000 }, undefined, args => {
        let stdout = '';
        if (args.includes('ls')) stdout = crash && ++ls > 1 ? 'jscrash-example.app-new' : '';
        else if (args.includes('dumpLayout')) stdout = '/data/local/tmp/layout_123.json';
        else if (args.some(a => a.includes('layout_123'))) stdout = JSON.stringify(oobeTree());
        else if (args.includes('cat')) stdout = 'ReferenceError: broken';
        else if (args.includes('test')) stdout = 'start ability successfully';
        return { stdout, stderr: '', status: 0, signal: null, pid: 0, output: [] };
      });
      if (crash) { assert.equal(aa.diagnosis?.kind, 'test_failed'); assert(!aa.diagnosis?.systemSetup); }
      else { assert(aa.diagnosis?.systemSetup); assert(aa.diagnosis?.summary.startsWith(DEVICE_SETUP_GUIDANCE)); }
    }
  } finally { if (old === undefined) delete process.env.HARNESS_HDC_TARGET; else process.env.HARNESS_HDC_TARGET = old; }
});

test('395 self-check and formal gate use real UT provider once; cleared guide with SAME key and attempt executes again', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-395-ut-'));
  const cp = require('child_process') as typeof import('child_process'); const spawn = cp.spawnSync;
  const env = { ...process.env }; let guide = false, aaCalls = 0, pass = false;
  const write = (rel: string, value: unknown) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); };
  try {
    fs.mkdirSync(path.join(root, 'workflows'));
    write('framework.config.json', { project_profile: { base: 'hmos-app' }, paths: { features: 'doc/features' } });
    write('build-profile.json5', { app: { products: [{ name: 'default' }] }, modules: [{ name: 'WalletMain', srcPath: './WalletMain', targets: [{ name: 'default' }] }] });
    write('AppScope/app.json5', { app: { bundleName: 'example.app' } });
    write('WalletMain/src/main/module.json5', { module: { name: 'WalletMain', type: 'har' } });
    write('WalletMain/src/ohosTest/module.json5', { module: { name: 'walletmain_test' } });
    write('WalletMain/src/ohosTest/ets/test/Example.test.ets', 'export function test() {}');
    write('WalletMain/build/default/outputs/ohosTest/WalletMain-ohosTest-signed.hap', 'immutable-test-package');
    Object.assign(process.env, { HARNESS_HDC_EXE: process.execPath, HARNESS_HDC_TARGET: 'fixture', MAISON_DEVICE_ATTEMPT_FROZEN: '1', MAISON_GOAL_RUN_ID: 'run-395', MAISON_GOAL_ATTEMPT_PHASE: 'ut', MAISON_GOAL_ATTEMPT: 'i1' });
    delete process.env.MAISON_DEVICE_CREDENTIAL_REF;
    cp.spawnSync = ((exe: string, args: string[] = [], opts: unknown) => {
      if (exe !== process.execPath) return spawn(exe, args, opts as never);
      let stdout = '';
      if (args.includes('targets')) stdout = 'fixture';
      else if (args.includes('dumpLayout')) stdout = '/data/local/tmp/layout_123.json';
      else if (args.some(a => a.includes('layout_123'))) stdout = JSON.stringify(guide ? oobeTree() : clearTree());
      else if (args.includes('install')) stdout = 'install bundle successfully.';
      else if (args.includes('test')) { aaCalls++; guide = !pass; stdout = pass ? 'OHOS_REPORT_RESULT: stream=Tests run: 1, Failure: 0, Error: 0, Pass: 1' : 'start ability successfully'; }
      return { stdout, stderr: '', status: 0, signal: null, pid: 0, output: [] };
    }) as typeof cp.spawnSync;
    resetHdcExecutableCache(); resetHdcServerWarmState();
    const ctx = withDefaultLayoutFields({ phase: 'ut', feature: 'unit', projectRoot: root,
      phaseRule: { phase: 'ut', structure_checks: {}, semantic_checks: {}, traceability_checks: {} },
      featureSpec: { feature: 'unit', contracts: { modules: [{ name: 'WalletMain', package_path: 'WalletMain', format: 'HAR' }] } },
      resolvedProfile: { name: 'hmos-app', profileDir: path.join(repo, 'profiles/hmos-app'), yaml: {}, phasesDisabled: new Set(),
        capabilities: { 'ut.run': { provider: 'hvigor_hypium', severity: 'BLOCKER' } }, personalPrerequisites: {} },
    } as unknown as CheckContext);
    const builds = new Map([[utBuildCollectorKey(root, 'WalletMain', 'default')!, { executed: true, exitCode: 0, errors: [], logExcerpt: 'BUILD SUCCESSFUL', durationMs: 0 }]]);
    const run = () => checkUtHvigorTest(ctx, [{ path: 'WalletMain/src/ohosTest/ets/test/Example.test.ets' }], [], builds);
    const first = run(); assert.equal(aaCalls, 1, JSON.stringify(first)); assert(first[0].device_setup);
    const liveGateInput = require('../../../../../harness/scripts/utils/device-readiness-deps').buildDeviceReadinessInput(root);
    assert.equal((await ensureDeviceReady(liveGateInput)).state, 'BLOCKED', '生产 deps.snapshot 必须接通');
    const recorded = JSON.parse(fs.readFileSync(path.join(fixture, 'ut-script-report.json'), 'utf8'));
    const fullChecks: CheckResult[] = recorded.checks.map((c: CheckResult) => c.id === 'ut_hvigor_test' ? first[0] : c);
    const blockers = buildSummaryBlockers(fullChecks, s => s, () => undefined);
    assert.equal(blockers.length, 1, JSON.stringify(blockers));
    assert.equal(blockers[0].blocking_class, 'externalBlocked');
    assert.equal(resolveVerdictFromChecks(fullChecks), 'INCOMPLETE');
    const reports = path.join(root, 'doc/features/unit/ut/reports');
    const before = listExecutionKeyRuns(reports, 'ut'); assert.equal(before.length, 1);
    const saved = fs.readFileSync(path.join(before[0].runDir, 'execution-key.json'), 'utf8');
    const closed = run(); assert.equal(aaCalls, 1, JSON.stringify(closed)); assert.equal(closed[0].status, 'FAIL');
    assert(closed[0].details.includes('采纳同次调用失败'));
    assert.equal(fs.readFileSync(path.join(before[0].runDir, 'execution-key.json'), 'utf8'), saved);
    assert(require('../../device-recovery-bridge').recoverAfterLockFailure(root, 'fixture').systemSetup, '运行期解锁后暴露引导的观察不丢失');
    const testing = require('../../../../../harness/scripts/check-testing') as typeof import('../../../../../harness/scripts/check-testing');
    const visual = testing.runDeviceVisualDiffCapture(ctx, {} as never, {} as never);
    assert(visual[0].device_setup && visual[0].blocking_class === 'externalBlocked');
    const { observeSetupForUnexecutedTrace } = require('../../providers/device-test-run') as typeof import('../../providers/device-test-run');
    assert(observeSetupForUnexecutedTrace({ schema_version: '0.4-p0', feature: 'f', phase: 'testing', outcome: 'failed', cases: [{ id: 'TC-1', status: '失败', steps: [{ role: 'action', outcome: { status: 'failed' } }] as never }] }));
    assert(!observeSetupForUnexecutedTrace({ schema_version: '0.4-p0', feature: 'f', phase: 'testing', outcome: 'failed', cases: [{ id: 'TC-1', status: '失败', steps: [{ role: 'assertion', outcome: { status: 'failed' } }] as never }] }));
    guide = false; pass = true;
    const recovered = run(); assert.equal(aaCalls, 2, JSON.stringify(recovered)); assert.equal(recovered[0].status, 'PASS');
    const after = listExecutionKeyRuns(reports, 'ut'); assert.equal(after[0].record.execution_key, before[0].record.execution_key);
    assert.equal(after[0].record.outcome, 'success');
    assert.equal(run()[0].status, 'PASS'); assert.equal(aaCalls, 2, '原成功复用不变');
    // 受控修改本测试生成的记录，验证身份/完整性反例；不改历史夹具。
    guide = true; pass = false;
    for (const change of ['run', 'phase', 'attempt', 'legacy', 'missing', 'force', 'input', 'ordinary']) {
      write('WalletMain/build/default/outputs/ohosTest/WalletMain-ohosTest-signed.hap', 'immutable-test-package');
      const latest = listExecutionKeyRuns(reports, 'ut')[0];
      const doc = JSON.parse(saved);
      if (change === 'run') doc.goal_invocation.run_id = 'other';
      if (change === 'phase') doc.goal_invocation.phase = 'testing';
      if (change === 'attempt') doc.goal_invocation.attempt_id = 'i-other';
      if (change === 'legacy') delete doc.goal_invocation;
      if (change === 'missing') doc.frozen_files = [];
      fs.writeFileSync(path.join(latest.runDir, 'execution-key.json'), JSON.stringify(doc));
      ctx.forceDevice = change === 'force';
      if (change === 'input') write('WalletMain/build/default/outputs/ohosTest/WalletMain-ohosTest-signed.hap', 'changed-package');
      if (change === 'ordinary') delete process.env.MAISON_GOAL_ATTEMPT;
      const result = run();
      assert(!result[0].details.includes('采纳同次调用失败'), change);
      assert(result[0].device_setup, '装机前引导观察须穿过 hvigor 冻结结果：' + change);
      assert.equal(aaCalls, 2, '装机前阻断不得再发 aa test：' + change);
      assert(listExecutionKeyRuns(reports, 'ut').length > 2, change);
    }
  } finally {
    cp.spawnSync = spawn; resetHdcExecutableCache(); resetHdcServerWarmState();
    for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]; Object.assign(process.env, env);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

export async function runAll() { const out = []; for (const t of cases) { try { await t.run(); out.push({ name: t.name, ok: true }); } catch (e) { out.push({ name: t.name, ok: false, error: (e as Error).stack }); } } return out; }
