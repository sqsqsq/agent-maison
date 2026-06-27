// ============================================================================
// visual-parity-backstop.ts — C2 语义色绑定 + C3 must_have_elements presence
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext } from '../../../harness/scripts/utils/types';
import { isPixel1to1 } from '../../../harness/scripts/utils/fidelity-shared';
import {
  collectAllComponentNodes,
  flattenResourceKeyEntries,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';
import {
  extractStructBody,
  resourceKeyToRef,
  scanFeatureSourceTree,
  scanStructResourceRefs,
} from './source-ref-scan';
import { loadVisualParityMappings } from './visual-structure-parity';

export interface BackstopIssue {
  kind: 'semantic_color' | 'must_have' | 'variant';
  id: string;
  detail: string;
}

function colorTokenDefined(
  projectRoot: string,
  tokenKey: string,
  contracts: CheckContext['featureSpec']['contracts'],
): boolean {
  const rkList = flattenResourceKeyEntries(contracts?.resource_keys);
  const rk = rkList.find(r =>
    r.key?.includes(tokenKey.replace(/\./g, '_')) || r.key === tokenKey,
  );
  if (rk?.path) {
    const abs = path.resolve(projectRoot, rk.path);
    if (fs.existsSync(abs)) return true;
  }
  for (const mod of contracts?.modules ?? []) {
    const base = path.join(projectRoot, mod.package_path, 'src', 'main', 'resources');
    if (!fs.existsSync(base)) continue;
    const found = walkColorJson(base, tokenKey);
    if (found) return true;
  }
  return false;
}

function walkColorJson(dir: string, tokenKey: string): boolean {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (walkColorJson(full, tokenKey)) return true;
    } else if (ent.name === 'color.json') {
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;
        const snake = tokenKey.replace(/\./g, '_');
        if (Array.isArray(data.color)) {
          for (const item of data.color as Array<{ name?: string }>) {
            if (item.name === snake || item.name === tokenKey) return true;
          }
        } else {
          const colors = (data.color ?? data) as Record<string, unknown>;
          if (colors[snake] || colors[tokenKey]) return true;
        }
      } catch { /* skip */ }
    }
  }
  return false;
}

function structReferencesColorToken(
  ctx: CheckContext,
  structName: string,
  tokenKey: string,
): boolean {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return false;
  const structRefs = scanStructResourceRefs(ctx.projectRoot, contracts, structName);
  const colorRef = resourceKeyToRef(tokenKey, 'color');
  const snakeRef = resourceKeyToRef(tokenKey.replace(/\./g, '_'), 'color');
  return structRefs.has(colorRef) || structRefs.has(snakeRef);
}

function resolveMappedStruct(
  nodeId: string | undefined,
  mappings: ReturnType<typeof loadVisualParityMappings>,
): string | null {
  if (!nodeId || !mappings?.components?.length) return null;
  const hit = mappings.components.find(m => m.ui_spec_node_id === nodeId);
  return hit?.contract_component?.trim() ?? null;
}

function stringResourceContains(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
  needle: string,
): boolean {
  const values = new Set<string>();
  for (const mod of contracts.modules ?? []) {
    const base = path.join(projectRoot, mod.package_path, 'src', 'main', 'resources');
    walkStringJson(base, values);
  }
  if (values.has(needle)) return true;
  const lower = needle.toLowerCase();
  for (const v of values) {
    if (v.toLowerCase().includes(lower) || lower.includes(v.toLowerCase())) return true;
  }
  return false;
}

function walkStringJson(dir: string, out: Set<string>): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkStringJson(full, out);
    else if (ent.name === 'string.json') {
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;
        const inner = (data.string ?? data) as Record<string, unknown>;
        for (const v of Object.values(inner)) {
          if (typeof v === 'string') out.add(v);
        }
      } catch { /* skip */ }
    }
  }
}

function sourceContainsIdentifier(
  sourceScan: ReturnType<typeof scanFeatureSourceTree>,
  elementId: string,
): boolean {
  if (!sourceScan) return false;
  const lower = elementId.toLowerCase();
  for (const name of sourceScan.structNames) {
    if (name.toLowerCase().includes(lower)) return true;
  }
  for (const ref of sourceScan.resourceRefs) {
    if (ref.toLowerCase().includes(lower.replace(/_/g, ''))) return true;
  }
  return false;
}

/** C2：节点→token 语义色绑定（经 visual-parity 映射定位 struct 文件） */
export function collectSemanticColorBindingIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified) return [];
  const contracts = ctx.featureSpec.contracts;
  const mappings = loadVisualParityMappings(ctx.projectRoot, ctx.feature);
  const pixel1to1 = isPixel1to1(ctx);
  const issues: BackstopIssue[] = [];

  for (const n of collectAllComponentNodes(doc)) {
    const tokenKey = n.color_ref?.trim();
    if (!tokenKey && !n.semantic_role) continue;
    const effectiveToken = tokenKey ?? `semantic.${n.semantic_role}`;
    const nodeLabel = n.id ?? n.type;

    if (!colorTokenDefined(ctx.projectRoot, effectiveToken, contracts)) {
      issues.push({
        kind: 'semantic_color',
        id: nodeLabel,
        detail: `节点 ${nodeLabel} color_ref=${effectiveToken} 未在 color 资源定义`,
      });
      continue;
    }

    const structName = resolveMappedStruct(n.id, mappings);
    if (pixel1to1) {
      if (!n.id) {
        issues.push({
          kind: 'semantic_color',
          id: nodeLabel,
          detail: `节点 ${nodeLabel} 缺 id，pixel_1to1 下无法做 visual-parity 组件级 token 绑定`,
        });
        continue;
      }
      if (!structName) {
        issues.push({
          kind: 'semantic_color',
          id: nodeLabel,
          detail: `节点 ${n.id} 缺 visual-parity.yaml 映射，pixel_1to1 须 ui_spec_node_id→contract_component 才能校验 token 绑定`,
        });
        continue;
      }
      if (!structReferencesColorToken(ctx, structName, effectiveToken)) {
        issues.push({
          kind: 'semantic_color',
          id: nodeLabel,
          detail: `节点 ${n.id}→${structName} 未引用 $r('${resourceKeyToRef(effectiveToken, 'color')}')（须组件级绑定，非 feature 全局）`,
        });
      }
      continue;
    }

    if (structName) {
      if (!structReferencesColorToken(ctx, structName, effectiveToken)) {
        issues.push({
          kind: 'semantic_color',
          id: nodeLabel,
          detail: `节点 ${n.id}→${structName} 未引用 $r('${resourceKeyToRef(effectiveToken, 'color')}')`,
        });
      }
    } else if (contracts) {
      const sourceScan = scanFeatureSourceTree(ctx.projectRoot, contracts);
      const colorRef = resourceKeyToRef(effectiveToken, 'color');
      const snakeRef = resourceKeyToRef(effectiveToken.replace(/\./g, '_'), 'color');
      if (!sourceScan.resourceRefs.has(colorRef) && !sourceScan.resourceRefs.has(snakeRef)) {
        issues.push({
          kind: 'semantic_color',
          id: nodeLabel,
          detail: `节点 ${nodeLabel} 须源码引用 $r('${colorRef}')（semantic_layout 为 feature 级 presence）`,
        });
      }
    }
  }
  return issues;
}

/** C3：屏级 must_have_elements presence（无 placeholder 豁免） */
export function collectMustHavePresenceIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified) return [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const sourceScan = scanFeatureSourceTree(ctx.projectRoot, contracts);
  const issues: BackstopIssue[] = [];

  for (const s of doc.screens ?? []) {
    for (const el of s.must_have_elements ?? []) {
      const inTree = collectAllComponentNodes({ screens: [s], tokens: {}, assets: [] } as UiSpecDoc)
        .some(n => n.id === el || n.type === el);
      const inSource = sourceContainsIdentifier(sourceScan, el);
      const inStrings = stringResourceContains(ctx.projectRoot, contracts, el.replace(/_/g, ' '));
      if (!inTree && !inSource && !inStrings) {
        issues.push({
          kind: 'must_have',
          id: el,
          detail: `screen ${s.id} must_have ${el} 未在组件树/源码/string 命中`,
        });
      }
    }
  }
  return issues;
}

export function runVisualParityBackstop(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  return [
    ...collectSemanticColorBindingIssues(ctx, doc, baselineUnverified),
    ...collectMustHavePresenceIssues(ctx, doc, baselineUnverified),
  ];
}

const NON_FILL_VARIANTS = new Set(['ghost', 'text', 'outlined']);

/** Button 体内是否含显式非透明 backgroundColor（实心填充） */
export function hasSolidButtonBackground(structBody: string): boolean {
  const re = /\.backgroundColor\s*\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(structBody))) {
    const arg = m[1].trim();
    if (!arg) continue;
    if (/transparent/i.test(arg)) continue; // Color.Transparent / 'transparent'
    if (/0x00[0-9a-fA-F]{6}\b/.test(arg)) continue; // 全透明 alpha
    return true;
  }
  return false;
}

/**
 * G3 Slice 3 静态轻启发式（保守 WARN，低置信，以 device visual-diff 为准）：
 * 非填充 variant（ghost/text/outlined）的按钮，若映射 struct 仅含单个 Button 且该 Button 有
 * 显式非透明 backgroundColor → 疑似被实心化（homepage：声明药丸/幽灵却填实心蓝）。
 * 仅单 Button struct 才判（多 Button 无法定位本节点），最大限度压假阳性。
 */
export function collectVariantParityIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified) return [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const mappings = loadVisualParityMappings(ctx.projectRoot, ctx.feature);
  const scan = scanFeatureSourceTree(ctx.projectRoot, contracts);
  const issues: BackstopIssue[] = [];

  for (const n of collectAllComponentNodes(doc)) {
    if (n.type !== 'action_button') continue;
    const variant = n.variant?.trim();
    if (!variant || !NON_FILL_VARIANTS.has(variant)) continue;
    const structName = resolveMappedStruct(n.id, mappings);
    if (!structName) continue;
    let body: string | null = null;
    for (const file of scan.etsFiles) {
      body = extractStructBody(fs.readFileSync(file, 'utf-8'), structName);
      if (body) break;
    }
    if (!body) continue;
    const buttonCount = (body.match(/\bButton\s*\(/g) ?? []).length;
    if (buttonCount !== 1) continue; // 保守：仅单 Button struct 可定位
    if (hasSolidButtonBackground(body)) {
      issues.push({
        kind: 'variant',
        id: n.id ?? n.type,
        detail: `节点 ${n.id ?? n.type} 声明 variant=${variant}（非填充）但 ${structName} 的 Button 含实心 backgroundColor（疑似实心化，以 device visual-diff 为准）`,
      });
    }
  }
  return issues;
}
