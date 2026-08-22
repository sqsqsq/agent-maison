import type { ComponentBlueprintRef } from './component-blueprint-model';
import type { ChangeUnitCompletionState } from './change-unit-completion';
import type { ChangeUnitRef } from './change-unit-model';

export const COMPONENT_CLOSURE_ARTIFACT = 'component-closure@1' as const;

export type ClosureVerdict = 'PASS' | 'PASS_WITH_DEGRADATION' | 'FAIL';
export type ClosureObservation = 'covered' | 'uncovered' | 'blocked' | 'stale' | 'invalid';
export type ClosureEvidenceLevel = 'fact' | 'unit_contract' | 'integration_combination' | 'ui_device' | 'manual_risk';
export type ClosureGapClassification = 'incomplete' | 'blocked' | 'stale' | 'invalid' | 'conflict';
export type ClosureRepairRoute = 'repair_feature_or_evidence' | 'repair_or_add_change_unit' | 'reconcile_blueprint' | 'resolve_authority_or_risk';

export interface ClosureRequirementInput {
  item_id: string;
  kind: 'requirement' | 'goal' | 'invariant' | 'high_risk';
  source_ref: string;
  source_revision?: string;
  source_sha256?: string;
  blueprint_refs: string[];
}

export interface ClosureChangeUnitInput {
  ref: ChangeUnitRef;
  current: boolean;
  retired_by?: string;
  feature_id: string;
  completion: ChangeUnitCompletionState;
  completion_reasons: string[];
  carry_forward: boolean;
  carry_forward_reasons: string[];
}

export interface ClosureFeatureInput {
  feature_id: string;
  change_unit_id: string;
  contracts_sha256: string | null;
  acceptance_sha256: string | null;
  completion_sha256: string | null;
  evidence_manifest_hashes: string[];
  projection_issue_ids: string[];
  use_cases_required: boolean;
  dag_required: boolean;
}

export interface ClosureInputManifest {
  requirements: ClosureRequirementInput[];
  change_units: ClosureChangeUnitInput[];
  features: ClosureFeatureInput[];
}

export interface ComponentClosureCoverageRow {
  obligation_id: string;
  kind: string;
  required: boolean;
  source_refs: string[];
  blueprint_refs: string[];
  owner_change_unit_ids: string[];
  feature_ids: string[];
  feature_mapping_refs: string[];
  evidence_level: ClosureEvidenceLevel;
  evidence_identities: string[];
  observation: ClosureObservation;
}

export interface ClosureProviderObservation {
  provider_id: 'automated-construction-evidence' | 'ui-device-visual-evidence' | 'human-acceptance-risk';
  available: boolean;
  observations: Array<{
    evidence_identity: string;
    authority_ref: string;
    source_sha256: string;
    status: 'current' | 'stale' | 'invalid';
  }>;
  status: 'current' | 'missing' | 'stale' | 'conflict';
}

export interface ClosureDegradation {
  degradation_id: string;
  impact: string;
  owner: string;
  retrigger_condition: string;
}

export interface ComponentClosureGap {
  gap_id: string;
  classification: ClosureGapClassification;
  obligation_refs: string[];
  source_refs: string[];
  owner: string;
  needed_by: string;
  reason: string;
  unlock_condition: string;
  route: ClosureRepairRoute;
}

export interface ComponentClosureArtifact {
  artifact: typeof COMPONENT_CLOSURE_ARTIFACT;
  component_id: string;
  /** M5A §8.1：closure 属主演进工作区的 blueprint_id（与 path/ref 三方一致） */
  blueprint_id: string;
  component_blueprint_ref: ComponentBlueprintRef;
  input_fingerprint: string;
  evaluated_at: string;
  inputs: ClosureInputManifest;
  coverage_rows: ComponentClosureCoverageRow[];
  provider_observations: ClosureProviderObservation[];
  knowledge_writeback_refs: string[];
  degradations: ClosureDegradation[];
  gaps: ComponentClosureGap[];
  verdict: ClosureVerdict;
}

export interface ComponentClosureIssue {
  id: string;
  path: string;
  message: string;
  severity: 'BLOCKER' | 'WARN';
  route?: ClosureRepairRoute;
}

export function closureIssue(
  id: string,
  path: string,
  message: string,
  severity: ComponentClosureIssue['severity'] = 'BLOCKER',
  route?: ClosureRepairRoute,
): ComponentClosureIssue {
  return { id, path, message, severity, route };
}

export function compareCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableSortStrings(values: string[]): string[] {
  return [...new Set(values)].sort(compareCodePoint);
}
