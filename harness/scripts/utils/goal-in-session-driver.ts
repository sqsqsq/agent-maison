/**
 * Compatibility surface for existing goal-mode hosts.
 * Lifecycle ownership lives exclusively in goal-phase-runtime.ts.
 */
export {
  formatGoalRoundStatus,
  GoalPhaseRuntime,
  handoffSessionToDetached,
  recommendationAuthorized,
  resolveGoalRunModeIntent,
  runInSessionRound,
  userFacingRunMode,
} from './goal-phase-runtime';

export type {
  InSessionPhaseOutcome,
  InSessionPhaseRequestContext,
  InSessionRoundOptions,
  InSessionRoundResult,
} from './goal-phase-runtime';
