import * as fs from 'fs';
import * as path from 'path';
import { featureFilePath } from '../../config';
import {
  BlueprintRecord,
  ComponentBlueprintRef,
  asRecord,
  asRecords,
  asStrings,
  nonEmptyString,
} from './component-blueprint-model';
import { resolveComponentBlueprintRef } from './component-blueprint-path';
import {
  ChangeUnitArtifact,
  ChangeUnitRecord,
  blueprintRefAddress,
  changeUnitRecords,
  changeUnitStrings,
  sameBlueprintTarget,
} from './change-unit-model';
import {
  ChangeUnitResolutionError,
  asChangeUnitArtifact,
  deriveChangeUnitFeatureId,
  loadCanonicalChangeUnit,
  resolveChangeUnitRef,
} from './change-unit-path';
import { AcceptanceSpec, CheckContext, CheckResult, ContractsSpec } from './types';
import { validateChangeUnitEvolutionSeam } from './change-unit-evolution-seam';
import { validateChangeUnitDesign } from './change-unit-design-gate';
import { validateProjectRelativePath } from './project-relative-path';

type ProjectionPhase = 'plan' | 'coding' | 'review' | 'ut';

export interface ChangeUnitProjectionIssue {
  id: string;
  message: string;
  route: 'repair_feature_mapping' | 'repair_change_unit' | 'reconcile_blueprint';
}

export interface ChangeUnitProjectionResult {
  applicable: boolean;
  changeUnit?: ChangeUnitArtifact;
  issues: ChangeUnitProjectionIssue[];
  useCasesRequired: boolean;
  dagRequired: boolean;
}

export interface DagProjectionLike {
  dag: { use_case?: string; branches?: unknown };
}

const CHANGE_UNIT_ALLOWED_KEYS = new Set([
  'change_unit_ref',
  'predicate_mappings',
  'provide_mappings',
  'design_ref_mappings',
]);

function issue(
  id: string,
  message: string,
  route: ChangeUnitProjectionIssue['route'] = 'repair_feature_mapping',
): ChangeUnitProjectionIssue {
  return { id, message, route };
}

function records(value: unknown): BlueprintRecord[] {
  return Array.isArray(value) ? value.filter((item): item is BlueprintRecord => Boolean(asRecord(item))) : [];
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicate.add(value);
    seen.add(value);
  }
  return [...duplicate].sort();
}

function checkConstructionRefs(
  projectRoot: string,
  refs: string[],
  phase: ProjectionPhase,
  role: 'implementation' | 'test' | 'verification',
  owner: string,
): ChangeUnitProjectionIssue[] {
  const out: ChangeUnitProjectionIssue[] = [];
  const plannedAllowed = role === 'implementation' ? phase === 'plan' : phase !== 'ut';
  for (const rawRef of refs) {
    const planned = rawRef.startsWith('planned:');
    const ref = planned ? rawRef.slice('planned:'.length) : rawRef;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) {
      out.push(issue(
        'change_unit_mapping_ref_unconsumable',
        `${owner} 的 ${role} ref=${rawRef} 是未绑定的命名引用；请使用 project-relative file[#symbol]。`,
      ));
      continue;
    }
    const hash = ref.indexOf('#');
    const pathPart = (hash >= 0 ? ref.slice(0, hash) : ref).trim();
    const symbol = hash >= 0 ? ref.slice(hash + 1).trim() : '';
    if (hash >= 0 && !symbol) {
      out.push(issue('change_unit_mapping_symbol_missing', `${owner} 的 ${role} ref=${rawRef} 缺 #symbol。`));
      continue;
    }
    let normalized: string;
    try {
      normalized = validateProjectRelativePath(projectRoot, pathPart, `${owner}.${role}`);
    } catch (error) {
      out.push(issue('change_unit_mapping_path_invalid', (error as Error).message));
      continue;
    }
    if (planned && !plannedAllowed) {
      out.push(issue(
        'change_unit_mapping_planned_ref_not_allowed',
        `${owner} 的 ${role} ref=${rawRef} 在 ${phase} 阶段必须已有真实消费落点。`,
      ));
      continue;
    }
    if (planned) continue;
    const absolute = path.resolve(projectRoot, normalized);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      out.push(issue('change_unit_mapping_file_missing', `${owner} 的 ${role} 文件不存在：${normalized}`));
      continue;
    }
    if (symbol) {
      const source = fs.readFileSync(absolute, 'utf8');
      if (!source.includes(symbol)) {
        out.push(issue('change_unit_mapping_symbol_missing', `${owner} 的符号 ${symbol} 不存在于 ${normalized}。`));
      }
    }
  }
  return out;
}

function checkIdMappings(
  kind: 'predicate' | 'provide',
  definitions: ChangeUnitRecord[],
  mappings: BlueprintRecord[],
  phase: ProjectionPhase,
  projectRoot: string,
): ChangeUnitProjectionIssue[] {
  const key = `${kind}_id`;
  const expected = definitions.map(item => String(item[key] ?? '')).filter(Boolean).sort();
  const actual = mappings.map(item => String(item[key] ?? '')).filter(Boolean);
  const out: ChangeUnitProjectionIssue[] = [];
  const repeated = duplicates(actual);
  if (repeated.length > 0) out.push(issue(`change_unit_${kind}_mapping_duplicate`, `重复 ${key}: ${repeated.join(', ')}`));
  const unknown = [...new Set(actual.filter(id => !expected.includes(id)))].sort();
  if (unknown.length > 0) out.push(issue(`change_unit_${kind}_mapping_unknown`, `未知 ${key}: ${unknown.join(', ')}`));
  const missing = expected.filter(id => !actual.includes(id));
  if (missing.length > 0) out.push(issue(`change_unit_${kind}_mapping_missing`, `缺 ${key}: ${missing.join(', ')}`));
  for (const mapping of mappings) {
    const implementationRefs = asStrings(mapping.implementation_refs);
    const testRefs = asStrings(mapping.test_refs);
    if (implementationRefs.length === 0 || testRefs.length === 0) {
      out.push(issue(`change_unit_${kind}_mapping_incomplete`, `${String(mapping[key])} 必须映射 implementation_refs 与 test_refs。`));
    }
    const owner = `${kind}:${String(mapping[key])}`;
    out.push(...checkConstructionRefs(projectRoot, implementationRefs, phase, 'implementation', owner));
    out.push(...checkConstructionRefs(projectRoot, testRefs, phase, 'test', owner));
    for (const forbidden of ['description', 'purpose', 'verification_refs', 'provide_ids']) {
      if (Object.prototype.hasOwnProperty.call(mapping, forbidden)) {
        out.push(issue('change_unit_definition_copied', `${kind} mapping 不得复制/重定义 ${forbidden}。`));
      }
    }
  }
  return out;
}

function checkDesignMappings(
  cu: ChangeUnitArtifact,
  mappings: BlueprintRecord[],
  phase: ProjectionPhase,
  projectRoot: string,
): ChangeUnitProjectionIssue[] {
  const expected = cu.design_refs;
  const out: ChangeUnitProjectionIssue[] = [];
  const mappedRefs = mappings.map(item => asRecord(item.design_ref) as unknown as ComponentBlueprintRef | undefined);
  for (const expectedRef of expected) {
    const matches = mappedRefs.filter(ref => ref && sameBlueprintTarget(expectedRef, ref));
    if (matches.length === 0) out.push(issue('change_unit_design_mapping_missing', `缺 design_ref mapping: ${blueprintRefAddress(expectedRef)}`));
    if (matches.length > 1) out.push(issue('change_unit_design_mapping_duplicate', `重复 design_ref mapping: ${blueprintRefAddress(expectedRef)}`));
  }
  for (let index = 0; index < mappings.length; index++) {
    const mapping = mappings[index];
    const ref = mappedRefs[index];
    if (!ref || !expected.some(item => sameBlueprintTarget(item, ref))) {
      out.push(issue('change_unit_design_mapping_unknown', `design_ref_mappings[${index}] 不属于 canonical CU。`));
    }
    const implementationRefs = asStrings(mapping.implementation_refs);
    const verificationRefs = asStrings(mapping.verification_refs);
    if (implementationRefs.length === 0 || verificationRefs.length === 0) {
      out.push(issue('change_unit_design_mapping_incomplete', `${ref ? blueprintRefAddress(ref) : index} 缺施工/验证落点。`));
    }
    const owner = `design:${ref ? blueprintRefAddress(ref) : index}`;
    out.push(...checkConstructionRefs(projectRoot, implementationRefs, phase, 'implementation', owner));
    out.push(...checkConstructionRefs(projectRoot, verificationRefs, phase, 'verification', owner));
    for (const forbidden of ['description', 'target_state', 'delta', 'purpose']) {
      if (Object.prototype.hasOwnProperty.call(mapping, forbidden)) {
        out.push(issue('change_unit_definition_copied', `design mapping 不得复制/重定义 ${forbidden}。`));
      }
    }
  }
  return out;
}

function runtimeFacts(contracts: ContractsSpec): {
  useCasesRequired: boolean;
  dagComplexity: boolean;
  issues: ChangeUnitProjectionIssue[];
} {
  let ordered = false;
  let recovery = false;
  let sharedConsumers = false;
  let lifecycle = false;
  const issues: ChangeUnitProjectionIssue[] = [];
  for (const state of contracts.state_management ?? []) {
    ordered ||= (state.ordered_steps?.length ?? 0) >= 2;
    recovery ||= Boolean(state.failure_recovery && Object.keys(state.failure_recovery).length > 0);
    sharedConsumers ||= (state.consumers?.length ?? 0) >= 2;
    lifecycle ||= (state.lifecycle_triggers ?? []).some(trigger =>
      ['background', 'scheduled', 'external', 'warm_resume', 'process_recreation', 'account_switch'].includes(trigger),
    );
    const publications = new Set((state.publications ?? []).map(item => `publication:${item.publication_id}`));
    const consumed = new Set<string>();
    for (const consumer of state.consumers ?? []) {
      if (consumer.update_ref) consumed.add(consumer.update_ref);
      if (!consumer.initial_load_ref && !consumer.update_ref) {
        issues.push(issue('change_unit_runtime_orphan_consumer', `consumer:${consumer.consumer_id} 无 initial_load_ref/update_ref。`));
      }
    }
    for (const subscription of state.subscriptions ?? []) {
      if (subscription.publication_ref) consumed.add(subscription.publication_ref);
      if (!subscription.replay_or_snapshot || !subscription.cleanup) {
        issues.push(issue('change_unit_runtime_subscription_lifecycle_missing', `subscription:${subscription.subscription_id} 缺 replay/snapshot 或 cleanup。`));
      }
    }
    for (const mutation of state.mutations ?? []) {
      if (!mutation.publication_ref || !publications.has(mutation.publication_ref)) {
        issues.push(issue('change_unit_runtime_publication_missing', `mutation:${mutation.mutation_id} 的 publication_ref 不可解析。`));
      } else if (!consumed.has(mutation.publication_ref)) {
        issues.push(issue('change_unit_runtime_chain_open', `${mutation.publication_ref} 未继续到受影响 consumer。`));
      }
      if (mutation.kind === 'background' && !mutation.recovery_ref) {
        issues.push(issue('change_unit_runtime_background_recovery_missing', `background mutation:${mutation.mutation_id} 缺 recovery_ref。`));
      }
    }
    for (const publication of publications) {
      if (!consumed.has(publication)) issues.push(issue('change_unit_runtime_orphan_publication', `${publication} 没有 consumer。`));
    }
  }
  return { useCasesRequired: ordered || recovery || sharedConsumers || lifecycle, dagComplexity: ordered || recovery || sharedConsumers, issues };
}

function acceptanceItemHasFlowComplexity(
  item: AcceptanceSpec['criteria'][number] | AcceptanceSpec['boundaries'][number],
): boolean {
  return ('verification_steps' in item ? item.verification_steps?.length ?? 0 : 0) >= 2
    || /retry|recover|compensat|恢复|重试|补偿/i.test(item.description ?? '');
}

function acceptanceNeedsUseCase(acceptance: AcceptanceSpec | undefined): boolean {
  return [...(acceptance?.criteria ?? []), ...(acceptance?.boundaries ?? [])]
    .some(acceptanceItemHasFlowComplexity);
}

function acceptanceNeedsDag(acceptance: AcceptanceSpec | undefined): boolean {
  return [...(acceptance?.criteria ?? []), ...(acceptance?.boundaries ?? [])]
    .some(item => (
      (item.ut_layer === 'unit' || item.ut_layer === 'both')
      && acceptanceItemHasFlowComplexity(item)
    ));
}

function hasUnitScope(acceptance: AcceptanceSpec | undefined): boolean {
  return [...(acceptance?.criteria ?? []), ...(acceptance?.boundaries ?? [])]
    .some(item => item.ut_layer === 'unit' || item.ut_layer === 'both');
}

function checkVerticalSlice(
  projectRoot: string,
  cu: ChangeUnitArtifact,
  contracts: ContractsSpec,
): ChangeUnitProjectionIssue[] {
  const roles = new Set(cu.target_predicates.map(item => item.role));
  const issues: ChangeUnitProjectionIssue[] = [];
  const flowRefs = cu.design_refs.filter(ref => ref.target.kind === 'flow');
  if (flowRefs.length > 0) {
    for (const role of ['behavior', 'owner', 'consumer', 'recovery'] as const) {
      if (!roles.has(role)) issues.push(issue('change_unit_runtime_vertical_role_missing', `runtime vertical slice 缺 ${role} predicate。`, 'repair_change_unit'));
    }
    for (const ref of flowRefs) {
      const mapped = (contracts.state_management ?? []).find(state => state.design_ref && sameBlueprintTarget(ref, state.design_ref));
      if (!mapped) {
        issues.push(issue('change_unit_runtime_state_mapping_missing', `${blueprintRefAddress(ref)} 未映射到 contracts.state_management。`));
        continue;
      }
      try {
        const flow = resolveComponentBlueprintRef(projectRoot, ref).target as BlueprintRecord;
        if (!nonEmptyString(mapped.owner_ref) || asStrings(mapped.contract_refs).length === 0) {
          issues.push(issue('change_unit_runtime_owner_contract_missing', `${blueprintRefAddress(ref)} 缺真实 owner_ref/contract_refs。`));
        }
        for (const [blueprintField, featureField] of [
          ['mutations', 'mutations'],
          ['publications', 'publications'],
          ['subscriptions', 'subscriptions'],
          ['consumers', 'consumers'],
        ] as const) {
          if (asRecords(flow[blueprintField]).length > 0 && (mapped[featureField]?.length ?? 0) === 0) {
            issues.push(issue(
              'change_unit_runtime_fact_mapping_missing',
              `${blueprintRefAddress(ref)} 的 ${blueprintField} 适用，但 contracts.state_management.${featureField} 未施工映射。`,
            ));
          }
        }
        const mappedRecord = mapped as unknown as BlueprintRecord;
        for (const [field, idField] of [
          ['mutations', 'mutation_id'],
          ['publications', 'publication_id'],
          ['subscriptions', 'subscription_id'],
          ['consumers', 'consumer_id'],
        ] as const) {
          const expectedItems = asRecords(flow[field]);
          const actualItems = asRecords(mappedRecord[field]);
          const expectedIds = new Set(expectedItems.map(item => String(item[idField] ?? '')).filter(Boolean));
          const actualIds = new Set(actualItems.map(item => String(item[idField] ?? '')).filter(Boolean));
          const missing = [...expectedIds].filter(id => !actualIds.has(id));
          const unknown = [...actualIds].filter(id => !expectedIds.has(id));
          if (missing.length > 0 || unknown.length > 0) {
            issues.push(issue(
              'change_unit_runtime_stable_id_mismatch',
              `${blueprintRefAddress(ref)} 的 ${field} 稳定 ID 不一致：missing=${missing.join(',') || '-'}; unknown=${unknown.join(',') || '-'}。`,
            ));
          }
        }
        const expectedOwner = String(asRecord(flow.state_owner)?.ref ?? '');
        if (expectedOwner && mapped.owner_ref !== expectedOwner) {
          issues.push(issue('change_unit_runtime_stable_id_mismatch', `${blueprintRefAddress(ref)} owner_ref 必须为 ${expectedOwner}。`));
        }
        const expectedContracts = new Set(asStrings(flow.logical_contract_refs));
        const actualContracts = new Set(asStrings(mapped.contract_refs));
        if ([...expectedContracts].some(id => !actualContracts.has(id))
          || [...actualContracts].some(id => !expectedContracts.has(id))) {
          issues.push(issue('change_unit_runtime_stable_id_mismatch', `${blueprintRefAddress(ref)} contract_refs 与 P1 flow 不一致。`));
        }
        const expectedMutations = new Map(asRecords(flow.mutations).map(item => [String(item.mutation_id), item]));
        for (const actual of asRecords(mappedRecord.mutations)) {
          const expected = expectedMutations.get(String(actual.mutation_id));
          if (!expected) continue;
          for (const edge of ['publication_ref', 'recovery_ref'] as const) {
            if (nonEmptyString(expected[edge]) && actual[edge] !== expected[edge]) {
              issues.push(issue(
                'change_unit_runtime_propagation_edge_mismatch',
                `mutation:${String(actual.mutation_id)}.${edge} 必须保持 P1 稳定边 ${String(expected[edge])}。`,
              ));
            }
          }
        }
        const expectedConsumers = new Map(asRecords(flow.consumers).map(item => [String(item.consumer_id), item]));
        for (const actual of asRecords(mappedRecord.consumers)) {
          const expected = expectedConsumers.get(String(actual.consumer_id));
          if (!expected) continue;
          for (const edge of ['initial_load_ref', 'update_ref'] as const) {
            if (nonEmptyString(expected[edge]) && actual[edge] !== expected[edge]) {
              issues.push(issue(
                'change_unit_runtime_propagation_edge_mismatch',
                `consumer:${String(actual.consumer_id)}.${edge} 必须保持 P1 稳定边 ${String(expected[edge])}。`,
              ));
            }
          }
        }
        const expectedSubscriptions = new Map(asRecords(flow.subscriptions).map(item => [String(item.subscription_id), item]));
        for (const actual of asRecords(mappedRecord.subscriptions)) {
          const expected = expectedSubscriptions.get(String(actual.subscription_id));
          if (!expected) continue;
          if (nonEmptyString(expected.consumer_ref) && actual.consumer_ref !== expected.consumer_ref) {
            issues.push(issue(
              'change_unit_runtime_propagation_edge_mismatch',
              `subscription:${String(actual.subscription_id)}.consumer_ref 必须保持 P1 稳定边 ${String(expected.consumer_ref)}。`,
            ));
          }
          const consumerId = String(expected.consumer_ref ?? '').replace(/^consumer:/, '');
          const expectedPublication = expectedConsumers.get(consumerId)?.update_ref;
          if (nonEmptyString(expectedPublication) && actual.publication_ref !== expectedPublication) {
            issues.push(issue(
              'change_unit_runtime_propagation_edge_mismatch',
              `subscription:${String(actual.subscription_id)}.publication_ref 必须闭合到 ${String(expectedPublication)}。`,
            ));
          }
        }
      } catch (error) {
        issues.push(issue('change_unit_design_ref_unresolvable', (error as Error).message, 'reconcile_blueprint'));
      }
    }
  }
  for (const ref of cu.design_refs.filter(item => item.target.kind === 'decision')) {
    try {
      const decision = resolveComponentBlueprintRef(projectRoot, ref).target as BlueprintRecord;
      const providers = cu.requires.flatMap(requirement => {
        try {
          return [asChangeUnitArtifact(loadCanonicalChangeUnit(
            projectRoot,
            cu.component_id,
            requirement.from_change_unit_id,
          ).changeUnit)];
        } catch {
          return [];
        }
      });
      issues.push(...validateChangeUnitEvolutionSeam(cu, ref, decision, providers)
        .map(item => issue(item.id, item.message, 'repair_change_unit')));
    } catch (error) {
      issues.push(issue('change_unit_design_ref_unresolvable', (error as Error).message, 'reconcile_blueprint'));
    }
  }
  return issues;
}

export function validateChangeUnitFeatureProjection(
  projectRoot: string,
  feature: string,
  contracts: ContractsSpec | undefined,
  acceptance: AcceptanceSpec | undefined,
  useCasesPresent: boolean,
  phase: ProjectionPhase,
  dags: DagProjectionLike[] = [],
): ChangeUnitProjectionResult {
  const section = asRecord(contracts?.change_unit);
  if (!section) return { applicable: false, issues: [], useCasesRequired: false, dagRequired: false };
  const issues: ChangeUnitProjectionIssue[] = [];
  for (const key of Object.keys(section)) {
    if (!CHANGE_UNIT_ALLOWED_KEYS.has(key)) issues.push(issue('change_unit_projection_unknown_field', `contracts.change_unit.${key} 不属于 ID-only 投影。`));
  }
  for (const forbidden of ['runtime_flow_slices', 'use_cases_required', 'dag_required']) {
    if (contracts && Object.prototype.hasOwnProperty.call(contracts, forbidden)) {
      issues.push(issue('change_unit_parallel_runtime_authority', `contracts.${forbidden} 不得成为第二运行时/派生义务真源。`));
    }
  }
  let cu: ChangeUnitArtifact | undefined;
  try {
    const loaded = resolveChangeUnitRef(projectRoot, section.change_unit_ref);
    cu = asChangeUnitArtifact(loaded.changeUnit);
  } catch (error) {
    const code = error instanceof ChangeUnitResolutionError ? error.code : 'change_unit_ref_unresolvable';
    issues.push(issue(code, (error as Error).message, code.includes('blueprint') ? 'reconcile_blueprint' : 'repair_feature_mapping'));
    return { applicable: true, issues, useCasesRequired: false, dagRequired: false };
  }
  const expectedFeature = deriveChangeUnitFeatureId(cu.component_id, cu.change_unit_id);
  if (feature !== expectedFeature) {
    issues.push(issue('change_unit_feature_identity_mismatch', `Feature=${feature}，canonical 派生 identity=${expectedFeature}。`));
  }
  const design = validateChangeUnitDesign(projectRoot, cu as unknown as ChangeUnitRecord);
  issues.push(...design.issues.map(item => issue(
    item.id,
    item.message,
    item.route === 'reconcile_blueprint' ? 'reconcile_blueprint' : 'repair_change_unit',
  )));
  for (const forbidden of ['purpose', 'target_predicates', 'provides', 'design_refs', 'verification_refs']) {
    if (Object.prototype.hasOwnProperty.call(section, forbidden)) {
      issues.push(issue('change_unit_definition_copied', `contracts.change_unit 不得复制 canonical ${forbidden}。`));
    }
  }
  issues.push(...checkIdMappings(
    'predicate',
    cu.target_predicates as unknown as ChangeUnitRecord[],
    records(section.predicate_mappings),
    phase,
    projectRoot,
  ));
  issues.push(...checkIdMappings(
    'provide',
    cu.provides as unknown as ChangeUnitRecord[],
    records(section.provide_mappings),
    phase,
    projectRoot,
  ));
  issues.push(...checkDesignMappings(cu, records(section.design_ref_mappings), phase, projectRoot));
  const runtime = runtimeFacts(contracts!);
  issues.push(...runtime.issues);
  issues.push(...checkVerticalSlice(projectRoot, cu, contracts!));
  const useCasesRequired = runtime.useCasesRequired || acceptanceNeedsUseCase(acceptance);
  const dagRequired = acceptanceNeedsDag(acceptance) || (hasUnitScope(acceptance) && runtime.dagComplexity);
  if (useCasesRequired && !useCasesPresent) {
    issues.push(issue('change_unit_use_cases_required', '机械派生事实要求 use-cases.yaml，但产物缺失。'));
  }
  if (dagRequired && dags.length === 0 && phase === 'ut') {
    issues.push(issue('change_unit_dag_required', 'unit/both 复杂流要求 ephemeral DAG，但未找到 DAG。'));
  }
  if (dagRequired && dags.length > 0 && useCasesPresent) {
    for (const dag of dags) {
      if (!nonEmptyString(dag.dag.use_case) || !Array.isArray(dag.dag.branches) || dag.dag.branches.length === 0) {
        issues.push(issue('change_unit_dag_use_case_link_missing', '复杂流 DAG 必须链接 use_case 与 branches。'));
      }
    }
  }
  return { applicable: true, changeUnit: cu, issues, useCasesRequired, dagRequired };
}

export function checkChangeUnitFeatureProjection(
  ctx: CheckContext,
  phase: ProjectionPhase,
  dags: DagProjectionLike[] = [],
): CheckResult[] {
  const result = validateChangeUnitFeatureProjection(
    ctx.projectRoot,
    ctx.feature,
    ctx.featureSpec.contracts,
    ctx.featureSpec.acceptance,
    Boolean(ctx.featureSpec.useCases),
    phase,
    dags,
  );
  if (!result.applicable) return [];
  if (result.issues.length > 0) {
    return result.issues.map(item => ({
      id: item.id,
      category: 'traceability',
      description: 'Change Unit → Feature ID-only 施工投影',
      severity: 'BLOCKER',
      status: 'FAIL',
      details: item.message,
      suggestion: item.route === 'reconcile_blueprint'
        ? '停止 Feature 补模，返回 P1 调和 canonical blueprint。'
        : item.route === 'repair_change_unit'
          ? '修正 canonical CU 定义并重新绑定 Feature。'
          : '修正 contracts.change_unit ID-only 映射或既有 state_management 施工事实。',
    }));
  }
  return [{
    id: 'change_unit_feature_projection',
    category: 'traceability',
    description: 'Change Unit → Feature ID-only 施工投影',
    severity: 'BLOCKER',
    status: 'PASS',
    details: `canonical CU 映射完整；use_cases_required=${result.useCasesRequired}，dag_required=${result.dagRequired}。`,
    affected_files: [featureFilePath(ctx.projectRoot, ctx.feature, 'contracts.yaml')],
  }];
}
