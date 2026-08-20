import { asRecord, asRecords, asStrings, nonEmptyString } from './component-blueprint-model';
import { blueprintRefAddress } from './change-unit-model';
import { validateChangeUnitEvolutionSeam } from './change-unit-evolution-seam';
import { createClosureEvidenceIdentity } from './component-closure-evidence';
import { ResolvedComponentClosureInputs } from './component-closure-inputs';
import { ComponentClosureIssue, closureIssue } from './component-closure-model';

const FAILURE_SEMANTICS = new Set(['degrade', 'disable', 'block', 'fail_closed']);
const PROOF_NAMES = ['contract_compatibility', 'provider_replacement', 'absence_failure', 'consumer_no_bypass'] as const;

export function validateComponentClosureEvolutionSeams(
  projectRoot: string,
  inputs: ResolvedComponentClosureInputs,
): ComponentClosureIssue[] {
  const issues: ComponentClosureIssue[] = [];
  const decisions = asRecords(asRecord(inputs.blueprint.blueprint.decisions_and_gaps)?.decisions)
    .filter(decision => decision.kind === 'evolution_candidate'
      && decision.status === 'decided_with_authority'
      && decision.human_decision === 'establish_seam');
  for (const decision of decisions) {
    const decisionId = String(decision.decision_id ?? '');
    const address = `decision:${decisionId}`;
    const owners = inputs.currentUnits.filter(unit => unit.changeUnit.design_refs.some(ref => blueprintRefAddress(ref) === address));
    if (owners.length === 0) {
      issues.push(closureIssue('component_closure_seam_owner_missing', address, '明确 establish_seam 的 decision 没有当前 CU owner。', 'BLOCKER', 'repair_or_add_change_unit'));
      continue;
    }
    if (!FAILURE_SEMANTICS.has(String(decision.failure_semantics))) {
      issues.push(closureIssue(
        'component_closure_seam_failure_semantics_invalid',
        address,
        'establish_seam 的 Provider absence/failure 必须明确为 degrade|disable|block|fail_closed。',
        'BLOCKER',
        'reconcile_blueprint',
      ));
    }
    for (const owner of owners) {
      const decisionRef = owner.changeUnit.design_refs.find(ref => blueprintRefAddress(ref) === address)!;
      for (const seamIssue of validateChangeUnitEvolutionSeam(
        owner.changeUnit,
        decisionRef,
        decision,
        inputs.currentUnits.map(unit => unit.changeUnit),
      )) {
        issues.push(closureIssue(
          `component_closure_seam_${seamIssue.id}`,
          `change-unit:${owner.changeUnit.change_unit_id}/${address}`,
          seamIssue.message,
          'BLOCKER',
          seamIssue.route === 'reconcile_blueprint' ? 'reconcile_blueprint' : 'repair_or_add_change_unit',
        ));
      }
    }
    if (!nonEmptyString(decision.stable_contract) || !nonEmptyString(decision.provider)) {
      issues.push(closureIssue('component_closure_seam_contract_incomplete', address, '接缝缺 stable_contract/provider 权威定义。', 'BLOCKER', 'reconcile_blueprint'));
    }
    const proofs = asRecord(decision.closure_proofs);
    const proofRefs = PROOF_NAMES.map(proof => String(proofs?.[proof] ?? '')).filter(Boolean);
    const decisionTests = new Set(asStrings(decision.tests));
    if (!proofs
      || proofRefs.length !== PROOF_NAMES.length
      || new Set(proofRefs).size !== PROOF_NAMES.length
      || proofRefs.some(ref => !decisionTests.has(ref))) {
      issues.push(closureIssue(
        'component_closure_seam_proof_set_incomplete',
        `${address}/closure_proofs`,
        '四项接缝证明必须各自绑定独立、精确的 project-relative file#symbol identity。',
        'BLOCKER',
        'reconcile_blueprint',
      ));
      continue;
    }
    const ownerFeatureIds = owners.map(owner => owner.input.feature_id);
    for (const proof of PROOF_NAMES) {
      const rawRef = String(proofs[proof]);
      if (!createClosureEvidenceIdentity(
        projectRoot,
        `obligation:seam:${decisionId}:${proof}`,
        rawRef,
        ownerFeatureIds,
        'integration_combination',
      )) {
        issues.push(closureIssue(
          'component_closure_seam_proof_unresolvable',
          `${address}/closure_proofs/${proof}`,
          `${proof} 未解析到可由既有施工证据门消费的真实 file#symbol：${rawRef}。`,
          'BLOCKER',
          'repair_feature_or_evidence',
        ));
      }
    }
  }
  return issues;
}
