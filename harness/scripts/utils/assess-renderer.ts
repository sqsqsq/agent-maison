// ============================================================================
// assess-renderer.ts — bounded outer-CLI rendering for assess@1
// ============================================================================

import {
  assessFeature,
  type AssessAuthorizationContext,
  type AssessResult,
} from './assess';
import { loadGoalManifestFromRun } from './goal-manifest';

export interface AssessRenderOptions {
  projectRoot: string;
  frameworkRoot?: string;
  feature: string;
  phase: string;
  mode: AssessAuthorizationContext['mode'];
  status: string;
  goalEnd?: string;
  minimumAssurance?: Record<string, 'degraded' | 'full'>;
  runId?: string;
  attemptId?: string;
}

let renderedInProcess = false;

function oneLine(value: string, max = 280): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

export function formatAssessNextStep(
  result: AssessResult,
  meta: Pick<AssessRenderOptions, 'phase' | 'mode' | 'status'>,
): string {
  const target = result.recommendation.phase
    ? `${result.recommendation.action}:${result.recommendation.phase}`
    : result.recommendation.action;
  return [
    'NEXT_STEP',
    `feature=${result.feature} phase=${meta.phase} mode=${meta.mode} status=${oneLine(meta.status, 96)}`,
    `observed_fingerprint=${result.observed_fingerprint.slice(0, 16)} gaps=${result.gaps.length} fused=${result.stop.fused}`,
    `recommendation=${target}`,
    `reason=${oneLine(result.recommendation.reason)}`,
    `authorization=driver_required policy=${result.authorization_context.mode}`,
    'END_NEXT_STEP',
  ].join('\n');
}

/**
 * Process-wide once guard prevents an outer CLI from rendering twice. Nested
 * check-receipt calls use --skip-state-sync and never invoke this helper.
 */
export function assessAndRenderNextStep(options: AssessRenderOptions): AssessResult | null {
  if (renderedInProcess) return null;
  renderedInProcess = true;
  try {
    const runId = options.runId ?? (process.env.MAISON_GOAL_RUN_ID?.trim() || undefined);
    let goalEnd = options.goalEnd;
    let minimumAssurance = options.minimumAssurance;
    if (runId && (options.mode === 'goal_mode' || process.env.MAISON_GOAL_GATE_HARNESS === '1') && (!goalEnd || !minimumAssurance)) {
      const manifest = loadGoalManifestFromRun(options.projectRoot, runId, {
        feature: options.feature,
      });
      goalEnd ??= manifest.end_phase;
      minimumAssurance ??= manifest.minimum_assurance;
    }
    const result = assessFeature({
      projectRoot: options.projectRoot,
      frameworkRoot: options.frameworkRoot,
      feature: options.feature,
      goalEnd,
      minimumAssurance,
      authorization: { mode: options.mode },
      runId,
      attemptId: options.attemptId ?? (process.env.MAISON_GOAL_ATTEMPT?.trim() || undefined),
      writeProjection: true,
    });
    console.log('');
    console.log(formatAssessNextStep(result, options));
    return result;
  } catch (error) {
    console.warn('');
    console.warn('NEXT_STEP');
    console.warn(`feature=${options.feature} phase=${options.phase} mode=${options.mode} status=${oneLine(options.status, 96)}`);
    console.warn('recommendation=retry_assess');
    console.warn(`reason=${oneLine((error as Error).message)}`);
    console.warn('authorization=driver_required');
    console.warn('END_NEXT_STEP');
    return null;
  }
}

export function __testing_resetAssessRenderer(): void {
  renderedInProcess = false;
}
