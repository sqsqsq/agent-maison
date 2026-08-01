import * as crypto from 'crypto';
import type { ReconcileObservationV1 } from './assess';
import type { DependencyPolicy } from './phase-transition-policy';

export interface GoalReconcileBlockerInput {
  id: string;
  blocking_class?: string;
}

export interface GoalReconcileObservationInput {
  phase: string;
  verdict: string;
  legacyAction: string;
  failureKind?: string;
  blockingClass?: string;
  propagateToDownstream?: boolean;
  dependencyPolicy?: DependencyPolicy;
  blockers?: GoalReconcileBlockerInput[];
  deterministicDefects?: string[];
  retriesUsed: number;
  maxRetriesPerPhase?: number;
  backtracksUsed: number;
  repeatedCount?: number;
  residualFingerprints?: string[];
  invalidatablePhases?: string[];
  timedOut?: boolean;
  operatorInterrupted?: boolean;
  apiDisconnected?: boolean;
  fused?: boolean;
  fuseReason?: string;
}

function actionability(blockingClass?: string): 'automatic' | 'human' | 'external' | 'unknown' {
  if (!blockingClass) return 'unknown';
  if (/external|device|environment|api/i.test(blockingClass)) return 'external';
  if (/human|confirmation|authorization|interaction/i.test(blockingClass)) return 'human';
  if (/code|test|contract|artifact|quality|review/i.test(blockingClass)) return 'automatic';
  return 'unknown';
}

function stableFingerprint(input: GoalReconcileObservationInput): string {
  const body = JSON.stringify({
    phase: input.phase,
    verdict: input.verdict,
    action: input.legacyAction,
    failure_kind: input.failureKind ?? null,
    blockers: (input.blockers ?? []).map((item) => [item.id, item.blocking_class ?? null]).sort(),
    defects: [...(input.deterministicDefects ?? [])].sort(),
  });
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Pure event/process-state boundary. It does not choose the next phase. */
export function deriveReconcileObservation(
  input: GoalReconcileObservationInput,
): ReconcileObservationV1 {
  const fingerprint = stableFingerprint(input);
  return {
    schema_version: '1.0',
    state: input.fused ? 'fused' : 'active',
    ...(input.fuseReason ? { reason: input.fuseReason } : {}),
    residual_fingerprints: input.residualFingerprints ?? [fingerprint],
    phase_outcome: {
      phase: input.phase,
      verdict: input.verdict,
      legacy_action: input.legacyAction,
      ...(input.failureKind ? { failure_kind: input.failureKind } : {}),
      ...(input.blockingClass ? { blocking_class: input.blockingClass } : {}),
      ...(input.propagateToDownstream !== undefined
        ? { propagate_to_downstream: input.propagateToDownstream }
        : {}),
      ...(input.dependencyPolicy ? { dependency_policy: input.dependencyPolicy } : {}),
    },
    blockers: (input.blockers ?? []).map((item) => ({
      id: item.id,
      actionability: actionability(item.blocking_class),
      ...(item.blocking_class ? { blocking_class: item.blocking_class } : {}),
    })),
    deterministic_defects: [...new Set(input.deterministicDefects ?? [])].sort(),
    budgets: {
      retries_used: Math.max(0, Math.trunc(input.retriesUsed)),
      ...(input.maxRetriesPerPhase !== undefined
        ? { max_retries_per_phase: Math.max(0, Math.trunc(input.maxRetriesPerPhase)) }
        : {}),
      backtracks_used: Math.max(0, Math.trunc(input.backtracksUsed)),
    },
    repeated_round: {
      fingerprint,
      count: Math.max(0, Math.trunc(input.repeatedCount ?? 0)),
    },
    invalidatable_phases: [...new Set(input.invalidatablePhases ?? [])],
    signals: {
      timed_out: input.timedOut === true,
      operator_interrupted: input.operatorInterrupted === true,
      api_disconnected: input.apiDisconnected === true,
    },
  };
}

/**
 * Historical zero-change adapter retained only for the pre-rewire boundary fixtures.
 * Production goal-runner must not import it; the static assess-driver check enforces that boundary.
 */
export function preserveLegacyAction<T extends string>(
  observation: ReconcileObservationV1,
  action: T,
): T {
  if (observation.phase_outcome?.legacy_action !== action) {
    throw new Error('[goal-reconcile] observation/action mismatch');
  }
  return action;
}
