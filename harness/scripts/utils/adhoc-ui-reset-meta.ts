/**
 * Ad-hoc UI reset hints (Nav stack pollution / rerun discipline).
 */
import * as fs from 'fs';

export type StepsBatchResult = {
  total?: number;
  executed?: number;
  results?: Array<{ index?: number; status?: string; error?: string }>;
};

export function parseStepsBatchFromRunOut(runOut: string): StepsBatchResult | null {
  try {
    const jsonMatch = runOut.match(/\{[\s\S]*"results"[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as StepsBatchResult;
  } catch {
    return null;
  }
}

/** Index of first non-ok step; null if all ok or no batch. */
export function computeLastFailedStepIndex(batch: StepsBatchResult | null): number | null {
  const results = batch?.results ?? [];
  for (const r of results) {
    if (r.status !== 'ok' && typeof r.index === 'number') {
      return r.index;
    }
  }
  return null;
}

export function readPreviousTraceOutcome(tracePath: string): string | null {
  if (!fs.existsSync(tracePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(tracePath, 'utf-8')) as { outcome?: string };
    return typeof raw.outcome === 'string' ? raw.outcome : null;
  } catch {
    return null;
  }
}

/** stderr ADHOC_UI_RESET_RECOMMENDED=1 when continuing session after non-success run. */
export function shouldEmitUiResetRecommended(
  previousOutcome: string | null,
  continueSession: boolean,
): boolean {
  if (!continueSession || !previousOutcome) return false;
  return previousOutcome !== 'success';
}

export function uiResetHintForOutcome(outcome: string, lastStepIndex: number | null): string | null {
  if (outcome === 'success') return null;
  if (lastStepIndex != null) {
    return `rerun_with_cold_restart_after_step_${lastStepIndex}`;
  }
  return 'rerun_with_cold_restart';
}
