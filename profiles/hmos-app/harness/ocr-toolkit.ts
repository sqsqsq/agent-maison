// ============================================================================
// ocr-toolkit.ts — tesseract.js chi_sim 文本框识别封装（T0）
// ----------------------------------------------------------------------------
// 背景：视觉裁判的像素统计度量经真机样本实测分不开"忠实 vs 崩坏"（区域SSIM 把崩坏 card_pack
//   排在忠实 mine 之上、CROSS 对照=测噪声）。能确定性分离的是**语义/文本**信号——OCR 读出
//   关键文案的存在与位置（如非 home 屏底部出现"首页/我的"=泄漏 tab）。本模块即该能力。
// 架构：与 image-toolkit 同构——采集层（异步/有副作用）spawnSync 调 ocr-worker.cjs 算好、写进
//   visual-diff.json，校验层（同步）读用。OCR 不可用一律优雅降级（ok:false），由门禁降 WARN 不 SKIP。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const WORKER_PATH = path.join(__dirname, 'ocr-worker.cjs');
const HARNESS_ROOT = path.resolve(__dirname, '../../../harness');
/** chi_sim.traineddata 本地物化目录（profiles/hmos-app/vendor/tessdata），绝不运行时 CDN 拉 */
const TESSDATA_DIR = path.resolve(__dirname, '../vendor/tessdata');
const OCR_TIMEOUT_MS = 60_000;

export interface OcrWord {
  text: string;
  /** 置信度 0-100 */
  conf: number;
  /** [x, y, w, h] 归一化 ∈ [0,1]（除以本图自身 W/H，跨设备/mockup 尺寸差仍可比相对位置） */
  bbox: [number, number, number, number];
}

export interface OcrResult {
  ok: boolean;
  width?: number;
  height?: number;
  words?: OcrWord[];
  error?: string;
}

/** tesseract.js 可解析 且 chi_sim 语言数据已物化 */
export function isOcrAvailable(): boolean {
  try {
    require.resolve('tesseract.js', { paths: [HARNESS_ROOT] });
  } catch {
    return false;
  }
  return fs.existsSync(path.join(TESSDATA_DIR, 'chi_sim.traineddata'));
}

/**
 * 对单图跑 OCR，返回归一化文本框。任何失败（未安装/无数据/超时/图损坏）→ ok:false（不抛、不阻断采集）。
 */
export function ocrImageWords(imagePath: string): OcrResult {
  if (!isOcrAvailable()) {
    return { ok: false, error: 'ocr unavailable (tesseract.js 未安装或 chi_sim 未物化)' };
  }
  if (!fs.existsSync(imagePath)) {
    return { ok: false, error: `image not found: ${imagePath}` };
  }
  const proc = spawnSync(process.execPath, [WORKER_PATH, imagePath, TESSDATA_DIR], {
    encoding: 'utf-8',
    cwd: HARNESS_ROOT,
    maxBuffer: 64 * 1024 * 1024,
    timeout: OCR_TIMEOUT_MS,
  });
  const raw = (proc.stdout ?? '').trim();
  if (!raw) {
    return { ok: false, error: proc.stderr?.trim() || 'ocr worker produced no output' };
  }
  try {
    const parsed = JSON.parse(raw) as OcrResult;
    if (parsed.ok && Array.isArray(parsed.words)) return parsed;
    return { ok: false, error: parsed.error ?? 'ocr worker returned ok:false' };
  } catch {
    return { ok: false, error: `invalid worker json: ${raw.slice(0, 120)}` };
  }
}

// ---- 模糊文本工具（OCR 有掉字/乱码：实测"添加卡片"→"添卡片"，须容错匹配，禁精确相等）----

/** 去空白 + 统一全角/半角的轻规整（不做激进归一，仅吸收 OCR 常见噪声边界） */
function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, '');
}

/**
 * target 是否"模糊出现"于 OCR 全文（拼接所有 word.text）。判据：target 去空白后，其字符按序
 * 在文本中的最长连续/近似命中 ≥ minRatio（默认 0.6）——容忍 OCR 掉 1~2 字（"添加卡片"→"添卡片" 仍命中）。
 */
export function fuzzyTextPresent(words: OcrWord[], target: string, minRatio = 0.6): boolean {
  const t = normalizeForMatch(target);
  if (!t) return false;
  const hay = normalizeForMatch(words.map(w => w.text).join(''));
  if (hay.includes(t)) return true;
  // 逐字按序匹配命中率（吸收掉字/乱码）
  let i = 0;
  let hit = 0;
  for (const ch of t) {
    const found = hay.indexOf(ch, i);
    if (found >= 0) { hit++; i = found + 1; }
  }
  return hit / t.length >= minRatio;
}

/**
 * 找出"模糊命中 target 任一字"的 word（用于定位文本所在区域/band）。
 * 返回命中 word（其 bbox 中心 y 用于判 band，如底部 tab）。
 */
export function findFuzzyWords(words: OcrWord[], target: string): OcrWord[] {
  const chars = new Set(normalizeForMatch(target).split(''));
  if (chars.size === 0) return [];
  return words.filter(w => {
    const wt = normalizeForMatch(w.text);
    return [...wt].some(c => chars.has(c));
  });
}

/**
 * target 在 hay 中的按序字符命中率 ∈ [0,1]（吸收 OCR 掉字/乱码；包含子串=1）。
 * fuzzyTextPresent 的返回比率版，供需要拿命中强度做排序/阈值的调用方（如 bbox 语义门禁的候选行匹配）。
 */
export function fuzzyMatchRatio(hay: string, target: string): number {
  const t = normalizeForMatch(target);
  const h = normalizeForMatch(hay);
  if (!t) return 0;
  if (h.includes(t)) return 1;
  let i = 0;
  let hit = 0;
  for (const ch of t) {
    const found = h.indexOf(ch, i);
    if (found >= 0) { hit++; i = found + 1; }
  }
  return hit / t.length;
}

export interface OcrLine {
  /** 行内 word 按 x 排序拼接的文本 */
  text: string;
  /** 行联合框 [x,y,w,h] 归一化 */
  box: [number, number, number, number];
  words: OcrWord[];
}

/**
 * 词→行聚类：纵向重叠 ≥50%（相对较矮者）归同一行，行框取联合框。
 * tesseract 把一句话拆成多词、每词一框——与 ui-spec 文本节点（整句一框）比对 IoU 前必须先聚成行，
 * 否则单词框对整句框 IoU 被稀释（OCR spike 实测：联合框法 median IoU 被拉到 ~0.06，行聚类后判定 22:0 干净分离）。
 */
export function clusterOcrLines(words: OcrWord[]): OcrLine[] {
  const lines: Array<{ words: OcrWord[]; box: [number, number, number, number] }> = [];
  const sorted = [...words].sort((a, b) => a.bbox[1] - b.bbox[1]);
  for (const w of sorted) {
    let placed = false;
    for (const line of lines) {
      const [, ly, , lh] = line.box;
      const overlap = Math.min(ly + lh, w.bbox[1] + w.bbox[3]) - Math.max(ly, w.bbox[1]);
      if (overlap >= 0.5 * Math.min(lh, w.bbox[3])) {
        line.words.push(w);
        const x1 = Math.min(line.box[0], w.bbox[0]);
        const y1 = Math.min(ly, w.bbox[1]);
        const x2 = Math.max(line.box[0] + line.box[2], w.bbox[0] + w.bbox[2]);
        const y2 = Math.max(ly + lh, w.bbox[1] + w.bbox[3]);
        line.box = [x1, y1, x2 - x1, y2 - y1];
        placed = true;
        break;
      }
    }
    if (!placed) lines.push({ words: [w], box: [...w.bbox] as [number, number, number, number] });
  }
  return lines.map(l => ({
    text: [...l.words].sort((a, b) => a.bbox[0] - b.bbox[0]).map(w => w.text).join(''),
    box: l.box,
    words: l.words,
  }));
}

/** word 的 bbox 中心 y（归一化）；用于 band 判定（如底部 tab band > 0.85） */
export function wordCenterY(w: OcrWord): number {
  return w.bbox[1] + w.bbox[3] / 2;
}

/** target 是否出现在某纵向 band（[bandStart, bandEnd] 归一化）内——如底部 tab 区 */
export function fuzzyTextInBand(
  words: OcrWord[],
  target: string,
  bandStart: number,
  bandEnd = 1,
): boolean {
  const banded = words.filter(w => {
    const cy = wordCenterY(w);
    return cy >= bandStart && cy <= bandEnd;
  });
  return fuzzyTextPresent(banded, target);
}
