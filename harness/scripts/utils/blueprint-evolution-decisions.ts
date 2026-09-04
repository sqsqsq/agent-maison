import * as fs from 'fs';
import * as path from 'path';
import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { isUiComponent, selectionShapeIssues, readComponentIndex, componentDependencyAllowed } from './component-assets';
import { relComponentIndex, relComponentCatalog } from '../../config';

export function validateEvolutionDecisions(blueprint: BlueprintRecord, projectRoot?: string): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const decisions = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions);
  const development = asRecords(blueprint.design_views).find(v => v.view_id === 'development');
  const selections = decisions.filter(d => d.kind === 'component_asset_selection');
  let index;
  if (projectRoot) {
    try { index = readComponentIndex(projectRoot); }
    catch (error) { out.push(issue('blueprint_component_index_invalid', '$.decisions_and_gaps', (error as Error).message)); }
  }
  for (const decision of selections) {
    const base = `$.decisions_and_gaps.decisions[${decisions.indexOf(decision)}]`;
    const shape = selectionShapeIssues({ resolution: decision.asset_resolution,
      ...(decision.component_ref === undefined ? {} : { component_ref: decision.component_ref }),
      ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }) });
    for (const message of shape) out.push(issue('blueprint_asset_selection_invalid', base, message));
    const nodeId = /^view:development\/node:(.+)$/.exec(String(decision.target_ref))?.[1];
    const node = asRecords(development?.nodes).find(n => n.node_id === nodeId);
    if (!nodeId || !node || !isUiComponent(node)) out.push(issue('blueprint_asset_target_invalid', `${base}.target_ref`, '选型必须指向既有 development 页面/UI 组件节点。'));
    if (development?.evolution_impact === 'verified_unchanged') out.push(issue('blueprint_view_unchanged_masks_change', base, 'verified_unchanged development 不得产生选型决策。'));
    if (asStrings(decision.verification_refs).length === 0 || !nonEmptyString(decision.owner)) out.push(issue('blueprint_asset_selection_invalid', base, '选型必须有 owner 与 verification_refs。'));
    if (projectRoot) {
      if (!index) out.push(issue('blueprint_asset_index_missing', base, '索引不可用，不得伪造选型。'));
      const source = String(asRecord(decision.provenance)?.source_ref ?? '');
      const sourceFile = [relComponentIndex(projectRoot), relComponentCatalog(projectRoot)].find(p => source === p || source.startsWith(`${p}#`));
      if (!sourceFile) out.push(issue('blueprint_asset_source_invalid', `${base}.provenance.source_ref`, 'provenance 必须指向配置的 index/catalog 证据；component_ref 才是选中 ID。'));
      else {
        try { fs.readFileSync(path.join(projectRoot, sourceFile), 'utf8'); }
        catch { out.push(issue('blueprint_asset_source_unreadable', `${base}.provenance.source_ref`, `选型实际引用的证据文件不可读：${sourceFile}`)); }
      }
      const asset = index?.components.find(c => c.id === decision.component_ref);
      if (decision.component_ref !== undefined && !asset) out.push(issue('blueprint_asset_ref_missing', `${base}.component_ref`, 'component_ref 不在索引内。'));
      if (asset && node && !componentDependencyAllowed(projectRoot, String(node.module ?? ''), asset.module)) {
        if (!['open_decision', 'blocker'].includes(String(decision.status))) out.push(issue('blueprint_asset_dependency_illegal', base, '依赖不合法：换选 > plan 声明下沉 > 请求用户批准新边；未批准不得施工。'));
        const gap = asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps).find(g => asStrings(g.verification_refs).includes(`decision:${decision.decision_id}`));
        if (!gap) out.push(issue('blueprint_asset_dependency_gap_missing', base, '非法依赖必须有带 owner/needed_by 的 gap，verification_refs 引用该 decision。'));
      }
    }
  }
  if (index && development?.evolution_impact === 'changed') {
    for (const node of asRecords(development.nodes).filter(isUiComponent)) {
      const target = `view:development/node:${node.node_id}`;
      if (selections.filter(d => d.target_ref === target).length !== 1) out.push(issue('blueprint_asset_selection_missing', '$.decisions_and_gaps.decisions', `${target} 必须有且仅有一个组件选型决策。`));
    }
  }
  decisions.forEach((decision, index) => {
    if (decision.kind !== 'evolution_candidate') return;
    const base = `$.decisions_and_gaps.decisions[${index}]`;
    if (asStrings(decision.variation_evidence).length === 0) {
      out.push(issue('blueprint_evolution_candidate_evidence_missing', `${base}.variation_evidence`, '无变化证据的候选不得进入决策卡。'));
    }
    for (const field of ['impact', 'stable_contract', 'provider', 'consumer', 'binding_time', 'owner', 'failure_semantics', 'human_decision']) {
      if (!nonEmptyString(decision[field])) out.push(issue('blueprint_evolution_decision_incomplete', `${base}.${field}`, `演进决策卡缺 ${field}。`));
    }
    if (!['establish_seam', 'keep_direct'].includes(String(decision.human_decision))) {
      out.push(issue('blueprint_evolution_human_decision_invalid', `${base}.human_decision`, 'human_decision 只能是 establish_seam 或 keep_direct。'));
    }
    if (asStrings(decision.tests).length === 0) {
      out.push(issue('blueprint_evolution_decision_incomplete', `${base}.tests`, '演进决策卡必须有验证。'));
    }
    if (decision.human_decision === 'keep_direct' && !nonEmptyString(decision.reextract_condition)) {
      out.push(issue('blueprint_evolution_reextract_condition_missing', `${base}.reextract_condition`, '保持直接实现时必须记录再提取条件。'));
    }
    if (decision.human_decision === 'establish_seam') {
      const proofs = asRecord(decision.closure_proofs);
      const requiredProofs = ['contract_compatibility', 'provider_replacement', 'absence_failure', 'consumer_no_bypass'];
      const proofRefs = requiredProofs.map(proof => String(proofs?.[proof] ?? '')).filter(Boolean);
      if (!proofs || requiredProofs.some(proof => !nonEmptyString(proofs[proof]))) {
        out.push(issue('blueprint_evolution_closure_proofs_incomplete', `${base}.closure_proofs`, 'establish_seam 必须为 contract compatibility、Provider replacement、absence/failure、consumer no-bypass 各绑定一个精确证明引用。'));
      } else if (new Set(proofRefs).size !== requiredProofs.length) {
        out.push(issue('blueprint_evolution_closure_proofs_aliased', `${base}.closure_proofs`, '四项接缝证明必须使用四个独立 identity，不得复用同一引用自证。'));
      } else if (proofRefs.some(ref => !asStrings(decision.tests).includes(ref))) {
        out.push(issue('blueprint_evolution_closure_proof_not_tested', `${base}.closure_proofs`, '每个接缝证明 identity 必须同时出现在 decision.tests，不能用源码字符串或无关文件替代。'));
      }
    }
    const namespace = String(decision.namespace ?? 'host_design');
    if (namespace !== 'host_design') {
      out.push(issue('blueprint_host_seam_namespace_violation', `${base}.namespace`, '宿主演进接缝只属于 host_design，不得进入 Maison provider/goal/CU namespace。'));
    }
  });
  return out;
}
