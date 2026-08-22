import { ChangeUnitArtifact } from './change-unit-model';
import { ChangeUnitCompletionObservation } from './change-unit-completion';
import { ChangeUnitCarryForwardVerdict } from './change-unit-reconciliation';

export interface ChangeUnitDependencyIssue {
  id: string;
  changeUnitId: string;
  message: string;
}

export interface ChangeUnitDependencyResult {
  satisfied: boolean;
  issues: ChangeUnitDependencyIssue[];
}

export function evaluateChangeUnitDependencies(
  changeUnit: ChangeUnitArtifact,
  units: ChangeUnitArtifact[],
  completions: Map<string, ChangeUnitCompletionObservation>,
  carryForward: Map<string, ChangeUnitCarryForwardVerdict>,
): ChangeUnitDependencyResult {
  const issues: ChangeUnitDependencyIssue[] = [];
  // M5A §5.5/§8.5：requires/provides 满足域限定同一 blueprint_id 工作区。以
  // (blueprint_id, change_unit_id) 复合键建表（blueprint_id 是安全路径段、不含冒号，
  // 分隔符无歧义）——另一工作区的同名 CU 永不可见（ref 层失败 + 派生层不可见双证，
  // proof 3）。
  const workspaceKey = (blueprintId: string, changeUnitId: string): string => `${blueprintId}:${changeUnitId}`;
  const byId = new Map(units.map(unit => [workspaceKey(unit.blueprint_id, unit.change_unit_id), unit]));
  for (const requirement of changeUnit.requires) {
    const provider = byId.get(workspaceKey(changeUnit.blueprint_id, requirement.from_change_unit_id));
    if (!provider) {
      issues.push({ id: 'change_unit_dependency_provider_missing', changeUnitId: changeUnit.change_unit_id, message: `provider CU ${requirement.from_change_unit_id} 不存在于同一工作区 ${changeUnit.blueprint_id}。` });
      continue;
    }
    if (!provider.provides.some(item => item.provide_id === requirement.provide_id)) {
      issues.push({ id: 'change_unit_dependency_provide_mismatch', changeUnitId: changeUnit.change_unit_id, message: `${requirement.from_change_unit_id} 未声明精确 provide_id=${requirement.provide_id}。` });
      continue;
    }
    if (completions.get(provider.change_unit_id)?.state !== 'VALID') {
      issues.push({ id: 'change_unit_dependency_completion_not_valid', changeUnitId: changeUnit.change_unit_id, message: `${provider.change_unit_id} 的派生 Feature completion 非 VALID。` });
      continue;
    }
    if (carryForward.get(provider.change_unit_id)?.allowed !== true) {
      issues.push({ id: 'change_unit_dependency_carry_forward_rejected', changeUnitId: changeUnit.change_unit_id, message: `${provider.change_unit_id} 历史 targets 未全部在当前蓝图获准。` });
    }
  }
  return { satisfied: issues.length === 0, issues };
}

export function detectChangeUnitDependencyCycles(units: ChangeUnitArtifact[]): string[][] {
  const graph = new Map(units.map(unit => [unit.change_unit_id, unit.requires.map(req => req.from_change_unit_id)]));
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  const connect = (id: string): void => {
    indices.set(id, nextIndex);
    lowLinks.set(id, nextIndex);
    nextIndex++;
    stack.push(id);
    onStack.add(id);
    for (const next of graph.get(id) ?? []) {
      if (!graph.has(next)) continue;
      if (!indices.has(next)) {
        connect(next);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(next)!));
      } else if (onStack.has(next)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(next)!));
      }
    }
    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    component.sort((a, b) => a.localeCompare(b, 'en'));
    const selfLoop = component.length === 1 && (graph.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfLoop) components.push(component);
  };
  for (const id of [...graph.keys()].sort((a, b) => a.localeCompare(b, 'en'))) {
    if (!indices.has(id)) connect(id);
  }
  return components;
}
