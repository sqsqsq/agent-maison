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
): string[] {
  const signedIds = new Set(
    deferrals.filter(d => d.human_signed).map(d => d.element_id.toLowerCase()),
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
