import { ComponentClosureObligation, obligation, deriveBlueprintDesignObligations } from './component-blueprint-obligations';
export type { ComponentClosureObligation } from './component-blueprint-obligations';
import {
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  getId,
  nonEmptyString,
} from './component-blueprint-model';
import { blueprintRefAddress } from './change-unit-model';
import { ResolvedComponentClosureInputs } from './component-closure-inputs';
import { compareCodePoint, stableSortStrings } from './component-closure-model';
import { readCompletedFeatureDesign } from './change-unit-completion';
import { splitProjectEvidenceRef } from './component-closure-evidence';

function addChangeUnitObligations(inputs: ResolvedComponentClosureInputs, out: ComponentClosureObligation[]): void {
  for (const unit of inputs.currentUnits) {
    const cu = unit.changeUnit;
    const owner = [cu.change_unit_id];
    out.push(obligation(`cu-purpose:${cu.change_unit_id}`, 'change_unit_purpose', {
      source_refs: [cu.provenance.source_ref], owner_hint_change_unit_ids: owner, mapping_kind: 'completion', mapping_id: cu.change_unit_id,
    }));
    for (const predicate of cu.target_predicates) {
      out.push(obligation(`cu-predicate:${cu.change_unit_id}:${predicate.predicate_id}`, 'target_predicate', {
        source_refs: predicate.verification_refs,
        owner_hint_change_unit_ids: owner,
        mapping_kind: 'predicate',
        mapping_id: predicate.predicate_id,
      }));
    }
    for (const provide of cu.provides) {
      out.push(obligation(`cu-provide:${cu.change_unit_id}:${provide.provide_id}`, 'provide', {
        owner_hint_change_unit_ids: owner,
        mapping_kind: 'provide',
        mapping_id: provide.provide_id,
      }));
    }
    for (const require of cu.requires) {
      out.push(obligation(`cu-require:${cu.change_unit_id}:${require.require_id}`, 'dependency', {
        owner_hint_change_unit_ids: stableSortStrings([cu.change_unit_id, require.from_change_unit_id]),
        evidence_level: 'integration_combination',
        mapping_kind: 'completion',
        mapping_id: require.require_id,
      }));
    }
    for (const invariant of cu.preserved_invariants) {
      out.push(obligation(`cu-invariant:${cu.change_unit_id}:${invariant.invariant_id}`, 'preserved_invariant', {
        source_refs: invariant.evidence_refs,
        evidence_refs: invariant.evidence_refs,
        owner_hint_change_unit_ids: owner,
        mapping_kind: 'completion',
        mapping_id: invariant.invariant_id,
      }));
    }
    cu.touches.forEach((touch, index) => {
      const address = blueprintRefAddress(touch.design_ref);
      out.push(obligation(`cu-touch:${cu.change_unit_id}:${index}`, 'construction_touch', {
        source_refs: touch.write_refs,
        blueprint_refs: [address],
        owner_hint_change_unit_ids: owner,
        mapping_kind: 'design',
        mapping_id: address,
      }));
    });
    out.push(obligation(`cu-safe-state:${cu.change_unit_id}`, 'safe_intermediate_state', {
      source_refs: [
        ...cu.safe_intermediate_state.build_validation_refs,
        ...cu.safe_intermediate_state.compatibility_refs,
        ...cu.safe_intermediate_state.recovery_refs,
      ],
      evidence_refs: [
        ...cu.safe_intermediate_state.build_validation_refs,
        ...cu.safe_intermediate_state.compatibility_refs,
        ...cu.safe_intermediate_state.recovery_refs,
      ],
      owner_hint_change_unit_ids: owner,
      evidence_level: 'integration_combination',
      mapping_kind: 'completion',
      mapping_id: cu.change_unit_id,
    }));
    cu.verification_refs.forEach((verificationRef, index) => {
      out.push(obligation(`cu-verification:${cu.change_unit_id}:${index}`, 'change_unit_verification', {
        source_refs: [verificationRef],
        evidence_refs: [verificationRef],
        owner_hint_change_unit_ids: owner,
        mapping_kind: 'completion',
        mapping_id: verificationRef,
      }));
    });
  }
}

function addFeatureObligations(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
  out: ComponentClosureObligation[],
): void {
  for (const unit of inputs.currentUnits) {
    const featureId = unit.input.feature_id;
    const { spec } = readCompletedFeatureDesign(projectRoot, featureId, unit.completionObservation);
    for (const item of [...(spec.acceptance?.criteria ?? []), ...(spec.acceptance?.boundaries ?? [])]) {
      const id = String(item.id ?? '');
      if (!id) continue;
      out.push(obligation(`feature-acceptance:${featureId}:${id}`, 'feature_acceptance', {
        source_refs: 'verification_steps' in item ? item.verification_steps : [],
        // Natural-language acceptance actions are not file#check execution claims.
        evidence_refs: 'verification_steps' in item ? item.verification_steps.filter(step => splitProjectEvidenceRef(step) !== null) : [],
        owner_hint_change_unit_ids: [unit.changeUnit.change_unit_id],
        evidence_level: item.ut_layer === 'device' || item.ut_layer === 'both' ? 'ui_device' : 'unit_contract',
        mapping_kind: 'completion',
        mapping_id: id,
      }));
    }
    const section = asRecord(spec.contracts?.change_unit);
    for (const mapping of asRecords(section?.predicate_mappings)) {
      const id = String(mapping.predicate_id ?? '');
      if (!id) continue;
      out.push(obligation(`feature-mapping:${featureId}:predicate:${id}`, 'feature_construction_mapping', {
        source_refs: [...asStrings(mapping.implementation_refs), ...asStrings(mapping.test_refs)],
        owner_hint_change_unit_ids: [unit.changeUnit.change_unit_id],
        mapping_kind: 'predicate',
        mapping_id: id,
      }));
    }
    for (const mapping of asRecords(section?.provide_mappings)) {
      const id = String(mapping.provide_id ?? '');
      if (!id) continue;
      out.push(obligation(`feature-mapping:${featureId}:provide:${id}`, 'feature_construction_mapping', {
        source_refs: [...asStrings(mapping.implementation_refs), ...asStrings(mapping.test_refs)],
        owner_hint_change_unit_ids: [unit.changeUnit.change_unit_id],
        mapping_kind: 'provide',
        mapping_id: id,
      }));
    }
    for (const mapping of asRecords(section?.design_ref_mappings)) {
      const ref = asRecord(mapping.design_ref);
      if (!ref) continue;
      const address = blueprintRefAddress(mapping.design_ref as never);
      out.push(obligation(`feature-mapping:${featureId}:design:${address}`, 'feature_construction_mapping', {
        source_refs: [...asStrings(mapping.implementation_refs), ...asStrings(mapping.verification_refs)],
        blueprint_refs: [address],
        owner_hint_change_unit_ids: [unit.changeUnit.change_unit_id],
        mapping_kind: 'design',
        mapping_id: address,
      }));
    }
    for (const state of spec.contracts?.state_management ?? []) {
      if (!state.design_ref) continue;
      const address = blueprintRefAddress(state.design_ref);
      out.push(obligation(`feature-runtime:${featureId}:${address}`, 'feature_runtime_construction', {
        blueprint_refs: [address],
        owner_hint_change_unit_ids: [unit.changeUnit.change_unit_id],
        evidence_level: 'integration_combination',
        mapping_kind: 'design',
        mapping_id: address,
      }));
    }
    const featureInput = inputs.manifest.features.find(item => item.feature_id === featureId);
    if (featureInput?.use_cases_required) {
      out.push(obligation(`feature-use-cases:${featureId}`, 'feature_use_cases', {
        owner_hint_change_unit_ids: [unit.changeUnit.change_unit_id],
        evidence_level: 'integration_combination',
        mapping_kind: 'completion',
        mapping_id: featureId,
      }));
    }
    if (featureInput?.dag_required) {
      out.push(obligation(`feature-dag:${featureId}`, 'feature_dag', {
        owner_hint_change_unit_ids: [unit.changeUnit.change_unit_id],
        evidence_level: 'unit_contract',
        mapping_kind: 'completion',
        mapping_id: featureId,
      }));
    }
  }
}

export function deriveComponentClosureObligations(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
): ComponentClosureObligation[] {
  const out = deriveBlueprintDesignObligations(inputs, inputs.manifest.requirements);
  addChangeUnitObligations(inputs, out);
  addFeatureObligations(projectRoot, inputs, out);
  const unique = new Map<string, ComponentClosureObligation>();
  for (const item of out) unique.set(item.obligation_id, item);
  return [...unique.values()].sort((a, b) => compareCodePoint(a.obligation_id, b.obligation_id));
}
