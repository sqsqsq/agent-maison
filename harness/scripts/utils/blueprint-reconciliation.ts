import {
  BlueprintIssue,
  BlueprintRecord,
  asRecords,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { evaluateDerivedConclusionFreshness } from './derived-conclusion-freshness';

export function reconcileP1DerivedResults(
  results: BlueprintRecord[],
  nextRevision: number,
  nextSourceFingerprint: string,
  nextDecisionFingerprint: string,
): BlueprintRecord[] {
  return results.map(result => {
    const affected = result.input_revision !== nextRevision
      || result.source_fingerprint !== nextSourceFingerprint
      || result.decision_fingerprint !== nextDecisionFingerprint;
    return affected
      ? { ...result, status: 'stale', superseded_by_revision: nextRevision }
      : { ...result };
  });
}

export function validateBlueprintReconciliation(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  asRecords(blueprint.derived_results).forEach((result, index) => {
    const freshness = evaluateDerivedConclusionFreshness(result, blueprint);
    const base = `$.derived_results[${index}]`;
    if (!nonEmptyString(result.result_id) || !['current', 'stale'].includes(String(result.status))) {
      out.push(issue('blueprint_derived_result_invalid', base, 'P1 派生结果必须有 result_id 与 current/stale 状态。'));
    }
    if (!freshness.current && result.status !== 'stale') {
      out.push(issue('blueprint_stale_conclusion_residual', base, `旧 P1 结论仍被标为当前：${freshness.reasons.join(', ')}。`));
    }
    if (result.status === 'stale' && !Number.isInteger(result.superseded_by_revision)) {
      out.push(issue('blueprint_stale_provenance_missing', `${base}.superseded_by_revision`, '历史 stale 结论必须指向 superseding revision。'));
    }
    if (['p2_ready_set', 'p3_closure'].includes(String(result.kind))) {
      out.push(issue('blueprint_downstream_state_owned_by_p1', `${base}.kind`, 'P1 只维护自身派生结果，不得创建或修改 P2 ready/P3 closure。'));
    }
  });
  for (const field of ['p2_ready_set', 'p3_closure', 'change_unit_execution']) {
    if (blueprint[field] !== undefined) {
      out.push(issue('blueprint_downstream_state_owned_by_p1', `$.${field}`, `canonical blueprint 不得承载下游状态 ${field}。`));
    }
  }
  return out;
}
