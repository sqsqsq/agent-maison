import * as path from 'path';
import * as fs from 'fs';
import { readSessionExecution, acceptedSessionReport, acceptSessionExecution, normalizeSessionReport, inspectSessionExecutionBeforeRuntime, sessionRunMaterialPath, sessionReportInputPath, executionRequestForInvoke, observeSessionExecution, stopBoundExecution, sessionExecutionDeadlineMs, type IssuedSessionExecution, type SessionExecutionReport } from './utils/session-execution-handoff';
import * as YAML from 'yaml';
import minimist from 'minimist';
import type {
  InSessionPhaseRequestContext,
  InSessionRoundOptions,
  InSessionRoundResult,
  GoalModeInSessionOptions,
} from './utils/goal-phase-runtime';
import { deriveInSessionFingerprint } from './utils/goal-phase-runtime';
import { GoalPhaseRuntime, bindGuardianOrKill, resolveManifestIdentityBaseline } from './goal-phase-runtime';
import { AttendedGoalPhaseExecutor, DetachedGoalPhaseExecutor, createWorkUnitExecutionContext, observeWorkUnitProviderSession, workUnitExecutionInputs } from './utils/goal-phase-executor';
import { loadEventsJsonl, loadAuthoritativeEvents } from './utils/goal-runner-phase';
import { resolveHeadlessInvokePlan, extractProviderFinalText } from './utils/agent-invoke';
import { invocationCompleted, invocationEndFacts } from './utils/invocation-completion';
import { reconcileGuardianOwnership } from './utils/goal-containment-reconcile';
import { defaultProcessProbe } from './utils/device-session';
import { RUN_LOCK_NAME, tryAcquireLock, releaseLock, touchLock, readLockRecord, isLockStale } from './utils/goal-run-lock';
import { resolveGoalRunBaseline } from './utils/goal-run-baseline';
import { projectCanonicalLifecycle } from './utils/goal-canonical-lifecycle';
import {
  readRunControl,
  ensureRunControl,
  releaseRunOwner,
  resumeIssuedSessionOwner,
  renewSessionLease,
} from './utils/goal-run-control';
import {
  buildGoalManifestFromInput,
  inheritSuccessorManifest,
  deriveSuccessorRequirement,
  loadGoalManifestFromRun,
  loadGoalManifestFile,
  loadGoalManifestDefinition,
  loadGoalRunManifestFromRun,
  isInitialDesignManifest,
  type InitialDesignGoalManifest,
  resolveRequirementInput,
  RUN_ADAPTER_PROVENANCES,
  type GoalManifest,
  type GoalRunManifest,
  type GoalBudget,
  type UnattendedContract,
  computeManifestIdentityFields,
  diffManifestIdentityFields,
  type AdapterModelPin,
  type RunAdapterProvenance,
} from './utils/goal-manifest';
import {
  assertGoalRunAttachable,
  createGoalRun,
  decideRunContinuation,
  inspectGoalRunCreation,
  resolveDeliveryCycleBoundary,
  successorBoundsConflicts,
  successorBoundsRefusal,
  resolveActualGoalPhaseChainAtBirth,
  type RunContinuationDecision,
  loadEffectiveExecutionScope,
} from './utils/goal-run-creation';
import { loadLocalConfig } from './utils/framework-local-config';
import {
  resolveUnattendedVisualProviderPin,
} from './utils/visual-provider-identity';
import { resolveWorkflowSpec } from '../workflow-loader';
import { relFeaturesDir } from '../config';
import { executionCompletionPhases, executionScopeFingerprint, authorizedScopePhases } from './utils/execution-scope';
import { featurePhasesFromWorkflow, resolveAutoChain } from './utils/phase-transition-policy';
import { loadFeatureTrackDecl, prepareFeatureScopeCandidate, featureScopePhaseHealth } from './utils/feature-track';
import { assembleKnowledge, renderKnowledge } from './utils/knowledge-context';
import { readBoundInput } from './utils/capability-resolution';
import { resolveBirthExecutionScope, registerFeatureScopeTransfer, resolveSuccessorExecutionScope } from './utils/feature-execution-scope';
import { resolveFeatureTrack } from './utils/runtime-policy';
import { validateMinimumAssurance } from './utils/skill-contract';
import { loadGoalCapability, routeGoalCapability } from './utils/goal-adapter-capability';
import { loadInertLegacyFidelityIntentSsot } from './utils/fidelity-shared';
import { designDeliveryNextStep, DesignDeliveryPreparationRequired } from './utils/design-delivery-entry';
import { findInitialDesignRun, prepareInitialDesignRun, projectInitialDesignDelivery, initialDesignPhasePolicy, initialDesignScopeActionIssues } from './utils/initial-design-delivery';
import type { ProviderRef } from './utils/types';
import { applyManifestCliOverrides, validateManifestCliOverrides } from './utils/goal-manifest-cli';
import { assertCanonicalDeliveryChild, originalDeliveryForManifest } from './utils/delivery-origin';
export type { GoalModeInSessionOptions } from './utils/goal-phase-runtime';
export { deriveInSessionFingerprint } from './utils/goal-phase-runtime';

/** Host bridge: lifecycle progression is owned by GoalPhaseRuntime. */
export async function runGoalModeInSession(
  options: GoalModeInSessionOptions,
): Promise<InSessionRoundResult> {
  // Compatibility callers used to pre-acquire the session fence. Release it before entering
  // the canonical runtime, which owns acquisition, progression and terminal release itself.
  try { releaseRunOwner(options.runDir, options.token); } catch { /* already released */ }
  return runGoalModeHostBridge({
    projectRoot: options.projectRoot,
    frameworkRoot: options.frameworkRoot,
    feature: options.manifest.feature,
    runId: options.manifest.run_id,
    adapter: options.adapter,
    runMode: 'attended',
    executePhase: options.executePhase,
    authorization: options.authorization,
    leaseMs: options.leaseMs,
    onRound: options.onRound,
  });
}
export interface PrepareGoalModeRunOptions {
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  runId?: string;
  supersede?: string[];
  adapter: string;
  adapterSource?: RunAdapterProvenance;
  requirement: string;
  /** plan c4e8a1f7 T2：--requirement-file 来源列表（goal-mode-entry 与 goal-runner 同源解析） */
  requirementSourceFiles?: string[];
  userDeadlineAt?: string;
  startPhase?: string;
  endPhase?: string;
  forceFresh?: boolean;
  budgetOverride?: boolean;
  autonomyAuthorized?: boolean;
  requestedResults?: string[];
  requestedPhases?: string[];
  budget?: GoalBudget;
  unattended?: UnattendedContract;
  adapterModelPin?: AdapterModelPin;
  visualProviderPin?: ProviderRef;
  fidelity?: GoalManifest['fidelity'];
  deliveryOrigin?: GoalManifest['delivery_origin'];
  dependencyPolicy?: GoalManifest['dependency_policy'];
  minimumAssurance?: GoalManifest['minimum_assurance'];
  preAuthorizedMutations?: GoalManifest['pre_authorized_mutations'];
}

/** harness/scripts → framework root；standalone 与 consumer 的目录层级一致。 */
export function defaultGoalModeFrameworkRoot(scriptDir = __dirname): string {
  return path.resolve(scriptDir, '..', '..');
}

/** Create the persisted manifest/control skeleton for a fresh attended run. */
export function prepareGoalModeRun(options: PrepareGoalModeRunOptions): {
  manifest: GoalRunManifest;
  manifestPath: string;
  runDir: string;
  /** plan 4e6fb3b6 §7：本次 prepare 走了哪条路（新开 = 新出生；重新接入 = 返回既有 run，宿主照常以它的 run id 附着）。 */
  continuation: RunContinuationDecision;
} {
  if (options.deliveryOrigin) {
    assertCanonicalDeliveryChild(options.projectRoot, options.feature, options.deliveryOrigin);
    const origin = loadGoalRunManifestFromRun(options.projectRoot, options.deliveryOrigin.run_id, { feature: options.deliveryOrigin.feature });
    if (!isInitialDesignManifest(origin)) throw new Error('[goal-mode-entry] delivery origin is not an original design request');
    assertGoalRunAttachable(options.projectRoot, origin);
    if (origin.requirement !== options.requirement || origin.adapter !== options.adapter) throw new Error('[goal-mode-entry] child cannot replace original requirement or adapter');
    options = { ...options, requirementSourceFiles: origin.requirement_source_files, userDeadlineAt: origin.user_deadline_at, unattended: origin.unattended,
      adapterSource: typeof origin.adapter_provenance === 'string' && (RUN_ADAPTER_PROVENANCES as readonly string[]).includes(origin.adapter_provenance) ? origin.adapter_provenance as RunAdapterProvenance : undefined,
      adapterModelPin: origin.adapter_model_pin, visualProviderPin: origin.visual_provider_pin, fidelity: origin.fidelity,
      dependencyPolicy: origin.dependency_policy, minimumAssurance: origin.minimum_assurance, preAuthorizedMutations: origin.pre_authorized_mutations };
  }
  const feature = options.feature.trim();
  const adapter = options.adapter.trim();
  const requirement = options.deliveryOrigin ? options.requirement : options.requirement.trim();
  if (!feature || !adapter || !requirement.trim()) {
    throw new Error('--prepare-run requires --feature, --adapter, and --requirement');
  }
  const existingInitial = findInitialDesignRun({ ...options, feature });
  const previousInitial = existingInitial ?? findInitialDesignRun({ projectRoot: options.projectRoot, feature });
  // plan 4e6fb3b6 §7.3：接续决策在生成出生范围之前执行（与前台、detach 同一个函数）。
  const continuation: RunContinuationDecision = existingInitial && !options.supersede?.length
    ? { kind: 'rejoin', explicit: false, runId: existingInitial.run_id, started: true, reason: '接回原始正式请求' }
    : options.forceFresh
    ? { kind: 'fresh', explicit: true, reason: '显式 --force' }
    : decideRunContinuation({
        projectRoot: options.projectRoot, frameworkRoot: options.frameworkRoot, feature,
        call: {
          requirement,
          ...(options.requirementSourceFiles?.length ? { requirementSourceFiles: options.requirementSourceFiles } : {}),
          attended: true,
          supersede: options.supersede,
        },
      });
  if (continuation.kind === 'hold') throw new Error(`[goal-mode-entry] ${continuation.guidance}`);
  const initial = existingInitial;
  const next = previousInitial ? null : designDeliveryNextStep({ ...options, feature });
  if (initial || previousInitial || next) {
    const prepared = prepareInitialDesignRun({ ...options, feature,
      visualProviderPin: options.visualProviderPin ?? resolveUnattendedVisualProviderPin(loadLocalConfig(options.projectRoot), options.frameworkRoot).pin });
    const continuation: RunContinuationDecision = prepared.created
      ? prepared.continuation ?? { kind: 'fresh', explicit: false, reason: '原始正式请求进入同一受管设计段' }
      : { kind: 'rejoin', explicit: false, runId: prepared.manifest.run_id, started: true, reason: '接回原始正式请求与其现有设计/CU工作' };
    return { ...prepared, continuation };
  }
  if (continuation.kind === 'rejoin') {
    const existing = loadGoalManifestFromRun(options.projectRoot, continuation.runId, {
      feature, featuresDir: relFeaturesDir(options.projectRoot),
    });
    const existingDir = path.resolve(options.projectRoot, ...existing.report_dir.split('/'));
    return { manifest: existing, manifestPath: path.join(existingDir, 'manifest.json'), runDir: existingDir, continuation };
  }
  const workflow = resolveWorkflowSpec(options.projectRoot, { frameworkRoot: options.frameworkRoot });
  if (continuation.kind === 'successor') {
    // 批三返修 R4：只出生后继（合同继承、需求合并、范围重解析、出生记录），用的全是 runtime 出生段的既有函数；
    // 承接审计、身份核对、预算血缘与范围转交由随后的附着按"附着的后继补完承接"做（R2），在原来的有人在场执行者之下运行。
    const featuresDir = relFeaturesDir(options.projectRoot);
    const source = loadGoalManifestFromRun(options.projectRoot, continuation.source, { feature, featuresDir });
    // 批三二轮返修 R3/R4：与 runtime 同一判据——只容忍原请求重放的起止，不同就在出生之前明确拒绝、不建 run。
    const boundsConflicts = successorBoundsConflicts(source, {
      ...(options.startPhase !== undefined ? { start: options.startPhase } : {}),
      ...(options.endPhase !== undefined ? { end: options.endPhase } : {}),
    });
    if (boundsConflicts.length) throw new Error(successorBoundsRefusal(continuation.reason, boundsConflicts));
    const sourceCreation = inspectGoalRunCreation(options.projectRoot, source);
    if (sourceCreation.state !== 'complete' && sourceCreation.state !== 'legacy') {
      throw new Error(`[goal-mode-entry] 后继的合同来源 ${source.run_id} 出生记录不完整，不能起后继`);
    }
    const baseline = resolveGoalRunBaseline(options.projectRoot, feature, source.run_id);
    if (baseline.available) source.run_base_sha = baseline.baseSha; else delete source.run_base_sha;
    const birthInput = buildGoalManifestFromInput({
      feature, run_id: options.runId, requirement, adapter: source.adapter,
      ...(options.userDeadlineAt ? { user_deadline_at: options.userDeadlineAt } : {}),
      ...(options.requirementSourceFiles?.length ? { requirement_source_files: options.requirementSourceFiles } : {}),
      start_phase: source.start_phase, end_phase: source.end_phase,
      unattended: options.unattended ?? { write_mode: 'full-access', approval_mode: 'never' },
      ...(options.adapterModelPin ? { adapter_model_pin: options.adapterModelPin } : {}),
      ...(options.visualProviderPin ? { visual_provider_pin: options.visualProviderPin } : {}),
      ...(options.fidelity ? { fidelity: options.fidelity } : {}),
      ...(options.deliveryOrigin ? { delivery_origin: options.deliveryOrigin } : {}),
      ...(options.dependencyPolicy ? { dependency_policy: options.dependencyPolicy } : {}),
      ...(options.minimumAssurance ? { minimum_assurance: options.minimumAssurance } : {}),
      ...(options.preAuthorizedMutations ? { pre_authorized_mutations: options.preAuthorizedMutations } : {}),
    }, { projectRoot: options.projectRoot, featuresDir });
    const cycleBoundary = resolveDeliveryCycleBoundary({ projectRoot: options.projectRoot, featuresDir, feature, frameworkRoot: options.frameworkRoot,
      seedTargets: continuation.targets });
    const manifest = inheritSuccessorManifest(birthInput, source, { round: [], drift: [] }, { newDeliveryCycle: cycleBoundary === source.run_id });
    // 与 runtime 合并块同一个函数：没有新内容时保留源合同全文，否则源全文 + 新增段（本次文本已是合并格式也不丢新增内容）
    manifest.requirement = deriveSuccessorRequirement(source.requirement, requirement);
    const scope = resolveSuccessorExecutionScope(options.projectRoot, feature, workflow, options.frameworkRoot, manifest.requirement, source.run_id, manifest.fidelity);
    if (scope) {
      if (!scope.phase_chain.length) throw new Error('[goal-mode-entry] empty scope: verify existing results without creating a run');
      Object.assign(manifest, { execution_scope: scope, start_phase: scope.phase_chain[0], end_phase: scope.phase_chain.at(-1)!, chain_override: [...scope.phase_chain] });
    }
    const track = resolveFeatureTrack(loadFeatureTrackDecl(options.projectRoot, feature));
    const chain = scope?.phase_chain ?? resolveAutoChain(workflow, manifest.start_phase, manifest.end_phase, manifest.chain_override, track);
    createGoalRun({ projectRoot: options.projectRoot, frameworkRoot: options.frameworkRoot, manifest, chain, continuation });
    const successorDir = path.resolve(options.projectRoot, ...manifest.report_dir.split('/'));
    ensureRunControl(successorDir, manifest.run_id);
    return { manifest, manifestPath: path.join(successorDir, 'manifest.json'), runDir: successorDir, continuation };
  }
  // D1.3：出生范围 = 转交时 feature 的**有效**范围（有记录时不重算候选）。
  if (options.deliveryOrigin) {
    const original = loadGoalRunManifestFromRun(options.projectRoot, options.deliveryOrigin.run_id, { feature: options.deliveryOrigin.feature });
    if (!isInitialDesignManifest(original)) throw new Error('[goal-mode-entry] original request is not an initial-design request');
    const issues = initialDesignScopeActionIssues(options.projectRoot, feature, initialDesignPhasePolicy(options.projectRoot, options.frameworkRoot, original));
    if (issues.length) throw new Error(issues.join('\n'));
  }
  const birth = resolveBirthExecutionScope(options.projectRoot, feature, workflow, options.frameworkRoot, requirement);
  const executionScope = birth.scope;
  if (executionScope && !executionScope.phase_chain.length) throw new Error('[goal-mode-entry] empty scope: verify existing results without creating a run');
  const manifest = buildGoalManifestFromInput(
    {
      feature,
      ...(options.userDeadlineAt ? { user_deadline_at: options.userDeadlineAt } : {}),
      run_id: options.runId,
      requirement,
      ...(options.requirementSourceFiles && options.requirementSourceFiles.length > 0
        ? { requirement_source_files: options.requirementSourceFiles }
        : {}),
      adapter,
      ...(options.adapterSource ? { adapter_provenance: options.adapterSource } : {}),
      ...(executionScope ? { execution_scope: executionScope, chain_override: [...executionScope.phase_chain] } : {}),
      start_phase: options.startPhase ?? executionScope?.phase_chain[0] ?? 'spec',
      end_phase: options.endPhase ?? executionScope?.phase_chain.at(-1) ?? 'testing',
      // plan a8e5c3f9 t6：headless 即全权限——新 manifest 直接写 effective 值
      //（此前 workspace-write + on-request 让 claude 连 dontAsk 都拿不到，与无人值守自相矛盾）。
      unattended: options.unattended ?? { write_mode: 'full-access', approval_mode: 'never' },
      ...(options.adapterModelPin ? { adapter_model_pin: options.adapterModelPin } : {}),
      ...(options.visualProviderPin ? { visual_provider_pin: options.visualProviderPin } : {}),
      ...(options.fidelity ? { fidelity: options.fidelity } : {}),
      ...(options.deliveryOrigin ? { delivery_origin: options.deliveryOrigin } : {}),
      ...(options.dependencyPolicy ? { dependency_policy: options.dependencyPolicy } : {}),
      ...(options.minimumAssurance ? { minimum_assurance: options.minimumAssurance } : {}),
      ...(options.preAuthorizedMutations ? { pre_authorized_mutations: options.preAuthorizedMutations } : {}),
      // plan ab072691 t1③(b)：attended goal 在**创建 manifest 前**冻结只读视觉 provider。
      // 询问/重选发生在宿主会话里（registry setup.visual_provider → init-orchestrate
      // record-visual-provider 机器写盘）；这里只读 local 的既成结果并冻结进 manifest。
      // local 缺失或旧配置失去资格时不伪造 provider；严格需求与能力不足的冲突由
      // fidelity/capability 门禁裁决，optional 视觉轴保持 advisory。
      ...(() => {
        if (options.visualProviderPin || options.deliveryOrigin) return {};
        let local: ReturnType<typeof loadLocalConfig> = null;
        try {
          local = loadLocalConfig(options.projectRoot);
        } catch (error) {
          console.warn(
            `[visual-provider] WARN: 读取个人级视觉 provider 配置失败，按无 provider 处理：` +
              `${(error as Error).message}。严格视觉需求将由 capability 门禁诚实 defer。`,
          );
        }
        const resolved = resolveUnattendedVisualProviderPin(local, options.frameworkRoot);
        if (resolved.warning) console.warn(resolved.warning);
        return resolved.pin ? { visual_provider_pin: resolved.pin } : {};
      })(),
    },
    { projectRoot: options.projectRoot, featuresDir: relFeaturesDir(options.projectRoot) },
  );
  validateMinimumAssurance(
    options.frameworkRoot,
    manifest.minimum_assurance,
    new Set(workflow.artifacts.filter((item) => item.scope === 'feature').map((item) => item.id)),
  );
  const manifestPath = path.resolve(options.projectRoot, manifest.report_dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    throw new Error(`[goal-mode-entry] run manifest already exists: ${manifestPath}`);
  }
  const track = resolveFeatureTrack(loadFeatureTrackDecl(options.projectRoot, feature));
  const chain = executionScope?.phase_chain ?? resolveAutoChain(
    workflow,
    manifest.start_phase,
    manifest.end_phase,
    manifest.chain_override,
    track,
  );
  const actualChain = resolveActualGoalPhaseChainAtBirth({
    requestedChain: chain,
    fullWorkflowChain: executionScope ? executionCompletionPhases(executionScope) : featurePhasesFromWorkflow(workflow, track),
    requiresLegacyFidelityRecovery:
      !executionScope && loadInertLegacyFidelityIntentSsot(options.projectRoot, feature) !== null,
  });
  createGoalRun({ projectRoot: options.projectRoot, frameworkRoot: options.frameworkRoot, manifest, chain: actualChain, forceFresh: options.forceFresh, continuation });
  // D1.3 转交登记：**createGoalRun 成功之后、ensureRunControl 之前**。出生未完成时 feature 侧
  // 绝不能留下指向不存在 run 的指针；反向残留（记录指向不存在的 run）才是 D1.3 第三行的报错。
  if (executionScope) {
    registerFeatureScopeTransfer({
      projectRoot: options.projectRoot, feature, runId: manifest.run_id,
      transferredScopeFingerprint: executionScopeFingerprint(executionScope),
    });
  }
  let runDir = path.resolve(options.projectRoot, ...manifest.report_dir.split('/'));
  ensureRunControl(runDir, manifest.run_id);
  return { manifest, manifestPath, runDir, continuation };
}

export interface GoalModeHostBridgeOptions {
  sessionHandoff?: import('./goal-phase-runtime').GoalPhaseRuntimeLaunchOptions['sessionHandoff'];
  overrideManifest?: boolean;
  onScopeRevision?: import('./goal-phase-runtime').GoalPhaseRuntimeLaunchOptions['onScopeRevision'];
  projectRoot: string;
  frameworkRoot: string;
  feature: string;
  runId: string;
  adapter: string;
  runMode?: string;
  executePhase: InSessionRoundOptions['executePhase'];
  authorization?: InSessionRoundOptions['authorization'];
  leaseMs?: number;
  forceTakeover?: boolean;
  onRound?: (result: InSessionRoundResult) => void;
}

/**
 * `differs` 时逐条列出差异字段（磁盘候选 vs 本次生成）——只做呈现，不改写任何文件。
 * 扁平路径比较，避免让用户对着两段 YAML 自己找。
 */
export function describeCandidateDifference(disk: unknown, generated: unknown): string[] {
  const flatten = (value: unknown, prefix: string, out: Map<string, string>): void => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
      return;
    }
    out.set(prefix || '(root)', JSON.stringify(value));
  };
  const left = new Map<string, string>();
  const right = new Map<string, string>();
  flatten(disk, '', left);
  flatten(generated, '', right);
  const lines: string[] = [];
  for (const [key, value] of right) {
    const had = left.get(key);
    if (had === undefined) lines.push(`${key}: 磁盘候选缺少（本次生成=${value}）`);
    else if (had !== value) lines.push(`${key}: 磁盘=${had} ≠ 本次生成=${value}`);
  }
  for (const key of left.keys()) if (!right.has(key)) lines.push(`${key}: 仅磁盘候选有（本次生成已不含）`);
  return lines.slice(0, 20);
}

export function assertAttendedRunMode(runMode: string | undefined): void {
  if (runMode?.trim() !== 'attended') {
    throw new Error('[goal-mode-entry] attended attach requires --run-mode attended');
  }
}

export function buildPhaseExecuteRequest(
  context: InSessionPhaseRequestContext,
  recommendation: unknown,
): {
  type: 'phase_execute_request'; run_id: string; phase: string; attempt_id: string;
  owner_id: string; owner_epoch: number; recommendation: unknown;
} {
  return {
    type: 'phase_execute_request',
    run_id: context.runId,
    phase: context.phase,
    attempt_id: context.attemptId,
    owner_id: context.ownerId,
    owner_epoch: context.ownerEpoch,
    recommendation,
  };
}

/**
 * Host-facing production bridge: resolves the persisted run, acquires a fenced
 * session epoch, and invokes the canonical in-session loop. Hosts provide only
 * the adapter's isolated phase callback; they never construct tokens or loops.
 */
export async function runGoalModeHostBridge(
  options: GoalModeHostBridgeOptions,
): Promise<InSessionRoundResult> {
  // Caller declaration is only a startup assertion. It is deliberately not persisted as mode state.
  assertAttendedRunMode(options.runMode);
  let manifest = loadGoalManifestFromRun(options.projectRoot, options.runId, {
    feature: options.feature,
    featuresDir: relFeaturesDir(options.projectRoot),
  });
  // 出生契约必须在 owner CAS 前成立；attach 永不补造 run_created。
  assertGoalRunAttachable(options.projectRoot, manifest);
  const callerAdapter = options.adapter.trim();
  if (!callerAdapter || callerAdapter !== manifest.adapter) {
    throw new Error(
      `[goal-mode-entry] attach adapter mismatch: caller=${callerAdapter || '<empty>'}, manifest=${manifest.adapter}`,
    );
  }
  const adapter = manifest.adapter;
  const attendedRoute = routeGoalCapability(
    loadGoalCapability(options.frameworkRoot, adapter),
    'attended',
  );
  if (attendedRoute.kind !== 'in_session') {
    throw new Error(`[goal-mode-entry] attended capability route 非法：${attendedRoute.reason}`);
  }
  let runDir = path.resolve(options.projectRoot, ...manifest.report_dir.split('/'));
  const hasExecutionStart = loadEventsJsonl(path.join(runDir, 'events.jsonl'))
    .some((event) => event.type === 'run_start');
  const executor = new AttendedGoalPhaseExecutor(async (context) => {
    const outcome = await options.executePhase(
      context.phase,
      { action: 'run_phase', phase: context.phase, instruction: context.instruction ?? '' },
      {
        runId: context.runId,
        phase: context.phase,
        attemptId: context.attemptId,
        ownerId: context.owner.owner_id,
        ownerEpoch: context.owner.epoch,
      },
    );
    return outcome;
  });
  const runtime = new GoalPhaseRuntime({
    onScopeRevision: options.onScopeRevision,
    sessionHandoff: options.sessionHandoff,
    args: [
      hasExecutionStart ? '--resume' : '--attach-created', manifest.run_id,
      '--feature', manifest.feature,
      '--adapter', adapter,
      '--foreground-ok',
      '--runtime-executor', 'attended',
      '--runtime-owner', 'session',
      '--project-root', options.projectRoot,
      '--framework-root', options.frameworkRoot,
      ...(options.forceTakeover ? ['--force-resume'] : []),
      ...(options.overrideManifest ? ['--override-manifest'] : []),
    ],
    ownerKind: 'session',
    executor,
    authorization: options.authorization ?? { mode: 'goal_mode' },
    ...(options.leaseMs !== undefined ? { leaseMs: options.leaseMs } : {}),
  });
  const priorEventCount = loadEventsJsonl(path.join(runDir, 'events.jsonl')).length;
  const invocationStartedAt = new Date().toISOString();
  const exitCode = await runtime.run();
  const changedRun = runtime.lastRunId && runtime.lastRunId !== manifest.run_id;
  if (runtime.lastRunId && runtime.lastRunId !== manifest.run_id) {
    manifest = loadGoalManifestFromRun(options.projectRoot, runtime.lastRunId, { feature: options.feature });
    runDir = path.resolve(options.projectRoot, manifest.report_dir);
  }

  const rawEvents = loadEventsJsonl(path.join(runDir, 'events.jsonl'));
  const currentEvents = changedRun
    ? rawEvents.filter(event => typeof event.ts === 'string' && event.ts >= invocationStartedAt)
    : rawEvents.slice(priorEventCount);
  const canonical = projectCanonicalLifecycle(currentEvents);
  const lastVerdict = [...canonical].reverse().find((event) => event.type === 'phase_verdict');
  const lastHalt = [...canonical].reverse().find((event) => event.type === 'phase_halt');
  const rawHalt = [...currentEvents].reverse().find(event => event.type === 'phase_halt') as Record<string, unknown> | undefined;
  const haltDetail = [rawHalt?.detail, rawHalt?.halt_guidance].find(value => typeof value === 'string' && value.trim()) as string | undefined;
  const lastEnd = [...currentEvents].reverse().find(event => event.type === 'run_end') as Record<string, unknown> | undefined;
  const completed = exitCode === 0 && (lastEnd?.status === 'CHAIN_SLICE_COMPLETED'
    || !currentEvents.length && [...rawEvents].reverse().find(event => event.type === 'run_end')?.status === 'CHAIN_SLICE_COMPLETED');
  const waiting = lastHalt?.type === 'phase_halt' && lastHalt.halt_reason === 'executor_waiting'
    && (!lastEnd || lastEnd.halt_reason === 'executor_waiting');
  const terminalFailure = !waiting && (lastEnd?.status === 'HALTED' || lastEnd?.status === 'INTERRUPTED');
  const terminalDetail = [lastEnd?.error, haltDetail, lastEnd?.halt_reason, lastEnd?.reason]
    .find((value): value is string => typeof value === 'string' && !!value.trim())?.slice(0, 1200);
  const phase = lastVerdict?.type === 'phase_verdict'
    ? lastVerdict.phase
    : lastHalt?.type === 'phase_halt'
      ? lastHalt.phase
      : manifest.start_phase;
  const outcome = terminalFailure
    ? { status: 'failed' as const, phase, details: terminalDetail }
    : lastVerdict?.type === 'phase_verdict'
    ? {
        status: lastVerdict.verdict === 'PASS' ? 'passed' as const : 'failed' as const,
        phase,
        details: lastVerdict.halt_reason,
      }
    : lastHalt?.type === 'phase_halt'
      ? { status: 'waiting' as const, phase, details: haltDetail?.slice(0, 1200) ?? lastHalt.halt_reason }
      : undefined;
  const result: InSessionRoundResult = {
    run_id: manifest.run_id,
    exit_code: exitCode,
    status: completed
      ? 'reconciled'
      : waiting
        ? 'waiting'
        : exitCode === 0
          ? 'executed'
          : 'fused',
    assessment: null,
    outcome,
    ...(exitCode !== 0 ? { waiting_item: terminalDetail ?? lastHalt?.halt_reason ?? 'runtime halted' } : {}),
    ...(exitCode !== 0 && (lastEnd || rawHalt) ? { recovery: {
      reason: String(lastEnd?.halt_reason ?? lastEnd?.reason ?? rawHalt?.halt_reason ?? '') || undefined,
      ...(rawHalt?.probe ? { probe: rawHalt.probe } : {}),
      guidance: terminalDetail,
    } } : {}),
    status_line: `feature=${manifest.feature} | phase=${phase} | runtime=canonical | exit=${exitCode}${terminalFailure ? ` | ${lastEnd?.status}: ${terminalDetail ?? ''}` : ''}`,
  };
  options.onRound?.(result);
  return result;
}

export function parseSessionReportResult(value: string, runDir: string, expectedInputPath: string): SessionExecutionReport {
  let text = value;
  if (value.startsWith('@')) {
    const file = sessionRunMaterialPath(runDir, path.resolve(runDir, value.slice(1)));
    if (file !== sessionRunMaterialPath(runDir, expectedInputPath)) throw new Error('[session-handoff] report input is not the current request result file');
    text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  }
  return normalizeSessionReport(JSON.parse(text));
}

function resolveOriginalDeliveryRequest(projectRoot: string, original: InitialDesignGoalManifest, requestPath: string): IssuedSessionExecution {
  const file = path.resolve(requestPath);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { context?: { feature?: string; runId?: string; runDir?: string } };
  if (!raw.context?.feature || !raw.context.runId) throw new Error('[session-handoff] invalid delivery request');
  const current = loadGoalRunManifestFromRun(projectRoot, raw.context.runId, { feature: raw.context.feature });
  if (!(current.feature === original.feature && current.run_id === original.run_id)
    && (current.delivery_origin?.feature !== original.feature || current.delivery_origin.run_id !== original.run_id)) throw new Error('[session-handoff] request belongs to another original delivery');
  if (!isInitialDesignManifest(current)) assertCanonicalDeliveryChild(projectRoot, current.feature, original);
  const runDir = path.resolve(projectRoot, current.report_dir);
  if (path.resolve(raw.context.runDir ?? '') !== runDir) throw new Error('[session-handoff] delivery request location mismatch');
  const issued = readSessionExecution(runDir, file);
  if (!issued) throw new Error('[session-handoff] request has no signed execution');
  return issued;
}

function executionActionCommands(options: Pick<GoalModeHostBridgeOptions, 'authorization' | 'overrideManifest'>, issued: IssuedSessionExecution): Record<string, string> {
  const quote = (value: string): string => `'${value.replace(/'/g, process.platform === 'win32' ? "''" : "'\\''")}'`;
  const context = issued.request.context;
  const base = `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} -r ${quote(require.resolve('ts-node/register/transpile-only'))} ${quote(path.join(context.frameworkRoot, 'harness/scripts/goal-mode-entry.ts'))} --feature ${quote(context.feature)} --run-id ${quote(context.runId)} --adapter ${quote(context.adapter)} --run-mode attended --project-root ${quote(context.projectRoot)} --framework-root ${quote(context.frameworkRoot)}${options.authorization?.autonomyAuthorized ? ' --authorize-autonomy' : ''}${options.overrideManifest ? ' --override-manifest' : ''}`;
  const request = ` --request ${quote(path.resolve(context.runDir, issued.reference.path))}`;
  return { execute_command: `${base}${request} --execute-request`, observe_command: `${base}${request} --observe`, interrupt_command: `${base}${request} --interrupt`, next_command: `${base} --next` };
}

export async function runGoalModeSessionStep(options: Omit<GoalModeHostBridgeOptions, 'executePhase' | 'sessionHandoff'> & {
  requestPath?: string; report?: SessionExecutionReport; action?: 'execute' | 'observe' | 'interrupt';
}): Promise<Record<string, unknown>> {
  if (options.action) return runGoalExecutionAction(options);
  assertAttendedRunMode(options.runMode);
  const deliveryManifest = loadGoalRunManifestFromRun(options.projectRoot, options.runId, { feature: options.feature });
  const currentOriginal = originalDeliveryForManifest(options.projectRoot, deliveryManifest);
  if (currentOriginal && (currentOriginal.run_id !== options.runId || currentOriginal.feature !== options.feature)) {
    return runGoalModeSessionStep({ ...options, feature: currentOriginal.feature, runId: currentOriginal.run_id });
  }
  if (!isInitialDesignManifest(deliveryManifest) && deliveryManifest.delivery_origin) {
    return runGoalModeSessionStep({ ...options, feature: deliveryManifest.delivery_origin.feature, runId: deliveryManifest.delivery_origin.run_id });
  }
  if (isInitialDesignManifest(deliveryManifest)) {
    const original = deliveryManifest;
    if (original.adapter !== options.adapter) throw new Error('[goal-mode-entry] attach adapter mismatch');
    const runDir = path.resolve(options.projectRoot, original.report_dir);
    const quote = (value: string): string => `'${value.replace(/'/g, process.platform === 'win32' ? "''" : "'\\''")}'`;
    const command = (action: string): string => `npx ts-node ${quote(path.join(options.frameworkRoot, 'harness/scripts/goal-mode-entry.ts'))} --feature ${quote(original.feature)} --run-id ${quote(original.run_id)} --adapter ${quote(options.adapter)} --run-mode attended --project-root ${quote(options.projectRoot)} --framework-root ${quote(options.frameworkRoot)}${options.authorization?.autonomyAuthorized ? ' --authorize-autonomy' : ''}${options.overrideManifest ? ' --override-manifest' : ''} ${action}`;
    if (options.requestPath) {
      const request = resolveOriginalDeliveryRequest(options.projectRoot, original, options.requestPath);
      const prelude = inspectSessionExecutionBeforeRuntime({ runDir: request.request.context.runDir, requestPath: options.requestPath,
        report: options.report, forceTakeover: options.forceTakeover });
      if (options.report) {
        const prior = prelude.accepted;
        if (prior) {
          return { type: 'goal_session_report_received', run_id: original.run_id, delivery_run_id: original.run_id, phase: prior.report.phase,
            status: prior.report.status, duplicate: true, next_command: command('--next'), report: path.resolve(request.request.context.runDir, prior.event.handoff_report!.path) };
        }
      }
    }
    let issued: IssuedSessionExecution | undefined;
    const runtime = new GoalPhaseRuntime({ args: ['--feature', original.feature, '--resume', original.run_id,
      '--project-root', options.projectRoot, '--framework-root', options.frameworkRoot, '--runtime-executor', 'attended', '--runtime-owner', 'session', '--foreground-ok',
      ...(options.overrideManifest ? ['--override-manifest'] : []), ...(options.forceTakeover ? ['--force-resume'] : [])],
      authorization: options.authorization, leaseMs: options.leaseMs,
      sessionHandoff: { requestPath: options.requestPath, report: options.report ? normalizeSessionReport(options.report) : undefined,
        onRequest: request => { issued = request; } } });
    const controlLog = path.join(runDir, 'session-control.log');
    const savedConsole = { log: console.log, warn: console.warn, error: console.error };
    const log = (...args: unknown[]): void => fs.appendFileSync(controlLog, args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ') + '\n');
    let exitCode: number;
    try { console.log = log; console.warn = log; console.error = log; exitCode = await runtime.run(); }
    finally { Object.assign(console, savedConsole); }
    if (issued) return { type: 'phase_execute_request', run_id: issued.request.context.runId, delivery_run_id: original.run_id,
      ...executionActionCommands(options, issued),
      feature: issued.request.context.feature, phase: issued.request.context.phase, attempt_id: issued.request.context.attemptId,
      log: controlLog,
      request: { path: path.resolve(issued.request.context.runDir, issued.reference.path), sha256: issued.reference.sha256 },
      deadline: Number.isFinite(sessionExecutionDeadlineMs(issued.request)) ? new Date(sessionExecutionDeadlineMs(issued.request)).toISOString() : undefined,
      gate_timeout_ms: issued.request.gate_timeout_ms, cleanup_reserve_ms: issued.request.cleanup_reserve_ms,
      status: 'execution_required', status_line: '按原件完成本职并报告；作者调用结束不表示原始交付完成。',
      next_command: command(`--request ${quote(path.resolve(issued.request.context.runDir, issued.reference.path))} --report-result ${quote('@' + sessionReportInputPath(issued.request.context.runDir, issued))}`) };
    const view = projectInitialDesignDelivery({ projectRoot: options.projectRoot, frameworkRoot: options.frameworkRoot, manifest: original });
    const status = view.complete ? 'completed' : exitCode === 3 || view.recovery?.run_disposition === 'WAITING' ? 'waiting' : 'fused';
    const result = { status, exit_code: exitCode, halt_reason: view.halt_reason, recovery: view.recovery,
      issues: view.issues, current: view.current, next_action: view.next_action };
    return { type: 'goal_session_result', run_id: original.run_id, exit_code: status === 'waiting' ? 0 : exitCode, report_dir: runDir, log: controlLog,
      result, ...(view.recovery ? { recovery: view.recovery } : {}), ...(view.complete ? {} : { next_command: command('--next') }) };
  }
  const manifest = loadGoalManifestFromRun(options.projectRoot, options.runId, { feature: options.feature, featuresDir: relFeaturesDir(options.projectRoot) });
  if (manifest.adapter !== options.adapter) throw new Error('[goal-mode-entry] attach adapter mismatch');
  assertGoalRunAttachable(options.projectRoot, manifest);
  const runDir = path.resolve(options.projectRoot, manifest.report_dir);
  const prelude = inspectSessionExecutionBeforeRuntime({ runDir, requestPath: options.requestPath, report: options.report, forceTakeover: options.forceTakeover });
  const current = prelude.current;
  if (prelude.report) options = { ...options, report: prelude.report };
  const quote = (value: string): string => process.platform === 'win32'
    ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`;
  const command = (action: string, commandRunId = options.runId): string => `npx ts-node ${quote(path.join(options.frameworkRoot, 'harness/scripts/goal-mode-entry.ts'))} --feature ${quote(options.feature)} --run-id ${quote(commandRunId)} --adapter ${quote(options.adapter)} --run-mode attended --project-root ${quote(options.projectRoot)} --framework-root ${quote(options.frameworkRoot)}${options.authorization?.autonomyAuthorized ? ' --authorize-autonomy' : ''}${options.overrideManifest ? ' --override-manifest' : ''} ${action}`;
  const project = (issued: IssuedSessionExecution): Record<string, unknown> => ({
    ...executionActionCommands(options, issued),
    type: 'phase_execute_request', run_id: issued.request.context.runId, phase: issued.request.context.phase, attempt_id: issued.request.context.attemptId,
    request: { path: path.resolve(issued.request.context.runDir, issued.reference.path), sha256: issued.reference.sha256 },
    log: path.join(runDir, 'session-control.log'),
    status: 'execution_required', status_line: '读取请求原件，按原身份执行并自检，再报告；本次领取不表示等待或通过。',
    deadline: Number.isFinite(sessionExecutionDeadlineMs(issued.request)) ? new Date(sessionExecutionDeadlineMs(issued.request)).toISOString() : undefined,
    gate_timeout_ms: issued.request.gate_timeout_ms, cleanup_reserve_ms: issued.request.cleanup_reserve_ms,
    next_command: command(`--request ${quote(path.resolve(issued.request.context.runDir, issued.reference.path))} --report-result ${quote('@' + path.relative(issued.request.context.runDir, sessionReportInputPath(issued.request.context.runDir, issued)).replace(/\\/g, '/'))}`, issued.request.context.runId),
  });
  if (current) {
    const accepted = prelude.accepted;
    if (accepted && options.report) {
      return { type: 'goal_session_report_received', run_id: options.runId, phase: accepted.report.phase, status: accepted.report.status, duplicate: true,
        next_command: command('--next'), report: path.resolve(runDir, accepted.event.handoff_report!.path) };
    }
    if (prelude.reusable) return project(prelude.reusable);
  }
  let issued: IssuedSessionExecution | undefined;
  const controlLog = path.join(runDir, 'session-control.log');
  const logOffset = fs.existsSync(controlLog) ? fs.statSync(controlLog).size : 0;
  const original = { log: console.log, warn: console.warn, error: console.error };
  const log = (...args: unknown[]): void => fs.appendFileSync(controlLog, args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ') + '\n');
  console.log = log; console.warn = log; console.error = log;
  const showFatalExit = (code: number): void => {
    if (!code) return;
    let detail = '';
    try { detail = fs.readFileSync(controlLog, 'utf8').trim().split(/\r?\n/).slice(-3).join(' | ').slice(-700); } catch { /* original exit remains authoritative */ }
    original.error(`[goal-mode-entry] exit=${code} ${detail}\nlog=${controlLog}`);
  };
  process.once('exit', showFatalExit);
  let result: InSessionRoundResult;
  try {
    result = await runGoalModeHostBridge({ ...options,
      executePhase: async () => { throw new Error('nonresident session cannot call an in-process executor'); },
      sessionHandoff: { requestPath: options.requestPath, report: options.report, onRequest: request => { issued = request; } },
    });
  } finally { process.removeListener('exit', showFatalExit); Object.assign(console, original); }
  if (issued) return project(issued);
  const actualRunId = result.run_id ?? options.runId;
  const actualRunDir = actualRunId === options.runId ? runDir : path.resolve(options.projectRoot,
    loadGoalManifestFromRun(options.projectRoot, actualRunId, { feature: options.feature }).report_dir);
  if (result.exit_code && result.status !== 'waiting' && !result.recovery) {
    const detail = fs.readFileSync(controlLog).subarray(logOffset).toString('utf8').trim().split(/\r?\n/).slice(-3).join(' | ').slice(-1200);
    if (detail) { result.waiting_item = detail; result.recovery = { guidance: detail }; }
  }
  return { type: 'goal_session_result', run_id: actualRunId, result, log: controlLog,
    exit_code: result.status === 'waiting' ? 0 : result.exit_code ?? 0,
    report_dir: actualRunDir,
    ...(result.status === 'executed' || result.status === 'waiting' ? { next_command: command('--next', actualRunId) } : {}),
    ...(result.recovery && (result.status === 'waiting' || result.status === 'fused') ? { recovery: result.recovery } : {}),
    ...(!options.authorization?.autonomyAuthorized ? { authorization_guidance: '本次按需确认；主 Agent 应先核对已有可信原授权再重传。' } : {}) };
}

/** Thin physical transport for an existing request. The ordinary runtime still owns all decisions. */
async function runGoalExecutionAction(options: Parameters<typeof runGoalModeSessionStep>[0]): Promise<Record<string, unknown>> {
  const selected = loadGoalRunManifestFromRun(options.projectRoot, options.runId, { feature: options.feature });
  const runDir = path.resolve(options.projectRoot, selected.report_dir);
  const issued = isInitialDesignManifest(selected) && options.requestPath
    ? resolveOriginalDeliveryRequest(options.projectRoot, selected, options.requestPath)
    : executionRequestForInvoke(runDir, options.requestPath
      ? (JSON.parse(fs.readFileSync(sessionRunMaterialPath(runDir, options.requestPath), 'utf8')) as { invoke_id: string }).invoke_id : undefined);
  if (!issued) throw new Error('[goal-mode-entry] no issued execution request');
  const actualRunDir = issued.request.context.runDir;
  if (options.requestPath && sessionRunMaterialPath(actualRunDir, options.requestPath) !== sessionRunMaterialPath(actualRunDir, path.resolve(actualRunDir, issued.reference.path))) throw new Error('[goal-mode-entry] execution request is not current');
  if (issued.request.context.adapter !== options.adapter) throw new Error('[goal-mode-entry] execution adapter mismatch');
  const view = () => ({ type: 'goal_session_result', run_id: issued.request.context.runId,
    observation: observeSessionExecution(actualRunDir, issued) });
  if (options.action === 'observe') return view();
  const emit = (event: Record<string, unknown>) => fs.appendFileSync(path.join(actualRunDir, 'events.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n');
  if (options.action === 'interrupt') {
    const stopped = stopBoundExecution(actualRunDir, issued, emit);
    if (!stopped.stopped && !stopped.completed) throw new Error(stopped.detail);
    return { ...view(), interrupted: stopped.stopped && !stopped.completed, detail: stopped.detail };
  }
  const accepted = acceptedSessionReport(actualRunDir, issued);
  if (accepted) return { ...view(), duplicate: true, status: accepted.report.status };
  const original = issued.request.context;
  if (original.owner.kind !== 'session') throw new Error('[goal-mode-entry] a process owner already executes its request');
  resumeIssuedSessionOwner(actualRunDir, original.owner);
  const lockPath = path.join(actualRunDir, RUN_LOCK_NAME);
  const lock = tryAcquireLock(lockPath, { run_id: original.runId, epoch: original.owner.epoch, ownerId: original.owner.owner_id, report_dir: original.reportDir, run_mode: 'authoritative' });
  if (!lock) return { ...view(), status: 'execution_running' };
  const resultPath = sessionReportInputPath(actualRunDir, issued);
  let report: SessionExecutionReport | undefined;
  let acceptedResult: ReturnType<typeof acceptSessionExecution> | undefined;
  try {
    if (fs.existsSync(resultPath)) report = normalizeSessionReport(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
    else {
      const events = loadAuthoritativeEvents(path.join(actualRunDir, 'events.jsonl'));
      const own = events.filter(event => event.invoke_id === issued.request.invoke_id);
      if (own.some(event => event.type === 'agent_process_bound' || event.type === 'agent_process_settled')) {
        const reconciled = reconcileGuardianOwnership(own, defaultProcessProbe());
        if (reconciled.kind === 'outcomes' && reconciled.items.some(item => item.kind === 'guardian_alive_matching' || item.kind === 'guardian_identity_unverifiable' && !item.identity_mismatch)) return { ...view(), status: 'execution_running', detail: '原绑定执行仍在运行或身份不可核实；不会启动第二个执行者。' };
        for (const event of own.filter(event => event.type === 'agent_process_bound')) emit({ type: 'orphan_reclaimed', phase: original.phase, invoke_id: issued.request.invoke_id, run_id: original.runId, pid: (event as Record<string, unknown>).pid, method: 'existing_identity_reconciliation' });
        const settled = [...own].reverse().find(event => event.type === 'agent_process_settled') as Record<string, any> | undefined;
        const completed = !!settled && invocationCompleted({ ...settled, exitCode: settled.exit_code });
        const raw = path.join(actualRunDir, path.dirname(issued.reference.path), 'agent-events.jsonl');
        report = { status: completed ? 'passed' : settled?.status === 'waiting' || settled?.interrupted === true ? 'waiting' : 'failed', phase: original.phase,
          details: completed && fs.existsSync(raw) ? extractProviderFinalText(fs.readFileSync(raw, 'utf8'), original.adapter) ?? '原生调用已完成，继续正式核验。'
            : '上次原生执行已停止；沿原结束事实保留失败或未完成，不从裸终态文本签通过，也不重复启动作者。' };
      } else {
        const directory = path.resolve(actualRunDir, path.dirname(issued.reference.path));
        if (['agent-output.log', 'agent-events.jsonl'].some(name => fs.existsSync(path.join(directory, name)))) return { ...view(), status: 'waiting',
          detail: '已有原始执行流但没有可核实绑定；先确认旧执行停止，不重复启动作者。' };
        const manifest = loadGoalRunManifestFromRun(options.projectRoot, original.runId, { feature: original.feature });
        const baseline = resolveManifestIdentityBaseline(events);
        if (baseline && diffManifestIdentityFields(baseline, computeManifestIdentityFields(manifest)).length) throw new Error('[goal-mode-entry] manifest_identity_drift; reconcile through --next before execution');
        const current = workUnitExecutionInputs(manifest, issued.request.purpose, options.projectRoot);
        const input = { ...original, ...current, authority: original.authority ?? current.authority };
        const observed = observeWorkUnitProviderSession(input);
        if ('status' in observed) return { ...view(), status: 'waiting', detail: observed.details,
          ...(observed.provider_session_id ? { provider_session_id: observed.provider_session_id } : {}) };
        const context = createWorkUnitExecutionContext(input, observed);
        const capability = loadGoalCapability(context.frameworkRoot, context.adapter);
        if (!capability.valid || !capability.capability) throw new Error(capability.issues.join('; '));
        const promptFile = path.join(directory, 'execution-prompt.md');
        fs.writeFileSync(promptFile, context.instruction ?? '', 'utf8');
        const plan = resolveHeadlessInvokePlan(context.adapter, capability.capability, manifest.unattended, context.instruction ?? '', {
          PROMPT: context.instruction ?? '', PROMPT_FILE: promptFile, PROJECT_ROOT: context.projectRoot, FRAMEWORK_ROOT: context.frameworkRoot,
          FEATURE: context.feature, PHASE: context.phase, SKILL_PATH: '',
        }, context.adapterModel);
        const heartbeat = setInterval(() => { try { touchLock(lockPath, lock.ownerId); renewSessionLease(actualRunDir, context.owner, 60_000); } catch { /* Fence changes prevent the result from being accepted. */ } }, 30_000);
        let bindingError: string | undefined, bindingStillAlive = false;
        try {
          const result = await new GoalPhaseRuntime().executeExecutor(context, new DetachedGoalPhaseExecutor(() => ({ plan, cwd: context.projectRoot,
            options: { outputLogPath: path.join(directory, 'agent-output.log'), extraEnv: { ...context.childEnv },
              usageCapture: capability.capability!.usage_capture, toolEventCapture: capability.capability!.tool_event_provenance,
              ...(process.platform === 'win32' ? { containment: { runId: context.runId, invokeId: issued.request.invoke_id } } : {}),
              onActiveChild: ({ pid }) => {
                if (process.platform !== 'win32') return;
                const bound = bindGuardianOrKill(pid, `${context.runId}/${issued.request.invoke_id}`);
                if (!bound.ok) { bindingError = bound.error; bindingStillAlive = bound.stillAlive; return; }
                emit({ type: 'agent_process_bound', run_id: context.runId, phase: context.phase, invoke_id: issued.request.invoke_id,
                  owner_id: context.owner.owner_id, owner_epoch: context.owner.epoch, pid, started_at_ms: bound.identity.startedAtMs,
                  executable: bound.identity.executable, token: `${context.runId}/${issued.request.invoke_id}` });
              },
            } })));
          if (bindingStillAlive) throw new Error(bindingError);
          emit({ type: 'agent_process_settled', run_id: context.runId, phase: context.phase, invoke_id: issued.request.invoke_id,
            status: result.status, ...invocationEndFacts(result), kill_attempted: result.kill_attempted });
          report = { status: bindingError ? 'failed' : result.status, phase: context.phase,
            details: bindingError ?? result.details ?? extractProviderFinalText(result.stdout, context.adapter) ?? `native exit=${result.exitCode}` };
        } finally { clearInterval(heartbeat); }
      }
      fs.writeFileSync(resultPath, JSON.stringify(report) + '\n');
    }
    const settled = [...loadAuthoritativeEvents(path.join(actualRunDir, 'events.jsonl'))].reverse().find(event => event.type === 'agent_process_settled'
      && event.invoke_id === issued.request.invoke_id) as Record<string, any> | undefined;
    if (report?.status === 'passed' && settled && !invocationCompleted({ ...settled, exitCode: settled.exit_code })) {
      report = { ...report, status: settled.interrupted === true || settled.status === 'waiting' ? 'waiting' : 'failed' };
      fs.writeFileSync(resultPath, JSON.stringify(report) + '\n');
    }
    acceptedResult = acceptSessionExecution({ runDir: actualRunDir, issued, report: report!, emit });
  } finally { releaseLock(lockPath, lock.ownerId); }
  const commands = executionActionCommands(options, issued);
  return { type: 'goal_session_report_received', run_id: original.runId, status: report!.status, duplicate: acceptedResult!.duplicate,
    next_command: commands.next_command, observation: observeSessionExecution(actualRunDir, issued) };
}

async function main(): Promise<void> {
  const argv = minimist(process.argv.slice(2), {
    string: [
      'project-root', 'framework-root', 'feature', 'run-id', 'adapter', 'requirement', 'start', 'end',
      'authorization-mode', 'through-phase', 'run-mode', 'adapter-source', 'request', 'report-result',
      // D0.2 候选生成入参（主 Agent 四项职责的机器接口）
      'completion-target', 'requested-results', 'requested-phases',
      'impact-behavior-change', 'impact-reason', 'impact-basis',
      // f9c2e6b4 t4：与 goal-runner 同名同义，共用同一读取函数（相对路径按 projectRoot 解析）
      'requirement-file', 'manifest', 'supersede',
      'user-deadline-at',
    ],
    boolean: ['force', 'force-takeover', 'prepare-run', 'prepare-scope', 'overwrite', 'help', 'next', 'authorize-autonomy', 'override-manifest', 'override-start', 'override-end', 'execute-request', 'observe', 'interrupt'],
  });
  if (argv.help) {
    console.log(
      'Usage: goal-mode-entry.ts --feature <f> --run-id <id> --adapter <name> ' +
      '--run-mode attended [--project-root <root>] [--framework-root <framework>] [--force-takeover]\n' +
      'Fresh attended run: add --prepare-run --requirement "<text>" (optionally --run-id/--start/--end; --force records an operator override).\n' +
      'Original request continuation: --prepare-run --supersede <current-run-id> preserves the audited request, real results and explicit user deadline.\n' +
      'Scope candidate (run this BEFORE --prepare-run; the two flags are mutually exclusive):\n' +
      '  --prepare-scope --feature <f> --completion-target <request|feature>\n' +
      '    --requested-results "<text>" (repeatable) --requested-phases spec,plan,coding,review,ut\n' +
      '    requested-phases declares actual work, within the authorized phases; a default six-phase allowance is not six explicit requests. Feature evidence is still derived.\n' +
      '    [--requirement "<text>" | --requirement-file <path>]  same text you will pass to --prepare-run\n' +
      '    [--impact-behavior-change true|false --impact-reason "<text>" --impact-basis <path>]  all three or none\n' +
      '    true means end-user-visible runtime behaviour and requires testing/device prerequisites; false retains device/visual acceptance duties. Missing tools never justify false.\n' +
      '    [--overwrite]  only when an existing candidate differs from the generated one\n' +
      '  e.g. --prepare-scope --feature ledger-refresh --completion-target feature\n' +
      '       --requested-results "refreshed balance is correct" --requested-phases coding,review,ut\n' +
      '       --impact-behavior-change false --impact-reason "internal value only" --impact-basis src/ledger/Balance.ets\n' +
      'Long / multi-line requirement: use --requirement-file <path> (mutually exclusive with --requirement).\n' +
      'Explicit user deadline: --user-deadline-at <UTC timestamp>; no default deadline is inferred, and continuation never resets it.\n' +
      'Protocol: --next returns a saved request and execute_command/observe_command/interrupt_command. Use --execute-request --request <saved path> for the dedicated native executor; --observe/--interrupt use that exact request and owner binding. The main conversation does not perform business edits. Legacy --report-result @<run-relative JSON file> --request <saved path> consumes a result (inline JSON remains supported). Only the current request result input file may be written by the executor. Optional --authorize-autonomy and --override-manifest are trusted launch inputs.',
    );
    return;
  }
  const projectRoot = path.resolve(String(argv['project-root'] ?? process.cwd()));
  const frameworkRoot = path.resolve(String(argv['framework-root'] ?? defaultGoalModeFrameworkRoot()));
  const inputDefinition = argv.manifest && argv['prepare-run'] ? loadGoalManifestDefinition(String(argv.manifest), projectRoot) : undefined;
  const inputManifest = inputDefinition?.manifest;
  if (argv.manifest && !argv['prepare-run']) throw new Error('[goal-mode-entry] --manifest is a prepare-run input; subsequent controls use the returned run identity');
  const suppliedRequirement = resolveRequirementInput({ requirement: argv.requirement, requirementFile: argv['requirement-file'], projectRoot });
  if (inputManifest) {
    const overrides = { manifest: String(argv.manifest), adapter: typeof argv.adapter === 'string' ? argv.adapter : undefined,
      start: typeof argv.start === 'string' ? argv.start : undefined, end: typeof argv.end === 'string' ? argv.end : undefined,
      requirement: suppliedRequirement.text, requirement_source_files: suppliedRequirement.sources,
      'user-deadline-at': typeof argv['user-deadline-at'] === 'string' ? argv['user-deadline-at'] : undefined,
      'override-manifest': Boolean(argv['override-manifest']), 'override-start': Boolean(argv['override-start']), 'override-end': Boolean(argv['override-end']) };
    const validation = validateManifestCliOverrides(overrides);
    if (!validation.ok) throw new Error(validation.message);
    applyManifestCliOverrides(inputManifest, overrides);
    if (argv.feature && argv.feature !== inputManifest.feature) throw new Error('[goal-mode-entry] --feature differs from --manifest');
  }
  const feature = String(argv.feature ?? inputManifest?.feature ?? '').trim();
  const runId = String(argv['run-id'] ?? '').trim();
  const adapter = String(argv.adapter ?? inputManifest?.adapter ?? '').trim();
  const runMode = String(argv['run-mode'] ?? '').trim();
  const prepareRun = Boolean(argv['prepare-run']);
  const prepareScope = Boolean(argv['prepare-scope']);
  // 两件事、两步走：候选生成在出生**前**，创建 run 在出生**时**。同时给出即拒绝——
  // 否则 prepare-run 先执行、prepare-scope 被静默忽略，用户以为只生成了候选却已经建了 run。
  if (prepareRun && prepareScope) throw new Error('[goal-mode-entry] --prepare-scope 与 --prepare-run 互斥：先生成候选、核对投影后再单独创建 run');
  // `--prepare-scope` 只生成出生前的范围候选：既不创建 run，也不 attach 任何执行会话，
  // 因此没有 run mode 可言。attach 与 --prepare-run 的 attended 契约一行不放宽。
  if (!prepareScope) assertAttendedRunMode(runMode || undefined);
  const adapterSourceRaw = String(argv['adapter-source'] ?? '').trim();
  const adapterSources = new Set<string>(RUN_ADAPTER_PROVENANCES);
  if (adapterSourceRaw && !adapterSources.has(adapterSourceRaw)) {
    throw new Error(`--adapter-source 非法：${adapterSourceRaw}`);
  }
  if (prepareRun) {
    const prepared = prepareGoalModeRun({
      projectRoot,
      frameworkRoot,
      feature,
      runId: runId || undefined,
      adapter,
      ...(inputManifest ? { unattended: inputManifest.unattended,
        adapterModelPin: inputManifest.adapter_model_pin, visualProviderPin: inputManifest.visual_provider_pin, fidelity: inputManifest.fidelity,
        dependencyPolicy: inputManifest.dependency_policy, minimumAssurance: inputManifest.minimum_assurance, preAuthorizedMutations: inputManifest.pre_authorized_mutations,
        ...(inputManifest.adapter_provenance && (RUN_ADAPTER_PROVENANCES as readonly string[]).includes(inputManifest.adapter_provenance) ? { adapterSource: inputManifest.adapter_provenance as RunAdapterProvenance } : {}) } : {}),
      ...(adapterSourceRaw
        ? { adapterSource: adapterSourceRaw as RunAdapterProvenance }
        : {}),
      // f9c2e6b4 t4：两个启动入口**共用** resolveRequirementInput——互斥判定、相对路径
      // 口径、空文件处置只有一份实现，不写两遍（codex 开工原则②）。
      // plan c4e8a1f7 T2：来源列表一并透传（frozen requirement 的 provenance）。
      ...(() => {
        const resolved = resolveRequirementInput({
          requirement: argv.requirement,
          requirementFile: argv['requirement-file'],
          projectRoot,
        });
        return {
          requirement: inputManifest?.requirement ?? resolved.text ?? '',
          ...(inputManifest?.requirement_source_files?.length ? { requirementSourceFiles: inputManifest.requirement_source_files }
            : resolved.sources.length > 0 ? { requirementSourceFiles: resolved.sources } : {}),
        };
      })(),
      startPhase: inputManifest?.start_phase ?? (typeof argv.start === 'string' ? argv.start : undefined),
      endPhase: inputManifest?.end_phase ?? (typeof argv.end === 'string' ? argv.end : undefined),
      requestedPhases: inputDefinition?.requestedPhases,
      requestedResults: inputDefinition?.requestedResults,
      userDeadlineAt: inputManifest?.user_deadline_at ?? (typeof argv['user-deadline-at'] === 'string' ? argv['user-deadline-at'] : undefined),
      forceFresh: Boolean(argv.force),
      supersede: (Array.isArray(argv.supersede) ? argv.supersede : argv.supersede ? [argv.supersede] : []).map(String),
      autonomyAuthorized: Boolean(argv['authorize-autonomy']),
    });
    console.log(JSON.stringify({
      type: 'goal_run_prepared',
      run_id: prepared.manifest.run_id,
      manifest: prepared.manifestPath,
      run_dir: prepared.runDir,
      // plan 4e6fb3b6 §7：fresh = 新出生；rejoin = 同一任务的未终局 run，附着它继续（条件是否解除由原检查判断）
      continuation: prepared.continuation.kind,
      next: 'rerun with --next and this run id; re-pass any still-valid explicit launch authorization',
    }));
    return;
  }
  if (prepareScope) {
    // D0.2：候选由机器生成——主 Agent 只提供四项输入（完成终点、请求结果、明确的请求
    // 动作、影响判断及其来源路径）。绑定、指纹、unit/device/visual 派生、code-review 补齐
    // 全部由既有生产函数完成，CLI 只做入参解析与投影打印，不做任何推断。
    const list = (value: unknown): string[] =>
      (Array.isArray(value) ? value : value === undefined ? [] : [value])
        .map(item => String(item).trim()).filter(Boolean);
    const completionTarget = String(argv['completion-target'] ?? '').trim();
    if (completionTarget !== 'request' && completionTarget !== 'feature') {
      throw new Error('--completion-target 必须是 request 或 feature');
    }
    const requestedPhases = list(argv['requested-phases']).flatMap(value => value.split(',')).map(item => item.trim()).filter(Boolean);
    if (!requestedPhases.length) {
      // 不猜动作：机器只把**既有阶段证据检查**的事实摆出来，判断权留给显式请求。
      console.error(completionTarget === 'request'
        ? 'request 终点必须显式给出 --requested-phases（用户点名跑哪个阶段，猜测即越权）'
        : '请求动作须由 --requested-phases 显式给出（改代码 → 含 coding；只补验证 → 只列验证阶段）');
      console.error(JSON.stringify({ type: 'phase_evidence_health', feature, phases: featureScopePhaseHealth(projectRoot, frameworkRoot, feature) }, null, 2));
      process.exitCode = 1;
      return;
    }
    const impactBasis = list(argv['impact-basis']);
    const source = resolveRequirementInput({ requirement: argv.requirement, requirementFile: argv['requirement-file'], projectRoot });
    const next = designDeliveryNextStep({ projectRoot, frameworkRoot, feature, completionTarget, requestedPhases, requirement: source.text, requirementSourceFiles: source.sources });
    if (next) {
      console.log(JSON.stringify(next, null, 2));
      return;
    }
    const impactReason = String(argv['impact-reason'] ?? '').trim();
    // `--impact-behavior-change` 裸传（无值）时 minimist 给空字符串——那是**传了但没给值**，
    // 不是没传。用 hasOwnProperty 区分，传了空值一律拒绝，不当成「未提供」静默放过。
    const impactFlagGiven = Object.prototype.hasOwnProperty.call(argv, 'impact-behavior-change');
    const impactFlag = String(argv['impact-behavior-change'] ?? '').trim().toLowerCase();
    if (impactFlagGiven && impactFlag !== 'true' && impactFlag !== 'false') throw new Error('--impact-behavior-change 必须是 true 或 false');
    // 影响判断是一项完整输入：三件缺一不可。只给来源或只给理由 = 判断没给全，
    // 静默忽略会让候选悄悄退回「无影响判断」（device 义务保持 unknown）而用户以为给过了。
    if (impactFlag && !impactBasis.length) throw new Error('--impact-behavior-change 必须配 --impact-basis（影响判断必须有可核验来源）');
    if (impactFlag && !impactReason) throw new Error('--impact-behavior-change 必须配 --impact-reason（判断要说明依据）');
    if (!impactFlag && (impactBasis.length || impactReason)) {
      throw new Error('--impact-basis / --impact-reason 必须与 --impact-behavior-change 一起给出（不接受半份影响判断）');
    }
    const prepared = prepareFeatureScopeCandidate({
      projectRoot, frameworkRoot, feature,
      completionTarget,
      requestedResults: list(argv['requested-results']),
      requestedPhases,
      // 与 --prepare-run 同一份需求文本（视觉相关性由它判定）；两处不同源会让候选与出生结论分叉。
      ...(() => {
        const resolved = resolveRequirementInput({ requirement: argv.requirement, requirementFile: argv['requirement-file'], projectRoot });
        return resolved.text ? { requirement: resolved.text, ...(resolved.sources.length ? { requirementSourceFiles: resolved.sources } : {}) } : {};
      })(),
      ...(impactFlag
        ? { impact: { userVisibleBehaviorChange: impactFlag === 'true', reason: impactReason, basisPaths: impactBasis } }
        : {}),
      overwrite: Boolean(argv.overwrite),
    });
    const knowledgeContracts = prepared.scope.obligations.flatMap(obligation => obligation.basis).find(binding => binding.input_id === 'contracts');
    let contracts: import('./utils/types').ContractsSpec | undefined;
    let knowledgeBindingError: string | undefined;
    try {
      if (knowledgeContracts) contracts = readBoundInput({ projectRoot, frameworkRoot, feature, phase: 'plan', track: 'full' }, knowledgeContracts) as import('./utils/types').ContractsSpec;
    } catch (error) {
      knowledgeBindingError = `知识装配的契约绑定读取失败：${(error as Error).message}；候选${prepared.written ? '已写入' : '未改写'}，本次准备未通过。修正来源后重新运行 --prepare-scope；以下仅提供无契约的知识索引。`;
      console.error(knowledgeBindingError);
      process.exitCode = 1;
    }
    const requirement = resolveRequirementInput({ requirement: argv.requirement, requirementFile: argv['requirement-file'], projectRoot }).text;
    const knowledge = prepared.scope.phase_chain.map(phase => {
      const view = assembleKnowledge({ projectRoot, frameworkRoot, phase, subject: 'feature', role: 'author',
        requirement, contracts });
      if (knowledgeBindingError) view.notices.unshift(knowledgeBindingError);
      return { phase, ...view, instructions: renderKnowledge(view) };
    });
    console.log(JSON.stringify({
      type: 'scope_candidate_prepared',
      knowledge,
      state: prepared.state,
      written: prepared.written,
      candidate: path.relative(projectRoot, prepared.path).replace(/\\/g, '/'),
      phase_chain: prepared.scope.phase_chain,
      obligations: prepared.scope.obligations.map(obligation => ({ id: obligation.id, applicability: obligation.applicability, reason: obligation.reason })),
      unresolved: prepared.scope.unresolved,
      explanation: knowledgeBindingError ? prepared.explanation + '\n' + knowledgeBindingError : prepared.explanation,
    }, null, 2));
    if (prepared.state === 'differs') {
      console.error('候选已存在且与本次生成不一致——不静默覆盖。差异字段：');
      const onDisk = (YAML.parse(fs.readFileSync(prepared.path, 'utf-8')) as { execution_scope?: unknown } | null)?.execution_scope;
      for (const line of describeCandidateDifference(onDisk, prepared.candidate)) console.error(`  · ${line}`);
      console.error('核对上面的投影与差异后用 --overwrite 重跑。');
      process.exitCode = 1;
    }
    return;
  }
  if (!feature || !runId || !adapter) {
    throw new Error('--feature, --run-id, and --adapter are required');
  }
  const mode = String(argv['authorization-mode'] ?? 'goal_mode');
  if (!['manual', 'batch_authorized', 'goal_mode'].includes(mode)) {
    throw new Error(`authorization mode 非法：${mode}`);
  }
  const actions = [argv['execute-request'] ? 'execute' : '', argv.observe ? 'observe' : '', argv.interrupt ? 'interrupt' : ''].filter(Boolean);
  if (actions.length > 1 || actions.length && (argv.next || argv['report-result'])) throw new Error('choose one execution control action');
  if (!actions.length && Boolean(argv.next) === (typeof argv['report-result'] === 'string')) throw new Error('choose exactly one of --next or --report-result <JSON>');
  if (argv['report-result'] && !argv.request) throw new Error('--report-result requires --request');
  let report: SessionExecutionReport | undefined;
  if (typeof argv['report-result'] === 'string') {
    const selected = loadGoalRunManifestFromRun(projectRoot, runId, { feature, featuresDir: relFeaturesDir(projectRoot) });
    const bound = isInitialDesignManifest(selected) ? resolveOriginalDeliveryRequest(projectRoot, selected, path.resolve(String(argv.request))) : null;
    const reportRunDir = bound?.request.context.runDir ?? path.resolve(projectRoot, selected.report_dir);
    const issued = bound ?? readSessionExecution(reportRunDir, path.resolve(String(argv.request)));
    if (!issued) throw new Error('[session-handoff] report has no signed request');
    report = parseSessionReportResult(argv['report-result'], reportRunDir, sessionReportInputPath(reportRunDir, issued));
  }
  const result = await runGoalModeSessionStep({ projectRoot, frameworkRoot, feature, runId, adapter, runMode,
    ...(actions[0] ? { action: actions[0] as 'execute' | 'observe' | 'interrupt' } : {}),
    forceTakeover: Boolean(argv['force-takeover']), overrideManifest: Boolean(argv['override-manifest']),
    authorization: { mode: mode as 'manual' | 'batch_authorized' | 'goal_mode', autonomyAuthorized: Boolean(argv['authorize-autonomy']),
      ...(argv['through-phase'] ? { through_phase: String(argv['through-phase']) } : {}) },
    ...(argv.request ? { requestPath: path.resolve(String(argv.request)) } : {}), ...(report ? { report } : {}),
  });
  console.log(JSON.stringify(result));
  if (typeof result.exit_code === 'number') process.exitCode = result.exit_code;

}

if (require.main === module) {
  void main().catch((error) => {
    if (error instanceof DesignDeliveryPreparationRequired) {
      console.log(JSON.stringify(error.result, null, 2));
      return;
    }
    console.error(`[goal-mode-entry] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
