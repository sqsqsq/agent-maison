import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  getId,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { stableAddressIndex } from './blueprint-addressing';

export function validateCrossViewRelations(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  let index: Map<string, BlueprintRecord>;
  try {
    index = stableAddressIndex(blueprint);
  } catch (error) {
    return [issue('blueprint_address_duplicate', '$', (error as Error).message)];
  }
  asRecords(blueprint.relations).forEach((relation, relationIndex) => {
    for (const endpoint of ['from', 'to'] as const) {
      const ref = relation[endpoint];
      if (!nonEmptyString(ref) || !index.has(ref)) {
        out.push(issue('blueprint_relation_endpoint_missing', `$.relations[${relationIndex}].${endpoint}`, `关系端点无法解析：${String(ref)}。`));
      }
    }
    if (asStrings(relation.verification_refs).length === 0) {
      out.push(issue('blueprint_relation_verification_missing', `$.relations[${relationIndex}].verification_refs`, '跨视图关系必须有 verification_refs。'));
    }
  });
  if (asRecords(blueprint.relations).length === 0) {
    out.push(issue('blueprint_relations_empty', '$.relations', 'App 蓝图必须有可寻址的跨视图关系，不能用空集合声明完整。'));
  }

  const views = asRecords(blueprint.design_views);
  views.forEach((view, viewIndex) => {
    for (const ref of asStrings(view.decisions_and_gaps)) {
      if (!index.has(ref) || !(ref.startsWith('decision:') || ref.startsWith('gap:'))) {
        out.push(issue(
          'blueprint_cross_view_ref_missing',
          `$.design_views[${viewIndex}].decisions_and_gaps`,
          `view 的 decision/gap ref 无法解析或类型不符：${ref}。`,
        ));
      }
    }
  });
  const deploymentApplicable = views.find(view => view.view_id === 'deployment')?.applicability === 'applicable';
  const scenarios = views.find(view => view.view_id === 'scenarios');
  asRecords(scenarios?.nodes).forEach((scenario, indexInView) => {
    const base = `$.design_views[scenarios].nodes[${indexInView}]`;
    const required: Array<[string, boolean]> = [
      ['logical_refs', asStrings(scenario.logical_refs).length > 0],
      ['runtime_refs', asStrings(scenario.runtime_refs).length > 0],
      ['development_owner_ref', nonEmptyString(scenario.development_owner_ref)],
    ];
    if (deploymentApplicable) required.push(['deployment_refs', asStrings(scenario.deployment_refs).length > 0]);
    for (const [field, ok] of required) {
      if (!ok) out.push(issue('blueprint_scenario_trace_missing', `${base}.${field}`, `scenario 缺 ${field} 跨视图追踪。`));
    }
    for (const ref of asStrings(scenario.logical_refs)) {
      if (!index.has(ref) || !(ref.startsWith('view:logical/node:') || ref.startsWith('contract:'))) {
        out.push(issue('blueprint_cross_view_ref_missing', `${base}.logical_refs`, `logical ref 无法解析或类型不符：${ref}。`));
      }
    }
    for (const ref of asStrings(scenario.runtime_refs)) {
      if (!index.has(ref) || !ref.startsWith('view:runtime/')) {
        out.push(issue('blueprint_cross_view_ref_missing', `${base}.runtime_refs`, `runtime ref 无法解析或类型不符：${ref}。`));
      }
    }
    if (nonEmptyString(scenario.development_owner_ref)
      && (!index.has(scenario.development_owner_ref) || !scenario.development_owner_ref.startsWith('view:development/node:'))) {
      out.push(issue('blueprint_cross_view_ref_missing', `${base}.development_owner_ref`, `development owner 无法解析：${scenario.development_owner_ref}。`));
    }
    for (const ref of asStrings(scenario.deployment_refs)) {
      if (!index.has(ref) || !ref.startsWith('view:deployment/')) {
        out.push(issue('blueprint_cross_view_ref_missing', `${base}.deployment_refs`, `deployment ref 无法解析：${ref}。`));
      }
    }
  });

  const runtime = views.find(view => view.view_id === 'runtime');
  asRecords(runtime?.runtime_data_flows).forEach((flow, flowIndex) => {
    if (asStrings(flow.logical_contract_refs).length === 0) {
      out.push(issue('blueprint_runtime_logical_contract_missing', `$.design_views[runtime].runtime_data_flows[${flowIndex}].logical_contract_refs`, 'runtime flow 必须引用 logical contract。'));
    }
    for (const ref of asStrings(flow.logical_contract_refs)) {
      if (!index.has(ref) || !ref.startsWith('contract:')) {
        out.push(issue('blueprint_cross_view_ref_missing', `$.design_views[runtime].runtime_data_flows[${flowIndex}].logical_contract_refs`, `logical contract ref 无法解析：${ref}。`));
      }
    }
    if (!nonEmptyString(flow.development_owner_ref)) {
      out.push(issue('blueprint_runtime_development_owner_missing', `$.design_views[runtime].runtime_data_flows[${flowIndex}].development_owner_ref`, 'runtime flow 必须引用 development owner。'));
    }
    if (nonEmptyString(flow.development_owner_ref)
      && (!index.has(flow.development_owner_ref) || !flow.development_owner_ref.startsWith('view:development/node:'))) {
      out.push(issue('blueprint_cross_view_ref_missing', `$.design_views[runtime].runtime_data_flows[${flowIndex}].development_owner_ref`, `development owner ref 无法解析：${flow.development_owner_ref}。`));
    }
    for (const ref of asStrings(flow.external_contract_refs)) {
      if (!index.has(ref) || !ref.startsWith('contract:')) {
        out.push(issue('blueprint_cross_view_ref_missing', `$.design_views[runtime].runtime_data_flows[${flowIndex}].external_contract_refs`, `external contract ref 无法解析：${ref}。`));
      }
    }
    const sourceOfTruth = asRecord(flow.source_of_truth);
    for (const [field, refs] of [
      ['authority', nonEmptyString(sourceOfTruth?.authority) ? [sourceOfTruth.authority] : []],
      ['projections_and_caches', asStrings(sourceOfTruth?.projections_and_caches)],
      ['state_owner.ref', nonEmptyString(asRecord(flow.state_owner)?.ref) ? [asRecord(flow.state_owner)!.ref] : []],
    ] as Array<[string, string[]]>) {
      for (const ref of refs) {
        if (!index.has(ref)) {
          out.push(issue('blueprint_cross_view_ref_missing', `$.design_views[runtime].runtime_data_flows[${flowIndex}].${field}`, `runtime ref 无法解析：${ref}。`));
        }
      }
    }
  });
  for (const viewId of ['runtime', 'development'] as const) {
    const view = views.find(item => item.view_id === viewId);
    asRecords(view?.nodes).forEach((node, nodeIndex) => {
      const refs = asStrings(node.design_basis_refs);
      if (refs.length === 0) {
        out.push(issue('blueprint_design_basis_missing', `$.design_views[${viewId}].nodes[${nodeIndex}].design_basis_refs`, `${viewId} 节点必须有设计依据。`));
      }
      for (const ref of refs) {
        if (!index.has(ref)) {
          out.push(issue(
            'blueprint_cross_view_ref_missing',
            `$.design_views[${viewId}].nodes[${nodeIndex}].design_basis_refs`,
            `${viewId} 节点的设计依据无法解析：${ref}。`,
          ));
        }
      }
    });
  }

  asRecords(blueprint.semantic_conflicts).forEach((conflict, conflictIndex) => {
    if (conflict.status !== 'resolved') {
      out.push(issue('blueprint_cross_view_semantic_conflict', `$.semantic_conflicts[${conflictIndex}]`, `术语/契约/state owner/失败语义冲突未解决：${String(conflict.kind)}。`));
    }
  });

  const ownerByDomain = new Map<string, string>();
  asRecords(runtime?.runtime_data_flows).forEach((flow, flowIndex) => {
    const owner = asRecord(flow.state_owner)?.ref;
    if (!nonEmptyString(owner)) return;
    for (const domain of asStrings(flow.data_domain_refs)) {
      const existing = ownerByDomain.get(domain);
      if (existing && existing !== owner) {
        out.push(issue('runtime_flow_state_owner_conflict', `$.design_views[runtime].runtime_data_flows[${flowIndex}].state_owner.ref`, `data domain ${domain} 同时声明 owner=${existing} 与 ${owner}。`));
      }
      ownerByDomain.set(domain, owner);
    }
  });
  return out;
}
