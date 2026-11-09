import { BlueprintRecord, asRecord, asRecords, asStrings, getId, nonEmptyString } from './component-blueprint-model';
import type { ChangeUnitArtifact } from './change-unit-model';
import { ownersForAddress } from './change-unit-addressing';
import { isApplicableView, isChangedView, nodeDeclaresChange } from './blueprint-views';
import { currentScopeItems, requirementTraceability } from './blueprint-requirement-traceability';
import { ClosureEvidenceLevel, ClosureRequirementInput, compareCodePoint, stableSortStrings } from './component-closure-model';

export interface BlueprintDesignObligationInputs {
  blueprint: { blueprint: BlueprintRecord; artifactSha256: string };
  currentUnits: readonly { changeUnit: ChangeUnitArtifact }[];
}

/** The declared requirement trace, before P3 adds observed source hashes. */
export function blueprintClosureRequirements(blueprint: BlueprintRecord): ClosureRequirementInput[] {
  const mappings = new Map(requirementTraceability(blueprint).map(item => [item.item_id, item.blueprint_refs]));
  return currentScopeItems(blueprint).map(item => ({ item_id: item.item_id, kind: item.kind, source_ref: item.source_ref,
    ...(item.source_revision ? { source_revision: item.source_revision } : {}),
    blueprint_refs: stableSortStrings(mappings.get(item.item_id) ?? []) })).sort((a, b) => compareCodePoint(a.item_id, b.item_id));
}

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

export function obligation(
  id: string,
  kind: string,
  options: Partial<Omit<ComponentClosureObligation, 'obligation_id' | 'kind'>> = {},
): ComponentClosureObligation {
  const key = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(id) ? id : `encoded:${Buffer.from(id, 'utf8').toString('base64url')}`;
  return {
    obligation_id: `obligation:${key}`,
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

// M7：节点变化判据与 P1 的 verified_unchanged 掩盖检测共用同一实现（blueprint-views），
// 不在 P3 另写一份会漂移的副本。
const changedNode = nodeDeclaresChange;


function addBlueprintObligations(
  inputs: BlueprintDesignObligationInputs,
  out: ComponentClosureObligation[],
): void {
  const blueprint = inputs.blueprint.blueprint;
  // M7：evolution_impact 显式接线。**每个 applicable 视图**都产生 blueprint_view 事实义务
  // （旧行为按字面 applicability 跳过，正交化后 verified_unchanged 不得被静默跳过）；
  // 但只有 changed 视图的节点才可能派生施工义务——verified_unchanged 视图的节点一律是
  // 当前事实（"Current-only node does not create fake work"先例），P1 已保证这些节点不
  // 声明 delta（blueprint_view_unchanged_masks_change）。
  for (const view of asRecords(blueprint.design_views)) {
    const viewId = String(view.view_id ?? '');
    if (!isApplicableView(view)) continue;
    const viewChanged = isChangedView(view);
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
      const owners = ownersForAddress(inputs.currentUnits.map(unit => unit.changeUnit), address);
      const construction = viewChanged && (changedNode(node) || owners.length > 0);
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
      owner_hint_change_unit_ids: ownersForAddress(inputs.currentUnits.map(unit => unit.changeUnit), address),
      evidence_level: 'integration_combination',
      mapping_kind: 'design',
      mapping_id: address,
    }));
  }
  for (const view of asRecords(blueprint.design_views)) {
    // runtime 流义务只对 runtime=changed 派生：verified_unchanged 的 runtime 视图本次不评估
    // 六类触发条件，也不产生施工/组合义务。
    if (view.view_id !== 'runtime' || !isChangedView(view)) continue;
    for (const flow of asRecords(view.runtime_data_flows)) {
      const flowId = getId(flow, 'flow_id');
      if (!flowId) continue;
      const address = `view:runtime/flow:${flowId}`;
      out.push(obligation(`runtime-flow:${flowId}`, 'runtime_flow', {
        source_refs: [...asStrings(flow.evidence_refs), ...asStrings(flow.verification_refs)],
        evidence_refs: asStrings(flow.verification_refs),
        blueprint_refs: [address],
        owner_hint_change_unit_ids: ownersForAddress(inputs.currentUnits.map(unit => unit.changeUnit), address),
        evidence_level: asRecords(flow.consumers).length > 0 ? 'ui_device' : 'integration_combination',
        mapping_kind: 'design',
        mapping_id: address,
      }));
      const owners = ownersForAddress(inputs.currentUnits.map(unit => unit.changeUnit), address);
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
    const owners = ownersForAddress(inputs.currentUnits.map(unit => unit.changeUnit), address);
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
      owner_hint_change_unit_ids: ownersForAddress(inputs.currentUnits.map(unit => unit.changeUnit), address),
      evidence_level: 'unit_contract',
      mapping_kind: 'design',
      mapping_id: address,
    }));
    if (asRecord(contract.nfr)) {
      out.push(obligation(`contract-nfr:${id}`, 'nfr', {
        source_refs: [String(asRecord(contract.nfr)?.source_ref ?? '')].filter(Boolean),
        blueprint_refs: [address],
        owner_hint_change_unit_ids: ownersForAddress(inputs.currentUnits.map(unit => unit.changeUnit), address),
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

/** Design preparation and P3 consume the same required ownership obligations. */
export function deriveBlueprintDesignObligations(inputs: BlueprintDesignObligationInputs,
  requirements: readonly ClosureRequirementInput[] = blueprintClosureRequirements(inputs.blueprint.blueprint)): ComponentClosureObligation[] {
  const out: ComponentClosureObligation[] = [];
  for (const requirement of requirements) {
    const owners = stableSortStrings(requirement.blueprint_refs.flatMap(ref => ownersForAddress(inputs.currentUnits.map(unit => unit.changeUnit), ref)));
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
  return out;
}
