import {
  BlueprintIssue,
  BlueprintRecord,
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
    lines.push(`  ${alias.get(String(relation.from))} -->|${mermaidLabel(relation.relation_type)}| ${alias.get(String(relation.to))}`);
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
  if (!/^(flowchart|graph)\s+(TD|LR|RL|BT)$/.test(lines[0] ?? '')) return '首行必须是 flowchart/graph 方向声明。';
  for (const [index, line] of lines.slice(1).entries()) {
    if (!/^\s*[A-Za-z][\w-]*(?:\[.*\])?(?:\s+-->(?:\|.*\|)?\s+[A-Za-z][\w-]*)?\s*$/.test(line)) {
      return `第 ${index + 2} 行不在受支持 Mermaid 子集：${line}`;
    }
  }
  return undefined;
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
  for (const r of relations) lines.push(`  ${alias.get(String(r.from))} -->|${mermaidLabel(r.label ?? r.relation_type)}| ${alias.get(String(r.to))}`);
  return { graph_id: 'graph:overview', format: 'mermaid', source_view_id: 'overview', content: lines.join('\n') + '\n', node_refs: nodeRefs, relation_refs: relations.map(r => `relation:${r.relation_id}`) };
}

/** phases 只定义节点；流转边来自分支的相邻阶段，每条边保留其分支来源。 */
export function generateMermaidPhaseGraph(useCase: BlueprintRecord): { content: string; edges: { from: string; to: string; branch: string }[] } {
  const state = useCase.state_model as BlueprintRecord | undefined;
  const phases = asStrings(state?.phases);
  const alias = new Map(phases.map((phase, i) => [phase, `p${i + 1}`]));
  const lines = ['flowchart TD', ...phases.map(phase => `  ${alias.get(phase)}["${mermaidLabel(phase)}"]`)];
  const edges: { from: string; to: string; branch: string }[] = [];
  for (const branch of asRecords(useCase.branches)) {
    const sequence = asStrings(branch.expected_phase_seq);
    for (let i = 1; i < sequence.length; i++) {
      const from = sequence[i - 1]; const to = sequence[i];
      if (!alias.has(from) || !alias.has(to)) throw new Error(`分支 ${branch.id} 引用未声明阶段：${from} → ${to}`);
      edges.push({ from, to, branch: String(branch.id) });
      lines.push(`  ${alias.get(from)} -->|${mermaidLabel(branch.label ?? branch.name ?? branch.id)}| ${alias.get(to)}`);
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
    if (graph.format !== 'mermaid' || !nonEmptyString(graph.content)) {
      out.push(issue('blueprint_generated_graph_shape_invalid', base, '生成图必须声明 format=mermaid 和 content。'));
      return;
    }
    const parseError = parseMermaidSubset(graph.content);
    if (parseError) out.push(issue('blueprint_generated_graph_parse_failed', `${base}.content`, parseError));
    for (const ref of [...asStrings(graph.node_refs), ...asStrings(graph.relation_refs)]) {
      if (!addresses.has(ref)) out.push(issue('blueprint_generated_graph_ref_missing', base, `生成图引用无法落地：${ref}。`));
    }
  });
  return out;
}
