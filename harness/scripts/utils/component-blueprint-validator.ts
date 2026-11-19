import {
  BLUEPRINT_ARTIFACT,
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  nonEmptyString,
  issue,
  BLUEPRINT_SCHEMA,
} from './component-blueprint-model';
import type { RequestIntake } from './request-intake';
import { loadFrameworkConfig } from '../../config';
import { validateProjectRelativePath } from './project-relative-path';
import { VALID_UT_LAYERS } from './acceptance-layering';
import { validateLiteSchema } from './lite-json-schema';
import { stableAddressIndex } from './blueprint-addressing';
import { validateBlueprintProvenance } from './blueprint-provenance';
import { validateBlueprintViews } from './blueprint-views';
import { validateBlueprintContracts } from './blueprint-contracts';
import { validateRuntimeDataFlows } from './runtime-data-flow-check';
import { validateCrossViewRelations } from './blueprint-cross-view';
import { validateBlueprintQuestioning } from './blueprint-questioning';
import { validateBlueprintAdmission } from './blueprint-admission';
import { inspectGeneratedBlueprintGraphs } from './blueprint-graph-generator';
import { validateBlueprintReconciliation } from './blueprint-reconciliation';
import { validateEvolutionDecisions } from './blueprint-evolution-decisions';
import { profileHasDesignLens, validateBlueprintProviders } from './blueprint-provider-boundary';
import { fingerprintDiscoverySources, stableJson, validateTerminologyFacts } from './blueprint-discovery';
import { currentScopeItems, validateRequirementTraceability, type CurrentScopeItem } from './blueprint-requirement-traceability';
import { BlueprintGraphDisplayInspection, inspectBlueprintGraphDisplay } from './blueprint-reader-guide';
import { ACCEPTANCE_ID_PATTERN, inspectAcceptanceItem, inspectPerformanceItem, inspectTypedConstructionContent, inspectUseCaseItem, inspectDesignContentCollections, type DesignContentIssue } from './design-content-checks';

export interface ComponentBlueprintValidationContext {
  projectRoot?: string;
  canonicalPath?: string;
  /** Candidate DSL for pre-publication checks; never a persisted authority. */
  architecture?: import('../../config').ArchitectureDsl;
  /** Only a canonical reader may supply already-read authority sources. */
  sourceCache?: Map<string, unknown>;
  /** Fresh A request parsing only; never copied from a blueprint's self-declared depth. */
  requestIntake?: RequestIntake;
  requestSourceItems?: readonly CurrentScopeItem[];
}

export function isSmallBlueprintRequest(context: ComponentBlueprintValidationContext): boolean {
  return context.requestIntake?.policy.selected === 'small';
}


export function validateComponentBlueprint(
  value: unknown,
  context: ComponentBlueprintValidationContext = {},
): BlueprintIssue[] {
  const blueprint = asRecord(value);
  if (!blueprint) return [issue('component_blueprint_root_invalid', '$', 'canonical YAML 根对象必须是 map。')];
  const out = validateComponentBlueprintUpstream(blueprint, context);
  if (!isSmallBlueprintRequest(context)) out.push(...validateBlueprintAdmission(blueprint, out));
  return out;
}

/** 准入之前的全部校验——准入派生（`deriveBlueprintAdmission`）的输入；无人值守修复写回准入时与校验器同源取用。 */
export function validateComponentBlueprintUpstream(
  blueprint: BlueprintRecord,
  context: ComponentBlueprintValidationContext = {},
): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  for (const violation of validateLiteSchema(blueprint, BLUEPRINT_SCHEMA)) {
    out.push(issue('component_blueprint_schema_invalid', violation.path, violation.message));
  }
  const small = isSmallBlueprintRequest(context);
  if (!small) for (const violation of validateLiteSchema(blueprint, { $ref: '#/$defs/fullContent' }, BLUEPRINT_SCHEMA)) {
    out.push(issue('component_blueprint_schema_invalid', violation.path, violation.message));
  }
  if (blueprint.artifact !== BLUEPRINT_ARTIFACT) {
    out.push(issue('component_blueprint_artifact_invalid', '$.artifact', `artifact 必须为 ${BLUEPRINT_ARTIFACT}。`));
  }
  try {
    stableAddressIndex(blueprint);
  } catch (error) {
    out.push(issue('blueprint_address_duplicate', '$', (error as Error).message));
  }
  const discovery = asRecord(blueprint.discovery);
  const computedSourceFingerprint = fingerprintDiscoverySources(asRecords(discovery?.facts), currentScopeItems(blueprint));
  if (discovery?.source_fingerprint !== computedSourceFingerprint || blueprint.source_fingerprint !== computedSourceFingerprint) {
    out.push(issue(
      'blueprint_source_fingerprint_mismatch',
      '$.source_fingerprint',
      `来源指纹必须由 discovery facts 确定性计算：computed=${computedSourceFingerprint}, discovery=${String(discovery?.source_fingerprint)}, root=${String(blueprint.source_fingerprint)}。`,
    ));
  }
  if (small) {
    out.push(...validateBlueprintProvenance(blueprint), ...validateRequirementTraceability(blueprint, context.projectRoot),
      ...validateSmallBlueprintContent(blueprint, context),
      ...validateBlueprintContracts(blueprint, { projectRoot: context.projectRoot, sourceCache: context.sourceCache }),
      ...validateBlueprintReconciliation(blueprint),
      ...validateEvolutionDecisions(blueprint, context.projectRoot, context.architecture),
      ...validateTerminologyFacts(blueprint, context.projectRoot, context.architecture));
    return out;
  }
  const generatedGraphs = inspectGeneratedBlueprintGraphs(blueprint);
  const upstream = [
    ...validateBlueprintProvenance(blueprint),
    ...validateRequirementTraceability(blueprint, context.projectRoot),
    ...validateBlueprintViews(blueprint),
    ...validateBlueprintContracts(blueprint, { projectRoot: context.projectRoot, sourceCache: context.sourceCache }),
    ...validateRuntimeDataFlows(blueprint),
    ...validateCrossViewRelations(blueprint),
    ...validateBlueprintQuestioning(blueprint),
    ...generatedGraphs.issues,
    ...validateBlueprintReconciliation(blueprint),
    ...validateEvolutionDecisions(blueprint, context.projectRoot, context.architecture),
    ...validateTerminologyFacts(blueprint, context.projectRoot, context.architecture),
    ...validateBlueprintProviders(blueprint, { projectRoot: context.projectRoot }),
  ];
  out.push(...upstream);
  out.push(...diagnoseBlueprintPresentationShape(blueprint, inspectBlueprintGraphDisplay(blueprint, generatedGraphs.graphIssues)));
  return out;
}

/** The same typed acceptance/contracts parser is shared with request consumers; no CU is fabricated. */
function validateSmallBlueprintContent(blueprint: BlueprintRecord, context: ComponentBlueprintValidationContext): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const invalid = (at: string, message: string): void => { out.push(issue('component_blueprint_schema_invalid', at, message)); };
  const intake = context.requestIntake!;
  if (!context.projectRoot || !profileHasDesignLens(loadFrameworkConfig(context.projectRoot).project_profile.name)) {
    invalid('$', '当前profile没有已支持的蓝图design lens。');
  }
  if (!intake.user?.id || !intake.user.text || !intake.baseline.base || intake.gaps.length || intake.attribution_unknown.length) {
    invalid('$.provenance', '短内容可解析，但原生请求/准确基线或归属未核；不能签小型请求设计通过。');
  }
  const expected = context.requestSourceItems ?? [], actual = currentScopeItems(blueprint);
  if (!expected.length || !actual.length) invalid('$.discovery.inputs.current_scope_items', '小型设计仍须绑定同一原request的真实用户来源。');
  for (const item of expected) if (!actual.some(value => value.item_id === item.item_id && value.source_ref === item.source_ref && value.source_sha256 === item.source_sha256)) {
    invalid('$.discovery.inputs.current_scope_items', `原request来源没有完整保留：${item.source_ref}`);
  }
  for (const item of actual) if (!expected.some(value => value.item_id === item.item_id && value.source_ref === item.source_ref && value.source_sha256 === item.source_sha256)) {
    invalid('$.discovery.inputs.current_scope_items', `来源未绑定到当前原request：${item.source_ref}`);
  }
  if (asRecord(blueprint.review_summary)?.admission !== undefined) invalid('$.review_summary.admission', '小型请求设计不产生完整设计admission，不接受自报admitted。');
  const views = asRecords(blueprint.design_views), seen = new Set<string>();
  for (const view of views) {
    const id = String(view.view_id);
    if (seen.has(id)) invalid('$.design_views', `view_id重复：${id}`);
    seen.add(id);
  }
  try {
    const { selectBlueprintRequestContent } = require('./blueprint-skill-projection') as typeof import('./blueprint-skill-projection');
    const content = selectBlueprintRequestContent(blueprint);
    for (const [field, value] of [['acceptance', content.acceptance], ['contracts', content.contracts], ['use_cases', content.useCases]] as const) {
      if (value) for (const problem of inspectDesignContentCollections(field, value, `$.${field}`)) invalid(problem.path, problem.message);
    }
    const criteria = asRecords(content.acceptance?.criteria);
    if (!criteria.length) invalid('$.design_views', '短蓝图必须有可执行、带稳定ID的typed acceptance.criteria。');
    const ids = new Set<string>();
    for (const [index, item] of criteria.entries()) {
      const at = `$.acceptance.criteria[${index}]`;
      for (const problem of inspectAcceptanceItem(item, true, at)) invalid(problem.path, problem.message);
      if (ids.has(String(item.id))) invalid(at + '.id', `验收ID重复：${String(item.id)}`);
      ids.add(String(item.id));
      if (!VALID_UT_LAYERS.includes(item.ut_layer as never)) invalid(at + '.ut_layer', '验收须沿原分层声明unit/device/both验证方式。');
    }
    for (const [index, item] of asRecords(content.acceptance?.boundaries).entries()) {
      for (const problem of inspectAcceptanceItem(item, false, `$.acceptance.boundaries[${index}]`)) invalid(problem.path, problem.message);
    }
    for (const [index, item] of asRecords(content.acceptance?.performance).entries()) {
      for (const problem of inspectPerformanceItem(item, `$.acceptance.performance[${index}]`)) invalid(problem.path, problem.message);
    }
    const files = asStrings(content.contracts?.files);
    if (!files.length || files.length !== (Array.isArray(content.contracts?.files) ? content.contracts.files.length : 0)) invalid('$.contracts.files', '短蓝图必须保留当前已知的typed contracts.files；目标不是施工锁。');
    for (const file of files) if (context.projectRoot) try { validateProjectRelativePath(context.projectRoot, file, 'blueprint contracts.files'); } catch (error) { invalid('$.contracts.files', String(error)); }
    for (const problem of inspectTypedConstructionContent(content.contracts, '$.contracts')) invalid(problem.path, problem.message);
  } catch (error) { invalid('$.design_views', `短蓝图typed内容不能确定消费：${(error as Error).message}`); }
  for (const decision of asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions)) {
    if (decision.kind !== 'design_choice') continue;
    if (!nonEmptyString(decision.resolution ?? decision.rationale) || !nonEmptyString(decision.impact) || !asRecords(decision.alternatives).length) {
      invalid('$.decisions_and_gaps.decisions', '实际局部选择须保留选项、取舍及本模块影响；没有选择时可省略。');
    }
  }
  return out;
}

/** 可选设计表达的形状与承载位置诊断；缺失/空数组合法，坏形状也仅 WARN。 */
export function diagnoseBlueprintPresentationShape(blueprint: BlueprintRecord, graphDisplay: BlueprintGraphDisplayInspection = inspectBlueprintGraphDisplay(blueprint)): BlueprintIssue[] {
  const out: BlueprintIssue[] = [...graphDisplay.diagnostics, ...diagnoseBlueprintContent(blueprint)];
  const visit = (value: unknown, at: string): void => {
    if (Array.isArray(value)) { value.forEach((item, i) => visit(item, `${at}[${i}]`)); return; }
    const record = asRecord(value);
    if (!record) return;
    for (const [key, child] of Object.entries(record)) {
      const childPath = `${at}.${key}`;
      if (key === 'table_schema' && !/^\$\.contracts\[\d+\]$/.test(at)) {
        out.push(issue('blueprint_table_schema_misplaced', childPath,
          'table_schema 位于文档未消费的位置；已发布约定为根 contracts[].table_schema（$.contracts[i].table_schema），请由设计作者核对并修正承载。', 'WARN'));
      }
      visit(child, childPath);
    }
  };
  visit(blueprint, '$');
  const string = { type: 'string' };
  const strings = { type: 'array', items: string };
  const rows = (properties: BlueprintRecord): BlueprintRecord => ({ type: 'array', items: { type: 'object', properties, required: Object.keys(properties) } });
  const check = (value: unknown, at: string, properties: BlueprintRecord): void => {
    if (value === undefined) return;
    for (const violation of validateLiteSchema(value, { type: 'object', properties }, undefined, at)) out.push(issue('blueprint_presentation_shape_invalid', violation.path, violation.message, 'WARN'));
  };
  check(blueprint.review_summary, '$.review_summary', { background: string, problem: string, goals: rows({ goal_id: string, statement: string, success_measures: strings }), positioning: string, in_scope: strings, non_goals: strings });
  check(blueprint, '$', { quality_attributes: rows({ qa_id: string, category: string, requirement: string, landing: string, source_ref: string, verification_refs: strings }), data_domains: rows({ data_domain_id: string, usage: string, retention: string, isolation: string, cleanup: string, security: string }) });
  asRecords(asRecord(blueprint.decisions_and_gaps)?.decisions).forEach((decision, i) => check(decision, `$.decisions_and_gaps.decisions[${i}]`, { alternatives: rows({ option: string, rejected_reason: string, defect: string }) }));
  asRecords(asRecord(blueprint.discovery)?.facts).forEach((fact, i) => {
    if (String(fact.subject).startsWith('term:') && asRecord(fact.value)) check(fact.value, `$.discovery.facts[${i}].value`, { meaning: string });
  });
  asRecords(blueprint.design_views).forEach((view, i) => {
    if (view.view_id === 'scenarios') asRecords(view.nodes).forEach((node, j) => check(node, `$.design_views[${i}].nodes[${j}]`, { journey_steps: rows({ step_id: string, stage: string, user_action: string, system_behavior: string, preconditions: strings }), path_variants: rows({ user_type: string, difference: string }) }));
    if (view.view_id === 'deployment') {
      check(view, `$.design_views[${i}]`, { rollout: rows({ order: { type: 'number' }, unit: string, depends_on: strings, note: string }), coordination: rows({ counterpart: string, relation: string }) });
      asRecords(view.nodes).forEach((node, j) => check(node, `$.design_views[${i}].nodes[${j}]`, { responsibilities: strings, inputs: strings, outputs: strings, not_responsible_for: strings, failure_impact: string }));
    }
  });
  return out;
}

/** 定位设计条目及可能冲突的引用；片段合并与正式裁决仍由实际 CU 消费。 */
export function diagnoseBlueprintContent(blueprint: BlueprintRecord): BlueprintIssue[] {
  let targets: ReturnType<typeof stableAddressIndex>;
  try { targets = stableAddressIndex(blueprint); } catch { return []; } // 重复地址仍由原 BLOCKER 负责。
  const paths = new Map<object, string>();
  const locate = (value: unknown, at: string): void => {
    if (!value || typeof value !== 'object' || paths.has(value)) return;
    paths.set(value, at);
    if (Array.isArray(value)) value.forEach((item, i) => locate(item, `${at}[${i}]`));
    else for (const [key, child] of Object.entries(value)) locate(child, `${at}.${key}`);
  };
  locate(blueprint, '$');
  const found: DesignContentIssue[] = [];
  const acceptanceDefinitions = new Map<string, { path: string; content: string }>();
  const useCaseFragments = new Set<BlueprintRecord>();
  let firstUseCasePath: string | undefined;
  let hasUseCaseVersion = false;
  for (const [address, target] of targets) {
    if (address.startsWith('gap:')) continue;
    const targetPath = paths.get(target)!;
    const useCases = asRecord(target.use_cases);
    if (useCases && !useCaseFragments.has(useCases)) {
      useCaseFragments.add(useCases);
      hasUseCaseVersion ||= !!useCases.schema_version; // 与原 usecase_spec_schema 的真值判据一致。
      if (!firstUseCasePath && Array.isArray(useCases.use_cases) && useCases.use_cases.length) firstUseCasePath = `${targetPath}.use_cases`;
    }
    // 根 contracts 为业务 operation/DTO 集合；根目标只参与整图用例版本诊断。
    if (address.startsWith('blueprint:')) continue;
    for (const kind of ['acceptance', 'contracts', 'use_cases'] as const) {
      const content = asRecord(target[kind]);
      if (!content) continue;
      const at = `${targetPath}.${kind}`;
      found.push(...inspectDesignContentCollections(kind, content, at));
      if (kind === 'acceptance') {
        const localIds = new Set<string>();
        for (const key of ['criteria', 'boundaries', 'performance'] as const) {
          if (!Array.isArray(content[key])) continue;
          (content[key] as unknown[]).forEach((item, i) => {
            const itemPath = `${at}.${key}[${i}]`;
            if (key === 'performance') { found.push(...inspectPerformanceItem(item, itemPath)); return; }
            found.push(...inspectAcceptanceItem(item, key === 'criteria', itemPath));
            const id = asRecord(item)?.id;
            if (typeof id !== 'string' || !ACCEPTANCE_ID_PATTERN.test(id)) return;
            const normalizedId = id.toUpperCase();
            const definition = stableJson([key, item]);
            const previous = acceptanceDefinitions.get(normalizedId);
            if (localIds.has(normalizedId)) {
              found.push({ path: itemPath, message: `${id} 在同一验收片段内重复，须保留唯一条目或为不同义务分配独立 ID`, fields: ['id'] });
            } else if (previous && previous.content !== definition) {
              found.push({ path: itemPath, message: `${id} 与 ${previous.path} 的定义不同；若由同一 CU 消费，按原验收归属核对并为不同义务分配独立 ID`, fields: ['id'] });
            } else if (!previous) acceptanceDefinitions.set(normalizedId, { path: itemPath, content: definition });
            localIds.add(normalizedId);
          });
        }
      } else if (kind === 'contracts') found.push(...inspectTypedConstructionContent(content, at));
      else if (Array.isArray(content.use_cases)) content.use_cases.forEach((item, i) => found.push(...inspectUseCaseItem(item, `${at}.use_cases[${i}]`)));
    }
  }
  if (firstUseCasePath && !hasUseCaseVersion) found.push({
    path: `${firstUseCasePath}.schema_version`,
    message: '整份蓝图的可消费用例片段均缺少 schema_version；最终用例产物须提供版本，派生不会自动补写。',
  });
  const seen = new Set<string>();
  return found.flatMap(problem => {
    const message = `${problem.message}${problem.fields?.length ? `；字段：${problem.fields.join(', ')}` : ''}`;
    const identity = `${problem.path}\n${message}`;
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [issue('blueprint_content_incomplete', problem.path, message, 'WARN')];
  });
}

export function blockerIssues(issues: BlueprintIssue[]): BlueprintIssue[] {
  return issues.filter(item => item.severity === 'BLOCKER');
}

export function assertValidComponentBlueprint(
  value: unknown,
  context: ComponentBlueprintValidationContext = {},
): BlueprintRecord {
  const issues = blockerIssues(validateComponentBlueprint(value, context));
  if (issues.length > 0) throw new Error(issues.map(item => `[${item.id}] ${item.path}: ${item.message}`).join('\n'));
  return value as BlueprintRecord;
}
