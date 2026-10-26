import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearFrameworkConfigCache, loadFrameworkConfig, resolveHylyreToolConfig } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { SpecLoader } from '../../scripts/utils/spec-loader';
import { buildCanonicalDeriveHintPayload } from '../../scripts/utils/test-plan-derive-hint';
import { collectPhaseRepairCandidates } from '../../scripts/utils/repair-candidates';
import { __testing_checkDeviceTestRunGate, __testing_checkHylyreFailureRouting } from '../../scripts/check-testing';
import { computeExecutionKey, sha256Text, writeExecutionKeyRecord, type ExecutionKeyRecord } from '../../../profiles/hmos-app/harness/execution-key';
import { parseHylyreTrace } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import type { CheckContext } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';
import { matchesUnitCase, startCaseTiming, selectedUnitCases, type UnitExecutionTiming } from '../utils/unit-case-selection';

const frameworkRoot = path.resolve(__dirname, '../../..');
const fixture = path.join(__dirname, '../fixtures/host-recovery-history/20261024-fe4512-s1');
const feature = 'cu-YmMtb3BlbkNhcmQtMgBiYW5rLWNhcmQtb3BlbmluZy1mbG93';
const featureDir = 'doc/features/bc-openCard-2/bank-card-opening-flow';
const runId = '20261023T044016Z-fe4512';
const cases: Array<{ name: string; run: () => void }> = [];
const test = (name: string, run: () => void): void => { cases.push({ name, run }); };
const read = (file: string): any => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file: string, value: unknown): void => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2)); };

function setup(stamp: string, attempt: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-testing-failed-'));
  // Copy ordinary fixture files only. No framework/node_modules/junction enters the disposable tree.
  fs.cpSync(fixture, root, { recursive: true, filter: file => {
    const rel = path.relative(fixture, file);
    return !fs.lstatSync(file).isSymbolicLink() && !/(?:^|[\\/])(?:reports|goal-runs)(?:[\\/]|$)/.test(rel);
  } });
  const reports = path.join(root, featureDir, 'testing/reports');
  const dir = path.join(reports, stamp, 'hylyre');
  fs.cpSync(path.join(fixture, featureDir, 'testing/reports', stamp, 'hylyre'), dir, { recursive: true });
  fs.copyFileSync(path.join(root, featureDir, 'testing/test-plan.before-tc003.md'), path.join(root, featureDir, 'testing/test-plan.md'));
  // Only absolute source-root references change; case/step outcomes and execution timestamps stay original.
  for (const file of fs.readdirSync(dir).filter(file => file.endsWith('.json'))) {
    const rewrite = (value: any): any => typeof value === 'string'
      ? value.replace(/D:[\\/]1\.code[\\/]SimulatedWalletForHmos/gi, root)
      : Array.isArray(value) ? value.map(rewrite)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)])) : value;
    write(path.join(dir, file), rewrite(read(path.join(dir, file))));
  }
  clearFrameworkConfigCache();
  const config = loadFrameworkConfig(root);
  const loader = new SpecLoader(root, undefined, undefined, frameworkRoot);
  const ctx = { projectRoot: root, frameworkRoot, frameworkRel: 'framework', harnessRoot: path.join(frameworkRoot, 'harness'), feature, phase: 'testing',
    phaseRule: loader.loadPhaseRule('testing'), featureSpec: loader.loadFeatureSpec(feature),
    resolvedProfile: loadResolvedProfile(root, config, frameworkRoot), fidelityTarget: 'semantic_layout', acceptanceStrictness: 'best_effort',
  } as CheckContext;
  const record = read(path.join(dir, 'execution-key.json')) as ExecutionKeyRecord;
  const originalMeta = read(path.join(dir, 'frozen.device-test-run.meta.json'));
  const timeline = fs.readFileSync(path.join(fixture, featureDir, 'goal-runs', runId, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  const start = timeline.find(event => event.type === 'agent_invoke_start' && event.invoke_id === attempt);
  const end = timeline.find(event => event.type === 'agent_invoke_end' && event.invoke_id === attempt);
  const gateStart = timeline.find(event => event.type === 'harness_start' && event.invoke_id === attempt);
  const gateEnd = timeline.find(event => event.type === 'harness_end' && event.invoke_id === attempt);
  const executedAt = Date.parse(originalMeta.run_started_at);
  assert.ok(start && end && (Date.parse(start.ts) <= executedAt && executedAt <= Date.parse(end.ts)
    || gateStart && gateEnd && Date.parse(gateStart.ts) <= executedAt && executedAt <= Date.parse(gateEnd.ts)), '原执行必须确实位于该作者或其正式 gate 窗口');
  record.goal_invocation = { run_id: runId, phase: 'testing', attempt_id: attempt.replace(/^testing-/, '') };
  record.trace_path = path.join(dir, 'trace.json');
  record.trace_sha256 = sha256Text(fs.readFileSync(record.trace_path, 'utf8'));
  // Path adaptation must preserve every real execution-key input.
  assert.strictEqual(record.inputs.tool_config_sha256, sha256Text(JSON.stringify(resolveHylyreToolConfig(root))), '配置输入保持原样');
  record.execution_key = computeExecutionKey(record.inputs);
  writeExecutionKeyRecord(dir, record);
  const meta = read(path.join(dir, 'frozen.device-test-run.meta.json'));
  if (meta.artifact_binding) meta.artifact_binding.trace_sha256 = record.trace_sha256;
  write(path.join(dir, 'frozen.device-test-run.meta.json'), meta);
  write(path.join(reports, 'derive-hint-from-plan.json'), buildCanonicalDeriveHintPayload(root, feature));
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(reports, 'derive-hint-from-plan.json'), past, past);
  fs.utimesSync(path.join(dir, 'test-plan.hylyre.md'), new Date(), new Date());
  fs.copyFileSync(path.join(fixture, featureDir, 'testing/reports/hylyre-ready.meta.json'), path.join(reports, 'hylyre-ready.meta.json'));
  const vendor = resolveHylyreToolConfig(root).vendor_dir;
  write(path.join(root, vendor, 'release.manifest.json'), { hylyre_version: '0.5.1' });
  const holder: Parameters<typeof __testing_checkDeviceTestRunGate>[1] = {
    hapPath: path.join(root, 'original.hap'), hapSha256Full: record.inputs.hap_sha256_full,
    installPassed: true, installExternallyBlocked: false, buildReused: true, installExecuted: false, installOk: true,
    hylyreTracePath: null, deviceTestRunExecuted: false,
  };
  return { root, reports, dir, ctx, record, holder };
}

type Fixture = ReturnType<typeof setup>;
function withExternalDevices<T>(c: Fixture, run: (state: { calls: number; locked: boolean; setup: boolean }) => T): T {
  const registry = require('../../capability-registry');
  const hdc = require('../../../profiles/hmos-app/harness/hdc-runner');
  const bridge = require('../../../profiles/hmos-app/harness/device-recovery-bridge');
  const visual = require('../../../profiles/hmos-app/harness/visual-diff-hylyre-screenshot');
  const saved = { ready: registry.dispatchDeviceTestEnsureReady, run: registry.dispatchDeviceTestRun,
    identity: hdc.resolveExecutionDeviceIdentity, snapshot: bridge.observeDeviceSnapshot,
    shot: visual.buildHylyreVisualDiffScreenshotFn, dump: visual.buildHylyreLayoutDumpFn, nav: visual.buildHylyreNavExecutorFn };
  const env = ['MAISON_GOAL_RUN_ID', 'MAISON_GOAL_ATTEMPT', 'MAISON_GOAL_ATTEMPT_PHASE', 'HARNESS_DEVICE_TEST_COLD_RESTART'].map(key => [key, process.env[key]] as const);
  const state = { calls: 0, locked: false, setup: false };
  process.env.MAISON_GOAL_RUN_ID = runId;
  process.env.MAISON_GOAL_ATTEMPT = c.record.goal_invocation!.attempt_id;
  process.env.MAISON_GOAL_ATTEMPT_PHASE = 'testing';
  delete process.env.HARNESS_DEVICE_TEST_COLD_RESTART;
  registry.dispatchDeviceTestEnsureReady = () => ({ ok: true, pythonPath: 'external-python', hylyreVersion: '0.5.1', manifestVersion: '0.5.1', errors: [] });
  registry.dispatchDeviceTestRun = () => { state.calls++; return { executed: false, ok: false, exitCode: 77,
    command: 'external-device-boundary', reportPath: null, tracePath: null, trace: null, logPath: '', errors: [{ message: 'external execution counted' }] }; };
  hdc.resolveExecutionDeviceIdentity = () => ({ device: c.record.inputs.device, display_env: c.record.inputs.display_env });
  bridge.observeDeviceSnapshot = () => ({ locked: state.locked, ...(state.setup ? { systemSetup: { kind: 'system_setup', evidence: 'fixture' } } : {}) });
  const countedCapture = () => () => { state.calls++; throw new Error('external device capture counted'); };
  visual.buildHylyreVisualDiffScreenshotFn = countedCapture;
  visual.buildHylyreLayoutDumpFn = countedCapture;
  visual.buildHylyreNavExecutorFn = countedCapture;
  try { return run(state); } finally {
    registry.dispatchDeviceTestEnsureReady = saved.ready; registry.dispatchDeviceTestRun = saved.run;
    hdc.resolveExecutionDeviceIdentity = saved.identity; bridge.observeDeviceSnapshot = saved.snapshot;
    visual.buildHylyreVisualDiffScreenshotFn = saved.shot; visual.buildHylyreLayoutDumpFn = saved.dump; visual.buildHylyreNavExecutorFn = saved.nav;
    for (const [key, value] of env) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    clearFrameworkConfigCache();
    assert.ok(path.resolve(c.root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(c.root, { recursive: true, force: true });
  }
}

function failureFacts(c: Fixture) {
  const trace = parseHylyreTrace(c.record.trace_path)!;
  const routing = __testing_checkHylyreFailureRouting(c.ctx, trace, null, path.join(c.dir, 'test-plan.hylyre.md'), c.record.trace_path);
  const candidates = collectPhaseRepairCandidates({ phase: 'testing', reportValidity: 'FAIL', reviewReportText: null,
    verifierReportText: null, checks: routing });
  return { trace, routing, candidates };
}

for (const [attempt, stamp] of [['testing-i15', '20261024T174757Z-893'], ['testing-i15', '20261024T175459Z-004'],
  ['testing-i19', '20261024T184311Z-686'], ['testing-i19', '20261024T185039Z-266']]) {
  test(`6fd ${attempt} ${stamp} real failed gate consumes frozen facts with zero device calls and keeps repair candidates`, () => {
    const c = setup(stamp, attempt);
    withExternalDevices(c, state => {
      const before = failureFacts(c);
      assert.ok(before.candidates.length > 0, '真实失败材料必须确有产品修复候选');
      const original = fs.readFileSync(path.join(c.dir, 'execution-key.json'), 'utf8');
      const meta = fs.readFileSync(path.join(c.dir, 'frozen.device-test-run.meta.json'), 'utf8');
      write(path.join(c.reports, 'device-test-run.meta.json'), { ok: true, exit_code: 0, command: 'unrelated-later-run' });
      const checks = __testing_checkDeviceTestRunGate(c.ctx, c.holder);
      const gate = checks.find(check => check.id === 'device_test_run')!;
      assert.strictEqual(state.calls, 0, gate?.details);
      assert.strictEqual(gate.status, 'FAIL', gate.details);
      assert.ok(gate.details?.includes('失败事实消费'), gate.details);
      assert.strictEqual(c.holder.deviceRunReused, false, '失败不是成功复用');
      assert.ok(c.holder.reusedRunDir, '消费明确披露原run，不计新真跑');
      assert.strictEqual(fs.readFileSync(path.join(c.reports, 'device-test-run.meta.json'), 'utf8'), meta, '顶层必须回填原失败meta');
      assert.strictEqual(fs.readFileSync(path.join(c.dir, 'execution-key.json'), 'utf8'), original, '消费不能改写原失败时间/身份');
      assert.strictEqual(fs.readFileSync(path.join(c.dir, 'frozen.device-test-run.meta.json'), 'utf8'), meta);
      assert.deepStrictEqual(failureFacts(c), before, '原FAIL/用例/步骤/责任候选保持');
      const routing = __testing_checkHylyreFailureRouting(c.ctx, parseHylyreTrace(c.holder.hylyreTracePath!)!, c.holder.hylyreEvidenceGate,
        path.join(c.dir, 'test-plan.hylyre.md'), c.holder.hylyreTracePath);
      const after = collectPhaseRepairCandidates({ phase: 'testing', reportValidity: 'FAIL', reviewReportText: null, verifierReportText: null, checks: routing });
      assert.deepStrictEqual(after, before.candidates, JSON.stringify({ checks, routing }));
    });
  });
}

test('6fd latest failure cannot fall back to an older successful execution', () => {
  const c = setup('20261024T184311Z-686', 'testing-i19');
  const older = path.join(c.reports, '20261024T000000Z-old', 'hylyre');
  fs.cpSync(c.dir, older, { recursive: true });
  writeExecutionKeyRecord(older, { ...c.record, outcome: 'success' });
  withExternalDevices(c, state => {
    const checks = __testing_checkDeviceTestRunGate(c.ctx, c.holder);
    assert.strictEqual(state.calls, 0);
    const gate = checks.find(check => check.id === 'device_test_run')!;
    assert.strictEqual(gate.status, 'FAIL', gate.details);
    assert.strictEqual(c.holder.deviceRunReused, false);
    assert.ok(c.holder.reusedRunDir?.includes('20261024T184311Z-686'));
  });
});

test('6fd missing derived timing rebuilds from the original failed trace without device execution', () => {
  const c = setup('20261024T184311Z-686', 'testing-i19');
  fs.unlinkSync(path.join(c.dir, 'frozen.device-test-timing.json'));
  withExternalDevices(c, state => {
    const checks = __testing_checkDeviceTestRunGate(c.ctx, c.holder);
    assert.strictEqual(state.calls, 0, JSON.stringify(checks));
    assert.strictEqual(checks.find(check => check.id === 'device_test_run')?.status, 'FAIL');
    const timing = read(path.join(c.reports, 'device-test-timing.json'));
    assert.strictEqual(timing.cases.length, parseHylyreTrace(c.record.trace_path)!.cases!.length);
  });
});

test('6fd frozen runner failure and unexecuted result retain their original failure classification', () => {
  for (const unexecuted of [false, true]) {
    const c = setup('20261024T184311Z-686', 'testing-i19');
    const meta = read(path.join(c.dir, 'frozen.device-test-run.meta.json'));
    meta.ok = unexecuted; meta.executed = !unexecuted; meta.exit_code = 79;
    meta.errors = [{ message: 'original runner unavailable' }];
    write(path.join(c.dir, 'frozen.device-test-run.meta.json'), meta);
    withExternalDevices(c, state => {
      const checks = __testing_checkDeviceTestRunGate(c.ctx, c.holder);
      const gate = checks.find(check => check.id === 'device_test_run')!;
      assert.strictEqual(state.calls, 0, JSON.stringify(checks));
      assert.strictEqual(gate.status, 'FAIL');
      assert.strictEqual(gate.blocking_class, 'device_toolchain');
      assert.ok(gate.details?.includes('exit=79') && gate.details.includes('original runner unavailable'), gate.details);
      assert.strictEqual(c.holder.deviceTestRunExecuted, false, '未完成工具结果不能转成执行完成');
    });
  }
});

test('6fd new attempt, changed package, changed input, force and missing facts dispatch external device again', () => {
  for (const change of ['attempt', 'package', 'input', 'force', 'missing']) {
    const c = setup('20261024T184311Z-686', 'testing-i19');
    withExternalDevices(c, state => {
      if (change === 'attempt') process.env.MAISON_GOAL_ATTEMPT = 'i20';
      if (change === 'package') c.holder.hapSha256Full = 'f'.repeat(64);
      if (change === 'input') fs.appendFileSync(path.join(c.dir, 'test-plan.hylyre.md'), '\n<!-- changed executable input -->\n');
      if (change === 'force') c.ctx.forceDevice = true;
      if (change === 'missing') fs.unlinkSync(path.join(c.dir, 'frozen.device-test-run.meta.json'));
      const checks = __testing_checkDeviceTestRunGate(c.ctx, c.holder);
      assert.strictEqual(state.calls, 1, `${change}: ${JSON.stringify(checks)}`);
      assert.strictEqual(checks.find(check => check.id === 'device_test_run')?.status, 'FAIL');
    });
  }
});

test('6fd frozen tool failure keeps original runner failure and recovered lock dispatches again', () => {
  for (const recovered of [false, true]) {
    const c = setup('20261024T184311Z-686', 'testing-i19');
    const trace = read(c.record.trace_path);
    trace.run_failure_kind = 'device_locked'; trace.cases = [];
    c.record.timing_complete = false;
    writeExecutionKeyRecord(c.dir, c.record);
    fs.unlinkSync(path.join(c.dir, 'frozen.device-test-timing.json'));
    write(c.record.trace_path, trace);
    const meta = read(path.join(c.dir, 'frozen.device-test-run.meta.json'));
    meta.ok = false; meta.exit_code = null; meta.errors = [{ message: 'original locked runner failure' }];
    write(path.join(c.dir, 'frozen.device-test-run.meta.json'), meta);
    withExternalDevices(c, state => {
      state.locked = !recovered;
      const before = fs.readFileSync(path.join(c.dir, 'execution-key.json'), 'utf8');
      const checks = __testing_checkDeviceTestRunGate(c.ctx, c.holder);
      assert.strictEqual(state.calls, recovered ? 1 : 0, JSON.stringify(checks));
      const gate = checks.find(check => check.id === 'device_test_run')!;
      assert.strictEqual(gate.status, 'FAIL');
      if (!recovered) {
        assert.strictEqual(gate.blocking_class, 'externalBlocked');
        assert.ok(gate.details?.includes('original locked runner failure'), gate.details);
        assert.strictEqual(fs.readFileSync(path.join(c.dir, 'execution-key.json'), 'utf8'), before);
      }
    });
  }
});

export function runSelectedCases(selector?: string) {
  const results: UnitCaseResult[] = [], timings: UnitExecutionTiming[] = [];
  for (const c of cases.filter(c => matchesUnitCase(c.name, selector))) {
    const finish = startCaseTiming([c.name], timings);
    try { c.run(); results.push({ name: c.name, ok: true }); }
    catch (error) { results.push({ name: c.name, ok: false, error: (error as Error).stack }); }
    finally { finish(); }
  }
  return selectedUnitCases(results, selector, timings);
}
export function runAll(): UnitCaseResult[] { return runSelectedCases().results; }
