import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { setTimeout as delay } from 'timers/promises';
import { featureFilePath, loadFrameworkConfig, relFeaturesDir } from '../../config';
import { loadResolvedProfile } from '../../profile-loader';
import { isPhaseGlobalInWorkflow, resolveWorkflowSpec, workflowPhaseIdSet } from '../../workflow-loader';
import { adapterModelBinding, assertModelReplay, launchStageVerifierModelPin, parseAdapterModelBinding } from './adapter-model';
import { agentEventsLogPath, assertAdapterHeadlessFullPermission, invokeAgentHeadless, resolveHeadlessInvokePlan } from './agent-invoke';
import { resolveFeaturePhaseCapabilityInput } from './capability-resolution-entry-input';
import { resolveCapabilityInputs } from './capability-resolution';
import { phaseCompletionProblems, renderCurrentDisposition, resolveCurrentDisposition } from './check-disposition';
import { defaultProcessProbe } from './device-session';
import { detectLiveFeatureLock } from './feature-execution-scope';
import { loadFeatureTrackDecl } from './feature-track';
import { loadGoalCapability } from './goal-adapter-capability';
import { awaitGuardianGone, reconcileGuardianOwnership, terminateGuardianProcessOnly } from './goal-containment-reconcile';
import { effectiveHeadlessUnattended } from './goal-manifest';
import { readRunControl } from './goal-run-control';
import { FEATURE_LOCK_NAME, isPidAlive, readLockRecord, releaseLock, tryAcquireLock } from './goal-run-lock';
import type { GoalRunEvent } from './goal-runner-phase';
import { invocationCompleted, invocationEndFacts } from './invocation-completion';
import { loadPhaseEvidenceManifest } from './phase-evidence-manifest';
import { preparePhaseRepairFeedback } from './phase-closure-finalizer';
import { runSyncClosureDetailed } from './phase-state';
import { capturePhaseInvocationSnapshot, classifyPhaseInvocationChanges, phaseWriteWindows,
  readPhaseRecoveryFile, resolvePhaseWriteBoundary, type PhaseInvocationSnapshot } from './phase-write-boundary';
import { resolveFeatureTrack } from './runtime-policy';
import { readExecutionRequestOriginal, nativeExecutionCompleted, phaseBindingStarted, readPhaseBinding,
  sessionEvents, sessionRunMaterialPath, writePhaseExecutionRequestMaterial, type IssuedSessionExecution, type SessionExecutionRequest } from './session-execution-handoff';
import { phaseBindingCapture, protectStageVerifierInputs, readSignedStageVerifier, renderStageVerifierRepairInstruction,
  resolveStageVerifierItemFocus, restoreStageVerifierReport, launchStandaloneVerifierWorker, stageVerifierDraftPath, standaloneVerifierRunDir,
  type StageVerifierLocation } from './stage-verifier-execution';
import type { HarnessRunSummary, ScriptReport } from './types';
import { loadCurrentVerifierEvidenceForSubject, loadVerifierEvidence, verifierDiagnosisRequired, verifierReportItemGaps } from './verifier-evidence';
import { parseVerifierRequestFromInstruction } from './verifier-request';
import { hasChangedVerifierMaterialInputs, readCurrentDispositionInput } from './verify-feature-completion';

interface StandaloneInput extends StageVerifierLocation {
  entry: string;
  argv: Record<string, unknown>;
  rawArgs: readonly string[];
}

type StageEvent = GoalRunEvent & { detail?: string; pid?: number; write_evidence_rejected?: string; closure_status?: string; model_source?: string };
type Signed = NonNullable<ReturnType<typeof readSignedStageVerifier>>;

const purpose = 'verifier_format_repair';
const subjectOnDisk = (input: StageVerifierLocation, signed: Signed) =>
  readSignedStageVerifier(input)?.request.subject_id === signed.request.subject_id;

function summaryFor(signed: Signed): HarnessRunSummary {
  return JSON.parse(fs.readFileSync(path.join(signed.reportsDir, 'summary.json'), 'utf8')) as HarnessRunSummary;
}

function goalOwner(input: StageVerifierLocation, signed: Signed): string | undefined {
  const runsDir = featureFilePath(input.projectRoot, input.feature, 'goal-runs');
  const runId = summaryFor(signed).run_id;
  if (runId && /^[a-zA-Z0-9-]+$/.test(runId)) {
    const control = readRunControl(path.join(runsDir, runId), runId);
    if (control?.owner && ['active', 'quiescing'].includes(control.owner.state)) return runId;
  }
  const live = detectLiveFeatureLock(input.projectRoot, input.feature);
  if (!live || live.record?.report_dir?.includes('/verifier-execution/')) return undefined;
  return live.record?.run_id ?? live.lockPath;
}

function originalCodebaseSourceRefs(input: StandaloneInput, signed: Signed): readonly string[] | undefined {
  const manifest = loadPhaseEvidenceManifest(input.projectRoot, input.feature, input.phase);
  if (!manifest?.integrityOk) return;
  const scriptPath = path.join(signed.reportsDir, 'script-report.json');
  const scriptOutput = manifest.manifest.outputs.find(output => path.resolve(input.projectRoot, output.path) === scriptPath);
  if (!scriptOutput?.exists) return;
  const raw = fs.readFileSync(scriptPath);
  if (createHash('sha256').update(raw).digest('hex') !== scriptOutput.sha256) return;
  const original = JSON.parse(raw.toString('utf8')) as ScriptReport;
  if (original.feature !== input.feature || original.phase !== input.phase) return;
  const codebase = original.capability_resolutions?.flatMap(capability => capability.inputs).find(candidate => candidate.id === 'codebase');
  if (codebase?.state === 'absent' && codebase.attempts.some(attempt => attempt.source === 'derive.codebase')) return [];
  if (codebase?.state === 'resolved' && codebase.binding?.source.kind === 'derive'
    && codebase.binding.source.provider_id === 'derive.codebase') return codebase.binding.source_refs;
}

function readCurrentStage(input: StandaloneInput, signed: Signed) {
  const summary = summaryFor(signed);
  const config = loadFrameworkConfig(input.projectRoot);
  const track = resolveFeatureTrack(loadFeatureTrackDecl(input.projectRoot, input.feature));
  const workflow = resolveWorkflowSpec(input.projectRoot, { frameworkRoot: input.frameworkRoot, config });
  const explicitRequirement = input.argv.requirement !== undefined || input.argv['requirement-file'] !== undefined
    ? { requirement: input.argv.requirement, requirementFile: input.argv['requirement-file'] } : undefined;
  const entry = resolveFeaturePhaseCapabilityInput({ ...input, featuresDir: relFeaturesDir(input.projectRoot), purpose: 'bound-verifier',
    boundCodebaseSourceRefs: input.phase === 'spec' ? originalCodebaseSourceRefs(input, signed) : undefined,
    explicitAdhocCases: typeof input.argv['adhoc-cases'] === 'string' ? input.argv['adhoc-cases'] : undefined }, workflow, explicitRequirement);
  const resolvedInputs = resolveCapabilityInputs({ ...input, track, ...entry }).inputs;
  if (!subjectOnDisk(input, signed) || hasChangedVerifierMaterialInputs({ ...input, summary,
    factsContext: entry.factsContext, resolvedInputs })) {
    throw new Error('本阶段的已签材料已变化；请重跑原阶段检查与签发。');
  }
  const disposition = resolveCurrentDisposition(readCurrentDispositionInput({ ...input, chain: [input.phase], resolvedInputs }));
  const problems = phaseCompletionProblems(disposition, [input.phase]);
  const qualification = { ...input, currentSubject: signed.request.subject_id, resolvedInputs,
    diagnosisRequired: verifierDiagnosisRequired(input.phase, summary),
    findings: problems.filter(problem => (problem.source_phase ?? problem.phase) === input.phase
      && problem.action === 'verify' && problem.id.startsWith('open_finding:'))
      .map(problem => ({ id: problem.id.slice('open_finding:'.length), files: problem.files })) };
  const pending = problems.find(problem => problem.phase === input.phase && problem.id === 'attestation_present'
    && problem.action === 'verify' && problem.files?.some(file => path.resolve(input.projectRoot, file) === signed.reportPath));
  return { summary, config, track, entry, resolvedInputs, disposition, qualification, pending };
}

function logEvent(runDir: string, event: Record<string, unknown>): void {
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
}

function stageEvents(runDir: string): StageEvent[] {
  return sessionEvents(runDir);
}

function latestStart(events: StageEvent[]): StageEvent | undefined {
  return [...events].reverse().find(event => event.type === 'agent_invoke_start');
}

function reportState(input: StandaloneInput, signed: Signed, stage: ReturnType<typeof readCurrentStage>) {
  if (stage.pending) return null;
  const loaded = loadCurrentVerifierEvidenceForSubject(input.projectRoot, input.feature, input.phase, signed.request.subject_id,
    { frameworkRoot: input.frameworkRoot, resolvedInputs: stage.resolvedInputs });
  return loaded.ok && verifierReportItemGaps(stage.qualification, loaded.evidence).length === 0 ? loaded.evidence : null;
}

function consumeStage(input: StandaloneInput, signed: Signed, runDir: string, invokeId?: string) {
  const stage = readCurrentStage(input, signed);
  const evidence = reportState(input, signed, stage);
  if (!evidence) return false;
  const { exitCode, finalizationError } = runSyncClosureDetailed(path.join(input.frameworkRoot, 'harness'), input.projectRoot, input.feature, input.phase,
    input.frameworkRoot, { resolvedInputs: stage.resolvedInputs, factsContext: stage.entry.factsContext });
  if (finalizationError) throw new Error(finalizationError);
  const summary = summaryFor(signed);
  const feedback = preparePhaseRepairFeedback({ ...input, resolvedInputs: stage.resolvedInputs });
  const disposition = feedback?.disposition ?? stage.disposition;
  logEvent(runDir, { type: 'phase_verdict', phase: input.phase, verdict: summary.verdict,
    invoke_id: invokeId, closure_status: summary.closure_status, exit_code: exitCode,
    detail: '独立核验 ' + evidence.verdict + '，报告 ' + evidence.md_path_rel
      + '\n本阶段检查 ' + summary.verdict + '，' + (summary.closure_status === 'closed' ? '已闭环' : '保持未闭环')
      + '。\n' + renderCurrentDisposition(disposition) });
  return true;
}

/** Derive acceptance from the same pre/bind/return snapshots and raw terminal facts as the Goal handoff. */
function commitStageHandback(runDir: string, issued: Pick<IssuedSessionExecution, 'request' | 'reference'>,
  terminal: Record<string, unknown>, post: PhaseInvocationSnapshot): void {
  const { request, reference } = issued;
  const { invoke_id: invokeId, context, write_boundary: boundary, pre_snapshot: pre } = request;
  if (!boundary || !pre) throw new Error('独立核验执行原件缺少写入观察。');
  const events = stageEvents(runDir);
  const binding = readPhaseBinding(runDir, issued, events);
  const windows = phaseWriteWindows(pre, binding, post);
  const writes = windows.kind === 'checked' ? classifyPhaseInvocationChanges(boundary, context.phase, windows.returned, { events, invokeId }) : undefined;
  const violations = windows.kind === 'checked' ? [
    ...windows.beforeBinding.map(write => ({ ...write, violation: 'signed_input_drift' })), ...writes?.violations ?? [],
  ] : [];
  const rejection = windows.kind === 'unverifiable' ? windows.reason : violations.length
    ? '已拒收越界交回，涉及 ' + [...new Set(violations.map(write => write.path))].join('、')
    : !binding && invocationCompleted(terminal) ? '缺少可核实的原生绑定快照' : undefined;
  if (violations.length) logEvent(runDir, { type: 'phase_write_violation', phase: context.phase, invoke_id: invokeId,
    pre_snapshot: pre.sha256, post_snapshot: post.sha256, violations });
  if (!rejection && invocationCompleted(terminal) && boundary.verifierResultPath) {
    const target = path.resolve(context.projectRoot, boundary.verifierResultPath);
    const draft = readPhaseRecoveryFile(context.projectRoot, target);
    const observed = post.entries.find(entry => entry.kind === 'file' && path.resolve(context.projectRoot, entry.path) === target);
    if (draft.bytes && observed && createHash('sha256').update(draft.bytes).digest('hex') === observed.sha256) {
      const arch = path.join(runDir, path.dirname(reference.path), 'independent-' + path.basename(target));
      if (!fs.existsSync(arch)) fs.writeFileSync(arch, draft.bytes, { flag: 'wx' });
      logEvent(runDir, { type: 'phase_write_observed', phase: context.phase, invoke_id: invokeId,
        pre_snapshot: pre.sha256, post_snapshot: post.sha256,
        owned: (writes?.allowed ?? []).map(write => ({ path: write.path, post_sha256: write.postSha256 })) });
    }
  }
  logEvent(runDir, { ...terminal, type: 'agent_invoke_end', phase: context.phase, invoke_id: invokeId, purpose,
    ...(rejection ? { status: 'failed', exit_code: 1, write_evidence_rejected: rejection, detail: rejection } : {}) });
}

function reconcileStageInvocation(runDir: string, issued: IssuedSessionExecution, events: StageEvent[]): boolean {
  const { request } = issued;
  const own = events.filter(event => event.invoke_id === request.invoke_id);
  if (own.some(event => event.type === 'agent_invoke_end')) return true;
  const bound = own.find(event => event.type === 'agent_process_bound');
  const settled = [...own].reverse().find(event => event.type === 'agent_process_settled');
  const cancelled = own.some(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting');
  const expired = request.deadline ? Date.parse(request.deadline) <= Date.now() : false;
  if (!settled) {
    if (!bound && phaseBindingStarted(runDir, issued)) return false;
    if (bound?.pid && isPidAlive(bound.pid)) {
      if (process.platform !== 'win32') return false;
      const observed = reconcileGuardianOwnership(own, defaultProcessProbe());
      if (observed.kind !== 'outcomes' || observed.items.some(item => item.kind === 'guardian_identity_unverifiable' && !item.identity_mismatch)) {
        throw new Error('原核验的进程身份不可核实，保留原调用与日志。');
      }
      const live = observed.items.find(item => item.kind === 'guardian_alive_matching');
      if (live && (!(cancelled || expired) || !terminateGuardianProcessOnly(live.bound.pid) || !awaitGuardianGone(live.bound.pid))) {
        return false;
      }
    }
  }
  if (!request.write_boundary) throw new Error('原核验缺少写入观察。');
  const cancelledBeforeSettlement = cancelled && own.findIndex(event => event.type === 'phase_halt' && event.halt_reason === 'executor_waiting')
    < (settled ? own.indexOf(settled) : Infinity);
  const completed = !cancelledBeforeSettlement && (settled || !expired) && nativeExecutionCompleted(runDir, issued, events);
  const post = capturePhaseInvocationSnapshot(request.write_boundary, request.snapshot_options);
  commitStageHandback(runDir, issued, { ...settled, exitCode: settled?.exit_code ?? (completed ? 0 : 1),
    ...(completed ? { completion_observed: true } : { interrupted: true, timed_out: expired }), exit_code: settled?.exit_code ?? (completed ? 0 : 1) }, post);
  return true;
}

/** A crash between persisting the original and recording it never reached native spawn. */
function recoverPreparedOriginal(runDir: string, signed: Signed, invokeId: string, draft: string): boolean {
  const file = sessionRunMaterialPath(runDir, path.join(path.dirname(draft), 'request-e1.json'));
  if (!fs.existsSync(file)) return false;
  const bytes = fs.readFileSync(file);
  const original = JSON.parse(bytes.toString('utf8')) as SessionExecutionRequest;
  const { request } = signed;
  if (original.invoke_id !== invokeId || original.context.runDir !== runDir || original.context.runId !== request.subject_id
    || original.context.feature !== request.feature || original.purpose !== purpose
    || parseVerifierRequestFromInstruction(original.context.instruction)?.subject_id !== request.subject_id
    || !original.write_boundary?.verifierResultPath
    || path.resolve(original.context.projectRoot, original.write_boundary.verifierResultPath) !== draft) {
    throw new Error('准备中的核验原件与当前已签对象不一致。');
  }
  logEvent(runDir, { type: 'agent_invoke_start', ts: original.issued_at, phase: original.context.phase, invoke_id: invokeId, purpose,
    attempt_id: original.context.attemptId, owner_id: original.context.owner.owner_id, owner_epoch: original.context.owner.epoch,
    handoff_request: { path: path.relative(runDir, file).replace(/\\/g, '/'), sha256: createHash('sha256').update(bytes).digest('hex') },
    detail: '原调用在提交模型前中断，已恢复其冻结执行原件。' });
  return true;
}

async function executeUnderLock(input: StandaloneInput, signed: Signed, runDir: string, lockPath: string,
  ownerId: string, expected: string): Promise<void> {
  const assertOwner = () => {
    if (readLockRecord(lockPath)?.ownerId !== ownerId) throw new Error('原核验执行权已变化，请从同一请求重新续等。');
  };
  assertOwner();
  if (goalOwner(input, signed) || !subjectOnDisk(input, signed)) return;
  let history = stageEvents(runDir);
  const last = latestStart(history);
  if ((last?.invoke_id ?? '') !== expected) return;
  const prior = last?.invoke_id ? readExecutionRequestOriginal(runDir, last.invoke_id, history) : null;
  if (last && !prior) throw new Error('缺少已签核验的调用原件，保留欠交义务。');
  if (prior) {
    while (!reconcileStageInvocation(runDir, prior, history)) {
      const bound = history.find(event => event.type === 'agent_process_bound' && event.invoke_id === prior.request.invoke_id);
      if (!bound?.pid) throw new Error('原核验已进入绑定窗口，实际原生绑定尚不可核实。保留原调用与日志。');
      await delay(500);
      history = stageEvents(runDir);
    }
  }
  let stage = readCurrentStage(input, signed);
  if (restoreStageVerifierReport(runDir, signed.request, signed.reportPath, signed.reportRel, stage.qualification, { retainIncomplete: true })) {
    stage = readCurrentStage(input, signed);
  }
  if (consumeStage(input, signed, runDir, last?.invoke_id)) return;
  if (!stage.pending) throw new Error('当前统一处置没有可派发的独立核验。\n' + renderCurrentDisposition(stage.disposition));
  history = stageEvents(runDir);
  const attempt = 'i' + (history.filter(event => event.type === 'agent_invoke_start').length + 1);
  const label = input.phase + '-verifier-format-repair';
  const invokeId = label + '-' + attempt;
  const draft = stageVerifierDraftPath(runDir, input.phase, invokeId);
  assertOwner();
  if (recoverPreparedOriginal(runDir, signed, invokeId, draft)) {
    return executeUnderLock(input, signed, runDir, lockPath, ownerId, invokeId);
  }

  const adapter = prior?.request.context.adapter ?? stage.config.agent_adapter ?? 'generic';
  const permission = assertAdapterHeadlessFullPermission(adapter);
  if (!permission.ok) throw new Error(permission.reason);
  const loaded = loadGoalCapability(input.frameworkRoot, adapter);
  if (!loaded.valid || !loaded.capability) throw new Error('当前适配器无法运行独立核验：' + loaded.issues.join('；'));
  const originalDeadline = prior?.request.context.user_deadline_at;
  const requestedDeadline = typeof input.argv['user-deadline-at'] === 'string' ? input.argv['user-deadline-at'] : undefined;
  const continuationTarget = input.argv['resume-verifier'];
  const resumeAuthorized = prior !== null && continuationTarget === prior.request.invoke_id;
  const priorCancelled = prior && history.some(event => event.type === 'phase_halt' && event.invoke_id === prior.request.invoke_id
    && event.halt_reason === 'executor_waiting');
  const expired = originalDeadline && Date.parse(originalDeadline) <= Date.now();
  if (priorCancelled && !resumeAuthorized) {
    throw new Error('原核验已按用户指令取消。用户明确恢复时，在同一命令加 --resume-verifier ' + last?.invoke_id + '。');
  }
  if (expired && (!resumeAuthorized || !requestedDeadline)) {
    throw new Error('核验原任务截止已到。用户明确授权新截止后，使用 --resume-verifier ' + last?.invoke_id
      + ' --user-deadline-at <UTC timestamp>。');
  }
  const deadline = prior && !expired ? originalDeadline : requestedDeadline;
  if (deadline && (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now())) throw new Error('明确授权的核验截止无效或已到。');
  const pin = prior ? parseAdapterModelBinding(adapter, prior.request.context.adapterModel)
    : launchStageVerifierModelPin(input.argv, adapter, input.projectRoot);
  assertModelReplay(pin, input.projectRoot, process.env, deadline ? Date.parse(deadline) : Infinity);
  const model = adapterModelBinding(pin);

  const dir = path.dirname(draft);
  const workflow = resolveWorkflowSpec(input.projectRoot, { frameworkRoot: input.frameworkRoot });
  const profile = loadResolvedProfile(input.projectRoot, stage.config, input.frameworkRoot);
  const evidence = loadVerifierEvidence(input.projectRoot, input.feature, input.phase, { frameworkRoot: input.frameworkRoot });
  const itemFocus = resolveStageVerifierItemFocus(stage.qualification, signed, workflow, profile, evidence);
  const instruction = renderStageVerifierRepairInstruction({ requestText: signed.requestText, diagnosis: stage.pending.detail,
    reportRel: path.relative(input.projectRoot, draft).replace(/\\/g, '/'), itemFocus,
    formatFeedback: prior ? '沿当前签发材料补齐未交回的原件，保留有效依据。' : '' });
  const authority = effectiveHeadlessUnattended();
  const context = { runId: signed.request.subject_id, feature: input.feature, workflowId: workflow.name, track: stage.track,
    chain: [input.phase], phase: label, attemptId: attempt, owner: { run_id: signed.request.subject_id, owner_id: ownerId, epoch: 1, kind: 'process' as const },
    projectRoot: input.projectRoot, frameworkRoot: input.frameworkRoot, runDir, reportDir: path.relative(input.projectRoot, runDir).replace(/\\/g, '/'),
    adapter, adapterModel: model, user_deadline_at: deadline, authority, instruction, executionRole: 'verifier' as const,
    runtimeFacts: { receiptRequired: false, resume: !!prior, successor: false }, childEnv: {} };
  const boundary = resolvePhaseWriteBoundary({ ...input, executionRole: 'verifier', verifierResultPath: draft,
    phaseOrder: [input.phase], track: stage.track, profileDir: profile.profileDir,
    productLayerDirs: (stage.config.architecture?.outer_layers ?? []).map(layer => layer.id) });
  protectStageVerifierInputs(boundary, signed, draft);
  const options = { runtimeExcluded: [runDir] };
  const pre = capturePhaseInvocationSnapshot(boundary, options);
  if (pre.failureReason) throw new Error(pre.failureReason);
  fs.mkdirSync(dir, { recursive: true });
  const promptFile = path.join(dir, 'prompt.md');
  fs.writeFileSync(promptFile, instruction, 'utf8');
  const plan = resolveHeadlessInvokePlan(adapter, loaded.capability, authority, instruction, {
    PROMPT: instruction, PROMPT_FILE: promptFile, PROJECT_ROOT: input.projectRoot, FRAMEWORK_ROOT: input.frameworkRoot,
    FEATURE: input.feature, PHASE: label, SKILL_PATH: path.join(input.frameworkRoot, 'skills', 'feature', input.phase, 'SKILL.md'),
  }, model);
  const issuedAt = new Date().toISOString();
  const issued = writePhaseExecutionRequestMaterial({ context, invokeId, issuedAt, purpose, chainPhase: input.phase,
    gateTimeoutMs: 0, cleanupReserveMs: 0, preSnapshot: pre, writeBoundary: boundary, snapshotOptions: options });
  assertOwner();
  logEvent(runDir, { type: 'agent_invoke_start', ts: issuedAt, phase: label, invoke_id: invokeId, command: plan.label, purpose,
    handoff_request: issued.reference, attempt_id: attempt, owner_id: ownerId, owner_epoch: 1,
    model_source: prior ? last?.model_source : pin.source ?? 'parameters' });
  const capture = phaseBindingCapture(context, issued);
  const controller = new AbortController();
  const poll = setInterval(() => {
    if (stageEvents(runDir).some(event => event.type === 'phase_halt' && event.invoke_id === invokeId
      && event.halt_reason === 'executor_waiting')) controller.abort();
  }, 250);
  const outputLogPath = path.join(dir, 'agent-output.log');
  let result;
  let stoppedBeforeBinding: { detail: string; settled: boolean } | undefined;
  try {
    result = await invokeAgentHeadless(plan, input.projectRoot, { authorization: authority, executionRole: 'verifier',
      outputLogPath, toolEventCapture: loaded.capability.tool_event_provenance, usageCapture: loaded.capability.usage_capture,
      userDeadlineAt: deadline, signal: controller.signal, containment: { runId: signed.request.subject_id, invokeId },
      beforeSpawn: () => {
        try {
          assertOwner();
          if (!subjectOnDisk(input, signed)) throw new Error('原签发对象已变化，保留当前核验义务。');
          capture.beforeSpawn();
        } catch (error) {
          stoppedBeforeBinding = { detail: (error as Error).message, settled: false };
          throw error;
        }
      },
      onActiveChild: ({ pid }) => {
        const token = signed.request.subject_id + '/' + invokeId;
        const binding = process.platform === 'win32'
          ? (require('../goal-phase-runtime') as typeof import('../goal-phase-runtime')).bindGuardianOrKill(pid, token) : undefined;
        if (binding && !binding.ok) {
          if (!binding.stillAlive) stoppedBeforeBinding = { detail: binding.error, settled: true };
          throw new Error(binding.error);
        }
        logEvent(runDir, { type: 'agent_process_bound', phase: label, run_id: signed.request.subject_id, invoke_id: invokeId,
          pid, token, ...(binding?.ok ? { started_at_ms: binding.identity.startedAtMs, executable: binding.identity.executable } : {}),
          ...capture.fields() });
      },
    });
  } catch (error) {
    if (stoppedBeforeBinding) {
      const failure = { phase: label, run_id: signed.request.subject_id, invoke_id: invokeId, interrupted: true,
        exit_code: 1, detail: stoppedBeforeBinding.detail };
      if (stoppedBeforeBinding.settled) logEvent(runDir, { ...failure, type: 'agent_process_settled' });
      logEvent(runDir, { ...failure, type: 'agent_invoke_end', purpose });
    }
    throw error;
  } finally {
    clearInterval(poll);
  }
  const cancelledBeforeReturn = stageEvents(runDir).some(event => event.type === 'phase_halt' && event.invoke_id === invokeId
    && event.halt_reason === 'executor_waiting');
  const terminal = { ...invocationEndFacts(result), ...(cancelledBeforeReturn ? { interrupted: true } : {}), exitCode: result.exitCode, command: result.command,
    duration_ms: Date.now() - Date.parse(issuedAt),
    detail: result.spawn_error?.message ?? result.nativeSessionRebuildReason ?? result.terminal_error_excerpt
      ?? (result.stderr.trim().split(/\r?\n/, 1)[0] || undefined) };
  logEvent(runDir, { ...terminal, type: 'agent_process_settled', phase: label, run_id: signed.request.subject_id, invoke_id: invokeId });
  const post = capturePhaseInvocationSnapshot(boundary, options);
  commitStageHandback(runDir, issued, terminal, post);
  assertOwner();
  stage = readCurrentStage(input, signed);
  restoreStageVerifierReport(runDir, signed.request, signed.reportPath, signed.reportRel, stage.qualification, { retainIncomplete: true });
  if (!consumeStage(input, signed, runDir, invokeId)) {
    const ended = stageEvents(runDir).reverse().find(event => event.type === 'agent_invoke_end' && event.invoke_id === invokeId);
    const current = readCurrentStage(input, signed);
    throw new Error((ended?.detail ?? '已结束的独立核验尚未交回满足原请求的可用报告。')
      + ' 原执行和原始日志已保留：' + agentEventsLogPath(outputLogPath) + '\n' + renderCurrentDisposition(current.disposition));
  }
}

export async function executeStandaloneStageVerifier(input: StandaloneInput): Promise<number> {
  const projectRoot = fs.realpathSync(input.projectRoot);
  input = { ...input, projectRoot, frameworkRoot: path.resolve(projectRoot, path.relative(input.projectRoot, input.frameworkRoot)) };
  if (input.argv['cancel-verifier'] && input.argv['resume-verifier']) {
    throw new Error('--cancel-verifier 与 --resume-verifier 不能同时使用。');
  }
  const workflow = resolveWorkflowSpec(input.projectRoot, { frameworkRoot: input.frameworkRoot });
  if (!workflowPhaseIdSet(workflow).has(input.phase) || isPhaseGlobalInWorkflow(workflow, input.phase)) {
    throw new Error('请指定当前 workflow 的 feature 阶段。');
  }
  const signed = readSignedStageVerifier(input);
  if (!signed) throw new Error('当前阶段没有可读取的已签核验。请先执行该阶段检查。');
  const rawTimeout = input.argv['verifier-wait-timeout-ms'];
  const timeout = rawTimeout === undefined ? Infinity : Number(rawTimeout);
  if (rawTimeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new Error('--verifier-wait-timeout-ms 必须为正数。');
  }
  const goal = goalOwner(input, signed);
  if (goal) throw new Error('当前阶段交由原 Goal owner ' + goal + ' 处理。request=' + signed.requestPath + '，报告目标=' + signed.reportRel);
  const runDir = standaloneVerifierRunDir(signed.reportsDir, signed.request.subject_id);
  const lockPath = featureFilePath(input.projectRoot, input.feature, path.join('goal-runs', FEATURE_LOCK_NAME));
  fs.mkdirSync(runDir, { recursive: true });
  const log = path.join(runDir, 'detach.log');
  const observed = stageEvents(runDir);

  const expected = input.argv['verifier-worker-expected'];
  if (typeof expected === 'string') {
    if (input.argv['verifier-worker-subject'] !== signed.request.subject_id) throw new Error('等待期间签发对象已变化，请重新读取本阶段。');
    const lock = tryAcquireLock(lockPath, { report_dir: path.relative(input.projectRoot, runDir).replace(/\\/g, '/'),
      run_id: signed.request.subject_id });
    if (!lock) return 0;
    try { await executeUnderLock(input, signed, runDir, lockPath, lock.ownerId, expected); }
    finally { releaseLock(lockPath, lock.ownerId); }
    return 0;
  }

  const active = () => {
    const live = detectLiveFeatureLock(input.projectRoot, input.feature)?.record;
    return live?.run_id === signed.request.subject_id && live.report_dir
      && path.resolve(input.projectRoot, live.report_dir) === runDir ? live : null;
  };
  const last = latestStart(observed);
  if (input.argv['cancel-verifier']) {
    if (!active() || !last?.invoke_id || observed.some(event => event.type === 'agent_invoke_end' && event.invoke_id === last.invoke_id)) {
      throw new Error('当前签发对象无仍在执行的已绑定核验。');
    }
    logEvent(runDir, { type: 'phase_halt', phase: last.phase, invoke_id: last.invoke_id, halt_reason: 'executor_waiting',
      detail: '用户要求取消当前已签核验。' });
  }
  const findResult = (history: StageEvent[], previous?: StageEvent) => [...history].reverse().find(event =>
    event.type === 'phase_verdict' && event.phase === input.phase && event.ts !== previous?.ts);
  const present = findResult(observed);
  if (present && subjectOnDisk(input, signed) && reportState(input, signed, readCurrentStage(input, signed))) {
    console.log(present.detail);
    return present.exit_code ?? 1;
  }
  const result = () => findResult(stageEvents(runDir), present);
  let launchedPid: number | undefined;
  let spawnError: string | undefined;
  if (!active() && !input.argv['cancel-verifier']) {
    const fd = fs.openSync(log, 'a');
    try {
      launchedPid = launchStandaloneVerifierWorker(input.entry, [...input.rawArgs, '--verifier-worker-subject', signed.request.subject_id,
        '--verifier-worker-expected', last?.invoke_id ?? ''], fd, error => { spawnError = error.message; });
    } finally { fs.closeSync(fd); }
  }
  const waitUntil = Date.now() + timeout;
  let displayed: string | undefined;
  while (Date.now() < waitUntil) {
    const complete = result();
    if (complete && subjectOnDisk(input, signed)) {
      console.log(complete.detail);
      return complete.exit_code ?? 1;
    }
    const events = stageEvents(runDir);
    const start = latestStart(events);
    const bound = [...events].reverse().find(event => event.type === 'agent_process_bound' && event.invoke_id === start?.invoke_id);
    const message = 'VERIFIER_WAIT subject=' + signed.request.subject_id + ' invoke=' + (start?.invoke_id ?? '启动中')
      + (bound?.pid ? ' bound_pid=' + bound.pid : '') + ' log=' + log;
    if (displayed !== message) { console.log(message); displayed = message; }
    if (spawnError) throw new Error('启动核验执行进程失败：' + spawnError);
    if (!active() && !(launchedPid && isPidAlive(launchedPid))) break;
    await delay(Math.min(250, Math.max(1, waitUntil - Date.now())));
  }
  const complete = result();
  if (complete && subjectOnDisk(input, signed)) { console.log(complete.detail); return complete.exit_code ?? 1; }
  if (active() || launchedPid && isPidAlive(launchedPid)) {
    console.log('等待窗口已结束；核验仍由原进程负责。用同一命令接回，subject=' + signed.request.subject_id);
    return 2;
  }
  const failure = stageEvents(runDir).reverse().find(event => event.type === 'agent_invoke_end');
  const lines = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\r?\n/) : [];
  console.error((failure?.write_evidence_rejected ?? lines.reverse().find(line => line.startsWith('[verifier]')) ?? '当前独立核验仍未完成。')
    + ' 原运行日志：' + log);
  return 1;
}
