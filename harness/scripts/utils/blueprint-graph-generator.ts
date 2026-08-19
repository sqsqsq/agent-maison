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
  const nodeIds = new Set(nodes.map(node => String(node.node_id)));
  const relations = asRecords(blueprint.relations).filter(relation => {
    const from = String(relation.from ?? '');
    const to = String(relation.to ?? '');
    return [...nodeIds].some(id => from === `view:${viewId}/node:${id}` || to === `view:${viewId}/node:${id}`);
  });
  const alias = new Map(nodes.map((node, index) => [String(node.node_id), `n${index + 1}`]));
  const lines = ['flowchart TD'];
  nodes.forEach(node => lines.push(`  ${alias.get(String(node.node_id))}["${String(node.label ?? node.node_id).replace(/"/g, "'")}"]`));
  relations.forEach(relation => {
    const fromId = String(relation.from).split('/node:')[1];
    const toId = String(relation.to).split('/node:')[1];
    if (alias.has(fromId) && alias.has(toId)) lines.push(`  ${alias.get(fromId)} -->|${String(relation.relation_type)}| ${alias.get(toId)}`);
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

function parseMermaidSubset(content: string): string | undefined {
  const lines = content.trim().split(/\r?\n/);
  if (!/^(flowchart|graph)\s+(TD|LR|RL|BT)$/.test(lines[0] ?? '')) return '首行必须是 flowchart/graph 方向声明。';
  for (const [index, line] of lines.slice(1).entries()) {
    if (!/^\s*[A-Za-z][\w-]*(?:\[.*\])?(?:\s+-->(?:\|.*\|)?\s+[A-Za-z][\w-]*)?\s*$/.test(line)) {
      return `第 ${index + 2} 行不在受支持 Mermaid 子集：${line}`;
    }
  }
  return undefined;
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
