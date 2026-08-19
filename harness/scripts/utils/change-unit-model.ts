import type { ComponentBlueprintRef } from './component-blueprint-model';

export const CHANGE_UNIT_ARTIFACT = 'change-unit@1' as const;

export interface ChangeUnitRef {
  artifact: typeof CHANGE_UNIT_ARTIFACT;
  component_id: string;
  change_unit_id: string;
  revision: number;
  artifact_sha256: string;
}

export interface ChangeUnitProvenance {
  source_kind: string;
  source_ref: string;
  source_revision?: string;
  observed_at: string;
  evidence_strength: 'authoritative' | 'observed' | 'inferred' | 'unknown';
  extraction_method: string;
}

export interface ChangeUnitRequirement {
  require_id: string;
  from_change_unit_id: string;
  provide_id: string;
}

export interface ChangeUnitProvide {
  provide_id: string;
  description: string;
}

export interface ChangeUnitPredicate {
  predicate_id: string;
  role: 'behavior' | 'owner' | 'consumer' | 'contract' | 'provider' | 'recovery';
  description: string;
  provide_ids: string[];
  verification_refs: string[];
}

export interface ChangeUnitBlocker {
  blocker_id: string;
  gate: 'design' | 'execution';
  owner: string;
  reason: string;
  unlock_condition: string;
  observation: 'machine' | 'human';
  source_refs: string[];
  source_revision?: string;
  authority_ref?: string;
  probe?: {
    kind: 'file_exists' | 'command' | 'contract' | 'manual_input';
    ref: string;
    expected: string;
  };
}

export interface ChangeUnitArtifact {
  artifact: typeof CHANGE_UNIT_ARTIFACT;
  component_id: string;
  change_unit_id: string;
  revision: number;
  priority: number;
  component_blueprint_ref: ComponentBlueprintRef;
  provenance: ChangeUnitProvenance;
  purpose: string;
  preconditions: Array<{
    precondition_id: string;
    description: string;
    source_refs: string[];
  }>;
  requires: ChangeUnitRequirement[];
  provides: ChangeUnitProvide[];
  design_refs: ComponentBlueprintRef[];
  touches: Array<{
    owner: string;
    design_ref: ComponentBlueprintRef;
    write_refs: string[];
  }>;
  preserved_invariants: Array<{
    invariant_id: string;
    description: string;
    evidence_refs: string[];
  }>;
  target_predicates: ChangeUnitPredicate[];
  verification_refs: string[];
  safe_intermediate_state: {
    description: string;
    build_validation_refs: string[];
    compatibility_refs: string[];
    recovery_refs: string[];
  };
  blockers: ChangeUnitBlocker[];
  revises?: ChangeUnitRef;
  supersedes?: ChangeUnitRef;
}

export type ChangeUnitRecord = Record<string, unknown>;
export type ChangeUnitSeverity = 'BLOCKER' | 'WARN';

export interface ChangeUnitIssue {
  id: string;
  severity: ChangeUnitSeverity;
  path: string;
  message: string;
  route?: 'repair_change_unit' | 'repair_feature_mapping' | 'reconcile_blueprint';
}

export function changeUnitIssue(
  id: string,
  path: string,
  message: string,
  severity: ChangeUnitSeverity = 'BLOCKER',
  route: ChangeUnitIssue['route'] = 'repair_change_unit',
): ChangeUnitIssue {
  return { id, severity, path, message, route };
}

export function isChangeUnitRecord(value: unknown): value is ChangeUnitRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function changeUnitRecords(value: unknown): ChangeUnitRecord[] {
  return Array.isArray(value) ? value.filter(isChangeUnitRecord) : [];
}

export function changeUnitStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

export function changeUnitNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function blueprintRefAddress(ref: ComponentBlueprintRef): string {
  const { kind, id, view_id: viewId } = ref.target;
  if (kind === 'node' || kind === 'flow') return `view:${viewId}/${kind}:${id}`;
  return `${kind}:${id}`;
}

export function sameBlueprintIdentity(a: ComponentBlueprintRef, b: ComponentBlueprintRef): boolean {
  return a.artifact === b.artifact
    && a.component_id === b.component_id
    && a.blueprint_id === b.blueprint_id
    && a.revision === b.revision
    && a.source_fingerprint === b.source_fingerprint
    && a.artifact_sha256 === b.artifact_sha256;
}

export function sameBlueprintTarget(a: ComponentBlueprintRef, b: ComponentBlueprintRef): boolean {
  return sameBlueprintIdentity(a, b)
    && a.target.kind === b.target.kind
    && a.target.id === b.target.id
    && a.target.view_id === b.target.view_id;
}
