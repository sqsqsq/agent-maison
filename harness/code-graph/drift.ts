/**
 * Code Graph 分级漂移闸门（符号消失=BLOCKER；core/签名变=BLOCKER；体 hash 变=WARN）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { computeAnchorContentHash } from './anchor-hash';
import type { CodeGraphFile, CodeGraphNode } from './types';

export type DriftSeverity = 'BLOCKER' | 'WARN' | 'INFO';

export interface DriftFinding {
  node_id: string;
  severity: DriftSeverity;
  code: 'anchor_file_missing' | 'anchor_symbol_missing' | 'core_anchor_changed' | 'signature_changed' | 'body_hash_changed';
  message: string;
}

export function evaluateCodeGraphDrift(
  projectRoot: string,
  graph: CodeGraphFile,
): DriftFinding[] {
  const findings: DriftFinding[] = [];

  for (const node of graph.nodes ?? []) {
    const anchor = node.anchor;
    if (!anchor?.file || !anchor.symbol) {
      findings.push({
        node_id: node.id,
        severity: 'BLOCKER',
        code: 'anchor_symbol_missing',
        message: `节点 ${node.id} 缺少 anchor.file 或 anchor.symbol`,
      });
      continue;
    }

    const abs = path.isAbsolute(anchor.file)
      ? anchor.file
      : path.join(projectRoot, anchor.file);
    if (!fs.existsSync(abs)) {
      findings.push({
        node_id: node.id,
        severity: 'BLOCKER',
        code: 'anchor_file_missing',
        message: `锚定文件不存在：${anchor.file}`,
      });
      continue;
    }

    const source = fs.readFileSync(abs, 'utf-8');
    if (!source.includes(anchor.symbol)) {
      findings.push({
        node_id: node.id,
        severity: 'BLOCKER',
        code: 'anchor_symbol_missing',
        message: `符号 ${anchor.symbol} 在 ${anchor.file} 中未找到`,
      });
      continue;
    }

    const currentHash = computeAnchorContentHash(projectRoot, anchor.file, anchor.symbol);
    if (!currentHash) continue;
    if (anchor.content_hash && currentHash !== anchor.content_hash) {
      const sev: DriftSeverity = node.core ? 'BLOCKER' : 'WARN';
      findings.push({
        node_id: node.id,
        severity: sev,
        code: node.core ? 'core_anchor_changed' : 'body_hash_changed',
        message: node.core
          ? `core 节点 ${node.id} 锚定 hash 已变化（需更新图谱并同步 UT）`
          : `节点 ${node.id} 函数体 hash 已变化，建议 regenerate/review`,
      });
    }
  }

  return findings;
}

export function graphHasCoreNodes(graph: CodeGraphFile): boolean {
  return (graph.nodes ?? []).some(n => n.core === true);
}

export function touchedCoreNodes(
  changedFiles: string[],
  graph: CodeGraphFile,
): CodeGraphNode[] {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const changed = new Set(changedFiles.map(norm));
  return (graph.nodes ?? []).filter(
    n => n.core && n.anchor?.file && changed.has(norm(n.anchor.file)),
  );
}
