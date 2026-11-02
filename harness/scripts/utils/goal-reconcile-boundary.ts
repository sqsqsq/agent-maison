export type GoalReconcileEvent = Record<string, unknown>;

export interface GoalReconcileBoundary {
  emit(event: GoalReconcileEvent): void;
  emitPhaseVerdict(event: GoalReconcileEvent): void;
}

/**
 * Dedicated goal reconciliation boundary. The runner supplies process facts and
 * actual current result. This writer publishes facts and never chooses an author
 * or infers business completion from a phase verdict.
 */
export function createGoalReconcileBoundary(
  eventWriter: (event: GoalReconcileEvent) => void,
): GoalReconcileBoundary {
  return {
    emit: eventWriter,
    emitPhaseVerdict(event): void {
      eventWriter({ type: 'phase_verdict', ...event });
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
  if (/\b(?:decideAndEmit|selectRunnerActionFromAssess)\s*\(/.test(source)) {
    errors.push('the retired phase action selector must not return');
  }
  return errors;
}
