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
import { validateGeneratedBlueprintGraphs } from './blueprint-graph-generator';
import { validateBlueprintReconciliation } from './blueprint-reconciliation';
import { validateEvolutionDecisions } from './blueprint-evolution-decisions';
import { validateBlueprintProviders } from './blueprint-provider-boundary';
import { fingerprintDiscoverySources, validateTerminologyFacts } from './blueprint-discovery';
import { currentScopeItems, validateRequirementTraceability } from './blueprint-requirement-traceability';
import { inspectBlueprintReaderGuide } from './blueprint-reader-guide';

export interface ComponentBlueprintValidationContext {
  projectRoot?: string;
  canonicalPath?: string;
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
  const upstream = [
    ...validateBlueprintProvenance(blueprint),
    ...validateRequirementTraceability(blueprint, context.projectRoot),
    ...validateBlueprintViews(blueprint),
    ...validateBlueprintContracts(blueprint, { projectRoot: context.projectRoot }),
    ...validateRuntimeDataFlows(blueprint),
    ...validateCrossViewRelations(blueprint),
    ...validateBlueprintQuestioning(blueprint),
    ...validateGeneratedBlueprintGraphs(blueprint),
    ...validateBlueprintReconciliation(blueprint),
    ...validateEvolutionDecisions(blueprint, context.projectRoot),
    ...validateTerminologyFacts(blueprint, context.projectRoot),
    ...validateBlueprintProviders(blueprint, { projectRoot: context.projectRoot }),
  ];
  out.push(...upstream);
  out.push(...diagnoseBlueprintPresentationShape(blueprint));
  return out;
}

/** 可选设计表达的形状与承载位置诊断；缺失/空数组合法，坏形状也仅 WARN。 */
export function diagnoseBlueprintPresentationShape(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [...inspectBlueprintReaderGuide(blueprint).diagnostics];
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
