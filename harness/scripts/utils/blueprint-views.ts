import {
  BlueprintIssue,
  BlueprintRecord,
  VIEW_IDS,
  asRecord,
  asRecords,
  asStrings,
  getId,
  issue,
  nonEmptyString,
} from './component-blueprint-model';

export const APP_LENS_QUESTIONS = [
  'module_boundaries',
  'capability_seams',
  'feature_flags',
  'data_producers_consumers',
  'lifecycle_triggers',
  'state_owners',
  'initialization',
  'publication_subscription',
  'ui_refresh',
  'process_recovery',
] as const;

export function createAppViewInstances(
  seeds: Partial<Record<(typeof VIEW_IDS)[number], BlueprintRecord>>,
  deploymentApplicable: boolean,
): BlueprintRecord[] {
  return VIEW_IDS.map(viewId => ({
    view_id: viewId,
    viewpoint_contract: `app-${viewId}@1`,
    applicability: viewId === 'deployment' && !deploymentApplicable ? 'not_applicable' : 'applicable',
    stakeholders: [],
    purpose: '',
    current_state: 'unknown',
    target_state: 'unknown',
    delta: 'unknown',
    decisions_and_gaps: [],
    verification_refs: [],
    nodes: [],
    ...(seeds[viewId] ?? {}),
  }));
}

export function createAppLens(
  answers: Record<(typeof APP_LENS_QUESTIONS)[number], BlueprintRecord>,
  runtimeFlowTriggerAssessment: BlueprintRecord,
): BlueprintRecord {
  return { ...answers, runtime_flow_trigger_assessment: runtimeFlowTriggerAssessment };
}

function hasSubstance(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0 && !['unknown', 'tbd', 'todo'].includes(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length > 0;
  const record = asRecord(value);
  if (record) return Object.keys(record).length > 0;
  return value !== undefined && value !== null;
}

export function validateBlueprintViews(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const views = asRecords(blueprint.design_views);
  const seen = new Set<string>();
  views.forEach((view, index) => {
    const viewId = getId(view, 'view_id');
    if (!viewId || !(VIEW_IDS as readonly string[]).includes(viewId)) {
      out.push(issue('blueprint_view_id_invalid', `$.design_views[${index}].view_id`, 'view_id 必须是固定 4+1 id。'));
      return;
    }
    if (seen.has(viewId)) out.push(issue('blueprint_view_duplicate', `$.design_views[${index}].view_id`, `view_id=${viewId} 重复。`));
    seen.add(viewId);
    if (!nonEmptyString(view.viewpoint_contract)) {
      out.push(issue('blueprint_viewpoint_contract_missing', `$.design_views[${index}].viewpoint_contract`, 'view instance 必须引用 viewpoint contract。'));
    }
    if (!['applicable', 'not_applicable'].includes(String(view.applicability))) {
      out.push(issue('blueprint_view_applicability_invalid', `$.design_views[${index}].applicability`, 'applicability 必须显式裁决。'));
    }
    for (const field of ['purpose']) {
      if (!nonEmptyString(view[field])) out.push(issue('blueprint_view_shape_missing', `$.design_views[${index}].${field}`, `${field} 必填。`));
    }
    if (asStrings(view.stakeholders).length === 0) {
      out.push(issue('blueprint_view_shape_missing', `$.design_views[${index}].stakeholders`, 'stakeholders 不得为空。'));
    }
    for (const field of ['current_state', 'target_state', 'delta', 'decisions_and_gaps', 'verification_refs', 'nodes']) {
      if (view[field] === undefined) out.push(issue('blueprint_view_shape_missing', `$.design_views[${index}].${field}`, `${field} 必填。`));
    }
    if (view.applicability === 'applicable') {
      for (const field of ['current_state', 'target_state', 'delta']) {
        if (!hasSubstance(view[field])) {
          out.push(issue('blueprint_view_content_empty', `$.design_views[${index}].${field}`, `适用视图 ${viewId} 的 ${field} 不能是 unknown/空壳。`));
        }
      }
      if (asRecords(view.nodes).length === 0) {
        out.push(issue('blueprint_view_nodes_empty', `$.design_views[${index}].nodes`, `适用视图 ${viewId} 必须有可寻址节点。`));
      }
      if (asStrings(view.verification_refs).length === 0) {
        out.push(issue('blueprint_view_verification_empty', `$.design_views[${index}].verification_refs`, `适用视图 ${viewId} 必须有 verification_refs。`));
      }
    }
    if (viewId !== 'deployment' && view.applicability !== 'applicable') {
      out.push(issue('blueprint_required_view_not_applicable', `$.design_views[${index}].applicability`, `${viewId} 对 App 蓝图必须适用。`));
    }
    if (viewId === 'deployment' && view.applicability === 'not_applicable') {
      const applicabilityEvidence = asRecord(view.applicability_evidence);
      if (!applicabilityEvidence || asStrings(applicabilityEvidence.evidence_refs).length === 0 || applicabilityEvidence.disposition !== 'not_applicable') {
        out.push(issue('blueprint_deployment_na_evidence_missing', `$.design_views[${index}].applicability_evidence`, 'deployment 不适用必须有证据与 not_applicable disposition。'));
      }
    }
  });
  for (const viewId of VIEW_IDS) {
    if (!seen.has(viewId)) out.push(issue('blueprint_required_view_missing', '$.design_views', `缺少 view instance：${viewId}。`));
  }

  const appLens = asRecord(blueprint.app_lens);
  for (const question of APP_LENS_QUESTIONS) {
    const answer = asRecord(appLens?.[question]);
    if (!answer || !['answered_with_evidence', 'decided_with_authority', 'open_decision', 'blocker', 'not_applicable'].includes(String(answer.disposition))) {
      out.push(issue('app_lens_question_unanswered', `$.app_lens.${question}`, `App lens 根问题 ${question} 必须有合法 disposition。`));
      continue;
    }
    if (answer.disposition === 'answered_with_evidence' && asStrings(answer.evidence_refs).length === 0) {
      out.push(issue('app_lens_evidence_missing', `$.app_lens.${question}.evidence_refs`, 'answered_with_evidence 必须有 evidence_refs。'));
    }
  }
  return out;
}
