import * as fs from 'fs';
import * as YAML from 'yaml';
import { componentIndexPath } from '../../config';
import {
  BlueprintRecord,
  ComponentBlueprintRef,
  asRecord,
  asRecords,
  asStrings,
  getId,
  nonEmptyString,
} from './component-blueprint-model';
import { resolveComponentBlueprintRef, loadCanonicalBlueprint, sha256Bytes } from './component-blueprint-path';
import { asChangeUnitArtifact, createChangeUnitRef, enumerateCanonicalChangeUnits } from './change-unit-path';
import { deriveBlueprintDesignObligations } from './component-blueprint-obligations';
import { stableJson } from './blueprint-discovery';
import type { ComponentClosureIssue } from './component-closure-model';
import { stableAddressIndex } from './blueprint-addressing';
import { blueprintComponentDecisions } from './component-assets';
import {
  ChangeUnitIssue,
  ChangeUnitArtifact,
  ChangeUnitRecord,
  blueprintRefAddress,
  changeUnitIssue,
  changeUnitRecords,
  sameBlueprintIdentity,
} from './change-unit-model';

/** Whole-component ownership, using the same obligations and exact retirement as P3. No reference is written. */
export function readChangeUnitDesignOwnership(projectRoot: string, blueprintId: string,
  candidates: readonly ChangeUnitArtifact[] = [], blueprintOverride?: BlueprintRecord): ChangeUnitIssue[] {
  const loadedBlueprint = loadCanonicalBlueprint(projectRoot, blueprintId);
  const units = new Map(enumerateCanonicalChangeUnits(projectRoot, blueprintId).map(loaded =>
    [String(loaded.changeUnit.change_unit_id), { changeUnit: asChangeUnitArtifact(loaded.changeUnit), ref: createChangeUnitRef(loaded) }]));
  for (const candidate of candidates) {
    if (candidate.blueprint_id !== blueprintId || candidate.component_id !== loadedBlueprint.blueprint.component_id) {
      return [changeUnitIssue('change_unit_identity_mismatch', '$.component_id', '设计认领候选必须属于当前蓝图及部件。')];
    }
    const existing = units.get(candidate.change_unit_id);
    const content = (unit: ChangeUnitArtifact) => stableJson({ ...unit,
      design_refs: [...unit.design_refs].sort((a, b) => stableJson(a.target).localeCompare(stableJson(b.target))) });
    // Keep real canonical bytes for unchanged proposals; changed/new targets use the prospective writer bytes.
    const ref = existing && content(existing.changeUnit) === content(candidate) ? existing.ref : createChangeUnitRef({ changeUnit: candidate as unknown as ChangeUnitRecord,
      artifactSha256: sha256Bytes(Buffer.from(YAML.stringify(candidate))) });
    units.set(candidate.change_unit_id, { changeUnit: candidate, ref });
  }
  // Avoid the projection/design import cycle; this is P3's existing retirement predicate.
  const { inspectRetirement } = require('./component-closure-inputs') as typeof import('./component-closure-inputs');
  const retirementIssues: ComponentClosureIssue[] = [];
  const retired = inspectRetirement([...units.values()], retirementIssues);
  const disputed = new Set(retirementIssues.map(issue => issue.path));
  const currentUnits = [...units.values()].filter(unit => !retired.has(unit.changeUnit.change_unit_id)
    || disputed.has(`change-unit:${unit.changeUnit.change_unit_id}`));
  const obligations = deriveBlueprintDesignObligations({ blueprint: { ...loadedBlueprint, blueprint: blueprintOverride ?? loadedBlueprint.blueprint }, currentUnits });
  const missing = new Map<string, string[]>();
  for (const item of obligations) {
    if (!item.required || item.evidence_level === 'fact' || item.mapping_kind !== 'design' || item.owner_hint_change_unit_ids.length) continue;
    const roots = item.kind.startsWith('source_') ? item.blueprint_refs : item.mapping_id ? [item.mapping_id] : item.blueprint_refs;
    const targets = [...new Set(roots.map(address => address.replace(/^(view:runtime\/flow:[^/]+)\/.*/, '$1')))].sort();
    const key = targets.join('、');
    missing.set(key, [...missing.get(key) ?? [], item.obligation_id]);
  }
  return [...missing].sort(([a], [b]) => a.localeCompare(b)).map(([targets, obligations]) => changeUnitIssue(
    'change_unit_design_closure_incomplete', '$.design_refs',
    `整批活动CU尚未认领必需设计义务 ${obligations.join('、')}；${targets ? `由设计作者选择一个责任CU，在design_refs显式认领以下承载之一：${targets}` : '没有可认领承载，请先补齐蓝图的需求追溯'}。不要求每个CU重复认领，不把依赖自动写入选择。`));
}

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
  resolveBlueprintRef?: typeof resolveComponentBlueprintRef;
  blueprintInvalidatingFacts?: string[];
}

export interface ChangeUnitDesignGateResult {
  verdict: ChangeUnitConstructabilityVerdict;
  issues: ChangeUnitIssue[];
  explicitAddresses: string[];
  requiredAddresses: string[];
}

/** runtime vertical slice 的既有角色要求；不依赖后续施工映射。 */
export function changeUnitRuntimeRoleIssues(changeUnit: ChangeUnitRecord): ChangeUnitIssue[] {
  if (!changeUnitRecords(changeUnit.design_refs).some(ref => asRecord(ref.target)?.kind === 'flow')) return [];
  const roles = new Set(changeUnitRecords(changeUnit.target_predicates).map(item => item.role));
  return (['behavior', 'owner', 'consumer', 'recovery'] as const).filter(role => !roles.has(role)).map(role =>
    changeUnitIssue('change_unit_runtime_vertical_role_missing', '$.target_predicates', `runtime vertical slice 缺 ${role} predicate。`));
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

export function deriveClosure(blueprint: BlueprintRecord, roots: string[], projectRoot: string): Set<string> {
  const index = stableAddressIndex(blueprint);
  const required = new Set(roots);
  const selections = fs.existsSync(componentIndexPath(projectRoot))
    ? asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions).filter(decision => decision.kind === 'component_asset_selection') : [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const address of [...required]) {
      const record = index.get(address);
      if (!record) continue;
      for (const component of asRecords(asRecord(record.contracts)?.components)) {
        for (const decision of blueprintComponentDecisions(blueprint, component)) {
          for (const dependency of [String(decision.target_ref), `decision:${decision.decision_id}`]) {
            if (index.has(dependency) && !required.has(dependency)) { required.add(dependency); changed = true; }
          }
        }
      }
      for (const linked of linkedAddresses(record)) {
        if (index.has(linked) && !required.has(linked)) {
          required.add(linked);
          changed = true;
        }
      }
    }
    for (const decision of selections) {
      const id = getId(decision, 'decision_id');
      if (id && required.has(String(decision.target_ref)) && !required.has(`decision:${id}`)) {
        required.add(`decision:${id}`);
        changed = true;
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
  const issues: ChangeUnitIssue[] = changeUnitRuntimeRoleIssues(changeUnit);
  const explicitRefs = changeUnitRecords(changeUnit.design_refs) as unknown as ComponentBlueprintRef[];
  const explicitAddresses = explicitRefs.map(blueprintRefAddress);
  let ownerResolution: ReturnType<typeof resolveComponentBlueprintRef>;
  try {
    ownerResolution = (options.resolveBlueprintRef ?? resolveComponentBlueprintRef)(projectRoot, changeUnit.component_blueprint_ref);
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
      (options.resolveBlueprintRef ?? resolveComponentBlueprintRef)(projectRoot, ref);
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
  const required = deriveClosure(blueprint, [...roots], projectRoot);
  const addressIndex = stableAddressIndex(blueprint);
  if (fs.existsSync(componentIndexPath(projectRoot))) {
    const explicit = new Set(explicitAddresses);
    const selections = asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions).filter(decision =>
      decision.kind === 'component_asset_selection' && explicit.has(String(decision.target_ref)));
    for (const address of explicit) for (const component of asRecords(asRecord(addressIndex.get(address)?.contracts)?.components)) {
      selections.push(...blueprintComponentDecisions(blueprint, component));
    }
    for (const address of new Set(selections.map(decision => `decision:${String(decision.decision_id)}`))) {
      if (!explicit.has(address)) issues.push(changeUnitIssue('change_unit_design_closure_incomplete', '$.design_refs',
        `显式交付目标须声明其采用的选型决定 ${address}；依赖闭包不会代作者认领交付。`));
    }
  }
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

  // admission 不为 pass 的情形不在此重判：`resolveComponentBlueprintRef` 先跑完整 P1 校验，
  // admission 与派生值一致时必有上游 BLOCKER、不一致时必出 `blueprint_admission_false_pass`，
  // 两种情形都在上面的 catch 里落成 `change_unit_blueprint_unresolvable`（message 携具体
  // 上游 issue id）。曾经的本地复判是不可达分支，已删（plan 2d6b4f83 mg7）。
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
