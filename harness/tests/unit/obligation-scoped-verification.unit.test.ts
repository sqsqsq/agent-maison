import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import * as YAML from 'yaml';
import { fixture as requestFixture, facts, tree } from './request-entry.unit.test';
import { fixture as blueprintFixture } from './blueprint-skill-projection.unit.test';
import { resolveCapabilityInputs } from '../../scripts/utils/capability-resolution';
import { prepareExplicitRequest, resolveCapabilityResolutionEntryInput } from '../../scripts/utils/capability-resolution-entry-input';
import { runExplicitRequest } from '../../scripts/utils/request-phase';
import { resolveExecutionScope, hasNoTestingObligation } from '../../scripts/utils/execution-scope';
import { collectUnitScopeIds, collectDeviceScopeIds, isUnitUtLayer } from '../../scripts/utils/acceptance-layering';
import { extractAcceptanceIdRefs } from '../../scripts/utils/check-acceptance';
import { checkAcceptanceToTestCase, checkPlanReferencesUnitLayerAc } from '../../scripts/check-testing';
import { checkAcceptanceCoverage, checkUtMockPlanRequirements, inspectMockPlan, inspectTestabilityAudit } from '../../scripts/check-ut';
import { generateScriptReport } from '../../scripts/utils/report-generator';
import { writeRunSummaryBase } from '../../harness-runner';
import { listUnitBothScopeItems } from '../../scripts/utils/coverage-evidence';
import { buildGoalManifestFromInput } from '../../scripts/utils/goal-manifest';
import { createGoalRun } from '../../scripts/utils/goal-run-creation';
import { clearFrameworkConfigCache } from '../../config';
import type { AcceptanceSpec, CheckContext } from '../../scripts/utils/types';
import type { WorkflowSpec } from '../../workflow-loader';
import type { UnitCaseResult } from '../run-unit';

const frameworkRoot = path.resolve(__dirname, '../../..');
const workflow: WorkflowSpec = { schema_version: '1.2', name: 'p5', auto_chain: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'], artifacts: ['spec', 'plan', 'coding', 'review', 'ut', 'testing'].map(id => ({ id, scope: 'feature', requires: [], obligation_provider_id: `obligations.${id}` })) };
const acceptance = (): AcceptanceSpec => ({ feature: 'live', source: 'approved', version: '1', criteria: [{ id: 'AC-1', prd_function: null, description: 'value is correct', priority: 'P1', testable: true, verification_steps: ['read value'], expected_result: '42', ut_layer: 'unit', ut_focus: 'value' }], boundaries: [] });
const binding = { input_id: 'acceptance', source: { kind: 'artifact' as const, artifact: 'acceptance@1' }, dependencies: [], source_refs: [], content_fingerprint: 'a'.repeat(64) };
const scopeFor = (value: AcceptanceSpec) => resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['coding'] }, facts: [], contract_fingerprints: [] }, workflow, { value, binding });

function nativeProfile(f: ReturnType<typeof requestFixture>) {
  fs.symlinkSync(path.join(frameworkRoot, 'profiles/hmos-app'), path.join(f.framework, 'profiles/hmos-app'), process.platform === 'win32' ? 'junction' : 'dir');
  const configFile = path.join(f.root, 'framework.config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8')); config.project_profile.name = 'hmos-app'; fs.writeFileSync(configFile, JSON.stringify(config)); clearFrameworkConfigCache();
}
async function runRequest(f: ReturnType<typeof requestFixture>) {
  const p = prepareExplicitRequest(f.options); facts(p, f.root);
  return runExplicitRequest({ projectRoot: f.root, frameworkRoot: f.framework, args: { phase: f.options.phase, 'request-file': f.options.requestFile, 'report-dir': f.options.reportDir } });
}

const cases: Array<{ name: string; run(): void | Promise<void> }> = [
  { name: 'performance shares explicit layers; missing layers never mean zero device responsibility', run() {
    assert.equal(isUnitUtLayer(undefined), false);
    for (const layer of ['unit', 'device', 'both', undefined, 'invalid'] as const) {
      const value = acceptance(); value.performance = [{ id: 'NFR-QUERY-LATENCY', metric: 'latency', threshold: '20', unit: 'ms', description: 'approved fixed workload', ut_layer: layer as any, ...(layer === 'device' || layer === 'both' ? { device_focus: 'measure on target device' } : {}) }];
      const scope = scopeFor(value);
      if (layer === 'unit') { assert(!scope.phase_chain.includes('testing')); assert(collectUnitScopeIds(value).includes('NFR-QUERY-LATENCY')); assert(hasNoTestingObligation(scope)); }
      else if (layer === 'device' || layer === 'both') { assert(scope.phase_chain.includes('testing')); assert(collectDeviceScopeIds(value).includes('NFR-QUERY-LATENCY')); }
      else { assert(scope.unresolved.length); assert(!hasNoTestingObligation(scope)); }
    }
    const value = acceptance(); value.boundaries = [{ id: 'BD-1', prd_exception: 'resume', description: 'restore screen', priority: 'P1', scenario: 'resume', handling: 'reload', expected_behavior: 'current data', ut_layer: 'device', device_focus: 'resume app' }];
    assert(scopeFor(value).phase_chain.includes('testing'));
    value.performance = [{ id: 'NFR-INCOMPLETE', metric: 'latency', threshold: '20', unit: 'ms', description: '', ut_layer: 'unit' }];
    assert(scopeFor(value).unresolved.length, 'a layer label cannot replace a defined performance proof');
    assert.deepStrictEqual(extractAcceptanceIdRefs('AC-1, BD-1, NFR-QUERY-LATENCY'), ['AC-1', 'BD-1', 'NFR-QUERY-LATENCY']);
  } },
  { name: 'device NFR coverage uses real IDs while R8 retains pure-unit versus NFR distinction', run() {
    const value = acceptance(); value.performance = [{ id: 'NFR-QUERY-LATENCY', metric: 'latency', threshold: '20', unit: 'ms', description: 'device workload', ut_layer: 'device', device_focus: 'query latency' }];
    const ctx = { projectRoot: '.', feature: 'live', featureSpec: { acceptance: value }, phaseRule: {} } as CheckContext;
    const plan = (refs: string) => `# Test\n## 测试用例\n| 用例编号 | 用例名称 | 优先级 | 关联 AC |\n|---|---|---|---|\n| TC-001 | query | P1 | ${refs} |\n`;
    assert(checkAcceptanceToTestCase(ctx, plan('NFR-QUERY-LATENCY')).every(check => check.status !== 'FAIL'), JSON.stringify(checkAcceptanceToTestCase(ctx, plan('NFR-QUERY-LATENCY'))));
    assert(checkAcceptanceToTestCase(ctx, plan('AC-1')).some(check => check.status === 'FAIL'));
    assert(checkPlanReferencesUnitLayerAc(ctx, plan('AC-1')).some(check => check.severity === 'BLOCKER' && check.status === 'FAIL'));
    assert(!checkPlanReferencesUnitLayerAc(ctx, plan('AC-1, NFR-QUERY-LATENCY')).some(check => check.severity === 'BLOCKER' && check.status === 'FAIL'));
    value.performance[0].ut_layer = 'unit'; delete value.performance[0].device_focus;
    assert(listUnitBothScopeItems(value).some(item => item.id === 'NFR-QUERY-LATENCY'));
    const dags = (ids: string[]) => [{ path: 'value.dag.yaml', dag: { linked_acceptance: ids, nodes: [] } }] as any;
    assert(checkAcceptanceCoverage(ctx, dags(['AC-1'])).some(check => check.status === 'FAIL'));
    assert(checkAcceptanceCoverage(ctx, dags(['AC-1', 'NFR-QUERY-LATENCY'])).every(check => check.status !== 'FAIL'));
  } },
  { name: 'modern pure dependencies omit mock plan but unknown isolation requirements remain blocked', run() {
    const f = requestFixture('ut');
    try {
      nativeProfile(f);
      const ctx = { projectRoot: f.root, frameworkRoot: f.framework, feature: 'live', phaseRule: {}, featureSpec: {}, resolvedInputs: {}, resolvedProfile: { name: 'hmos-app', profileDir: path.join(f.framework, 'profiles/hmos-app') } } as CheckContext;
      const record = { acceptance_id: 'AC-1', testability_level: 'L1', entry_point: { file: 'src/value.js', symbol: 'value' }, dependencies: [{ name: 'Math', kind: 'pure' }] };
      const dir = path.join(f.root, 'doc/features/live/ut'); fs.mkdirSync(dir, { recursive: true });
      const auditFile = path.join(dir, 'testability-audit.md');
      const execution = execFileSync(process.execPath, ['--test', 'tests/value.test.cjs'], { cwd: f.root, encoding: 'utf8' });
      const summarize = () => {
        const checks = checkUtMockPlanRequirements(ctx, inspectTestabilityAudit(ctx), inspectMockPlan(ctx));
        const report = generateScriptReport(path.join(f.framework, 'harness'), 'ut', 'live', f.root, [...checks, { id: 'ut_fixture_execution', category: 'structure', severity: 'BLOCKER', status: 'PASS', description: 'fixture Node assertions executed', details: execution }], f.framework);
        return writeRunSummaryBase(f.root, report, f.framework);
      };
      fs.writeFileSync(auditFile, YAML.stringify({ records: [record] }));
      const pure = summarize(); assert.equal(pure.verdict, 'PASS', JSON.stringify(pure)); assert.equal(pure.blocking_skips.length, 0);
      fs.writeFileSync(auditFile, YAML.stringify({ records: [{ ...record, dependencies: [] }] }));
      assert.notEqual(summarize().verdict, 'PASS');
      fs.writeFileSync(auditFile, YAML.stringify({ records: [record] })); fs.writeFileSync(path.join(dir, 'mock-plan.yaml'), 'spies: []');
      assert.equal(summarize().verdict, 'PASS');
      fs.writeFileSync(path.join(dir, 'mock-plan.yaml'), 'spies: [');
      assert.equal(summarize().verdict, 'FAIL', 'a damaged existing mock plan must still fail');
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'UT and testing resolve unmaterialized blueprint acceptance and construction without spec or plan', run() {
    const f = blueprintFixture();
    try {
      const file = path.join(f.root, 'src/ledger/LedgerFeature.ets'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'export class LedgerFeature {}');
      for (const phase of ['ut', 'testing']) {
        const result = resolveCapabilityInputs({ projectRoot: f.root, frameworkRoot, feature: f.feature, phase, track: 'full', testTargets: ['src/ledger/LedgerFeature.ets'], inputContext: { schema_version: '1.1', subject: { feature: f.feature }, obligations: { 'unit-evidence': 'required', 'device-evidence': 'required' }, required_outputs: [] } });
        assert.equal(result.report.assurance, 'full', JSON.stringify(result.report));
        assert(result.inputs!.artifacts['acceptance@1']); assert(result.inputs!.artifacts['use-cases@1']);
      }
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'zero-testing reconcile CLI validates frozen scope without trace or Feature writes', run() {
    const f = requestFixture('ut');
    try {
      execFileSync('git', ['init', '-q'], { cwd: f.root }); execFileSync('git', ['add', 'src/value.js'], { cwd: f.root }); execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'baseline'], { cwd: f.root });
      const scope = scopeFor(acceptance());
      const manifest = buildGoalManifestFromInput({ feature: 'live', run_id: 'p5-no-device', execution_scope: scope, chain_override: scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root });
      createGoalRun({ projectRoot: f.root, manifest, chain: scope.phase_chain });
      const utInputs = () => resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: 'live', phase: 'ut', featuresDir: 'doc/features', goalRunId: manifest.run_id });
      assert(!utInputs().inputContext!.required_outputs.some(file => path.basename(file) === 'mock-plan.yaml'));
      const before = tree(path.join(f.root, 'doc/features'));
      const run = spawnSync(process.execPath, ['--preserve-symlinks-main', '-r', require.resolve('ts-node/register/transpile-only'), path.join(f.framework, 'harness/harness-runner.ts'), '--phase', 'testing', '--feature', 'live', '--goal-run-id', manifest.run_id, '--report-reconcile-only'], { cwd: path.join(f.framework, 'harness'), encoding: 'utf8', timeout: 60000, env: { ...process.env, TS_NODE_PROJECT: path.join(frameworkRoot, 'harness/tsconfig.json') } });
      assert.equal(run.status, 0, run.stderr + run.stdout); assert(run.stdout.includes('not_applicable'));
      assert.deepStrictEqual(tree(path.join(f.root, 'doc/features')), before);
      assert(!fs.existsSync(path.join(f.root, 'doc/features/live/testing')));
      const mockDir = path.join(f.root, 'doc/features/live/ut'); fs.mkdirSync(mockDir, { recursive: true }); fs.writeFileSync(path.join(mockDir, 'mock-plan.yaml'), 'spies: [');
      assert(utInputs().inputContext!.required_outputs.some(file => path.basename(file) === 'mock-plan.yaml'));
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'testing cases retain the frozen acceptance binding across the actual P2 bridge', run() {
    const f = requestFixture('testing');
    try {
      execFileSync('git', ['init', '-q'], { cwd: f.root }); execFileSync('git', ['add', 'src/value.js'], { cwd: f.root }); execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'baseline'], { cwd: f.root });
      const value = acceptance(); value.criteria[0].ut_layer = 'device'; value.criteria[0].device_focus = 'show value';
      const file = path.join(f.root, 'doc/features/live/acceptance.yaml'); fs.writeFileSync(file, YAML.stringify(value));
      const options = { projectRoot: f.root, frameworkRoot, feature: 'live', phase: 'testing', track: 'full' as const, testTargets: ['src/value.js'], inputContext: { schema_version: '1.1' as const, subject: { feature: 'live' }, obligations: {}, required_outputs: [] } };
      const initial = resolveCapabilityInputs(options); assert.notEqual(initial.report.assurance, 'blocked');
      const casesInput = initial.inputs!.values.cases; const code = initial.inputs!.values.tested_code; assert(casesInput.state === 'resolved' && code.state === 'resolved');
      const scope = resolveExecutionScope({ request: { completion_target: 'feature', requested_results: ['verify'], requested_phases: ['testing'] }, facts: [{ id: 'device-target', kind: 'device-evidence', applicability: 'required', reason: 'explicit target', basis: [code.binding] }], contract_fingerprints: [] }, workflow, { value, binding: { ...casesInput.binding, input_id: 'acceptance' } });
      const manifest = buildGoalManifestFromInput({ feature: 'live', run_id: 'p5-binding', execution_scope: scope, chain_override: scope.phase_chain, unattended: { write_mode: 'full-access', approval_mode: 'never' } }, { projectRoot: f.root }); createGoalRun({ projectRoot: f.root, manifest, chain: scope.phase_chain });
      const bridge = resolveCapabilityResolutionEntryInput({ projectRoot: f.root, frameworkRoot, feature: 'live', phase: 'testing', featuresDir: 'doc/features', goalRunId: manifest.run_id });
      assert.notEqual(resolveCapabilityInputs({ ...options, ...bridge }).report.assurance, 'blocked');
      value.criteria[0].expected_result = 'different expectation'; fs.writeFileSync(file, YAML.stringify(value));
      assert.equal(resolveCapabilityInputs({ ...options, ...bridge }).report.assurance, 'blocked');
    } finally { fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'native UT request reaches HAP executor with selected classes and isolated logs', async run() {
    const f = requestFixture('ut'); const hvigor = require('../../../profiles/hmos-app/harness/hvigor-runner');
    const gate = require('../../scripts/utils/device-readiness-gate'); const oldRun = hvigor.runHvigorTest; const oldGate = gate.applyPhaseEntryDeviceGate;
    try {
      nativeProfile(f); const testFile = 'entry/src/ohosTest/ets/test/Value.test.ets'; fs.mkdirSync(path.dirname(path.join(f.root, testFile)), { recursive: true });
      fs.writeFileSync(path.join(f.root, testFile), "describe('ValueSuite',()=>{it('value',0,()=>{expect(42).assertEqual(42);});});");
      fs.writeFileSync(path.join(f.root, 'build-profile.json5'), JSON.stringify({ modules: [{ name: 'entry', srcPath: './entry' }] }));
      fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify({ ...f.request, targets: { ...f.request.targets, tests: [testFile] } }));
      const before = tree(path.join(f.root, 'doc/features')); let calls = 0; let fail = false;
      gate.applyPhaseEntryDeviceGate = async () => ({ ok: true });
      hvigor.runHvigorTest = (opts: any) => { calls++; assert.equal(opts.feature, undefined); assert.deepStrictEqual(opts.testClasses, ['ValueSuite']); assert(opts.reportDir.startsWith(path.join(f.root, f.options.reportDir))); const logPath = path.join(opts.reportDir, 'native-ut.log'); fs.writeFileSync(logPath, 'native fixture output'); return { executed: true, exitCode: fail ? 1 : 0, logPath, logExcerpt: 'native fixture output', testResult: { total: 1, passed: fail ? 0 : 1, failed: fail ? 1 : 0, skipped: 0 } }; };
      assert.equal(await runRequest(f), 0, fs.readFileSync(path.join(f.root, f.options.reportDir, 'script-report.json'), 'utf8')); assert.equal(calls, 1); assert.deepStrictEqual(tree(path.join(f.root, 'doc/features')), before);
      fail = true; assert.equal(await runRequest(f), 1);
      gate.applyPhaseEntryDeviceGate = async () => ({ ok: false, reason: 'device offline' }); const beforeOffline = calls; assert.equal(await runRequest(f), 1); assert.equal(calls, beforeOffline);
    } finally { hvigor.runHvigorTest = oldRun; gate.applyPhaseEntryDeviceGate = oldGate; fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
  { name: 'native device request consumes v1 assertions; fake session and absent native outcomes cannot PASS', async run() {
    const f = requestFixture('testing'); const native = require('../../../profiles/hmos-app/harness/providers/device-test-run');
    const gate = require('../../scripts/utils/device-readiness-gate'); const oldReady = native.ensureHylyreReady; const oldRun = native.runHylyreDeviceTest; const oldGate = gate.applyPhaseEntryDeviceGate;
    const hylyre = require('../../../profiles/hmos-app/harness/hylyre-spawn'); const oldSpawn = hylyre.spawnHylyre;
    try {
      nativeProfile(f); fs.mkdirSync(path.join(f.root, 'AppScope')); fs.writeFileSync(path.join(f.root, 'AppScope/app.json5'), JSON.stringify({ app: { bundleName: 'com.fixture.app' } }));
      fs.writeFileSync(path.join(f.root, 'doc/requests/cases.txt'), '打开应用 -> 点击按钮 -> 等待详情');
      fs.writeFileSync(path.join(f.root, 'doc/requests/plan.md'), '# Plan\n## 测试用例\n| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |\n|---|---|---|---|---|---|---|\n| TC-001 | open | 应用已启动 | {"touch":{"by_text":"打开","match":"exact"}}; {"wait_for":{"by_id":"detail","timeout":5}} | 详情可见 | P1 | ad-hoc |\n');
      fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify({ ...f.request, inputs: { cases: 'doc/requests/cases.txt', test_plan: 'doc/requests/plan.md' } }));
      const steps = JSON.parse(fs.readFileSync(path.join(frameworkRoot, 'harness/tests/fixtures/hylyre-contracts-0.4-p0/contracts/golden/trace/valid/all-passed.json'), 'utf8')).cases[0].steps;
      let mode = 'missing_expected'; let calls = 0; let expectedCalls = 0;
      native.ensureHylyreReady = (opts: any) => { assert.equal(opts.feature, undefined); assert.equal(opts.reportDir, path.join(f.root, f.options.reportDir)); return { ok: true, pythonPath: 'fixture-python' }; };
      gate.applyPhaseEntryDeviceGate = async () => ({ ok: true });
      native.runHylyreDeviceTest = (opts: any) => { calls++; assert.equal(opts.feature, undefined); assert(fs.existsSync(opts.stepsFilePath)); const value = structuredClone(steps); if (mode === 'fake') value[0].device_session = false; const logPath = path.join(opts.reportDir, 'device-test-run.log'); fs.writeFileSync(logPath, JSON.stringify({ result_protocol: 'hylyre.step-outcome/1', total: 2, executed: 2, results: value.map((step: any, index: number) => ({ index, status: 'ok', ...(mode !== 'flat' ? { step_result: step } : {}) })) })); return { executed: true, exitCode: 0, logPath }; };
      const planFile = path.join(f.root, 'doc/requests/plan.md'); fs.writeFileSync(planFile, fs.readFileSync(planFile, 'utf8').replace('详情可见', '详情显示余额 0 元'));
      hylyre.spawnHylyre = (opts: any) => {
        expectedCalls++; assert.deepStrictEqual(opts.hylyreArgv.slice(0, 3), ['ai', 'assert', '详情显示余额 0 元']);
        const response = { result_protocol: 'hylyre.step-outcome/1', ...(mode === 'missing_expected' ? {} : { step_result: { index: 0, kind: 'expected_check', role: 'assertion', duration_ms: 1, device_session: true, outcome: { status: 'passed', observation: { kind: 'assertion', assertion_type: 'expected', matched: true, facts: { channel: 'vlm', instruction_checked: true, matched: true } } }, selector: null, artifacts: [], diagnostic: null, extensions: {} } }) };
        const stdout = JSON.stringify(response); fs.writeFileSync(opts.logPath, stdout); return { status: 0, stdout, stderr: '' };
      };
      const before = tree(path.join(f.root, 'doc/features'));
      assert.equal(await runRequest(f), 1, 'element visibility does not prove the declared balance');
      mode = 'valid';
      assert.equal(await runRequest(f), 0, fs.readFileSync(path.join(f.root, f.options.reportDir, 'script-report.json'), 'utf8')); assert.equal(calls, 2); assert.equal(expectedCalls, 2); assert.deepStrictEqual(tree(path.join(f.root, 'doc/features')), before);
      mode = 'fake'; assert.equal(await runRequest(f), 1); mode = 'flat'; assert.equal(await runRequest(f), 1);
      const beforeVisual = calls;
      const raw = JSON.parse(fs.readFileSync(path.join(f.root, f.options.requestFile), 'utf8')); raw.requested_result = 'pixel_1to1 visual verification';
      fs.writeFileSync(path.join(f.root, f.options.requestFile), JSON.stringify(raw)); f.options.reportDir = 'doc/reports/visual-request';
      assert.equal(await runRequest(f), 1); assert.equal(calls, beforeVisual);
    } finally { hylyre.spawnHylyre = oldSpawn; native.ensureHylyreReady = oldReady; native.runHylyreDeviceTest = oldRun; gate.applyPhaseEntryDeviceGate = oldGate; fs.rmSync(f.root, { recursive: true, force: true }); clearFrameworkConfigCache(); }
  } },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) try { await test.run(); results.push({ name: test.name, ok: true }); } catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
  return results;
}
