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
  writeInSessionProgressFenced,
  writeGoalManifestFenced,
} from './goal-in-session-evidence';
import {
  acceptConsumedHandoff,
  consumeHandoffAtBoundary,
  readHandoffRequest,
  writeHandoffRequest,
} from './goal-handoff';
import { isPhaseWithinBatchRange } from './phase-transition-policy';
import { deriveReconcileObservation } from './goal-reconcile-observation';

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
  executePhase: (phase: string, recommendation: AssessRecommendation) => Promise<InSessionPhaseOutcome>;
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
): boolean {
  if (recommendation.action === 'stop') return false;
  if (authorization.mode === 'goal_mode') return true;
  if (authorization.mode === 'manual') return false;
  if (!recommendation.phase || !authorization.through_phase) return false;
  const targetIndex = chain.indexOf(recommendation.phase);
  const throughIndex = chain.indexOf(authorization.through_phase);
  if (targetIndex < 0 || throughIndex < 0 || targetIndex > throughIndex) return false;
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

export async function runInSessionRound(
  options: InSessionRoundOptions,
): Promise<InSessionRoundResult> {
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
  const handoffRequest = readHandoffRequest(options.runDir);
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
    minimumDepthByPhase: options.manifest.minimum_depth_by_phase,
    authorization: options.authorization,
    reconcile: options.reconcile,
    runId: options.manifest.run_id,
    attemptId: `session-round-${options.round}`,
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
  if (!recommendationAuthorized(recommendation, options.authorization, chain)) {
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
    outcome = await options.executePhase(phase, recommendation);
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
    minimumDepthByPhase: options.manifest.minimum_depth_by_phase,
    authorization: options.authorization,
    reconcile: outcomeReconcile,
    runId: options.manifest.run_id,
    attemptId: `session-round-${options.round}-after`,
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

export function handoffSessionToDetached(
  options: Omit<InSessionRoundOptions, 'executePhase' | 'round'>,
): string {
  assertFencedOwner(options.runDir, options.token, 'handoff_request');
  const request = writeHandoffRequest(options.runDir, {
    run_id: options.token.run_id,
    from_epoch: options.token.epoch,
    target_owner_kind: 'process',
  });
  const consumed = consumeHandoffAtBoundary(options.runDir, options.token);
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
