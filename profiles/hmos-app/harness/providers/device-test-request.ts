import * as fs from 'fs';
import * as path from 'path';
import { ensureHylyreReady, runHylyreDeviceTest, NATIVE_RESULT_PROTOCOL } from './device-test-run';
import { parseStepsBatchFromRunOut } from '../../../../harness/scripts/utils/adhoc-ui-reset-meta';
import type { StepResultV1, CaseResultV1 } from '../../../../harness/scripts/utils/hylyre-result-protocol';
import type { RequestCheckContext, CheckResult } from '../../../../harness/scripts/utils/types';
import type { NormalizedDeviceTestCase } from '../../../../harness/scripts/utils/device-test-case-kernel';
import { extractDerivedPlanCases, lintHylyrePlanMarkdown, parsePlannedStepsFromCell } from '../../../../harness/scripts/utils/derived-hylyre-plan';
import { applyPhaseEntryDeviceGate } from '../../../../harness/scripts/utils/device-readiness-gate';
import { loadAppBundleName } from '../hdc-runner';
import { resolveAppSnapshotCacheAbs } from '../app-snapshot-warmup';
import { loadHylyreOutputSchema } from '../../../../harness/scripts/utils/hylyre-contract-schema';
import { validateLiteSchema } from '../../../../harness/scripts/utils/lite-json-schema';
import { reduceCase } from '../../../../harness/scripts/utils/hylyre-crossrow-verifier';
import { spawnHylyre, resolveHylyreRuntimeWorkDir } from '../hylyre-spawn';
import { detectDesiredFidelity } from '../../../../harness/scripts/utils/fidelity-shared';

/** The native steps-file entry has no Feature identity; assertions remain native v1 observations. */
export async function runRequestTests(ctx: RequestCheckContext) {
  const spec = ctx.resolvedInputs.values.spec;
  const intent = ctx.request.requested_result + (spec?.state === 'resolved' && typeof spec.value === 'string' ? '\n' + spec.value : '');
  if (detectDesiredFidelity(intent).desired === 'pixel_1to1') throw new Error('pixel fidelity request needs reference/fidelity preparation and a visual provider; native action assertions cannot replace visual evidence');
  const input = ctx.resolvedInputs.values.test_plan;
  const casesInput = ctx.resolvedInputs.values.cases;
  if (input?.state !== 'resolved' || typeof input.value !== 'string' || casesInput?.state !== 'resolved') throw new Error('request testing requires cases and an explicit executable test_plan');
  const lint = lintHylyrePlanMarkdown(input.value, undefined, { forbidStartApp: true, canonicalTouch: true });
  if (!lint.ok) throw new Error('request test_plan invalid: ' + JSON.stringify(lint.violations));
  const rows = extractDerivedPlanCases(input.value);
  const requested = casesInput.value as NormalizedDeviceTestCase[];
  if (!rows.length || rows.length !== requested.length || new Set(rows.map(row => row.tc_id)).size !== rows.length || rows.some(row => !requested.some(item => item.id === row.tc_id) || !row.expected.trim())) throw new Error('request plan must cover every requested case with an explicit expected result');
  const plans = rows.map(row => {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok || !parsed.steps.length) throw new Error(`invalid executable steps: ${row.tc_id}`);
    if (!parsed.steps.some(step => ['wait_for', 'wait_gone', 'assert_toast'].some(key => key in step || (step.action as { type?: string } | undefined)?.type === key))) throw new Error(`request case needs a native assertion: ${row.tc_id}`);
    return { row, steps: parsed.steps };
  });
  const schema = loadHylyreOutputSchema(ctx.frameworkRoot);
  if (!schema.ok) throw new Error(schema.detail);
  const ready = ensureHylyreReady({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot, phase: 'testing', reportDir: ctx.reportDir });
  if (!ready.ok) throw new Error(ready.errors.map(error => error.message).join('; '));
  const gate = await applyPhaseEntryDeviceGate({ projectRoot: ctx.projectRoot, phase: 'testing', startedBy: `request-${ctx.request.request_sha256}`, log: message => console.error(message) });
  if (!gate.ok) throw new Error(gate.reason ?? 'device not ready');
  const checks: CheckResult[] = []; const evidence_paths: string[] = [];
  const readStep = (value: unknown): StepResultV1 => {
    const issues = validateLiteSchema(value, { $ref: '#/$defs/stepResultV1', $defs: (schema.schema as { $defs?: unknown }).$defs });
    if (issues.length) throw new Error('invalid native request StepResult: ' + JSON.stringify(issues));
    return value as StepResultV1;
  };
  for (const [caseIndex, plan] of plans.entries()) {
    const reportDir = path.join(ctx.reportDir, 'case-' + (caseIndex + 1)); fs.mkdirSync(reportDir, { recursive: true });
    const stepsFilePath = path.join(reportDir, 'request-steps.json'); fs.writeFileSync(stepsFilePath, JSON.stringify(plan.steps));
    const run = runHylyreDeviceTest({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot, phase: 'testing', reportDir, pythonPath: ready.pythonPath,
      derivedPlanPath: ctx.request.inputs.test_plan, stepsFilePath, reportOutPath: path.join(reportDir, 'native-report.md'), traceOutPath: path.join(reportDir, 'native-trace.json'),
      bundleName: loadAppBundleName(ctx.projectRoot), deviceSn: process.env.HARNESS_HDC_TARGET, coldRestart: true, skipPageSave: true, appSnapshotCacheAbs: resolveAppSnapshotCacheAbs(ctx.projectRoot) });
    const batch = parseStepsBatchFromRunOut(fs.readFileSync(run.logPath, 'utf8')) as { result_protocol?: string; total?: number; executed?: number; results?: Array<{ index?: number; step_result?: StepResultV1 }> } | null;
    if (!run.executed || run.exitCode !== 0 || !batch || batch.result_protocol !== NATIVE_RESULT_PROTOCOL || batch.executed !== plan.steps.length || batch.total !== plan.steps.length || batch.results?.length !== plan.steps.length) throw new Error('native request batch incomplete or failed; inspect device-test-run.log');
    const actual = batch.results.map((row, index) => {
      const step = readStep(row.step_result);
      if (step.index !== index || row.index !== index) throw new Error('invalid native request step index');
      return step;
    });
    evidence_paths.push(run.logPath);
    let expectedOk = false;
    if (actual.every(step => step.device_session === true && step.outcome.status === 'passed')) {
      const logPath = path.join(reportDir, 'expected-check.log'); fs.writeFileSync(logPath, '');
      const { hypiumWorkDir } = resolveHylyreRuntimeWorkDir(ctx.projectRoot, undefined, 'testing', ctx.frameworkRoot, reportDir);
      const expected = spawnHylyre({ pythonPath: ready.pythonPath, hypiumWorkDir,
        hylyreArgv: ['ai', 'assert', plan.row.expected, ...(process.env.HARNESS_HDC_TARGET ? ['--device-sn', process.env.HARNESS_HDC_TARGET] : [])],
        appSnapshotCacheAbs: resolveAppSnapshotCacheAbs(ctx.projectRoot), logPath, echoToStdout: false });
      const response = JSON.parse(expected.stdout ?? '') as { result_protocol?: string; step_result?: unknown };
      if (response.result_protocol !== NATIVE_RESULT_PROTOCOL) throw new Error('expected-result verification lacks native v1 evidence');
      const step = readStep(response.step_result);
      if (step.kind !== 'expected_check' || step.role !== 'assertion') throw new Error('expected-result verification returned the wrong assertion kind');
      actual.push({ ...step, index: actual.length });
      expectedOk = expected.status === 0 && step.device_session === true && step.outcome.status === 'passed';
      evidence_paths.push(logPath);
    }
    const reduced = reduceCase({ id: plan.row.tc_id, steps: actual, expected_check_mode: 'checked_vlm' } as CaseResultV1);
    const ok = expectedOk && actual.every(step => step.device_session === true && step.outcome.status === 'passed') && reduced.execution === 'completed' && reduced.verification === 'passed' && reduced.evidence === 'complete';
    checks.push({ id: 'request_device_native', category: 'structure', severity: 'BLOCKER', status: ok ? 'PASS' : 'FAIL', description: '专项设备用例原生断言与明确预期', details: plan.row.tc_id + ': ' + JSON.stringify(reduced), ...(ok ? {} : { suggestion: '核对原生步骤和明确预期的验证证据；manual、skipped、预期未验证均不能通过。' }) });
  }
  return { executed: true, total: checks.length, failed: checks.filter(check => check.status === 'FAIL').length, checks, evidence_paths };
}
