// ============================================================================
// asset-integrity.ts — role-aware 素材完整性（blind-visual-hardening d2 / plan a9d4c7e2 P0-B）
// ----------------------------------------------------------------------------
// 事故锚（bc-openCard 二轮）：23 张 placeholder PNG 物化进 media，设备渲染不可见，
// 门禁仅 WARN（非 pixel_1to1）放行——空白图在**任何**档位都不是合法交付物。
// 三件套：
//   ① role/criticality **机器派生**（codex 二轮 M2：不信 agent 自报）——role 由 key 语义 +
//      ui-spec icon.kind 证据交叉；criticality 由 P0 屏/must_have 证据派生；
//      agent 显式声明与派生失配 → conformance 违例。
//   ② 物化 sanity 按 role 分档（阈值不平移 asset-crop-validation 的 crop 校准值——
//      合法单色图标/mask 不误伤）；brand-critical 空白/纯色 → BLOCKER **档位无关**
//      （档位管"像不像"，本检查管"有没有"）。
//   ③ 分角色占位生成（codex 二轮 M2：插画不给文字头像）：brand_logo→SVG 文字头像
//      （首字 + 确定性中性调色板，SVG 文本由系统字体渲染，CJK 无字体依赖）；
//      illustration→中性插画占位框；decoration→中性块；system_symbol→不落文件，
//      指引使用 SymbolGlyph。禁空白/透明占位。
// ============================================================================

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { UiSpecAsset, UiSpecDoc, UiSpecScreen } from '../../../harness/scripts/utils/ui-spec-shared';
import { computeImageStats, isJimpAvailable, readImageDimensions } from './image-toolkit';

export type AssetRole = 'brand_logo' | 'illustration' | 'icon' | 'mask' | 'decoration' | 'system_symbol';

/** 资源名唯一规则（codex 六轮 P1：schema/runtime validator/CLI 三方共用，任何 fs 访问前校验） */
export const ASSET_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const ASSET_SANITY_THRESHOLD_VERSION = 'r1';

/** 空白判定（全角色通用）：非近白/近黑内容占比 < 此值（与 crop 校准值同源常数，但独立冻结版本） */
export const MATERIALIZED_BLANK_MAX_CONTENT_RATIO = 0.02;
/** 近纯色判定（仅 brand_logo/illustration 适用——单色 icon/mask 合法，decoration 仅 WARN） */
export const MATERIALIZED_SOLID_MAX_UNIQUE_COLORS = 2;
export const MATERIALIZED_SOLID_MIN_LUMA_STDDEV = 3;

// ---------------------------------------------------------------------------
// ① role / criticality 机器派生
// ---------------------------------------------------------------------------

const ROLE_KEY_PATTERNS: Array<{ re: RegExp; role: AssetRole }> = [
  { re: /(^|_)(logo|brand)(_|$)/i, role: 'brand_logo' },
  { re: /(^|_)(mask)(_|$)/i, role: 'mask' },
  { re: /(^|_)(icon|tab|symbol)(_|$)/i, role: 'icon' },
  { re: /(^|_)(ill|illustration|guide|promo|banner|face|card_face|placeholder_art)(_|$)/i, role: 'illustration' },
];

export interface DerivedAssetRole {
  role: AssetRole;
  /** 派生依据（审计） */
  basis: string;
  /** agent 显式声明与派生失配（conformance 违例素材） */
  declaredMismatch: string | null;
}

/** 收集 ui-spec 全部节点的 icon.kind 证据（screens 树递归） */
export function collectIconKindEvidence(doc: UiSpecDoc): Set<string> {
  const kinds = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    const icon = rec.icon as { kind?: unknown } | undefined;
    if (icon && typeof icon.kind === 'string') kinds.add(icon.kind);
    for (const key of ['children', 'root']) {
      const v = rec[key];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
    const tpl = rec.item_template;
    if (tpl && typeof tpl === 'object') walk(tpl);
  };
  for (const s of (doc.screens ?? []) as UiSpecScreen[]) walk(s);
  return kinds;
}

export function deriveAssetRole(asset: UiSpecAsset, doc: UiSpecDoc): DerivedAssetRole {
  const key = asset.key ?? '';
  let role: AssetRole = 'decoration';
  let basis = 'key 无角色语义 → decoration 兜底';
  for (const p of ROLE_KEY_PATTERNS) {
    if (p.re.test(key)) {
      role = p.role;
      basis = `key 语义命中 ${p.re}`;
      break;
    }
  }
  // icon.kind 证据交叉：ui-spec 声明了 brand_logo 节点而 key 含 logo/bank 语义 → 提升为 brand_logo
  const kinds = collectIconKindEvidence(doc);
  if (role === 'icon' && kinds.has('brand_logo') && /(bank|brand|logo)/i.test(key)) {
    role = 'brand_logo';
    basis += '；icon.kind=brand_logo 证据交叉提升';
  }
  // agent 显式声明失配检测（声明字段为 UiSpecAsset 扩展面；无声明=无失配）
  const declared = (asset as unknown as Record<string, unknown>).role;
  const declaredMismatch =
    typeof declared === 'string' && declared.trim().length > 0 && declared.trim() !== role
      ? `声明 role=${declared} 与机器派生 ${role} 失配（criticality/阈值以派生为准，声明不作数）`
      : null;
  return { role, basis, declaredMismatch };
}

/** criticality：role∈{brand_logo,illustration} 且 ui-spec 有屏（UI feature）→ brand-critical。
 * cursor 实施 review P2：不以 agent 自填 priority:P0 为条件——全屏写 P1 即可把品牌素材降级
 * 是自报牵制硬线；品牌/插画素材在任何 UI feature 里都是可见性关键面。 */
export function deriveAssetCriticality(role: AssetRole, doc: UiSpecDoc): 'brand_critical' | 'normal' {
  if (role !== 'brand_logo' && role !== 'illustration') return 'normal';
  const screens = (doc.screens ?? []) as UiSpecScreen[];
  return screens.length > 0 ? 'brand_critical' : 'normal';
}

// ---------------------------------------------------------------------------
// ② 物化 sanity（role 分档）
// ---------------------------------------------------------------------------

export interface MaterializedSanityIssue {
  key: string;
  role: AssetRole;
  criticality: 'brand_critical' | 'normal';
  file: string;
  reasons: string[];
}

/** SVG 可见性静态判：有可见图形/文本且非全透明填充（jimp 不解码 SVG，走结构判） */
export function svgLooksVisible(svgText: string): boolean {
  if (!/<svg[\s>]/i.test(svgText)) return false;
  const hasShape = /<(rect|circle|path|ellipse|polygon|line|text)[\s>]/i.test(svgText);
  if (!hasShape) return false;
  // 全部填充皆 none/transparent → 不可见
  const fills = [...svgText.matchAll(/fill="([^"]*)"/gi)].map(m => m[1].trim().toLowerCase());
  if (fills.length > 0 && fills.every(f => f === 'none' || f === 'transparent')) return false;
  return true;
}

export type MaterializedSanityStatus = 'pass' | 'fail' | 'unverified';

/** 单文件 role 分档 sanity——**三态**（codex 实施 review P1-5：boolean ok 在 jimp 缺失时
 * fail-open，注释与行为矛盾）。语义：pass=统计已执行且干净；fail=确定性违例；
 * unverified=内容统计**未能执行**（jimp 缺失/统计失败）——绝不折叠进 pass。
 * 调用方处置：brand-critical unverified → BLOCKER（fail-closed）；normal unverified → 债务 WARN。
 * opts.jimpAvailableOverride 仅供单测注入降级分支（本机装了 jimp 也能测 unverified 路径）。 */
export function assessMaterializedFile(
  absPath: string,
  role: AssetRole,
  opts?: { jimpAvailableOverride?: boolean },
): { status: MaterializedSanityStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (!fs.existsSync(absPath)) return { status: 'fail', reasons: ['文件不存在'] };
  if (absPath.toLowerCase().endsWith('.svg')) {
    const text = fs.readFileSync(absPath, 'utf-8');
    if (!svgLooksVisible(text)) reasons.push('SVG 无可见图形/文本或全透明填充');
    return { status: reasons.length === 0 ? 'pass' : 'fail', reasons };
  }
  const dims = readImageDimensions(absPath);
  if (!dims || !dims.w || !dims.h) return { status: 'fail', reasons: ['尺寸不可解码（疑似损坏/非图像）'] };
  if (dims.w <= 2 || dims.h <= 2) {
    return { status: 'fail', reasons: [`退化尺寸 ${dims.w}×${dims.h}`] };
  }
  const jimpOk = opts?.jimpAvailableOverride ?? isJimpAvailable();
  if (!jimpOk) {
    return { status: 'unverified', reasons: ['jimp 不可用：内容统计未执行（不作已验放行）'] };
  }
  const stats = computeImageStats(absPath);
  if (!stats.ok) {
    return { status: 'unverified', reasons: [`内容统计失败（${stats.error ?? 'stats failed'}）——不作已验放行`] };
  }
  const contentRatio = stats.contentRatio ?? 0;
  const uniqueColors = stats.uniqueColors ?? 0;
  const lumaStddev = stats.lumaStddev ?? 0;
  if (contentRatio < MATERIALIZED_BLANK_MAX_CONTENT_RATIO) {
    reasons.push(`空白（内容占比 ${(contentRatio * 100).toFixed(1)}% < ${MATERIALIZED_BLANK_MAX_CONTENT_RATIO * 100}%）`);
  }
  // 近纯色仅对 brand_logo/illustration 判违例（单色 icon/mask 合法——codex 二轮 M2 反误伤）
  if (
    (role === 'brand_logo' || role === 'illustration') &&
    (uniqueColors <= MATERIALIZED_SOLID_MAX_UNIQUE_COLORS || lumaStddev < MATERIALIZED_SOLID_MIN_LUMA_STDDEV)
  ) {
    reasons.push(`近纯色（uniqueColors=${uniqueColors}, lumaStddev=${lumaStddev.toFixed(1)}）——${role} 不应为整块纯色`);
  }
  return { status: reasons.length === 0 ? 'pass' : 'fail', reasons };
}

// ---------------------------------------------------------------------------
// ③ 分角色占位生成（确定性 SVG；禁空白）
// ---------------------------------------------------------------------------

/** 中性调色板（非品牌色——品牌色事实源纪律：模型猜色只可用于占位中性调色，见 P0-D④） */
const NEUTRAL_PALETTE = ['#5B6B7A', '#6B5B7A', '#7A6B5B', '#5B7A6B', '#4A6B8A', '#8A6B4A', '#6B8A4A', '#7A5B6B'];

/**
 * 占位 provenance marker（codex 四轮 P0-1）：生成的占位 SVG 内嵌冻结注释标记——
 * 机器可识别"这是 maison 占位而非真素材"，asset_placeholder_present 检查据此逐素材入
 * 视觉债务（占位可见≠素材已供给，release 保持 BLOCKED 直至真素材替换或人工验收）。
 */
export const PLACEHOLDER_MARKER_PREFIX = 'maison:placeholder';

export function placeholderMarkerOf(kind: string, key: string): string {
  return `<!-- ${PLACEHOLDER_MARKER_PREFIX}:${kind}:${key} -->`;
}

/** 文件是否为 maison 生成的占位（marker 检测；非 SVG/无 marker → null，命中 → kind） */
export function detectPlaceholderMarker(absPath: string): { kind: string; key: string } | null {
  try {
    if (!absPath.toLowerCase().endsWith('.svg') || !fs.existsSync(absPath)) return null;
    const head = fs.readFileSync(absPath, 'utf-8').slice(0, 512);
    const m = head.match(new RegExp(`<!-- ${PLACEHOLDER_MARKER_PREFIX}:([a-z_]+):([\\w.-]+) -->`));
    return m ? { kind: m[1], key: m[2] } : null;
  } catch {
    return null;
  }
}

function paletteFor(key: string): string {
  const h = crypto.createHash('sha256').update(key, 'utf-8').digest();
  return NEUTRAL_PALETTE[h[0] % NEUTRAL_PALETTE.length];
}

/** 取 label 首个"字"（CJK 取首字；ASCII 取首字母大写；空 → key 首字符） */
export function placeholderGlyph(label: string, key: string): string {
  const src = (label ?? '').trim() || key.trim();
  const first = [...src][0] ?? '?';
  return /[a-z]/i.test(first) ? first.toUpperCase() : first;
}

export interface PlaceholderResult {
  kind: 'text_avatar' | 'illustration_frame' | 'neutral_block' | 'system_symbol';
  written: boolean;
  destAbs?: string;
  guidance?: string;
  /** 目标已存在且非本生成器同字节产物——拒绝覆盖（codex 六轮 P0：no-clobber 契约，
   * 不依赖前置 lookup 是否失效） */
  conflict?: boolean;
}

/** 确定性生成：同 (role,key,label) 恒同字节（无时间戳/随机）。
 * no-clobber：目标已存在 → 同字节视为幂等 skip（written:false），异字节 → conflict 拒覆盖。 */
export function generateRolePlaceholder(opts: {
  role: AssetRole;
  key: string;
  label: string;
  destAbs: string;
}): PlaceholderResult {
  const { role, key, label } = opts;
  if (role === 'system_symbol') {
    return {
      kind: 'system_symbol',
      written: false,
      guidance: '系统符号不落占位文件——代码使用 SymbolGlyph($r("sys.symbol.*"))，缺失由 ui-kit block 的素材缺失行为兜。',
    };
  }
  const color = paletteFor(key);
  const kind: PlaceholderResult['kind'] =
    role === 'brand_logo' || role === 'icon' ? 'text_avatar'
    : role === 'illustration' ? 'illustration_frame'
    : 'neutral_block';
  const marker = placeholderMarkerOf(kind, key);
  let svg: string;
  if (role === 'brand_logo' || role === 'icon') {
    const glyph = placeholderGlyph(label, key).replace(/[<>&"]/g, '');
    svg = [
      marker,
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
      `  <rect x="4" y="4" width="88" height="88" rx="20" fill="${color}"/>`,
      `  <text x="48" y="62" text-anchor="middle" font-size="44" fill="#FFFFFF" font-family="sans-serif">${glyph}</text>`,
      '</svg>',
      '',
    ].join('\n');
  } else if (role === 'illustration') {
    svg = [
      marker,
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">',
      `  <rect x="4" y="4" width="312" height="192" rx="16" fill="#F1F3F5" stroke="${color}" stroke-width="2" stroke-dasharray="8 6"/>`,
      `  <line x1="4" y1="4" x2="316" y2="196" stroke="${color}" stroke-width="1" opacity="0.5"/>`,
      `  <line x1="316" y1="4" x2="4" y2="196" stroke="${color}" stroke-width="1" opacity="0.5"/>`,
      `  <text x="160" y="106" text-anchor="middle" font-size="18" fill="${color}" font-family="sans-serif">插画占位（待素材）</text>`,
      '</svg>',
      '',
    ].join('\n');
  } else {
    svg = [
      marker,
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24" viewBox="0 0 96 24">',
      `  <rect x="0" y="0" width="96" height="24" rx="6" fill="#E8EAED" stroke="${color}" stroke-width="1"/>`,
      '</svg>',
      '',
    ].join('\n');
  }
  if (fs.existsSync(opts.destAbs)) {
    const existing = fs.readFileSync(opts.destAbs, 'utf-8');
    if (existing === svg) return { kind, written: false, destAbs: opts.destAbs }; // 幂等 skip
    return {
      kind,
      written: false,
      destAbs: opts.destAbs,
      conflict: true,
      guidance: '目标已存在且内容不同（可能是真素材/他源占位）——no-clobber 拒绝覆盖；确需替换请人工删除后重跑。',
    };
  }
  fs.mkdirSync(path.dirname(opts.destAbs), { recursive: true });
  fs.writeFileSync(opts.destAbs, svg, 'utf-8');
  return { kind, written: true, destAbs: opts.destAbs };
}

// ---------------------------------------------------------------------------
// 占位生成计划（codex 四轮 P0-1/P1-6：CLI 只执行计划，判定收口在此可测函数）
// ---------------------------------------------------------------------------

export interface PlaceholderPlan {
  /** 允许生成：ui-spec 显式 placeholder 声明的缺失素材 */
  generate: Array<{ key: string; role: AssetRole; criticality: 'brand_critical' | 'normal' }>;
  /** 阻塞：非 placeholder 声明的真实素材缺失——CLI 不得代生成（洗白路径），非零退出 */
  blocked: Array<{ key: string; reason: string }>;
  /** 跳过：已物化 / system_symbol */
  skipped: Array<{ key: string; reason: string }>;
}

/**
 * P0-1 核心判定：只有 `placeholder: true` 或 `acquisition: placeholder` 的资产允许生成占位；
 * 其余缺失素材是**必须供给的真实素材**（crop/repo_assets/未声明）→ blocked。
 * mediaLookup 由调用方注入（CLI 用 findModuleMediaFile；单测注入 map）。
 */
export function planPlaceholderGeneration(
  doc: UiSpecDoc,
  mediaLookup: (key: string) => string | null,
): PlaceholderPlan {
  const plan: PlaceholderPlan = { generate: [], blocked: [], skipped: [] };
  for (const a of (doc.assets ?? []) as UiSpecAsset[]) {
    if (!a?.key) continue;
    if (mediaLookup(a.key)) {
      plan.skipped.push({ key: a.key, reason: '已物化' });
      continue;
    }
    const derived = deriveAssetRole(a, doc);
    if (derived.role === 'system_symbol') {
      plan.skipped.push({ key: a.key, reason: 'system_symbol 走 SymbolGlyph，不落占位文件' });
      continue;
    }
    const declaredPlaceholder = a.placeholder === true || a.acquisition === 'placeholder';
    if (!declaredPlaceholder) {
      plan.blocked.push({
        key: a.key,
        reason: `acquisition=${a.acquisition ?? '未声明'} 且 placeholder≠true——真实素材缺失不得代生成占位（走 asset-request 问人或补素材）`,
      });
      continue;
    }
    plan.generate.push({ key: a.key, role: derived.role, criticality: deriveAssetCriticality(derived.role, doc) });
  }
  return plan;
}
