import { BlueprintRecord, ComponentBlueprintRef, nonEmptyString } from './component-blueprint-model';
import { ChangeUnitArtifact } from './change-unit-model';

export interface EvolutionSeamIssue {
  id: string;
  message: string;
  changeUnitId?: string;
  route?: 'repair_change_unit' | 'reconcile_blueprint';
}

const EMPTY_ABSTRACTION = /^(store|eventbus|interface|provider|consumer)$/i;

export function validateChangeUnitEvolutionSeam(
  changeUnit: ChangeUnitArtifact,
  decisionRef: ComponentBlueprintRef,
  decision: BlueprintRecord,
): EvolutionSeamIssue[] {
  if (decision.kind !== 'evolution_candidate') return [];
  const issues: EvolutionSeamIssue[] = [];
  const predicates = changeUnit.target_predicates;
  const roles = new Set(predicates.map(item => item.role));
  const exactPriorContractRequirement = changeUnit.requires.some(requirement => (
    nonEmptyString(requirement.from_change_unit_id) && nonEmptyString(requirement.provide_id)
  ));
  const laterProvider = roles.has('provider')
    && !roles.has('contract')
    && !roles.has('consumer')
    && exactPriorContractRequirement;
  const requiredRoles = laterProvider ? ['provider'] as const : ['contract', 'provider', 'consumer'] as const;
  for (const role of requiredRoles) {
    const predicate = predicates.find(item => item.role === role);
    if (!predicate) {
      issues.push({ id: 'change_unit_evolution_vertical_role_missing', message: `${decisionRef.target.id} 缺 ${role} predicate。` });
      continue;
    }
    if (!nonEmptyString(predicate.description) || EMPTY_ABSTRACTION.test(predicate.description.trim())) {
      issues.push({ id: 'change_unit_evolution_empty_abstraction', message: `${role} predicate 只是空 Store/EventBus/interface 名称。` });
    }
    if (predicate.verification_refs.length === 0) {
      issues.push({ id: 'change_unit_evolution_verification_missing', message: `${role} predicate 缺 executable/contract verification。` });
    }
  }
  for (const field of ['stable_contract', 'provider', 'consumer'] as const) {
    if (!nonEmptyString(decision[field])) {
      issues.push({ id: 'change_unit_evolution_decision_incomplete', message: `${decisionRef.target.id} 缺真实 ${field}。` });
    }
  }
  if (changeUnit.verification_refs.length === 0) {
    issues.push({ id: 'change_unit_evolution_verification_missing', message: 'host evolution seam 缺 CU 级 executable/contract verification。' });
  }
  return issues;
}
