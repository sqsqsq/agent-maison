import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import * as crypto from 'crypto';
import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
  DISPOSITIONS,
  BLUEPRINT_SCHEMA,
  renderBlueprintFieldResponsibilities,
} from './component-blueprint-model';
import { extractJsonObjectFromText } from './json-object-from-text';
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
  // 同一 scope 内审查 4+1 深度、共享继承/写集与本侧外部证据，不增平行 scope/缺字段门。
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
  // plan a3c7e9d1 t2：current_scope_items 引用的业务名词是否都有术语事实——只要求质询给 disposition，机器不做全覆盖判定。
  if (asRecords(asRecord(asRecord(blueprint.discovery)?.inputs)?.current_scope_items).length > 0) {
    scopes.set('terminology:current_scope_items', 'terminology');
  }
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

function questioningId(kind: unknown, ref: unknown): string {
  return `q:${crypto.createHash('sha256').update(String(kind ?? '') + '\n' + String(ref ?? '')).digest('hex').slice(0, 16)}`;
}

export function renderQuestioningResultInstructions(blueprint: BlueprintRecord, providerId: string): string[] {
  const existing = asRecords(asRecord(asRecord(blueprint.review_summary)?.questioning)?.items);
  const scopes = [...requiredQuestioningScopes(blueprint)].map(([ref, kind]) => {
    const id = existing.find(item => item.scope_ref === ref && nonEmptyString(item.question_id))?.question_id ?? questioningId(kind, ref);
    return `- ${ref}（${kind}；question_id=${String(id)}，机器已给出）`;
  });
  const unchanged = [...unchangedViewQuestioningScopes(blueprint)].map(([ref, refs]) => `- ${ref}：须核实不变声明及其依据（answered_with_evidence，evidence_refs 至少含其一：${refs.join(', ') || '（未声明）'}）`);
  return [
    `质询方标识 provider_id：${providerId}`,
    `只返回现有 questioning JSON 的 items[]。每项业务必填：${BLUEPRINT_SCHEMA.$defs.questioningItem.required.join(' / ')}，另给 scope_kind / scope_ref / disposition / verification_refs / provenance；answered_with_evidence 另需 answer 与 evidence_refs。`,
    renderBlueprintFieldResponsibilities(),
    `disposition只能使用以下合法值：${DISPOSITIONS.join(' / ')}；不要用open等其它拼写。`,
    '',
    '## 必答范围（每个恰好一项）',
    ...scopes,
    ...(unchanged.length ? ['', '## verified_unchanged 视图', ...unchanged] : []),
  ];
}

export function createIndependentQuestioningResult(input: {
  providerId: string;
  authoredBy: string;
  items: BlueprintRecord[];
  previous?: BlueprintRecord;
}): BlueprintRecord {
  return independentQuestioningEnvelope({ items: input.items }, input.providerId, input.authoredBy, input.previous);
}

/** Read only the existing structured result, never infer a verdict from prose. */
export function parseIndependentQuestioningOutput(output: string): BlueprintRecord {
  let parsed: BlueprintRecord | null = null;
  try { const value: unknown = JSON.parse(output); parsed = Array.isArray(value) ? { items: value } : asRecord(value) ?? null; }
  catch { /* Wrapped objects retain the existing tolerant extraction path. */ }
  parsed ??= extractJsonObjectFromText(output) ?? null;
  const result = asRecord(asRecord(parsed?.review_summary)?.questioning) ?? asRecord(parsed?.questioning) ?? parsed;
  if (!result || !Array.isArray(result.items) || result.items.some(item => !asRecord(item))) {
    throw new Error('独立质询必须返回现有 questioning JSON 对象及 items 数组；自然语言总结不能签发结果。');
  }
  return result;
}

export function independentQuestioningEnvelope(result: BlueprintRecord, providerId: string, authoredBy: unknown, previous?: BlueprintRecord): BlueprintRecord {
  if (!nonEmptyString(providerId) || providerId === authoredBy) throw new Error('质询 provider 必须独立于蓝图编写方。');
  const priorItems = asRecords(previous?.items);
  const items = asRecords(result.items).map(item => ({ ...item,
    question_id: priorItems.find(prior => prior.scope_kind === item.scope_kind && prior.scope_ref === item.scope_ref && nonEmptyString(prior.question_id))?.question_id
      ?? questioningId(item.scope_kind, item.scope_ref) }));
  return { ...result, items, status: 'complete', provider_id: providerId, isolated_context: true, writes_ssot: false };
}

/** Called only after the caller confirms a real isolated invocation completed. */
export function applyIndependentQuestioningOutput(
  blueprintPath: string, outputPath: string, output: string, providerId: string,
): BlueprintRecord {
  if (path.resolve(blueprintPath) === path.resolve(outputPath)) throw new Error('质询原件不能覆盖蓝图。');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (fs.existsSync(outputPath)) {
    if (fs.readFileSync(outputPath, 'utf8') !== output) throw new Error('本次质询原件已存在且与真实返回不同。');
  } else fs.writeFileSync(outputPath, output, { encoding: 'utf8', flag: 'wx' });
  const result = parseIndependentQuestioningOutput(output);
  const blueprint = asRecord(YAML.parse(fs.readFileSync(blueprintPath, 'utf8')));
  if (!blueprint) throw new Error('蓝图不可解析，无法回填真实质询结果。');
  const review = asRecord(blueprint.review_summary) ?? {};
  const questioning = { ...result, ...createIndependentQuestioningResult({ providerId, authoredBy: String(review.authored_by ?? ''),
    items: asRecords(result.items), previous: asRecord(review.questioning) }) };
  blueprint.review_summary = { ...review, questioning };
  const temporary = `${blueprintPath}.tmp-${process.pid}-questioning`;
  try {
    fs.writeFileSync(temporary, YAML.stringify(blueprint), { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, blueprintPath);
  } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary); }
  return questioning;
}

/** A complete report can still explicitly deny the design; schema success is not acceptance. */
export function independentQuestioningBlockers(blueprint: BlueprintRecord): BlueprintRecord[] {
  return asRecords(asRecord(asRecord(blueprint.review_summary)?.questioning)?.items).filter(item => item.disposition === 'blocker');
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
    for (const field of BLUEPRINT_SCHEMA.$defs.questioningItem.required as string[]) {
      if (!nonEmptyString(item[field])) out.push(issue('blueprint_questioning_item_incomplete', `${base}.${field}`, `质询项缺 ${field}。`));
    }
    const scopeKind = String(item.scope_kind ?? '');
    const scopeRef = String(item.scope_ref ?? '');
    if (!['view', 'relation', 'flow', 'app_lens', 'terminology'].includes(scopeKind) || requiredScopes.get(scopeRef) !== scopeKind) {
      out.push(issue('blueprint_questioning_scope_invalid', `${base}.scope_ref`, `质询 scope 无法映射到当前蓝图：kind=${scopeKind}, ref=${scopeRef}。`));
    } else if (covered.has(scopeRef)) {
      out.push(issue('blueprint_questioning_scope_duplicate', `${base}.scope_ref`, `质询 scope 重复：${scopeRef}。`));
    } else {
      covered.add(scopeRef);
    }
    const disposition = String(item.disposition);
    if (!(DISPOSITIONS as readonly string[]).includes(disposition)) {
      out.push(issue('blueprint_questioning_disposition_invalid', `${base}.disposition`, '质询 disposition 非法。'));
    }
    if (disposition === 'blocker') {
      out.push(issue('blueprint_admission_false_pass', `${base}.disposition`,
        `独立质询尚有实质否定（${scopeRef}）：${String(item.question ?? '')}；${String(item.answer ?? '')}`));
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
  if (questioning.writes_ssot === true) {
    out.push(issue('blueprint_questioning_parallel_ssot', '$.review_summary.questioning.writes_ssot', '质询报告是过程证据，不能成为新 SSOT。'));
  }
  return out;
}
