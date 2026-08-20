import { evaluateChangeUnitDependencies, detectChangeUnitDependencyCycles } from './change-unit-dependencies';
import { asRecord, asRecords, asStrings, nonEmptyString } from './component-blueprint-model';
import { ResolvedComponentClosureInputs } from './component-closure-inputs';
import { ChangeUnitCarryForwardVerdict } from './change-unit-reconciliation';
import { ComponentClosureCoverageRow, ComponentClosureIssue, closureIssue } from './component-closure-model';

export function validateComponentClosureAssembly(
  inputs: ResolvedComponentClosureInputs,
  rows: ComponentClosureCoverageRow[],
): ComponentClosureIssue[] {
  const issues: ComponentClosureIssue[] = [];
  const units = inputs.currentUnits.map(unit => unit.changeUnit);
  const completions = new Map(inputs.currentUnits.map(unit => [unit.changeUnit.change_unit_id, unit.completionObservation]));
  const carryForward = new Map<string, ChangeUnitCarryForwardVerdict>(inputs.currentUnits.map(unit => [
    unit.changeUnit.change_unit_id,
    { allowed: unit.input.carry_forward, reasons: unit.input.carry_forward_reasons },
  ]));
  for (const unit of units) {
    for (const dependencyIssue of evaluateChangeUnitDependencies(unit, units, completions, carryForward).issues) {
      issues.push(closureIssue(dependencyIssue.id, `change-unit:${unit.change_unit_id}`, dependencyIssue.message, 'BLOCKER', 'repair_or_add_change_unit'));
    }
    for (const blocker of unit.blockers) {
      issues.push(closureIssue(
        'component_closure_current_change_unit_blocked',
        `change-unit:${unit.change_unit_id}/blocker:${blocker.blocker_id}`,
        blocker.reason,
        'BLOCKER',
        blocker.gate === 'design' ? 'reconcile_blueprint' : 'resolve_authority_or_risk',
      ));
    }
  }
  for (const cycle of detectChangeUnitDependencyCycles(units)) {
    issues.push(closureIssue('component_closure_dependency_cycle', 'change-units', `CU dependency cycle：${cycle.join(' -> ')}`, 'BLOCKER', 'repair_or_add_change_unit'));
  }
  for (const row of rows.filter(item => item.kind === 'dependency' && item.required)) {
    if (row.owner_change_unit_ids.length > 1 && row.evidence_identities.length === 0) {
      issues.push(closureIssue(
        'component_closure_dependency_assembly_unverified',
        row.obligation_id,
        'exact provide 已解析，但跨 CU 新边缺共同 integration/combination evidence。',
        'BLOCKER',
        'repair_feature_or_evidence',
      ));
    }
  }
  const decisions = asRecords(asRecord(inputs.blueprint.blueprint.decisions_and_gaps)?.decisions);
  const structuredKinds = new Set(['migration', 'compatibility', 'feature_flag', 'dual_write', 'temporary_asset', 'controlled_fake', 'residual_risk']);
  const dispositions = new Set(['retain', 'migrate', 'remove', 'defer', 'accept']);
  for (const decision of decisions.filter(item => structuredKinds.has(String(item.kind)))) {
    const id = String(decision.decision_id ?? '?');
    const missing: string[] = [];
    if (!dispositions.has(String(decision.disposition))) missing.push('disposition');
    if (!nonEmptyString(decision.owner)) missing.push('owner');
    if (!nonEmptyString(decision.needed_by)) missing.push('needed_by');
    if (asStrings(decision.verification_refs).length === 0 && asStrings(decision.knowledge_refs).length === 0) missing.push('verification_refs|knowledge_refs');
    if (missing.length > 0) {
      issues.push(closureIssue(
        decision.kind === 'temporary_asset' || decision.kind === 'dual_write' || decision.kind === 'controlled_fake'
          ? 'component_closure_temporary_asset_exit_missing'
          : 'component_closure_assembly_disposition_incomplete',
        `decision:${id}`,
        `${String(decision.kind)} 缺结构化权威闭环字段：${missing.join(', ')}。`,
        'BLOCKER',
        'resolve_authority_or_risk',
      ));
    }
  }
  return issues;
}
