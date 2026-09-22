// real-chain（plan d4a1f7c3 §4.2 / §10.4）：device_test.run 的**可执行替身**。
//
// 分工只有一条线：**真正操作设备的那三个动作是替身，读盘判定全部留在生产实现上。**
//   · 替身：ensureHylyreReady（不装 Python venv、不跑 doctor）、runHylyreDeviceTest（不起真机）；
//   · 生产实现（shim 回 hmos-app）：parseHylyreTrace / evaluateHylyreNativeEvidenceGate /
//     composeDeviceTestEvidence / probeHylyreEvidenceCapability / preflightHylyreEvidenceCapability
//     ——它们是纯读盘逻辑，替掉就等于把 testing 的判据也替掉了。
//
// trace 的形状不由本文件自拟：逐步骤克隆冻结契约自带的 golden step
// （contracts/golden/step/valid/passed-*.json），case 的三轴与 tool_calls 由**生产 reducer**
// （hylyre-crossrow-verifier 的 reduceCase / toolCallsProjection）反推——本替身写不出
// 一份"自洽但不合契约"的 trace，schema + 跨行 oracle 仍然是真门。
const fs = require('fs');
const path = require('path');

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HMOS = path.join(FRAMEWORK_ROOT, 'profiles', 'hmos-app', 'harness');
const HARNESS = path.join(FRAMEWORK_ROOT, 'harness');
/* eslint-disable @typescript-eslint/no-require-imports */
const real = require(path.join(HMOS, 'providers', 'device-test-run.ts'));
const { featurePhaseReportsDir, resolveHylyreToolConfig } = require(path.join(HARNESS, 'config.ts'));
const {
  extractDerivedPlanCases,
  normalizePlannedStepsCell,
  parsePlannedStepsFromCell,
} = require(path.join(HARNESS, 'scripts', 'utils', 'derived-hylyre-plan.ts'));
const { normalizePlannedStep } = require(path.join(HARNESS, 'scripts', 'utils', 'planned-step-normalizer.ts'));
const { reduceCase, toolCallsProjection } = require(path.join(HARNESS, 'scripts', 'utils', 'hylyre-crossrow-verifier.ts'));
/* eslint-enable @typescript-eslint/no-require-imports */

const GOLDEN_STEP_DIR = path.join(
  FRAMEWORK_ROOT, 'profiles', 'hmos-app', 'vendor', 'hylyre', 'src', 'hylyre',
  'contracts', 'golden', 'step', 'valid',
);

exports.provider = {
  id: 'hylyre',
  capability: 'device_test.run',
  exports: [
    'ensureHylyreReady',
    'probeHylyreEvidenceCapability',
    'preflightHylyreEvidenceCapability',
    'runHylyreDeviceTest',
    'parseHylyreTrace',
    'evaluateHylyreNativeEvidenceGate',
    'composeDeviceTestEvidence',
    'runRequestTests',
  ],
};

// ── 生产实现（纯读盘判定，一律不替换）──────────────────────────────────────
exports.parseHylyreTrace = real.parseHylyreTrace;
exports.evaluateHylyreNativeEvidenceGate = real.evaluateHylyreNativeEvidenceGate;
exports.composeDeviceTestEvidence = real.composeDeviceTestEvidence;
exports.probeHylyreEvidenceCapability = real.probeHylyreEvidenceCapability;
exports.preflightHylyreEvidenceCapability = real.preflightHylyreEvidenceCapability;

function vendorManifestVersion(projectRoot) {
  const cfg = resolveHylyreToolConfig(projectRoot);
  const abs = path.resolve(projectRoot, cfg.vendor_dir, 'release.manifest.json');
  return JSON.parse(fs.readFileSync(abs, 'utf-8')).hylyre_version;
}

function goldenStep(name) {
  return JSON.parse(fs.readFileSync(path.join(GOLDEN_STEP_DIR, `${name}.json`), 'utf-8'));
}

// ── 替身①：环境准备（不装 venv、不跑 doctor）────────────────────────────────
// ready meta 是 native evidence gate 的版本链输入之一，形状以生产 writer
// （device-test-run.ts:1494-1520）为准，版本取 vendor manifest 实值、不写死。
exports.ensureHylyreReady = function ensureHylyreReady(opts) {
  const version = vendorManifestVersion(opts.projectRoot);
  const reportsBase = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot);
  fs.mkdirSync(reportsBase, { recursive: true });
  fs.writeFileSync(path.join(reportsBase, 'hylyre-ready.meta.json'), `${JSON.stringify({
    ok: true,
    pythonPath: 'real-chain-seam-python',
    hylyreVersion: version,
    manifestVersion: version,
    installed_version: version,
    manifest_version: version,
    version_consistent: true,
    versionConsistent: true,
    source: 'env_override',
    doctorOk: true,
    errors: [],
  }, null, 2)}\n`, 'utf-8');
  return {
    ok: true,
    pythonPath: 'real-chain-seam-python',
    hylyreVersion: version,
    manifestVersion: version,
    versionConsistent: true,
    source: 'env_override',
    doctorOk: true,
    errors: [],
    logPath: path.join(reportsBase, 'hylyre-doctor.log'),
  };
};

/** 一条计划步骤 → 一行 StepResult（克隆 golden 后只改身份字段）。 */
function stepResultFor(planned, index) {
  const selector = planned.selector
    ? {
        request: { kind: planned.selector.kind, value: planned.selector.value, match: planned.selector.match ?? null, constraints: {} },
        resolution: {
          state: 'unique',
          candidate_count: 1,
          selected: { id: planned.selector.value, bounds: null },
          candidates: [{ id: planned.selector.value, bounds: null }],
        },
      }
    : null;
  if (planned.role === 'assertion') {
    const step = goldenStep('passed-assertion-presence');
    step.index = index;
    step.kind = planned.kind;
    step.duration_ms = 10;
    step.selector = selector;
    return step;
  }
  const step = goldenStep(selector ? 'passed-action-unique-selector' : 'passed-action-no-selector-wait');
  step.index = index;
  step.kind = planned.kind;
  step.duration_ms = 10;
  step.outcome.observation.operation = planned.kind;
  step.outcome.observation.facts = {};
  step.selector = selector;
  return step;
}

function caseResultFor(row) {
  const parsed = parsePlannedStepsFromCell(normalizePlannedStepsCell(row.steps_raw));
  if (!parsed.ok) throw new Error(`real-chain seam: 派生计划步骤不可解析（${row.tc_id}）：${parsed.error}`);
  const steps = parsed.steps.map((step, index) => stepResultFor(normalizePlannedStep(step, index), index));
  const shell = {
    id: row.tc_id,
    name: row.name,
    priority: row.priority,
    ac_ref: row.ac_ref,
    notes: '',
    expected_check_mode: 'empty',
    steps,
  };
  // 三轴由生产 reducer 反推——替身不自报 case 结论。
  return { ...shell, ...reduceCase(shell) };
}

// ── 替身②：真机执行（不起设备；按派生计划产出一份合契约的 native trace）──────
exports.runHylyreDeviceTest = function runHylyreDeviceTest(opts) {
  const derivedMd = fs.readFileSync(opts.derivedPlanPath, 'utf-8');
  const rows = extractDerivedPlanCases(derivedMd);
  if (rows.length === 0) throw new Error('real-chain seam: 派生计划无用例行');
  const cases = rows.map(caseResultFor);
  const version = vendorManifestVersion(opts.projectRoot);
  const allPassed = cases.every(c => c.execution === 'completed' && c.verification === 'passed' && c.evidence === 'complete');
  const trace = {
    schema_version: '0.4-p0',
    result_protocol: 'hylyre.step-outcome/1',
    feature: opts.feature,
    phase: opts.phase,
    outcome: allPassed ? 'success' : 'partial',
    model_backend: 'none',
    tool_calls: toolCallsProjection(cases),
    retries: 0,
    artifacts: { plan: path.resolve(opts.derivedPlanPath), use_fakes: false },
    environment: {
      hylyre_version: version,
      hypium_version: '5.0.7.200',
      trace_schema_version: '0.4-p0',
      result_protocol: 'hylyre.step-outcome/1',
      selector_engine: 'mixed',
    },
    cases,
  };
  fs.mkdirSync(path.dirname(opts.traceOutPath), { recursive: true });
  fs.writeFileSync(opts.traceOutPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf-8');
  fs.writeFileSync(opts.reportOutPath, `# Hylyre report（real-chain seam）\n\ncases=${cases.length}\n`, 'utf-8');
  const logPath = path.join(path.dirname(opts.traceOutPath), 'device-test-run.log');
  fs.writeFileSync(logPath, 'real-chain seam: device_test.run 未操作真机\n', 'utf-8');

  const reportsBase = featurePhaseReportsDir(opts.projectRoot, opts.feature, opts.phase, opts.frameworkRoot);
  const startedAt = new Date(Date.now() - 1000);
  const endedAt = new Date();
  fs.writeFileSync(path.join(reportsBase, 'device-test-run.meta.json'), `${JSON.stringify({
    ok: true,
    exit_code: 0,
    trace_path: opts.traceOutPath,
    report_path: opts.reportOutPath,
    log_path: logPath,
    run_started_at: startedAt.toISOString(),
    run_ended_at: endedAt.toISOString(),
    ran_at: endedAt.toISOString(),
    run_duration_ms: 1000,
    omit_bundle_for_hylyre: true,
    hypium_page_name: null,
    aa_start_ok: true,
  }, null, 2)}\n`, 'utf-8');

  return {
    executed: true,
    exitCode: 0,
    ok: true,
    command: 'real-chain seam: device_test.run',
    reportPath: opts.reportOutPath,
    tracePath: opts.traceOutPath,
    trace: real.parseHylyreTrace(opts.traceOutPath),
    logPath,
    errors: [],
  };
};

exports.runRequestTests = function runRequestTests() {
  throw new Error('real-chain seam: device_test.run/request 不在本链覆盖内');
};
