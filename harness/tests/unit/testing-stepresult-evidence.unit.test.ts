/**
 * testing-stepresult-evidence — native Hylyre v1 三重判据、P0 对账、静态 selector 契约
 * 与 native artifact binding。
 *
 * 已迁出本套件（各有专门 suite，勿在此重复）：
 *   · 责任路由与 cause disposition → hylyre-failure-routing-v1
 *   · selector runtime 身份判据     → hylyre-selector-gates-v1
 *   · dispatch 三态                 → hylyre-result-protocol
 * legacy telemetry 过渡桥已随 0.3-p0 一并退场，不再有一致性诊断用例。
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import {
  evaluateHylyreNativeEvidenceGate,
  parseHylyreTrace,
  probeHylyreEvidenceCapability,
  type HylyreEvidenceGateResult,
  type HylyreTrace,
} from '../../../profiles/hmos-app/harness/providers/device-test-run';
import {
  evaluateP0CoverageIntegrity,
  evaluateP0SemanticCoverage,
} from '../../scripts/utils/p0-semantic-gates';
import { lintDerivedPlanSelectorContract } from '../../../profiles/hmos-app/harness/selector-contract';
import { collectFailureRoutesV1 } from '../../scripts/utils/hylyre-failure-routing-v1';
import { dispatchHylyreResult, requireV1ForGate, type TraceV1 } from '../../scripts/utils/hylyre-result-protocol';
import { buildSummaryRepairCandidates } from '../../scripts/utils/repair-candidates';
import {
  __testing_checkHylyreCaseExecutionCompleteness,
  __testing_checkHylyreV1RequiredGates,
  __testing_checkHylyreFailureRouting,
} from '../../scripts/check-testing';
import { validateNativeTraceArtifactBinding } from '../../scripts/utils/native-trace-binding';
import {
  buildCanonicalSelectorIndex,
  normalizePlannedStep,
} from '../../scripts/utils/planned-step-normalizer';
import type { UnitCaseResult } from '../run-unit';

const FEATURE = 'native-evidence';
const VENDORED_TRACE_GOLDEN = path.resolve(
  __dirname,
  '../../../profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/golden/trace/valid',
);

function loadVendoredTraceGolden(name: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(VENDORED_TRACE_GOLDEN, name), 'utf-8')) as Record<string, any>;
}

function write(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

function projectRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-native-evidence-'));
  write(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.1',
    project_name: 'native-evidence',
    project_profile: { name: 'hmos-app', sub_variant: 'app' },
    architecture: {
      outer_layers: [{ id: '02-Feature', can_depend_on: [], intra_layer_deps: 'dag' }],
      module_inner_layers: ['shared'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: {
      features_dir: 'doc/features',
      docs_committed: false,
      reports_dir_pattern: 'doc/features/<feature>/<phase>/reports',
    },
    materialized_adapters: ['cursor'],
  }, null, 2));
  write(root, `doc/features/${FEATURE}/acceptance.yaml`, `flows:
  checkout:
    screens: [home, success]
criteria:
  - id: AC-1
    priority: P0
    ut_layer: device
    linked_flow: checkout
    checkpoint:
      pre_screen: home
      action: { type: touch, target_element_id: pay_button }
      post_screen: success
      required_element_ids: [success_title]
      forbidden_element_ids: [error_banner]
`);
  write(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`, `schema_version: '1.0'
verified: unverified
screens:
  - id: home
    priority: P0
    must_have_elements: [pay_button]
    root:
      type: page
      order: 0
      children:
        - { id: pay_button, type: interactive, order: 0, text: Pay }
  - id: success
    priority: P0
    must_have_elements: [success_title]
    root:
      type: page
      order: 0
      children:
        - { id: success_title, type: content_display, order: 0, text: Success }
        - { id: error_banner, type: content_display, order: 1, text: Error }
tokens: {}
assets: []
`);
  write(root, `doc/features/${FEATURE}/testing/test-plan.md`, `# 测试计划

## 测试用例

| 用例编号 | 用例名称 | 优先级 | 关联 AC |
| --- | --- | --- | --- |
| TC-001 | checkout | P0 | AC-1 |
`);
  const runDir = path.join(root, 'doc', 'features', FEATURE, 'testing', 'reports', '20260830T000000Z', 'hylyre');
  fs.mkdirSync(runDir, { recursive: true });
  write(root, path.relative(root, path.join(runDir, 'test-plan.hylyre.md')), `# 派生 Hylyre 计划

| 用例编号 | 测试步骤 | 优先级 | 关联 AC |
| --- | --- | --- | --- |
| TC-001 | {"touch":{"by_id":"pay_button"}}; {"wait_for":{"by_id":"success_title"}}; {"wait_gone":{"by_id":"error_banner"}} | P0 | AC-1 |
`);
  return root;
}

// plan a6c4e9f2 T4 返修：这里原来产出的是 **0.3 flat 步骤套 0.4-p0 信封** 的混装体
// （顶层 status/failure_kind/failure_code/evidence/error + 旧 selector 三件套）。
// 用它做"native gate PASS"的正例，证明的恰好是**必须被拒绝**的那种输入——绿灯反而掩盖了
// 真实 v1 一条都过不了。现在底座换成与冻结包 golden 同形的真 v1，形状对不对由
// requireV1ForGate 的冻结 schema + 跨行不变量当场判，不再靠手写断言维持。

/** `unique` 解析：candidate_count 必须能从 candidates 复算（冻结 §6.1）。 */
function uniqueSelector(id: string, bounds: string | null = null): Record<string, unknown> {
  return {
    request: { kind: 'by_id', value: id, match: null, constraints: {} },
    resolution: {
      state: 'unique',
      candidate_count: 1,
      selected: { id, bounds },
      candidates: [{ id, bounds }],
    },
  };
}

/** `not_found`：resolver 确认零候选——absence 断言的正例形态。 */
function notFoundSelector(id: string): Record<string, unknown> {
  return {
    request: { kind: 'by_id', value: id, match: null, constraints: {} },
    resolution: { state: 'not_found', candidate_count: 0, selected: null, candidates: [] },
  };
}

function nativeSteps(): Array<Record<string, unknown>> {
  return [
    {
      index: 0, kind: 'touch', role: 'action', duration_ms: 10, device_session: true,
      outcome: { status: 'passed', observation: { kind: 'action', operation: 'touch', performed: true, facts: {} } },
      selector: uniqueSelector('pay_button', '[0,0][100,100]'),
      artifacts: [], diagnostic: null, extensions: {},
    },
    {
      index: 1, kind: 'wait_for', role: 'assertion', duration_ms: 20, device_session: true,
      outcome: {
        status: 'passed',
        observation: {
          kind: 'assertion', assertion_type: 'presence', matched: true,
          facts: { expected_present: true, observed_present: true },
        },
      },
      selector: uniqueSelector('success_title', '[0,0][100,100]'),
      artifacts: [], diagnostic: null, extensions: {},
    },
    {
      index: 2, kind: 'wait_gone', role: 'assertion', duration_ms: 20, device_session: true,
      outcome: {
        status: 'passed',
        observation: {
          kind: 'assertion', assertion_type: 'absence', matched: true,
          facts: { expected_present: false, observed_present: false },
        },
      },
      selector: notFoundSelector('error_banner'),
      artifacts: [], diagnostic: null, extensions: {},
    },
  ];
}

/**
 * `tool_calls` 是 steps[] 的投影，不是自由文本——冻结 §12，跨行 verifier 逐项比对。
 *
 * 按**最终 cases** 派生（而不是构造时固定一份），否则任何改 cases/steps 的用例都会
 * 留下一个陈旧投影，然后以"tool_calls 不是投影"的名义失败——那是夹具自身不自洽，
 * 不是被测逻辑的问题。夹具自洽应当由构造方式保证，而不是靠每个用例记得手工同步。
 */
function projectToolCalls(cases: Array<Record<string, any>>): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  for (const traceCase of cases ?? []) {
    for (const step of (traceCase.steps ?? []) as Array<Record<string, any>>) {
      const outcome = step.outcome ?? {};
      const projection: Record<string, unknown> = { status: outcome.status };
      if (outcome.status === 'failed') {
        projection.failure = { domain: outcome.failure.domain, code: outcome.failure.code };
      } else if (outcome.status === 'blocked') {
        projection.cause = outcome.cause.type === 'prior_step'
          ? { type: 'prior_step', step_index: outcome.cause.step_index }
          : { type: outcome.cause.type, code: outcome.cause.code };
      } else if (outcome.status === 'skipped') {
        projection.reason = { type: outcome.reason.type, code: outcome.reason.code };
      }
      calls.push({
        case: traceCase.id,
        index: step.index,
        kind: step.kind,
        role: step.role,
        outcome: projection,
      });
    }
  }
  return calls;
}

/** 显式 legacy（0.3-p0）底座：只用于"legacy 必须被拒/只读诊断"这类反向用例。 */
function legacyTraceObject(overrides: Record<string, unknown> = {}): Record<string, any> {
  const v1 = traceObject(overrides);
  return {
    ...v1,
    schema_version: '0.3-p0',
    result_protocol: undefined,
    environment: { ...v1.environment, hylyre_version: '0.4.1', trace_schema_version: '0.3-p0', result_protocol: undefined },
  };
}

function traceObject(overrides: Record<string, unknown> = {}): Record<string, any> {
  const caseResult = {
    id: 'TC-001',
    name: 'checkout',
    status: '通过',
    priority: 'P0',
    ac_ref: 'AC-1',
    notes: '',
    execution: 'completed',
    verification: 'passed',
    evidence: 'complete',
    expected_check_mode: 'disabled_by_flag',
    steps: nativeSteps(),
  };
  const trace: Record<string, any> = {
    // plan a6c4e9f2 T7a：底座即 v1——本套件的被测对象已整体切到 Step Outcome v1 的
    // dispatch 判别键。需要 legacy 形态的反向用例改用 legacyTraceObject()。
    schema_version: '0.4-p0',
    result_protocol: 'hylyre.step-outcome/1',
    feature: FEATURE,
    phase: 'testing',
    outcome: 'success',
    // 冻结 schema 的 root required 含 model_backend/retries/artifacts——投影式底座漏掉它们，
    // 合法 trace 会被判"缺必填字段"。
    model_backend: 'none',
    retries: 0,
    artifacts: { plan: 'docs/test-plan.md', use_fakes: true },
    environment: {
      hylyre_version: '0.5.0',
      hypium_version: 'fake',
      trace_schema_version: '0.4-p0',
      result_protocol: 'hylyre.step-outcome/1',
      selector_engine: 'fake',
    },
    cases: [caseResult],
    ...overrides,
  };
  // overrides 可能整体换掉 cases（多 case、改 step 形状）；投影必须跟着最终值走。
  // 调用方显式给了 tool_calls 时才尊重它——那通常是"故意造一个非投影"的反向用例。
  if (!Object.prototype.hasOwnProperty.call(overrides, 'tool_calls')) {
    trace.tool_calls = projectToolCalls(trace.cases as Array<Record<string, any>>);
  }
  return trace;
}

/**
 * 一份**合法**的 v1 失败 trace：断言步骤真失败，且三轴/run outcome/tool_calls 全部
 * 按冻结 reducer 自洽，失败边界义务用 capture-unavailable + evidence=incomplete 如实履行。
 *
 * 旧写法只是往 passed 底座上打三个 flat 字段（status/failure_kind/failure_code），
 * 那既不是 v1，也过不了跨行反推——测试会因为"trace 非法"而 FAIL，看起来仍是绿的，
 * 却完全没有测到"真失败时 P0 门禁会 FAIL"这件事。
 */
function failingTraceObject(): Record<string, any> {
  const trace = traceObject();
  const steps = trace.cases[0].steps as Array<Record<string, any>>;
  // 冻结 failureCode 要求**首段等于 domain**（domainCodeAgreement）：assertion 域唯一核心码
  // 是 `assertion.mismatch`。此前这里写 0.3 的裸码 `assertion_mismatch`，schema 直接拒——
  // 而那条用例只断言"结果是 FAIL"，被拒也是 FAIL，于是夹具非法被完全掩盖。
  steps[1].outcome = {
    status: 'failed',
    failure: { domain: 'assertion', code: 'assertion.mismatch' },
    observation: {
      kind: 'assertion', assertion_type: 'presence', matched: false,
      facts: { expected_present: true, observed_present: false },
    },
  };
  // device-session 内的 assertion 根失败欠一张失败边界截图；这里如实记录 capture 不可用，
  // 并把 case evidence 同步降为 incomplete（冻结 §8.1 不允许只标记不降级）。
  steps[1].extensions = { 'hylyre.capture': { screen: 'unavailable' } };
  trace.cases[0].execution = 'aborted';
  trace.cases[0].verification = 'failed';
  trace.cases[0].evidence = 'incomplete';
  trace.cases[0].status = '失败';
  trace.outcome = 'failed';
  trace.tool_calls = projectToolCalls(trace.cases);
  return trace;
}

function readyMeta(installed = '0.5.0', manifest = '0.5.0'): Record<string, unknown> {
  return {
    ok: true,
    doctorOk: true,
    installed_version: installed,
    manifest_version: manifest,
    version_consistent: true,
  };
}

function gate(trace: Record<string, any>, ready = readyMeta(), manifestVersion = '0.5.0'): HylyreEvidenceGateResult {
  return evaluateHylyreNativeEvidenceGate({
    trace: trace as HylyreTrace,
    readyMeta: ready,
    manifestVersion,
  });
}

function nativeInput(root: string, trace: Record<string, any>, conclusion = '不达标') {
  const tracePath = write(
    root,
    `doc/features/${FEATURE}/testing/reports/20260830T000000Z/hylyre/trace.json`,
    `${JSON.stringify(trace, null, 2)}\n`,
  );
  const parsed = parseHylyreTrace(tracePath)!;
  return {
    projectRoot: root,
    feature: FEATURE,
    planMd: fs.readFileSync(path.join(root, 'doc', 'features', FEATURE, 'testing', 'test-plan.md'), 'utf-8'),
    reportMd: `## 结论\n**测试结论**: ${conclusion}`,
    traceCaseStatus: new Map([['TC-001', '通过']]),
    trace: parsed,
    evidenceGate: gate(trace),
    reportConclusion: conclusion,
  };
}

const CASES: Array<{ name: string; run: () => void }> = [];

function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

test('0.5.0 + 0.4-p0 + hylyre.step-outcome/1 + 完整 CaseResult/StepResult 字段 → native gate PASS', () => {
  const root = projectRoot();
  try {
    const raw = traceObject();
    const parsedPath = write(root, 'trace.json', `${JSON.stringify(raw)}\n`);
    const parsed = parseHylyreTrace(parsedPath)!;
    const result = gate(raw);
    assert.strictEqual(result.native, true, JSON.stringify(result));
    assert.strictEqual(result.mode, 'native');
    assert.strictEqual(parsed.environment?.trace_schema_version, '0.4-p0');
    // 解析层必须原样保留协议声明——丢掉它下游会把合法 v1 误判成"缺协议"。
    assert.strictEqual(parsed.result_protocol, 'hylyre.step-outcome/1');
    assert.strictEqual(parsed.environment?.result_protocol, 'hylyre.step-outcome/1');
    const observation = parsed.cases?.[0]?.steps?.[1]?.outcome;
    assert.strictEqual(observation?.status, 'passed');
    assert.strictEqual(
      observation?.status === 'passed' ? observation.observation?.assertion_type : null,
      'presence',
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('three-part gate negatives: old version, old schema, missing case/step field, version-chain drift', () => {
  const root = projectRoot();
  try {
    const oldVersion = traceObject({ environment: { ...traceObject().environment, hylyre_version: '0.3.2' } });
    assert.strictEqual(gate(oldVersion, readyMeta('0.3.2', '0.3.2'), '0.3.2').native, false);
    assert.ok(gate(oldVersion, readyMeta('0.3.2', '0.3.2'), '0.3.2').reasons.some(r => r.includes('最低版本')));

    const oldSchema = traceObject({
      schema_version: '0.2-p4',
      environment: { ...traceObject().environment, trace_schema_version: '0.2-p4' },
    });
    assert.strictEqual(gate(oldSchema).native, false);
    const legacyPass = traceObject({
      schema_version: '0.2-p4',
      environment: undefined,
      cases: [{ id: 'TC-001', status: '通过' }],
    });
    assert.strictEqual(evaluateP0CoverageIntegrity(nativeInput(root, legacyPass))[0].status, 'FAIL');

    const missingCaseField = traceObject();
    delete missingCaseField.cases[0].verification;
    const missingCaseGate = gate(missingCaseField);
    assert.strictEqual(missingCaseGate.native, false);
    assert.ok(missingCaseGate.reasons.some(r => r.includes('verification')));

    const missingStepField = traceObject();
    delete missingStepField.cases[0].steps[1].selector;
    const missingStepGate = gate(missingStepField);
    assert.strictEqual(missingStepGate.native, false);
    assert.ok(missingStepGate.reasons.some(r => r.includes('selector')));

    const drift = gate(traceObject(), readyMeta('0.4.0', '0.4.1'), '0.4.1');
    assert.strictEqual(drift.native, false);
    assert.ok(drift.reasons.some(r => r.includes('installed') || r.includes('trace')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native artifact binding: trace.artifacts.plan、plan/trace SHA 与 StepResult kind/index 序列必须同轮一致', () => {
  const root = projectRoot();
  try {
    const tracePath = path.join(root, 'doc', 'features', FEATURE, 'testing', 'reports', '20260830T000000Z', 'hylyre', 'trace.json');
    const derivedPlanPath = path.join(path.dirname(tracePath), 'test-plan.hylyre.md');
    const testPlanPath = path.join(root, 'doc', 'features', FEATURE, 'testing', 'test-plan.md');
    const raw = traceObject({ artifacts: { plan: derivedPlanPath.replace(/\\/g, '/') } });
    write(root, path.relative(root, tracePath), `${JSON.stringify(raw, null, 2)}\n`);
    const parsed = parseHylyreTrace(tracePath)!;
    const bound = validateNativeTraceArtifactBinding({
      trace: parsed,
      tracePath,
      testPlanPath,
      derivedPlanPath,
    });
    assert.ok(bound.ok && bound.binding, JSON.stringify(bound));

    const changedPlan = fs.readFileSync(derivedPlanPath, 'utf-8').replace('error_banner', 'other_banner');
    fs.writeFileSync(derivedPlanPath, changedPlan, 'utf-8');
    const stale = validateNativeTraceArtifactBinding({
      trace: parsed,
      tracePath,
      testPlanPath,
      derivedPlanPath,
      expectedDerivedPlanSha256: bound.binding!.derived_plan_sha256,
    });
    assert.ok(!stale.ok && stale.reasons.some(reason => reason.includes('derived-plan SHA-256')), JSON.stringify(stale));

    const wrongPlan = validateNativeTraceArtifactBinding({
      trace: parsed,
      tracePath,
      testPlanPath,
      derivedPlanPath,
      expectedDerivedPlanPath: path.join(path.dirname(derivedPlanPath), 'other-plan.md'),
    });
    assert.ok(!wrongPlan.ok && wrongPlan.reasons.some(reason => reason.includes('derived_plan_path')), JSON.stringify(wrongPlan));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native artifact binding: expected_check 只能是唯一尾部 StepResult；非尾部/重复均拒绝', () => {
  const root = projectRoot();
  try {
    const tracePath = path.join(root, 'doc', 'features', FEATURE, 'testing', 'reports', '20260830T000000Z', 'hylyre', 'trace.json');
    const derivedPlanPath = path.join(path.dirname(tracePath), 'test-plan.hylyre.md');
    const testPlanPath = path.join(root, 'doc', 'features', FEATURE, 'testing', 'test-plan.md');
    const artifacts = { plan: derivedPlanPath.replace(/\\/g, '/') };
    const expected = {
      index: 3, kind: 'expected_check', role: 'assertion', status: 'skipped', failure_kind: 'capability',
      failure_code: 'capability_unsupported', duration_ms: 0, selector: null,
      evidence: { assertion_executed: false }, error: 'disabled',
    };
    const good = traceObject({ artifacts, cases: [{ ...traceObject().cases[0], expected_check_mode: 'disabled_by_flag', steps: [...nativeSteps(), expected] }] });
    write(root, path.relative(root, tracePath), `${JSON.stringify(good, null, 2)}\n`);
    const goodResult = validateNativeTraceArtifactBinding({ trace: parseHylyreTrace(tracePath), tracePath, testPlanPath, derivedPlanPath });
    assert.ok(goodResult.ok, JSON.stringify(goodResult));

    const bad = traceObject({ artifacts, cases: [{ ...traceObject().cases[0], steps: [expected, ...nativeSteps()] }] });
    fs.writeFileSync(tracePath, `${JSON.stringify(bad, null, 2)}\n`, 'utf-8');
    const badResult = validateNativeTraceArtifactBinding({ trace: parseHylyreTrace(tracePath), tracePath, testPlanPath, derivedPlanPath });
    assert.ok(!badResult.ok && badResult.reasons.some(reason => reason.includes('expected_check')), JSON.stringify(badResult));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('top-level explicit skip/P1 execution completeness: missing trace CaseResult stays testing FAIL', () => {
  const root = projectRoot();
  try {
    const topPlan = `# 测试计划\n\n## 测试用例\n\n| 用例编号 | 用例名称 | 优先级 | 关联 AC |\n| --- | --- | --- | --- |\n| TC-001 | checkout | P0 | AC-1 |\n| TC-002 | optional | P1 | AC-1 |\n`;
    write(root, `doc/features/${FEATURE}/testing/test-plan.md`, topPlan);
    const derived = `---\nexplicit_skip_tc_ids: [TC-002]\n---\n\n# 派生\n\n## 测试用例清单\n\n| 用例编号 | 测试步骤 | 优先级 | 关联 AC |\n| --- | --- | --- | --- |\n| TC-001 | {"touch":{"by_id":"pay_button"}} | P0 | AC-1 |\n`;
    const derivedPath = write(root, `doc/features/${FEATURE}/testing/reports/20260830T000000Z/hylyre/test-plan.hylyre.md`, derived);
    const raw = traceObject({ artifacts: { plan: derivedPath.replace(/\\/g, '/') } });
    const ctx = { projectRoot: root, feature: FEATURE, phase: 'testing', frameworkRoot: root } as any;
    const failed = __testing_checkHylyreCaseExecutionCompleteness(ctx, raw as HylyreTrace, gate(raw), derivedPath)[0];
    assert.strictEqual(failed.status, 'FAIL', failed.details);
    assert.match(failed.details, /explicit skip\/未执行/);

    const completeDerived = `${derived}\n| TC-002 | {"wait":{"seconds":1}} | P1 | AC-1 |\n`;
    fs.writeFileSync(derivedPath, completeDerived, 'utf-8');
    const completeTrace = traceObject({
      artifacts: { plan: derivedPath.replace(/\\/g, '/') },
      cases: [traceObject().cases[0], { ...traceObject().cases[0], id: 'TC-002', priority: 'P1' }],
    });
    const passed = __testing_checkHylyreCaseExecutionCompleteness(ctx, completeTrace as HylyreTrace, gate(completeTrace), derivedPath)[0];
    assert.strictEqual(passed.status, 'PASS', passed.details);

    // inventory §一 G4 的反向保护：同一份内容退回 legacy 信封后，这道 required gate
    // **必须响亮失败**，而不是像旧实现那样 `return []` 静默消失。
    const legacy = legacyTraceObject({ artifacts: { plan: derivedPath.replace(/\\/g, '/') } });
    const legacyResult = __testing_checkHylyreCaseExecutionCompleteness(ctx, legacy as HylyreTrace, gate(legacy), derivedPath);
    assert.strictEqual(legacyResult.length, 1, 'legacy 不得让门消失');
    assert.strictEqual(legacyResult[0]!.status, 'FAIL');
    assert.match(legacyResult[0]!.details ?? '', /unsupported-for-evidence/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native P0 acceptance: required/forbidden complete → PASS; old status cannot launder failed assertion', () => {
  const root = projectRoot();
  try {
    const good = traceObject();
    let input = nativeInput(root, good);
    assert.strictEqual(evaluateP0CoverageIntegrity(input)[0].status, 'PASS');
    assert.strictEqual(evaluateP0SemanticCoverage(input)[0].status, 'PASS');

    const disambiguatedPlan = fs.readFileSync(
      path.join(root, 'doc', 'features', FEATURE, 'testing', 'reports', '20260830T000000Z', 'hylyre', 'test-plan.hylyre.md'),
      'utf-8',
    ).replace('by_id":"pay_button"', 'by_id":"pay_button","index":0');
    fs.writeFileSync(
      path.join(root, 'doc', 'features', FEATURE, 'testing', 'reports', '20260830T000000Z', 'hylyre', 'test-plan.hylyre.md'),
      disambiguatedPlan,
      'utf-8',
    );
    // v1 的 index 消歧：谓词进 request.constraints，resolver 应用后回 unique/count=1。
    // 旧写法 `candidate_count=2 + selected` 被冻结 §6.1 直接判非法，不能再当正例。
    const indexed = traceObject();
    const indexedSelector = indexed.cases[0].steps[0].selector as Record<string, any>;
    indexedSelector.request.constraints = { index: 0 };
    indexedSelector.resolution.selected.bounds = '[0,0][10,10]';
    indexedSelector.resolution.candidates = [{ id: 'pay_button', bounds: '[0,0][10,10]' }];
    input = nativeInput(root, indexed);
    assert.strictEqual(evaluateP0SemanticCoverage(input)[0].status, 'PASS', 'index 消歧后的 unique 解析应通过');

    input = nativeInput(root, failingTraceObject());
    assert.strictEqual(evaluateP0CoverageIntegrity(input)[0].status, 'FAIL');
    assert.strictEqual(evaluateP0SemanticCoverage(input)[0].status, 'FAIL');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('shared planned-step normalizer: action wrapper 与 all[] match inheritance 保持 Hylyre kind/selector 语义', () => {
  const wrapped = normalizePlannedStep({ action: { type: 'touch', by_text: 'Pay', match: 'exact' } }, 0);
  assert.strictEqual(wrapped.kind, 'touch');
  assert.strictEqual(wrapped.role, 'action');
  assert.strictEqual(wrapped.selector?.kind, 'by_text');
  assert.strictEqual(wrapped.selector?.match, 'exact');
  const all = normalizePlannedStep({ touch: { match: 'contains', all: [{ by_text: 'Pay' }] } }, 0);
  assert.strictEqual(all.kind, 'touch');
  assert.strictEqual(all.selector?.value, 'Pay');
  assert.strictEqual(all.selector?.match, 'contains');
  assert.ok(all.disambiguated);
});

test('canonical selector index: must_have_elements 与树节点合并后 singleton 不被误判为 ambiguous', () => {
  const uiSpec = {
    screens: [{
      id: 'home',
      priority: 'P0',
      must_have_elements: ['pay_button'],
      root: {
        type: 'page',
        order: 0,
        children: [{ id: 'pay_button', type: 'interactive', order: 0, text: 'Pay' }],
      },
    }],
    tokens: {},
    assets: [],
  } as any;
  const index = buildCanonicalSelectorIndex(uiSpec);
  assert.strictEqual(index.byId.get('pay_button')?.length, 1);
  const md = '# Plan\n\n| 用例编号 | 前置条件 | 测试步骤 | 优先级 | 关联 AC |\n| --- | --- | --- | --- | --- |\n| TC-001 | home | {"touch":{"by_id":"pay_button"}} | P0 | AC-1 |\n';
  assert.deepStrictEqual(lintDerivedPlanSelectorContract(md, uiSpec), []);
});

test('native P0 axes: inconclusive/incomplete/action-only/forbidden missing never enter pass numerator', () => {
  const root = projectRoot();
  try {
    for (const mutation of [
      (t: Record<string, any>) => { t.cases[0].verification = 'inconclusive'; },
      (t: Record<string, any>) => { t.cases[0].evidence = 'incomplete'; },
      (t: Record<string, any>) => { t.cases[0].steps = [t.cases[0].steps[0]]; },
      (t: Record<string, any>) => { t.cases[0].steps = t.cases[0].steps.slice(0, 2); },
      (t: Record<string, any>) => { t.cases[0].steps.splice(1, 1); t.cases[0].steps[1].index = 1; },
    ]) {
      const mutated = traceObject();
      mutation(mutated);
      const mutatedInput = nativeInput(root, mutated);
      assert.strictEqual(evaluateP0CoverageIntegrity(mutatedInput)[0].status, 'FAIL');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('expected_check_mode 四态：deterministic assertions 可覆盖 disabled/unavailable/empty；checked_vlm 必须有通过 expected StepResult', () => {
  const root = projectRoot();
  try {
    for (const mode of ['disabled_by_flag', 'unavailable_no_vlm', 'empty']) {
      const raw = traceObject();
      raw.cases[0].expected_check_mode = mode;
      assert.strictEqual(evaluateP0SemanticCoverage(nativeInput(root, raw))[0].status, 'PASS', mode);
    }
    const checked = traceObject();
    checked.cases[0].expected_check_mode = 'checked_vlm';
    // v1 形态：expected_check 的观测走 assertion_type='expected'，
    // facts 必带 channel / instruction_checked(=true) / matched（冻结 observationV1）。
    checked.cases[0].steps.push({
      index: 3, kind: 'expected_check', role: 'assertion', duration_ms: 2, device_session: true,
      outcome: {
        status: 'passed',
        observation: {
          kind: 'assertion', assertion_type: 'expected', matched: true,
          facts: { channel: 'vlm', instruction_checked: true, matched: true },
        },
      },
      selector: null, artifacts: [], diagnostic: null, extensions: {},
    });
    checked.tool_calls = projectToolCalls(checked.cases);
    assert.strictEqual(evaluateP0SemanticCoverage(nativeInput(root, checked))[0].status, 'PASS');
    const missing = traceObject();
    missing.cases[0].expected_check_mode = 'checked_vlm';
    assert.strictEqual(evaluateP0SemanticCoverage(nativeInput(root, missing))[0].status, 'FAIL');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('缺陷身份稳定：route/disposition 的 check id 与 repair 指纹不随位置漂移', () => {
  const root = projectRoot();
  try {
    const ctx = { projectRoot: root, feature: FEATURE, phase: 'testing', frameworkRoot: root } as any;
    const derivedPath = write(
      root,
      `doc/features/${FEATURE}/testing/reports/20260830T000000Z/hylyre/test-plan.hylyre.md`,
      '# 派生\n',
    );

    // 两条 case 各带一个断言失败；第二轮把**靠前那条**整体修好（case 消失），
    // 于是位置序号会整体前移——而缺陷本身（TC-B 的 step 1）没变。
    const failingCase = (id: string) => {
      const base = failingTraceObject().cases[0];
      return { ...JSON.parse(JSON.stringify(base)), id };
    };
    const twoCases = traceObject({ cases: [failingCase('TC-A'), failingCase('TC-B')] });
    twoCases.outcome = 'failed';
    const oneCase = traceObject({ cases: [failingCase('TC-B')] });
    oneCase.outcome = 'failed';

    const idsOf = (trace: any): string[] =>
      __testing_checkHylyreFailureRouting(ctx, trace as HylyreTrace, gate(trace), derivedPath)
        .map(r => r.id)
        .filter(id => id.startsWith('testing_failure_routing_'));

    const round1 = idsOf(twoCases);
    const round2 = idsOf(oneCase);
    if (round1.length < 2) {
      const diag = __testing_checkHylyreFailureRouting(ctx, twoCases as HylyreTrace, gate(twoCases), derivedPath);
      assert.fail(`第一轮 route 不足：${JSON.stringify(diag.map(r => [r.id, r.details?.slice(0, 300)]))}`);
    }
    assert.ok(round1.length >= 2, JSON.stringify(round1));
    assert.ok(round2.length >= 1, `第二轮应有 ≥1 条 route：${JSON.stringify(round2)}`);

    // 关键性质：TC-B 那条缺陷在两轮里必须是**同一个 id**。
    // 位置式 `_1/_2` 会让它从 _2 变成 _1，进而换掉 item_fingerprint——
    // 而该指纹正是 goal 防震荡 attempted 集合的键，漂移等于"已修过的缺陷"被当成全新候选。
    const bInRound1 = round1.filter(id => id.includes('TC-B'));
    const bInRound2 = round2.filter(id => id.includes('TC-B'));
    assert.ok(bInRound1.length === 1 && bInRound2.length === 1, JSON.stringify({ round1, round2 }));
    assert.strictEqual(bInRound1[0], bInRound2[0], '同一缺陷跨轮 id 必须稳定');

    // 且 id 里不得再出现纯位置序号形态。
    for (const id of [...round1, ...round2]) {
      assert.ok(!/_\d+$/.test(id), `id 仍是位置式：${id}`);
      assert.ok(/_s\d+$/.test(id), `id 应以 step 身份收尾：${id}`);
    }

    // 同一缺陷经 repair-candidate 链后的 item_fingerprint 也必须一致。
    const fingerprintOf = (trace: any): string | undefined => {
      const checks = __testing_checkHylyreFailureRouting(ctx, trace as HylyreTrace, gate(trace), derivedPath)
        .filter(r => r.id.includes('TC-B'))
        .map(r => ({ id: r.id, status: r.status, details: r.details, failure_kind: r.failure_kind,
          failure_code: r.failure_code, coding_candidate: r.coding_candidate, repair_owner: r.repair_owner }));
      return buildSummaryRepairCandidates({
        phase: 'testing', checks: checks as any,
        reportValidity: 'PASS', reviewReportText: null, verifierReportText: null,
      })[0]?.item_fingerprint;
    };
    const f1 = fingerprintOf(twoCases);
    const f2 = fingerprintOf(oneCase);
    assert.ok(f1 && f2, `两轮都应产出候选：${String(f1)} / ${String(f2)}`);
    assert.strictEqual(f1, f2, '同一缺陷跨轮 item_fingerprint 必须稳定（防震荡记账的键）');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('无 P0 device AC 时 evidenceGate=null：合法 v1 run 不得被判协议失败', () => {
  const root = projectRoot();
  try {
    const raw = traceObject();
    const tracePath = write(
      root,
      `doc/features/${FEATURE}/testing/reports/20260830T000000Z/hylyre/trace.json`,
      `${JSON.stringify(raw, null, 2)}\n`,
    );
    const derivedPath = path.join(
      root, 'doc', 'features', FEATURE, 'testing', 'reports', '20260830T000000Z', 'hylyre', 'test-plan.hylyre.md',
    );
    const ctx = { projectRoot: root, feature: FEATURE, phase: 'testing', frameworkRoot: root } as any;
    const parsed = parseHylyreTrace(tracePath);

    // evidenceGate 只在存在 P0 device AC（runtimeEvidenceRequired）时生成。
    // 一个没有 P0 acceptance、但确实跑了合法 v1 Hylyre case 的 feature 会拿到 null——
    // 那表示"三重身份门不适用"，不是"协议非法"。这三道门此前把 null 当失败，
    // 于是这类 feature 平白吃三条 unsupported_result_protocol。
    const withNullGate = __testing_checkHylyreV1RequiredGates(ctx, tracePath, parsed, null, derivedPath);
    const protocolFailures = withNullGate.filter(
      r => r.status === 'FAIL' && r.failure_kind === 'unsupported_result_protocol',
    );
    assert.strictEqual(
      protocolFailures.length,
      0,
      `evidenceGate=null 不得产出协议失败：${JSON.stringify(protocolFailures.map(r => r.id))}`,
    );

    // 反向：gate 存在且 native=false 时，三道门必须响亮失败（不得又退回静默 no-op）。
    const failedGate = { mode: 'unsupported', native: false, legacy: false, minimumVersion: '0.5.0',
      installedVersion: null, manifestVersion: null, traceVersion: null, traceSchemaVersion: null,
      reasons: ['测试构造：版本链不一致'] } as any;
    const withFailedGate = __testing_checkHylyreV1RequiredGates(ctx, tracePath, parsed, failedGate, derivedPath);
    assert.ok(
      withFailedGate.filter(r => r.status === 'FAIL').length >= 3,
      `native=false 时三道门都必须产 BLOCKER，实际：${JSON.stringify(withFailedGate.map(r => [r.id, r.status]))}`,
    );

    // trace 缺失同样是显式失败，而不是静默不适用。
    const withoutTrace = __testing_checkHylyreV1RequiredGates(ctx, null, null, null, derivedPath);
    assert.ok(
      withoutTrace.filter(r => r.status === 'FAIL').length >= 3,
      'trace 缺失时三道门都必须产 BLOCKER',
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('身份护栏：by_text 断言不得闭合 P0 的 required / forbidden 身份', () => {
  const root = projectRoot();
  try {
    // 基线：by_id 形态可以覆盖。
    assert.strictEqual(evaluateP0SemanticCoverage(nativeInput(root, traceObject()))[0].status, 'PASS');

    // required 面：把 presence 断言的**请求**换成 by_text，解析结果原样保留
    // （甚至 selected.id 仍等于目标 id）。这正是护栏要拦的形态——
    // `required_element_ids` 是 id，一次文本命中不构成 id 身份证明。
    const textRequired = traceObject();
    textRequired.cases[0].steps[1].selector.request = {
      kind: 'by_text', value: 'Success', match: 'exact', constraints: {},
    };
    assert.strictEqual(
      evaluateP0SemanticCoverage(nativeInput(root, textRequired))[0].status,
      'FAIL',
      'by_text + unique + selected.id=目标 id 不得闭合 required',
    );

    // forbidden 面：absence 走 by_text 的 not_found。
    // "某段文字没找到"不等于"某个 id 不在场"，同样不得闭合。
    const textForbidden = traceObject();
    textForbidden.cases[0].steps[2].selector.request = {
      kind: 'by_text', value: 'Error', match: 'exact', constraints: {},
    };
    assert.strictEqual(
      evaluateP0SemanticCoverage(nativeInput(root, textForbidden))[0].status,
      'FAIL',
      'by_text + not_found 不得闭合 forbidden',
    );

    // 同 kind 但请求的是**另一个 id**：也不构成本目标的身份证据。
    const wrongId = traceObject();
    wrongId.cases[0].steps[1].selector.request.value = 'some_other_id';
    assert.strictEqual(
      evaluateP0SemanticCoverage(nativeInput(root, wrongId))[0].status,
      'FAIL',
      'by_id 但 request.value 指向别的 id，不得闭合 required',
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('explicit skip without StepResult → testing FAIL and zero coding candidate', () => {
  const root = projectRoot();
  try {
    const raw = traceObject({
      cases: [{ id: 'TC-002', status: '跳过', priority: 'P0', ac_ref: 'AC-1', notes: '' }],
    });
    const input = nativeInput(root, raw);
    const coverage = evaluateP0CoverageIntegrity(input)[0];
    assert.strictEqual(coverage.status, 'FAIL');
    assert.strictEqual(coverage.failure_kind, undefined);
    // plan a6c4e9f2 T4：无 steps 的 explicit skip case **零** failure route——
    // 缺口只由 completeness 记 testing FAIL，不再由 collector 合成 case-level route。
    const { routes } = collectFailureRoutesV1(raw as unknown as TraceV1);
    assert.strictEqual(routes.length, 0);
    assert.strictEqual(buildSummaryRepairCandidates({
      phase: 'testing', checks: [{ id: coverage.id, status: coverage.status, details: coverage.details }],
      reportValidity: 'PASS', reviewReportText: null, verifierReportText: null,
    }).length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('selector static gate: canonical exact/unique contains pass; ambiguous/aggregate rich text fails independent of dump', () => {
  const uiSpec = {
    screens: [{ id: 'home', priority: 'P0', root: {
      type: 'page', order: 0, children: [
        { id: 'pay_button', type: 'interactive', order: 0, text: 'Pay now' },
        { id: 'terms_row', type: 'row', order: 1, text: 'Terms and privacy', children: [
          { id: 'terms_span', type: 'span', order: 0, text: 'Terms' },
        ] },
      ],
    } }], tokens: {}, assets: [],
  } as any;
  const md = (step: string) => `# Plan\n\n| 用例编号 | 测试步骤 | 优先级 | 关联 AC |\n| --- | --- | --- | --- |\n| TC-001 | ${step} | P0 | AC-1 |\n`;
  assert.strictEqual(lintDerivedPlanSelectorContract(md('{"touch":{"by_text":"Pay now","match":"exact"}}'), uiSpec).length, 0);
  assert.strictEqual(lintDerivedPlanSelectorContract(md('{"touch":{"by_text":"Pay","match":"contains"}}'), uiSpec).length, 0);
  const ambiguous = {
    ...uiSpec,
    screens: [{ ...uiSpec.screens[0], root: {
      ...uiSpec.screens[0].root,
      children: [
        { id: 'pay1', type: 'interactive', order: 0, text: 'Pay now' },
        { id: 'pay2', type: 'interactive', order: 1, text: 'Pay now' },
      ],
    } }],
  } as any;
  const ambiguity = lintDerivedPlanSelectorContract(md('{"touch":{"by_text":"Pay","match":"contains"}}'), ambiguous);
  assert.ok(ambiguity.some(v => v.severity === 'BLOCKER'));
  const aggregate = lintDerivedPlanSelectorContract(md('{"touch":{"by_text":"privacy","match":"contains"}}'), uiSpec);
  assert.ok(aggregate.some(v => v.message.includes('富文本')));
  const crossScreen = {
    ...uiSpec,
    screens: [
      uiSpec.screens[0],
      { id: 'success', priority: 'P0', root: {
        type: 'page', order: 0, children: [{ id: 'pay_success', type: 'interactive', order: 0, text: 'Pay now' }],
      } },
    ],
  } as any;
  const screenAwareMd = (precondition: string) => `# Plan\n\n| 用例编号 | 前置条件 | 测试步骤 | 优先级 | 关联 AC |\n| --- | --- | --- | --- | --- |\n| TC-001 | ${precondition} | {"touch":{"by_text":"Pay now","match":"exact"}} | P0 | AC-1 |\n`;
  assert.strictEqual(lintDerivedPlanSelectorContract(screenAwareMd('home'), crossScreen).length, 0);
  // plan a6c4e9f2 D1（review P1 纠偏）：当前 screen 静态不可determine 时，候选跨屏重复
  // 只是资料不足，不是"ui-spec 已证明的同屏多映射"——降为 WARN 交 runtime 裁决。
  const unknownScreen = lintDerivedPlanSelectorContract(screenAwareMd('unknown-screen'), crossScreen);
  assert.strictEqual(unknownScreen.filter(v => v.severity === 'BLOCKER').length, 0, 'screen 未知不得当确定错误阻断');
  assert.ok(unknownScreen.some(v => v.severity === 'WARN'));
});

// review P1：同屏多映射才是确定错误；跨屏重复且 screen 未知属静态不足。
test('selector static gate: 同屏多映射 BLOCKER；screen 未知的跨屏重复只 WARN', () => {
  const twoScreens = {
    screens: [
      { id: 'home', priority: 'P0', root: { type: 'page', order: 0, children: [{ id: 'pay_button', type: 'i', order: 0, text: 'Pay now' }] } },
      { id: 'success', priority: 'P0', root: { type: 'page', order: 0, children: [{ id: 'pay_button', type: 'i', order: 0, text: 'Pay now' }] } },
    ], tokens: {}, assets: [],
  } as any;
  const sameScreenTwice = {
    screens: [{ id: 'home', priority: 'P0', root: { type: 'page', order: 0, children: [
      { id: 'pay_button', type: 'i', order: 0, text: 'Pay now' },
      { id: 'pay_button', type: 'i', order: 1, text: 'Pay now' },
    ] } }], tokens: {}, assets: [],
  } as any;
  const row = (pre: string) =>
    `# Plan\n\n| 用例编号 | 前置条件 | 测试步骤 | 优先级 | 关联 AC |\n| --- | --- | --- | --- | --- |\n| TC-001 | ${pre} | {"touch":{"by_id":"pay_button"}} | P0 | AC-1 |\n`;

  assert.strictEqual(
    lintDerivedPlanSelectorContract(row(''), twoScreens).filter(v => v.severity === 'BLOCKER').length,
    0, '无前置条件 → screen 未知 → 不阻断',
  );
  assert.ok(
    lintDerivedPlanSelectorContract(row('home'), sameScreenTwice).some(v => v.severity === 'BLOCKER'),
    '唯一确定 screen 且该屏内多候选 → 确定错误',
  );
});

// review P1：AC id 词法须复用 check-acceptance SSOT，本地 /AC-\d+/ 会漏 AC-G1 等形态。
test('selector static gate: checkpoint 冲突判据覆盖 AC-G1 等非纯数字 AC id', () => {
  const uiSpec = { screens: [{ id: 's', priority: 'P0', root: { type: 'page', order: 0, children: [] } }], tokens: {}, assets: [] } as any;
  const row = (acRef: string) =>
    `# Plan\n\n| 用例编号 | 测试步骤 | 优先级 | 关联 AC |\n| --- | --- | --- | --- |\n| TC-001 | {"touch":{"by_id":"planned_target"}} | P0 | ${acRef} |\n`;
  const bindings = [{ ac_id: 'AC-G1', target_element_id: 'checkpoint_target' }];
  const conflict = lintDerivedPlanSelectorContract(row('AC-G1'), uiSpec, undefined, { acceptanceActionBindings: bindings });
  assert.ok(conflict.some(v => v.severity === 'BLOCKER' && v.message.includes('明确冲突')), 'AC-G1 的冲突不得被漏判');
});

// plan a6c4e9f2 D1/T2：feature ui-spec 是开放世界——缺席只给 provenance WARN，
// 不再是 BLOCKER；唯一散文外的 acceptance 冲突判据必须双向唯一才成立。
test('selector static gate open world: ui-spec miss is WARN; only a structured checkpoint conflict blocks', () => {
  const uiSpec = {
    screens: [{ id: 'card_pack', priority: 'P0', root: {
      type: 'page', order: 0, children: [
        { id: 'card_pack_title', type: 'text', order: 0, text: '我的卡包' },
      ],
    } }], tokens: {}, assets: [],
  } as any;
  const row = (steps: string, acRef = 'AC-1') =>
    `# Plan\n\n| 用例编号 | 测试步骤 | 优先级 | 关联 AC |\n| --- | --- | --- | --- |\n| TC-001 | ${steps} | P0 | ${acRef} |\n`;

  // ① 既有入口不在 feature ui-spec：只 WARN，不阻断编译。
  const missById = lintDerivedPlanSelectorContract(row('{"touch":{"by_id":"card_category_row_c1"}}'), uiSpec);
  assert.strictEqual(missById.length, 1);
  assert.strictEqual(missById[0]!.severity, 'WARN');
  assert.strictEqual(missById.filter(v => v.severity === 'BLOCKER').length, 0);

  const missByText = lintDerivedPlanSelectorContract(row('{"touch":{"by_text":"添加卡片","match":"exact"}}'), uiSpec);
  assert.strictEqual(missByText.length, 1);
  assert.strictEqual(missByText[0]!.severity, 'WARN');

  // ② 非法/缺失 match 仍是可确定错误。
  assert.ok(
    lintDerivedPlanSelectorContract(row('{"touch":{"by_text":"添加卡片"}}'), uiSpec)
      .some(v => v.severity === 'BLOCKER'),
    '缺显式 match 仍须 BLOCKER',
  );

  // ③ 结构化冲突：唯一 AC × 唯一 checkpoint target × 唯一 action by_id，且不相等。
  const bindings = [{ ac_id: 'AC-1', target_element_id: 'card_pack_add_card_row' }];
  const conflict = lintDerivedPlanSelectorContract(
    row('{"touch":{"by_id":"card_category_row_c1"}}'),
    uiSpec,
    undefined,
    { acceptanceActionBindings: bindings },
  );
  assert.ok(conflict.some(v => v.severity === 'BLOCKER' && v.message.includes('明确冲突')));

  // ④ 相等即无冲突（仍可能有 ui-spec miss 的 WARN，但不得升级为 BLOCKER）。
  const agreeing = lintDerivedPlanSelectorContract(
    row('{"touch":{"by_id":"card_pack_add_card_row"}}'),
    uiSpec,
    undefined,
    { acceptanceActionBindings: bindings },
  );
  assert.strictEqual(agreeing.filter(v => v.severity === 'BLOCKER').length, 0);

  // ⑤ 没有结构化绑定就不判冲突：两个 action by_id 时无法机器判定哪一步是 checkpoint action。
  const ambiguousBinding = lintDerivedPlanSelectorContract(
    row('{"touch":{"by_id":"home_tab"}}; {"touch":{"by_id":"card_category_row_c1"}}'),
    uiSpec,
    undefined,
    { acceptanceActionBindings: bindings },
  );
  assert.strictEqual(ambiguousBinding.filter(v => v.severity === 'BLOCKER').length, 0);

  // ⑥ 一行关联多个 AC 同样不构成绑定。
  const multiAc = lintDerivedPlanSelectorContract(
    row('{"touch":{"by_id":"card_category_row_c1"}}', 'AC-1, AC-2'),
    uiSpec,
    undefined,
    { acceptanceActionBindings: [...bindings, { ac_id: 'AC-2', target_element_id: 'other_row' }] },
  );
  assert.strictEqual(multiAc.filter(v => v.severity === 'BLOCKER').length, 0);

  // ⑦ 无 binding 输入 = 无判据，不是"无冲突"，同样不得凭空 BLOCKER。
  assert.strictEqual(
    lintDerivedPlanSelectorContract(row('{"touch":{"by_id":"card_category_row_c1"}}'), uiSpec)
      .filter(v => v.severity === 'BLOCKER').length,
    0,
  );
});

test('Phase 0 golden 贯穿 normal required gates：route/disposition 基数与 failure-boundary 保持冻结语义', () => {
  const scenarios = [
    { file: 'bc-opencard-1.json', routes: 1, dispositions: 0, artifactPass: false },
    { file: 'root-blocked-capability.json', routes: 0, dispositions: 1, artifactPass: true },
    { file: 'device-death-midrun.json', routes: 1, dispositions: 1, artifactPass: true },
    { file: 'capture-unavailable-evidence-incomplete.json', routes: 1, dispositions: 0, artifactPass: true },
  ];

  for (const scenario of scenarios) {
    const root = projectRoot();
    try {
      const raw = loadVendoredTraceGolden(scenario.file);
      const caseIds = new Map<string, string>();
      (raw.cases as Array<Record<string, any>>).forEach((c, index) => {
        const old = String(c.id);
        const formal = `TC-${String(index + 1).padStart(3, '0')}`;
        caseIds.set(old, formal);
        c.id = formal;
      });
      for (const call of raw.tool_calls as Array<Record<string, any>>) {
        call.case = caseIds.get(String(call.case)) ?? call.case;
      }
      const topRows = (raw.cases as Array<Record<string, any>>).map(
        c => `| ${c.id} | ${c.name} | ${c.priority} | ${c.ac_ref} | hylyre |`,
      );
      write(root, `doc/features/${FEATURE}/testing/test-plan.md`, [
        '# golden plan', '', '## 三、测试用例清单', '',
        '| 用例编号 | 用例名称 | 优先级 | 关联 AC | 执行通道 |',
        '| --- | --- | --- | --- | --- |',
        ...topRows,
      ].join('\n'));
      const derivedRows = (raw.cases as Array<Record<string, any>>).map(
        c => `| ${c.id} | ${c.name} | {"wait":{"seconds":0}} | ${c.priority} | ${c.ac_ref} |`,
      );
      const derivedPath = write(
        root,
        `doc/features/${FEATURE}/testing/reports/20260830T000000Z/hylyre/test-plan.hylyre.md`,
        [
          '# golden derived', '', '## 测试用例清单', '',
          '| 用例编号 | 用例名称 | 测试步骤 | 优先级 | 关联 AC |',
          '| --- | --- | --- | --- | --- |',
          ...derivedRows,
        ].join('\n'),
      );
      const tracePath = write(
        root,
        `doc/features/${FEATURE}/testing/reports/20260830T000000Z/hylyre/trace.json`,
        `${JSON.stringify(raw, null, 2)}\n`,
      );
      const parsed = parseHylyreTrace(tracePath);
      const nativeGate = gate(raw);
      assert.strictEqual(nativeGate.native, true, `${scenario.file}: ${nativeGate.reasons.join('；')}`);
      assert.strictEqual(requireV1ForGate(raw).ok, true, scenario.file);

      const ctx = { projectRoot: root, feature: FEATURE, phase: 'testing', frameworkRoot: root } as any;
      const completeness = __testing_checkHylyreCaseExecutionCompleteness(
        ctx, parsed, nativeGate, derivedPath,
      );
      assert.strictEqual(completeness[0]?.status, 'PASS', `${scenario.file}: ${completeness[0]?.details}`);

      const normal = __testing_checkHylyreV1RequiredGates(ctx, tracePath, parsed, nativeGate, derivedPath);
      assert.ok(normal.length >= 3, `${scenario.file}: 三道 required gate 不得消失`);
      assert.strictEqual(
        normal.filter(r => r.failure_kind === 'unsupported_result_protocol').length,
        0,
        `${scenario.file}: 合法 golden 不得落 unsupported_result_protocol`,
      );
      const artifact = normal.find(r => r.id === 'testing_artifact_integrity');
      assert.ok(artifact, `${scenario.file}: artifact required gate 缺失`);
      if (scenario.artifactPass) {
        assert.strictEqual(artifact!.status, 'PASS', `${scenario.file}: ${artifact!.details}`);
      } else {
        // bc-opencard golden 只冻结 artifact 引用，不携带引用的二进制字节；生产门必须
        // 因真实文件缺席而 FAIL，不能为 fixture 增加路径 fallback。
        assert.strictEqual(artifact!.status, 'FAIL', `${scenario.file}: 缺 artifact 字节不得误过`);
      }

      const projected = collectFailureRoutesV1(raw as TraceV1);
      assert.strictEqual(projected.routes.length, scenario.routes, `${scenario.file}: route 基数`);
      assert.strictEqual(projected.dispositions.length, scenario.dispositions, `${scenario.file}: disposition 基数`);
      const routed = __testing_checkHylyreFailureRouting(ctx, parsed, nativeGate, derivedPath);
      assert.strictEqual(
        routed.filter(r => r.id.startsWith('testing_failure_routing_')).length,
        scenario.routes,
        `${scenario.file}: check route 基数`,
      );
      assert.strictEqual(
        routed.filter(r => r.id.startsWith('testing_cause_disposition_')).length,
        scenario.dispositions,
        `${scenario.file}: check disposition 基数`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const legacy = loadVendoredTraceGolden('legacy-0.3-p0-readable.json');
  assert.strictEqual(dispatchHylyreResult(legacy).kind, 'legacy_unsupported');
  assert.strictEqual(requireV1ForGate(legacy).ok, false, 'legacy golden 不得闭合 required gate');
  const unknown = loadVendoredTraceGolden('all-passed.json');
  unknown.schema_version = '9.9-p0';
  assert.strictEqual(dispatchHylyreResult(unknown).kind, 'unsupported');
  assert.strictEqual(requireV1ForGate(unknown).ok, false, '未知 schema 不得闭合 required gate');
});

test('vendor fake runner 真实产出 v1（0.4-p0 + hylyre.step-outcome/1）且不写 vendor pycache', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hylyre-fake-trace-'));
  const repoRoot = path.resolve(__dirname, '../../..');
  const srcRoot = path.join(repoRoot, 'profiles', 'hmos-app', 'vendor', 'hylyre', 'src');
  const plan = write(root, 'test-plan.md', `# fake\n\n## 测试用例清单\n\n| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |\n| --- | --- | --- | --- | --- | --- | --- |\n| TC-001 | fake | app | {"touch":{"by_id":"x"}}; {"wait_for":{"by_id":"y"}} | done | P0 | AC-1 |\n`);
  const report = path.join(root, 'test-report.md');
  const trace = path.join(root, 'trace.json');
  try {
    const env = { ...process.env, PYTHONPATH: srcRoot, PYTHONDONTWRITEBYTECODE: '1' };
    const run = spawnSync(process.env.MAISON_PYTHON || 'python', [
      '-B', '-m', 'hylyre', 'run', '--plan', plan, '--feature', 'fake',
      '--report-out', report, '--trace-out', trace, '--use-fakes', '--skip-assert-expected',
    ], { cwd: root, env, encoding: 'utf-8', timeout: 120000, windowsHide: true });
    assert.strictEqual(run.status, 0, `${run.stdout}\n${run.stderr}`);
    const parsed = JSON.parse(fs.readFileSync(trace, 'utf-8')) as Record<string, any>;
    // 这条断言的意义：vendored 0.5.0 **真的跑出来** v1 信封，而不是只有契约文档这么说。
    assert.strictEqual(parsed.schema_version, '0.4-p0');
    assert.strictEqual(parsed.result_protocol, 'hylyre.step-outcome/1');
    assert.ok(Array.isArray(parsed.cases) && parsed.cases[0].steps.length > 0);
    assert.strictEqual(parsed.environment.trace_schema_version, '0.4-p0');
    assert.strictEqual(parsed.environment.result_protocol, 'hylyre.step-outcome/1');
    // 真实产出必须能被 Maison 的统一 dispatch 接受——否则 vendor 与消费侧就脱节了。
    const dispatched = dispatchHylyreResult(parsed);
    assert.strictEqual(dispatched.kind, 'v1', JSON.stringify(dispatched));
    // 只验 dispatch 是**不够的**：dispatch 只看信封，而"信封正确、内容非法"正是本轮
    // 修掉的那类产物。这条测试是唯一真正执行 vendored source 的端到端面，
    // 必须把真实输出一路喂到生产的两道门，否则将来 vendor 退化成混装体它仍会绿。
    const gateVerdict = requireV1ForGate(parsed);
    assert.strictEqual(gateVerdict.ok, true, `真实产出未过 requireV1ForGate：${gateVerdict.detail}`);
    const nativeGate = evaluateHylyreNativeEvidenceGate({
      trace: parseHylyreTrace(trace),
      readyMeta: readyMeta(),
      manifestVersion: '0.5.0',
    });
    assert.strictEqual(
      nativeGate.native,
      true,
      `真实产出未过 native evidence gate：${nativeGate.reasons.join('；')}`,
    );
    // 且每个 step 的机器归因都在 outcome 里，不再有 0.3 的 flat 字段。
    for (const step of parsed.cases[0].steps as Array<Record<string, any>>) {
      assert.ok(step.outcome && typeof step.outcome.status === 'string', 'step 必须带 outcome');
      assert.strictEqual(step.failure_kind, undefined, '不得再有 flat failure_kind');
      assert.strictEqual(step.failure_code, undefined, '不得再有 flat failure_code');
    }
    const pycache = [] as string[];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name === '__pycache__') pycache.push(abs);
        else if (entry.isDirectory()) walk(abs);
      }
    };
    walk(srcRoot);
    assert.strictEqual(pycache.length, 0, `vendor pycache: ${pycache.join(', ')}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

export function runAll(): UnitCaseResult[] {
  return CASES.map(testCase => {
    try {
      testCase.run();
      return { name: `testing-stepresult-evidence: ${testCase.name}`, ok: true };
    } catch (error) {
      return { name: `testing-stepresult-evidence: ${testCase.name}`, ok: false, error: (error as Error).stack ?? (error as Error).message };
    }
  });
}
