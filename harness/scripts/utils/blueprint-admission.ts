import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';

export function validateBlueprintAdmission(
  blueprint: BlueprintRecord,
  upstreamIssues: BlueprintIssue[] = [],
): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const admission = asRecord(asRecord(blueprint.review_summary)?.admission);
  if (!admission) return [issue('blueprint_admission_missing', '$.review_summary.admission', '缺少分层准入结果。')];
  const blockerIds = upstreamIssues.filter(item => item.severity === 'BLOCKER').map(item => item.id);
  const rootQuestionsComplete = !blockerIds.some(id => id.startsWith('app_lens_') || id.startsWith('blueprint_questioning_'));
  if (admission.root_questions_complete !== rootQuestionsComplete) {
    out.push(issue('blueprint_admission_self_asserted', '$.review_summary.admission.root_questions_complete', `root_questions_complete 必须由实际 App lens/质询覆盖派生为 ${rootQuestionsComplete}。`));
  }
  const currentSlice = asRecord(admission.current_slice);
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
  if (!currentSlice || !nonEmptyString(currentSlice.slice_id)) {
    out.push(issue('blueprint_admission_current_slice_not_ready', '$.review_summary.admission.current_slice', '当前切片必须冻结契约和 design refs，或显式声明受控 fake。'));
  } else {
    if (currentSlice.contracts_ready !== contractsReady) {
      out.push(issue('blueprint_admission_self_asserted', '$.review_summary.admission.current_slice.contracts_ready', `contracts_ready 必须由契约 checker 派生为 ${contractsReady}。`));
    }
    if (currentSlice.design_refs_ready !== designRefsReady) {
      out.push(issue('blueprint_admission_self_asserted', '$.review_summary.admission.current_slice.design_refs_ready', `design_refs_ready 必须由地址/跨视图/flow checker 派生为 ${designRefsReady}。`));
    }
  }
  asRecords(asRecord(blueprint.decisions_and_gaps)?.gaps).forEach((gap, index) => {
    if (gap.status === 'not_applicable' && gap.knowledge_state === 'unknown') {
      out.push(issue('blueprint_unknown_erased_by_na', `$.decisions_and_gaps.gaps[${index}]`, 'unknown 不得被 not_applicable 洗掉。'));
    }
    if (gap.needed_by === currentSlice?.slice_id && gap.status !== 'blocker') {
      out.push(issue('blueprint_current_unknown_not_blocking', `$.decisions_and_gaps.gaps[${index}].status`, '当前切片依赖的 unknown 必须是 blocker。'));
    }
    if (gap.needed_by === currentSlice?.slice_id && gap.status === 'blocker'
      && asStrings(gap.verification_refs).includes('provider:component-assets')) {
      const id = 'blueprint_current_asset_blocker';
      out.push(issue(id, `$.decisions_and_gaps.gaps[${index}]`, '当前切片的组件资产缺口尚未解除，不得进入 CU 施工。'));
      blockerIds.push(id);
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
  const derivedStatus = blockerIds.length === 0 ? 'pass' : 'blocker';
  if (admission.status !== derivedStatus) {
    out.push(issue('blueprint_admission_false_pass', '$.review_summary.admission.status', `准入状态必须由上游 checker 派生为 ${derivedStatus}，不得自报 ${String(admission.status)}。`));
  }
  return out;
}
