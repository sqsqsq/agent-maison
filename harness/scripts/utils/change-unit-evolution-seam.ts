import { BlueprintRecord, ComponentBlueprintRef, nonEmptyString } from './component-blueprint-model';
import { ChangeUnitArtifact, sameBlueprintTarget } from './change-unit-model';

export interface EvolutionSeamIssue {
  id: string;
  message: string;
  changeUnitId?: string;
  route?: 'repair_change_unit' | 'reconcile_blueprint';
}

const EMPTY_ABSTRACTION = /^(store|eventbus|interface|provider|consumer)$/i;

export function providerSuppliesEvolutionContract(
  provider: ChangeUnitArtifact,
  decisionRef: ComponentBlueprintRef,
  provideId: string,
): boolean {
  const referencesDecision = provider.design_refs.some(ref => sameBlueprintTarget(ref, decisionRef));
  const contractProvides = provider.target_predicates.some(predicate => (
    predicate.role === 'contract' && predicate.provide_ids.includes(provideId)
  ));
  const nonContractProvides = provider.target_predicates.some(predicate => (
    predicate.role !== 'contract' && predicate.provide_ids.includes(provideId)
  ));
  return referencesDecision && contractProvides && !nonContractProvides;
}

export function validateChangeUnitEvolutionSeam(
  changeUnit: ChangeUnitArtifact,
  decisionRef: ComponentBlueprintRef,
  decision: BlueprintRecord,
  units: ChangeUnitArtifact[] = [],
): EvolutionSeamIssue[] {
  if (decision.kind !== 'evolution_candidate'
    || decision.status !== 'decided_with_authority'
    || decision.human_decision !== 'establish_seam') return [];
  const issues: EvolutionSeamIssue[] = [];
  const predicates = changeUnit.target_predicates;
  const roles = new Set(predicates.map(item => item.role));
  const laterProvider = roles.has('provider')
    && !roles.has('contract')
    && !roles.has('consumer');
  if (laterProvider) {
    const exactPriorContractRequirement = changeUnit.requires.some(requirement => {
      if (!nonEmptyString(requirement.from_change_unit_id) || !nonEmptyString(requirement.provide_id)) return false;
      const provider = units.find(unit => unit.change_unit_id === requirement.from_change_unit_id);
      return Boolean(provider && providerSuppliesEvolutionContract(provider, decisionRef, requirement.provide_id));
    });
    if (!exactPriorContractRequirement) {
      issues.push({
        id: 'change_unit_evolution_contract_requirement_invalid',
        message: `${decisionRef.target.id} 的后续 Provider 必须精确 requires 同 decision 前置 CU 的 contract-only provide。`,
      });
    }
  }
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
