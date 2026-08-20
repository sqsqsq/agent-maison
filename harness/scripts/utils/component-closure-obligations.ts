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
import { ClosureEvidenceLevel, compareCodePoint, stableSortStrings } from './component-closure-model';
import { SpecLoader } from './spec-loader';

export interface ComponentClosureObligation {
  obligation_id: string;
  kind: string;
  required: boolean;
  source_refs: string[];
  evidence_refs: string[];
  blueprint_refs: string[];
  owner_hint_change_unit_ids: string[];
  evidence_level: ClosureEvidenceLevel;
  mapping_kind?: 'predicate' | 'provide' | 'design' | 'feature_acceptance' | 'completion' | 'fact';
  mapping_id?: string;
}

function obligation(
  id: string,
  kind: string,
  options: Partial<Omit<ComponentClosureObligation, 'obligation_id' | 'kind'>> = {},
): ComponentClosureObligation {
  return {
    obligation_id: `obligation:${id}`,
    kind,
    required: options.required ?? true,
    source_refs: stableSortStrings(options.source_refs ?? []),
    evidence_refs: stableSortStrings(options.evidence_refs ?? []),
    blueprint_refs: stableSortStrings(options.blueprint_refs ?? []),
    owner_hint_change_unit_ids: stableSortStrings(options.owner_hint_change_unit_ids ?? []),
    evidence_level: options.evidence_level ?? 'unit_contract',
    ...(options.mapping_kind ? { mapping_kind: options.mapping_kind } : {}),
    ...(options.mapping_id ? { mapping_id: options.mapping_id } : {}),
  };
}

function changedNode(node: BlueprintRecord): boolean {
  const delta = String(node.delta ?? '').trim().toLowerCase();
  if (delta && !['none', 'no_change', 'unchanged'].includes(delta)) return true;
  return JSON.stringify(node.current_state) !== JSON.stringify(node.target_state);
}

function ownersForAddress(inputs: ResolvedComponentClosureInputs, address: string): string[] {
  return stableSortStrings(inputs.currentUnits
    .filter(unit => unit.changeUnit.design_refs.some(ref => blueprintRefAddress(ref) === address))
    .map(unit => unit.changeUnit.change_unit_id));
}

function addBlueprintObligations(
  inputs: ResolvedComponentClosureInputs,
  out: ComponentClosureObligation[],
): void {
  const blueprint = inputs.blueprint.blueprint;
  for (const view of asRecords(blueprint.design_views)) {
    const viewId = String(view.view_id ?? '');
    if (view.applicability !== 'applicable') continue;
    const viewAddress = `view:${viewId}`;
    out.push(obligation(`blueprint-view:${viewId}`, 'blueprint_view', {
      source_refs: [`component-blueprint:${inputs.blueprint.artifactSha256}#view:${viewId}`],
      blueprint_refs: [viewAddress],
      evidence_level: 'fact',
      mapping_kind: 'fact',
      mapping_id: viewAddress,
    }));
    for (const node of asRecords(view.nodes)) {
      const nodeId = getId(node, 'node_id');
      if (!nodeId) continue;
      const address = `view:${viewId}/node:${nodeId}`;
      const owners = ownersForAddress(inputs, address);
      const construction = changedNode(node) || owners.length > 0;
      out.push(obligation(`blueprint-node:${viewId}:${nodeId}`, construction ? 'blueprint_target_node' : 'blueprint_current_fact', {
        source_refs: nonEmptyString(asRecord(node.provenance)?.source_ref) ? [String(asRecord(node.provenance)?.source_ref)] : [],
        blueprint_refs: [address],
        owner_hint_change_unit_ids: owners,
        evidence_level: construction ? 'unit_contract' : 'fact',
        mapping_kind: construction ? 'design' : 'fact',
        mapping_id: address,
      }));
    }
  }
  for (const relation of asRecords(blueprint.relations)) {
    const id = getId(relation, 'relation_id');
    if (!id) continue;
    const address = `relation:${id}`;
    out.push(obligation(`blueprint-relation:${id}`, 'cross_view_relation', {
      blueprint_refs: [address, ...asStrings([relation.from, relation.to])],
      owner_hint_change_unit_ids: ownersForAddress(inputs, address),
      evidence_level: 'integration_combination',
      mapping_kind: 'design',
      mapping_id: address,
    }));
  }
  for (const view of asRecords(blueprint.design_views)) {
    if (view.view_id !== 'runtime' || view.applicability !== 'applicable') continue;
    for (const flow of asRecords(view.runtime_data_flows)) {
      const flowId = getId(flow, 'flow_id');
      if (!flowId) continue;
      const address = `view:runtime/flow:${flowId}`;
      out.push(obligation(`runtime-flow:${flowId}`, 'runtime_flow', {
        source_refs: [...asStrings(flow.evidence_refs), ...asStrings(flow.verification_refs)],
        evidence_refs: asStrings(flow.verification_refs),
        blueprint_refs: [address],
        owner_hint_change_unit_ids: ownersForAddress(inputs, address),
        evidence_level: asRecords(flow.consumers).length > 0 ? 'ui_device' : 'integration_combination',
        mapping_kind: 'design',
        mapping_id: address,
      }));
      const owners = ownersForAddress(inputs, address);
      asRecords(flow.triggers).forEach((item, index) => {
        const localId = getId(item, 'trigger_id') || `${String(item.kind ?? 'trigger')}-${index}`;
        const localAddress = `${address}/trigger:${localId}`;
        out.push(obligation(`runtime-edge:${flowId}:trigger:${localId}`, 'runtime_trigger', {
          source_refs: asStrings(item.verification_refs),
          evidence_refs: asStrings(item.verification_refs),
          blueprint_refs: [address, localAddress],
          owner_hint_change_unit_ids: owners,
          evidence_level: 'integration_combination',
          mapping_kind: 'design',
          mapping_id: localAddress,
        }));
      });
      const initialLoad = asRecord(flow.initial_load);
      if (initialLoad) {
        const localId = getId(initialLoad, 'initial_load_id');
        if (localId) {
          const localAddress = `${address}/initial-load:${localId}`;
          out.push(obligation(`runtime-edge:${flowId}:initial-load:${localId}`, 'runtime_initial_load', {
            source_refs: asStrings(initialLoad.verification_refs),
            evidence_refs: asStrings(initialLoad.verification_refs),
            blueprint_refs: [address, localAddress],
            owner_hint_change_unit_ids: owners,
            evidence_level: 'ui_device',
            mapping_kind: 'design',
            mapping_id: localAddress,
          }));
        }
      }
      const stateOwner = asRecord(flow.state_owner);
      if (stateOwner && nonEmptyString(stateOwner.ref)) {
        const localAddress = `${address}/state-owner:${String(stateOwner.ref)}`;
        out.push(obligation(`runtime-edge:${flowId}:state-owner:${String(stateOwner.ref)}`, 'runtime_state_owner', {
          source_refs: asStrings(stateOwner.verification_refs),
          evidence_refs: asStrings(stateOwner.verification_refs),
          blueprint_refs: [address, localAddress],
          owner_hint_change_unit_ids: owners,
          evidence_level: 'integration_combination',
          mapping_kind: 'design',
          mapping_id: localAddress,
        }));
      }
      for (const [field, prefix] of [
        ['mutations', 'mutation'],
        ['publications', 'publication'],
        ['subscriptions', 'subscription'],
        ['consumers', 'consumer'],
      ] as const) {
        for (const item of asRecords(flow[field])) {
          const localId = getId(item, `${prefix}_id`);
          if (!localId) continue;
          const localAddress = `${address}/${prefix}:${localId}`;
          out.push(obligation(`runtime-edge:${flowId}:${prefix}:${localId}`, `runtime_${prefix}`, {
            source_refs: asStrings(item.verification_refs),
            evidence_refs: asStrings(item.verification_refs),
            blueprint_refs: [address, localAddress],
            owner_hint_change_unit_ids: owners,
            evidence_level: prefix === 'consumer' || prefix === 'subscription' ? 'ui_device' : 'integration_combination',
            mapping_kind: 'design',
            mapping_id: localAddress,
          }));
        }
      }
      const recovery = asRecord(flow.failure_recovery);
      if (recovery) {
        const localId = getId(recovery, 'recovery_id');
        if (localId) {
          const localAddress = `${address}/recovery:${localId}`;
          out.push(obligation(`runtime-edge:${flowId}:recovery:${localId}`, 'runtime_recovery', {
            source_refs: asStrings(recovery.verification_refs),
            evidence_refs: asStrings(recovery.verification_refs),
            blueprint_refs: [address, localAddress],
            owner_hint_change_unit_ids: owners,
            evidence_level: 'ui_device',
            mapping_kind: 'design',
            mapping_id: localAddress,
          }));
        }
      }
      const lifecycle = asRecord(flow.lifecycle_coverage);
      for (const lifecycleId of Object.keys(lifecycle ?? {}).sort(compareCodePoint)) {
        const item = asRecord(lifecycle?.[lifecycleId]);
        if (!item || item.status !== 'covered') continue;
        const localAddress = `${address}/lifecycle:${lifecycleId}`;
        out.push(obligation(`runtime-edge:${flowId}:lifecycle:${lifecycleId}`, 'runtime_lifecycle', {
          source_refs: asStrings(item.evidence_refs),
          evidence_refs: asStrings(item.evidence_refs),
          blueprint_refs: [address, localAddress],
          owner_hint_change_unit_ids: owners,
          evidence_level: 'ui_device',
          mapping_kind: 'design',
          mapping_id: localAddress,
        }));
      }
    }
  }
  const decisionsAndGaps = asRecord(blueprint.decisions_and_gaps);
  for (const decision of asRecords(decisionsAndGaps?.decisions)) {
    const id = getId(decision, 'decision_id');
    if (!id) continue;
    const address = `decision:${id}`;
    const seam = decision.kind === 'evolution_candidate'
      && decision.status === 'decided_with_authority'
      && decision.human_decision === 'establish_seam';
    const owners = ownersForAddress(inputs, address);
    const factOnly = decision.status === 'not_applicable' && owners.length === 0;
    const assemblyKinds = new Set(['migration', 'compatibility', 'feature_flag', 'dual_write', 'temporary_asset', 'controlled_fake', 'residual_risk']);
    const decisionKind = seam
      ? 'evolution_seam_decision'
      : assemblyKinds.has(String(decision.kind))
        ? `assembly_${String(decision.kind)}`
        : 'design_decision';
    out.push(obligation(`decision:${id}`, decisionKind, {
      source_refs: asStrings(decision.verification_refs),
      evidence_refs: asStrings(decision.verification_refs),
      blueprint_refs: [address],
      owner_hint_change_unit_ids: owners,
      evidence_level: factOnly ? 'fact' : decision.kind === 'residual_risk' ? 'manual_risk' : seam || assemblyKinds.has(String(decision.kind)) ? 'integration_combination' : 'unit_contract',
      mapping_kind: factOnly ? 'fact' : 'design',
      mapping_id: address,
    }));
    if (seam) {
      const closureProofs = asRecord(decision.closure_proofs);
      for (const proof of ['contract_compatibility', 'provider_replacement', 'absence_failure', 'consumer_no_bypass']) {
        const proofRef = typeof closureProofs?.[proof] === 'string' ? [String(closureProofs[proof])] : [];
        out.push(obligation(`seam:${id}:${proof}`, `evolution_seam_${proof}`, {
          source_refs: proofRef,
          evidence_refs: proofRef,
          blueprint_refs: [address],
          owner_hint_change_unit_ids: owners,
          evidence_level: 'integration_combination',
          mapping_kind: 'design',
          mapping_id: address,
        }));
      }
    }
  }
  const currentIds = new Set(inputs.currentUnits.map(unit => unit.changeUnit.change_unit_id));
  for (const gap of asRecords(decisionsAndGaps?.gaps)) {
    const id = getId(gap, 'gap_id');
    if (!id) continue;
    const neededBy = String(gap.needed_by ?? '');
    const required = currentIds.has(neededBy) || neededBy === 'component-closure';
    out.push(obligation(`gap:${id}`, 'knowledge_gap', {
      required,
      source_refs: nonEmptyString(asRecord(gap.provenance)?.source_ref) ? [String(asRecord(gap.provenance)?.source_ref)] : [],
      evidence_level: 'manual_risk',
      mapping_kind: 'fact',
      mapping_id: id,
    }));
  }
  for (const contract of asRecords(blueprint.contracts)) {
    const id = getId(contract, 'contract_id');
    if (!id) continue;
    const address = `contract:${id}`;
    out.push(obligation(`contract:${id}`, 'authority_contract', {
      source_refs: [String(asRecord(contract.operation)?.source_ref ?? '')].filter(Boolean),
      blueprint_refs: [address],
      owner_hint_change_unit_ids: ownersForAddress(inputs, address),
      evidence_level: 'unit_contract',
      mapping_kind: 'design',
      mapping_id: address,
    }));
    if (asRecord(contract.nfr)) {
      out.push(obligation(`contract-nfr:${id}`, 'nfr', {
        source_refs: [String(asRecord(contract.nfr)?.source_ref ?? '')].filter(Boolean),
        blueprint_refs: [address],
        owner_hint_change_unit_ids: ownersForAddress(inputs, address),
        evidence_level: 'integration_combination',
        mapping_kind: 'design',
        mapping_id: address,
      }));
    }
  }
  const appLens = asRecord(blueprint.app_lens);
  for (const lensId of [
    'module_boundaries',
    'capability_seams',
    'feature_flags',
    'data_producers_consumers',
    'lifecycle_triggers',
    'state_owners',
    'initialization',
    'publication_subscription',
    'ui_refresh',
    'process_recovery',
  ]) {
    const lens = asRecord(appLens?.[lensId]);
    if (!lens) continue;
    out.push(obligation(`app-lens:${lensId}`, 'app_lens_current_fact', {
      source_refs: asStrings(lens.evidence_refs),
      evidence_level: 'fact',
      mapping_kind: 'fact',
      mapping_id: lensId,
    }));
  }
}

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
    const spec = new SpecLoader(projectRoot).loadFeatureSpec(featureId);
    for (const item of [...(spec.acceptance?.criteria ?? []), ...(spec.acceptance?.boundaries ?? [])]) {
      const id = String(item.id ?? '');
      if (!id) continue;
      out.push(obligation(`feature-acceptance:${featureId}:${id}`, 'feature_acceptance', {
        source_refs: 'verification_steps' in item ? item.verification_steps : [],
        evidence_refs: 'verification_steps' in item ? item.verification_steps : [],
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
  const out: ComponentClosureObligation[] = [];
  for (const requirement of inputs.manifest.requirements) {
    const owners = stableSortStrings(requirement.blueprint_refs.flatMap(ref => ownersForAddress(inputs, ref)));
    out.push(obligation(`source:${requirement.kind}:${requirement.item_id}`, `source_${requirement.kind}`, {
      source_refs: [requirement.source_ref],
      blueprint_refs: requirement.blueprint_refs,
      owner_hint_change_unit_ids: owners,
      evidence_level: owners.length > 1 ? 'integration_combination' : 'unit_contract',
      mapping_kind: 'design',
      mapping_id: requirement.item_id,
    }));
  }
  addBlueprintObligations(inputs, out);
  addChangeUnitObligations(inputs, out);
  addFeatureObligations(projectRoot, inputs, out);
  const unique = new Map<string, ComponentClosureObligation>();
  for (const item of out) unique.set(item.obligation_id, item);
  return [...unique.values()].sort((a, b) => compareCodePoint(a.obligation_id, b.obligation_id));
}
