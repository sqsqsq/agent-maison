// ============================================================================
// fidelity-shared.ts — fidelity_target / asset_acquisition_mode / severity ratchet
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext } from './types';
import { parseVisualHandoffYamlRoot } from './ui-spec-shared';
import { featureFilePath, relFeaturesDir } from '../../config';

const requireHarness = createRequire(path.resolve(__dirname, '../../harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

/**
 * E2（多模态降级阶梯 plan d4a8f3c6）：`reference_only` 是能力地板（无视觉、无 OCR 时的钳制目标），
 * 与 `pixel_1to1`/`semantic_layout` 并列可声明——spec 作者或钳制逻辑均可写入。已 grep 核对全部
 * 19 处消费点（capture-completeness-check.ts / fidelity-governance-check.ts /
 * structured-ref-elements.ts / check-review.ts 等）均只做 `=== 'pixel_1to1'`/`!== 'pixel_1to1'`
 * 比较，从不比较 `'semantic_layout'` 字面量——新增第三态对既有消费面零行为影响，无需逐一改动。
 */
export type FidelityTarget = 'pixel_1to1' | 'semantic_layout' | 'reference_only';
export type AssetAcquisitionMode = 'approximate' | 'auto_crop' | 'user_dir';

const FIDELITY_TARGETS = new Set<FidelityTarget>(['pixel_1to1', 'semantic_layout', 'reference_only']);
const ASSET_MODES = new Set<AssetAcquisitionMode>(['approximate', 'auto_crop', 'user_dir']);

export interface FidelityDeferralEntry {
  element_id: string;
  reason?: string;
  /** 人类签字/批准标记（pixel_1to1 下必填） */
  human_signed?: boolean;
  signed_by?: string;
  signed_at?: string;
}

export interface RefElementEntry {
  element_id: string;
  screen_ref_id?: string;
  zone?: string;
  type?: string;
  text?: string;
  semantic_role?: string;
  color_ref?: string;
  icon_kind?: string;
  badge?: string;
  disposition: 'implement' | 'defer';
  /** structured | vl — 第二刀双写优先级 */
  provenance?: 'structured' | 'vl';
}

export interface RefElementsDoc {
  schema_version?: string;
  elements: RefElementEntry[];
}

export function parseFidelityTargetFromHandoffDoc(
  doc: Record<string, unknown> | null,
): FidelityTarget {
  if (!doc) return 'semantic_layout';
  const raw = doc.fidelity_target;
  if (typeof raw === 'string' && FIDELITY_TARGETS.has(raw.trim() as FidelityTarget)) {
    return raw.trim() as FidelityTarget;
  }
  return 'semantic_layout';
}

export function parseAssetAcquisitionModeFromHandoffDoc(
  doc: Record<string, unknown> | null,
): AssetAcquisitionMode {
  if (!doc) return 'approximate';
  const raw = doc.asset_acquisition_mode;
  if (typeof raw === 'string' && ASSET_MODES.has(raw.trim() as AssetAcquisitionMode)) {
    return raw.trim() as AssetAcquisitionMode;
  }
  return 'approximate';
}

export function parseFidelityDeferrals(doc: Record<string, unknown> | null): FidelityDeferralEntry[] {
  if (!doc) return [];
  const raw = doc.fidelity_deferrals;
  if (!Array.isArray(raw)) return [];
  const out: FidelityDeferralEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const elementId = rec.element_id;
    if (typeof elementId !== 'string' || !elementId.trim()) continue;
    out.push({
      element_id: elementId.trim(),
      reason: typeof rec.reason === 'string' ? rec.reason : undefined,
      human_signed: rec.human_signed === true,
      signed_by: typeof rec.signed_by === 'string' ? rec.signed_by : undefined,
      signed_at: typeof rec.signed_at === 'string' ? rec.signed_at : undefined,
    });
  }
  return out;
}

/**
 * G1 headless 自签伪造防线：goal-mode 等自动化身份不得冒充人类签字。
 * homepage 失败案例：fidelity_deferrals 全 signed_by=goal-mode-auto 却 human_signed:true。
 */
export const AUTOMATION_SIGNER_IDS = new Set<string>([
  'goal-mode-auto',
  'goal-mode',
  'goal-runner',
  'headless',
  'headless-auto',
  'auto',
  'system',
]);

export function isAutomationSigner(signedBy: string | undefined): boolean {
  if (typeof signedBy !== 'string') return false;
  return AUTOMATION_SIGNER_IDS.has(signedBy.trim().toLowerCase());
}

/**
 * G4b：用户在需求文本中的自然语言裁剪授权 sentinel（"资源可从原图/截图裁剪获取"）。
 * 属**合法的前置确认者**（用户即真人、需求文本即授权），**绝不可加入 AUTOMATION_SIGNER_IDS**。
 * headless 下 crop_confirmed_by=此值 视为有效前置确认，免 mid-run halt 直接裁。
 */
export const USER_REQUIREMENT_CONFIRMER = 'user_requirement';

/**
 * T2：pixel_1to1 P0 pass 屏的真人确认判据——`confirmed_by` 非空且非自动化身份。
 * 视觉裁判可信化主背靠：像素/文本-位置度量均被实测证伪（忠实屏误报），图标/颜色/样式类假 PASS
 * 不可约地需 VL/人判 → pixel_1to1 P0 屏判 pass 须真人过目确认，goal-mode-auto 等自签不算（headless 走 HALT）。
 */
export function isHumanConfirmed(confirmedBy: string | undefined): boolean {
  return typeof confirmedBy === 'string' && confirmedBy.trim().length > 0 && !isAutomationSigner(confirmedBy);
}

/**
 * P0-6（plan c9e2a7f4）：验真签名判据——**授权哨兵 ≠ 验真签名**。
 * user_requirement 是需求级授权（能不能做），不能替代对具体屏/资产的真人过目（有没有人看过）。
 * 2026-07-05 实锤：宿主 agent 以 confirmed_by='user_requirement' 伪签 T2，在其 shell 的 harness
 * 运行中实际通关（回执 blocker_count 0），仅因 goal-runner 干净环境重跑才被打回。
 * 凡"验真/过目"语义的 signer（T2 confirmed_by / bbox_verified_by / baked_text_defer_by /
 * deferral signed_by）一律用本判据；授权语义（crop_confirmed_by）保持既有判据不变。
 * 诚实边界：堵不住伪造人名字符串（headless 自写 signer 本质不可信）；彻底解=带外确认凭证（round7 P0-8）。
 */
export function isHumanVerified(signer: string | undefined): boolean {
  if (!isHumanConfirmed(signer)) return false;
  return signer!.trim().toLowerCase() !== USER_REQUIREMENT_CONFIRMER;
}

/**
 * 真人签字判据：human_signed:true 且 signed_by 非自动化身份。
 * signed_by 缺省视为人工（不破坏交互态既有行为）；仅显式自动化身份被拒。
 */
export function isHumanSignedDeferral(
  d: FidelityDeferralEntry,
  opts?: { requireExplicitSigner?: boolean },
): boolean {
  if (d.human_signed !== true) return false;
  if (isAutomationSigner(d.signed_by)) return false;
  // P0-6：user_requirement 属需求级授权哨兵，不算对具体豁免条目的真人签字。
  if (typeof d.signed_by === 'string' && d.signed_by.trim().toLowerCase() === USER_REQUIREMENT_CONFIRMER) return false;
  // headless：缺 signed_by 视为可疑自签（真人会留名）→ 不算人签；交互态缺省仍算人工。
  if (opts?.requireExplicitSigner) {
    return typeof d.signed_by === 'string' && d.signed_by.trim().length > 0;
  }
  return true;
}

/**
 * G2：从需求/spec 文本识别强 1:1 还原意图。命中即应置 fidelity_target: pixel_1to1。
 * homepage 失败案例：原始需求 6× "完全参考 X.jpg" 却被自动降级为 semantic_layout。
 * 注：强信号常在原始需求文档，spec.md 未必转述——故 TS 侧仅作弱兜底 nudge，主力在 spec 生成提示词。
 */
const PIXEL_1TO1_INTENT_PATTERNS: readonly RegExp[] = [
  /完全参考/, /完全按照/, /完全还原/, /精确还原/, /严格按/, /严格参照/, /照(着|图)/,
  /像素级/, /逐像素/, /100\s*%\s*还原/, /1\s*[:：比]\s*1/, /一比一/,
  /pixel[\s-]?perfect/i, /\b1\s*to\s*1\b/i,
];

export function detectPixel1to1Intent(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return PIXEL_1TO1_INTENT_PATTERNS.some(re => re.test(text));
}

/** pixel_1to1 联动：默认抬升 user_dir */
export function effectiveAssetAcquisitionMode(
  fidelityTarget: FidelityTarget,
  declared: AssetAcquisitionMode,
): AssetAcquisitionMode {
  if (fidelityTarget === 'pixel_1to1' && declared === 'approximate') {
    return 'user_dir';
  }
  return declared;
}

export function isPixel1to1(ctx: CheckContext): boolean {
  return ctx.fidelityTarget === 'pixel_1to1';
}

/**
 * E2：能力钳制的输入——只取当前 goal-mode/adapter 实测的视觉能力与 OCR 环境就绪度，
 * 不含具体 adapter 名/模型名（钳制只关心"能不能看图/能不能 OCR"两个布尔量）。
 */
export interface FidelityCapability {
  /** adapter/模型是否具备图片输入能力（MultimodalProbeResult.supported 同型：tool_read|native_attach） */
  hasVision: boolean;
  /** isOcrAvailable()（profile 相关，由调用方探测传入——core 不硬依赖具体 profile 的 OCR 实现） */
  ocrAvailable: boolean;
}

export type FidelityClampReason = 'no_vision_ocr_available' | 'no_vision_no_ocr';

export interface FidelityClampResult {
  /** 有效档位——供 isPixel1to1 等全部消费面读取 */
  effective: FidelityTarget;
  clamped: boolean;
  reason?: FidelityClampReason;
}

/**
 * E2（多模态降级阶梯 plan d4a8f3c6）：desired（用户/需求声明）× capability（当前 adapter+
 * 环境实测）→ effective——**不改写** desired（保留意图供 ratchet 回升，只影响运行时有效档位）。
 * 钳制表：hasVision → 不钳（强模型效果好）；无视觉+OCR 可用 → pixel_1to1 钳到 semantic_layout
 * （案B chrys 银行卡实证：这正是让 OCR 全文覆盖门禁从无解题降为可跑通的关键）；
 * 无视觉+无OCR → 钳到 reference_only 地板（最弱也要能跑通，不能异常中断）。
 */
export function clampFidelityByCapability(
  desired: FidelityTarget,
  capability: FidelityCapability,
): FidelityClampResult {
  if (capability.hasVision) return { effective: desired, clamped: false };
  if (desired === 'reference_only') return { effective: desired, clamped: false };
  if (capability.ocrAvailable) {
    if (desired === 'pixel_1to1') {
      return { effective: 'semantic_layout', clamped: true, reason: 'no_vision_ocr_available' };
    }
    return { effective: desired, clamped: false };
  }
  // 无视觉也无 OCR：不论 desired 是 pixel_1to1 还是 semantic_layout，都钳到地板。
  return { effective: 'reference_only', clamped: true, reason: 'no_vision_no_ocr' };
}

export interface EffectiveFidelityContext {
  /** 有效档位（已钳制）——CheckContext.fidelityTarget 的赋值来源，全消费面单点收口于此 */
  fidelityTarget: FidelityTarget;
  /** 原始声明档位（未钳制，供 ratchet 回升 + intent_nudge 判"是否合法钳制"用） */
  declaredFidelityTarget: FidelityTarget;
  fidelityClamped: boolean;
  fidelityClampReason?: FidelityClampReason;
  assetAcquisitionMode: AssetAcquisitionMode;
  effectiveAssetAcquisitionMode: AssetAcquisitionMode;
  fidelityDeferrals: FidelityDeferralEntry[];
}

/**
 * 把 resolveFidelityContextFromFeature 的原始声明结果 × 能力钳制，合成 CheckContext 需要的
 * 完整字段集——harness-runner.ts 的唯一调用点，纯函数、可单测（capability 由调用方探测传入）。
 */
export function resolveEffectiveFidelityContext(
  raw: {
    fidelityTarget: FidelityTarget;
    assetAcquisitionMode: AssetAcquisitionMode;
    effectiveAssetAcquisitionMode: AssetAcquisitionMode;
    fidelityDeferrals: FidelityDeferralEntry[];
  },
  capability: FidelityCapability,
): EffectiveFidelityContext {
  const clamp = clampFidelityByCapability(raw.fidelityTarget, capability);
  return {
    fidelityTarget: clamp.effective,
    declaredFidelityTarget: raw.fidelityTarget,
    fidelityClamped: clamp.clamped,
    fidelityClampReason: clamp.reason,
    assetAcquisitionMode: raw.assetAcquisitionMode,
    effectiveAssetAcquisitionMode: raw.effectiveAssetAcquisitionMode,
    fidelityDeferrals: raw.fidelityDeferrals,
  };
}

/** pixel_1to1 下关键视觉项 ratchet：WARN → FAIL/BLOCKER */
export function fidelityRatchetSeverity(
  ctx: CheckContext,
  defaultSeverity: 'BLOCKER' | 'MAJOR' | 'MINOR',
  opts?: { elevateWarnToBlocker?: boolean },
): 'BLOCKER' | 'MAJOR' | 'MINOR' {
  if (!isPixel1to1(ctx)) return defaultSeverity;
  if (defaultSeverity === 'MAJOR' || opts?.elevateWarnToBlocker) {
    return 'BLOCKER';
  }
  return defaultSeverity;
}

export function fidelityRatchetFailOrWarn(
  ctx: CheckContext,
  softWouldWarn: boolean,
): { severity: 'BLOCKER' | 'MAJOR'; status: 'FAIL' | 'WARN' } {
  if (isPixel1to1(ctx)) {
    return { severity: 'BLOCKER', status: 'FAIL' };
  }
  return softWouldWarn
    ? { severity: 'MAJOR', status: 'WARN' }
    : { severity: 'BLOCKER', status: 'FAIL' };
}

export function loadSpecMarkdown(projectRoot: string, feature: string): string | null {
  const p = featureFilePath(projectRoot, feature, path.join('spec', 'spec.md'));
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

export function loadHandoffDocFromFeature(projectRoot: string, feature: string): Record<string, unknown> | null {
  const md = loadSpecMarkdown(projectRoot, feature);
  if (!md) return null;
  return parseVisualHandoffYamlRoot(md);
}

/** 从 feature spec.md 解析 fidelity 上下文字段（供 harness-runner 注入 CheckContext） */
export function resolveFidelityContextFromFeature(
  projectRoot: string,
  feature: string,
): {
  fidelityTarget: FidelityTarget;
  assetAcquisitionMode: AssetAcquisitionMode;
  effectiveAssetAcquisitionMode: AssetAcquisitionMode;
  fidelityDeferrals: FidelityDeferralEntry[];
} {
  const doc = loadHandoffDocFromFeature(projectRoot, feature);
  const fidelityTarget = parseFidelityTargetFromHandoffDoc(doc);
  const declared = parseAssetAcquisitionModeFromHandoffDoc(doc);
  return {
    fidelityTarget,
    assetAcquisitionMode: declared,
    effectiveAssetAcquisitionMode: effectiveAssetAcquisitionMode(fidelityTarget, declared),
    fidelityDeferrals: parseFidelityDeferrals(doc),
  };
}

export function refElementsAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'ref-elements.yaml'));
}

export function assetManifestAbsPath(projectRoot: string, feature: string): string {
  return featureFilePath(projectRoot, feature, path.join('spec', 'asset-manifest.yaml'));
}

export function loadRefElementsFile(absPath: string): RefElementsDoc | null {
  if (!fs.existsSync(absPath)) return null;
  try {
    const doc = YAML.parse(fs.readFileSync(absPath, 'utf-8')) as RefElementsDoc;
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.elements)) return null;
    return doc;
  } catch {
    return null;
  }
}

export type RefElementsDenominatorSource = 'memory_manifest' | 'disk';

/** capture-completeness 分母：同 run 内存 manifest 优先，否则只读磁盘 ref-elements.yaml */
export function resolveRefElementsDenominator(
  ctx: CheckContext,
  projectRoot: string,
  feature: string,
): {
  elements: RefElementEntry[] | null;
  source: RefElementsDenominatorSource | null;
  detail?: string;
} {
  if (ctx.refElementsManifest && ctx.refElementsManifest.length > 0) {
    return {
      elements: ctx.refElementsManifest,
      source: 'memory_manifest',
      detail: ctx.refElementsManifestDetail,
    };
  }
  const refAbs = refElementsAbsPath(projectRoot, feature);
  const doc = loadRefElementsFile(refAbs);
  if (!doc?.elements?.length) {
    return { elements: doc?.elements ?? null, source: doc ? 'disk' : null };
  }
  return { elements: doc.elements, source: 'disk' };
}

/** pixel_1to1：ref-elements disposition=defer 须对应 fidelity_deferrals 且 human_signed */
export function findUnsignedRefElementDefers(
  refDoc: RefElementsDoc,
  deferrals: FidelityDeferralEntry[],
  opts?: { requireExplicitSigner?: boolean },
): string[] {
  const signedIds = new Set(
    deferrals.filter(d => isHumanSignedDeferral(d, opts)).map(d => d.element_id.toLowerCase()),
  );
  const declaredIds = new Set(deferrals.map(d => d.element_id.toLowerCase()));
  const violations: string[] = [];
  for (const el of refDoc.elements) {
    if (el.disposition !== 'defer') continue;
    const lower = el.element_id.toLowerCase();
    if (!declaredIds.has(lower)) {
      violations.push(`${el.element_id}（ref-elements defer 未登记 fidelity_deferrals）`);
    } else if (!signedIds.has(lower)) {
      violations.push(`${el.element_id}（fidelity_deferrals 未 human_signed）`);
    }
  }
  return violations;
}

/** P0 视觉元素 id 前缀/关键词（defer 须人类签字） */
export const P0_VISUAL_ELEMENT_HINTS = [
  'search_bar',
  'search',
  'promo_badge',
  'badge',
  'brand_logo',
  'logo',
  'nfc',
  'illustration',
  'semantic_color',
] as const;

export function isP0VisualElementId(elementId: string): boolean {
  const lower = elementId.toLowerCase();
  return P0_VISUAL_ELEMENT_HINTS.some(h => lower.includes(h));
}

// ============================================================================
// E0（多模态降级阶梯 plan d4a8f3c6）：能力感知 phase prompt 支撑函数
// ============================================================================

/**
 * 需求文本"涉及 UI"的宽松探测（比 detectPixel1to1Intent 的 1:1 强意图更宽泛——
 * 这里只判"是不是 UI 类需求"，不判保真强度）。首次 spec invoke 前 spec.md 不存在，
 * 无法读 ui_change 字段，只能退回需求文本启发式；spec.md 写出后应改用
 * UI_CHANGE_REQUIRES_UI_SPEC.has(parseUiChangeFromSpecMarkdown(...))（更权威）。
 */
const UI_RELEVANT_PATTERNS: readonly RegExp[] = [
  /页面/, /界面/, /截图/, /参考图/, /设计稿/, /视觉/, /还原/, /布局/, /组件/,
  /交互稿/, /原型图/, /配色/, /样式/, /图标/, /\bUI\b/i, /\bUX\b/i, /figma/i, /icon/i,
];

export function detectUiRelevantRequirement(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || !text.trim()) return false;
  return UI_RELEVANT_PATTERNS.some(re => re.test(text));
}

const OCR_PRESCAN_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function listImageFilesInDir(absDir: string): string[] {
  try {
    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return [];
    return fs
      .readdirSync(absDir)
      .filter(f => OCR_PRESCAN_IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
      .map(f => path.join(absDir, f))
      .sort();
  } catch {
    return [];
  }
}

/**
 * requirement 文本里锚定 features_dir（如 "doc/features"）起点的路径引用——CJK 文本没有
 * 空格分隔，"参考图在doc/features/..."里"在"与路径无缝相连，纯 bidirectional token 正则
 * 会把前缀中文动词一起吞进去（曾踩坑：把"参考图在doc"当一个 token，resolve 到不存在的
 * 目录）；反过来贪婪向后延伸又会把"...目录下"这类中文尾缀（口语描述，非路径段）一起吞掉。
 * 解法：只认**从 features_dir 字面量开始**的匹配（不吃前缀 prose），贪婪向后收集
 * `/segment` 直到分隔符终止，再从最长到最短逐段回缩找**磁盘上真实存在**的最长前缀——
 * 天然跳过"目录下"这类不存在的伪路径段，不必理解中文语法。
 */
function extractExistingRequirementPathRefs(requirement: string, projectRoot: string): string[] {
  const anchor = relFeaturesDir(projectRoot).replace(/\\/g, '/');
  if (!anchor) return [];
  const escapedAnchor = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escapedAnchor}(?:[\\\\/][\\w.\\u4e00-\\u9fa5-]+)*`, 'g');
  const matches = requirement.match(re) ?? [];
  const resolved: string[] = [];
  for (const m of matches) {
    const segments = m.split(/[\\/]/).filter(Boolean);
    for (let end = segments.length; end >= 1; end--) {
      const candidate = segments.slice(0, end).join('/');
      const abs = path.resolve(projectRoot, candidate);
      if (fs.existsSync(abs)) {
        resolved.push(abs);
        break; // 取最长存在前缀，命中即停，不再回缩更短的
      }
    }
  }
  return resolved;
}

/**
 * E0③（codex 采纳的参考图发现规则）：首次 spec invoke 前 spec.md / visual_handoff.
 * authoritative_refs 尚不存在，不能复用既有"从 spec 收集图片"的路径。deterministic
 * pre-scan 顺序：①requirement 文本中锚定 features_dir 的显式目录/文件路径引用 → 该目录下
 * 图片文件；②回退 feature 既有 ux-reference/ 目录；③扫不到图源 → 空数组（调用方据此跳过
 * OCR 预跑，绝不造假分母）。返回绝对路径，按文件名排序（确定性，供幂等 OCR 落盘用）。
 */
export function discoverReferenceImagesForOcrPrescan(
  projectRoot: string,
  feature: string,
  requirement: string | undefined,
): string[] {
  const found = new Set<string>();
  if (requirement) {
    for (const abs of extractExistingRequirementPathRefs(requirement, projectRoot)) {
      if (OCR_PRESCAN_IMAGE_EXTENSIONS.has(path.extname(abs).toLowerCase())) {
        if (fs.statSync(abs).isFile()) found.add(abs);
        continue;
      }
      for (const img of listImageFilesInDir(abs)) found.add(img);
    }
  }
  if (found.size === 0) {
    const uxRefDir = featureFilePath(projectRoot, feature, 'ux-reference');
    for (const img of listImageFilesInDir(uxRefDir)) found.add(img);
  }
  return [...found].sort();
}

/** 与 ocr-toolkit.ts 的 isOcrAvailable/ocrImageWords 同型（profile 侧真实签名的最小子集）。 */
export interface ProfileOcrToolkit {
  isOcrAvailable: () => boolean;
  ocrImageWords: (imagePath: string) => {
    ok: boolean;
    error?: string;
    width?: number;
    height?: number;
    words?: Array<{ text: string; conf: number; x0: number; y0: number; x1: number; y1: number }>;
  };
}

/**
 * OCR 工具链按 profileDir 通用路径动态加载——不硬编码 'hmos-app'（generic 等无 OCR 资产的
 * profile require 会失败，按设计返回 null，不是错误）。与 capability-registry.ts 的
 * provider 动态 require（path.join(resolved.profileDir, 'harness', 'providers', ...)）
 * 同构，供 harness-runner.ts（钳制探测）与 goal-runner.ts（E0 OCR 预扫描）共用，避免重复实现。
 */
export function loadProfileOcrToolkit(profileDir: string): ProfileOcrToolkit | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(profileDir, 'harness', 'ocr-toolkit')) as Partial<ProfileOcrToolkit>;
    if (typeof mod.isOcrAvailable !== 'function' || typeof mod.ocrImageWords !== 'function') return null;
    return { isOcrAvailable: mod.isOcrAvailable, ocrImageWords: mod.ocrImageWords };
  } catch {
    return null; // profile 无 OCR 工具链（如 generic）——非错误，按"无 OCR"处理
  }
}

export function probeProfileOcrAvailable(profileDir: string): boolean {
  const toolkit = loadProfileOcrToolkit(profileDir);
  return toolkit ? toolkit.isOcrAvailable() : false;
}
