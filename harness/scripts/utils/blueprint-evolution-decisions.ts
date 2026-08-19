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
    if (asStrings(decision.tests).length === 0) {
      out.push(issue('blueprint_evolution_decision_incomplete', `${base}.tests`, '演进决策卡必须有验证。'));
    }
    if (decision.human_decision === 'keep_direct' && !nonEmptyString(decision.reextract_condition)) {
      out.push(issue('blueprint_evolution_reextract_condition_missing', `${base}.reextract_condition`, '保持直接实现时必须记录再提取条件。'));
    }
    const namespace = String(decision.namespace ?? 'host_design');
    if (namespace !== 'host_design') {
      out.push(issue('blueprint_host_seam_namespace_violation', `${base}.namespace`, '宿主演进接缝只属于 host_design，不得进入 Maison provider/goal/CU namespace。'));
    }
  });
  return out;
}
