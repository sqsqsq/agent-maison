import * as fs from 'fs';
import * as path from 'path';
import { ensureHylyreReady, runHylyreDeviceTest, NATIVE_RESULT_PROTOCOL } from './device-test-run';
import { parseStepsBatchFromRunOut } from '../../../../harness/scripts/utils/adhoc-ui-reset-meta';
import type { StepResultV1, CaseResultV1 } from '../../../../harness/scripts/utils/hylyre-result-protocol';
import type { RequestCheckContext, CheckResult } from '../../../../harness/scripts/utils/types';
import type { NormalizedDeviceTestCase } from '../../../../harness/scripts/utils/device-test-case-kernel';
import { extractDerivedPlanCases, lintHylyrePlanMarkdown, parsePlannedStepsFromCell } from '../../../../harness/scripts/utils/derived-hylyre-plan';
import { applyPhaseEntryDeviceGate } from '../../../../harness/scripts/utils/device-readiness-gate';
import { loadAppBundleName, resolveExecutionDeviceIdentity } from '../hdc-runner';
import { probeInstalledHapSha256 } from '../build-fingerprint';
import { resolveHylyreToolConfig } from '../../../../harness/config';
import { decideReuse, startExecutionKeyRun, writeExecutionKeyRecord, freezeRunArtifacts, restoreFrozenRunArtifacts, sha256Text, computeExecutionKey, type ExecutionKeyInputs } from '../execution-key';
import { CheckExecutionError } from '../../../../harness/scripts/utils/check-execution';
import { resolveAppSnapshotCacheAbs } from '../app-snapshot-warmup';
import { loadHylyreOutputSchema } from '../../../../harness/scripts/utils/hylyre-contract-schema';
import { validateLiteSchema } from '../../../../harness/scripts/utils/lite-json-schema';
import { reduceCase } from '../../../../harness/scripts/utils/hylyre-crossrow-verifier';
import { spawnHylyre, resolveHylyreRuntimeWorkDir } from '../hylyre-spawn';
import { detectDesiredFidelity } from '../../../../harness/scripts/utils/fidelity-shared';
import { findFilesRecursive } from '../../../../harness/scripts/utils/find-files-recursive';

function reject(details: string, failure_kind?: string): never {
  throw new CheckExecutionError({ id: 'request_device_native', category: 'structure', severity: 'BLOCKER', status: failure_kind ? 'SKIP' : 'FAIL', description: '专项设备测试未满足执行条件', details,
    ...(failure_kind ? { failure_kind, blocking_class: failure_kind === 'framework_bug' ? 'framework_internal' : 'externalBlocked' } : {}) });
}

/** The native steps-file entry has no Feature identity; assertions remain native v1 observations. */
export async function runRequestTests(ctx: RequestCheckContext) {
  const spec = ctx.resolvedInputs.values.spec;
  const intent = ctx.request.requested_result + (spec?.state === 'resolved' && typeof spec.value === 'string' ? '\n' + spec.value : '');
  if (detectDesiredFidelity(intent).desired === 'pixel_1to1') reject('pixel fidelity request needs reference/fidelity preparation and a visual provider; native action assertions cannot replace visual evidence', 'capability_missing');
  const input = ctx.resolvedInputs.values.test_plan;
  const casesInput = ctx.resolvedInputs.values.cases;
  if (input?.state !== 'resolved' || typeof input.value !== 'string' || casesInput?.state !== 'resolved') reject('request testing requires cases and an explicit executable test_plan');
  const lint = lintHylyrePlanMarkdown(input.value, undefined, { forbidStartApp: true, canonicalTouch: true });
  if (!lint.ok) reject('request test_plan invalid: ' + JSON.stringify(lint.violations));
  const rows = extractDerivedPlanCases(input.value);
  const requested = casesInput.value as NormalizedDeviceTestCase[];
  if (!rows.length || rows.length !== requested.length || new Set(rows.map(row => row.tc_id)).size !== rows.length || rows.some(row => !requested.some(item => item.id === row.tc_id) || !row.expected.trim())) reject('request plan must cover every requested case with an explicit expected result');
  const plans = rows.map(row => {
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok || !parsed.steps.length) reject(`invalid executable steps: ${row.tc_id}`);
    if (!parsed.steps.some(step => ['wait_for', 'wait_gone', 'assert_toast'].some(key => key in step || (step.action as { type?: string } | undefined)?.type === key))) reject(`request case needs a native assertion: ${row.tc_id}`);
    return { row, steps: parsed.steps };
  });
  const schema = loadHylyreOutputSchema(ctx.frameworkRoot);
  if (!schema.ok) reject(schema.detail, 'framework_bug');
  const bundleName = loadAppBundleName(ctx.projectRoot, details => reject(details));
  const inputs: ExecutionKeyInputs = { hap_sha256_full: null, derived_plan_sha256: sha256Text(JSON.stringify(plans.map(plan => ({ id: plan.row.tc_id, steps: plan.steps, expected: plan.row.expected })))),
    device: process.env.HARNESS_HDC_TARGET?.trim() || null, display_env: '', reset_mode: 'cold_restart', hylyre_version: null,
    manifest_version: null, profile: ctx.resolvedProfile.name, tool_config_sha256: sha256Text(JSON.stringify(resolveHylyreToolConfig(ctx.projectRoot))),
    flags: ['request_steps_file', 'cold_restart', 'skip_page_save', 'checked_vlm', 'bundle=' + bundleName] };
  const started = startExecutionKeyRun(ctx.reportDir, 'hylyre', inputs);
  const runDir = started.runDir; let record = started.record;
  const ready = ensureHylyreReady({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot, phase: 'testing', reportDir: runDir });
  if (!ready.ok) reject(ready.errors.map(error => error.message).join('; '), 'capability_missing');
  const gate = await applyPhaseEntryDeviceGate({ projectRoot: ctx.projectRoot, phase: 'testing', startedBy: 'request-' + ctx.request.request_sha256, log: message => console.error(message) });
  if (!gate.ok) reject(gate.reason ?? 'device not ready', 'device_blocked');
  const identity = resolveExecutionDeviceIdentity();
  const installedHap = probeInstalledHapSha256(bundleName, identity.device);
  Object.assign(inputs, { hap_sha256_full: installedHap, device: identity.device, display_env: identity.display_env, hylyre_version: ready.hylyreVersion, manifest_version: ready.manifestVersion,
    tool_config_sha256: sha256Text(JSON.stringify({ config: resolveHylyreToolConfig(ctx.projectRoot), python: ready.pythonPath, timeout: process.env.HARNESS_HYLYRE_RUN_TIMEOUT_MS ?? null })) });
  record = { ...record, inputs, execution_key: computeExecutionKey(inputs) }; writeExecutionKeyRecord(runDir, record);
  const artifacts = plans.flatMap((_, index) => ['device-test-run.log', 'device-test-run.meta.json', 'native-trace.json', 'native-report.md', 'request-steps.json', 'expected-check.log', 'expected-check.response.json']
    .map(name => ({ top: 'case-' + (index + 1) + '/' + name, frozen: 'frozen.case-' + (index + 1) + '.' + name, group: 'execution' as const })));
  const reuse = !ctx.forceDevice && identity.device && installedHap ? decideReuse(ctx.reportDir, record.execution_key, { artifacts, excludeRunDir: runDir }).reusable : null;
  for (const [index] of plans.entries()) fs.mkdirSync(path.join(runDir, 'case-' + (index + 1)), { recursive: true });
  if (reuse) restoreFrozenRunArtifacts(reuse.runDir, runDir, artifacts);
  const checks: CheckResult[] = []; const evidence_paths: string[] = [];
  const readStep = (value: unknown): StepResultV1 => {
    const issues = validateLiteSchema(value, { $ref: '#/$defs/stepResultV1', $defs: (schema.schema as { $defs?: unknown }).$defs });
    if (issues.length) reject('invalid native request StepResult: ' + JSON.stringify(issues), 'framework_bug');
    return value as StepResultV1;
  };
  for (const [caseIndex, plan] of plans.entries()) {
    const reportDir = path.join(runDir, 'case-' + (caseIndex + 1)); fs.mkdirSync(reportDir, { recursive: true });
    const stepsFilePath = path.join(reportDir, 'request-steps.json'); fs.writeFileSync(stepsFilePath, JSON.stringify(plan.steps));
    const run = reuse ? { executed: true, exitCode: JSON.parse(fs.readFileSync(path.join(reportDir, 'device-test-run.meta.json'), 'utf8')).exit_code as number, logPath: path.join(reportDir, 'device-test-run.log') } : runHylyreDeviceTest({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot, phase: 'testing', reportDir, pythonPath: ready.pythonPath,
      derivedPlanPath: ctx.request.inputs.test_plan, stepsFilePath, reportOutPath: path.join(reportDir, 'native-report.md'), traceOutPath: path.join(reportDir, 'native-trace.json'),
      bundleName, deviceSn: process.env.HARNESS_HDC_TARGET, coldRestart: true, skipPageSave: true, appSnapshotCacheAbs: resolveAppSnapshotCacheAbs(ctx.projectRoot) });
    const batch = parseStepsBatchFromRunOut(fs.readFileSync(run.logPath, 'utf8')) as { result_protocol?: string; total?: number; executed?: number; results?: Array<{ index?: number; step_result?: StepResultV1 }> } | null;
    if (!run.executed || !batch || batch.result_protocol !== NATIVE_RESULT_PROTOCOL || !Number.isInteger(batch.executed) || batch.executed! < 1 || batch.executed! > plan.steps.length || batch.total !== plan.steps.length || batch.results?.length !== plan.steps.length) reject('native request batch incomplete or failed; inspect device-test-run.log', 'capability_missing');
    const actual = batch.results.map((row, index) => {
      const step = readStep(row.step_result);
      if (step.index !== index || row.index !== index) reject('invalid native request step index', 'framework_bug');
      return step;
    });
    evidence_paths.push(run.logPath);
    let expectedOk = false;
    if (actual.every(step => step.device_session === true && step.outcome.status === 'passed')) {
      const logPath = path.join(reportDir, 'expected-check.log');
      if (!reuse) fs.writeFileSync(logPath, '');
      const responsePath = path.join(reportDir, 'expected-check.response.json');
      const { hypiumWorkDir } = resolveHylyreRuntimeWorkDir(ctx.projectRoot, undefined, 'testing', ctx.frameworkRoot, reportDir);
      const expected = reuse ? JSON.parse(fs.readFileSync(responsePath, 'utf8')) as { status: number | null; stdout?: string } : spawnHylyre({ pythonPath: ready.pythonPath, hypiumWorkDir,
        hylyreArgv: ['ai', 'assert', plan.row.expected, ...(process.env.HARNESS_HDC_TARGET ? ['--device-sn', process.env.HARNESS_HDC_TARGET] : [])],
        appSnapshotCacheAbs: resolveAppSnapshotCacheAbs(ctx.projectRoot), logPath, echoToStdout: false });
      if (!reuse) fs.writeFileSync(responsePath, JSON.stringify({ status: expected.status, stdout: expected.stdout ?? '' }));
      const response = JSON.parse(expected.stdout ?? '') as { result_protocol?: string; step_result?: unknown };
      if (response.result_protocol !== NATIVE_RESULT_PROTOCOL) reject('expected-result verification lacks native v1 evidence', 'capability_missing');
      const step = readStep(response.step_result);
      if (step.kind !== 'expected_check' || step.role !== 'assertion') reject('expected-result verification returned the wrong assertion kind', 'framework_bug');
      actual.push({ ...step, index: actual.length });
      expectedOk = expected.status === 0 && step.device_session === true && step.outcome.status === 'passed';
      evidence_paths.push(logPath);
    }
    const reduced = reduceCase({ id: plan.row.tc_id, steps: actual, expected_check_mode: 'checked_vlm' } as CaseResultV1);
    const ok = batch.executed === plan.steps.length && run.exitCode === 0 && expectedOk && actual.every(step => step.device_session === true && step.outcome.status === 'passed') && reduced.execution === 'completed' && reduced.verification === 'passed' && reduced.evidence === 'complete';
    const domains = actual.flatMap(step => step.outcome.status === 'failed' ? [step.outcome.failure.domain] : step.outcome.status === 'blocked' ? [step.outcome.cause.type] : []);
    const failure_kind = domains.includes('internal') ? 'framework_bug' : domains.includes('capability') ? 'capability_missing' : domains.includes('infrastructure') ? 'device_blocked' : undefined;
    checks.push({ id: 'request_device_native', category: 'structure', severity: 'BLOCKER', status: ok ? 'PASS' : failure_kind ? 'SKIP' : 'FAIL', ...(failure_kind ? { failure_kind, blocking_class: failure_kind === 'framework_bug' ? 'framework_internal' : 'externalBlocked' } : {}), description: '专项设备用例原生断言与明确预期', details: plan.row.tc_id + (reuse ? ' (reused_by_execution_key)' : installedHap ? '' : ' (installed HAP unreadable; no reuse)') + ': ' + JSON.stringify(reduced), ...(ok ? {} : { suggestion: '核对原生步骤和明确预期的验证证据；manual、skipped、预期未验证均不能通过。' }) });
  }
  const frozen = freezeRunArtifacts(runDir, runDir, artifacts);
  writeExecutionKeyRecord(runDir, { ...record, outcome: checks.every(check => check.status === 'PASS') ? 'success' : 'failed', timing_complete: frozen.length === artifacts.length, frozen_files: frozen });
  for (const item of artifacts) if (fs.existsSync(path.join(runDir, item.top))) evidence_paths.push(path.join(runDir, item.top));
  return { executed: true, total: checks.length, failed: checks.filter(check => check.status !== 'PASS').length, checks, evidence_paths: [...new Set([...evidence_paths, ...findFilesRecursive(runDir, /^(?!frozen\.)/)])] };
}
