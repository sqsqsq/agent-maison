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
import { fingerprintDiscoverySources } from './blueprint-discovery';
import { currentScopeItems, validateRequirementTraceability } from './blueprint-requirement-traceability';

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
    ...validateBlueprintProviders(blueprint, { projectRoot: context.projectRoot }),
  ];
  out.push(...upstream);
  out.push(...validateBlueprintAdmission(blueprint, out));
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
