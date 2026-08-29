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

/**
 * M7：`applicability`（部件类型固有适用性，二值）与 `evolution_impact`（本次演进影响）
 * 正交。三态合并枚举被明确拒绝——既有消费者按字面 `applicability !== 'applicable'` 跳过
 * 视图，合并会让 `changed` 视图被静默跳过（meta-model
 * `View applicability and evolution impact stay orthogonal`）。
 */
export const EVOLUTION_IMPACTS = ['changed', 'verified_unchanged'] as const;
export type EvolutionImpact = (typeof EVOLUTION_IMPACTS)[number];

/** 视图是否被本次演进适用（部件类型固有适用性）。 */
export function isApplicableView(view: BlueprintRecord): boolean {
  return view.applicability === 'applicable';
}

/**
 * applicable 视图的本次演进影响；not_applicable 视图不携带该维度（返回 undefined）。
 * 非法/缺失值返回 undefined，由 validateBlueprintViews 报 BLOCKER——消费方不得把
 * undefined 当作 `verified_unchanged` 静默放行。
 */
export function viewEvolutionImpact(view: BlueprintRecord): EvolutionImpact | undefined {
  if (!isApplicableView(view)) return undefined;
  const raw = String(view.evolution_impact ?? '');
  return (EVOLUTION_IMPACTS as readonly string[]).includes(raw) ? (raw as EvolutionImpact) : undefined;
}

/** 本次演进真正改变的视图：applicable + changed。全量设计义务只挂在这类视图上。 */
export function isChangedView(view: BlueprintRecord): boolean {
  return viewEvolutionImpact(view) === 'changed';
}

/** 本次演进"无改变"的合法 delta 字面量。 */
const NO_CHANGE_DELTAS = ['none', 'no_change', 'unchanged'] as const;

/**
 * 某个带 current_state/target_state/delta 三元组的对象是否声明了本次改变。
 * 唯一判据实现，三处共用：P1 的 verified_unchanged 掩盖检测（**视图级与节点级各调一次**）
 * 与 P3 的 closure 施工义务派生，避免多处实现漂移。
 */
function declaresChange(record: BlueprintRecord): boolean {
  const delta = String(record.delta ?? '').trim().toLowerCase();
  if (delta && !(NO_CHANGE_DELTAS as readonly string[]).includes(delta)) return true;
  return JSON.stringify(record.current_state) !== JSON.stringify(record.target_state);
}

/** 节点是否声明了本次改变。 */
export function nodeDeclaresChange(node: BlueprintRecord): boolean {
  return declaresChange(node);
}

/**
 * **视图自身**是否声明了本次改变。节点级检查抓不到"把节点抹平、视图仍宣告
 * current≠target / 实质 delta"这条洗白路径，故必须单独判一次。
 */
export function viewDeclaresChange(view: BlueprintRecord): boolean {
  return declaresChange(view);
}

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
    ...(viewId === 'deployment' && !deploymentApplicable ? {} : { evolution_impact: 'changed' }),
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
    // M7：applicability 与 evolution_impact 正交。applicable 视图必须显式裁决本次演进影响；
    // not_applicable 视图不携带该维度（携带即语义越界）。
    if (view.applicability === 'applicable') {
      const impact = viewEvolutionImpact(view);
      if (!impact) {
        out.push(issue(
          'blueprint_view_evolution_impact_invalid',
          `$.design_views[${index}].evolution_impact`,
          `适用视图 ${viewId} 必须显式裁决本次演进影响：${EVOLUTION_IMPACTS.join('|')}。`,
        ));
      }
      if (impact === 'verified_unchanged') {
        // verified_unchanged 免除 target/delta 与可寻址节点义务，但必须交出事实依据与当前态引用；
        // 且不得掩盖真实变化——**视图自身**或其任一节点声明 delta 都证伪该不变声明。
        const evidence = asRecord(view.unchanged_evidence);
        if (!evidence
          || asStrings(evidence.evidence_refs).length === 0
          || !nonEmptyString(evidence.current_state_ref)) {
          out.push(issue(
            'blueprint_view_unchanged_evidence_missing',
            `$.design_views[${index}].unchanged_evidence`,
            `视图 ${viewId} 声明 verified_unchanged 时必须带 evidence_refs 与 current_state_ref 的事实依据。`,
          ));
        }
        if (!hasSubstance(view.current_state)) {
          out.push(issue('blueprint_view_content_empty', `$.design_views[${index}].current_state`, `适用视图 ${viewId} 的 current_state 不能是 unknown/空壳。`));
        }
        // view-level 矛盾：把节点抹平但视图自身仍宣告 current≠target / 实质 delta，
        // 是最容易漏掉的洗白路径（节点级检查抓不到）。判据与节点级同源。
        if (viewDeclaresChange(view)) {
          out.push(issue(
            'blueprint_view_unchanged_masks_change',
            `$.design_views[${index}]`,
            `视图 ${viewId} 声明 verified_unchanged，但视图自身仍声明本次演进 delta（current_state≠target_state 或 delta 非 none）；不变声明不得掩盖真实变化。`,
          ));
        }
        asRecords(view.nodes).forEach((node, nodeIndex) => {
          if (nodeDeclaresChange(node)) {
            out.push(issue(
              'blueprint_view_unchanged_masks_change',
              `$.design_views[${index}].nodes[${nodeIndex}]`,
              `视图 ${viewId} 声明 verified_unchanged，但节点 ${String(node.node_id)} 声明了本次 delta；不变声明不得掩盖真实变化。`,
            ));
          }
        });
      } else {
        for (const field of ['current_state', 'target_state', 'delta']) {
          if (!hasSubstance(view[field])) {
            out.push(issue('blueprint_view_content_empty', `$.design_views[${index}].${field}`, `适用视图 ${viewId} 的 ${field} 不能是 unknown/空壳。`));
          }
        }
        if (asRecords(view.nodes).length === 0) {
          out.push(issue('blueprint_view_nodes_empty', `$.design_views[${index}].nodes`, `适用视图 ${viewId} 必须有可寻址节点。`));
        }
      }
      if (asStrings(view.verification_refs).length === 0) {
        out.push(issue('blueprint_view_verification_empty', `$.design_views[${index}].verification_refs`, `适用视图 ${viewId} 必须有 verification_refs。`));
      }
    } else if (view.evolution_impact !== undefined) {
      out.push(issue(
        'blueprint_view_evolution_impact_not_applicable',
        `$.design_views[${index}].evolution_impact`,
        `not_applicable 视图 ${viewId} 不承载本次演进影响维度。`,
      ));
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
  // M7 完整性不变量：零 changed 视图即"本次不是演进"，fail-closed（不生成 admitted 蓝图）。
  if (!views.some(isChangedView)) {
    out.push(issue(
      'blueprint_evolution_impact_no_changed_view',
      '$.design_views',
      '至少一个 applicable + changed 视图；全部 verified_unchanged 表示本次不构成演进。',
    ));
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
