// ============================================================================
// fidelity-shared.ts — fidelity_target / asset_acquisition_mode / severity ratchet
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';
import type { CheckContext } from './types';
import { parseVisualHandoffYamlRoot } from './ui-spec-shared';

const requireHarness = createRequire(path.resolve(__dirname, '../../harness-runner.ts'));
const YAML = requireHarness('yaml') as { parse: (s: string) => unknown };

export type FidelityTarget = 'pixel_1to1' | 'semantic_layout';
export type AssetAcquisitionMode = 'approximate' | 'auto_crop' | 'user_dir';

const FIDELITY_TARGETS = new Set<FidelityTarget>(['pixel_1to1', 'semantic_layout']);
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
 * 真人签字判据：human_signed:true 且 signed_by 非自动化身份。
 * signed_by 缺省视为人工（不破坏交互态既有行为）；仅显式自动化身份被拒。
 */
export function isHumanSignedDeferral(
  d: FidelityDeferralEntry,
  opts?: { requireExplicitSigner?: boolean },
): boolean {
  if (d.human_signed !== true) return false;
  if (isAutomationSigner(d.signed_by)) return false;
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
  const p = path.join(projectRoot, 'doc', 'features', feature, 'spec', 'spec.md');
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
  return path.join(projectRoot, 'doc', 'features', feature, 'spec', 'ref-elements.yaml');
}

export function assetManifestAbsPath(projectRoot: string, feature: string): string {
  return path.join(projectRoot, 'doc', 'features', feature, 'spec', 'asset-manifest.yaml');
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
