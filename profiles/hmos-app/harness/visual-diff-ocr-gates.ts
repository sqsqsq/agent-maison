// ============================================================================
// visual-diff-ocr-gates.ts — OCR 文本信号门禁（T5 越界 / T1 文本-位置背离）
// ----------------------------------------------------------------------------
// 背景：像素统计度量经真机实测分不开"忠实 vs 崩坏"；能确定性分离的是 OCR 文本信号。
// 设计：OCR 函数注入（ocrFn 默认 ocrImageWords），使门禁逻辑可不跑真 OCR 单测。
// ============================================================================

import type { UiSpecGlobalElement } from '../../../harness/scripts/utils/ui-spec-shared';
import type { VisualDiffScreenEntry } from './visual-diff-check';
import { ocrImageWords, fuzzyTextInBand, type OcrResult } from './ocr-toolkit';

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
