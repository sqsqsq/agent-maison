import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runAaTest } from '../../hdc-runner';
import { applicationHilogWindow } from '../../device-crash-diagnostics';
import { buildUtHvigorTestFailDetails, repeatedUtExecutionFailureNote } from '../../ut-hvigor-test-failure';
import type { HvigorRunResult } from '../../hvigor-runner';

const fixture = path.resolve(__dirname, '../../../../../harness/tests/fixtures/host-recovery-history/20261016/20261016T220800Z-65403a');
const bundle = 'com.example.simulatedwallet';
const raw = (): HvigorRunResult => JSON.parse(fs.readFileSync(path.join(fixture, 'frozen.ut-result.WalletMain.json'), 'utf8'));
function execute(mode: 'unknown' | 'crash' | 'unavailable' | 'locked') {
  let faults = 0, hilog = 0;
  return runAaTest({ bundleName: bundle, ohosTestModuleName: 'walletmain_test', testRunner: '/ets/testrunner/OpenHarmonyTestRunner', testTimeoutMs: 60000 }, undefined, (args) => {
    let stdout = '', status = 0;
    if (args.includes('ls')) {
      faults++;
      if (mode === 'unavailable') status = 1;
      stdout = mode === 'crash' && faults === 2 ? `jscrash-${bundle}-new` : '';
    } else if (args.includes('cat')) stdout = 'ReferenceError: missing service';
    else if (args.includes('hilog')) {
      if (++hilog === 2) stdout = `10-17 07:21:03.792 123 456 E BMSQuery GetTestRunner failed -n ${bundle}\n10-17 07:21:03.797 123 456 I OpenHarmonyTestRunner OnPrepare`;
    } else stdout = mode === 'locked' ? 'Error Code: 10106102 device screen is locked' : fs.readFileSync(path.join(fixture, 'frozen.hdc-test.WalletMain.log'), 'utf8').split(/\$ hdc shell aa test[^\n]*\n/)[1];
    return { status, stdout, stderr: '', pid: 0, signal: null, output: [] };
  });
}

const cases = [
  { name: 'real no-result remains execution diagnosis, not code_regression or guessed device failure', run() {
    const aa = execute('unknown'); assert.equal(aa.diagnosis?.kind, 'aa_test_no_result'); assert(!aa.report);
    assert(aa.output.includes('GetTestRunner failed') && aa.output.includes('OnPrepare'));
    const result = raw(); result.onDeviceFailureEvidence!.runDiagnosis = aa.diagnosis;
    const rendered = buildUtHvigorTestFailDetails([{ module: 'WalletMain', result }]);
    assert.equal(rendered.blockingClass, 'device_toolchain'); assert.notEqual(rendered.failureKind, 'code_regression');
    assert(rendered.suggestion.includes('原因不明时上报') && rendered.suggestion.includes('新诊断依据后再执行'));
  } },
  { name: 'new app crash and explicit lock route separately; unavailable diagnostics stay unknown', run() {
    for (const [mode, expected] of [['crash', 'test_failed'], ['locked', 'device_locked'], ['unavailable', 'aa_test_no_result']] as const) {
      const aa = execute(mode); assert.equal(aa.diagnosis?.kind, expected);
      const result = raw(); result.onDeviceFailureEvidence!.runDiagnosis = aa.diagnosis;
      const rendered = buildUtHvigorTestFailDetails([{ module: 'WalletMain', result }]);
      if (mode === 'crash') { assert.equal(rendered.failureKind, 'code_regression'); assert(aa.output.includes('ReferenceError')); }
      if (mode === 'locked') { assert.equal(rendered.failureKind, 'device_blocked'); assert.equal(rendered.blockingClass, 'externalBlocked'); }
      if (mode === 'unavailable') { assert(aa.output.includes('诊断不可用')); assert.notEqual(rendered.failureKind, 'device_blocked'); }
    }
  } },
  { name: 'hilog window excludes historical and unrelated application errors', run() {
    const old = `10-17 01:01:01.001 1 2 E BMS ${bundle} old`;
    const after = `${old}\n10-17 02:02:02.002 9 8 E JsRuntime unrelated`;
    assert(!applicationHilogWindow(old, after, bundle).includes('old'));
    assert(!applicationHilogWindow(old, after, bundle).includes('unrelated'));
    assert(applicationHilogWindow(null, after, bundle).includes('不可用'));
  } },
  { name: 'second same-key execution failure advises stopping using existing records; changed input remains retryable', run() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-repeated-'));
    try {
      const prior = path.join(root, '20261016T225415Z-501', 'ut'); fs.mkdirSync(prior, { recursive: true });
      fs.writeFileSync(path.join(prior, 'execution-key.json'), JSON.stringify({ execution_key: 'same', outcome: 'failed' }));
      fs.copyFileSync(path.join(fixture, 'frozen.ut-result.WalletMain.json'), path.join(prior, 'frozen.ut-result.WalletMain.json'));
      const bad = [{ module: 'WalletMain', result: raw() }];
      assert(repeatedUtExecutionFailureNote(root, path.join(root, 'next/ut'), 'same', bad)?.includes('停止并上报'));
      assert.equal(repeatedUtExecutionFailureNote(root, path.join(root, 'next/ut'), 'changed', bad), undefined);
      bad[0].result.onDeviceFailureEvidence!.runDiagnosis!.kind = 'test_failed';
      assert.equal(repeatedUtExecutionFailureNote(root, path.join(root, 'next/ut'), 'same', bad), undefined);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
];
export function runAll() { return cases.map(test => { try { test.run(); return { name: test.name, ok: true }; } catch (error) { return { name: test.name, ok: false, error: (error as Error).stack }; } }); }
