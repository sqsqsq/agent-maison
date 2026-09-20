import assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
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
// D0.1: these cases assert acceptance-layering semantics, so they supply the sourced impact the
// resolver now requires before device verification may be pruned. An impact judgement with an EMPTY
// basis is rejected outright (a claim with no source must never prune a duty), so the fixture names
// a source and supplies the reading layer's verdict for it — the resolved facts are the pure
// function's own input type, not a forged production artifact.
const impactSource = { input_id: 'impact-source', source: { kind: 'derive' as const, provider_id: 'derive.codebase' as const }, dependencies: [], source_refs: ['src/value.ts'], content_fingerprint: 'b'.repeat(64) };
const scopeFor = (value: AcceptanceSpec) => resolveExecutionScope(
  { request: { completion_target: 'feature', requested_results: ['delivery'], requested_phases: ['coding'],
    impact: { user_visible_behavior_change: false, reason: 'fixture: unit verification only', basis: [impactSource] } },
    facts: [], contract_fingerprints: [] },
  workflow, { value, binding },
  { fidelity: { state: 'missing', visual_requested: false }, impact_basis: [{ input_id: 'impact-source', ok: true, related: true, detail: 'fixture reading-layer verdict' }], basis: [], satisfied_by: [],
    targets: { implementation_files: ['src/value.ts'], contracts_files: [], review_targets: [], ut_targets: [] },
    impact_targets_available: true });

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
      fs.rmSync(path.join(f.root, 'doc/features/live/context/facts.md'));
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
      fs.rmSync(path.join(f.root, 'doc/features/live/context/facts.md'));
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
      // 正常载体：此前这里缺 `module.json5`，只因 hvigor 被打桩才没被真实执行链拦住（第一轮代码 review 建议）。
      fs.writeFileSync(path.join(f.root, 'entry/src/ohosTest/module.json5'), '{"module":{"name":"entry_test"}}');
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
  // ==========================================================================
  // 准备期只读探测的判据（plan a9f3c7d2 第一笔 · R3）
  // 判据只有两条：模块归属（唯一命中 `<srcPath>/src/ohosTest/`）与载体在场（`module.json5`）。
  // **源码与 describe/it 数量校验留在执行期**——准备期的关键正例是「载体在场、授权测试文件尚不存在」。
  // ==========================================================================
  { name: 'hmos UT target probe rejects a non-ohosTest landing and a module without a test carrier', run() {
    const { inspectRequestTargets } = require('../../../profiles/hmos-app/harness/providers/ut-run') as {
      inspectRequestTargets: (root: string, tests: readonly string[]) => { groups: Map<string, unknown>; gaps: string[]; typedGaps: Array<{ kind: string; message: string }> };
    };
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-probe-'));
    try {
      // 根 build-profile 里 CommFunc **没有 targets**（宿主真实形态，§2.2 D4）：判据不得改用它。
      fs.writeFileSync(path.join(root, 'build-profile.json5'), JSON.stringify({ modules: [
        { name: 'CommFunc', srcPath: './lib/CommFunc' },
        { name: 'NoCarrier', srcPath: './lib/NoCarrier' },
      ] }));
      fs.mkdirSync(path.join(root, 'lib/CommFunc/src/ohosTest/ets/test'), { recursive: true });
      fs.writeFileSync(path.join(root, 'lib/CommFunc/src/ohosTest/module.json5'), '{"module":{"name":"CommFunc_test"}}');
      fs.mkdirSync(path.join(root, 'lib/NoCarrier/src/ohosTest/ets/test'), { recursive: true }); // 有目录、缺 module.json5
      const target = 'lib/CommFunc/src/ohosTest/ets/test/MaskUtil.test.ets';

      // ① 关键正例：载体在场、**授权写入的测试文件尚不存在** → 无 gap（agent 写测试前的真实时点）。
      assert(!fs.existsSync(path.join(root, target)), '正例必须在测试文件尚不存在时判定');
      const pending = inspectRequestTargets(root, [target]);
      assert.deepStrictEqual(pending.gaps, [], `载体在场时不应报 gap: ${JSON.stringify(pending.gaps)}`);
      assert(pending.groups.has('CommFunc'), '合法目标应归组到其模块');

      // ④ 同一目标：根 build-profile 该模块无 `targets` 也照样无 gap（锁住不得改用根 targets 语义）。
      const rootProfile = JSON.parse(fs.readFileSync(path.join(root, 'build-profile.json5'), 'utf8')) as { modules: Array<{ name: string; targets?: unknown }> };
      assert(rootProfile.modules.every(module => module.targets === undefined), '夹具须保持「根条目无 targets」这一宿主形态');

      // ② 落点不兼容：`src/test/` 下的目标。
      const landing = inspectRequestTargets(root, ['lib/CommFunc/src/test/MaskUtil.test.ets']);
      assert.equal(landing.gaps.length, 1, JSON.stringify(landing.gaps));
      assert(landing.gaps[0].startsWith('capability:ut.run:'), landing.gaps[0]);
      assert(landing.gaps[0].includes('src/ohosTest/'), '落点 gap 须说明合法落点');

      // ③ 无测试载体：目录在、`module.json5` 缺 → 载体 gap，且文案带「先向用户说明」这句范围约定。
      const carrier = inspectRequestTargets(root, ['lib/NoCarrier/src/ohosTest/ets/test/X.test.ets']) as
        { gaps: string[]; typedGaps: Array<{ kind: string; message: string }> };
      assert.equal(carrier.gaps.length, 1, JSON.stringify(carrier.gaps));
      assert(carrier.gaps[0].includes('module.json5'), carrier.gaps[0]);
      assert(carrier.gaps[0].includes('先向用户说明'), '载体 gap 须带范围外改动约定（需求 R3 第三条的准备期落点）');
      // 载体缺口是**准备期事前告知**，不得升级成新的执行期拒绝（执行语义一行不变）。
      assert.equal(carrier.typedGaps[0].kind, 'carrier', JSON.stringify(carrier.typedGaps));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
  { name: 'probe and executor share one predicate', async run() {
    const utRun = require('../../../profiles/hmos-app/harness/providers/ut-run') as {
      inspectRequestTargets: (root: string, tests: readonly string[]) => { gaps: string[] };
      runRequestTests: (ctx: unknown) => Promise<unknown>;
    };
    // 共用面只有「模块归属 / 载体」：源码内容校验（describe/it 数量、类名）不在其中，
    // 所以探测对「文件不存在」必须不报错——这正是准备期唯一能成立的时点。
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ut-probe-share-'));
    try {
      fs.writeFileSync(path.join(root, 'build-profile.json5'), JSON.stringify({ modules: [{ name: 'entry', srcPath: './entry' }] }));
      fs.mkdirSync(path.join(root, 'entry/src/ohosTest/ets/test'), { recursive: true });
      fs.writeFileSync(path.join(root, 'entry/src/ohosTest/module.json5'), '{"module":{"name":"entry_test"}}');
      const missing = 'entry/src/ohosTest/ets/test/NotWrittenYet.test.ets';
      assert.deepStrictEqual(utRun.inspectRequestTargets(root, [missing]).gaps, [], '探测不得因文件不存在而报错或报 gap');

      // **行为断言**（不只看源码串）：同一个落点非法的目标，探测报 landing gap，执行器**用同一条文案拒绝**。
      const illegal = 'entry/src/test/Illegal.test.ets';
      const probeGaps = utRun.inspectRequestTargets(root, [illegal]).gaps;
      assert.equal(probeGaps.length, 1, JSON.stringify(probeGaps));
      const ctx = {
        projectRoot: root, frameworkRoot, harnessRoot: frameworkRoot, reportDir: root,
        resolvedProfile: { name: 'hmos-app', profileDir: '', capabilities: {}, phasesDisabled: new Set<string>() },
        request: { targets: { tests: [illegal] }, sourceContents: [], request_sha256: 'x'.repeat(64) },
      };
      const saved = { a: process.env.HARNESS_SKIP_HVIGOR, b: process.env.HARNESS_SKIP_HVIGOR_TEST };
      delete process.env.HARNESS_SKIP_HVIGOR; delete process.env.HARNESS_SKIP_HVIGOR_TEST;
      try {
        await assert.rejects(() => utRun.runRequestTests(ctx), (error: Error) => {
          assert.equal(error.message, probeGaps[0], '执行器的拒绝文案与探测不同源（谓词被复制了）');
          return true;
        });
      } finally {
        if (saved.a === undefined) delete process.env.HARNESS_SKIP_HVIGOR; else process.env.HARNESS_SKIP_HVIGOR = saved.a;
        if (saved.b === undefined) delete process.env.HARNESS_SKIP_HVIGOR_TEST; else process.env.HARNESS_SKIP_HVIGOR_TEST = saved.b;
      }

      // 接线形态的补充断言（源码串，只证明边界没被搬动，不替代上面的行为断言）。
      const source = fs.readFileSync(path.join(frameworkRoot, 'profiles/hmos-app/harness/providers/ut-run.ts'), 'utf8');
      const probeBody = source.slice(source.indexOf('export function inspectRequestTargets'), source.indexOf('export async function runRequestTests'));
      assert(!probeBody.includes('extractUtItBlocks'), '探测不得把执行期的源码校验搬到准备期');
      assert(!probeBody.includes('sourceContents'), '探测不得依赖测试文件字节（准备期它可能还不存在）');
      assert(source.slice(source.indexOf('export async function runRequestTests')).includes('extractUtItBlocks'), '源码内容校验应仍留在执行期');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  } },
  { name: 'feature-body UT behavior is unchanged by the request-only expectation check', run() {
    // R2 的零影响论证（plan §3 问题 2）：新检查只活在 request 分支。
    // ① **行为面**：既有提取器对同一输入的结果一字不变（含「同一行两条 it(」这种它本来就数 2 的形态），
    //    新分类器与它并列存在、互不影响；
    // ② **接线面**：新 check id 在两个 checker 源码里零出现——feature 主体路径不可能产出它。
    const { extractUtItBlocks, classifyUtExpectations } = require('../../scripts/utils/ut-it-blocks') as {
      extractUtItBlocks: (content: string) => Array<{ name: string; body: string }>;
      classifyUtExpectations: (content: string) => { entries: Array<{ name: string; class: string }>; parsed: number; itFormCount: number };
    };
    const sample = [
      "describe('Suite', () => {",
      "  it('[AC-1] alpha', 0, () => { expect(1).assertEqual(1); });",
      "  it('[CHAR-b] beta', 0, () => {}); it('gamma', 0, () => {});",
      '});',
      '',
    ].join('\n');
    const before = extractUtItBlocks(sample);
    assert.deepStrictEqual(before.map(block => block.name), ['[AC-1] alpha', '[CHAR-b] beta', 'gamma'], '既有提取器行为被改动');
    classifyUtExpectations(sample);
    assert.deepStrictEqual(extractUtItBlocks(sample), before, '调用新分类器后既有提取器结果发生变化');
    for (const rel of ['harness/scripts/check-ut.ts', 'harness/scripts/check-testing.ts']) {
      const source = fs.readFileSync(path.join(frameworkRoot, rel), 'utf8');
      assert(!source.includes('request_expectation_source'), `${rel} 引用了 request 专属检查，feature 主体可能被波及`);
    }
  } },
  { name: 'compile check refuses to run without contracts modules', run() {
    // 保护性用例（plan §3 问题 4）：adhoc 修正链给的 ctx 没有 contracts，编译项在读 modules 时就拒绝执行。
    // **只锁这条谓词**，不承诺能发现 adhoc 链被修好——手工入参永远缺 modules。
    const { profileCodingHost } = require('../../../profiles/hmos-app/harness/coding-host-rules') as {
      profileCodingHost: { checkCodingCompile: (ctx: unknown) => Array<{ id: string; status: string; severity: string; details?: string }> };
    };
    const ctx = {
      phase: 'coding', feature: '_adhoc', projectRoot: frameworkRoot, phaseRule: {}, featureSpec: { feature: '_adhoc' },
      resolvedProfile: { name: 'hmos-app', profileDir: '', capabilities: { 'coding.compile': { provider: 'hvigor', severity: 'BLOCKER' } }, phasesDisabled: new Set<string>() },
      frameworkRoot, harnessRoot: frameworkRoot,
    };
    const results = profileCodingHost.checkCodingCompile(ctx);
    assert(results.length >= 1, '编译检查应返回结论');
    for (const result of results) {
      assert.equal(result.status, 'FAIL', JSON.stringify(result));
      assert.equal(result.severity, 'BLOCKER', JSON.stringify(result));
      assert(result.details?.includes('contracts.yaml > modules 为空'), JSON.stringify(result));
    }
  } },
];

export async function runAll(): Promise<UnitCaseResult[]> {
  const results: UnitCaseResult[] = [];
  for (const test of cases) try { await test.run(); results.push({ name: test.name, ok: true }); } catch (error) { results.push({ name: test.name, ok: false, error: String(error) }); }
  return results;
}
