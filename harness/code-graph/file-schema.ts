// ============================================================================
// file-schema.ts — code-graph.yaml 解析与 schema 校验（probe / phase check 共用）
// ============================================================================

import * as fs from 'fs';
import * as YAML from 'yaml';

import type { CodeGraphFile, CodeGraphNode } from './types';

export function parseCodeGraphFile(
  absPath: string,
  relPath: string,
): { graph: CodeGraphFile | null; error?: string } {
  try {
    const raw = fs.readFileSync(absPath, 'utf-8');
    const parsed = YAML.parse(raw) as CodeGraphFile;
    if (!parsed || typeof parsed !== 'object') {
      return { graph: null, error: `${relPath} 不是有效 YAML 对象` };
    }
    return { graph: parsed };
  } catch (e) {
    return { graph: null, error: `${relPath} 解析失败：${(e as Error).message}` };
  }
}

function validateNode(node: CodeGraphNode, errors: string[]): void {
  if (!node?.id || typeof node.id !== 'string') {
    errors.push('nodes[] 条目缺少 id');
    return;
  }
  const anchor = node.anchor;
  if (!anchor?.file || !anchor?.symbol) {
    errors.push(`节点 ${node.id} 缺少 anchor.file 或 anchor.symbol`);
    return;
  }
  if (typeof anchor.content_hash !== 'string' || !anchor.content_hash.trim()) {
    errors.push(`节点 ${node.id} 缺少 anchor.content_hash（漂移检测必需）`);
  }
}

export function validateCodeGraphFileSchema(graph: CodeGraphFile): string[] {
  const errors: string[] = [];
  if (typeof graph.schema_version !== 'string' || !graph.schema_version.trim()) {
    errors.push('缺少 schema_version 字符串');
  }
  if (typeof graph.module !== 'string' || !graph.module.trim()) {
    errors.push('缺少 module 字符串');
  }
  if (!Array.isArray(graph.nodes)) {
    errors.push('nodes 须为数组');
    return errors;
  }
  for (const node of graph.nodes) {
    validateNode(node, errors);
  }
  return errors;
}

export function probeCodeGraphFileSchema(
  absPath: string,
  relPath: string,
): { ok: true } | { ok: false; error: string } {
  const { graph, error } = parseCodeGraphFile(absPath, relPath);
  if (!graph) {
    return { ok: false, error: error ?? `${relPath} 无效` };
  }
  const schemaErrors = validateCodeGraphFileSchema(graph);
  if (schemaErrors.length > 0) {
    return { ok: false, error: schemaErrors.join('；') };
  }
  return { ok: true };
}
