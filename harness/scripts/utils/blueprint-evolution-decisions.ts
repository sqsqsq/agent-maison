import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';

export function validateEvolutionDecisions(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const decisions = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions);
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
