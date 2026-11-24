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
import { componentBlueprintPath } from './component-blueprint-path';
import { blueprintMethodRef } from './blueprint-method-projection';

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

const QUESTIONING_SCOPE_HEADING = '## 必答范围（每个恰好一项）';
type SignedQuestioningScopes = ReadonlyMap<string, { kind: string; questionId: string }>;

/** Read the scope lines already frozen in the independent request material. */
export function readSignedQuestioningScopes(segments?: readonly unknown[]): SignedQuestioningScopes | undefined {
  const at = segments?.indexOf(QUESTIONING_SCOPE_HEADING) ?? -1;
  if (!segments || at < 0 || at !== segments.lastIndexOf(QUESTIONING_SCOPE_HEADING)) return undefined;
  const scopes = new Map<string, { kind: string; questionId: string }>();
  const questionIds = new Set<string>();
  for (const line of segments.slice(at + 1)) {
    const match = typeof line === 'string' && /^- (\S+)（(view|flow|relation|app_lens|terminology)；question_id=([^，]+)，机器已给出）$/.exec(line);
    if (!match) break;
    if (scopes.has(match[1]) || questionIds.has(match[3])) return undefined;
    scopes.set(match[1], { kind: match[2], questionId: match[3] });
    questionIds.add(match[3]);
  }
  return scopes.size ? scopes : undefined;
}

/** Normalize only an address with one current target and no competing answer. */
export function normalizeQuestioningItems(blueprint: BlueprintRecord, items: BlueprintRecord[], signed?: SignedQuestioningScopes): BlueprintRecord[] {
  const scopes = requiredQuestioningScopes(blueprint);
  if (signed) {
    try { stableAddressIndex(blueprint); } catch { signed = undefined; }
  }
  const flows = asRecords(blueprint.design_views).flatMap(view => asRecords(view.runtime_data_flows));
  const normalized = items.map(item => {
    const match = /^view:([^/]+)\/flow:(.+)$/.exec(String(item.scope_ref));
    const owners = match && asRecords(blueprint.design_views).filter(view => view.view_id === match[1]
      && asRecords(view.runtime_data_flows).some(flow => flow.flow_id === match[2]));
    const occurrences = match && flows.filter(flow => flow.flow_id === match[2]).length;
    return match && owners?.length === 1 && occurrences === 1 && scopes.get(`flow:${match[2]}`) === 'flow'
      && item.scope_kind === 'flow' ? { ...item, scope_ref: `flow:${match[2]}` } : item;
  });
  const aliases = normalized.map(item => {
    if (!signed || typeof item.scope_ref !== 'string' || !item.scope_ref || item.scope_ref.includes(':')) return undefined;
    if (item.scope_kind === 'flow' && flows.filter(flow => flow.flow_id === item.scope_ref).length !== 1) return undefined;
    const ref = `${String(item.scope_kind)}:${item.scope_ref}`;
    const scope = signed.get(ref);
    return scope && scope.kind === item.scope_kind && scopes.get(ref) === item.scope_kind ? ref : undefined;
  });
  const attached = normalized.map((item, index) => {
    const ref = aliases[index];
    if (!ref || aliases.filter(alias => alias === ref).length !== 1 || normalized.some(other => other.scope_ref === ref)) return item;
    if (item.question_id !== undefined && item.question_id !== signed?.get(ref)?.questionId) return item;
    return { ...item, scope_ref: ref };
  });
  const emptyPlaceholder = (item: BlueprintRecord): boolean => {
    const provenance = asRecord(item.provenance);
    return item.disposition === 'not_applicable' && !nonEmptyString(item.answer) && !nonEmptyString(item.rationale)
      && !asStrings(item.evidence_refs).length && !item.authority && provenance?.evidence_strength === 'unknown'
      && nonEmptyString(item.question) && item.question === item.owner && item.question === provenance.source_ref
      && asStrings(item.verification_refs).length > 0 && asStrings(item.verification_refs).every(ref => ref === item.question);
  };
  return attached.filter(item => !emptyPlaceholder(item) || !attached.some(other => other !== item
    && other.scope_ref === item.scope_ref && !emptyPlaceholder(other)));
}

const QUESTIONING_PROSE_FIELDS = new Set(['description', 'summary', 'rationale']);
function questioningFact(value: unknown, field = ''): unknown {
  if (typeof value === 'string' && QUESTIONING_PROSE_FIELDS.has(field)) {
    return value.trim().replace(/(?<=[\p{L}\p{M}])。$|(?<!\S)([A-Za-z]+)\.$/u, '$1');
  }
  if (Array.isArray(value)) return value.map(item => questioningFact(item, field));
  const record = asRecord(value);
  return record ? Object.fromEntries(Object.entries(record).map(([key, item]) => [key, questioningFact(item, key)])) : value;
}

const sameQuestioningFact = (before: unknown, after: unknown, field?: string): boolean =>
  stableStringify(questioningFact(before, field)) === stableStringify(questioningFact(after, field));

/** Both paths lead to the original bytes. The prompt carries only enough of each change to locate it. */
export function describeQuestioningChanges(before: BlueprintRecord, current: BlueprintRecord, beforeFile: string, currentFile: string): string {
  const old = blueprintAuthorContent(before), next = blueprintAuthorContent(current);
  const addresses = new Map<BlueprintRecord, string>();
  for (const doc of [old, next]) {
    try { for (const [address, row] of stableAddressIndex(doc)) if (row !== doc) addresses.set(row, address); }
    catch { /* Absolute JSON pointers still locate ambiguous records. */ }
  }
  const locations: Array<{ at: string; owner?: string; before: string; after: string }> = [];
  let truncated = false;
  const excerpt = (value: unknown): string => {
    if (value === undefined) return '（无）';
    if (Array.isArray(value)) return `[${value.length} 项]`;
    if (asRecord(value)) return '{…}';
    const text = String(value);
    return text.length > 96 ? text.slice(0, 96) + '…' : text;
  };
  const walk = (left: unknown, right: unknown, pointer: string, owner: string, field = ''): void => {
    if (sameQuestioningFact(left, right, field)) return;
    if (locations.length >= 24) { truncated = true; return; }
    const l = asRecord(left), r = asRecord(right);
    const address = r && addresses.get(r) || l && addresses.get(l) || owner;
    if (l && r) {
      for (const key of new Set([...Object.keys(l), ...Object.keys(r)])) {
        walk(l[key], r[key], `${pointer}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`, address, key);
      }
    } else if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.max(left.length, right.length); index++) {
        walk(left[index], right[index], `${pointer}/${index}`, address, field);
      }
    } else {
      locations.push({ at: pointer || '/', ...(address ? { owner: address } : {}), before: excerpt(left), after: excerpt(right) });
    }
  };
  walk(old, next, '', '');
  return JSON.stringify({ state: locations.length ? 'drift' : 'aligned', locations, before: beforeFile, current: currentFile,
    ...(truncated ? { more: '其余变更核对原件' } : {}) });
}

/** Scope facts and explicit references, rather than shared business nouns, establish the reuse boundary. */
export function selectQuestioningScopes(before: BlueprintRecord | undefined, current: BlueprintRecord,
  previous?: BlueprintRecord, changedDependencies: readonly string[] = [], projectRoot?: string, revisitFindings = true): string[] {
  const required = requiredQuestioningScopes(current);
  if (!before || !previous) return [...required.keys()];
  let beforeAddresses: Map<BlueprintRecord, string>, currentAddresses: Map<BlueprintRecord, string>;
  const addresses = (doc: BlueprintRecord) => new Map([...stableAddressIndex(doc)].map(([key, value]) => [value, key]));
  try { beforeAddresses = addresses(before); currentAddresses = addresses(current); }
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
  // A member can reopen its own view's conclusion without changing the view shared by its siblings.
  const memberAddress = /^(view:[^/]+)\/(node|flow):(.+)$/;
  const splitView = (source: Map<string, unknown>) => {
    const rows = new Map(source);
    for (const [ref, row] of source) if (ref.startsWith('view:')) {
      const { nodes, runtime_data_flows, ...view } = asRecord(row) ?? {};
      if (nodes !== undefined && (!Array.isArray(nodes) || nodes.some(node => !nonEmptyString(node?.node_id)))) view.nodes = nodes;
      if (runtime_data_flows !== undefined && (!Array.isArray(runtime_data_flows) || runtime_data_flows.some(flow => !nonEmptyString(flow?.flow_id)))) {
        view.runtime_data_flows = runtime_data_flows;
      }
      rows.set(ref, view);
      for (const node of asRecords(nodes)) if (nonEmptyString(node.node_id)) rows.set(`${ref}/node:${node.node_id}`, node);
      for (const flow of asRecords(runtime_data_flows)) if (nonEmptyString(flow.flow_id)) {
        rows.delete(`flow:${flow.flow_id}`);
        rows.set(`${ref}/flow:${flow.flow_id}`, flow);
      }
    }
    return rows;
  };
  const preciseBefore = splitView(old), preciseAfter = splitView(next);
  const linkedFacts = (address: string, value: unknown): Map<string, BlueprintRecord> => {
    const row = asRecord(value);
    const facts = new Map<string, BlueprintRecord>();
    const acceptance = asRecord(row?.acceptance);
    for (const item of ['criteria', 'boundaries', 'performance'].flatMap(key => asRecords(acceptance?.[key]))) {
      if (nonEmptyString(item.id)) facts.set(`acceptance:${item.id}`, item);
    }
    for (const contract of asRecords(asRecord(row?.contracts)?.interfaces)) {
      if (!nonEmptyString(contract.class)) continue;
      for (const method of asRecords(contract.methods)) {
        if (!nonEmptyString(method.name)) continue;
        facts.set(`method:${contract.class}.${method.name}`, method);
        facts.set(blueprintMethodRef(address, contract.class, method.name), method);
      }
    }
    return facts;
  };
  const knownLinkedFacts = new Set<string>(), changedLinkedFacts = new Set<string>();
  for (const ref of new Set([...preciseBefore.keys(), ...preciseAfter.keys()])) {
    if (!authorityRefs.has(ref) && !sameQuestioningFact(preciseBefore.get(ref), preciseAfter.get(ref))) changedBusiness.add(ref);
    const oldFacts = linkedFacts(ref, preciseBefore.get(ref)), newFacts = linkedFacts(ref, preciseAfter.get(ref));
    for (const id of new Set([...oldFacts.keys(), ...newFacts.keys()])) {
      knownLinkedFacts.add(id);
      if (!sameQuestioningFact(oldFacts.get(id), newFacts.get(id))) changedLinkedFacts.add(id);
    }
  }
  const items = normalizeQuestioningItems(before, asRecords(previous.items));
  const invalid = validateBlueprintQuestioning({ ...before, review_summary: { ...asRecord(before.review_summary), questioning: previous } })
    .filter(error => error.id !== 'blueprint_admission_false_pass' && error.id !== 'blueprint_questioning_coverage_missing');
  const invalidIndexes = new Set(invalid.flatMap(error => {
    const index = /\.items\[(\d+)\]/.exec(error.path); return index ? [Number(index[1])] : [];
  }));
  for (const ref of required.keys()) {
    const candidates = items.filter(item => item.scope_ref === ref);
    // Prior findings must be reconsidered, but only changed design facts propagate to their consumers.
    if (revisitFindings && (candidates.length !== 1 || candidates.some(item => item.disposition === 'blocker' || item.disposition === 'open_decision')
      || asRecords(previous.items).some((item, index) => invalidIndexes.has(index) && item.scope_ref === ref))) affected.add(ref);
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
  if (!sameQuestioningFact(global(before), global(current))) return [...required.keys()];
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
    for (const ref of refs) if (!sameQuestioningFact(old.get(ref), next.get(ref))) {
      changedAuthorities.add(ref); changedBusiness.add(ref);
    }
  }
  const summary = (doc: BlueprintRecord): BlueprintRecord => {
    const copy = { ...asRecord(blueprintAuthorContent(doc).review_summary) }; delete copy.reader_guide; return copy;
  };
  if (!sameQuestioningFact(summary(before), summary(current))) {
    for (const ref of required.keys()) if (ref.startsWith('view:')) { affected.add(ref); changedBusiness.add(ref); }
  }
  const oldGuide = asRecords(asRecord(asRecord(before.review_summary)?.reader_guide)?.sections);
  const newGuide = asRecords(asRecord(asRecord(current.review_summary)?.reader_guide)?.sections);
  for (let index = 0; index < Math.max(oldGuide.length, newGuide.length); index++) {
    if (sameQuestioningFact(oldGuide[index], newGuide[index])) continue;
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
  const originalRefs = (item: BlueprintRecord): string[] => [...asStrings(item.verification_refs), ...asStrings(item.evidence_refs),
    String(asRecord(item.provenance)?.source_ref ?? '')];
  const pointerOwner = (doc: BlueprintRecord, ref: string, index: ReadonlyMap<BlueprintRecord, string>): string | undefined => {
    for (let at = ref; at; at = at.slice(0, at.lastIndexOf('/'))) {
      const owner = asRecord(resolveBlueprintReaderSource(doc, at)?.value);
      if (owner && index.has(owner)) return index.get(owner);
    }
  };
  const answerConsumers = new Map<string, Set<string>>();
  const blueprintFile = projectRoot && nonEmptyString(before.blueprint_id)
    ? questioningEvidencePath(componentBlueprintPath(projectRoot, before.blueprint_id), projectRoot) : undefined;
  const noteAnswerConsumer = (ref: string, scope: string): void => {
    const consumers = answerConsumers.get(ref) ?? new Set<string>();
    consumers.add(scope);
    answerConsumers.set(ref, consumers);
  };
  for (const item of items) for (const ref of originalRefs(item)) {
    const scope = String(item.scope_ref);
    if (authorityRefs.has(ref)) noteAnswerConsumer(ref, scope);
    if ([ref, `acceptance:${ref}`, `method:${ref}`].some(id => changedLinkedFacts.has(id))) affected.add(scope);
    const fragment = ref.indexOf('#/');
    const pointer = fragment !== -1 && blueprintFile && questioningEvidencePath(ref, projectRoot) === blueprintFile
      ? ref.slice(fragment + 1) : ref;
    if (!pointer.startsWith('/') || pointer.includes('#') || /:|^\/\//.test(pointer) || pointer.startsWith('/generated_graphs/')) continue;
    const oldSource = resolveBlueprintReaderSource(before, pointer);
    const newSource = resolveBlueprintReaderSource(current, pointer);
    if (!!oldSource !== !!newSource) {
      if (fragment === -1) return [...required.keys()];
      affected.add(scope);
    }
    if (!oldSource || !newSource) continue;
    const owner = pointerOwner(before, pointer, beforeAddresses);
    if (owner !== pointerOwner(current, pointer, currentAddresses)) {
      if (fragment === -1) return [...required.keys()];
      affected.add(scope);
      continue;
    }
    const oldAddress = asRecord(oldSource.value) && beforeAddresses.get(oldSource.value as BlueprintRecord);
    const newAddress = asRecord(newSource.value) && currentAddresses.get(newSource.value as BlueprintRecord);
    if (!sameQuestioningFact(oldAddress && preciseBefore.has(oldAddress) ? preciseBefore.get(oldAddress) : oldSource.value,
      newAddress && preciseAfter.has(newAddress) ? preciseAfter.get(newAddress) : newSource.value, pointer.split('/').at(-1))) {
      affected.add(scope);
      if (owner && authorityRefs.has(owner)) noteAnswerConsumer(owner, scope);
    }
  }
  for (const dependency of changedDependencies) {
    const file = questioningEvidencePath(dependency, projectRoot);
    const related = items.filter(item => originalRefs(item).some(ref => {
        if (resolveBlueprintReaderSource(before, ref) && resolveBlueprintReaderSource(current, ref)) return false;
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
  const allIds = new Set([...knownLinkedFacts, ...[...old.values(), ...next.values()].flatMap(value => [...identifiers(value)])]);
  const rawIds = new Map<string, Set<string>>();
  for (const id of allIds) {
    const raw = id.slice(id.indexOf(':') + 1);
    if (!rawIds.has(raw)) rawIds.set(raw, new Set());
    rawIds.get(raw)!.add(id);
  }
  const knownIds = new Set([...allIds, ...required.keys()]);
  const stableReferences = new Set([...beforeAddresses.values(), ...currentAddresses.values()]);
  let unresolved = false;
  const references = (value: unknown, doc: BlueprintRecord, resolvePointers = false, precise = false): Set<string> => {
    const refs = new Set<string>();
    const visit = (input: unknown, field = '', depth = 0): void => {
      if (typeof input === 'string') {
        const local = knownLinkedFacts.has(input) ? new Set([input]) : new Set([...input.matchAll(/(?:^|[^\p{L}\p{N}._:-])([a-z][a-z0-9_-]*:[\p{L}\p{N}][\p{L}\p{N}._:-]*(?:\/[a-z][a-z0-9_-]*:[\p{L}\p{N}][\p{L}\p{N}._:-]*)*)/gu)]
          .flatMap(match => precise ? [match[1]] : match[1].split('/')).map(normalizeReference));
        if (field === 'calls' && knownLinkedFacts.has(`method:${input}`)) local.add(`method:${input}`);
        if (field === 'ref' || /_refs?$/.test(field) || ['decisions_and_gaps', 'needed_by', 'landing'].includes(field)) {
          const pointer = input.startsWith('/') ? input : '/' + input;
          if (resolvePointers && resolveBlueprintReaderSource(doc, pointer)) {
            const lens = /^\/app_lens\/([^/]+)(?:\/|$)/.exec(pointer);
            const scope = lens ? `app_lens:${lens[1]}` : /^\/discovery\/inputs(?:\/|$)/.test(pointer) ? 'terminology:current_scope_items' : undefined;
            if (scope) {
              if (required.has(scope)) local.add(scope); else unresolved = true;
            } else {
              const preciseOwner = precise && pointerOwner(doc, pointer, doc === before ? beforeAddresses : currentAddresses);
              if (preciseOwner) local.add(preciseOwner);
              const parts = pointer.split('/');
              let located = !!preciseOwner;
              for (let length = parts.length; !located && length > 1; length--) {
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
            local.add('source:' + questioningEvidencePath(input, projectRoot));
          }
          const matches = rawIds.get(input);
          const kind = field.replace(/_refs?$/, '').replace(/^(?:logical|external)_/, '').replace(/_/g, '-');
          const typed = matches && [...matches].filter(ref => ref.startsWith(kind + ':'));
          // A bare ambiguous ID reaches its actual candidate consumers; an unrelated ambiguity is not a global change.
          (typed?.length ? typed : matches)?.forEach(ref => local.add(ref));
          // These fields declare a design landing; slice ownership and asset/source references do not.
          if (resolvePointers && depth === 1 && ['landing', 'target_ref'].includes(field) && nonEmptyString(input)
            && (!local.size || [...local].some(ref => !knownIds.has(ref) && !(precise && stableReferences.has(ref))))) unresolved = true;
        }
        local.forEach(ref => refs.add(ref));
      } else if (Array.isArray(input)) input.forEach(child => visit(child, field, depth));
      else if (asRecord(input)) for (const [key, child] of Object.entries(input as BlueprintRecord)) {
        if (!key.endsWith('_id')) visit(child, key, depth + 1);
      }
    }; visit(value); return refs;
  };
  const dependencies = new Map<string, Set<string>>();
  for (const ref of changedAuthorities.size ? new Set([...required.keys(), ...changedAuthorities]) : []) {
    const prior = items.filter(item => item.scope_ref === ref).map(item => ({ evidence_refs: item.evidence_refs,
      verification_refs: item.verification_refs, provenance: item.provenance }));
    unresolved = false;
    dependencies.set(ref, new Set([...references(old.get(ref), oldContent, authorityRefs.has(ref)), ...references(next.get(ref), nextContent, authorityRefs.has(ref)),
      ...[...references(prior, oldContent, true)].filter(source => authorityRefs.has(source) || source.startsWith('source:'))]));
  }
  const expand = (seeds: Iterable<string>, graph: ReadonlyMap<string, Set<string>>): Set<string> => {
    const reached = new Set(seeds);
    for (const ref of reached) graph.get(ref)?.forEach(consumer => reached.add(consumer));
    return reached;
  };
  const preciseRefs = new Map<string, Set<string>>();
  for (const ref of new Set([...preciseBefore.keys(), ...preciseAfter.keys()])) {
    const authority = authorityRefs.has(ref);
    unresolved = false;
    preciseRefs.set(ref, new Set([...references(preciseBefore.get(ref), before, authority, true),
      ...references(preciseAfter.get(ref), current, authority, true)]));
    if (unresolved && changedAuthorities.has(ref)) return [...required.keys()];
  }
  const identities = new Map([...preciseRefs.keys()].map(ref => {
    const member = memberAddress.exec(ref);
    return [ref, member ? [ref, `${member[2]}:${member[3]}`] : [ref]];
  }));
  const preciseGraph = new Map<string, Set<string>>();
  for (const [ref, sources] of preciseRefs) {
    const authority = authorityRefs.has(ref);
    preciseGraph.set(ref, new Set([...preciseRefs].filter(([other, refs]) => other !== ref && (
      (authority || !authorityRefs.has(other)) && identities.get(ref)!.some(id => refs.has(id))
      || authority && !authorityRefs.has(other) && identities.get(other)!.some(id => sources.has(id))
    )).map(([other]) => other)));
  }
  const scopesReached = (seeds: Iterable<string>): Set<string> => {
    const reached = new Set<string>();
    for (const entry of expand(seeds, preciseGraph)) {
      if (required.has(entry)) reached.add(entry);
      for (const scope of answerConsumers.get(entry) ?? []) if (required.has(scope)) reached.add(scope);
      const member = memberAddress.exec(entry);
      if (!member) continue;
      if (required.has(member[1])) reached.add(member[1]);
      if (member[2] === 'flow' && required.has(`flow:${member[3]}`)) reached.add(`flow:${member[3]}`);
    }
    return reached;
  };
  const businessSeeds = [...identities].filter(([, aliases]) => aliases.some(alias => changedBusiness.has(alias))).map(([ref]) => ref);
  for (const [ref, sources] of preciseRefs) {
    if ([...changedLinkedFacts].some(id => sources.has(id))) businessSeeds.push(ref);
  }
  for (const scope of scopesReached(businessSeeds)) affected.add(scope);
  for (const ref of changedBusiness) if (required.has(ref)) affected.add(ref);
  for (const ref of changedAuthorities) {
    const reached = scopesReached([ref]);
    // A decision grounded in a specific implementation file has direct evidence consumers.
    const codeSources = [old.get(ref), next.get(ref)].flatMap(value => {
      const provenance = asRecord(asRecord(value)?.provenance);
      const file = provenance?.source_kind === 'code' && nonEmptyString(provenance.source_ref)
        ? questioningEvidencePath(provenance.source_ref, projectRoot) : undefined;
      return file ? ['source:' + file] : [];
    });
    for (const scope of required.keys()) {
      if (codeSources.some(source => dependencies.get(scope)?.has(source))) reached.add(scope);
    }
    // A shared document can locate an otherwise unplaced edit, but cannot expand a known landing.
    if (!reached.size) for (const scope of required.keys()) {
      if ([...dependencies.get(ref) ?? []].some(source => source.startsWith('source:') && dependencies.get(scope)?.has(source))) reached.add(scope);
    }
    if (!reached.size) return [...required.keys()];
    for (const scope of reached) affected.add(scope);
  }
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
    QUESTIONING_SCOPE_HEADING,
    ...scopes,
    '只交回本轮实际复核的上述条目。对未列入范围的条目，由机器复用原件；同引一份未变的需求文档不能证明受影响。复核时用具体决定、稳定地址或精确字段指针标出实际依赖。有具体新证据可重开其它scope，同时在answer及verification_refs给出新证据。用紧凑JSON返回，不写临时结果或复述完整材料。',
    '用原需求逐项核对预期结果、独立验收 ID 和适用观察通道。以反例判断设计是否允许违反当前已授权行为，例如生产者交出的对象与消费者需要的本次对象不一致。失败返回落点依据原文及既有路由解释；参考图按既有来源核验并保留到施工/视觉验收。',
    '同一通道可以承担不同义务。按原需求分别核对输入映射和默认值、生产写入与读回、外部界面与导航、可见时间变化和真实调用次数。逐项核对 P0 的动作和断言，多个 UI 义务可以共用同一动作，各自的预期结果须有可观察的断言。结果页出现可以证明导航；持久状态和调用次数须由能读取实际值的应用内测试承担，应用内测试即使在真机执行也归 unit。不同 CU 的局部同号及多个目标共用同一完整定义可按实际消费范围保留。',
    '当前义务遗漏或混写、证据通道无法观察所承诺的结果、产品设计存在实质矛盾或违反本次授权时，在对应 scope 给 blocker，写清原文或相冲突的设计出处、条目位置与实际后果。当前产品必须的生产者、接收者、触发、交接或清理尚不成立，也属于设计缺陷。当前必须裁决的需求或授权沿既有未决决定与权限处理。',
    '设计已明确义务、可观察通道及生产行为时，以设计原文完成 answered_with_evidence。具体测试 API/入口、注入与定位方式、样本数据/隔离/复位前置、用例步骤和断言强度交既有 CU 计划及施工后的独立核验；需要时在答复留一句交接说明。只有这些执行细节未定时不报 blocker 或 open_decision，也不声称测试已执行或义务已验证。远期决定沿原 owner、needed-by 和解除条件记录；其依赖未变时复用原结论。',
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
  const decode = (text: string): BlueprintRecord | undefined => {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? { items: value } : asRecord(value);
  };
  const questioning = (value: BlueprintRecord | undefined): BlueprintRecord | undefined => {
    const result = asRecord(asRecord(value?.review_summary)?.questioning) ?? asRecord(value?.questioning) ?? value;
    return result && Array.isArray(result.items) && result.items.every(item => !!asRecord(item)) ? result : undefined;
  };
  let parsed: BlueprintRecord | undefined;
  try { parsed = questioning(decode(output)); }
  catch {
    const fences = [...output.matchAll(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?$/gm)];
    const prose: string[] = [];
    let offset = 0;
    const include = (result: BlueprintRecord | undefined): void => {
      if (!result) return;
      if (parsed) throw new Error('独立质询须交回唯一的结构化结论。');
      parsed = result;
    };
    for (let index = 0; index < fences.length; index++) {
      const open = fences[index];
      prose.push(output.slice(offset, open.index));
      let closing = index + 1;
      while (closing < fences.length && (fences[closing][2].trim()
        || fences[closing][1][0] !== open[1][0] || fences[closing][1].length < open[1].length)) closing++;
      const close = fences[closing];
      const body = output.slice(open.index! + open[0].length, close?.index);
      index = closing;
      offset = close ? close.index! + close[0].length : output.length;
      const looksJson = /^[\[{]/.test(body.trimStart());
      const json = /^\s*json(?:\s|$)/i.test(open[2]) || !open[2].trim() && looksJson;
      if (!json && !looksJson) continue;
      let result: BlueprintRecord | undefined;
      try { result = questioning(decode(body)); }
      catch (error) {
        if (json) throw new Error(`独立质询 JSON 围栏不可解析：${(error as Error).message}`);
      }
      if ((json || result) && (!result || !close)) {
        throw new Error('独立质询 JSON 围栏须完整交回 questioning 对象或 items 数组。');
      }
      include(result);
    }
    prose.push(output.slice(offset));
    // A legacy object outside the fences is also a possible reply.
    for (const text of prose) {
      let result: BlueprintRecord | undefined;
      try { result = questioning(decode(text)); }
      catch { result = questioning(extractJsonObjectFromText(text) ?? undefined); }
      include(result);
    }
  }
  if (!parsed) {
    throw new Error('独立质询必须返回现有 questioning JSON 对象及 items 数组；自然语言总结不能签发结果。');
  }
  const declaredIds = new Map<string, unknown>();
  for (const item of asRecords(parsed.items)) if (nonEmptyString(item.question_id)) {
    if (declaredIds.has(item.question_id) && declaredIds.get(item.question_id) !== item.scope_ref) {
      throw new Error(`独立质询 question_id 重复占用不同范围：${item.question_id}。`);
    }
    declaredIds.set(item.question_id, item.scope_ref);
  }
  return parsed;
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
  original?: { path: string; sha256: string }, signed?: SignedQuestioningScopes): BlueprintRecord {
  const fresh = normalizeQuestioningItems(blueprint, asRecords(result.items), signed).map(item => {
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
    const original = start && readDesignQuestioningOriginal(runDir, start, events, projectRoot);
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
