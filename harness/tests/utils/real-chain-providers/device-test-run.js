// real-chain（plan d4a1f7c3 §4.2 / §10.4）：device_test.run 的**可执行替身**。
//
// 分工只有一条线：**真正操作设备的那三个动作是替身，读盘判定全部留在生产实现上。**
//   · 替身：ensureHylyreReady（不装 Python venv、不跑 doctor）、runHylyreDeviceTest（不起真机）；
//   · 生产实现（shim 回 hmos-app）：parseHylyreTrace / evaluateHylyreNativeEvidenceGate /
//     composeDeviceTestEvidence / probeHylyreEvidenceCapability / preflightHylyreEvidenceCapability
//     ——它们是纯读盘逻辑，替掉就等于把 testing 的判据也替掉了。
//
// trace 的形状不由本文件自拟：逐步骤克隆冻结契约自带的 golden step
// （contracts/golden/step/valid/passed-*.json；断言元素在产品源码里没有字面 `.id(...)` 时克隆
// failed-assertion-mismatch-presence，见 `renderedIds`），case 的三轴与 tool_calls 由**生产 reducer**
// （hylyre-crossrow-verifier 的 reduceCase / toolCallsProjection）反推——本替身写不出
// 一份"自洽但不合契约"的 trace，schema + 跨行 oracle 仍然是真门。
const crypto = require('crypto');
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

/**
 * 渲染规则（plan 14771034 §2.1）：断言步骤 `by_id X` 只有当产品源码
 * （工程内 `src/main/ets/**` 的 .ets）含字面 `.id('X')` 时才判"出现"。
 * 只读源码字面、不证明任何设备真值——它让"断言失败 → 责任路由 → 回退 → 重验"
 * 这条消费链由产品源码的真实变化驱动，而不是由替身自报。
 */
function renderedIds(projectRoot) {
  const ids = new Set();
  const skip = new Set(['framework', 'node_modules', '.git', 'build', 'doc']);
  const walk = dir => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!skip.has(ent.name)) walk(abs); continue; }
      if (!/\.ets$/.test(ent.name) || !/[\\/]src[\\/]main[\\/]ets[\\/]/.test(abs)) continue;
      for (const m of fs.readFileSync(abs, 'utf-8').matchAll(/\.id\(\s*['"]([^'"]+)['"]\s*\)/g)) ids.add(m[1]);
    }
  };
  walk(projectRoot);
  return ids;
}

/** 失败断言的失败边界义务：落一份 ui_dump（路径相对 trace 目录，sha256 与字节一致）。 */
function failureDump(traceDir, caseId, index, missingId) {
  const rel = `failures/${caseId}-step-${index}.json`;
  const bytes = Buffer.from(`${JSON.stringify({ seam: 'real-chain', missing_id: missingId })}\n`, 'utf-8');
  fs.mkdirSync(path.join(traceDir, 'failures'), { recursive: true });
  fs.writeFileSync(path.join(traceDir, rel), bytes);
  return { kind: 'ui_dump', path: rel, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

/** 一条计划步骤 → 一行 StepResult（克隆 golden 后只改身份字段）。 */
function stepResultFor(planned, index, rendered, traceDir, caseId) {
  if (planned.role === 'assertion' && planned.selector && planned.selector.kind === 'by_id'
    && !rendered.has(planned.selector.value)) {
    const step = goldenStep('failed-assertion-mismatch-presence');
    step.index = index;
    step.kind = planned.kind;
    step.duration_ms = 10;
    step.selector.request = { kind: 'by_id', value: planned.selector.value, match: planned.selector.match ?? null, constraints: {} };
    step.artifacts = [failureDump(traceDir, caseId, index, planned.selector.value)];
    return step;
  }
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

function caseResultFor(row, rendered, traceDir) {
  const parsed = parsePlannedStepsFromCell(normalizePlannedStepsCell(row.steps_raw));
  if (!parsed.ok) throw new Error(`real-chain seam: 派生计划步骤不可解析（${row.tc_id}）：${parsed.error}`);
  const steps = parsed.steps.map((step, index) =>
    stepResultFor(normalizePlannedStep(step, index), index, rendered, traceDir, row.tc_id));
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
  const rendered = renderedIds(opts.projectRoot);
  const cases = rows.map(row => caseResultFor(row, rendered, path.dirname(opts.traceOutPath)));
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
