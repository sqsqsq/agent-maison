import { createHash } from 'crypto';
import type { GoalManifest } from './goal-manifest';
import type { WorkflowSpec } from '../../workflow-loader';
import type {
  AssessAuthorizationContext,
  AssessRecommendation,
  AssessResult,
} from './assess';
import { assessFeature, type ReconcileObservationV1 } from './assess';
import {
  loadGoalCapability,
  routeGoalCapability,
  type GoalRunMode,
} from './goal-adapter-capability';
import {
  assertFencedOwner,
  quiesceRunOwner,
  releaseRunOwner,
  renewSessionLease,
  type RunFenceToken,
} from './goal-run-control';
import {
  appendGoalEventFenced,
  readInSessionLoopState,
  writeInSessionProgressFenced,
  writeInSessionLoopStateFenced,
  writeGoalManifestFenced,
} from './goal-in-session-evidence';
import {
  acceptConsumedHandoff,
  consumeHandoffAtBoundary,
  type HandoffMailboxQuarantine,
  readHandoffRequest,
  writeHandoffRequest,
} from './goal-handoff';
import { isPhaseWithinBatchRange } from './phase-transition-policy';
import { deriveReconcileObservation } from './goal-reconcile-observation';
import { loadFeatureTrackDecl } from './feature-track';
import { resolveFeatureTrack } from './runtime-policy';
import { writeReceiptScaffold } from './receipt-scaffold';
import {
  AttendedGoalPhaseExecutor,
  createPhaseExecutionContext,
  validatePhaseExecutionContext,
  type GoalPhaseExecutor,
  type GoalPhaseExecutorResult,
  type PhaseExecutionContext,
} from './goal-phase-executor';

export interface InSessionPhaseOutcome {
  status: 'passed' | 'failed' | 'waiting';
  phase: string;
  details?: string;
}

export interface InSessionRoundResult {
  status: 'executed' | 'waiting' | 'reconciled' | 'fused' | 'manual_fallback';
  assessment: AssessResult | null;
  outcome?: InSessionPhaseOutcome;
  waiting_item?: string;
  status_line: string;
}

export interface InSessionRoundOptions {
  projectRoot: string;
  frameworkRoot: string;
  runDir: string;
  token: RunFenceToken;
  manifest: GoalManifest;
  workflow: WorkflowSpec;
  adapter: string;
  mode: GoalRunMode;
  round: number;
  authorization: AssessAuthorizationContext;
  leaseMs?: number;
  reconcile?: ReconcileObservationV1;
  executePhase: (
    phase: string,
    recommendation: AssessRecommendation,
    context: InSessionPhaseRequestContext,
  ) => Promise<InSessionPhaseOutcome>;
}

export interface InSessionPhaseRequestContext {
  runId: string;
  phase: string;
  attemptId: string;
  ownerId: string;
  ownerEpoch: number;
}

function appendHandoffMailboxQuarantined(
  options: Pick<InSessionRoundOptions, 'projectRoot' | 'manifest' | 'runDir' | 'token'>,
  notice: HandoffMailboxQuarantine,
): void {
  appendGoalEventFenced(options.projectRoot, options.manifest, options.runDir, options.token, {
    type: 'handoff_mailbox_quarantined',
    original_file: notice.original_file,
    quarantined_file: notice.quarantined_file,
    reason: notice.reason,
  });
}

export function resolveGoalRunModeIntent(
  text: string,
  detach = false,
): GoalRunMode | null {
  if (detach) return 'unattended';
  if (/无人值守|我离开|我走了|后台继续|不用等我/.test(text)) return 'unattended';
  if (/有人在场|遇到问题.*问我|需要.*停下来|我会看着/.test(text)) return 'attended';
  return null;
}

export function userFacingRunMode(mode: GoalRunMode): '有人在场' | '无人值守' {
  return mode === 'attended' ? '有人在场' : '无人值守';
}

export function formatGoalRoundStatus(input: {
  feature: string;
  phase: string | null;
  round: number;
  mode: GoalRunMode;
  waiting?: string | null;
}): string {
  return [
    `feature=${input.feature}`,
    `phase=${input.phase ?? 'none'}`,
    `round=${input.round}`,
    `运行方式=${userFacingRunMode(input.mode)}`,
    `等待=${input.waiting || '无'}`,
  ].join(' | ');
}

export function recommendationAuthorized(
  recommendation: AssessRecommendation,
  authorization: AssessAuthorizationContext,
  chain: string[],
  opts?: {
    /** batch 授权区间**下界**（plan b6e4c9f2 t3，codex 三轮）：用户授权起点
     *  （manifest.start_phase）。回退型推荐（backtrack_to_phase）目标须落在
     *  [start_phase, through_phase] 才自动执行；区间外返回 false → 转 manual 确认。 */
    startPhase?: string;
  },
): boolean {
  if (recommendation.action === 'stop') return false;
  if (authorization.mode === 'goal_mode') return true;
  if (authorization.mode === 'manual') return false;
  if (!recommendation.phase || !authorization.through_phase) return false;
  const targetIndex = chain.indexOf(recommendation.phase);
  const throughIndex = chain.indexOf(authorization.through_phase);
  if (targetIndex < 0 || throughIndex < 0 || targetIndex > throughIndex) return false;
  if (recommendation.runner_action === 'backtrack_to_phase') {
    // 回退型：按显式授权区间判定（custom/lite 用实际 chain 顺序，不用固定全轨序）。
    // 缺 startPhase（旧调用方/无起点记录）按 fail-closed 处理——不自动回退。
    if (!opts?.startPhase) return false;
    const startIndex = chain.indexOf(opts.startPhase);
    if (startIndex < 0) return false;
    return targetIndex >= startIndex;
  }
  const fromPhase = targetIndex > 0 ? chain[targetIndex - 1] : chain[targetIndex];
  return recommendation.phase === fromPhase ||
    isPhaseWithinBatchRange(fromPhase, recommendation.phase, authorization.through_phase);
}

function isHumanOnly(recommendation: AssessRecommendation): boolean {
  return recommendation.action === 'resolve_deferred' ||
    /human|确认|授权|设备|外部/.test(recommendation.reason);
}

function reconcileObservationForOutcome(
  options: InSessionRoundOptions,
  phase: string,
  outcome: InSessionPhaseOutcome,
): ReconcileObservationV1 {
  const priorRetries = options.reconcile?.budgets?.retries_used ?? 0;
  return deriveReconcileObservation({
    phase,
    verdict: outcome.status === 'passed' ? 'PASS' : outcome.status === 'failed' ? 'FAIL' : 'INCOMPLETE',
    legacyAction: outcome.status === 'passed' ? 'advance' : outcome.status === 'failed' ? 'retry' : 'halt',
    dependencyPolicy: options.manifest.dependency_policy,
    retriesUsed: outcome.status === 'failed' ? priorRetries + 1 : 0,
    maxRetriesPerPhase: options.manifest.budget.max_retries_per_phase,
    backtracksUsed: options.reconcile?.budgets?.backtracks_used ?? 0,
    repeatedCount: options.reconcile?.repeated_round?.count ?? 0,
    invalidatablePhases: options.reconcile?.invalidatable_phases ?? [],
    fused: false,
  });
}

async function runRuntimeRound(
  options: InSessionRoundOptions,
  runtime: GoalPhaseRuntime,
): Promise<InSessionRoundResult> {
  const attemptId = `session-e${options.token.epoch}-round-${options.round}`;
  const capability = loadGoalCapability(options.frameworkRoot, options.adapter);
  const route = routeGoalCapability(capability, options.mode, {
    unattendedPreflightOk: options.mode === 'attended',
  });
  if (route.kind !== 'in_session') {
    const waiting = route.kind === 'manual'
      ? '当前宿主不支持隔离执行；请按手动 harness+assess 继续'
      : route.reason;
    return {
      status: 'manual_fallback',
      assessment: null,
      waiting_item: waiting,
      status_line: formatGoalRoundStatus({
        feature: options.manifest.feature,
        phase: null,
        round: options.round,
        mode: options.mode,
        waiting,
      }),
    };
  }

  renewSessionLease(options.runDir, options.token, options.leaseMs ?? 60_000);
  assertFencedOwner(options.runDir, options.token, 'assess');
  const handoffRequest = readHandoffRequest(options.runDir, {
    on_quarantined: (notice) => appendHandoffMailboxQuarantined(options, notice),
  });
  const acceptedHandoff = acceptConsumedHandoff(options.runDir, options.token, 'session');
  if (acceptedHandoff) {
    appendGoalEventFenced(options.projectRoot, options.manifest, options.runDir, options.token, {
      type: 'handoff_accepted',
      request_id: acceptedHandoff.request_id,
      from_epoch: acceptedHandoff.from_epoch,
      epoch: options.token.epoch,
      owner_kind: 'session',
    });
  }
  if (handoffRequest?.status === 'consumed') {
    const acceptanceValid = acceptedHandoff?.target_owner_kind === 'session' &&
      acceptedHandoff.accepted_epoch === options.token.epoch &&
      acceptedHandoff.from_epoch + 1 === options.token.epoch;
    if (!acceptanceValid) {
      const waiting = 'handoff 已消费但当前 session owner 未完成目标/epoch/accepted 校验；保持静默等待';
      return {
        status: 'waiting', assessment: null, waiting_item: waiting,
        status_line: formatGoalRoundStatus({
          feature: options.manifest.feature, phase: null, round: options.round, mode: options.mode, waiting,
        }),
      };
    }
  }
  writeGoalManifestFenced(options.projectRoot, options.manifest, options.runDir, options.token);
  const assessment = assessFeature({
    projectRoot: options.projectRoot,
    frameworkRoot: options.frameworkRoot,
    feature: options.manifest.feature,
    goalEnd: options.manifest.end_phase,
    minimumAssurance: options.manifest.minimum_assurance,
    authorization: options.authorization,
    reconcile: options.reconcile,
    runId: options.manifest.run_id,
    attemptId,
  });
  const recommendation = assessment.recommendation;
  const phase = recommendation.phase;
  if (assessment.stop.fused) {
    return {
      status: 'fused',
      assessment,
      waiting_item: assessment.stop.reason ?? '调和循环已熔断',
      status_line: formatGoalRoundStatus({
        feature: options.manifest.feature, phase, round: options.round, mode: options.mode,
        waiting: assessment.stop.reason,
      }),
    };
  }
  if (assessment.run_status_candidate === 'CHAIN_SLICE_COMPLETED') {
    return {
      status: 'reconciled',
      assessment,
      waiting_item: '等待 verify-feature-completion 最终验证',
      status_line: formatGoalRoundStatus({
        feature: options.manifest.feature, phase, round: options.round, mode: options.mode,
        waiting: '最终验证',
      }),
    };
  }
  const chain = assessment.observed.phases.map((item) => item.phase);
  if (!recommendationAuthorized(recommendation, options.authorization, chain, {
    startPhase: options.manifest.start_phase ? String(options.manifest.start_phase) : undefined,
  })) {
    const waiting = `推荐 ${recommendation.action}/${phase ?? 'none'} 尚未获授权`;
    return {
      status: 'waiting', assessment, waiting_item: waiting,
      status_line: formatGoalRoundStatus({
        feature: options.manifest.feature, phase, round: options.round, mode: options.mode, waiting,
      }),
    };
  }
  if (isHumanOnly(recommendation)) {
    const waiting = recommendation.reason;
    return {
      status: 'waiting', assessment, waiting_item: waiting,
      status_line: formatGoalRoundStatus({
        feature: options.manifest.feature, phase, round: options.round, mode: options.mode, waiting,
      }),
    };
  }
  if (!phase) throw new Error('[goal-in-session] authorized recommendation missing phase');

  assertFencedOwner(options.runDir, options.token, 'phase_invoke');
  appendGoalEventFenced(options.projectRoot, options.manifest, options.runDir, options.token, {
    type: 'phase_start',
    phase,
    attempt_id: attemptId,
    owner_id: options.token.owner_id,
    owner_epoch: options.token.epoch,
    driver: 'session',
    round: options.round,
  });
  const leaseMs = options.leaseMs ?? 60_000;
  let leaseError: Error | null = null;
  const leaseHeartbeat = setInterval(() => {
    try { renewSessionLease(options.runDir, options.token, leaseMs); }
    catch (error) { leaseError = error as Error; }
  }, Math.max(250, Math.trunc(leaseMs / 3)));
  let outcome: InSessionPhaseOutcome;
  try {
    if (resolveFeatureTrack(loadFeatureTrackDecl(options.projectRoot, options.manifest.feature)) !== 'lite') {
      const scaffold = writeReceiptScaffold(options.projectRoot, options.manifest.feature, phase, {
        attemptId,
        force: true,
      });
      if (!scaffold.wrote) {
        throw new Error(scaffold.failure ?? '[goal-in-session] receipt 骨架未写入');
      }
    }
    const track = resolveFeatureTrack(loadFeatureTrackDecl(options.projectRoot, options.manifest.feature));
    const executionContext = createPhaseExecutionContext({
      runId: options.manifest.run_id,
      feature: options.manifest.feature,
      workflowId: options.workflow.name,
      track,
      chain,
      phase,
      attemptId,
      owner: { ...options.token, kind: 'session' },
      projectRoot: options.projectRoot,
      frameworkRoot: options.frameworkRoot,
      runDir: options.runDir,
      reportDir: options.manifest.report_dir,
      adapter: options.adapter,
      adapterModel: options.manifest.adapter_model_pin?.value,
      runtimeFacts: {
        runBaseSha: options.manifest.run_base_sha,
        receiptRequired: track !== 'lite',
        resume: options.round > 1,
        successor: typeof options.manifest.successor_of === 'string',
      },
      childEnv: {
        MAISON_GOAL_RUN_ID: options.manifest.run_id,
        MAISON_GOAL_ATTEMPT: attemptId,
        MAISON_GOAL_ATTEMPT_PHASE: phase,
      },
    });
    const executor = new AttendedGoalPhaseExecutor(async (context) =>
      options.executePhase(context.phase, recommendation, {
        runId: context.runId,
        phase: context.phase,
        attemptId: context.attemptId,
        ownerId: context.owner.owner_id,
        ownerEpoch: context.owner.epoch,
      }));
    const execution = await runtime.executeExecutor(executionContext, executor);
    outcome = {
      status: execution.status,
      phase: execution.phase,
      details: execution.details,
    };
    if (leaseError) throw leaseError;
  } catch (error) {
    clearInterval(leaseHeartbeat);
    const details = (error as Error).message;
    try {
      assertFencedOwner(options.runDir, options.token, 'phase_exception');
      appendGoalEventFenced(options.projectRoot, options.manifest, options.runDir, options.token, {
        type: 'phase_halt', phase, halt_reason: 'in_session_phase_exception', details,
        driver: 'session', round: options.round,
      });
      releaseRunOwner(options.runDir, options.token);
    } catch {
      // A newer epoch is authoritative; never write through a stale session.
    }
    const failed: InSessionPhaseOutcome = { status: 'failed', phase, details };
    return {
      status: 'waiting', assessment, outcome: failed,
      waiting_item: `phase executor 异常：${details}`,
      status_line: formatGoalRoundStatus({
        feature: options.manifest.feature, phase, round: options.round, mode: options.mode,
        waiting: 'phase executor 异常，owner 已释放',
      }),
    };
  } finally {
    clearInterval(leaseHeartbeat);
  }
  renewSessionLease(options.runDir, options.token, leaseMs);
  assertFencedOwner(options.runDir, options.token, 'phase_outcome');
  appendGoalEventFenced(options.projectRoot, options.manifest, options.runDir, options.token, {
    type: 'phase_verdict',
    phase,
    verdict: outcome.status === 'passed' ? 'PASS' : outcome.status === 'failed' ? 'FAIL' : 'INCOMPLETE',
    action: outcome.status === 'passed' ? 'advance' : outcome.status === 'failed' ? 'retry' : 'halt',
    driver: 'session',
    details: outcome.details,
  });
  writeInSessionProgressFenced(
    options.projectRoot, options.manifest, options.workflow, options.runDir, options.token,
  );
  assertFencedOwner(options.runDir, options.token, 'reassess');
  const outcomeReconcile = reconcileObservationForOutcome(options, phase, outcome);
  const reassessed = assessFeature({
    projectRoot: options.projectRoot,
    frameworkRoot: options.frameworkRoot,
    feature: options.manifest.feature,
    goalEnd: options.manifest.end_phase,
    minimumAssurance: options.manifest.minimum_assurance,
    authorization: options.authorization,
    reconcile: outcomeReconcile,
    runId: options.manifest.run_id,
    attemptId: `${attemptId}-after`,
  });
  return {
    status: outcome.status === 'waiting'
      ? 'waiting'
      : reassessed.run_status_candidate === 'CHAIN_SLICE_COMPLETED'
        ? 'reconciled'
        : reassessed.stop.fused
          ? 'fused'
          : 'executed',
    assessment: reassessed,
    outcome,
    ...(outcome.status === 'waiting' ? { waiting_item: outcome.details ?? phase } : {}),
    status_line: formatGoalRoundStatus({
      feature: options.manifest.feature,
      phase,
      round: options.round,
      mode: options.mode,
      waiting: outcome.status === 'waiting' ? outcome.details : null,
    }),
  };
}

/**
 * Sole attended lifecycle owner. Host drivers provide only an executor callback and never
 * assess, allocate attempts, emit verdicts or advance phases themselves.
 */
export class GoalPhaseRuntime {
  constructor(private readonly options?: InSessionRoundOptions) {}

  /** Shared owner fence around every attended or detached executor invocation. */
  async executeExecutor(
    context: PhaseExecutionContext,
    executor: GoalPhaseExecutor,
  ): Promise<GoalPhaseExecutorResult> {
    validatePhaseExecutionContext(context);
    if (context.owner.owner_id !== 'dry-run') {
      assertFencedOwner(context.runDir, context.owner, 'runtime_pre_executor');
    }
    const result = await executor.execute(context);
    if (context.owner.owner_id !== 'dry-run') {
      assertFencedOwner(context.runDir, context.owner, 'runtime_post_executor');
    }
    return result;
  }

  runRound(): Promise<InSessionRoundResult> {
    if (!this.options) {
      throw new Error('[goal-phase-runtime] attended round options are required');
    }
    return runRuntimeRound(this.options, this);
  }
}

/** Compatibility entry point; all behavior delegates to GoalPhaseRuntime. */
export function runInSessionRound(
  options: InSessionRoundOptions,
): Promise<InSessionRoundResult> {
  return new GoalPhaseRuntime(options).runRound();
}

export interface GoalModeInSessionOptions extends Omit<InSessionRoundOptions, 'round' | 'reconcile'> {
  maxRounds?: number;
  onRound?: (result: InSessionRoundResult) => void;
}

export function releaseAttendedRuntimeOwnerBestEffort(options: GoalModeInSessionOptions): void {
  try {
    assertFencedOwner(options.runDir, options.token, 'session_runtime_release');
    releaseRunOwner(options.runDir, options.token);
  } catch {
    // The runtime may already have released ownership, or a newer epoch is authoritative.
  }
}

export function deriveInSessionFingerprint(result: InSessionRoundResult): string {
  const content = {
    assessment: result.assessment ? {
      gaps: result.assessment.gaps,
      recommendation: result.assessment.recommendation,
      stop: result.assessment.stop,
      run_status_candidate: result.assessment.run_status_candidate,
    } : null,
    outcome: result.outcome ? {
      status: result.outcome.status,
      phase: result.outcome.phase,
      details: result.outcome.details ?? null,
    } : null,
  };
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function fusedRuntimeResult(
  options: GoalModeInSessionOptions,
  last: InSessionRoundResult,
  reason: string,
): InSessionRoundResult {
  try {
    appendGoalEventFenced(options.projectRoot, options.manifest, options.runDir, options.token, {
      type: 'phase_halt',
      phase: last.outcome?.phase ?? last.assessment?.recommendation.phase ?? null,
      halt_reason: 'in_session_reconcile_fused',
      details: reason,
      driver: 'session',
    });
  } finally {
    releaseAttendedRuntimeOwnerBestEffort(options);
  }
  return {
    ...last,
    status: 'fused',
    waiting_item: reason,
    status_line: `${last.status_line} | 等待=${reason}`,
  };
}

/** Sole attended progression loop. The host entry owns transport and delegates lifecycle here. */
export async function runAttendedGoalPhaseRuntime(
  options: GoalModeInSessionOptions,
): Promise<InSessionRoundResult> {
  const configuredRounds = Math.max(1, Math.trunc(options.maxRounds ?? 50));
  const maxTurns = Math.max(1, Math.min(configuredRounds, options.manifest.budget.max_total_turns));
  const persisted = readInSessionLoopState(options.runDir);
  const state = persisted ?? {
    schema_version: '1.0' as const,
    started_at_ms: Date.now(),
    total_rounds: 0,
    retries_by_phase: {},
    last_fingerprint: null,
    repeated_count: 0,
    last_phase: null,
    last_status: null,
    last_details: null,
    fuse_reason: null,
    reconcile: null,
  };
  let activeElapsedMs = Math.max(0, state.active_elapsed_ms ?? 0);
  let activeSegmentStartedAtMs = Date.now();
  const wallClockMs = Math.max(1, options.manifest.budget.wall_clock_minutes) * 60_000;
  const activeElapsedNow = (): number =>
    activeElapsedMs + Math.max(0, Date.now() - activeSegmentStartedAtMs);
  const settleActiveTime = (): void => {
    const now = Date.now();
    activeElapsedMs += Math.max(0, now - activeSegmentStartedAtMs);
    activeSegmentStartedAtMs = now;
    state.active_elapsed_ms = activeElapsedMs;
  };
  const retriesByPhase = new Map(Object.entries(state.retries_by_phase));
  let lastFingerprint: string | null = state.last_fingerprint;
  let repeatedCount = state.repeated_count;
  let reconcile: ReconcileObservationV1 | undefined =
    state.reconcile as ReconcileObservationV1 | null ?? undefined;
  let last: InSessionRoundResult | null = null;
  if (state.fuse_reason || state.total_rounds >= maxTurns || activeElapsedNow() >= wallClockMs) {
    const synthetic: InSessionRoundResult = {
      status: 'executed', assessment: null,
      outcome: state.last_phase ? {
        status: state.last_status === 'passed' ? 'passed' : 'failed',
        phase: state.last_phase, details: state.last_details ?? undefined,
      } : undefined,
      status_line: '会话账本已记录终止预算',
    };
    return fusedRuntimeResult(
      options,
      synthetic,
      state.fuse_reason ?? (activeElapsedNow() >= wallClockMs
        ? '会话内 wall-clock 预算已耗尽'
        : '达到会话内执行预算 ' + maxTurns + ' 轮；本 run 终止，可由 successor run 继续'),
    );
  }

  for (let round = state.total_rounds + 1; round <= maxTurns; round += 1) {
    if (activeElapsedNow() >= wallClockMs && last) {
      state.fuse_reason = '会话内 wall-clock 预算已耗尽';
      writeInSessionLoopStateFenced(options.runDir, options.token, state);
      return fusedRuntimeResult(options, last, state.fuse_reason);
    }
    const result = await new GoalPhaseRuntime({ ...options, round, reconcile }).runRound();
    options.onRound?.(result);
    last = result;
    if (result.status !== 'executed') {
      settleActiveTime();
      writeInSessionLoopStateFenced(options.runDir, options.token, state);
      releaseAttendedRuntimeOwnerBestEffort(options);
      return result;
    }

    const phase = result.outcome?.phase ?? result.assessment?.recommendation.phase ?? '';
    const fingerprint = deriveInSessionFingerprint(result);
    repeatedCount = fingerprint && fingerprint === lastFingerprint ? repeatedCount + 1 : 0;
    lastFingerprint = fingerprint || null;
    const failed = result.outcome?.status === 'failed';
    const retriesUsed = failed ? (retriesByPhase.get(phase) ?? 0) + 1 : 0;
    if (failed) retriesByPhase.set(phase, retriesUsed);
    else retriesByPhase.delete(phase);
    const exhausted = failed && retriesUsed >= options.manifest.budget.max_retries_per_phase;
    const noProgress = repeatedCount >= options.manifest.budget.max_retries_per_phase;
    const reason = exhausted
      ? `phase ${phase} retry budget exhausted`
      : noProgress
        ? `phase ${phase} repeated fingerprint without progress`
        : undefined;
    reconcile = deriveReconcileObservation({
      phase,
      verdict: result.outcome?.status === 'passed' ? 'PASS' : failed ? 'FAIL' : 'INCOMPLETE',
      legacyAction: result.outcome?.status === 'passed' ? 'advance' : failed ? 'retry' : 'halt',
      retriesUsed,
      maxRetriesPerPhase: options.manifest.budget.max_retries_per_phase,
      backtracksUsed: 0,
      repeatedCount,
      residualFingerprints: fingerprint ? [fingerprint] : [],
      fused: exhausted || noProgress,
      fuseReason: reason,
    });
    state.total_rounds = round;
    state.retries_by_phase = Object.fromEntries(retriesByPhase);
    state.last_fingerprint = lastFingerprint;
    state.repeated_count = repeatedCount;
    state.last_phase = phase || null;
    state.last_status = result.outcome?.status ?? null;
    state.last_details = result.outcome?.details ?? null;
    state.reconcile = reconcile ?? null;
    state.fuse_reason = reason ?? null;
    writeInSessionLoopStateFenced(options.runDir, options.token, state);
    if (reason) return fusedRuntimeResult(options, result, reason);
  }

  if (!last) throw new Error('[goal-phase-runtime] no reconciliation round executed');
  state.fuse_reason = '达到会话内执行预算 ' + maxTurns + ' 轮；本 run 终止，可由 successor run 继续';
  writeInSessionLoopStateFenced(options.runDir, options.token, state);
  return fusedRuntimeResult(options, last, state.fuse_reason);
}

export function handoffSessionToDetached(
  options: Omit<InSessionRoundOptions, 'executePhase' | 'round'>,
): string {
  assertFencedOwner(options.runDir, options.token, 'handoff_request');
  const request = writeHandoffRequest(options.runDir, {
    run_id: options.token.run_id,
    from_epoch: options.token.epoch,
    target_owner_kind: 'process',
    on_quarantined: (notice) => appendHandoffMailboxQuarantined(options, notice),
  });
  const consumed = consumeHandoffAtBoundary(options.runDir, options.token, Date.now(), {
    on_quarantined: (notice) => appendHandoffMailboxQuarantined(options, notice),
  });
  if (consumed.kind !== 'consumed') throw new Error('[goal-in-session] handoff consume failed');
  appendGoalEventFenced(options.projectRoot, options.manifest, options.runDir, options.token, {
    type: 'handoff_requested',
    request_id: request.request_id,
    target_owner_kind: 'process',
    from_epoch: options.token.epoch,
  });
  writeInSessionProgressFenced(
    options.projectRoot, options.manifest, options.workflow, options.runDir, options.token,
  );
  quiesceRunOwner(options.runDir, options.token);
  releaseRunOwner(options.runDir, options.token, { allowQuiescing: true });
  return request.request_id;
}
