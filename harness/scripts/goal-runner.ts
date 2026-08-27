#!/usr/bin/env ts-node
/**
 * Detached goal CLI/process shell.
 * Phase lifecycle and executor ownership live in goal-phase-runtime-process.ts and
 * utils/goal-phase-runtime.ts; this file intentionally contains no phase loop or gate call.
 */
export * from './goal-phase-runtime-process';

import { runGoalPhaseRuntimeProcessCli } from './goal-phase-runtime-process';

if (require.main === module) {
  runGoalPhaseRuntimeProcessCli();
}
