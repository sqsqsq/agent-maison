// ============================================================================
// Module-graph 阶段脚本 Harness — check-module-graph.ts
// ============================================================================
// 全局 phase：扫描 catalog 模块，对已存在的 code-graph.yaml 做 schema + drift 校验。
// 零图谱 → PASS（提示用 /code-graph 建图）。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';

import { evaluateCodeGraphDrift, type DriftFinding } from '../code-graph/drift';
import type { CodeGraphFile, CodeGraphNode } from '../code-graph/types';
import { moduleGraphPath, relCatalog } from '../config';
import {
  PhaseChecker,
  CheckContext,
  CheckResult,
} from './utils/types';
import { loadCatalog, describeCatalogError } from './utils/catalog-parser';

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description?: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

function resolvePackagePath(layer: string, name: string): string {
  return `${layer}/${name}`.replace(/\\/g, '/');
}

function parseGraphFile(absPath: string, relPath: string): { graph: CodeGraphFile | null; error?: string } {
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

function validateSchema(graph: CodeGraphFile): string[] {
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

function driftToCheckResults(
  ctx: CheckContext,
  relPath: string,
  findings: DriftFinding[],
): CheckResult[] {
  const results: CheckResult[] = [];
  for (const f of findings) {
    let checkId: string;
    let severity: CheckResult['severity'];
    switch (f.code) {
      case 'anchor_file_missing':
        checkId = 'anchor_file_present';
        severity = 'BLOCKER';
        break;
      case 'anchor_symbol_missing':
        checkId = 'anchor_symbol_present';
        severity = 'BLOCKER';
        break;
      case 'core_anchor_changed':
        checkId = 'core_anchor_drift';
        severity = 'BLOCKER';
        break;
      case 'body_hash_changed':
        checkId = 'noncore_body_drift';
        severity = 'MINOR';
        break;
      default:
        checkId = f.code;
        severity = f.severity === 'BLOCKER' ? 'BLOCKER' : 'MINOR';
    }
    const section = 'traceability_checks';
    const status: CheckResult['status'] =
      checkId === 'noncore_body_drift' ? 'WARN' : severity === 'BLOCKER' ? 'FAIL' : 'WARN';
    results.push({
      id: checkId,
      category: 'traceability',
      description: ruleDesc(ctx, section, checkId),
      severity,
      status,
      details: `[${path.basename(relPath)} / ${f.node_id}] ${f.message}`,
      affected_files: [relPath],
      suggestion:
        f.code === 'body_hash_changed'
          ? '重跑 bootstrap:code-graph 刷新 derived，并人工复核 nodes 策展层。'
          : '更新 code-graph.yaml 锚点或恢复源码；core 节点变化须同步 UT。',
    });
  }
  return results;
}

const checker: PhaseChecker = {
  phase: 'module-graph',

  async check(ctx: CheckContext): Promise<CheckResult[]> {
    const catalogResult = loadCatalog(ctx.projectRoot);
    if (!catalogResult.ok) {
      return [{
        id: 'catalog_required',
        category: 'structure',
        description: 'module-graph 依赖 module catalog',
        severity: 'BLOCKER',
        status: 'FAIL',
        details: describeCatalogError(catalogResult.error),
        affected_files: [relCatalog(ctx.projectRoot)],
        suggestion: '先完成 catalog-bootstrap 或修复 doc/module-catalog.yaml。',
      }];
    }

    const graphPaths: Array<{ rel: string; abs: string; moduleName: string }> = [];
    for (const card of catalogResult.catalog.modules) {
      const pkg = resolvePackagePath(card.layer, card.name);
      const abs = moduleGraphPath(ctx.projectRoot, pkg);
      if (fs.existsSync(abs)) {
        graphPaths.push({
          rel: path.relative(ctx.projectRoot, abs).replace(/\\/g, '/'),
          abs,
          moduleName: card.name,
        });
      }
    }

    if (graphPaths.length === 0) {
      return [{
        id: 'no_module_graphs',
        category: 'structure',
        description: '零图谱（尚未建任何 code-graph.yaml）',
        severity: 'MINOR',
        status: 'PASS',
        details:
          'catalog 中尚无模块落盘 code-graph.yaml。可用 `/code-graph <ModuleName>` 或 code-graph Skill 逐模块建图。',
        suggestion: 'cd framework/harness && npm run bootstrap:code-graph -- --project-root <宿主根> --module <名> --seed-from-catalog',
      }];
    }

    const results: CheckResult[] = [];

    for (const { rel, abs, moduleName } of graphPaths) {
      const { graph, error } = parseGraphFile(abs, rel);
      if (!graph) {
        results.push({
          id: 'code_graph_schema_valid',
          category: 'structure',
          description: ruleDesc(ctx, 'structure_checks', 'code_graph_schema_valid'),
          severity: 'BLOCKER',
          status: 'FAIL',
          details: error ?? `${rel} 无效`,
          affected_files: [rel],
        });
        continue;
      }

      const schemaErrors = validateSchema(graph);
      if (schemaErrors.length > 0) {
        results.push({
          id: 'code_graph_schema_valid',
          category: 'structure',
          description: ruleDesc(ctx, 'structure_checks', 'code_graph_schema_valid'),
          severity: 'BLOCKER',
          status: 'FAIL',
          details: `模块 ${moduleName}（${rel}）：${schemaErrors.join('；')}`,
          affected_files: [rel],
        });
        continue;
      }

      results.push({
        id: 'code_graph_schema_valid',
        category: 'structure',
        description: ruleDesc(ctx, 'structure_checks', 'code_graph_schema_valid'),
        severity: 'BLOCKER',
        status: 'PASS',
        details: `模块 ${moduleName} schema 合规（nodes: ${graph.nodes.length}）`,
        affected_files: [rel],
      });

      const findings = evaluateCodeGraphDrift(ctx.projectRoot, graph);
      results.push(...driftToCheckResults(ctx, rel, findings));
    }

    return results;
  },
};

export default checker;
