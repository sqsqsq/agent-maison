import {
  BlueprintRecord,
  ComponentBlueprintResolutionError,
  ComponentBlueprintRef,
  asRecord,
  asRecords,
  findById,
  getId,
  nonEmptyString,
} from './component-blueprint-model';

function viewsOf(blueprint: BlueprintRecord): BlueprintRecord[] {
  return asRecords(blueprint.design_views);
}

function findView(blueprint: BlueprintRecord, viewId: string): BlueprintRecord | undefined {
  return findById(viewsOf(blueprint), viewId, 'view_id');
}

function assertOptionalView(blueprint: BlueprintRecord, viewId: string | undefined, kind: string): void {
  if (viewId && !findView(blueprint, viewId)) {
    throw new ComponentBlueprintResolutionError(
      'component_blueprint_target_view_missing',
      `${kind} 的可选关联 view_id=${viewId} 不存在。`,
    );
  }
}

export function resolveBlueprintTarget(
  blueprint: BlueprintRecord,
  target: ComponentBlueprintRef['target'],
): unknown {
  const viewId = target.view_id;
  let resolved: unknown;
  switch (target.kind) {
    case 'blueprint':
      if (target.id !== blueprint.blueprint_id) {
        throw new ComponentBlueprintResolutionError(
          'component_blueprint_target_missing',
          `blueprint target.id=${target.id} 必须等于 blueprint_id=${String(blueprint.blueprint_id)}。`,
        );
      }
      resolved = blueprint;
      break;
    case 'view':
      resolved = findView(blueprint, target.id);
      break;
    case 'node': {
      const view = findView(blueprint, viewId!);
      resolved = view && findById(view.nodes, target.id, 'node_id');
      break;
    }
    case 'flow': {
      const view = findView(blueprint, viewId!);
      resolved = view && findById(view.runtime_data_flows, target.id, 'flow_id');
      break;
    }
    case 'relation':
      assertOptionalView(blueprint, viewId, 'relation');
      resolved = findById(blueprint.relations, target.id, 'relation_id');
      if (resolved) {
        const relation = resolved as BlueprintRecord;
        const addresses = stableAddressIndex(blueprint);
        for (const endpoint of ['from', 'to'] as const) {
          if (!nonEmptyString(relation[endpoint]) || !addresses.has(relation[endpoint])) {
            throw new ComponentBlueprintResolutionError(
              'component_blueprint_relation_endpoint_missing',
              `relation=${target.id} 的 ${endpoint}=${String(relation[endpoint])} 无法解析。`,
            );
          }
        }
      }
      break;
    case 'decision': {
      assertOptionalView(blueprint, viewId, 'decision');
      const decisionsAndGaps = asRecord(blueprint.decisions_and_gaps);
      resolved = findById(decisionsAndGaps?.decisions, target.id, 'decision_id');
      break;
    }
    case 'contract':
      assertOptionalView(blueprint, viewId, 'contract');
      resolved = findById(blueprint.contracts, target.id, 'contract_id');
      break;
  }
  if (!resolved) {
    throw new ComponentBlueprintResolutionError(
      'component_blueprint_target_missing',
      `无法解析 target kind=${target.kind} id=${target.id}${viewId ? ` view_id=${viewId}` : ''}。`,
    );
  }
  return resolved;
}

export function stableAddressIndex(blueprint: BlueprintRecord): Map<string, BlueprintRecord> {
  const index = new Map<string, BlueprintRecord>();
  const add = (address: string, record: BlueprintRecord): void => {
    if (index.has(address)) {
      throw new ComponentBlueprintResolutionError('blueprint_address_duplicate', `稳定地址重复：${address}`);
    }
    index.set(address, record);
  };
  if (nonEmptyString(blueprint.blueprint_id)) add(`blueprint:${blueprint.blueprint_id}`, blueprint);
  for (const view of viewsOf(blueprint)) {
    const viewId = getId(view, 'view_id');
    if (!viewId) continue;
    add(`view:${viewId}`, view);
    for (const node of asRecords(view.nodes)) {
      const nodeId = getId(node, 'node_id');
      if (nodeId) add(`view:${viewId}/node:${nodeId}`, node);
    }
    for (const flow of asRecords(view.runtime_data_flows)) {
      const flowId = getId(flow, 'flow_id');
      if (flowId) add(`view:${viewId}/flow:${flowId}`, flow);
    }
  }
  for (const relation of asRecords(blueprint.relations)) {
    const id = getId(relation, 'relation_id');
    if (id) add(`relation:${id}`, relation);
  }
  const decisionsAndGaps = asRecord(blueprint.decisions_and_gaps);
  const decisions = decisionsAndGaps?.decisions;
  for (const decision of asRecords(decisions)) {
    const id = getId(decision, 'decision_id');
    if (id) add(`decision:${id}`, decision);
  }
  for (const gap of asRecords(decisionsAndGaps?.gaps)) {
    const id = getId(gap, 'gap_id');
    if (id) add(`gap:${id}`, gap);
  }
  for (const contract of asRecords(blueprint.contracts)) {
    const id = getId(contract, 'contract_id');
    if (id) add(`contract:${id}`, contract);
  }
  return index;
}
