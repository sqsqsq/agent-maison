import * as path from 'path';
import { enumerateFeatures } from '../../config';
import { loadGoalRunManifestFromRun } from './goal-manifest';
import { executionRequestForInvoke } from './session-execution-handoff';
import { loadEventsJsonlStrict } from './goal-runner-phase';

export interface ManagedGoalInvocation {
  run_id: string; phase: string; attempt_id: string;
  invoke_id: string; run_dir: string;
  owner: import('./goal-phase-executor').WorkUnitExecutionContext['owner'];
}

/** Environment names a signed producer; it cannot create one. Returned requests remain valid for its formal check. */
export function resolveManagedGoalInvocation(input: {
  projectRoot: string; feature?: string; phase?: string; env?: NodeJS.ProcessEnv;
}): ManagedGoalInvocation | undefined {
  const env = input.env ?? process.env;
  const runId = env.MAISON_GOAL_RUN_ID?.trim();
  const actorPhase = env.MAISON_GOAL_ATTEMPT_PHASE?.trim();
  const attemptId = env.MAISON_GOAL_ATTEMPT?.trim();
  if (!runId || !actorPhase || !attemptId) return undefined;
  const features = input.feature ? [input.feature] : enumerateFeatures(input.projectRoot).map(item => item.featureId);
  for (const feature of features) {
    try {
      const manifest = loadGoalRunManifestFromRun(input.projectRoot, runId, { feature });
      const runDir = path.resolve(input.projectRoot, manifest.report_dir);
      const loaded = loadEventsJsonlStrict(path.join(runDir, 'events.jsonl'));
      if (loaded.missing) continue;
      for (const start of [...loaded.events].reverse()) {
        if (start.type !== 'agent_invoke_start' || start.phase !== actorPhase || !start.invoke_id) continue;
        const original = executionRequestForInvoke(runDir, start.invoke_id);
        const context = original?.request.context;
        if (!context || context.runId !== runId || context.feature !== feature
          || context.phase !== actorPhase || context.attemptId !== attemptId
          || path.resolve(context.projectRoot) !== path.resolve(input.projectRoot)
          || path.resolve(context.runDir) !== runDir
          || input.phase && input.phase !== actorPhase && !context.chain.includes(input.phase as never)) continue;
        return { run_id: runId, phase: actorPhase, attempt_id: attemptId,
          invoke_id: original!.request.invoke_id, run_dir: runDir, owner: context.owner };
      }
    } catch { /* Try the next known feature; a locator is not authority. */ }
  }
  return undefined;
}

/** Nested goal commands cannot grant fresh execution; the public manual CLI retains its explicit switch. */
export function effectiveForceDevice(requested: boolean | undefined,
  input: Parameters<typeof resolveManagedGoalInvocation>[0]): boolean {
  if (!requested || resolveManagedGoalInvocation(input)) return false;
  const env = input.env ?? process.env;
  // A damaged bound goal journal cannot turn an inherited managed context into a fresh-execution grant.
  if (env.MAISON_GOAL_RUN_ID?.trim() && env.MAISON_GOAL_ATTEMPT?.trim() && env.MAISON_GOAL_ATTEMPT_PHASE?.trim()) {
    const features = input.feature ? [input.feature] : enumerateFeatures(input.projectRoot).map(item => item.featureId);
    for (const feature of features) try {
      const manifest = loadGoalRunManifestFromRun(input.projectRoot, env.MAISON_GOAL_RUN_ID.trim(), { feature });
      const journal = loadEventsJsonlStrict(path.resolve(input.projectRoot, manifest.report_dir, 'events.jsonl'));
      if (journal.corruptLines.length) return false;
    } catch { /* No bound run: ordinary manual CLI semantics remain unchanged. */ }
  }
  return true;
}
