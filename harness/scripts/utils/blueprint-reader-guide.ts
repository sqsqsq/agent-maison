import { createHash } from 'crypto';
import { stableStringify } from './phase-evidence-manifest';
import { asRecord, asRecords, asStrings, BlueprintIssue, BlueprintRecord, issue, nonEmptyString } from './component-blueprint-model';
import { inspectGeneratedBlueprintGraphs } from './blueprint-graph-generator';

export const BLUEPRINT_READER_SECTIONS = ['summary', 'background', 'terms', 'journey', 'solution', 'flows', 'data', 'decisions', 'recovery', 'quality', 'delivery', 'acceptance', 'questions'] as const;
export type BlueprintReaderSection = typeof BLUEPRINT_READER_SECTIONS[number];
export interface BlueprintReaderGuideSection {
  section: BlueprintReaderSection;
  title: string;
  prose: string;
  source_refs: string[];
  graph_ids: string[];
  resolvedSources: Array<{ pointer: string; value: unknown }>;
}
export interface BlueprintReaderGuideInspection {
  sourceDigest: string;
  status: 'missing' | 'stale' | 'current';
  sections: BlueprintReaderGuideSection[];
  diagnostics: BlueprintIssue[];
}

export interface BlueprintGraphDisplayInspection {
  guide: BlueprintReaderGuideInspection;
  sectionGraphs: ReadonlyMap<BlueprintReaderGuideSection, BlueprintRecord[]>;
  flowGraphs: ReadonlyMap<string, BlueprintRecord[]>;
  viewGraphs: ReadonlyMap<string, BlueprintRecord[]>;
  sequenceGraphs: BlueprintRecord[];
  graphIssues: ReadonlyMap<BlueprintRecord, BlueprintIssue[]>;
  diagnostics: BlueprintIssue[];
}

/** 正文与参考共用实际出口；只选择已有图，不替作者补引用或放置遗漏图。 */
export function inspectBlueprintGraphDisplay(blueprint: BlueprintRecord, graphIssues = inspectGeneratedBlueprintGraphs(blueprint).graphIssues): BlueprintGraphDisplayInspection {
  const guide = inspectBlueprintReaderGuide(blueprint);
  const graphs = asRecords(blueprint.generated_graphs);
  const sequenceGraphs = graphs.filter(graph => /^\s*sequenceDiagram\b/.test(String(graph.content)));
  const sectionGraphs = new Map(guide.sections.map(section => [section, section.graph_ids.flatMap(id => {
    const graph = graphs.find(row => row.graph_id === id);
    return graph ? [graph] : [];
  })]));
  const flowGraphs = new Map<string, BlueprintRecord[]>();
  const views = asRecords(blueprint.design_views);
  if (!guide.sections.some(section => section.section === 'flows')) {
    for (const flow of asRecords(views.find(view => view.view_id === 'runtime')?.runtime_data_flows)) {
      flowGraphs.set(String(flow.flow_id), sequenceGraphs.filter(graph => asStrings(graph.node_refs).includes(`view:runtime/flow:${flow.flow_id}`)));
    }
  }
  const viewGraphs = new Map<string, BlueprintRecord[]>();
  for (const id of ['scenarios', 'logical', 'runtime', 'development', 'deployment']) {
    const view = views.find(row => row.view_id === id);
    if (!view || view.applicability === 'not_applicable' || view.evolution_impact === 'verified_unchanged') continue;
    viewGraphs.set(id, graphs.filter(graph => graph.source_view_id === id && !sequenceGraphs.includes(graph) && asStrings(graph.relation_refs).length > 0));
  }
  const selected = new Set([...sectionGraphs.values(), ...flowGraphs.values(), ...viewGraphs.values(), sequenceGraphs].flat());
  const diagnostics = [...guide.diagnostics];
  for (const graph of graphs) {
    if (selected.has(graph) || graphIssues.get(graph)!.length) continue;
    const index = (blueprint.generated_graphs as unknown[]).indexOf(graph);
    diagnostics.push(issue('blueprint_generated_graph_not_displayed', `$.generated_graphs[${index}]`,
      `已有图 ${String(graph.graph_id)}（${String(graph.label ?? graph.graph_id)}）没有正文或技术参考的实际展示出口；请由设计作者核对说明中的图引用与现有视图展示条件。`, 'WARN'));
  }
  return { guide, sectionGraphs, flowGraphs, viewGraphs, sequenceGraphs, graphIssues, diagnostics };
}

/** 仅在整份蓝图进入施工摘要的位置调用；同名业务对象仍参与摘要。 */
export function blueprintWithoutReaderGuide(blueprint: BlueprintRecord): BlueprintRecord {
  const summary = asRecord(blueprint.review_summary);
  if (!summary || !Object.prototype.hasOwnProperty.call(summary, 'reader_guide')) return blueprint;
  const { reader_guide: _guide, ...reviewSummary } = summary;
  return { ...blueprint, review_summary: reviewSummary };
}

/** 说明的新鲜度与施工摘要独立；只读计算，绝不替作者盖章。 */
export function computeBlueprintReaderGuideSourceDigest(blueprint: BlueprintRecord): string {
  const { revision: _revision, derived_results: _derived, ...view } = blueprint;
  const summary = asRecord(blueprint.review_summary);
  if (summary) {
    const { reader_guide: _guide, authored_by: _author, questioning: _questioning, admission: _admission, reconciliation: _reconciliation, ...reviewSummary } = summary;
    view.review_summary = reviewSummary;
  }
  return 'sha256:' + createHash('sha256').update(stableStringify(view)).digest('hex');
}

/** JSON Pointer 只读定位，空值/false/0 是存在的来源；不接受原型链属性。 */
export function resolveBlueprintReaderSource(blueprint: BlueprintRecord, pointer: string): { pointer: string; value: unknown } | undefined {
  if (pointer === '') return { pointer, value: blueprint };
  if (!pointer.startsWith('/') || /~(?:[^01]|$)/.test(pointer)) return undefined;
  let value: unknown = blueprint;
  for (const part of pointer.slice(1).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if ((!Array.isArray(value) && !asRecord(value)) || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))
      || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as BlueprintRecord)[key];
  }
  return { pointer, value };
}

/** 降低实际 Markdown 标题，保持 fenced/indented code 的字面内容。 */
export function demoteBlueprintReaderHeadings(prose: string): { prose: string; changed: boolean; headingsDemoted?: true; fenceClosed?: true } {
  const lines = prose.split('\n');
  let fence: { marker: string; length: number } | undefined;
  let changed = false;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const codeFence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      out.push(line);
      if (codeFence && codeFence[1][0] === fence.marker && codeFence[1].length >= fence.length && !codeFence[2].trim()) fence = undefined;
      continue;
    }
    if (codeFence && (codeFence[1][0] === '~' || !codeFence[2].includes('`'))) {
      fence = { marker: codeFence[1][0], length: codeFence[1].length };
      out.push(line); continue;
    }
    const heading = /^ {0,3}#{1,6}(?:[ \t]+(.*)|$)/.exec(line);
    if (heading) {
      out.push(`**${(heading[1] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim()}**`);
      changed = true; continue;
    }
    if (line.trim() && !/^( {4}|\t)/.test(line) && /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[i + 1] ?? '')) {
      out.push(`**${line.trim()}**`); i++; changed = true; continue;
    }
    out.push(line);
  }
  const headingsDemoted = changed;
  if (fence) out.push(fence.marker.repeat(fence.length));
  return { prose: out.join('\n'), changed: changed || Boolean(fence), ...(headingsDemoted ? { headingsDemoted: true } : {}), ...(fence ? { fenceClosed: true } : {}) };
}

export function inspectBlueprintReaderGuide(blueprint: BlueprintRecord): BlueprintReaderGuideInspection {
  const sourceDigest = computeBlueprintReaderGuideSourceDigest(blueprint);
  const diagnostics: BlueprintIssue[] = [];
  const sections: BlueprintReaderGuideSection[] = [];
  const base = '$.review_summary.reader_guide';
  const warn = (id: string, at: string, message: string): void => { diagnostics.push(issue(id, at, message, 'WARN')); };
  const raw = asRecord(blueprint.review_summary)?.reader_guide;
  if (raw === undefined) {
    warn('blueprint_reader_guide_missing', base, '尚未补写评审说明；按当前设计字段展示。');
    return { sourceDigest, status: 'missing', sections, diagnostics };
  }
  const guide = asRecord(raw);
  if (!guide || !Array.isArray(guide.sections)) warn('blueprint_reader_guide_shape_invalid', base, 'reader_guide 须为包含 sections 数组的对象；无效说明不展示。');
  const current = guide?.source_digest === sourceDigest;
  if (!current) warn('blueprint_reader_guide_stale', `${base}.source_digest`, '评审说明需更新：来源摘要缺失或与当前设计不同；按当前设计字段展示。');
  const graphIds = new Set(asRecords(blueprint.generated_graphs).map(graph => graph.graph_id));
  for (const [i, rawSection] of (Array.isArray(guide?.sections) ? guide.sections : []).entries()) {
    const at = `${base}.sections[${i}]`;
    const row = asRecord(rawSection);
    if (!row || !(BLUEPRINT_READER_SECTIONS as readonly unknown[]).includes(row.section) || !nonEmptyString(row.title) || !nonEmptyString(row.prose) || !Array.isArray(row.source_refs) || !row.source_refs.length) {
      warn('blueprint_reader_guide_section_invalid', at, '说明小节须声明既有 section、title、prose 和非空 source_refs；该小节不展示。');
      continue;
    }
    const resolvedSources: BlueprintReaderGuideSection['resolvedSources'] = [];
    for (const [j, pointer] of row.source_refs.entries()) {
      const source = typeof pointer === 'string' ? resolveBlueprintReaderSource(blueprint, pointer) : undefined;
      if (source) resolvedSources.push(source);
      else warn('blueprint_reader_guide_source_missing', `${at}.source_refs[${j}]`, `说明来源无法解析：${String(pointer)}。`);
    }
    const graphs: string[] = [];
    if (row.graph_ids !== undefined && !Array.isArray(row.graph_ids)) warn('blueprint_reader_guide_graph_invalid', `${at}.graph_ids`, 'graph_ids 须为已有图标识符的数组。');
    for (const [j, id] of (Array.isArray(row.graph_ids) ? row.graph_ids : []).entries()) {
      if (typeof id === 'string' && graphIds.has(id)) graphs.push(id);
      else warn('blueprint_reader_guide_graph_missing', `${at}.graph_ids[${j}]`, `说明引用的图不存在：${String(id)}。`);
    }
    const normalized = demoteBlueprintReaderHeadings(row.prose);
    if (normalized.headingsDemoted) warn('blueprint_reader_guide_heading_demoted', `${at}.prose`, '说明中的 Markdown 标题已降为加粗段落；标题文字与代码块保留。');
    if (normalized.fenceClosed) warn('blueprint_reader_guide_fence_closed', `${at}.prose`, '说明末尾的代码围栏未闭合，已补同类型与长度的闭合围栏，保留代码内容与后续章节层级。');
    if (current && resolvedSources.length) sections.push({ section: row.section as BlueprintReaderSection, title: row.title, prose: normalized.prose, source_refs: resolvedSources.map(source => source.pointer), graph_ids: graphs, resolvedSources });
  }
  return { sourceDigest, status: current && guide && Array.isArray(guide.sections) ? 'current' : 'stale', sections, diagnostics };
}
