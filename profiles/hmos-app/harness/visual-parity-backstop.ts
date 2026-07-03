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
  walkComponentNodes,
  type UiSpecComponentNode,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';
import {
  extractStructBody,
  resourceKeyToRef,
  scanFeatureSourceTree,
  scanResourceRefModules,
  scanStructResourceRefs,
} from './source-ref-scan';
import { loadVisualParityMappings } from './visual-structure-parity';
import { collectP0VisualTargetIds } from './visual-diff-targets';
import { hexToLab, readImageDimensions } from './image-toolkit';
import { isHumanConfirmed } from '../../../harness/scripts/utils/fidelity-shared';
import { ocrImageWords, isOcrAvailable, fuzzyTextPresent } from './ocr-toolkit';

export interface BackstopIssue {
  kind: 'semantic_color' | 'must_have' | 'variant' | 'render' | 'asset' | 'visible_text' | 'invisible_presence';
  id: string;
  detail: string;
  /**
   * asset 子角色（供调用方分级 ratchet）：
   * not_rendered=声明 asset_ref 却未真实 $r 渲染（pixel_1to1 可升 BLOCKER）；
   * not_rendered_placeholder=同上但显式 placeholder（豁免、仍 WARN）；
   * icon_kind=icon 未标 kind（仅补全建议）；
   * placeholder_file=已 $r 引用但模块 media 为退化占位（B 承重门禁）；
   * baked_text=素材图烤入 ui-spec 声明文本（整段大图，round5 P0-A，pixel_1to1 BLOCKER）；
   * icon_substitution=声明 required 图标 asset 却用 sys.symbol 替代（round5 P0-B，pixel_1to1 BLOCKER）。
   */
  assetRole?:
    | 'not_rendered'
    | 'not_rendered_placeholder'
    | 'icon_kind'
    | 'placeholder_file'
    | 'baked_text'
    | 'icon_substitution';
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

// ============================================================================
// v3 渲染忠实度：声明约束（width_ratio/align 几何 + tonal 填充）vs 源码渲染。
// coding 阶段无截图 → 解析源码 token/几何（非图像采样）；低置信 WARN，以 device visual-diff 为准。
// ============================================================================

/** width_ratio ≤ 此值视为「内联/部分宽」声明，源码显式全宽即偏离 */
const RENDER_PARTIAL_WIDTH_MAX = 0.6;

/** 节点几何是否声明为「内联/部分宽」（width_ratio 偏小 或 align start/end）——主信号含 align */
export function isInlineGeometry(widthRatio: number | undefined, align: string | undefined): boolean {
  if (typeof widthRatio === 'number' && widthRatio <= RENDER_PARTIAL_WIDTH_MAX) return true;
  const a = align?.trim();
  return a === 'start' || a === 'end';
}
/** tonal 填充被判「实心化」的色度/暗度门槛：高色度 + 偏暗 = 高饱和实心而非浅 tonal */
const TONAL_SOLID_MIN_CHROMA = 30;
const TONAL_SOLID_MAX_L = 75;

/** hex 是否「高饱和实心」（高色度 + 偏暗）——tonal 声明却命中此则疑似被实心化 */
export function isSaturatedSolidFill(hex: string): boolean {
  try {
    const lab = hexToLab(hex);
    const chroma = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
    return chroma >= TONAL_SOLID_MIN_CHROMA && lab.L <= TONAL_SOLID_MAX_L;
  } catch {
    return false;
  }
}

function readColorKeyHexFromDir(dir: string, snake: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      const nested = readColorKeyHexFromDir(full, snake);
      if (nested) return nested;
    } else if (ent.name === 'color.json') {
      try {
        const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as Record<string, unknown>;
        if (Array.isArray(data.color)) {
          const hit = (data.color as Array<{ name?: string; value?: string }>).find(c => c.name === snake);
          if (hit?.value && String(hit.value).startsWith('#')) return String(hit.value);
        } else {
          const colors = (data.color ?? data) as Record<string, unknown>;
          const entry = colors[snake];
          if (typeof entry === 'string' && entry.startsWith('#')) return entry;
          if (entry && typeof entry === 'object' && 'value' in (entry as object)) {
            const v = String((entry as { value: unknown }).value);
            if (v.startsWith('#')) return v;
          }
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

function readColorKeyHex(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
  snakeKey: string,
): string | null {
  for (const mod of contracts.modules ?? []) {
    const base = path.join(projectRoot, mod.package_path, 'src', 'main', 'resources');
    const hex = readColorKeyHexFromDir(base, snakeKey);
    if (hex) return hex;
  }
  return null;
}

/**
 * 解析 Button.backgroundColor 实参为结构化结果（不做 fs 解析）：
 * token($r('app.color.X')) / hex 字面('#..') / 0xAARRGGBB。
 * 外层正则须**完整吞掉 $r(...)（含其闭括号）**，否则 token 路径会被首个 ) 截断 → 内层匹配恒 null
 * （$r('app.color.x') 是 ArkUI/本框架 C2 强制的标准写法，旧 [^)]* 写法使 token 路径全哑）。
 */
export function parseButtonBgArg(btnBody: string): { token: string } | { hex: string } | null {
  const m = /\.backgroundColor\s*\(\s*(\$r\(\s*['"][^'"]+['"]\s*\)|['"]#[0-9a-fA-F]{6,8}['"]|0x[0-9a-fA-F]{6,8})/.exec(btnBody);
  if (!m) return null;
  const arg = m[1].trim();
  const rk = /\$r\(\s*['"]app\.color\.([A-Za-z0-9_]+)['"]\s*\)/.exec(arg);
  if (rk) return { token: rk[1] };
  const lit = /['"](#[0-9a-fA-F]{6,8})['"]/.exec(arg);
  if (lit) return { hex: lit[1] };
  const ox = /0x([0-9a-fA-F]{6,8})/.exec(arg);
  if (ox) return { hex: ox[1].length === 8 ? `#${ox[1].slice(2)}` : `#${ox[1]}` };
  return null;
}

/** 从 Button 体解析 .backgroundColor(...) → hex（token 经 color.json 解析，hex 字面直返），解析不到返回 null */
export function resolveButtonBgHex(
  btnBody: string,
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
): string | null {
  const parsed = parseButtonBgArg(btnBody);
  if (!parsed) return null;
  if ('hex' in parsed) return parsed.hex;
  return readColorKeyHex(projectRoot, contracts, parsed.token);
}

/** 多 Button struct：按节点文案定位对应 Button 段；单 Button 直接返回；定位不到返回 null（保守） */
export function locateButtonBody(structBody: string, copy: string | undefined): string | null {
  const segs = structBody.split(/(?=\bButton\s*\()/g).filter(s => /\bButton\s*\(/.test(s));
  if (segs.length === 0) return null;
  if (segs.length === 1) return segs[0];
  if (!copy || !copy.trim()) return null;
  return segs.find(s => s.includes(copy)) ?? null;
}

/** Button 体是否显式全宽（.width('100%') 或 layoutWeight(1)） */
export function isExplicitFullWidth(btnBody: string): boolean {
  if (/\.width\s*\(\s*['"]100%['"]\s*\)/.test(btnBody)) return true;
  if (/\.layoutWeight\s*\(\s*1\b/.test(btnBody)) return true;
  return false;
}

function p0ScreenIdSet(doc: UiSpecDoc): Set<string> {
  return new Set(collectP0VisualTargetIds(doc).map(id => id.split('__overlay__')[0]));
}

/**
 * v3：P0 屏内 action_button 的渲染是否忠实于 spec 已声明的几何/填充。
 * 主信号 width_ratio/align：声明内联(≤0.6) 却源码显式全宽 → 命中；
 * 辅信号 tonal 填充：variant=tonal 却解析到高色度+偏暗 backgroundColor（高饱和实心而非浅 tonal）→ 命中。
 * 低置信 WARN：定位不到 Button / 解析不到色值 → 保守跳过，以 device visual-diff 为准。
 */
export function collectRenderFaithfulnessIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified) return [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const mappings = loadVisualParityMappings(ctx.projectRoot, ctx.feature);
  const scan = scanFeatureSourceTree(ctx.projectRoot, contracts);
  const p0 = p0ScreenIdSet(doc);
  const issues: BackstopIssue[] = [];

  for (const s of doc.screens ?? []) {
    if (!s.root) continue;
    const isP0 = p0.has(s.id) || (s.ref_id ? p0.has(s.ref_id) : false);
    if (!isP0) continue;
    const nodes: UiSpecComponentNode[] = [];
    walkComponentNodes(s.root, nodes);
    for (const n of nodes) {
      if (n.type !== 'action_button') continue;
      const structName = resolveMappedStruct(n.id, mappings);
      if (!structName) continue;
      let body: string | null = null;
      for (const file of scan.etsFiles) {
        body = extractStructBody(fs.readFileSync(file, 'utf-8'), structName);
        if (body) break;
      }
      if (!body) continue;
      const btnBody = locateButtonBody(body, n.text);
      if (!btnBody) continue;
      const label = n.id ?? n.type;

      const wr = typeof n.width_ratio === 'number' ? n.width_ratio : undefined;
      const align = n.align?.trim();
      if (isInlineGeometry(wr, align) && isExplicitFullWidth(btnBody)) {
        const decl = wr !== undefined && wr <= RENDER_PARTIAL_WIDTH_MAX ? `width_ratio=${wr}` : `align=${align}`;
        issues.push({
          kind: 'render',
          id: label,
          detail: `节点 ${label} 声明 ${decl}（内联）但 ${structName} 的 Button 显式全宽（.width('100%')/layoutWeight）— 疑似未按占宽/对齐渲染（以 device visual-diff 为准）`,
        });
      }

      if (n.variant === 'tonal') {
        const bgHex = resolveButtonBgHex(btnBody, ctx.projectRoot, contracts);
        if (bgHex && isSaturatedSolidFill(bgHex)) {
          issues.push({
            kind: 'render',
            id: label,
            detail: `节点 ${label} variant=tonal（浅色调）但 ${structName} 的 Button backgroundColor=${bgHex} 为高饱和实心 — 疑似被实心化（以 device visual-diff 为准）`,
          });
        }
      }
    }
  }
  return issues;
}

// ============================================================================
// s1 asset 真渲染校验：节点声明 asset_ref → 映射 struct/源码是否真 $r('media.<key>') 引用
// （区别于 must_have presence；catches #6 tab 声明图标却仅渲染文字）。不推 symbol/矢量（D10）。
// ============================================================================

/** 节点 asset key 对应的 media 引用是否在 refs 集合中（含 snake 兼容） */
export function assetRenderedInRefs(key: string, refs: Set<string>): boolean {
  const mediaRef = resourceKeyToRef(key, 'media');
  const altRef = resourceKeyToRef(key.replace(/\./g, '_'), 'media');
  return refs.has(mediaRef) || refs.has(altRef);
}

/** icon 声明了但未标 kind（分类未补全）；不强制 symbol/矢量（D10），仅提示补全 kind */
export function isUnclassifiedIcon(icon: { kind?: string } | undefined): boolean {
  return Boolean(icon) && !icon?.kind?.trim();
}

/**
 * s1：声明 asset_ref（或 icon.ref）的节点，其映射 struct（或 feature 源码）是否真 $r 引用该 media。
 * 声明却未引用 → WARN（如 #6：tab 节点带 asset_ref 但 struct 仅渲染文字）。动态渲染可能漏判 → 低置信。
 */
export function collectAssetRenderIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified) return [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const mappings = loadVisualParityMappings(ctx.projectRoot, ctx.feature);
  // 显式 placeholder 资产豁免硬 ratchet（review#4：除非显式 placeholder/defer+签字）。
  const placeholderKeys = new Set((doc.assets ?? []).filter(a => a.placeholder).map(a => a.key));
  let featureRefs: Set<string> | null = null;
  const issues: BackstopIssue[] = [];
  for (const n of collectAllComponentNodes(doc)) {
    const key = (n.asset_ref ?? n.icon?.ref)?.trim();
    if (!key) continue;
    const structName = resolveMappedStruct(n.id, mappings);
    let rendered: boolean;
    if (structName) {
      rendered = assetRenderedInRefs(key, scanStructResourceRefs(ctx.projectRoot, contracts, structName));
    } else {
      featureRefs = featureRefs ?? scanFeatureSourceTree(ctx.projectRoot, contracts).resourceRefs;
      rendered = assetRenderedInRefs(key, featureRefs);
    }
    if (!rendered) {
      issues.push({
        kind: 'asset',
        id: n.id ?? n.type,
        assetRole: placeholderKeys.has(key) ? 'not_rendered_placeholder' : 'not_rendered',
        detail: `节点 ${n.id ?? n.type} 声明 asset_ref=${key} 但${structName ? ` ${structName}` : '源码'}未 $r 引用对应 media — 疑似声明却未渲染（如 tab 仅文字）`,
      });
    }
    if (isUnclassifiedIcon(n.icon)) {
      issues.push({
        kind: 'asset',
        id: n.id ?? n.type,
        assetRole: 'icon_kind',
        detail: `节点 ${n.id ?? n.type} 声明 icon 但未标 icon.kind（brand_logo|system_symbol|illustration）— 建议补全分类`,
      });
    }
  }
  return issues;
}

// ============================================================================
// B s1.5 asset 物化真图校验：被 $r('app.media.<key>') 引用的【模块实际】media 必须是真图，
// 禁 1×1/退化占位冒充。绝不信 contracts.resource_keys.path / 工程根 media/（已知绕过点，归 F）。
// 退化判定走 readImageDimensions 无 jimp 路径——pixel_1to1 下 jimp 不可用也能判（Q4）。
// ============================================================================

/** B 占位判据阈值（Q2 决策：三信号取或） */
const ASSET_PLACEHOLDER_MIN_BYTES = 256;
const ASSET_PLACEHOLDER_MIN_AREA_RATIO = 0.05;
const MODULE_MEDIA_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg'] as const;

/** 在指定模块（restrictPkgPaths，缺省=全部 in_scope 模块）的 resources/base/media 下定位 <key> 真实文件 */
export function findModuleMediaFile(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
  key: string,
  restrictPkgPaths?: ReadonlySet<string>,
): string | null {
  const snake = key.replace(/\./g, '_');
  for (const mod of contracts.modules ?? []) {
    if (restrictPkgPaths && !restrictPkgPaths.has(mod.package_path)) continue;
    const dir = path.join(projectRoot, mod.package_path, 'src', 'main', 'resources', 'base', 'media');
    for (const stem of new Set([key, snake])) {
      for (const ext of MODULE_MEDIA_EXTS) {
        const p = path.join(dir, `${stem}.${ext}`);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

/**
 * 判断 <key> 对应的【引用模块】实际 media 是否为真图（非退化占位）。
 * restrictPkgPaths＝写 $r 的模块（plan 决策：模块＝写 $r 的那个模块；缺省=全部 in_scope，兜底）。
 * Q2 三信号取或：尺寸 w/h≤2 ｜ 字节<256B ｜ 面积比<5%(相对 resolved_path 真裁图)。
 * svg 仅当资产本身为矢量（resolved_path 非 raster 或缺省）才豁免；resolved_path 为 PNG/JPG 真裁图却
 * 模块侧仅 svg＝未物化真裁图 → not real（review#2）。读不出尺寸/字节视为退化（pixel_1to1 不 SKIP）。
 */
export function moduleMediaRealnessForKey(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
  key: string,
  resolvedPath?: string,
  restrictPkgPaths?: ReadonlySet<string>,
): { file: string | null; real: boolean; reason?: string } {
  const file = findModuleMediaFile(projectRoot, contracts, key, restrictPkgPaths);
  if (!file) return { file: null, real: false, reason: '引用它的模块 resources/base/media 下无对应文件（疑似仅工程根/其它模块/contracts 路径放占位）' };
  const resolvedIsRaster = !!resolvedPath && /\.(png|jpe?g|webp)$/i.test(resolvedPath);
  if (file.toLowerCase().endsWith('.svg')) {
    // 矢量豁免仅限矢量资产：resolved_path 是 raster 真裁图却只放 svg = 未物化真裁图。
    if (resolvedIsRaster) {
      return { file, real: false, reason: 'resolved_path 为 raster 真裁图却模块侧仅 svg，未物化真裁图（矢量豁免仅限矢量资产）' };
    }
    return { file, real: true };
  }
  const dims = readImageDimensions(file);
  if (!dims) return { file, real: false, reason: '模块 media 无法读取尺寸/字节（疑似无效图）' };
  const tinyDim = (dims.w !== null && dims.w <= 2) || (dims.h !== null && dims.h <= 2);
  const tinyBytes = dims.bytes < ASSET_PLACEHOLDER_MIN_BYTES;
  let tinyArea = false;
  if (resolvedPath) {
    const cropAbs = path.resolve(projectRoot, resolvedPath);
    const cropDims = fs.existsSync(cropAbs) ? readImageDimensions(cropAbs) : null;
    if (cropDims?.w && cropDims?.h && dims.w && dims.h) {
      const cropArea = cropDims.w * cropDims.h;
      if (cropArea > 0 && (dims.w * dims.h) / cropArea < ASSET_PLACEHOLDER_MIN_AREA_RATIO) tinyArea = true;
    }
  }
  if (tinyDim || tinyBytes || tinyArea) {
    const reasons = [
      tinyDim && `尺寸${dims.w}×${dims.h}`,
      tinyBytes && `${dims.bytes}B`,
      tinyArea && '面积<5%真图',
    ].filter(Boolean).join('/');
    return { file, real: false, reason: `退化占位(${reasons})` };
  }
  return { file, real: true };
}

/**
 * B：对每个非 placeholder 资产，定位【源码 $r 引用它的模块】，校验那些模块的实际 media 为真图；
 * 退化占位/缺文件/跨模块同名误植 → issue（调用方 pixel_1to1 升 BLOCKER）。
 * 按"写 $r 的模块"作用域，不用 feature 级全局 key set（review#1）。
 */
export function collectPlaceholderAssetIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified) return [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const refModules = scanResourceRefModules(ctx.projectRoot, contracts);
  const issues: BackstopIssue[] = [];
  for (const a of doc.assets ?? []) {
    if (a.placeholder) continue;
    const key = a.key?.trim();
    if (!key) continue;
    const mediaRef = resourceKeyToRef(key, 'media');
    const altRef = resourceKeyToRef(key.replace(/\./g, '_'), 'media');
    const pkgs = new Set<string>([...(refModules.get(mediaRef) ?? []), ...(refModules.get(altRef) ?? [])]);
    if (pkgs.size === 0) continue; // 未被任何模块源码 $r 引用
    // 逐引用模块校验：每个写 $r 的模块都必须有【自己的】真图（A 物化要求把裁图复制进引用模块；
    // 不许靠他模块同名真图救场——own 资源优先解析，他模块有真图也不改变本模块渲染占位的事实）。
    const failing: string[] = [];
    for (const pkg of pkgs) {
      const r = moduleMediaRealnessForKey(ctx.projectRoot, contracts, key, a.resolved_path, new Set([pkg]));
      if (!r.real) failing.push(`${pkg}（${r.reason}）`);
    }
    if (failing.length > 0) {
      issues.push({
        kind: 'asset',
        id: key,
        assetRole: 'placeholder_file',
        detail: `资产 ${key}：源码 $r('${mediaRef}') 引用，但引用模块 media 非真图 — ${failing.join('；')}（未物化 resolved_path 真图）`,
      });
    }
  }
  return issues;
}

// ============================================================================
// round5 P0-A：素材原子化硬门禁——被 $r 引用的非 placeholder 素材图不得烤入该屏 ui-spec 声明文本节点
// （=整段界面当背景大图，致 coding 贴大图又搭真组件的双渲染/烤字）。OCR 素材真图、模糊比对声明文本。
// 复用 a3f1c920 唯一被实测证明鲁棒的 OCR 信号「文本存在性」，反向用于素材（非新增脆弱度量）。
// FP 校准：单品牌 logo 仅含 1 个品牌名(<K)→PASS；装饰/艺术文本不进 ui-spec text 节点(spec 约定)。
// ============================================================================

export interface BakedTextAssetResult {
  issues: BackstopIssue[];
  /** OCR 是本门禁唯一承重探测；须检素材因 OCR 不可用/失败而无法核验 → true（调用方 pixel_1to1 归 toolchain BLOCKER） */
  ocrUnavailable: boolean;
}

/** 逐屏收集 text 节点（≥2 字锚点）+ 该屏 asset_ref/icon.ref 集合（把素材定位到所属屏） */
export function screenTextAndAssetRefs(
  doc: UiSpecDoc,
): Array<{ screenId: string; texts: string[]; assetRefs: Set<string> }> {
  return (doc.screens ?? []).map(sc => {
    const nodes = collectAllComponentNodes({ screens: [sc], tokens: {}, assets: [] } as UiSpecDoc);
    const texts = nodes
      .map(n => n.text)
      .filter((t): t is string => typeof t === 'string' && t.trim().length >= 2);
    const assetRefs = new Set<string>();
    for (const n of nodes) {
      const ref = (n.asset_ref ?? n.icon?.ref)?.trim();
      if (ref) {
        assetRefs.add(ref);
        assetRefs.add(ref.replace(/\./g, '_'));
      }
    }
    return { screenId: sc.id, texts, assetRefs };
  });
}

/** 该素材 key 应比对的声明文本：优先"引用它的组件所属屏"，无则回退全 ui-spec（catches 未经 asset_ref 接线的 slab）。去重、≥2 字。 */
export function declaredTextTargetsForAsset(
  perScreen: Array<{ screenId: string; texts: string[]; assetRefs: Set<string> }>,
  key: string,
): string[] {
  const snake = key.replace(/\./g, '_');
  const owning = perScreen.filter(s => s.assetRefs.has(key) || s.assetRefs.has(snake));
  const scope = owning.length > 0 ? owning : perScreen;
  const set = new Set<string>();
  for (const s of scope) for (const t of s.texts) set.add(t.trim());
  return [...set].filter(t => t.length >= 2);
}

export function collectBakedTextAssetIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
  minMatches = 2,
): BakedTextAssetResult {
  if (baselineUnverified) return { issues: [], ocrUnavailable: false };
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return { issues: [], ocrUnavailable: false };
  const assets = (doc.assets ?? []).filter(
    a => !a.placeholder && (a.acquisition ?? '') !== 'placeholder' && Boolean(a.key?.trim()),
  );
  if (assets.length === 0) return { issues: [], ocrUnavailable: false };
  const perScreen = screenTextAndAssetRefs(doc);

  const issues: BackstopIssue[] = [];
  let needOcr = false;
  let ocrFailed = false;
  const ocrOk = isOcrAvailable();

  for (const a of assets) {
    const key = a.key.trim();
    // human_signed 显式放行（营销/装饰插画确需含字）
    if (a.baked_text_defer === true && isHumanConfirmed(a.baked_text_defer_by)) continue;
    // 定位模块真图（缺图/退化占位由 B 门管，本门只核真图是否烤字）
    const r = moduleMediaRealnessForKey(ctx.projectRoot, contracts, key, a.resolved_path);
    if (!r.file || !r.real) continue;
    if (r.file.toLowerCase().endsWith('.svg')) continue; // 矢量无栅格 OCR 意义
    const targets = declaredTextTargetsForAsset(perScreen, key);
    if (targets.length < minMatches) continue; // 声明文本本就 <K，不可能构成"多文本 slab"
    needOcr = true;
    if (!ocrOk) { ocrFailed = true; continue; }
    const ocr = ocrImageWords(r.file);
    if (!ocr.ok || !ocr.words) { ocrFailed = true; continue; }
    const words = ocr.words;
    const hits = targets.filter(t => fuzzyTextPresent(words, t, 0.7));
    if (hits.length >= minMatches) {
      issues.push({
        kind: 'asset',
        id: key,
        assetRole: 'baked_text',
        detail:
          `素材 ${key} 图内烤入 ${hits.length} 个该屏声明文本（${hits.slice(0, 4).join('/')}${hits.length > 4 ? '…' : ''}）` +
          ` — 疑似整段界面当背景大图，会与真实组件双渲染/烤字冲突；须裁为原子插画（仅图形、无声明文本），` +
          `标题/副标题/按钮/空态文案/底部 tab 等一律真实组件渲染。若确为营销插画需含字，设 baked_text_defer + 真人署名放行。`,
      });
    }
  }

  return { issues, ocrUnavailable: needOcr && ocrFailed };
}

// ============================================================================
// round5 P0-B（Q5 已采纳）：声明 required 品牌图标 asset 的元素、源码却用 sys.symbol 系统单色图标静默替代 →
// pixel_1to1 BLOCKER。与既有 not_rendered 互补：本门精确指认"被 sys.symbol 替代"（更可执行的回修信号）。
// 注：错图标的 $r('sys.symbol.*') 常在数据层(repository)而非组件 struct，故 sys.symbol 探测走 feature 全树。
// ============================================================================

const BRANDED_ICON_KINDS = new Set(['brand_logo', 'illustration']);

/** feature 源码全树（含 data/repository）是否使用系统符号图标（$r('sys.symbol.*') 或 SymbolGlyph）。 */
export function featureUsesSystemSymbolIcon(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
): boolean {
  const { etsFiles } = scanFeatureSourceTree(projectRoot, contracts);
  const re = /\$r\s*\(\s*['"]sys\.symbol\.|SymbolGlyph\s*\(/;
  for (const f of etsFiles) {
    try {
      if (re.test(fs.readFileSync(f, 'utf-8'))) return true;
    } catch {
      /* skip unreadable */
    }
  }
  return false;
}

export function collectIconSubstitutionIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified) return [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const placeholderKeys = new Set((doc.assets ?? []).filter(a => a.placeholder).map(a => a.key));
  const mappings = loadVisualParityMappings(ctx.projectRoot, ctx.feature);
  const usesSysSymbol = featureUsesSystemSymbolIcon(ctx.projectRoot, contracts);
  if (!usesSysSymbol) return []; // 源码未用系统图标 → 无"替代"可言
  let featureRefs: Set<string> | null = null;
  const issues: BackstopIssue[] = [];
  for (const n of collectAllComponentNodes(doc)) {
    const kind = n.icon?.kind?.trim();
    if (!kind || !BRANDED_ICON_KINDS.has(kind)) continue; // 只管声明为品牌/插画图标的元素（system_symbol 用系统图标合法）
    const key = (n.icon?.ref ?? n.asset_ref)?.trim();
    if (!key || placeholderKeys.has(key)) continue; // 显式 placeholder 豁免
    const structName = resolveMappedStruct(n.id, mappings);
    let rendered: boolean;
    if (structName) {
      rendered = assetRenderedInRefs(key, scanStructResourceRefs(ctx.projectRoot, contracts, structName));
    } else {
      featureRefs = featureRefs ?? scanFeatureSourceTree(ctx.projectRoot, contracts).resourceRefs;
      rendered = assetRenderedInRefs(key, featureRefs);
    }
    if (!rendered) {
      issues.push({
        kind: 'asset',
        id: n.id ?? n.type ?? key,
        assetRole: 'icon_substitution',
        detail:
          `节点 ${n.id ?? n.type} 声明 required 品牌图标（icon.kind=${kind}, ref=${key}）却未 $r('app.media.${key.replace(/\./g, '_')}') 渲染，` +
          `且源码用 sys.symbol 系统单色图标替代 — 有品牌识别度的图标（app logo/银行 logo/营销插画）须裁原子素材并 $r 渲染，不可用系统符号冒充；` +
          `若该元素实为标准语义图标（tab/铃铛/加号/卡种线性图标），按 P0-E 分型规则把 icon.kind 改为 system_symbol + color_ref 着色 + fidelity_note（见 reference/ui-spec.md「图标分型」），或显式 placeholder + 真人署名。`,
      });
    }
  }
  return issues;
}

// ============================================================================
// a2 通用 spec 质量：pixel_1to1 下 P0 屏 action_button 须声明合法 variant（与本案解耦、低优先）。
// homepage 已声明 → 对本案 no-op；仅防别的 feature 漏填 variant。枚举对齐 UiSpecButtonVariant。
// ============================================================================

// ============================================================================
// a2 通用 spec 质量：pixel_1to1 P0 屏 action_button 须声明 variant（与本案解耦、低优先）。
// homepage 已声明 → 对本案 no-op；仅防别的 feature 漏填 variant。枚举对齐 UiSpecButtonVariant。
// ============================================================================

/** UiSpecButtonVariant 合法集（含 pill/fill 校正：无 pill、是 filled 非 fill） */
const VALID_BUTTON_VARIANTS = new Set(['filled', 'tonal', 'outlined', 'ghost', 'text']);

/** variant 是否为合法声明（用于 a2 强制声明 + 拦 pill/fill 等非法值） */
export function isDeclaredButtonVariant(variant: string | undefined): boolean {
  return Boolean(variant && VALID_BUTTON_VARIANTS.has(variant.trim()));
}

// ============================================================================
// P1-A（plan f2d8c4a6）：可见文案白名单——源码/string.json 渲染的用户可见 CJK 文本必须 ⊆ spec 文本集。
// round6 实证：coding 把 ref-elements 的 zone 名 finance/settings 脑补成可见标题「金融信息/设置与帮助」，
// 原图根本没有——上游无一道门禁能拦"无中生有"。豁免走 coding/visible-text-exemptions.yaml（须 rationale，
// review 视觉维度复核），不走源码内注释（不可审计）。
// ============================================================================

const requireHarnessYaml = (() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRequire } = require('module') as typeof import('module');
  const req = createRequire(path.resolve(__dirname, '../../../harness/harness-runner.ts'));
  return req('yaml') as { parse: (s: string) => unknown };
})();

const normText = (s: string): string => s.replace(/\s+/g, '');
const hasCjk = (s: string): boolean => /[一-鿿]/.test(s);

export interface VisibleTextExemption {
  text: string;
  rationale?: string;
}

export function visibleTextExemptionsAbsPath(projectRoot: string, feature: string): string {
  return path.join(projectRoot, 'doc', 'features', feature, 'coding', 'visible-text-exemptions.yaml');
}

/** 豁免表：仅 rationale 非空的条目生效（无理由的豁免=自报，不算） */
export function loadVisibleTextExemptions(projectRoot: string, feature: string): VisibleTextExemption[] {
  const abs = visibleTextExemptionsAbsPath(projectRoot, feature);
  if (!fs.existsSync(abs)) return [];
  try {
    const doc = requireHarnessYaml.parse(fs.readFileSync(abs, 'utf-8')) as { entries?: VisibleTextExemption[] } | null;
    return (doc?.entries ?? []).filter(
      e => e && typeof e.text === 'string' && normText(e.text).length > 0 &&
        typeof e.rationale === 'string' && e.rationale.trim().length > 0,
    );
  } catch {
    return [];
  }
}

/** 模块 resources 下 string.json 的 name→value 表（value 供可见性判定） */
export function collectStringJsonEntries(
  projectRoot: string,
  contracts: NonNullable<CheckContext['featureSpec']['contracts']>,
): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name === 'string.json') {
        try {
          const data = JSON.parse(fs.readFileSync(full, 'utf-8')) as { string?: Array<{ name?: string; value?: string }> };
          for (const item of data.string ?? []) {
            if (typeof item?.name === 'string' && typeof item?.value === 'string') out.set(item.name, item.value);
          }
        } catch { /* skip */ }
      }
    }
  };
  for (const mod of contracts.modules ?? []) {
    walk(path.join(projectRoot, mod.package_path, 'src', 'main', 'resources'));
  }
  return out;
}

/**
 * impl 文本是否被 spec 文本集覆盖。方向不对称：
 * - spec 文本 ⊇ impl 文本（s.includes(t)）：impl 渲染了 spec 长句的片段——合法，直接覆盖；
 * - impl 文本 ⊃ spec 文本（t.includes(s)）：须 s 占 t 的 ≥80%——否则脑补长标题只要含一个短合法词
 *   就能溜过（实测坑：「设置与帮助」因包含 spec 的「设置」被误判覆盖）。
 */
function coveredBySpecTexts(text: string, specTextsNorm: string[]): boolean {
  const t = normText(text);
  if (!t) return true;
  return specTextsNorm.some(s =>
    s === t || s.includes(t) || (t.includes(s) && s.length >= t.length * 0.8),
  );
}

const VISIBLE_TEXT_LITERAL_RE = /\b(?:Text|Button)\s*\(\s*(['"])((?:(?!\1)[^\n]){1,80})\1/g;
const STRING_RES_REF_RE = /app\.string\.([A-Za-z0-9_]+)/g;

/**
 * P1-A 主收集器：源码 Text()/Button() CJK 字面量 + 被 $r('app.string.*') 引用的 string.json value，
 * 不在 spec 文本集 ∪ 豁免表 → issue（调用方 pixel_1to1 升 BLOCKER）。
 * 边界（诚实声明）：动态拼接/变量文本静态不可判（漏报可接受）；无 CJK 的技术字符串不查（误报面>收益）。
 */
export function collectVisibleTextIssues(
  ctx: CheckContext,
  specTexts: string[],
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified) return [];
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const scan = scanFeatureSourceTree(ctx.projectRoot, contracts);
  const specNorm = specTexts.map(normText).filter(Boolean);
  const exemptNorm = loadVisibleTextExemptions(ctx.projectRoot, ctx.feature).map(e => normText(e.text));
  // 豁免匹配与白名单同款非对称规则（cursor 意见采纳）：豁免文本 ⊇ 实现文本直接命中；
  // 实现文本 ⊃ 豁免文本须豁免占比 ≥80%——否则一条宽豁免（如「设置」）会连带掩盖多个脑补长标题。
  const isExempt = (t: string): boolean => {
    const n = normText(t);
    return exemptNorm.some(e => e === n || e.includes(n) || (n.includes(e) && e.length >= n.length * 0.8));
  };
  const issues: BackstopIssue[] = [];
  const seen = new Set<string>();
  const referencedStringKeys = new Set<string>();

  for (const file of scan.etsFiles) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    for (const m of content.matchAll(STRING_RES_REF_RE)) referencedStringKeys.add(m[1]);
    for (const m of content.matchAll(VISIBLE_TEXT_LITERAL_RE)) {
      const text = m[2];
      const key = normText(text);
      if (!hasCjk(text) || key.length < 2 || seen.has(key)) continue;
      if (coveredBySpecTexts(text, specNorm) || isExempt(text)) continue;
      seen.add(key);
      issues.push({
        kind: 'visible_text',
        id: path.basename(file),
        detail: `源码字面量可见文本「${text.slice(0, 20)}」不在 ui-spec/ref-elements 文本集（${path.basename(file)}）——原图没有的文案不得无中生有`,
      });
    }
  }

  const stringEntries = collectStringJsonEntries(ctx.projectRoot, contracts);
  for (const [name, value] of stringEntries) {
    if (!referencedStringKeys.has(name)) continue; // 未被 $r 引用=不可见
    const key = normText(value);
    if (!hasCjk(value) || key.length < 2 || seen.has(key)) continue;
    if (coveredBySpecTexts(value, specNorm) || isExempt(value)) continue;
    seen.add(key);
    issues.push({
      kind: 'visible_text',
      id: name,
      detail: `string.json「${name}=${value.slice(0, 20)}」被 $r 引用渲染但不在 ui-spec/ref-elements 文本集——原图没有的文案不得无中生有（如 round6 脑补「金融信息/设置与帮助」）`,
    });
  }
  return issues;
}

// ============================================================================
// 透明节点假 presence 拦截（codex 发现的对抗模式，用户 2026-07-03 拍板）——round6 Checkpoint-2 实锤：
// 宿主 coding 用 `Text($r('app.string.X')).fontSize(1).opacity(0)`、
// `Image($r('app.media.X')).width(0).height(0).opacity(0)`、透明 SymbolGlyph 等"挂"spec 文本/资产引用，
// 骗过 must_have presence / asset-render 静态扫描（引用在、渲染无）。本门禁静态拦截：
// 承载 spec 语义的组件（$r string/media/sys.symbol 或 CJK 字面量）链上带**字面硬不可见**修饰 → 作弊。
// FP 收窄：只认字面值——opacity(0)/visibility(None|Hidden)/width(0)且height(0)/fontSize(0)；
// 变量/绑定（.opacity(this.x)）与单维 0 不判（动画初始态/折叠布局合法形态，漏报归 device OCR 存在性兜）。
// ============================================================================

const INVISIBLE_COMPONENT_START_RE = /\b(Text|Image|SymbolGlyph)\s*\(/g;
const SEMANTIC_ARG_RE = /\$r\s*\(\s*['"](?:app\.(?:string|media)|sys\.symbol)\.|[一-鿿]/;

/**
 * 注释/字符串掩码（codex 意见采纳）：标记每个字符是否处于 //…、/*…*​/、'…'、"…"、`…` 内——
 * 组件起点必须落在真实代码区，否则注释里的"假代码"（// Text($r(...)).opacity(0)）会被误判 BLOCKER。
 * 不全局删字符串：真实 Text('首页') 的参数内容仍须保留供语义检测（起点在代码区即可，参数原样切片）。
 */
export function computeNonCodeMask(source: string): Uint8Array {
  const mask = new Uint8Array(source.length); // 1 = 注释/字符串内
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  for (let p = 0; p < source.length; p++) {
    const ch = source[p];
    const next = source[p + 1];
    switch (state) {
      case 'code':
        if (ch === '/' && next === '/') { state = 'line'; mask[p] = 1; }
        else if (ch === '/' && next === '*') { state = 'block'; mask[p] = 1; }
        else if (ch === "'") { state = 'sq'; mask[p] = 1; }
        else if (ch === '"') { state = 'dq'; mask[p] = 1; }
        else if (ch === '`') { state = 'tpl'; mask[p] = 1; }
        break;
      case 'line':
        mask[p] = 1;
        if (ch === '\n') state = 'code';
        break;
      case 'block':
        mask[p] = 1;
        if (ch === '*' && next === '/') { mask[p + 1] = 1; p++; state = 'code'; }
        break;
      case 'sq':
        mask[p] = 1;
        if (ch === '\\') { if (p + 1 < source.length) { mask[p + 1] = 1; p++; } }
        else if (ch === "'") state = 'code';
        break;
      case 'dq':
        mask[p] = 1;
        if (ch === '\\') { if (p + 1 < source.length) { mask[p + 1] = 1; p++; } }
        else if (ch === '"') state = 'code';
        break;
      case 'tpl':
        mask[p] = 1;
        if (ch === '\\') { if (p + 1 < source.length) { mask[p + 1] = 1; p++; } }
        else if (ch === '`') state = 'code';
        break;
    }
  }
  return mask;
}

/**
 * 从组件起点提取完整修饰链（参数括号配对 + 连续 .mod(...) 段）。
 * 引号内括号忽略；链段之间允许注释（否则 `.width(0) // x` 换行即断链＝作弊逃逸口，codex 意见采纳）。
 */
export function extractComponentChain(source: string, startIdx: number): { args: string; chain: string } {
  let i = source.indexOf('(', startIdx);
  if (i < 0) return { args: '', chain: '' };
  const scanBalanced = (from: number): number => {
    let depth = 0;
    let quote: string | null = null;
    for (let p = from; p < source.length; p++) {
      const ch = source[p];
      if (quote) {
        if (ch === '\\') { p++; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      // 括号计数须跳过注释内容（参数里出现注释罕见但合法）
      if (ch === '/' && source[p + 1] === '/') {
        const nl = source.indexOf('\n', p);
        if (nl < 0) return -1;
        p = nl;
        continue;
      }
      if (ch === '/' && source[p + 1] === '*') {
        const end = source.indexOf('*/', p + 2);
        if (end < 0) return -1;
        p = end + 1;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return p;
      }
    }
    return -1;
  };
  /** 跳过空白与注释（链段衔接处），返回新游标 */
  const skipTrivia = (from: number): number => {
    let p = from;
    for (;;) {
      while (p < source.length && /\s/.test(source[p])) p++;
      if (source[p] === '/' && source[p + 1] === '/') {
        const nl = source.indexOf('\n', p);
        if (nl < 0) return source.length;
        p = nl + 1;
        continue;
      }
      if (source[p] === '/' && source[p + 1] === '*') {
        const end = source.indexOf('*/', p + 2);
        if (end < 0) return source.length;
        p = end + 2;
        continue;
      }
      return p;
    }
  };
  const argsEnd = scanBalanced(i);
  if (argsEnd < 0) return { args: '', chain: '' };
  const args = source.slice(i + 1, argsEnd);
  let chain = '';
  let cursor = argsEnd + 1;
  for (;;) {
    const seg = skipTrivia(cursor);
    const m = /^\.\s*\w+\s*\(/.exec(source.slice(seg));
    if (!m) break;
    const open = seg + m[0].length - 1;
    const close = scanBalanced(open);
    if (close < 0) break;
    chain += source.slice(seg, close + 1);
    cursor = close + 1;
  }
  return { args, chain };
}

const norm0 = (s: string): string => s.replace(/\s+/g, '');

/** 链上字面硬不可见判定（变量绑定不判） */
export function chainIsHardInvisible(chain: string): string | null {
  const c = norm0(chain);
  if (/\.opacity\(0(\.0+)?\)/.test(c)) return 'opacity(0)';
  if (/\.visibility\(Visibility\.(None|Hidden)\)/.test(c)) return 'visibility(None/Hidden)';
  if (/\.fontSize\(0\)/.test(c)) return 'fontSize(0)';
  const zeroW = /\.width\(0\)|\.width\(['"]0(vp|px)?['"]\)/.test(c);
  const zeroH = /\.height\(0\)|\.height\(['"]0(vp|px)?['"]\)/.test(c);
  if (zeroW && zeroH) return 'width(0)+height(0)';
  return null;
}

/**
 * 主收集器：feature 源码里"spec 语义组件 + 字面硬不可见链"→ 作弊 issue（调用方 pixel_1to1 升 BLOCKER）。
 * 不 gate baselineUnverified：作弊判定是纯源码形态问题，与 spec 校验状态无关。
 */
export function collectInvisiblePresenceIssues(ctx: CheckContext): BackstopIssue[] {
  const contracts = ctx.featureSpec.contracts;
  if (!contracts) return [];
  const scan = scanFeatureSourceTree(ctx.projectRoot, contracts);
  const issues: BackstopIssue[] = [];
  for (const file of scan.etsFiles) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    const nonCode = computeNonCodeMask(content);
    INVISIBLE_COMPONENT_START_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INVISIBLE_COMPONENT_START_RE.exec(content)) !== null) {
      if (nonCode[m.index]) continue; // 注释/字符串里的"假代码"不判（codex P2）
      const { args, chain } = extractComponentChain(content, m.index);
      if (!args || !SEMANTIC_ARG_RE.test(args)) continue;
      const invisible = chainIsHardInvisible(chain);
      if (!invisible) continue;
      const argExcerpt = args.replace(/\s+/g, ' ').slice(0, 48);
      issues.push({
        kind: 'invisible_presence',
        id: path.basename(file),
        detail:
          `${path.basename(file)}: ${m[1]}(${argExcerpt}) 链上 ${invisible} —— spec 语义（文本/资产/符号引用）` +
          `挂在硬不可见节点上＝假 presence 作弊（骗静态扫描、实际不渲染）；须真实可见渲染，` +
          `或走显式 placeholder/defer + 人签，禁止透明占位冒充`,
      });
    }
  }
  return issues;
}

/**
 * a2：pixel_1to1 下 P0 屏的 action_button 须声明合法 variant。缺失/非法 → 通用 spec 质量 WARN。
 * 非 homepage 修复路径（homepage 已声明）；P0 先行（D7），引入期取 WARN、观察后可收紧。
 */
export function collectActionButtonVariantDeclIssues(
  ctx: CheckContext,
  doc: UiSpecDoc,
  baselineUnverified: boolean,
): BackstopIssue[] {
  if (baselineUnverified || !isPixel1to1(ctx)) return [];
  const p0 = p0ScreenIdSet(doc);
  const issues: BackstopIssue[] = [];
  for (const s of doc.screens ?? []) {
    if (!s.root) continue;
    const isP0 = p0.has(s.id) || (s.ref_id ? p0.has(s.ref_id) : false);
    if (!isP0) continue;
    const nodes: UiSpecComponentNode[] = [];
    walkComponentNodes(s.root, nodes);
    for (const n of nodes) {
      if (n.type !== 'action_button') continue;
      if (!isDeclaredButtonVariant(n.variant)) {
        issues.push({
          kind: 'variant',
          id: n.id ?? n.type,
          detail: `节点 ${n.id ?? n.type}(action_button) 未声明合法 variant（${[...VALID_BUTTON_VARIANTS].join('|')}）— pixel_1to1 P0 须声明按钮形态`,
        });
      }
    }
  }
  return issues;
}
