// ============================================================================
// visual-diff-ocr-gates.ts — OCR 文本信号门禁（T5 越界 / T1 文本-位置背离）
// ----------------------------------------------------------------------------
// 背景：像素统计度量经真机实测分不开"忠实 vs 崩坏"；能确定性分离的是 OCR 文本信号。
// 设计：OCR 函数注入（ocrFn 默认 ocrImageWords），使门禁逻辑可不跑真 OCR 单测。
// ============================================================================

import type { UiSpecGlobalElement } from '../../../harness/scripts/utils/ui-spec-shared';
import type { VisualDiffScreenEntry } from './visual-diff-check';
import { ocrImageWords, fuzzyTextInBand, fuzzyTextPresent, type OcrResult } from './ocr-toolkit';

export type OcrFn = (shotAbs: string) => OcrResult;

const DEFAULT_TAB_BAND_START = 0.85;

export interface OutOfBoundsViolation {
  screen_id: string;
  element_id: string;
  texts: string[];
}

export interface OutOfBoundsResult {
  violations: OutOfBoundsViolation[];
  /**
   * 声明了 global_elements 须检测、但 OCR 不可用/失败的非属主屏 screen_id（去重）。
   * 这些屏"无法确认是否越界"——调用方须降 WARN 复核，**不得静默放过**（OCR 不可用 ≠ 没泄漏）。
   */
  ocrUnavailable: string[];
}

/**
 * T5：声明式全局元素越界——某全局元素（如底部 Tab，texts=['首页','我的']）出现在**非所属屏**的
 * 指定 band（默认底部 0.85–1）内 = 越界。判据＝声明归属（SSOT）+ OCR 文本命中，不靠 root 类型猜。
 *
 * 仅对有截图的非属主屏检测；texts 须**全部**命中于 band 才算该元素出现（避免正文偶含"我的"单字误报）。
 * OCR 不可用/失败的屏不会判越界（不误报），但会进 `ocrUnavailable` 让调用方降 WARN（不静默 SKIP，对齐设计意图）。
 */
export function collectOutOfBoundsGlobalElements(
  globalElements: UiSpecGlobalElement[] | undefined,
  screens: VisualDiffScreenEntry[],
  resolveShotAbs: (rel: string) => string,
  ocrFn: OcrFn = ocrImageWords,
): OutOfBoundsResult {
  if (!Array.isArray(globalElements) || globalElements.length === 0) {
    return { violations: [], ocrUnavailable: [] };
  }
  const violations: OutOfBoundsViolation[] = [];
  const ocrUnavailable = new Set<string>();
  // 缓存每屏 OCR（一屏可能被多个全局元素检测，避免重复 OCR）
  const ocrCache = new Map<string, OcrResult>();

  for (const ge of globalElements) {
    if (!ge || !Array.isArray(ge.texts) || ge.texts.length === 0) continue;
    const ownerSet = new Set(ge.owner_screen_ids ?? []);
    const bandStart = ge.band?.start ?? DEFAULT_TAB_BAND_START;
    const bandEnd = ge.band?.end ?? 1;

    for (const s of screens) {
      if (ownerSet.has(s.screen_id)) continue; // 属主屏，合法
      const shot = s.screenshot_path;
      if (typeof shot !== 'string' || !shot.trim()) continue;
      let res = ocrCache.get(s.screen_id);
      if (!res) {
        res = ocrFn(resolveShotAbs(shot));
        ocrCache.set(s.screen_id, res);
      }
      if (!res.ok || !Array.isArray(res.words)) {
        ocrUnavailable.add(s.screen_id); // OCR 不可用/失败 → 须降级复核，不静默
        continue;
      }
      const allInBand = ge.texts.every(t => fuzzyTextInBand(res!.words!, t, bandStart, bandEnd));
      if (allInBand) {
        violations.push({ screen_id: s.screen_id, element_id: ge.id, texts: ge.texts });
      }
    }
  }
  return { violations, ocrUnavailable: [...ocrUnavailable] };
}

// ---- T1（窄）：声明的关键锚点文本整块缺失 = missing-render ----
// 经两次真机实测：像素统计 与 OCR 文本-位置 都分不开"忠实 vs 崩坏"（device≠mockup 使忠实屏位置也大偏移）。
// 唯一对 device≠mockup 鲁棒的 OCR 信号是**文本存在性**。故 T1 只保留高置信窄门禁：屏声明的关键锚点文本
// **整块缺失**（OCR 全文都找不到）= 该区域没渲染出文字。**只在缺失比例高（gross）时触发**，吸收 OCR 掉字噪声、不误伤。

export interface GrossMissingViolation {
  screen_id: string;
  declared: number;
  missing: string[];
}
export interface GrossMissingResult {
  violations: GrossMissingViolation[];
  ocrUnavailable: string[];
}

/** 锚点文本最短长度（单字易与正文/OCR 噪声混淆，只取 ≥2 字的稳定锚点） */
const MIN_ANCHOR_LEN = 2;
/** 触发 gross-missing 的最少声明锚点数（太少不足以判"整块缺失" vs OCR 偶失） */
const MIN_ANCHORS_FOR_GATE = 3;
/** 缺失比例阈值——只在过半锚点缺失（整区域没渲染文字）才判，吸收 OCR 掉字 FP */
const DEFAULT_MISSING_FRACTION = 0.5;

/**
 * T1（窄）：声明锚点文本整块缺失。screenAnchors：screen_id → 该屏 ui-spec 声明的关键文本（调用方从 text 节点收集）。
 * 仅当该屏声明锚点 ≥MIN_ANCHORS_FOR_GATE 且缺失比例 ≥missingFraction 才判 violation（gross missing-render）。
 * OCR 不可用/失败 → 不误判、进 ocrUnavailable 降级。
 */
export function collectGrossMissingAnchorText(
  screenAnchors: Map<string, string[]>,
  screens: VisualDiffScreenEntry[],
  resolveShotAbs: (rel: string) => string,
  ocrFn: OcrFn = ocrImageWords,
  missingFraction: number = DEFAULT_MISSING_FRACTION,
): GrossMissingResult {
  const violations: GrossMissingViolation[] = [];
  const ocrUnavailable = new Set<string>();
  for (const s of screens) {
    const anchorsRaw = screenAnchors.get(s.screen_id);
    if (!anchorsRaw) continue;
    const anchors = [...new Set(anchorsRaw.map(a => a.trim()).filter(a => a.length >= MIN_ANCHOR_LEN))];
    if (anchors.length < MIN_ANCHORS_FOR_GATE) continue; // 锚点太少，不足以判整块缺失
    const shot = s.screenshot_path;
    if (typeof shot !== 'string' || !shot.trim()) continue;
    const res = ocrFn(resolveShotAbs(shot));
    if (!res.ok || !Array.isArray(res.words)) { ocrUnavailable.add(s.screen_id); continue; }
    const missing = anchors.filter(a => !fuzzyTextPresent(res.words!, a));
    if (missing.length / anchors.length >= missingFraction) {
      violations.push({ screen_id: s.screen_id, declared: anchors.length, missing });
    }
  }
  return { violations, ocrUnavailable: [...ocrUnavailable] };
}
