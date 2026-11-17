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
  blueprintAuthorContent,
  renderBlueprintFieldResponsibilities,
} from './component-blueprint-model';
import { extractJsonObjectFromText } from './json-object-from-text';
import { validateProvenanceRecord } from './blueprint-provenance';
import { APP_LENS_QUESTIONS, isApplicableView, isChangedView } from './blueprint-views';
import { stableStringify } from './phase-evidence-manifest';
import { resolveBlueprintReaderSource } from './blueprint-reader-guide';
import { stableAddressIndex } from './blueprint-addressing';
import { evaluateDerivedConclusionFreshness } from './derived-conclusion-freshness';

/** Compare declared evidence paths without opening them or treating a Windows drive as a URI scheme. */
export function questioningEvidencePath(ref: string, projectRoot?: string): string | undefined {
  let file = ref.replace(/\\/g, '/').split(/#|:(?=\d)/)[0];
  if (!file || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(file) && !/^[A-Za-z]:\//.test(file)) return undefined;
  if (projectRoot && !path.isAbsolute(file) && !path.win32.isAbsolute(file)) file = path.resolve(projectRoot, file).replace(/\\/g, '/');
  return path.posix.normalize(file).replace(/^([A-Z]):/, (_, drive: string) => drive.toLowerCase() + ':');
}

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

/** Normalize only an address whose owning view and flow both identify one current target. */
export function normalizeQuestioningItems(blueprint: BlueprintRecord, items: BlueprintRecord[]): BlueprintRecord[] {
  const scopes = requiredQuestioningScopes(blueprint);
  const normalized = items.map(item => {
    const match = /^view:([^/]+)\/flow:(.+)$/.exec(String(item.scope_ref));
    const owners = match && asRecords(blueprint.design_views).filter(view => view.view_id === match[1]
      && asRecords(view.runtime_data_flows).some(flow => flow.flow_id === match[2]));
    const occurrences = match && asRecords(blueprint.design_views).flatMap(view => asRecords(view.runtime_data_flows)).filter(flow => flow.flow_id === match[2]).length;
    return match && owners?.length === 1 && occurrences === 1 && scopes.get(`flow:${match[2]}`) === 'flow'
      && item.scope_kind === 'flow' ? { ...item, scope_ref: `flow:${match[2]}` } : item;
  });
  const emptyPlaceholder = (item: BlueprintRecord): boolean => {
    const provenance = asRecord(item.provenance);
    return item.disposition === 'not_applicable' && !nonEmptyString(item.answer) && !nonEmptyString(item.rationale)
      && !asStrings(item.evidence_refs).length && !item.authority && provenance?.evidence_strength === 'unknown'
      && nonEmptyString(item.question) && item.question === item.owner && item.question === provenance.source_ref
      && asStrings(item.verification_refs).length > 0 && asStrings(item.verification_refs).every(ref => ref === item.question);
  };
  return normalized.filter(item => !emptyPlaceholder(item) || !normalized.some(other => other !== item
    && other.scope_ref === item.scope_ref && !emptyPlaceholder(other)));
}

/** Scope facts and explicit references, rather than shared business nouns, establish the reuse boundary. */
export function selectQuestioningScopes(before: BlueprintRecord | undefined, current: BlueprintRecord,
  previous?: BlueprintRecord, changedDependencies: readonly string[] = [], projectRoot?: string): string[] {
  const required = requiredQuestioningScopes(current);
  if (!before || !previous) return [...required.keys()];
  try { stableAddressIndex(before); stableAddressIndex(current); }
  catch { return [...required.keys()]; }
  const authorities = [
    { section: 'decisions_and_gaps', key: 'decisions', id: 'decision_id' },
    { section: 'decisions_and_gaps', key: 'gaps', id: 'gap_id' },
    { key: 'contracts', id: 'contract_id' },
    { section: 'discovery', key: 'facts', id: 'fact_id' },
    { key: 'quality_attributes', id: 'qa_id' },
    { key: 'data_domains', id: 'data_domain_id' },
  ];
  const normalizeReference = (ref: string): string => ref.replace(/^data_domain:/, 'data-domain:');
  const address = (key: string, id: string): string => {
    id = normalizeReference(id);
    const kind = key.slice(0, -3).replace(/_/g, '-');
    return id.startsWith(kind + ':') ? id : `${kind}:${id}`;
  };
  const oldContent = blueprintAuthorContent(before), nextContent = blueprintAuthorContent(current);
  let duplicateAuthority = false;
  const authorityRefs = new Set<string>();
  const facts = (content: BlueprintRecord): Map<string, unknown> => {
    const out = new Map<string, unknown>();
    for (const view of asRecords(content.design_views)) {
      out.set(`view:${view.view_id}`, view);
      for (const flow of asRecords(view.runtime_data_flows)) out.set(`flow:${flow.flow_id}`, flow);
    }
    for (const relation of asRecords(content.relations)) out.set(`relation:${relation.relation_id}`, relation);
    for (const question of APP_LENS_QUESTIONS) out.set(`app_lens:${question}`, asRecord(content.app_lens)?.[question]);
    out.set('terminology:current_scope_items', asRecord(content.discovery)?.inputs);
    for (const { section, key, id } of authorities) {
      for (const row of asRecords(section ? asRecord(content[section])?.[key] : content[key])) {
        if (nonEmptyString(row[id])) {
          const ref = address(id, row[id]);
          authorityRefs.add(ref);
          if (out.has(ref)) duplicateAuthority = true;
          out.set(ref, row);
        }
      }
    }
    return out;
  };
  const old = facts(oldContent), next = facts(nextContent), affected = new Set<string>(), changedBusiness = new Set<string>();
  if (duplicateAuthority) return [...required.keys()];
  for (const ref of old.keys()) if (!next.has(ref)) changedBusiness.add(ref);
  const items = normalizeQuestioningItems(before, asRecords(previous.items));
  const invalid = validateBlueprintQuestioning({ ...before, review_summary: { ...asRecord(before.review_summary), questioning: previous } })
    .filter(error => error.id !== 'blueprint_admission_false_pass' && error.id !== 'blueprint_questioning_coverage_missing');
  const invalidIndexes = new Set(invalid.flatMap(error => {
    const index = /\.items\[(\d+)\]/.exec(error.path); return index ? [Number(index[1])] : [];
  }));
  for (const ref of required.keys()) {
    const candidates = items.filter(item => item.scope_ref === ref);
    if (!old.has(ref) || stableStringify(old.get(ref)) !== stableStringify(next.get(ref))
      || candidates.some(item => ['blocker', 'open_decision'].includes(String(item.disposition)))) {
      affected.add(ref); changedBusiness.add(ref);
    }
    if (candidates.length !== 1 || asRecords(previous.items).some((item, index) => invalidIndexes.has(index) && item.scope_ref === ref)) affected.add(ref);
  }
  const global = (doc: BlueprintRecord): BlueprintRecord => {
    const copy = blueprintAuthorContent(doc);
    for (const key of ['design_views', 'relations', 'app_lens', 'reader_guide', 'review_summary']) delete copy[key];
    const app = { ...asRecord(doc.app_lens) }; for (const question of APP_LENS_QUESTIONS) delete app[question];
    if (Object.keys(app).length) copy.app_lens = app;
    // Derived graph bytes do not add business authority; compare their source entries instead.
    delete copy.generated_graphs;
    for (const { section, key } of authorities) {
      if (section) { const record = asRecord(copy[section]); if (record) delete record[key]; }
      else delete copy[key];
    }
    const discovery = asRecord(copy.discovery); if (discovery) delete discovery.inputs;
    for (const section of ['discovery', 'decisions_and_gaps']) if (asRecord(copy[section]) && !Object.keys(copy[section] as BlueprintRecord).length) delete copy[section];
    return copy;
  };
  if (stableStringify(global(before)) !== stableStringify(global(current))) return [...required.keys()];
  const changedAuthorities = new Set<string>();
  for (const { section, key, id } of authorities) {
    const rows = (doc: BlueprintRecord): unknown => section ? asRecord(doc[section])?.[key] : doc[key];
    const oldRows = rows(oldContent), nextRows = rows(nextContent);
    if (stableStringify(oldRows) === stableStringify(nextRows)) continue;
    for (const values of [oldRows, nextRows]) {
      if (values === undefined) continue;
      if (!Array.isArray(values) || values.some(row => !asRecord(row) || !nonEmptyString(row[id]))) return [...required.keys()];
      const ids = values.map(row => address(id, String(row[id])));
      if (new Set(ids).size !== ids.length) return [...required.keys()];
    }
    const refs = [...asRecords(oldRows), ...asRecords(nextRows)].map(row => address(id, String(row[id])));
    for (const ref of refs) if (stableStringify(old.get(ref)) !== stableStringify(next.get(ref))) {
      changedAuthorities.add(ref); changedBusiness.add(ref);
    }
  }
  const summary = (doc: BlueprintRecord): BlueprintRecord => {
    const copy = { ...asRecord(blueprintAuthorContent(doc).review_summary) }; delete copy.reader_guide; return copy;
  };
  if (stableStringify(summary(before)) !== stableStringify(summary(current))) {
    for (const ref of required.keys()) if (ref.startsWith('view:')) { affected.add(ref); changedBusiness.add(ref); }
  }
  const oldGuide = asRecords(asRecord(asRecord(before.review_summary)?.reader_guide)?.sections);
  const newGuide = asRecords(asRecord(asRecord(current.review_summary)?.reader_guide)?.sections);
  for (let index = 0; index < Math.max(oldGuide.length, newGuide.length); index++) {
    if (stableStringify(oldGuide[index]) === stableStringify(newGuide[index])) continue;
    let located = false;
    for (const [doc, section] of [[before, oldGuide[index]], [current, newGuide[index]]] as const) {
      for (const pointer of asStrings(section?.source_refs)) {
        const view = /^\/design_views\/(\d+)(?:\/runtime_data_flows\/(\d+))?/.exec(pointer);
        const relation = /^\/relations\/(\d+)/.exec(pointer), lens = /^\/app_lens\/([^/]+)/.exec(pointer);
        if (view) {
          const target = asRecords(doc.design_views)[Number(view[1])];
          if (target && required.has(`view:${target.view_id}`)) { affected.add(`view:${target.view_id}`); located = true; }
          const flow = view[2] && asRecords(target?.runtime_data_flows)[Number(view[2])];
          if (flow && required.has(`flow:${flow.flow_id}`)) affected.add(`flow:${flow.flow_id}`);
        } else if (relation) {
          const target = asRecords(doc.relations)[Number(relation[1])];
          if (target && required.has(`relation:${target.relation_id}`)) { affected.add(`relation:${target.relation_id}`); located = true; }
        } else if (lens && required.has(`app_lens:${lens[1]}`)) { affected.add(`app_lens:${lens[1]}`); located = true; }
      }
    }
    if (!located) for (const ref of required.keys()) if (ref.startsWith('view:')) affected.add(ref);
  }
  // Hand-authored sequence content is displayed authority when current; its precise owners retain independent review.
  const visibleSequences = (doc: BlueprintRecord): Map<string, BlueprintRecord> => new Map(asRecords(doc.generated_graphs)
    .filter(graph => graph.format === 'mermaid' && /^\s*sequenceDiagram\b/.test(String(graph.content))
      && asRecords(doc.derived_results).some(result => result.result_id === graph.graph_id && evaluateDerivedConclusionFreshness(result, doc).current))
    .map(graph => [String(graph.graph_id), graph]));
  const oldSequences = visibleSequences(before), nextSequences = visibleSequences(current);
  for (const id of new Set([...oldSequences.keys(), ...nextSequences.keys()])) {
    if (stableStringify(asRecords(before.generated_graphs).find(graph => String(graph.graph_id) === id))
      === stableStringify(asRecords(current.generated_graphs).find(graph => String(graph.graph_id) === id))) continue;
    let located = false;
    for (const [doc, graph] of [[before, oldSequences.get(id)], [current, nextSequences.get(id)]] as const) {
      if (!graph) continue;
      const index = stableAddressIndex(doc);
      for (const ref of asStrings(graph.node_refs)) {
        if (!index.has(ref)) continue;
        const flow = /^view:[^/]+\/flow:(.+)$/.exec(ref), view = /^view:([^/]+)(?:\/|$)/.exec(ref);
        const scopes = [flow && `flow:${flow[1]}`, view && `view:${view[1]}`, ref];
        for (const scope of scopes) if (scope && required.has(scope)) { affected.add(scope); changedBusiness.add(scope); located = true; }
      }
    }
    if (!located) return [...required.keys()];
  }
  // A reader guide's source_digest refresh alone is a new projection identity, not a new business fact.
  for (const dependency of changedDependencies) {
    const file = questioningEvidencePath(dependency, projectRoot);
    const related = items.filter(item => [...asStrings(item.verification_refs), ...asStrings(item.evidence_refs),
      String(asRecord(item.provenance)?.source_ref ?? '')].some(ref => {
        const source = questioningEvidencePath(ref, projectRoot);
        return file && source && (source === file || file.startsWith(source + '/'));
      }));
    if (!related.length) return [...required.keys()];
    related.forEach(item => { affected.add(String(item.scope_ref)); changedBusiness.add(String(item.scope_ref)); });
  }
  const identifiers = (value: unknown): Set<string> => {
    const ids = new Set<string>();
    const visit = (input: unknown): void => {
      if (Array.isArray(input)) { input.forEach(visit); return; }
      const record = asRecord(input); if (!record) return;
      for (const [key, child] of Object.entries(record)) {
        if (key.endsWith('_id') && nonEmptyString(child)) ids.add(address(key, child));
        else visit(child);
      }
    }; visit(value); return ids;
  };
  const allIds = new Set([...old.values(), ...next.values()].flatMap(value => [...identifiers(value)]));
  const rawIds = new Map<string, Set<string>>();
  for (const id of allIds) {
    const raw = id.slice(id.indexOf(':') + 1);
    if (!rawIds.has(raw)) rawIds.set(raw, new Set());
    rawIds.get(raw)!.add(id);
  }
  const knownIds = new Set([...allIds, ...required.keys()]);
  let unresolved = false;
  const references = (value: unknown, doc: BlueprintRecord, resolvePointers = false): Set<string> => {
    const refs = new Set<string>();
    const visit = (input: unknown, field = '', depth = 0): void => {
      if (typeof input === 'string') {
        const local = new Set([...input.matchAll(/(?:^|[^\p{L}\p{N}._:-])([a-z][a-z0-9_-]*:[\p{L}\p{N}][\p{L}\p{N}._:-]*)/gu)]
          .map(match => normalizeReference(match[1])));
        if (field === 'ref' || /_refs?$/.test(field) || ['decisions_and_gaps', 'needed_by', 'landing'].includes(field)) {
          const pointer = input.startsWith('/') ? input : '/' + input;
          if (resolvePointers && resolveBlueprintReaderSource(doc, pointer)) {
            const lens = /^\/app_lens\/([^/]+)(?:\/|$)/.exec(pointer);
            const scope = lens ? `app_lens:${lens[1]}` : /^\/discovery\/inputs(?:\/|$)/.test(pointer) ? 'terminology:current_scope_items' : undefined;
            if (scope) {
              if (required.has(scope)) local.add(scope); else unresolved = true;
            } else {
              const parts = pointer.split('/');
              let located = false;
              for (let length = parts.length; length > 1; length--) {
                const owner = asRecord(resolveBlueprintReaderSource(doc, parts.slice(0, length).join('/'))?.value);
                const id = owner && Object.entries(owner).find(([key, value]) => key.endsWith('_id') && nonEmptyString(value));
                if (id && knownIds.has(address(id[0], String(id[1])))) {
                  local.add(address(id[0], String(id[1]))); located = true; break;
                }
              }
              if (!located) unresolved = true;
            }
          } else if (resolvePointers && /^\/(?:(?:design_views|relations|contracts|quality_attributes|data_domains)\/\d+(?:\/|$)|decisions_and_gaps\/(?:decisions|gaps)(?:\/|$)|discovery\/(?:facts|inputs)(?:\/|$)|app_lens\/)/.test(pointer)) {
            unresolved = true;
          } else if (/^(?:source|evidence|verification|knowledge)_refs?$/.test(field)
            && questioningEvidencePath(input) && /[\\/]|\.[A-Za-z0-9]+(?:#|:|$)/.test(input)) {
            local.add('source:' + questioningEvidencePath(input));
          }
          const matches = rawIds.get(input);
          const kind = field.replace(/_refs?$/, '').replace(/^(?:logical|external)_/, '').replace(/_/g, '-');
          const typed = matches && [...matches].filter(ref => ref.startsWith(kind + ':'));
          // A bare ambiguous ID reaches its actual candidate consumers; an unrelated ambiguity is not a global change.
          (typed?.length ? typed : matches)?.forEach(ref => local.add(ref));
          // These fields declare a design landing; slice ownership and asset/source references do not.
          if (resolvePointers && depth === 1 && ['landing', 'target_ref'].includes(field) && nonEmptyString(input)
            && (![...local].some(ref => knownIds.has(ref)) || [...local].some(ref => !knownIds.has(ref)))) unresolved = true;
        }
        local.forEach(ref => refs.add(ref));
      } else if (Array.isArray(input)) input.forEach(child => visit(child, field, depth));
      else if (asRecord(input)) for (const [key, child] of Object.entries(input as BlueprintRecord)) {
        if (!key.endsWith('_id')) visit(child, key, depth + 1);
      }
    }; visit(value); return refs;
  };
  const unresolvedRefs = new Set<string>();
  const dependencies = new Map<string, Set<string>>();
  const ids = new Map<string, Set<string>>();
  for (const ref of new Set([...old.keys(), ...next.keys()])) {
    const prior = items.filter(item => item.scope_ref === ref).map(item => ({ evidence_refs: item.evidence_refs,
      verification_refs: item.verification_refs, provenance: item.provenance }));
    unresolved = false;
    dependencies.set(ref, new Set([...references(old.get(ref), oldContent, authorityRefs.has(ref)), ...references(next.get(ref), nextContent, authorityRefs.has(ref)),
      ...[...references(prior, oldContent, true)].filter(source => authorityRefs.has(source) || source.startsWith('source:'))]));
    if (unresolved) unresolvedRefs.add(ref);
    ids.set(ref, new Set([ref, ...identifiers(old.get(ref)), ...identifiers(next.get(ref))]));
  }
  if ([...changedAuthorities].some(ref => unresolvedRefs.has(ref))) return [...required.keys()];
  // Authority rows can explicitly name their landing; retain both old and new scope references.
  for (const ref of authorityRefs) {
    for (const scope of required.keys()) if ([...ids.get(scope) ?? []].some(id => dependencies.get(ref)?.has(id))
      || changedAuthorities.has(ref) && [...dependencies.get(ref) ?? []].some(source => source.startsWith('source:') && dependencies.get(scope)?.has(source))) {
      dependencies.get(scope)!.add(ref);
    }
  }
  const consumers = new Map<string, Set<string>>();
  for (const [ref, declared] of ids) consumers.set(ref, new Set([...dependencies]
    .filter(([other, refs]) => other !== ref && [...refs].some(id => declared.has(id))).map(([other]) => other)));
  const expand = (seeds: Iterable<string>, graph = consumers): Set<string> => {
    const reached = new Set(seeds);
    for (const ref of reached) graph.get(ref)?.forEach(consumer => reached.add(consumer));
    return reached;
  };
  for (const ref of changedAuthorities) if (![...expand([ref])].some(scope => required.has(scope))) return [...required.keys()];
  // Ordinary scope edits keep their existing boundary; only changed authority seeds traverse global entries.
  const scopeConsumers = new Map([...consumers].filter(([ref]) => !authorityRefs.has(ref))
    .map(([ref, refs]) => [ref, new Set([...refs].filter(consumer => !authorityRefs.has(consumer)))]));
  for (const ref of [...expand(changedBusiness, scopeConsumers), ...expand(changedAuthorities)]) if (required.has(ref)) affected.add(ref);
  return [...required.keys()].filter(ref => affected.has(ref));
}

export function renderQuestioningResultInstructions(blueprint: BlueprintRecord, providerId: string, selected?: readonly string[]): string[] {
  const existing = asRecords(asRecord(asRecord(blueprint.review_summary)?.questioning)?.items);
  const scopes = [...requiredQuestioningScopes(blueprint)].filter(([ref]) => !selected || selected.includes(ref)).map(([ref, kind]) => {
    const id = existing.find(item => item.scope_ref === ref && nonEmptyString(item.question_id))?.question_id ?? questioningId(kind, ref);
    return `- ${ref}（${kind}；question_id=${String(id)}，机器已给出）`;
  });
  const unchanged = [...unchangedViewQuestioningScopes(blueprint)].filter(([ref]) => !selected || selected.includes(ref))
    .map(([ref, refs]) => `- ${ref}：须核实不变声明及其依据（answered_with_evidence，evidence_refs 至少含其一：${refs.join(', ') || '（未声明）'}）`);
  return [
    `质询方标识 provider_id：${providerId}`,
    `只返回现有 questioning JSON 的 items[]。每项业务必填：${BLUEPRINT_SCHEMA.$defs.questioningItem.required.join(' / ')}，另给 scope_kind / scope_ref / disposition / verification_refs / provenance；answered_with_evidence 另需 answer 与 evidence_refs。`,
    renderBlueprintFieldResponsibilities(),
    `disposition只能使用以下合法值：${DISPOSITIONS.join(' / ')}；不要用open等其它拼写。`,
    '',
    '## 必答范围（每个恰好一项）',
    ...scopes,
    '只交回本轮实际复核的上述条目；未变项由机器沿原件复用，不复制整份旧回答。有具体新证据可重开其它scope，同时在answer及verification_refs给出新证据。用紧凑JSON返回，不写临时结果或复述完整材料。',
    '对照原始需求的用户可观察结果，构造能骗过当前验收的反例；需求指定某个对象时，核实上下游接到的是同一本次对象，不能只证明页面看似成功。失败返回落点依据原文及既有路由解释；参考图按既有来源核验并保留到施工/视觉验收。',
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

export function mergeIndependentQuestioningResult(blueprint: BlueprintRecord, result: BlueprintRecord, providerId: string,
  previous?: BlueprintRecord, selected: readonly string[] = [...requiredQuestioningScopes(blueprint).keys()],
  original?: { path: string; sha256: string }): BlueprintRecord {
  const fresh = normalizeQuestioningItems(blueprint, asRecords(result.items)).map(item => {
    const copy = { ...item }; delete copy.review_original;
    return original ? { ...copy, review_original: original } : copy;
  });
  const current = new Set(fresh.map(item => String(item.scope_ref)));
  const retained = asRecords(previous?.items).filter(item => requiredQuestioningScopes(blueprint).get(String(item.scope_ref)) === item.scope_kind
    && !selected.includes(String(item.scope_ref)) && !current.has(String(item.scope_ref)));
  return independentQuestioningEnvelope({ ...result, items: [...retained, ...fresh] }, providerId,
    asRecord(blueprint.review_summary)?.authored_by, previous);
}

/** Called only after the caller confirms a real isolated invocation completed. */
export function applyIndependentQuestioningOutput(
  blueprintPath: string, outputPath: string, output: string, providerId: string, projectRoot?: string,
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
  let questioning = mergeIndependentQuestioningResult(blueprint, result, providerId, asRecord(review.questioning));
  // Managed invocations already bind the exact before-image, completion and write snapshots.
  const invocationDir = path.dirname(outputPath), phasesDir = path.dirname(path.dirname(invocationDir));
  if (projectRoot && path.basename(phasesDir) === 'phases') {
    const runDir = path.dirname(phasesDir);
    const { readDesignQuestioningOriginal, reusableDesignQuestioning } = require('./design-repair-unattended') as typeof import('./design-repair-unattended');
    const { sessionEvents } = require('./session-execution-handoff') as typeof import('./session-execution-handoff');
    const events = sessionEvents(runDir);
    const start = events.find(event => event.type === 'agent_invoke_start' && event.invoke_id === path.basename(invocationDir));
    const original = start && readDesignQuestioningOriginal(runDir, start, events);
    const verified = original && reusableDesignQuestioning({ ...original, projectRoot, blueprintPath, blueprint });
    if (verified) questioning = verified;
  }
  if (projectRoot && typeof blueprint.blueprint_id === 'string') {
    const { componentBlueprintPath } = require('./component-blueprint-path') as typeof import('./component-blueprint-path');
    const { enumerateCanonicalChangeUnits } = require('./change-unit-path') as typeof import('./change-unit-path');
    if (path.resolve(blueprintPath) === path.resolve(componentBlueprintPath(projectRoot, blueprint.blueprint_id))
      && enumerateCanonicalChangeUnits(projectRoot, blueprint.blueprint_id).some(unit =>
        asRecord(unit.changeUnit.component_blueprint_ref)?.revision === blueprint.revision)) return questioning;
    // Bound revisions retain their bytes; the current evaluation reads this invocation's original result.
  }
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
