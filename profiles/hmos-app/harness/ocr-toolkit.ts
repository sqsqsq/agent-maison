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

// ============================================================================
// E6（多模态降级阶梯 plan d4a8f3c6）：噪声过滤 + 候选真文本提取 + 列分组
// ----------------------------------------------------------------------------
// ②"同源化"：以下与 capture-completeness-check.ts 门禁侧**同一份**函数（原本各自定义），
// 移到本文件统一导出——E0 goal-runner 的 OCR 预扫描（agent 上下文）与 E3 门禁匹配
// （capture_completeness_external）现在跑的是完全相同的清洗/聚类逻辑，不会"agent 看到
// 一种切分结果、门禁按另一种切分结果判定"。
// ============================================================================

/** 去空白（轻规整，不做激进归一）——覆盖率匹配与噪声过滤共用同一份。 */
export const norm = (s: string): string => s.replace(/\s+/g, '');
export const CJK_RE = /[一-鿿]/g;
/** 状态栏 band：mockup 顶部时间/电量/信号区，OCR 行中心 y 低于此值剔除 */
export const EXTERNAL_AUDIT_STATUS_BAR_BAND = 0.045;

/** 采集屏 OCR 行清单（状态栏剔除 + 噪声过滤）。单字符默认剔除（pagination 点/角标误报面大，诚实边界记录）。 */
export function collectAuditableOcrLines(lines: OcrLine[]): OcrLine[] {
  return lines.filter(l => {
    const t = norm(l.text);
    if (t.length < 2) return false;
    const cy = l.box[1] + l.box[3] / 2;
    if (cy < EXTERNAL_AUDIT_STATUS_BAR_BAND) return false; // 状态栏
    if (/^\d{1,2}:\d{2}$/.test(t)) return false; // 时间（状态栏兜底）
    const cjk = (t.match(CJK_RE) ?? []).length;
    const isMoneyLike = /[¥￥$]|\d+\.\d+/.test(t);
    // 无 CJK 且非金额样式（纯符号/OCR 噪声）→ 剔除；金额（¥119.40）保留
    if (cjk === 0 && !isMoneyLike) return false;
    return true;
  });
}

export interface LikelyRealTextRun {
  /** 提取出的最长连续 CJK 游程——大概率是真文案（logo/品牌名常被 OCR 误识别出乱码前后缀）。 */
  candidate: string;
  noisePrefix: string;
  noiseSuffix: string;
}

/**
 * E3③/E6①（案B chrys 银行卡实证："人《AA招商银行"这类噪声前缀+真文本混合行）：
 * 提取行文本中**最长连续 CJK 游程**作为候选真文案，其余记为噪声前后缀——不是精确算法
 * （OCR 噪声本身也可能是 CJK 形近误识别，如"(时农业银行"里的"时"会被并入候选），但比
 * 把整行当不透明噪声块丢给人工核对好得多：诚实边界——本函数只降噪辅助阅读，不替代人工
 * 判断，调用方仍须把 candidate 当"建议"而非"确定正确"。候选 <2 字（含空）返回 null
 * （太短的 CJK 游程噪声概率高，不值得单独提取）。
 */
export function extractLikelyRealTextRun(lineText: string): LikelyRealTextRun | null {
  const chars = [...lineText];
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i <= chars.length; i++) {
    const isCjk = i < chars.length && CJK_RE.test(chars[i]);
    CJK_RE.lastIndex = 0; // test() 全局正则须手动复位 lastIndex，否则交替 true/false
    if (isCjk) {
      if (curStart < 0) curStart = i;
      curLen++;
    } else {
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return null;
  return {
    candidate: chars.slice(bestStart, bestStart + bestLen).join(''),
    noisePrefix: chars.slice(0, bestStart).join(''),
    noiseSuffix: chars.slice(bestStart + bestLen).join(''),
  };
}

/**
 * E6①：行内按 x 方向显著 gap 拆分列分组（辅助结构推断——"标签在左、数值在右"一类同行
 * 双元素布局）。gap 阈值 = 该行内相邻词平均宽度的 1.5 倍（经验值，非精确布局分析）；
 * 无显著 gap（单一视觉块）时返回单元素数组（原文本整体）。
 */
export function detectColumnGroups(line: OcrLine): string[] {
  if (line.words.length < 2) return [line.text];
  const sorted = [...line.words].sort((a, b) => a.bbox[0] - b.bbox[0]);
  const avgWidth = sorted.reduce((sum, w) => sum + w.bbox[2], 0) / sorted.length;
  const gapThreshold = avgWidth * 1.5;
  const groups: string[][] = [[sorted[0].text]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const gap = cur.bbox[0] - (prev.bbox[0] + prev.bbox[2]);
    if (gap > gapThreshold) {
      groups.push([cur.text]);
    } else {
      groups[groups.length - 1].push(cur.text);
    }
  }
  return groups.map(g => g.join(''));
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
