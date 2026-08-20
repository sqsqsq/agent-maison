import { SpecLoader } from './spec-loader';
import { BlueprintRecord, asRecord, asRecords } from './component-blueprint-model';
import { blueprintRefAddress } from './change-unit-model';
import { ResolvedComponentClosureInputs } from './component-closure-inputs';
import { ComponentClosureCoverageRow, ComponentClosureIssue, closureIssue } from './component-closure-model';

interface RuntimeAddress {
  flowAddress: string;
  flowId: string;
  kind?: string;
  localId?: string;
}

function parseRuntimeAddress(row: ComponentClosureCoverageRow): RuntimeAddress | null {
  const address = row.blueprint_refs.find(ref => /^view:runtime\/flow:[^/]+\//.test(ref))
    ?? row.blueprint_refs.find(ref => /^view:runtime\/flow:/.test(ref));
  if (!address) return null;
  const match = address.match(/^(view:runtime\/flow:([^/]+))(?:\/(trigger|initial-load|state-owner|mutation|publication|subscription|consumer|recovery|lifecycle):(.+))?$/);
  if (!match) return null;
  return { flowAddress: match[1], flowId: match[2], ...(match[3] ? { kind: match[3], localId: match[4] } : {}) };
}

function runtimeFlow(inputs: ResolvedComponentClosureInputs, flowId: string): BlueprintRecord | undefined {
  const runtime = asRecords(inputs.blueprint.blueprint.design_views)
    .find(view => view.view_id === 'runtime' && view.applicability === 'applicable');
  return asRecords(runtime?.runtime_data_flows).find(flow => flow.flow_id === flowId);
}

function featureState(projectRoot: string, featureId: string, flowAddress: string): BlueprintRecord | undefined {
  const contracts = new SpecLoader(projectRoot).loadFeatureSpec(featureId).contracts;
  return (contracts?.state_management ?? []).find(state => (
    state.design_ref && blueprintRefAddress(state.design_ref) === flowAddress
  )) as unknown as BlueprintRecord | undefined;
}

function localItem(flow: BlueprintRecord, kind: string, localId: string): BlueprintRecord | undefined {
  if (kind === 'trigger') {
    return asRecords(flow.triggers).find((item, index) => (
      String(item.trigger_id ?? `${String(item.kind ?? 'trigger')}-${index}`) === localId
    ));
  }
  if (kind === 'initial-load') return asRecord(flow.initial_load);
  if (kind === 'state-owner') return asRecord(flow.state_owner);
  if (kind === 'recovery') return asRecord(flow.failure_recovery);
  if (kind === 'lifecycle') return asRecord(asRecord(flow.lifecycle_coverage)?.[localId]);
  const plural = `${kind}s`;
  return asRecords(flow[plural]).find(item => String(item[`${kind}_id`] ?? '') === localId);
}

function sameFields(expected: BlueprintRecord, actual: BlueprintRecord, fields: string[]): boolean {
  return fields.every(field => JSON.stringify(actual[field]) === JSON.stringify(expected[field]));
}

function localConstructed(
  flow: BlueprintRecord,
  state: BlueprintRecord,
  kind: string,
  localId: string,
): boolean {
  const expected = localItem(flow, kind, localId);
  if (!expected) return false;
  if (kind === 'trigger') {
    const triggerKind = String(expected.kind ?? '');
    return triggerKind === 'user_mutation'
      ? asRecords(state.mutations).some(item => item.kind === 'user')
      : Array.isArray(state.lifecycle_triggers) && state.lifecycle_triggers.includes(triggerKind);
  }
  if (kind === 'initial-load') {
    return asRecords(state.consumers).some(item => item.initial_load_ref === `initial-load:${localId}`);
  }
  if (kind === 'state-owner') return state.owner_ref === expected.ref && String(expected.ref) === localId;
  if (kind === 'recovery') {
    const actual = asRecord(state.failure_recovery);
    return Boolean(actual) && sameFields(expected, actual!, ['persistence_failure', 'subscription_failure', 'process_recreation']);
  }
  if (kind === 'lifecycle') {
    return expected.status === 'covered'
      && Array.isArray(state.lifecycle_triggers)
      && state.lifecycle_triggers.includes(localId);
  }
  const actual = asRecords(state[`${kind}s`]).find(item => String(item[`${kind}_id`] ?? '') === localId);
  if (!actual) return false;
  if (kind === 'mutation') return sameFields(expected, actual, ['kind', 'publication_ref', 'recovery_ref']);
  if (kind === 'publication') return sameFields(expected, actual, ['publication_id']);
  if (kind === 'subscription') {
    const consumer = asRecords(flow.consumers).find(item => `consumer:${String(item.consumer_id)}` === expected.consumer_ref);
    return sameFields(expected, actual, ['consumer_ref', 'replay_or_snapshot', 'cleanup', 'ordering'])
      && actual.publication_ref === consumer?.update_ref;
  }
  if (kind === 'consumer') return sameFields(expected, actual, ['initial_load_ref', 'update_ref']);
  return false;
}

export function validateComponentClosureRuntime(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
  rows: ComponentClosureCoverageRow[],
): ComponentClosureIssue[] {
  const issues: ComponentClosureIssue[] = [];
  for (const row of rows.filter(item => item.kind === 'runtime_flow' || item.kind.startsWith('runtime_'))) {
    const address = parseRuntimeAddress(row);
    if (!address) continue;
    const flow = runtimeFlow(inputs, address.flowId);
    if (!flow) {
      issues.push(closureIssue('component_closure_runtime_flow_unresolvable', row.obligation_id, `${address.flowAddress} 不在当前 runtime view。`, 'BLOCKER', 'reconcile_blueprint'));
      continue;
    }
    for (const unitId of row.owner_change_unit_ids) {
      const unit = inputs.currentUnits.find(item => item.changeUnit.change_unit_id === unitId);
      if (!unit) continue;
      const state = featureState(projectRoot, unit.input.feature_id, address.flowAddress);
      if (!state) {
        issues.push(closureIssue(
          'component_closure_runtime_flow_unconstructed',
          row.obligation_id,
          `${unit.input.feature_id} 的 contracts.state_management 未绑定 ${address.flowAddress}。`,
          'BLOCKER',
          'repair_feature_or_evidence',
        ));
        continue;
      }
      if (address.kind && address.localId && !localConstructed(flow, state, address.kind, address.localId)) {
        issues.push(closureIssue(
          'component_closure_runtime_local_edge_unconstructed',
          row.obligation_id,
          `${unit.input.feature_id} 未精确施工 ${address.kind}:${address.localId}。`,
          'BLOCKER',
          'repair_feature_or_evidence',
        ));
      }
      if (address.kind && !row.feature_mapping_refs.some(ref => ref.includes(`/local:${address.flowAddress}/${address.kind}:${address.localId}`))) {
        issues.push(closureIssue(
          'component_closure_runtime_local_mapping_missing',
          row.obligation_id,
          `${unit.input.feature_id} 缺 ${address.kind}:${address.localId} 的精确派生施工映射。`,
          'BLOCKER',
          'repair_feature_or_evidence',
        ));
      }
    }
    if (row.evidence_identities.length === 0) {
      issues.push(closureIssue(
        'component_closure_runtime_edge_evidence_missing',
        row.obligation_id,
        `${address.kind ?? 'flow'}:${address.localId ?? address.flowId} 缺精确 evidence identity。`,
        'BLOCKER',
        'repair_feature_or_evidence',
      ));
    }
    if (row.owner_change_unit_ids.length > 1 && row.evidence_identities.length === 0) {
      issues.push(closureIssue(
        'component_closure_runtime_combination_evidence_missing',
        row.obligation_id,
        `${address.flowAddress} 跨 ${row.owner_change_unit_ids.length} 个 CU，但没有共同组装观察。`,
        'BLOCKER',
        'repair_feature_or_evidence',
      ));
    }
  }
  return issues;
}
