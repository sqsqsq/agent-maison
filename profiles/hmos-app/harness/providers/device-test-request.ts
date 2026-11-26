import { effectiveForceDevice } from '../../../../harness/scripts/utils/managed-goal-invocation';
import * as fs from 'fs';
import * as path from 'path';
import { ensureHylyreReady, runHylyreDeviceTest, NATIVE_RESULT_PROTOCOL } from './device-test-run';
import { parseStepsRunOut } from '../../../../harness/scripts/utils/adhoc-ui-reset-meta';
import type { StepResultV1, CaseResultV1 } from '../../../../harness/scripts/utils/hylyre-result-protocol';
import type { RequestCheckContext, CheckResult } from '../../../../harness/scripts/utils/types';
import type { NormalizedDeviceTestCase } from '../../../../harness/scripts/utils/device-test-case-kernel';
import { extractDerivedPlanCases, lintHylyrePlanMarkdown, parsePlannedStepsFromCell } from '../../../../harness/scripts/utils/derived-hylyre-plan';
import { applyPhaseEntryDeviceGate } from '../../../../harness/scripts/utils/device-readiness-gate';
import { loadAppBundleName, resolveExecutionDeviceIdentity } from '../hdc-runner';
import { computeHapSha256Full, installedHapDigest, probeInstalledHaps } from '../build-fingerprint';
import { resolveHylyreToolConfig } from '../../../../harness/config';
import { findSameInvocationFailure, decideReuse, startExecutionKeyRun, writeExecutionKeyRecord, freezeRunArtifacts, restoreFrozenRunArtifacts, sha256Text, computeExecutionKey, type ExecutionKeyInputs } from '../execution-key';
import { CheckExecutionError } from '../../../../harness/scripts/utils/check-execution';
import { resolveAppSnapshotCacheAbs } from '../app-snapshot-warmup';
import { loadHylyreOutputSchema } from '../../../../harness/scripts/utils/hylyre-contract-schema';
import { validateLiteSchema } from '../../../../harness/scripts/utils/lite-json-schema';
import { reduceCase } from '../../../../harness/scripts/utils/hylyre-crossrow-verifier';
import { spawnHylyre, resolveHylyreRuntimeWorkDir } from '../hylyre-spawn';
import { detectDesiredFidelity } from '../../../../harness/scripts/utils/fidelity-shared';
import { findFilesRecursive } from '../../../../harness/scripts/utils/find-files-recursive';
import { extractAcceptanceIdRefs } from '../../../../harness/scripts/utils/check-acceptance';
import { collectRequestDeviceAcceptance } from '../../../../harness/scripts/utils/acceptance-layering';
import type { AcceptanceSpec } from '../../../../harness/scripts/utils/types';
import { DEVICE_TEST_BUILD_RESULT, snapshotDeviceTestBuildInputs } from '../device-test-build-reuse';
import { resolveDeviceTestBuildMode, resolveDeviceTestProduct } from '../testing-build-conventions';
import { isBlockingCheck, isRequiredCheckGap } from '../../../../harness/scripts/utils/check-disposition';
import { realProjectPath } from '../../../../harness/scripts/utils/project-relative-path';
import type { RequestBuildArtifact } from '../../../../harness/scripts/utils/request-execution-inputs';
import { isHvigorBuildSuccessful } from '../hvigor-runner';

function reject(details: string, failure_kind?: string, logFile?: string): never {
  throw new CheckExecutionError({ id: 'request_device_native', category: 'structure', severity: 'BLOCKER', status: failure_kind ? 'SKIP' : 'FAIL', description: '专项设备测试未满足执行条件', details,
    ...(logFile ? { affected_files: [logFile] } : {}),
    ...(failure_kind ? { failure_kind, blocking_class: failure_kind === 'framework_bug' ? 'framework_internal' : 'externalBlocked' } : {}) });
}

function requestSourcePackage(ctx: RequestCheckContext, installed: ReturnType<typeof probeInstalledHaps>): RequestBuildArtifact | undefined {
  if (installed?.length !== 1 || !ctx.executionInputs || !ctx.request.origin_request) return undefined;
  const [hap] = installed;
  const relative = (file: string) => path.relative(ctx.projectRoot, file).replace(/\\/g, '/');
  const verifiedArtifact = (file: string): RequestBuildArtifact | undefined =>
    computeHapSha256Full(realProjectPath(ctx.projectRoot, file, 'request build HAP')) === hap.sha256
      ? { path: file, sha256: hap.sha256, module: hap.name } : undefined;
  try {
    const compile = JSON.parse(fs.readFileSync(path.join(path.dirname(ctx.request.origin_request), 'compile', 'compile-report.json'), 'utf8'));
    if (compile.request_file === relative(ctx.request.origin_request) && compile.execution?.executed && compile.execution.exitCode === 0
      && Array.isArray(compile.checks) && !compile.checks.some((check: CheckResult) => isBlockingCheck(check) || isRequiredCheckGap(check))
      && compile.execution_inputs?.sha256 === ctx.executionInputs.sha256
      && compile.execution_artifact?.module === hap.name && compile.execution_artifact.sha256 === hap.sha256) {
      const artifact = verifiedArtifact(compile.execution_artifact.path);
      if (artifact) return artifact;
    }
  } catch { /* The existing build provider may independently establish this same package. */ }
  try {
    const build = JSON.parse(fs.readFileSync(path.join(ctx.reportDir, DEVICE_TEST_BUILD_RESULT), 'utf8'));
    const product = resolveDeviceTestProduct(ctx.projectRoot), mode = resolveDeviceTestBuildMode();
    if ((build.reused === true || build.hvigor && isHvigorBuildSuccessful(build.hvigor))
      && build.resolvedProduct === product && build.resolvedBuildMode === mode && build.artifactValidation?.status === 'valid'
      && build.hapSha256Full === hap.sha256 && build.buildInputsSha256
      && build.buildInputsSha256 === snapshotDeviceTestBuildInputs(ctx.projectRoot, product, mode)?.sha256) {
      return verifiedArtifact(relative(path.resolve(ctx.projectRoot, build.hapPath)));
    }
  } catch { /* A device run without current source/package binding remains independently visible. */ }
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
  if (!rows.length || new Set(rows.map(row => row.tc_id)).size !== rows.length || rows.some(row => !row.expected.trim())) reject('request plan needs unique test cases with explicit expected results');
  const blueprint = ctx.request.blueprint;
  const acceptance = new Map(blueprint ? collectRequestDeviceAcceptance(casesInput.value as AcceptanceSpec, blueprint.acceptance_ids).map(item => [item.id.toUpperCase(), item]) : []);
  if (!blueprint) {
    const requested = casesInput.value as NormalizedDeviceTestCase[];
    if (rows.length !== requested.length || rows.some(row => !requested.some(item => item.id === row.tc_id))) reject('request plan must cover every requested case with an explicit expected result');
  }
  const plans = rows.map(row => {
    const refs = blueprint ? extractAcceptanceIdRefs(row.ac_ref) : [];
    const unknown = refs.filter(id => !acceptance.has(id));
    if (unknown.length) reject(`${row.tc_id} references AC outside this request's device scope: ${unknown.join(', ')}`);
    const parsed = parsePlannedStepsFromCell(row.steps_raw);
    if (!parsed.ok || !parsed.steps.length) reject(`invalid executable steps: ${row.tc_id}`);
    if (!parsed.steps.some(step => ['wait_for', 'wait_gone', 'assert_toast'].some(key => key in step || (step.action as { type?: string } | undefined)?.type === key))) reject(`request case needs a native assertion: ${row.tc_id}`);
    return { row, steps: parsed.steps, acceptance: refs.map(id => acceptance.get(id)!) };
  });
  const schema = loadHylyreOutputSchema(ctx.frameworkRoot);
  if (!schema.ok) reject(schema.detail, 'framework_bug');
  const bundleName = loadAppBundleName(ctx.projectRoot, details => reject(details));
  const inputs: ExecutionKeyInputs = { hap_sha256_full: null, derived_plan_sha256: sha256Text(JSON.stringify(plans.map(plan => ({ id: plan.row.tc_id, steps: plan.steps, expected: plan.row.expected, ...(blueprint ? { acceptance: plan.acceptance } : {}) })))),
    device: process.env.HARNESS_HDC_TARGET?.trim() || null, display_env: '', reset_mode: 'cold_restart', hylyre_version: null,
    manifest_version: null, profile: ctx.resolvedProfile.name, tool_config_sha256: sha256Text(JSON.stringify(resolveHylyreToolConfig(ctx.projectRoot))),
    flags: ['request_steps_file', 'cold_restart', 'skip_page_save', 'checked_vlm', 'bundle=' + bundleName,
      ...(ctx.executionInputs ? ['request_source=' + ctx.executionInputs.sha256] : [])] };
  const started = startExecutionKeyRun(ctx.reportDir, 'hylyre', inputs);
  const runDir = started.runDir; let record = started.record;
  const ready = ensureHylyreReady({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot, phase: 'testing', reportDir: runDir });
  if (!ready.ok) reject(ready.errors.map(error => error.message).join('; '), 'capability_missing');
  const identity = resolveExecutionDeviceIdentity();
  let installed = probeInstalledHaps(bundleName, identity.device);
  let installedHap = installedHapDigest(installed);
  Object.assign(inputs, { hap_sha256_full: installedHap, device: identity.device, display_env: identity.display_env, hylyre_version: ready.hylyreVersion, manifest_version: ready.manifestVersion,
    tool_config_sha256: sha256Text(JSON.stringify({ config: resolveHylyreToolConfig(ctx.projectRoot), python: ready.pythonPath, timeout: process.env.HARNESS_HYLYRE_RUN_TIMEOUT_MS ?? null })) });
  record = { ...record, inputs, execution_key: computeExecutionKey(inputs), ...(ctx.goalInvocation ? { goal_invocation: ctx.goalInvocation } : {}) }; writeExecutionKeyRecord(runDir, record);
  const caseArtifacts = plans.map((_, index) => ['device-test-run.log', 'device-test-run.meta.json', 'native-trace.json', 'native-report.md', 'request-steps.json', 'expected-check.log', 'expected-check.response.json']
    .map(name => ({ top: 'case-' + (index + 1) + '/' + name, frozen: 'frozen.case-' + (index + 1) + '.' + name, group: 'execution' as const })));
  const artifacts = caseArtifacts.flat();
  const failedInvocation = ctx.goalInvocation && identity.device && installedHap
    ? findSameInvocationFailure(ctx.reportDir, record.execution_key, ctx.goalInvocation, { excludeRunDir: runDir,
      artifacts: artifacts.filter(file => !file.top.includes('expected-check')),
      usable: view => {
        for (const [index] of plans.entries()) {
          const file = path.join(view.runDir, 'frozen.case-' + (index + 1) + '.device-test-run.meta.json');
          const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (meta.device_setup || meta.run_failure_kind === 'device_locked') {
            const snapshot = require('../device-recovery-bridge').observeDeviceSnapshot(identity.device);
            if (meta.device_setup && !snapshot?.systemSetup || meta.run_failure_kind === 'device_locked' && snapshot?.locked !== true) return false;
          }
        }
        return true;
      } }) : null;
  const mayReuse = !effectiveForceDevice(ctx.forceDevice, ctx) && identity.device && installedHap;
  let reuseByCase = caseArtifacts.map(artifacts => failedInvocation ?? (mayReuse
    ? decideReuse(ctx.reportDir, record.execution_key, { artifacts, excludeRunDir: runDir, invocation: ctx.goalInvocation }).reusable : null));
  if (reuseByCase.some(reuse => !reuse)) {
    const gate = await applyPhaseEntryDeviceGate({ projectRoot: ctx.projectRoot, phase: 'testing', startedBy: 'request-' + ctx.request.request_sha256, log: message => console.error(message) });
    if (!gate.ok) reject(gate.reason ?? 'device not ready', 'device_blocked');
    const selected = resolveExecutionDeviceIdentity();
    installed = probeInstalledHaps(bundleName, selected.device);
    installedHap = installedHapDigest(installed);
    Object.assign(inputs, { hap_sha256_full: installedHap, device: selected.device, display_env: selected.display_env });
    const executionKey = computeExecutionKey(inputs);
    if (executionKey !== record.execution_key) reuseByCase = reuseByCase.map(() => null);
    record = { ...record, inputs, execution_key: executionKey };
    writeExecutionKeyRecord(runDir, record);
  }
  for (const [index] of plans.entries()) fs.mkdirSync(path.join(runDir, 'case-' + (index + 1)), { recursive: true });
  const checks: CheckResult[] = []; const evidence_paths: string[] = [];
  const readStep = (value: unknown): StepResultV1 => {
    const issues = validateLiteSchema(value, { $ref: '#/$defs/stepResultV1', $defs: (schema.schema as { $defs?: unknown }).$defs });
    if (issues.length) reject('invalid native request StepResult: ' + JSON.stringify(issues), 'framework_bug');
    return value as StepResultV1;
  };
  for (const [caseIndex, plan] of plans.entries()) {
    const reuse = reuseByCase[caseIndex];
    if (reuse) restoreFrozenRunArtifacts(reuse.runDir, runDir, caseArtifacts[caseIndex]);
    const reportDir = path.join(runDir, 'case-' + (caseIndex + 1)); fs.mkdirSync(reportDir, { recursive: true });
    const stepsFilePath = path.join(reportDir, 'request-steps.json'); fs.writeFileSync(stepsFilePath, JSON.stringify(plan.steps));
    const run = reuse ? { executed: true, exitCode: JSON.parse(fs.readFileSync(path.join(reportDir, 'device-test-run.meta.json'), 'utf8')).exit_code as number, logPath: path.join(reportDir, 'device-test-run.log') } : runHylyreDeviceTest({ projectRoot: ctx.projectRoot, frameworkRoot: ctx.frameworkRoot, harnessRoot: ctx.harnessRoot, phase: 'testing', reportDir, pythonPath: ready.pythonPath,
      derivedPlanPath: ctx.request.inputs.test_plan, stepsFilePath, reportOutPath: path.join(reportDir, 'native-report.md'), traceOutPath: path.join(reportDir, 'native-trace.json'),
      bundleName, deviceSn: process.env.HARNESS_HDC_TARGET, coldRestart: true, skipPageSave: true, appSnapshotCacheAbs: resolveAppSnapshotCacheAbs(ctx.projectRoot) });
    const logFile = path.relative(ctx.projectRoot, run.logPath).replace(/\\/g, '/');
    if (!run.executed) reject(`${plan.row.tc_id}: native request did not execute; inspect ${logFile}`, 'capability_missing', logFile);
    const parsed = parseStepsRunOut(fs.readFileSync(run.logPath, 'utf8'), { native: true });
    if (parsed && 'rejection' in parsed) {
      reject(`${plan.row.tc_id}: native request rejected before execution (${parsed.rejection.code}): ${parsed.rejection.summary}; inspect ${logFile}`, undefined, logFile);
    }
    const batch = parsed?.batch;
    if (!batch || batch.result_protocol !== NATIVE_RESULT_PROTOCOL || typeof batch.executed !== 'number'
      || !Number.isInteger(batch.executed) || batch.executed < 1 || batch.executed > plan.steps.length
      || batch.total !== plan.steps.length || batch.results.length !== plan.steps.length) {
      if (run.exitCode === 0) reject(`${plan.row.tc_id}: native request exited successfully without a readable, complete v1 batch; inspect ${logFile}`, 'framework_bug', logFile);
      reject(`${plan.row.tc_id}: native request batch incomplete or failed (exit=${run.exitCode}); inspect ${logFile}`, 'capability_missing', logFile);
    }
    const actual = batch.results.map((row, index) => {
      const step = readStep(row.step_result);
      if (step.index !== index || row.index !== index) reject('invalid native request step index', 'framework_bug');
      return step;
    });
    const caseEvidence = [run.logPath];
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
      caseEvidence.push(logPath, responsePath);
    }
    const reduced = reduceCase({ id: plan.row.tc_id, steps: actual, expected_check_mode: 'checked_vlm' } as CaseResultV1);
    const ok = batch.executed === plan.steps.length && run.exitCode === 0 && expectedOk && actual.every(step => step.device_session === true && step.outcome.status === 'passed') && reduced.execution === 'completed' && reduced.verification === 'passed' && reduced.evidence === 'complete';
    const domains = actual.flatMap(step => step.outcome.status === 'failed' ? [step.outcome.failure.domain] : step.outcome.status === 'blocked' ? [step.outcome.cause.type] : []);
    const failure_kind = domains.includes('internal') ? 'framework_bug' : domains.includes('capability') ? 'capability_missing' : domains.includes('infrastructure') ? 'device_blocked' : undefined;
    evidence_paths.push(...caseEvidence);
    checks.push({ id: 'request_device_native', category: 'structure', severity: 'BLOCKER', status: ok ? 'PASS' : failure_kind ? 'SKIP' : 'FAIL', ...(failure_kind ? { failure_kind, blocking_class: failure_kind === 'framework_bug' ? 'framework_internal' : 'externalBlocked' } : {}), description: '专项设备用例原生断言与明确预期', details: plan.row.tc_id + (reuse ? ' (reused_by_execution_key)' : installedHap ? '' : ' (installed HAP unreadable; no reuse)') + ': ' + JSON.stringify(reduced),
      ...(blueprint ? { structured: { request_device_case: { tc_id: plan.row.tc_id, acceptance_ids: plan.acceptance.map(item => item.id), expected: plan.row.expected } },
        affected_files: caseEvidence.map(file => path.relative(ctx.projectRoot, file).replace(/\\/g, '/')) } : {}),
      ...(ok ? {} : { suggestion: '核对原生步骤和明确预期的验证证据；manual、skipped、预期未验证均不能通过。' }) });
  }
  if (failedInvocation) fs.unlinkSync(path.join(runDir, 'execution-key.json'));
  const frozen = freezeRunArtifacts(runDir, runDir, artifacts);
  if (!failedInvocation) writeExecutionKeyRecord(runDir, { ...record, outcome: checks.every(check => check.status === 'PASS') ? 'success' : 'failed', timing_complete: frozen.length === artifacts.length, frozen_files: frozen });
  for (const item of artifacts) if (fs.existsSync(path.join(runDir, item.top))) evidence_paths.push(path.join(runDir, item.top));
  const total = checks.length, failed = checks.filter(check => check.status !== 'PASS').length;
  if (ctx.request.origin_request && ctx.request.blueprint) {
    const currentInstalled = installedHapDigest(probeInstalledHaps(bundleName, record.inputs.device));
    const evidence = installedHap && currentInstalled === installedHap ? requestSourcePackage(ctx, installed) : undefined;
    if (evidence) ctx.executionArtifacts = [evidence];
    else {
      const { requestFailure } = require('../../../../harness/scripts/utils/request-phase') as typeof import('../../../../harness/scripts/utils/request-phase');
      checks.push({ ...requestFailure('request_input_unresolved', '已保留实际装机包的设备执行结果，当前源码对应的构建包尚未核实'),
        status: 'SKIP', failure_kind: 'verification_evidence_gap', blocking_class: 'externalBlocked' });
    }
  }
  return { executed: true, total, failed, checks, evidence_paths: [...new Set([...evidence_paths, ...findFilesRecursive(runDir, /^(?!frozen\.)/)])] };
}
