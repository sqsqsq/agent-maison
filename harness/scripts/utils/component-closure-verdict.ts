import {
  ClosureDegradation,
  ClosureProviderObservation,
  ComponentClosureCoverageRow,
  ComponentClosureGap,
  ComponentClosureIssue,
  ClosureVerdict,
  compareCodePoint,
  stableSortStrings,
} from './component-closure-model';
import { resolveCurrentDisposition, type CurrentDisposition } from './check-disposition';
import { asRecord, asRecords, asStrings, type BlueprintRecord } from './component-blueprint-model';

function gapClassification(issue: ComponentClosureIssue): ComponentClosureGap['classification'] {
  if (/conflict|duplicate/.test(issue.id)) return 'conflict';
  if (/stale/.test(issue.id)) return 'stale';
  if (/invalid|mismatch|tamper/.test(issue.id)) return 'invalid';
  if (/block/.test(issue.id)) return 'blocked';
  return 'incomplete';
}

function routeForRow(row: ComponentClosureCoverageRow): ComponentClosureGap['route'] {
  if (row.kind.startsWith('source_') || row.kind.startsWith('blueprint_') || row.kind === 'cross_view_relation') return 'reconcile_blueprint';
  if (row.owner_change_unit_ids.length === 0) return 'repair_or_add_change_unit';
  return 'repair_feature_or_evidence';
}

export function deriveComponentClosureVerdict(
  rows: ComponentClosureCoverageRow[],
  providers: ClosureProviderObservation[],
  issues: ComponentClosureIssue[],
  blueprint?: BlueprintRecord,
): { gaps: ComponentClosureGap[]; degradations: ClosureDegradation[]; verdict: ClosureVerdict; currentDisposition: CurrentDisposition } {
  const gaps: ComponentClosureGap[] = [];
  for (const row of rows.filter(item => item.required && item.observation !== 'covered')) {
    gaps.push({
      gap_id: `gap:${row.obligation_id.replace(/^obligation:/, '')}`,
      classification: row.observation === 'stale' ? 'stale' : row.observation === 'invalid' ? 'invalid' : row.observation === 'blocked' ? 'blocked' : 'incomplete',
      obligation_refs: [row.obligation_id],
      source_refs: stableSortStrings([...row.source_refs, ...row.blueprint_refs]),
      owner: row.owner_change_unit_ids.join('+') || 'unassigned',
      needed_by: 'component-closure',
      reason: `required obligation ${row.obligation_id} is ${row.observation}`,
      unlock_condition: routeForRow(row) === 'reconcile_blueprint' ? '修复并重新调和 P1 蓝图。' : routeForRow(row) === 'repair_or_add_change_unit' ? '补齐或修正 canonical Change Unit。' : '补齐 Feature 施工映射或对应证据。',
      route: routeForRow(row),
    });
  }
  for (const issue of issues.filter(item => item.severity === 'BLOCKER')) {
    const decisions = asRecords(asRecord(blueprint?.decisions_and_gaps)?.decisions).filter(decision =>
      issue.path === `decision:${String(decision.decision_id)}` || asStrings(decision.knowledge_refs).includes(issue.path));
    const owners = stableSortStrings(rows.filter(row => row.obligation_id === issue.path
      || row.blueprint_refs.includes(issue.path) || row.source_refs.includes(issue.path)).flatMap(row => row.owner_change_unit_ids));
    const authorityOwners = issue.id.startsWith('component_closure_knowledge_')
      ? stableSortStrings(decisions.flatMap(decision => typeof decision.owner === 'string' && decision.owner ? [decision.owner] : [])) : [];
    gaps.push({
      gap_id: `gap:issue:${issue.id}:${Math.abs(hashCode(`${issue.path}\0${issue.message}`))}`,
      classification: gapClassification(issue),
      obligation_refs: issue.path.startsWith('obligation:') ? [issue.path] : [],
      source_refs: [issue.path],
      owner: authorityOwners.join('+') || owners.join('+') || 'unassigned',
      needed_by: 'component-closure',
      reason: issue.message,
      unlock_condition: '按指定 repair route 修复权威上游后重新派生。',
      route: issue.route ?? 'resolve_authority_or_risk',
    });
  }
  const uniqueGaps = new Map(gaps.map(gap => [gap.gap_id, gap]));
  const sortedGaps = [...uniqueGaps.values()].sort((a, b) => compareCodePoint(a.gap_id, b.gap_id));
  const requiredLevels = new Set(rows.filter(row => row.required).map(row => row.evidence_level));
  const degradations: ClosureDegradation[] = [];
  for (const provider of providers) {
    const required = provider.provider_id === 'automated-construction-evidence'
      ? requiredLevels.has('unit_contract') || requiredLevels.has('integration_combination')
      : provider.provider_id === 'ui-device-visual-evidence'
        ? requiredLevels.has('ui_device')
        : requiredLevels.has('manual_risk');
    if (!required && provider.status === 'missing') {
      degradations.push({
        degradation_id: `degradation:${provider.provider_id}:missing`,
        impact: `${provider.provider_id} 当前不是 required obligation 的证据层；该维度暂不可观察。`,
        owner: 'component-owner',
        retrigger_condition: `当前目标新增需要 ${provider.provider_id} 的 obligation，或 provider 恢复可用。`,
      });
    }
  }
  degradations.sort((a, b) => compareCodePoint(a.degradation_id, b.degradation_id));
  const currentDisposition = resolveCurrentDisposition({ endpoint: 'request', phases: [], additionalProblems: [
    ...sortedGaps.map(gap => ({ phase: 'component-closure', id: gap.gap_id,
      action: gap.classification === 'blocked' ? 'wait' as const : gap.classification === 'incomplete' || gap.classification === 'stale' ? 'verify' as const : 'repair' as const,
      affects: 'completion' as const, severity: 'BLOCKER' as const, owner: gap.owner,
      detail: `${gap.reason}；解除条件：${gap.unlock_condition}`, evidence: [...gap.obligation_refs, ...gap.source_refs] })),
    ...degradations.map(item => ({ phase: 'component-closure', id: item.degradation_id, action: 'disclose' as const,
      affects: 'none' as const, severity: 'MINOR' as const, owner: item.owner, detail: `${item.impact}；${item.retrigger_condition}` })),
  ] });
  return {
    gaps: sortedGaps,
    degradations,
    verdict: !currentDisposition.completionEligible ? 'FAIL' : degradations.length > 0 ? 'PASS_WITH_DEGRADATION' : 'PASS',
    currentDisposition,
  };
}

function hashCode(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return hash;
}
