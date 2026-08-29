import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { validateProvenanceRecord } from './blueprint-provenance';
import { APP_LENS_QUESTIONS, isApplicableView, isChangedView } from './blueprint-views';

/**
 * M7：evolution_impact 显式接线。**每个 applicable 视图**（含 verified_unchanged）都进入
 * 质询 scope——按字面 `applicability !== 'applicable'` 跳过是旧行为，正交化后不得让
 * verified_unchanged 视图无人质询。两类视图的**质询义务不同**：
 *
 * - `changed`：全量根问题（视图本身 + 其 runtime flow）；
 * - `verified_unchanged`：义务 = 核实不变声明与其事实依据；其 runtime flow 触发条件本次
 *   不评估，故不进入 flow scope。
 */
export function requiredQuestioningScopes(blueprint: BlueprintRecord): Map<string, string> {
  const scopes = new Map<string, string>();
  for (const view of asRecords(blueprint.design_views)) {
    if (!isApplicableView(view)) continue;
    if (nonEmptyString(view.view_id)) scopes.set(`view:${view.view_id}`, 'view');
    if (!isChangedView(view)) continue;
    for (const flow of asRecords(view.runtime_data_flows)) {
      if (nonEmptyString(flow.flow_id)) scopes.set(`flow:${flow.flow_id}`, 'flow');
    }
  }
  for (const relation of asRecords(blueprint.relations)) {
    if (nonEmptyString(relation.relation_id)) scopes.set(`relation:${relation.relation_id}`, 'relation');
  }
  for (const question of APP_LENS_QUESTIONS) scopes.set(`app_lens:${question}`, 'app_lens');
  return scopes;
}

/**
 * verified_unchanged 视图的质询 scope → 该视图声明的不变依据（`unchanged_evidence.evidence_refs`）。
 * 质询项必须**核实这份依据**，因此其 evidence_refs 至少要与之有交集——否则"核实"可以拿任意
 * 无关证据搪塞，等同于自证。
 */
export function unchangedViewQuestioningScopes(blueprint: BlueprintRecord): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const view of asRecords(blueprint.design_views)) {
    if (isApplicableView(view) && !isChangedView(view) && nonEmptyString(view.view_id)) {
      out.set(`view:${view.view_id}`, asStrings(asRecord(view.unchanged_evidence)?.evidence_refs));
    }
  }
  return out;
}

export function createIndependentQuestioningResult(input: {
  providerId: string;
  authoredBy: string;
  items: BlueprintRecord[];
  frontierBudget: number;
  repeatedFrontierCount?: number;
}): BlueprintRecord {
  if (input.providerId === input.authoredBy) throw new Error('质询 provider 必须独立于蓝图编写方。');
  return {
    status: 'complete',
    provider_id: input.providerId,
    isolated_context: true,
    frontier_budget: input.frontierBudget,
    repeated_frontier_count: input.repeatedFrontierCount ?? 0,
    writes_ssot: false,
    items: input.items,
  };
}

export function validateBlueprintQuestioning(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  const review = asRecord(blueprint.review_summary);
  const questioning = asRecord(review?.questioning);
  if (!questioning || questioning.status !== 'complete') {
    return [issue('blueprint_questioning_provider_missing', '$.review_summary.questioning', '送评审前必须有已完成的独立质询结果。')];
  }
  if (questioning.isolated_context !== true || !nonEmptyString(questioning.provider_id)) {
    out.push(issue('blueprint_questioning_not_independent', '$.review_summary.questioning', '质询 provider 必须标识独立且使用隔离上下文。'));
  }
  if (questioning.provider_id === review?.authored_by) {
    out.push(issue('blueprint_questioning_self_attested', '$.review_summary.questioning.provider_id', '蓝图编写方不得自证质询 PASS。'));
  }
  const items = asRecords(questioning.items);
  if (items.length === 0) {
    out.push(issue('blueprint_questioning_items_missing', '$.review_summary.questioning.items', '质询必须逐项记录问题与处置。'));
  }
  const requiredScopes = requiredQuestioningScopes(blueprint);
  const unchangedScopes = unchangedViewQuestioningScopes(blueprint);
  const covered = new Set<string>();
  items.forEach((item, index) => {
    const base = `$.review_summary.questioning.items[${index}]`;
    for (const field of ['question_id', 'question', 'frontier_fingerprint', 'owner']) {
      if (!nonEmptyString(item[field])) out.push(issue('blueprint_questioning_item_incomplete', `${base}.${field}`, `质询项缺 ${field}。`));
    }
    const scopeKind = String(item.scope_kind ?? '');
    const scopeRef = String(item.scope_ref ?? '');
    if (!['view', 'relation', 'flow', 'app_lens'].includes(scopeKind) || requiredScopes.get(scopeRef) !== scopeKind) {
      out.push(issue('blueprint_questioning_scope_invalid', `${base}.scope_ref`, `质询 scope 无法映射到当前蓝图：kind=${scopeKind}, ref=${scopeRef}。`));
    } else if (covered.has(scopeRef)) {
      out.push(issue('blueprint_questioning_scope_duplicate', `${base}.scope_ref`, `质询 scope 重复：${scopeRef}。`));
    } else {
      covered.add(scopeRef);
    }
    const disposition = String(item.disposition);
    if (!['answered_with_evidence', 'decided_with_authority', 'open_decision', 'blocker', 'not_applicable'].includes(disposition)) {
      out.push(issue('blueprint_questioning_disposition_invalid', `${base}.disposition`, '质询 disposition 非法。'));
    }
    if (disposition === 'answered_with_evidence' && (asStrings(item.evidence_refs).length === 0 || !nonEmptyString(item.answer))) {
      out.push(issue('blueprint_questioning_evidence_missing', base, 'answered_with_evidence 必须有证据回答与 evidence_refs。'));
    }
    // M7：verified_unchanged 视图的质询义务是"核实不变声明与其依据"，只能以证据作答；
    // 用 not_applicable/open_decision 打发等于把不变声明变成无人核实的自证。
    if (unchangedScopes.has(scopeRef)) {
      if (disposition !== 'answered_with_evidence') {
        out.push(issue(
          'blueprint_questioning_unchanged_not_verified',
          `${base}.disposition`,
          `verified_unchanged 视图 ${scopeRef} 的质询义务是核实不变声明与依据，必须 answered_with_evidence（实际 ${disposition}）。`,
        ));
      } else {
        // 且必须核实的是**这份**不变依据，不能拿任意无关证据充数。
        const declared = unchangedScopes.get(scopeRef)!;
        const answered = asStrings(item.evidence_refs);
        if (declared.length > 0 && !answered.some(ref => declared.includes(ref))) {
          out.push(issue(
            'blueprint_questioning_unchanged_evidence_unrelated',
            `${base}.evidence_refs`,
            `verified_unchanged 视图 ${scopeRef} 的质询证据与其声明的不变依据无交集（声明=${declared.join(', ')}；质询=${answered.join(', ') || '(空)'}）；核实必须针对该视图交出的依据。`,
          ));
        }
      }
    }
    if (asStrings(item.verification_refs).length === 0) {
      out.push(issue('blueprint_questioning_verification_missing', `${base}.verification_refs`, '质询项必须有 verification_refs。'));
    }
    out.push(...validateProvenanceRecord(item.provenance, `${base}.provenance`));
  });
  for (const [scopeRef, scopeKind] of requiredScopes) {
    if (!covered.has(scopeRef)) {
      out.push(issue('blueprint_questioning_coverage_missing', '$.review_summary.questioning.items', `缺少 ${scopeKind} 质询覆盖：${scopeRef}。`));
    }
  }
  if (Number(questioning.repeated_frontier_count ?? 0) > Number(questioning.frontier_budget ?? 0)) {
    out.push(issue('blueprint_questioning_frontier_budget_exceeded', '$.review_summary.questioning.repeated_frontier_count', '重复 frontier 超预算，必须 blocker 或可解释退出。'));
  }
  if (questioning.writes_ssot === true) {
    out.push(issue('blueprint_questioning_parallel_ssot', '$.review_summary.questioning.writes_ssot', '质询报告是过程证据，不能成为新 SSOT。'));
  }
  return out;
}
