import type { PhaseVerdictAction } from './phase-transition-policy';

/** Read-only historical event vocabulary; current runs never select a phase action here. */
export type DriverGuardAction = PhaseVerdictAction | 'none';

/** Reuse the existing source guard to prevent the retired dispatcher from returning. */
export function checkAssessDrivenRunnerSource(source: string): string[] {
  return /\b(?:selectRunnerActionFromAssess|classifyPhaseVerdict)\s*\(/.test(source)
    ? ['current runtime must consume current work, not the retired phase dispatcher'] : [];
}
