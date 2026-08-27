#!/usr/bin/env ts-node
/**
 * Detached goal CLI/process shell.
 * The phase lifecycle lives in goal-phase-runtime.ts; this file intentionally contains
 * no phase loop or gate call. utils/goal-phase-runtime.ts is compatibility-only.
 */
export * from './goal-phase-runtime';

import { runGoalPhaseRuntimeProcessCli } from './goal-phase-runtime';

if (require.main === module) {
  runGoalPhaseRuntimeProcessCli();
}
