'use strict';

/** One predicate for the runtime and zero-dependency native hooks. */
exports.hasGoalExecutionSignal = (env = process.env) => Boolean(
  env.MAISON_GOAL_RUN_ID?.trim() || env.MAISON_GOAL_ATTEMPT?.trim()
  || env.MAISON_GOAL_ATTEMPT_PHASE?.trim() || env.MAISON_GOAL_RUNNER === '1'
  || env.MAISON_GOAL_HEADLESS === '1'
);
