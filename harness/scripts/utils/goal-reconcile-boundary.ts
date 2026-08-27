import type { AssessResult, ReconcileObservationV1 } from './assess';
import {
  selectRunnerActionFromAssess,
  type DriverGuardAction,
} from './goal-assess-driver';
import type { PhaseVerdictAction } from './phase-transition-policy';

export type GoalReconcileEvent = Record<string, unknown>;

export interface GoalReconcileBoundary {
  emit(event: GoalReconcileEvent): void;
  emitPhaseVerdict(event: GoalReconcileEvent): void;
  decideAndEmit(input: {
    assessment: AssessResult;
    observation: ReconcileObservationV1;
    currentPhase: string;
    chain: string[];
    driverGuardAction: DriverGuardAction;
    verdictEvent: GoalReconcileEvent;
  }): PhaseVerdictAction;
}

/**
 * Dedicated goal reconciliation boundary. The runner supplies process facts and
 * safety-guard disposition; this module alone converts assess into an execution
 * action and publishes the authoritative verdict event.
 */
export function createGoalReconcileBoundary(
  eventWriter: (event: GoalReconcileEvent) => void,
): GoalReconcileBoundary {
  return {
    emit: eventWriter,
    emitPhaseVerdict(event): void {
      eventWriter({ type: 'phase_verdict', ...event });
    },
    decideAndEmit(input): PhaseVerdictAction {
      const action = selectRunnerActionFromAssess({
        assessment: input.assessment,
        observation: input.observation,
        currentPhase: input.currentPhase,
        chain: input.chain,
        driverGuardAction: input.driverGuardAction,
      });
      const verdictEvent: GoalReconcileEvent = {
        type: 'phase_verdict',
        ...input.verdictEvent,
        action,
        reconcile_observation: input.observation,
        assess_recommendation: input.assessment.recommendation,
      };
      if (verdictEvent.verdict === 'PASS' && action === 'advance') {
        delete verdictEvent.failure_kind_classified;
      }
      eventWriter(verdictEvent);
      return action;
    },
  };
}

/** Regression guard: old verdict selection/event publication must not regrow inline. */
export function checkGoalReconcileBoundarySource(source: string): string[] {
  const errors: string[] = [];
  if (/let\s+action\s*=\s*classifyPhaseVerdict/.test(source)) {
    errors.push('goal-runner must not classify phase verdict before assess');
  }
  if (/type:\s*['"]phase_verdict['"]/.test(source)) {
    errors.push('phase_verdict event must be published by goal-reconcile-boundary');
  }
  if ((source.match(/decideAndEmit\s*\(/g) ?? []).length !== 1) {
    errors.push('goal-runner must contain exactly one assess decision/event boundary');
  }
  return errors;
}
