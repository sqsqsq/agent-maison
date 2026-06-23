// ============================================================================
// visual-structure-parity.ts — 结构序匹配（经 visual-parity.yaml 映射，非 taxonomy↔struct 直比）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { UiSpecComponentNode, UiSpecDoc, UiSpecScreen } from '../../../harness/scripts/utils/ui-spec-shared';
import { walkComponentNodes, visualParityAbsPath } from '../../../harness/scripts/utils/ui-spec-shared';
import { sequenceMatchRatio } from './source-ref-scan';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown; stringify: (v: unknown) => string };

export interface VisualParityMappings {
  components?: Array<{ ui_spec_node_id?: string; contract_component?: string }>;
}

interface VisualParityYamlRoot {
  mappings?: VisualParityMappings;
  components?: Array<{ ui_spec_node_id?: string; contract_component?: string }>;
}

export function loadVisualParityMappings(projectRoot: string, feature: string): VisualParityMappings | null {
  const abs = visualParityAbsPath(projectRoot, feature);
  if (!fs.existsSync(abs)) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(abs, 'utf-8')) as VisualParityYamlRoot;
    if (doc?.mappings && typeof doc.mappings === 'object') {
      return doc.mappings;
    }
    if (Array.isArray(doc?.components)) {
      return { components: doc.components };
    }
    return null;
  } catch {
    return null;
  }
}

/** 单屏：按 ui-spec 遍历序收集 mapped contract_component（经 visual-parity components） */
export function mappedComponentSequenceForScreen(
  screen: UiSpecScreen,
  mappings: VisualParityMappings | null,
): string[] {
  if (!mappings?.components?.length || !screen.root) return [];
  const byNodeId = new Map<string, string>();
  for (const m of mappings.components) {
    if (m.ui_spec_node_id && m.contract_component) {
      byNodeId.set(m.ui_spec_node_id, m.contract_component);
    }
  }
  const out: string[] = [];
  const seenIds = new Set<string>();
  if (byNodeId.has(screen.id)) {
    out.push(byNodeId.get(screen.id)!);
    seenIds.add(screen.id);
  }
  const nodes: UiSpecComponentNode[] = [];
  walkComponentNodes(screen.root, nodes);
  const sorted = [...nodes].sort((a, b) => a.order - b.order);
  for (const n of sorted) {
    if (n.id && byNodeId.has(n.id) && !seenIds.has(n.id)) {
      out.push(byNodeId.get(n.id)!);
      seenIds.add(n.id);
    }
  }
  return out;
}

/** 单屏「应被映射」的节点数：screen 自身 + 所有非容器子节点（含未写 id 的；同 id 只计一次） */
export function countMappableNodes(screen: UiSpecScreen): number {
  if (!screen.root) return 0;
  const nodes: UiSpecComponentNode[] = [];
  walkComponentNodes(screen.root, nodes);
  const leafLike = nodes.filter(n => n.type !== 'navigation_frame');
  const seenIds = new Set<string>();
  let count = 0;
  for (const n of leafLike) {
    if (n.id) {
      if (seenIds.has(n.id)) continue;
      seenIds.add(n.id);
    }
    count++;
  }
  return 1 /* screen 本身 */ + count;
}

/**
 * 单屏 visual-parity components 映射覆盖率（已映射节点 / 应映射节点）。
 * 子节点未写可选 id 时无法映射 → 计入分母但不计入分子，从而暴露「漏映射」。
 */
export function mappingCoverageForScreen(
  screen: UiSpecScreen,
  mappings: VisualParityMappings | null,
): { mapped: number; mappable: number } {
  const mappable = countMappableNodes(screen);
  if (!mappings?.components?.length || mappable === 0) return { mapped: 0, mappable };
  const byNodeId = new Map<string, string>();
  for (const m of mappings.components) {
    if (m.ui_spec_node_id && m.contract_component) byNodeId.set(m.ui_spec_node_id, m.contract_component);
  }
  const seenIds = new Set<string>();
  let mapped = 0;
  if (byNodeId.has(screen.id)) {
    mapped++;
    seenIds.add(screen.id);
  }
  const nodes: UiSpecComponentNode[] = [];
  walkComponentNodes(screen.root, nodes);
  for (const n of nodes) {
    if (n.type === 'navigation_frame') continue;
    if (n.id && byNodeId.has(n.id) && !seenIds.has(n.id)) {
      mapped++;
      seenIds.add(n.id);
    }
  }
  return { mapped, mappable };
}

// 阈值：序匹配 LCS 与映射覆盖率均须达标，整屏方记通过。
const STRUCT_LCS_THRESHOLD = 0.6;
const STRUCT_COVERAGE_THRESHOLD = 0.6;

/**
 * 结构序得分：mapped contract_component 序 vs 源码 struct 出现序（LCS），
 * 并叠加「映射覆盖率」防止只映射根节点 / 漏映射无 id 子节点就虚报 100%。
 * 无 visual-parity 映射时返回 null（调用方应 WARN/skip 结构分，禁止 taxonomy↔struct 直比）。
 */
export function computeStructureSequenceScore(
  doc: UiSpecDoc,
  mappings: VisualParityMappings | null,
  sourceStructNames: Set<string>,
): { ratio: number; screens: number; detail: string[] } | null {
  if (!mappings?.components?.length) return null;
  const structList = [...sourceStructNames];
  const details: string[] = [];
  let total = 0;
  let pass = 0;
  for (const s of doc.screens ?? []) {
    if (!s.root || s.lightweight) continue;
    total++;
    const mapped = mappedComponentSequenceForScreen(s, mappings);
    if (mapped.length === 0) {
      details.push(`screen ${s.id}：无 components 映射，结构分记 0`);
      continue;
    }
    const lcs = sequenceMatchRatio(
      mapped.map(x => x.toLowerCase()),
      structList.map(x => x.toLowerCase()),
    );
    const cov = mappingCoverageForScreen(s, mappings);
    const coverage = cov.mappable > 0 ? cov.mapped / cov.mappable : 0;
    if (lcs >= STRUCT_LCS_THRESHOLD && coverage >= STRUCT_COVERAGE_THRESHOLD) {
      pass++;
    } else {
      details.push(
        `screen ${s.id} LCS=${(lcs * 100).toFixed(0)}% 覆盖=${cov.mapped}/${cov.mappable}` +
          `（阈值 LCS≥${STRUCT_LCS_THRESHOLD * 100}% 且 覆盖≥${STRUCT_COVERAGE_THRESHOLD * 100}%）(${mapped.join('>')})`,
      );
    }
  }
  if (total === 0) return null;
  return { ratio: pass / total, screens: total, detail: details };
}

export function writeUiSpecYaml(absPath: string, doc: UiSpecDoc): void {
  fs.writeFileSync(absPath, YAML.stringify(doc), 'utf-8');
}
