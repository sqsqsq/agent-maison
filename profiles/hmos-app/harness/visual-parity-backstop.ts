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
  scanStructResourceRefs,
} from './source-ref-scan';
import { loadVisualParityMappings } from './visual-structure-parity';
import { collectP0VisualTargetIds } from './visual-diff-targets';
import { hexToLab } from './image-toolkit';

export interface BackstopIssue {
  kind: 'semantic_color' | 'must_have' | 'variant' | 'render' | 'asset';
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
        detail: `节点 ${n.id ?? n.type} 声明 asset_ref=${key} 但${structName ? ` ${structName}` : '源码'}未 $r 引用对应 media — 疑似声明却未渲染（如 tab 仅文字）`,
      });
    }
    if (isUnclassifiedIcon(n.icon)) {
      issues.push({
        kind: 'asset',
        id: n.id ?? n.type,
        detail: `节点 ${n.id ?? n.type} 声明 icon 但未标 icon.kind（brand_logo|system_symbol|illustration）— 建议补全分类`,
      });
    }
  }
  return issues;
}

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
