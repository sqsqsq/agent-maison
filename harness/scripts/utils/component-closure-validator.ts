import * as fs from 'fs';
import * as path from 'path';
import {
  COMPONENT_CLOSURE_ARTIFACT,
  ComponentClosureArtifact,
  ComponentClosureIssue,
  closureIssue,
} from './component-closure-model';
import { validateLiteSchema } from './lite-json-schema';
import {
  ComponentClosureInputOptions,
  fingerprintComponentClosureInputs,
  resolveComponentClosureInputs,
} from './component-closure-inputs';
import { deriveComponentClosureObligations } from './component-closure-obligations';
import { deriveComponentClosureCoverage } from './component-closure-coverage';
import {
  ClosureEvidenceProvider,
  deriveClosureProviderObservations,
} from './component-closure-provider-boundary';
import { applyEvidenceProviderAvailability } from './component-closure-evidence';
import { validateComponentClosureCrossView } from './component-closure-cross-view';
import { validateComponentClosureRuntime } from './component-closure-runtime';
import { validateComponentClosureAssembly } from './component-closure-assembly';
import { validateComponentClosureEvolutionSeams } from './component-closure-evolution-seam';
import { validateComponentClosureKnowledge } from './component-closure-knowledge';
import { deriveComponentClosureVerdict } from './component-closure-verdict';
import { stableJson } from './blueprint-discovery';
import { resolveComponentBlueprintRef } from './component-blueprint-path';

export interface ComponentClosureEvaluationOptions extends ComponentClosureInputOptions {
  evaluatedAt?: string;
  evidenceProviders?: ClosureEvidenceProvider[];
}

export interface ComponentClosureEvaluation {
  closure: ComponentClosureArtifact;
  issues: ComponentClosureIssue[];
}

function loadClosureSchema(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'schemas', 'component-closure.schema.json'), 'utf8')) as Record<string, unknown>;
}

export function evaluateComponentClosure(
  projectRoot: string,
  blueprintId: string,
  options: ComponentClosureEvaluationOptions = {},
): ComponentClosureEvaluation {
  const inputs = resolveComponentClosureInputs(projectRoot, blueprintId, options);
  const obligations = deriveComponentClosureObligations(projectRoot, inputs);
  let rows = deriveComponentClosureCoverage(projectRoot, inputs, obligations);
  const providers = deriveClosureProviderObservations(projectRoot, inputs, rows, options.evidenceProviders);
  rows = applyEvidenceProviderAvailability(rows, providers);
  const issues: ComponentClosureIssue[] = [...inputs.issues];
  for (const unit of inputs.currentUnits) {
    if (unit.input.completion !== 'VALID') {
      issues.push(closureIssue(
        `component_closure_completion_${unit.input.completion.toLowerCase()}`,
        `change-unit:${unit.changeUnit.change_unit_id}`,
        `派生 Feature ${unit.input.feature_id} completion=${unit.input.completion}：${unit.input.completion_reasons.join('；')}`,
        'BLOCKER',
        'repair_feature_or_evidence',
      ));
    }
    if (!unit.input.carry_forward) {
      issues.push(closureIssue(
        'component_closure_carry_forward_rejected',
        `change-unit:${unit.changeUnit.change_unit_id}`,
        unit.input.carry_forward_reasons.join('；') || '历史 CU 不满足 current blueprint carry-forward。',
        'BLOCKER',
        'reconcile_blueprint',
      ));
    }
    const feature = inputs.manifest.features.find(item => item.feature_id === unit.input.feature_id);
    for (const issueId of feature?.projection_issue_ids ?? []) {
      issues.push(closureIssue(
        `component_closure_feature_projection_invalid:${issueId}`,
        `feature:${unit.input.feature_id}`,
        `Feature construction projection 未通过：${issueId}`,
        'BLOCKER',
        'repair_feature_or_evidence',
      ));
    }
  }
  for (const provider of providers) {
    if (provider.status === 'conflict') {
      issues.push(closureIssue(
        'component_closure_provider_authority_conflict',
        `provider:${provider.provider_id}`,
        '同一证据 Provider identity 出现重复或矛盾的权威 observation。',
        'BLOCKER',
        'resolve_authority_or_risk',
      ));
    }
  }
  issues.push(...validateComponentClosureCrossView(inputs, rows));
  issues.push(...validateComponentClosureRuntime(projectRoot, inputs, rows));
  issues.push(...validateComponentClosureAssembly(inputs, rows));
  issues.push(...validateComponentClosureEvolutionSeams(projectRoot, inputs));
  const knowledge = validateComponentClosureKnowledge(projectRoot, inputs);
  issues.push(...knowledge.issues);
  const verdict = deriveComponentClosureVerdict(rows, providers, issues);
  const inputFingerprint = fingerprintComponentClosureInputs({
    component_blueprint_ref: inputs.blueprintRef,
    inputs: inputs.manifest,
    provider_observations: providers,
  });
  return {
    closure: {
      artifact: COMPONENT_CLOSURE_ARTIFACT,
      component_id: inputs.blueprintRef.component_id,
      blueprint_id: blueprintId,
      component_blueprint_ref: inputs.blueprintRef,
      input_fingerprint: inputFingerprint,
      evaluated_at: options.evaluatedAt ?? new Date().toISOString(),
      inputs: inputs.manifest,
      coverage_rows: rows,
      provider_observations: providers,
      knowledge_writeback_refs: knowledge.refs,
      degradations: verdict.degradations,
      gaps: verdict.gaps,
      verdict: verdict.verdict,
    },
    issues,
  };
}

function compareField(
  actual: ComponentClosureArtifact,
  expected: ComponentClosureArtifact,
  key: keyof ComponentClosureArtifact,
  issueId: string,
  out: ComponentClosureIssue[],
): void {
  if (stableJson(actual[key]) !== stableJson(expected[key])) {
    out.push(closureIssue(issueId, `$.${key}`, `${String(key)} 必须由稳定内核完整重算，不接受手工删改、调换或自报。`));
  }
}

export function validateComponentClosure(
  value: unknown,
  projectRoot: string,
  blueprintId: string,
  options: ComponentClosureEvaluationOptions = {},
): ComponentClosureEvaluation {
  const out: ComponentClosureIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { closure: value as ComponentClosureArtifact, issues: [closureIssue('component_closure_root_invalid', '$', '根对象必须是 map。')] };
  }
  const actual = value as ComponentClosureArtifact;
  for (const violation of validateLiteSchema(actual, loadClosureSchema())) {
    out.push(closureIssue('component_closure_schema_invalid', violation.path, violation.message));
  }
  // M5A §8.1/8.4：path/content/ref 三方 blueprint_id 一致 + content/ref component_id 一致
  const pathBlueprint = blueprintId;
  const yamlBlueprint = actual.blueprint_id;
  const refBlueprint = actual.component_blueprint_ref?.blueprint_id;
  if (yamlBlueprint !== pathBlueprint || refBlueprint !== pathBlueprint) {
    out.push(closureIssue('component_closure_identity_mismatch', '$.blueprint_id',
      `blueprint identity 不一致：path=${pathBlueprint}, yaml=${String(yamlBlueprint)}, blueprint_ref=${String(refBlueprint)}。`));
  }
  if (actual.component_id !== actual.component_blueprint_ref?.component_id) {
    out.push(closureIssue('component_closure_identity_mismatch', '$.component_id',
      `component identity 不一致：yaml=${String(actual.component_id)}, blueprint_ref=${String(actual.component_blueprint_ref?.component_id)}。`));
  }
  try {
    resolveComponentBlueprintRef(projectRoot, actual.component_blueprint_ref);
  } catch (error) {
    out.push(closureIssue('component_closure_blueprint_ref_unresolvable', '$.component_blueprint_ref', (error as Error).message, 'BLOCKER', 'reconcile_blueprint'));
  }
  const evaluated = evaluateComponentClosure(projectRoot, blueprintId, { ...options, evaluatedAt: actual.evaluated_at });
  const expected = evaluated.closure;
  compareField(actual, expected, 'component_blueprint_ref', 'component_closure_blueprint_binding_mismatch', out);
  compareField(actual, expected, 'inputs', 'component_closure_input_manifest_mismatch', out);
  compareField(actual, expected, 'provider_observations', 'component_closure_provider_observation_mismatch', out);
  compareField(actual, expected, 'coverage_rows', 'component_closure_coverage_mismatch', out);
  compareField(actual, expected, 'knowledge_writeback_refs', 'component_closure_knowledge_mismatch', out);
  compareField(actual, expected, 'degradations', 'component_closure_degradation_mismatch', out);
  compareField(actual, expected, 'gaps', 'component_closure_gap_mismatch', out);
  compareField(actual, expected, 'verdict', 'component_closure_verdict_mismatch', out);
  if (actual.input_fingerprint !== expected.input_fingerprint) {
    out.push(closureIssue('component_closure_input_fingerprint_stale', '$.input_fingerprint', `input_fingerprint stale：expected=${expected.input_fingerprint}, actual=${String(actual.input_fingerprint)}。`));
  }
  return { closure: expected, issues: [...out, ...evaluated.issues] };
}
