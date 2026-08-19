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
  for (const role of ['contract', 'provider', 'consumer'] as const) {
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

export function validateProviderEvolutionSequence(units: ChangeUnitArtifact[]): EvolutionSeamIssue[] {
  const providers = [...units]
    .filter(unit => unit.target_predicates.some(predicate => predicate.role === 'provider'))
    .sort((a, b) => a.priority - b.priority || a.change_unit_id.localeCompare(b.change_unit_id, 'en'));
  if (providers.length <= 1) return [];
  const firstConsumer = providers[0].target_predicates.find(predicate => predicate.role === 'consumer')?.description;
  const issues: EvolutionSeamIssue[] = [];
  for (const replacement of providers.slice(1)) {
    if (replacement.requires.length === 0) {
      issues.push({
        id: 'change_unit_provider_replacement_contract_requirement_missing',
        message: `${replacement.change_unit_id} 的后续 Provider 未显式 requires 既有稳定契约 provide。`,
        changeUnitId: replacement.change_unit_id,
        route: 'repair_change_unit',
      });
    }
    const consumer = replacement.target_predicates.find(predicate => predicate.role === 'consumer')?.description;
    if (consumer !== firstConsumer) {
      issues.push({
        id: 'change_unit_provider_replacement_consumer_change',
        message: `${replacement.change_unit_id} 改变既有 Consumer；必须先回 P1 调和/版本化。`,
        changeUnitId: replacement.change_unit_id,
        route: 'reconcile_blueprint',
      });
    }
  }
  return issues;
}
