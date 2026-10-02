import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';

/** 机器从上游 checker 结果派生的准入值（`review_summary.admission` 里不允许自报的那几项）。 */
export interface DerivedBlueprintAdmission {
  status: 'pass' | 'blocker';
  root_questions_complete: boolean;
  contracts_ready: boolean;
  design_refs_ready: boolean;
  /** 派生为 blocker 的原因（上游 BLOCKER id，外加当前切片的资产缺口）。 */
  blocker_ids: string[];
  /** 当前切片的组件资产缺口所在的 gaps 下标（校验器据此逐条出 issue）。 */
  asset_blocker_gap_indexes: number[];
}

/**
 * 准入的唯一派生（plan 9c3d7e1a §5.5 第 4 步）：校验器与无人值守修复的运行时写回同源。
 * `current_slice.slice_id` 是作者字段，这里只读不改。
 */
export function deriveBlueprintAdmission(blueprint: BlueprintRecord, upstreamIssues: BlueprintIssue[] = []): DerivedBlueprintAdmission {
  const currentSlice = asRecord(asRecord(asRecord(blueprint.review_summary)?.admission)?.current_slice);
  const blockerIds = upstreamIssues.filter(item => item.severity === 'BLOCKER').map(item => item.id);
  const rootQuestionsComplete = !blockerIds.some(id => id.startsWith('app_lens_') || id.startsWith('blueprint_questioning_'));
  const contractsReady = asRecords(blueprint.contracts).length > 0
    && !blockerIds.some(id => id.startsWith('blueprint_contract_'));
  const designRefsReady = !blockerIds.some(id =>
    id.startsWith('blueprint_address_')
    || id.startsWith('blueprint_cross_view_')
    || id.startsWith('blueprint_required_view_')
    || id.startsWith('blueprint_view_')
    || id.startsWith('blueprint_relation_')
    || id.startsWith('blueprint_scenario_')
    || id.startsWith('blueprint_runtime_')
    || id.startsWith('blueprint_design_basis_')
    || id.startsWith('runtime_flow_')
    || id === 'blueprint_relations_empty',
  );
  const assetGaps = asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps).flatMap((gap, index) =>
    gap.needed_by === currentSlice?.slice_id && gap.status === 'blocker'
      && asStrings(gap.verification_refs).includes('provider:component-assets') ? [index] : []);
  for (const _index of assetGaps) blockerIds.push('blueprint_current_asset_blocker');
  return {
    status: blockerIds.length === 0 ? 'pass' : 'blocker',
    root_questions_complete: rootQuestionsComplete,
    contracts_ready: contractsReady,
    design_refs_ready: designRefsReady,
    blocker_ids: blockerIds,
    asset_blocker_gap_indexes: assetGaps,
  };
}

export function validateBlueprintAdmission(
  blueprint: BlueprintRecord,
  upstreamIssues: BlueprintIssue[] = [],
): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const admission = asRecord(asRecord(blueprint.review_summary)?.admission);
  if (!admission) return [issue('blueprint_admission_missing', '$.review_summary.admission', '缺少分层准入结果。')];
  const derived = deriveBlueprintAdmission(blueprint, upstreamIssues);
  if (admission.root_questions_complete !== derived.root_questions_complete) {
    out.push(issue('blueprint_admission_self_asserted', '$.review_summary.admission.root_questions_complete', `root_questions_complete 必须由实际 App lens/质询覆盖派生为 ${derived.root_questions_complete}。`));
  }
  const currentSlice = asRecord(admission.current_slice);
  if (!currentSlice || !nonEmptyString(currentSlice.slice_id)) {
    out.push(issue('blueprint_admission_current_slice_not_ready', '$.review_summary.admission.current_slice', '当前切片必须冻结契约和 design refs，或显式声明受控 fake。'));
  } else {
    if (currentSlice.contracts_ready !== derived.contracts_ready) {
      out.push(issue('blueprint_admission_self_asserted', '$.review_summary.admission.current_slice.contracts_ready', `contracts_ready 必须由契约 checker 派生为 ${derived.contracts_ready}。`));
    }
    if (currentSlice.design_refs_ready !== derived.design_refs_ready) {
      out.push(issue('blueprint_admission_self_asserted', '$.review_summary.admission.current_slice.design_refs_ready', `design_refs_ready 必须由地址/跨视图/flow checker 派生为 ${derived.design_refs_ready}。`));
    }
  }
  asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps).forEach((gap, index) => {
    if (gap.status === 'not_applicable' && gap.knowledge_state === 'unknown') {
      out.push(issue('blueprint_unknown_erased_by_na', `$.decisions_and_gaps.gaps[${index}]`, 'unknown 不得被 not_applicable 洗掉。'));
    }
    if (gap.needed_by === currentSlice?.slice_id && gap.status !== 'blocker') {
      out.push(issue('blueprint_current_unknown_not_blocking', `$.decisions_and_gaps.gaps[${index}].status`, '当前切片依赖的 unknown 必须是 blocker。'));
    }
    if (derived.asset_blocker_gap_indexes.includes(index)) {
      out.push(issue('blueprint_current_asset_blocker', `$.decisions_and_gaps.gaps[${index}]`, '当前切片的组件资产缺口尚未解除，不得进入 CU 施工。'));
    }
    if (gap.status === 'open_decision') {
      for (const field of ['owner', 'needed_by', 'unlock_condition']) {
        if (!nonEmptyString(gap[field])) out.push(issue('blueprint_future_gap_uncontrolled', `$.decisions_and_gaps.gaps[${index}].${field}`, `远期 open decision 缺 ${field}。`));
      }
    }
  });
  if (asStrings(admission.blocker_refs).length > 0 && admission.status === 'pass') {
    out.push(issue('blueprint_admission_false_pass', '$.review_summary.admission.status', '存在 blocker_refs 时不得 PASS。'));
  }
  if (admission.status !== derived.status) {
    out.push(issue('blueprint_admission_false_pass', '$.review_summary.admission.status', `准入状态必须由上游 checker 派生为 ${derived.status}，不得自报 ${String(admission.status)}。`));
  }
  return out;
}
