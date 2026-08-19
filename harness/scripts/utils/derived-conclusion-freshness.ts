import { BlueprintRecord, asRecords } from './component-blueprint-model';

export interface FreshnessResult {
  current: boolean;
  reasons: string[];
}

export function evaluateDerivedConclusionFreshness(
  conclusion: BlueprintRecord,
  blueprint: BlueprintRecord,
): FreshnessResult {
  const reasons: string[] = [];
  if (conclusion.input_revision !== blueprint.revision) reasons.push('revision_mismatch');
  if (conclusion.source_fingerprint !== blueprint.source_fingerprint) reasons.push('source_fingerprint_mismatch');
  if (conclusion.decision_fingerprint !== blueprint.decision_fingerprint) reasons.push('decision_fingerprint_mismatch');
  if (conclusion.status === 'stale') reasons.push('explicitly_stale');
  return { current: reasons.length === 0 && conclusion.status === 'current', reasons };
}

export function downstreamRefNeedsRecompute(
  ref: BlueprintRecord,
  current: { revision: unknown; source_fingerprint: unknown; artifact_sha256: unknown },
): boolean {
  return ref.revision !== current.revision
    || ref.source_fingerprint !== current.source_fingerprint
    || ref.artifact_sha256 !== current.artifact_sha256;
}

export function staleDerivedResultIds(blueprint: BlueprintRecord): string[] {
  return asRecords(blueprint.derived_results)
    .filter(result => !evaluateDerivedConclusionFreshness(result, blueprint).current)
    .map(result => String(result.result_id ?? '<missing>'));
}
