import {
  BlueprintRecord,
  ComponentBlueprintRef,
  asRecord,
  asRecords,
  asStrings,
  getId,
  nonEmptyString,
} from './component-blueprint-model';
import { resolveComponentBlueprintRef } from './component-blueprint-path';
import { stableAddressIndex } from './blueprint-addressing';
import {
  ChangeUnitIssue,
  ChangeUnitRecord,
  blueprintRefAddress,
  changeUnitIssue,
  changeUnitRecords,
  sameBlueprintIdentity,
} from './change-unit-model';

const DIRECT_REF_FIELDS = [
  'design_basis_refs',
  'decisions_and_gaps',
  'logical_refs',
  'runtime_refs',
  'external_contract_refs',
  'logical_contract_refs',
] as const;

export type ChangeUnitConstructabilityVerdict = 'constructable' | 'blocked' | 'reconcile_blueprint';

export interface ChangeUnitDesignGateOptions {
  blueprintInvalidatingFacts?: string[];
}

export interface ChangeUnitDesignGateResult {
  verdict: ChangeUnitConstructabilityVerdict;
  issues: ChangeUnitIssue[];
  explicitAddresses: string[];
  requiredAddresses: string[];
}

function targetRef(owner: ComponentBlueprintRef, address: string): ComponentBlueprintRef | undefined {
  const viewNodeOrFlow = /^view:([^/]+)\/(node|flow):(.+)$/.exec(address);
  if (viewNodeOrFlow) {
    return {
      ...owner,
      target: { kind: viewNodeOrFlow[2] as 'node' | 'flow', id: viewNodeOrFlow[3], view_id: viewNodeOrFlow[1] },
    };
  }
  const topLevel = /^(blueprint|view|relation|decision|contract):(.+)$/.exec(address);
  if (!topLevel) return undefined;
  return {
    ...owner,
    target: {
      kind: topLevel[1] as ComponentBlueprintRef['target']['kind'],
      id: topLevel[2],
    },
  };
}

function linkedAddresses(record: BlueprintRecord): string[] {
  const out: string[] = [];
  for (const field of DIRECT_REF_FIELDS) out.push(...asStrings(record[field]));
  for (const field of ['development_owner_ref', 'consumer_ref', 'publication_ref', 'recovery_ref', 'update_ref']) {
    if (nonEmptyString(record[field])) out.push(record[field]);
  }
  const source = asRecord(record.source_of_truth);
  if (source) {
    if (nonEmptyString(source.authority)) out.push(source.authority);
    out.push(...asStrings(source.projections_and_caches));
  }
  const owner = asRecord(record.state_owner);
  if (owner && nonEmptyString(owner.ref)) out.push(owner.ref);
  if (nonEmptyString(record.from)) out.push(record.from);
  if (nonEmptyString(record.to)) out.push(record.to);
  return out;
}

function dispositionBlocks(record: BlueprintRecord): boolean {
  return record.status === 'open_decision'
    || record.status === 'blocker'
    || record.disposition === 'open_decision'
    || record.disposition === 'blocker'
    || record.knowledge_state === 'unknown';
}

function contractIsAdmitted(record: BlueprintRecord): boolean {
  const provenance = asRecord(record.provenance);
  return provenance?.evidence_strength === 'authoritative';
}

function deriveClosure(blueprint: BlueprintRecord, roots: string[]): Set<string> {
  const index = stableAddressIndex(blueprint);
  const required = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const address of [...required]) {
      const record = index.get(address);
      if (!record) continue;
      for (const linked of linkedAddresses(record)) {
        if (index.has(linked) && !required.has(linked)) {
          required.add(linked);
          changed = true;
        }
      }
    }
    for (const relation of asRecords(blueprint.relations)) {
      const relationId = getId(relation, 'relation_id');
      if (!relationId) continue;
      const from = nonEmptyString(relation.from) ? relation.from : '';
      const to = nonEmptyString(relation.to) ? relation.to : '';
      if ((required.has(from) || required.has(to)) && !required.has(`relation:${relationId}`)) {
        required.add(`relation:${relationId}`);
        changed = true;
      }
    }
    const scenarios = asRecords(asRecords(blueprint.design_views).find(view => view.view_id === 'scenarios')?.nodes);
    for (const scenario of scenarios) {
      const refs = linkedAddresses(scenario);
      if (!refs.some(ref => required.has(ref))) continue;
      const scenarioId = getId(scenario, 'node_id');
      if (scenarioId && !required.has(`view:scenarios/node:${scenarioId}`)) {
        required.add(`view:scenarios/node:${scenarioId}`);
        changed = true;
      }
    }
  }
  return required;
}

export function validateChangeUnitDesign(
  projectRoot: string,
  changeUnit: ChangeUnitRecord,
  options: ChangeUnitDesignGateOptions = {},
): ChangeUnitDesignGateResult {
  const issues: ChangeUnitIssue[] = [];
  const explicitRefs = changeUnitRecords(changeUnit.design_refs) as unknown as ComponentBlueprintRef[];
  const explicitAddresses = explicitRefs.map(blueprintRefAddress);
  let ownerResolution: ReturnType<typeof resolveComponentBlueprintRef>;
  try {
    ownerResolution = resolveComponentBlueprintRef(projectRoot, changeUnit.component_blueprint_ref);
  } catch (error) {
    issues.push(changeUnitIssue(
      'change_unit_blueprint_unresolvable',
      '$.component_blueprint_ref',
      (error as Error).message,
      'BLOCKER',
      'reconcile_blueprint',
    ));
    return { verdict: 'reconcile_blueprint', issues, explicitAddresses, requiredAddresses: [] };
  }
  const owner = ownerResolution.ref;
  for (let index = 0; index < explicitRefs.length; index++) {
    const ref = explicitRefs[index];
    if (!sameBlueprintIdentity(owner, ref)) continue;
    try {
      resolveComponentBlueprintRef(projectRoot, ref);
    } catch (error) {
      issues.push(changeUnitIssue(
        'change_unit_design_ref_unresolvable',
        `$.design_refs[${index}]`,
        (error as Error).message,
        'BLOCKER',
        'reconcile_blueprint',
      ));
    }
  }

  const blueprint = ownerResolution.blueprint;
  const roots = new Set(explicitAddresses);
  for (const touch of changeUnitRecords(changeUnit.touches)) {
    const ref = asRecord(touch.design_ref) as unknown as ComponentBlueprintRef | undefined;
    if (ref) roots.add(blueprintRefAddress(ref));
  }
  const required = deriveClosure(blueprint, [...roots]);
  const explicit = new Set(explicitAddresses);
  for (const address of [...required].sort()) {
    if (!explicit.has(address)) {
      issues.push(changeUnitIssue(
        'change_unit_design_closure_incomplete',
        '$.design_refs',
        `当前 delta 闭包缺稳定地址 ${address}。`,
      ));
    }
  }

  const addressIndex = stableAddressIndex(blueprint);
  for (const address of [...required].sort()) {
    const record = addressIndex.get(address);
    if (!record) continue;
    if (dispositionBlocks(record)) {
      issues.push(changeUnitIssue(
        'change_unit_current_design_unresolved',
        `$.design_refs[${address}]`,
        `${address} 在当前 delta 中仍为 unknown/open decision/blocker。`,
        'BLOCKER',
        'reconcile_blueprint',
      ));
    }
    if (address.startsWith('contract:') && !contractIsAdmitted(record)) {
      issues.push(changeUnitIssue(
        'change_unit_contract_not_admitted',
        `$.design_refs[${address}]`,
        `${address} 缺 authoritative provenance，不能进入施工。`,
        'BLOCKER',
        'reconcile_blueprint',
      ));
    }
  }

  for (let index = 0; index < changeUnitRecords(changeUnit.touches).length; index++) {
    const touch = changeUnitRecords(changeUnit.touches)[index];
    const ref = asRecord(touch.design_ref) as unknown as ComponentBlueprintRef | undefined;
    if (ref?.target.kind !== 'node' || ref.target.view_id !== 'development') {
      issues.push(changeUnitIssue(
        'change_unit_touch_development_owner_missing',
        `$.touches[${index}].design_ref`,
        'touch 必须定位到 development view 的真实 owner node。',
      ));
    }
  }

  const admission = asRecord(asRecord(blueprint.review_summary)?.admission);
  if (admission?.status !== 'pass') {
    issues.push(changeUnitIssue(
      'change_unit_blueprint_not_admitted',
      '$.component_blueprint_ref',
      '当前 canonical blueprint admission 不是 pass。',
      'BLOCKER',
      'reconcile_blueprint',
    ));
  }
  if ((options.blueprintInvalidatingFacts ?? []).length > 0) {
    issues.push(changeUnitIssue(
      'change_unit_blueprint_reconciliation_required',
      '$',
      `施工发现推翻蓝图的事实：${options.blueprintInvalidatingFacts!.join('；')}。`,
      'BLOCKER',
      'reconcile_blueprint',
    ));
  }

  const reconcile = issues.some(item => item.route === 'reconcile_blueprint');
  return {
    verdict: reconcile ? 'reconcile_blueprint' : issues.length > 0 ? 'blocked' : 'constructable',
    issues,
    explicitAddresses,
    requiredAddresses: [...required].sort(),
  };
}

export function componentBlueprintRefForAddress(
  owner: ComponentBlueprintRef,
  address: string,
): ComponentBlueprintRef | undefined {
  return targetRef(owner, address);
}
