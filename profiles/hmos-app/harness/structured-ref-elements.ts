// ============================================================================
// structured-ref-elements.ts — 第二刀：结构化源 → ref-elements.yaml 分母（profile）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import {
  loadRefElementsFile,
  refElementsAbsPath,
  refElementsRelPath,
  type RefElementEntry,
  fidelityRatchetFailOrWarn,
} from '../../../harness/scripts/utils/fidelity-shared';
import {
  collectUiSpecScreenRefIds,
  fidelityCacheAbsPath,
  loadFidelityLock,
} from '../../../harness/scripts/utils/fidelity-lock-shared';
import {
  collectAllComponentNodes,
  loadUiSpecFile,
  uiSpecAbsPath,
} from '../../../harness/scripts/utils/ui-spec-shared';

const requireHarness = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

export interface StructuredElementsBundle {
  schema_version?: string;
  /** Figma/门户 node 名 → ui-spec 语义 element_id */
  node_to_semantic_id?: Record<string, string>;
  elements: Array<{
    element_id?: string;
    source_node_ref?: string;
    screen_ref_id?: string;
    zone?: string;
    type?: string;
    text?: string;
    semantic_role?: string;
    color_ref?: string;
    disposition?: 'implement' | 'defer';
  }>;
}

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.structured_ref_elements?.description?.trim() ?? 'structured_ref_elements';
}

function loadStructuredBundle(absPath: string): StructuredElementsBundle | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    const raw = YAML.parse(fs.readFileSync(absPath, 'utf-8')) as StructuredElementsBundle;
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.elements)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** 归一化 element_id 到 ui-spec 语义命名空间 */
export function normalizeStructuredElementId(
  raw: StructuredElementsBundle['elements'][number],
  nodeMap: Record<string, string>,
  uiSpecIds: Set<string>,
): { id: string | null; unmapped: boolean } {
  if (typeof raw.element_id === 'string' && raw.element_id.trim()) {
    const id = raw.element_id.trim();
    if (uiSpecIds.has(id) || uiSpecIds.has(id.toLowerCase())) {
      return { id, unmapped: false };
    }
  }
  const nodeRef = raw.source_node_ref?.trim();
  if (nodeRef && nodeMap[nodeRef]) {
    return { id: nodeMap[nodeRef], unmapped: false };
  }
  if (nodeRef && uiSpecIds.has(nodeRef)) {
    return { id: nodeRef, unmapped: false };
  }
  return { id: null, unmapped: true };
}

export function deriveStructuredRefElements(
  bundle: StructuredElementsBundle,
  uiSpecIds: Set<string>,
): RefElementEntry[] {
  const nodeMap = bundle.node_to_semantic_id ?? {};
  const out: RefElementEntry[] = [];
  for (const raw of bundle.elements) {
    const { id, unmapped } = normalizeStructuredElementId(raw, nodeMap, uiSpecIds);
    if (!id || unmapped) continue;
    out.push({
      element_id: id,
      ...(raw.screen_ref_id ? { screen_ref_id: raw.screen_ref_id } : {}),
      ...(raw.zone ? { zone: raw.zone } : {}),
      ...(raw.type ? { type: raw.type } : {}),
      ...(raw.text ? { text: raw.text } : {}),
      ...(raw.semantic_role ? { semantic_role: raw.semantic_role } : {}),
      ...(raw.color_ref ? { color_ref: raw.color_ref } : {}),
      disposition: raw.disposition === 'defer' ? 'defer' : 'implement',
      provenance: 'structured',
    });
  }
  return out;
}

/** VL 条目只增补不覆盖 structured 基线 */
export function mergeRefElementsStructuredBaseline(
  existing: RefElementEntry[],
  structured: RefElementEntry[],
): RefElementEntry[] {
  const byId = new Map<string, RefElementEntry>();
  for (const s of structured) {
    byId.set(s.element_id.toLowerCase(), s);
  }
  for (const e of existing) {
    const key = e.element_id.toLowerCase();
    if (byId.has(key)) continue;
    byId.set(key, { ...e, provenance: e.provenance ?? 'vl' });
  }
  return [...byId.values()];
}

export function checkStructuredRefElements(ctx: CheckContext, _specMd: string): CheckResult[] {
  const cacheDir = fidelityCacheAbsPath(ctx.projectRoot, ctx.feature);
  const lockPath = path.join(cacheDir, 'fidelity.lock.yaml');
  const { doc: lock } = loadFidelityLock(lockPath);
  if (!lock?.structured_bundle) {
    return [];
  }

  const bundlePath = path.isAbsolute(lock.structured_bundle)
    ? lock.structured_bundle
    : path.resolve(cacheDir, lock.structured_bundle);
  const bundle = loadStructuredBundle(bundlePath);
  const refRel = refElementsRelPath(ctx.projectRoot, ctx.feature);
  const desc = ruleDesc(ctx);

  if (!bundle) {
    return [{
      id: 'structured_ref_elements',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: `lock.structured_bundle 不可解析：${lock.structured_bundle}`,
      affected_files: [refRel],
    }];
  }

  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  const uiNodes = uiDoc ? collectAllComponentNodes(uiDoc) : [];
  const uiSpecIds = new Set(
    uiNodes.map(n => n.id).filter((id): id is string => Boolean(id)).map(id => id.toLowerCase()),
  );
  for (const sid of collectUiSpecScreenRefIds(ctx.projectRoot, ctx.feature)) {
    uiSpecIds.add(sid.toLowerCase());
  }

  const structured = deriveStructuredRefElements(bundle, uiSpecIds);
  const unmappedCount = bundle.elements.length - structured.length;

  const refAbs = refElementsAbsPath(ctx.projectRoot, ctx.feature);
  const existingDoc = loadRefElementsFile(refAbs);
  const merged = mergeRefElementsStructuredBaseline(existingDoc?.elements ?? [], structured);

  if (structured.length === 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    return [{
      id: 'structured_ref_elements',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `结构化 bundle ${bundle.elements.length} 项均无法归一化到 ui-spec 语义 id（须 node_to_semantic_id 映射）`,
      suggestion: '建立 figma-node→语义 id 映射；无法归一者不计入 capture-completeness 分母',
      affected_files: [refRel],
    }];
  }

  ctx.refElementsManifest = merged;
  ctx.refElementsManifestDetail = [
    `structured 派生 ${structured.length} 项`,
    unmappedCount > 0 ? `${unmappedCount} 项未映射（不计入分母）` : '',
    existingDoc?.elements?.length ? `VL 磁盘增补 ${existingDoc.elements.length} 项（structured 优先）` : '',
  ].filter(Boolean).join('；');

  const soft = unmappedCount > 0 && ctx.fidelityTarget !== 'pixel_1to1';
  const { severity, status } = fidelityRatchetFailOrWarn(ctx, soft);

  return [{
    id: 'structured_ref_elements',
    category: 'structure',
    description: desc,
    severity: unmappedCount > 0 && ctx.fidelityTarget === 'pixel_1to1' ? severity : 'MINOR',
    status: unmappedCount > 0 && ctx.fidelityTarget === 'pixel_1to1' ? status : 'PASS',
    details: [
      `结构化派生 ${structured.length} 项注入内存 manifest（capture-completeness 同 run 消费，不写盘）`,
      unmappedCount > 0 ? `${unmappedCount} 项未映射（不计入分母）` : '',
      lock.screens.length ? `lock 屏=${lock.screens.map(s => s.id).join(',')}` : '',
    ].filter(Boolean).join('；'),
    affected_files: [refRel, path.relative(ctx.projectRoot, bundlePath).replace(/\\/g, '/')],
  }];
}
