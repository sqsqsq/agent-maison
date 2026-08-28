import { createHash } from 'crypto';
import type { GoalManifest } from './goal-manifest';
import type { WorkflowSpec } from '../../workflow-loader';
import type {
  AssessAuthorizationContext,
  AssessRecommendation,
  AssessResult,
} from './assess';
import type { GoalRunMode } from './goal-adapter-capability';
import {
  assertFencedOwner,
  releaseRunOwner,
  type RunFenceToken,
} from './goal-run-control';
import { writeHandoffRequest } from './goal-handoff';
import { recommendationAuthorized } from './phase-transition-policy';

export { recommendationAuthorized } from './phase-transition-policy';

export { GoalPhaseRuntime } from '../goal-phase-runtime';

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

export interface InSessionPhaseRequestContext {
  runId: string;
  phase: string;
  attemptId: string;
  ownerId: string;
  ownerEpoch: number;
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
  reconcile?: unknown;
  executePhase: (
    phase: string,
    recommendation: AssessRecommendation | Record<string, unknown>,
    context: InSessionPhaseRequestContext,
  ) => Promise<InSessionPhaseOutcome>;
}

export interface GoalModeInSessionOptions extends Omit<InSessionRoundOptions, 'round' | 'reconcile'> {
  maxRounds?: number;
  onRound?: (result: InSessionRoundResult) => void;
}

export function resolveGoalRunModeIntent(text: string, detach = false): GoalRunMode | null {
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

export function releaseAttendedRuntimeOwnerBestEffort(options: GoalModeInSessionOptions): void {
  try {
    assertFencedOwner(options.runDir, options.token, 'session_runtime_release');
    releaseRunOwner(options.runDir, options.token);
  } catch {
    // Canonical runtime may already have released it, or a newer epoch is authoritative.
  }
}

/** Compatibility bridge only: progression delegates to the canonical GoalPhaseRuntime. */
export async function runAttendedGoalPhaseRuntime(
  options: GoalModeInSessionOptions,
): Promise<InSessionRoundResult> {
  const entry = await import('../goal-mode-entry');
  return entry.runGoalModeInSession(options);
}

/** Compatibility bridge only: there is no independent attended round implementation. */
export function runInSessionRound(options: InSessionRoundOptions): Promise<InSessionRoundResult> {
  return runAttendedGoalPhaseRuntime({ ...options, maxRounds: 1 });
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
  // Compatibility callers may publish intent, but only GoalPhaseRuntime consumes the mailbox,
  // emits lifecycle handoff events, quiesces the old epoch, and releases ownership.
  return request.request_id;
}
