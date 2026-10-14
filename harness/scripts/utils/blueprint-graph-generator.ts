import {
  BlueprintIssue,
  BlueprintRecord,
  asRecord,
  asRecords,
  asStrings,
  issue,
  nonEmptyString,
} from './component-blueprint-model';
import { stableAddressIndex } from './blueprint-addressing';

export interface GeneratedBlueprintGraph {
  graph_id: string;
  format: 'mermaid';
  source_view_id: string;
  content: string;
  node_refs: string[];
  relation_refs: string[];
}

function relationLabel(relation: BlueprintRecord): unknown {
  if (nonEmptyString(relation.label)) return relation.label;
  const labels: Record<string, string> = { realized_by: '实现于', consumes: '消费', implements: '实现', owned_by: '归属', deployed_in: '部署于' };
  return labels[String(relation.relation_type)] ?? relation.relation_type;
}

export function generateMermaidViewGraph(blueprint: BlueprintRecord, viewId: string): GeneratedBlueprintGraph {
  const view = asRecords(blueprint.design_views).find(item => item.view_id === viewId);
  if (!view) throw new Error(`view_id=${viewId} 不存在。`);
  const nodes = asRecords(view.nodes);
  const nodeRefs = nodes.map(node => `view:${viewId}/node:${String(node.node_id)}`);
  const nodeAddresses = new Set(nodeRefs);
  const relations = asRecords(blueprint.relations).filter(relation => {
    const from = String(relation.from ?? '');
    const to = String(relation.to ?? '');
    return nodeAddresses.has(from) && nodeAddresses.has(to);
  });
  const alias = new Map(nodeRefs.map((address, index) => [address, `n${index + 1}`]));
  const lines = ['flowchart TD'];
  nodes.forEach(node => lines.push(`  ${alias.get(`view:${viewId}/node:${node.node_id}`)}["${mermaidLabel(node.label ?? node.node_id)}"]`));
  relations.forEach(relation => {
    lines.push(`  ${alias.get(String(relation.from))} -->|${mermaidLabel(relationLabel(relation))}| ${alias.get(String(relation.to))}`);
  });
  return {
    graph_id: `graph:${viewId}`,
    format: 'mermaid',
    source_view_id: viewId,
    content: `${lines.join('\n')}\n`,
    node_refs: nodeRefs,
    relation_refs: relations.map(relation => `relation:${String(relation.relation_id)}`),
  };
}

export function parseMermaidSubset(content: string): string | undefined {
  const lines = content.trim().split(/\r?\n/);
  if (lines[0] === 'sequenceDiagram') return parseSequenceDiagram(lines);
  if (!/^(flowchart|graph)\s+(TD|LR|RL|BT)$/.test(lines[0] ?? '')) return '首行必须是 flowchart/graph 方向声明。';
  for (const [index, line] of lines.slice(1).entries()) {
    if (!/^\s*[A-Za-z][\w-]*(?:\[.*\])?(?:\s+-->(?:\|.*\|)?\s+[A-Za-z][\w-]*)?\s*$/.test(line)) {
      return `第 ${index + 2} 行不在受支持 Mermaid 子集：${line}`;
    }
  }
  return undefined;
}

function parseSequenceDiagram(lines: string[]): string | undefined {
  const participants = new Set<string>();
  const declaration = /^(?:participant|actor)\s+([A-Za-z][\w-]*)(?:\s+as\s+\S.*)?$/;
  for (const [index, raw] of lines.entries()) {
    const match = declaration.exec(raw.trim());
    if (!match) continue;
    if (participants.has(match[1]!)) return `第 ${index + 1} 行重复声明参与者：${match[1]}。`;
    participants.add(match[1]!);
  }
  let altDepth = 0;
  for (const [index, raw] of lines.slice(1).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('%%') || declaration.test(line)) continue;
    const message = /^([A-Za-z][\w-]*?)\s*(?:-->>|->>)\s*([A-Za-z][\w-]*)\s*:\s*\S.*$/.exec(line);
    const note = /^Note\s+over\s+([A-Za-z][\w-]*)(?:\s*,\s*([A-Za-z][\w-]*))?\s*:\s*\S.*$/i.exec(line);
    if (message || note) {
      for (const endpoint of (message ?? note)!.slice(1).filter(Boolean)) {
        if (!participants.has(endpoint)) return `第 ${index + 2} 行引用未声明参与者：${endpoint}。`;
      }
      continue;
    }
    if (/^alt\s+\S.*$/.test(line)) { altDepth++; continue; }
    if (/^else(?:\s+\S.*)?$/.test(line)) {
      if (!altDepth) return `第 ${index + 2} 行 else 没有对应的 alt。`;
      continue;
    }
    if (line === 'end') {
      if (!altDepth) return `第 ${index + 2} 行 end 没有对应的 alt。`;
      altDepth--;
      continue;
    }
    return `第 ${index + 2} 行不在受支持 Mermaid 时序子集：${raw}`;
  }
  return altDepth ? 'alt 分支块未闭合，缺少 end。' : undefined;
}

export function mermaidLabel(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;').replace(/[\r\n]/g, ' ');
}

/** 整体联系只取显式 relation，完整地址是节点身份。 */
export function generateMermaidRelationGraph(blueprint: BlueprintRecord): GeneratedBlueprintGraph {
  const index = stableAddressIndex(blueprint);
  const relations = asRecords(blueprint.relations);
  const nodeRefs = [...new Set(relations.flatMap(r => [String(r.from), String(r.to)]))];
  const alias = new Map(nodeRefs.map((address, i) => [address, `n${i + 1}`]));
  const lines = ['flowchart LR'];
  for (const address of nodeRefs) {
    const row = index.get(address);
    if (!row) throw new Error(`关系端点无法落地：${address}`);
    const view = /^view:([^/]+)/.exec(address)?.[1];
    const viewNames: Record<string, string> = { logical: '逻辑', runtime: '运行', development: '开发', deployment: '部署', scenarios: '场景' };
    lines.push(`  ${alias.get(address)}["${mermaidLabel(`${row.label ?? row.name ?? address.split(':').pop()}${view ? `（${viewNames[view] ?? view}）` : ''}`)}"]`);
  }
  for (const r of relations) lines.push(`  ${alias.get(String(r.from))} -->|${mermaidLabel(relationLabel(r))}| ${alias.get(String(r.to))}`);
  return { graph_id: 'graph:overview', format: 'mermaid', source_view_id: 'overview', content: lines.join('\n') + '\n', node_refs: nodeRefs, relation_refs: relations.map(r => `relation:${r.relation_id}`) };
}

/** phases 只定义节点；流转边来自分支的相邻阶段，每条边保留其分支来源。 */
export function generateMermaidPhaseGraph(useCase: BlueprintRecord): { content: string; edges: { from: string; to: string; branch: string }[]; baselineBranch?: string } {
  const state = useCase.state_model as BlueprintRecord | undefined;
  const phases = asStrings(state?.phases);
  const alias = new Map(phases.map((phase, i) => [phase, `p${i + 1}`]));
  const lines = ['flowchart TD', ...phases.map(phase => `  ${alias.get(phase)}["${mermaidLabel(phase)}"]`)];
  const edges: { from: string; to: string; branch: string }[] = [];
  const branches = asRecords(useCase.branches);
  const baselineBranch = branches[0] ? String(branches[0].id) : undefined;
  const transitions = new Map<string, { from: string; to: string; baseline: boolean; labels: Set<string> }>();
  for (const [branchIndex, branch] of branches.entries()) {
    const sequence = asStrings(branch.expected_phase_seq);
    for (let i = 1; i < sequence.length; i++) {
      const from = sequence[i - 1]; const to = sequence[i];
      if (!alias.has(from) || !alias.has(to)) throw new Error(`分支 ${branch.id} 引用未声明阶段：${from} → ${to}`);
      edges.push({ from, to, branch: String(branch.id) });
      const key = JSON.stringify([from, to]);
      const transition = transitions.get(key) ?? { from, to, baseline: false, labels: new Set<string>() };
      transition.baseline ||= branchIndex === 0;
      transition.labels.add(String(branch.label ?? branch.name ?? branch.id));
      transitions.set(key, transition);
    }
  }
  for (const transition of transitions.values()) {
    const labels = [...transition.labels];
    const label = labels.length > 3 ? `${labels.slice(0, 2).join('、')} 等 ${labels.length} 条分支` : labels.join('、');
    lines.push(`  ${alias.get(transition.from)} -->${transition.baseline ? '' : `|${mermaidLabel(label)}|`} ${alias.get(transition.to)}`);
  }
  return { content: lines.join('\n') + '\n', edges, baselineBranch };
}

/** 模块名只来自本目标的 typed 依赖声明，不冒充蓝图稳定地址。 */
export function generateMermaidModuleDependencyGraph(contracts: BlueprintRecord, sourceAddress = '$'): { content: string; edges: { from: string; to: string; source: string }[] } {
  const dependencies = asRecord(contracts.module_dependencies) ?? {};
  const names = [...new Set(Object.entries(dependencies).flatMap(([from, values]) => [from, ...asStrings(values)]))];
  const aliases = new Map(names.map((name, index) => [name, `m${index + 1}`]));
  const modules = asRecords(contracts.modules);
  const lines = ['flowchart LR'];
  const changes: Record<string, string> = { add: '新增', new: '新增', modify: '修改', delete: '删除' };
  for (const name of names) {
    const module = modules.find(item => item.name === name);
    const details = module ? [module.layer, changes[String(module.change_type)] ?? module.change_type].filter(nonEmptyString) : [];
    lines.push(`  ${aliases.get(name)}["${mermaidLabel(name + (details.length ? `（${details.join('；')}）` : ''))}"]`);
  }
  const edges: { from: string; to: string; source: string }[] = [];
  const drawn = new Set<string>();
  for (const [from, values] of Object.entries(dependencies)) {
    if (!Array.isArray(values)) throw new Error(`module_dependencies.${from} 必须是模块名数组。`);
    for (const [index, value] of values.entries()) {
      if (!nonEmptyString(value)) throw new Error(`module_dependencies.${from}[${index}] 必须是非空模块名。`);
      edges.push({ from, to: value, source: `${sourceAddress}.contracts.module_dependencies.${from}[${index}]` });
      const key = JSON.stringify([from, value]);
      if (drawn.has(key)) continue;
      drawn.add(key);
      lines.push(`  ${aliases.get(from)} --> ${aliases.get(value)}`);
    }
  }
  return { content: lines.join('\n') + '\n', edges };
}

export function validateGeneratedBlueprintGraphs(blueprint: BlueprintRecord): BlueprintIssue[] {
  const out: BlueprintIssue[] = [];
  let addresses: Map<string, BlueprintRecord>;
  try {
    addresses = stableAddressIndex(blueprint);
  } catch (error) {
    return [issue('blueprint_graph_address_index_invalid', '$.generated_graphs', (error as Error).message)];
  }
  asRecords(blueprint.generated_graphs).forEach((graph, index) => {
    const base = `$.generated_graphs[${index}]`;
    const presentationOnly = graph.relation_refs === undefined || (Array.isArray(graph.relation_refs) && graph.relation_refs.length === 0);
    const severity = presentationOnly || (typeof graph.content === 'string' && /^sequenceDiagram\b/.test(graph.content.trimStart())) ? 'WARN' : 'BLOCKER';
    if (graph.format !== 'mermaid' || !nonEmptyString(graph.content)) {
      out.push(issue('blueprint_generated_graph_shape_invalid', base, '生成图必须声明 format=mermaid 和 content。', severity));
      return;
    }
    const parseError = parseMermaidSubset(graph.content);
    if (parseError) out.push(issue('blueprint_generated_graph_parse_failed', `${base}.content`, parseError, severity));
    for (const ref of [...asStrings(graph.node_refs), ...asStrings(graph.relation_refs)]) {
      if (!addresses.has(ref)) out.push(issue('blueprint_generated_graph_ref_missing', base, `生成图引用无法落地：${ref}。`, severity));
    }
  });
  return out;
}
