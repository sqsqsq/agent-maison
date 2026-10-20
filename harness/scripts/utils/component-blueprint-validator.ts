import * as fs from 'fs';
import * as path from 'path';
import {
  BLUEPRINT_ARTIFACT,
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  issue,
} from './component-blueprint-model';
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
import { validateBlueprintProviders } from './blueprint-provider-boundary';
import { fingerprintDiscoverySources, validateTerminologyFacts } from './blueprint-discovery';
import { currentScopeItems, validateRequirementTraceability } from './blueprint-requirement-traceability';
import { BlueprintGraphDisplayInspection, inspectBlueprintGraphDisplay } from './blueprint-reader-guide';
import { inspectAcceptanceItem, inspectPerformanceItem, inspectTypedConstructionContent, inspectUseCaseItem, inspectDesignContentCollections, type DesignContentIssue } from './design-content-checks';

export interface ComponentBlueprintValidationContext {
  projectRoot?: string;
  canonicalPath?: string;
  /** Candidate DSL for pre-publication checks; never a persisted authority. */
  architecture?: import('../../config').ArchitectureDsl;
  /** Only a canonical reader may supply already-read authority sources. */
  sourceCache?: Map<string, unknown>;
}

function loadBlueprintSchema(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'schemas', 'app-component-blueprint.schema.json'), 'utf8')) as Record<string, unknown>;
}

export function validateComponentBlueprint(
  value: unknown,
  context: ComponentBlueprintValidationContext = {},
): BlueprintIssue[] {
  const blueprint = asRecord(value);
  if (!blueprint) return [issue('component_blueprint_root_invalid', '$', 'canonical YAML 根对象必须是 map。')];
  const out = validateComponentBlueprintUpstream(blueprint, context);
  out.push(...validateBlueprintAdmission(blueprint, out));
  return out;
}

/** 准入之前的全部校验——准入派生（`deriveBlueprintAdmission`）的输入；无人值守修复写回准入时与校验器同源取用。 */
export function validateComponentBlueprintUpstream(
  blueprint: BlueprintRecord,
  context: ComponentBlueprintValidationContext = {},
): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  for (const violation of validateLiteSchema(blueprint, loadBlueprintSchema())) {
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

/** 只看既有设计目标中的条目自身；不合并片段、不派生 CU、不改变准入。 */
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
        for (const key of ['criteria', 'boundaries', 'performance'] as const) {
          if (!Array.isArray(content[key])) continue;
          (content[key] as unknown[]).forEach((item, i) => found.push(...(key === 'performance'
            ? inspectPerformanceItem(item, `${at}.${key}[${i}]`) : inspectAcceptanceItem(item, key === 'criteria', `${at}.${key}[${i}]`))));
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
