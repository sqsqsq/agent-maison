// ============================================================================
// image-toolkit.ts — 图像处理（jimp worker）+ CIEDE2000 纯 TS
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface LabColor {
  L: number;
  a: number;
  b: number;
}

const WORKER_PATH = path.join(__dirname, 'image-jimp-worker.cjs');
const HARNESS_ROOT = path.resolve(__dirname, '../../../harness');

function runJimpWorker(args: string[]): Record<string, unknown> {
  const result = spawnSync(process.execPath, [WORKER_PATH, ...args], {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    cwd: HARNESS_ROOT,
  });
  const raw = (result.stdout ?? '').trim();
  if (!raw) {
    return { ok: false, sampled: false, error: result.stderr?.trim() || 'jimp worker produced no output' };
  }
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, sampled: false, error: `invalid worker json: ${raw.slice(0, 120)}` };
  }
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace(/^#/, '').trim();
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (full.length === 8) {
    return {
      r: parseInt(full.slice(2, 4), 16),
      g: parseInt(full.slice(4, 6), 16),
      b: parseInt(full.slice(6, 8), 16),
    };
  }
  if (full.length !== 6) throw new Error(`invalid hex: ${hex}`);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function hexToLab(hex: string): LabColor {
  const { r, g, b } = hexToRgb(hex);
  return rgbToLab(r, g, b);
}

function rgbToLab(r: number, g: number, b: number): LabColor {
  let rr = r / 255;
  let gg = g / 255;
  let bb = b / 255;
  rr = rr > 0.04045 ? ((rr + 0.055) / 1.055) ** 2.4 : rr / 12.92;
  gg = gg > 0.04045 ? ((gg + 0.055) / 1.055) ** 2.4 : gg / 12.92;
  bb = bb > 0.04045 ? ((bb + 0.055) / 1.055) ** 2.4 : bb / 12.92;
  const x = (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) / 0.95047;
  const y = rr * 0.2126 + gg * 0.7152 + bb * 0.0722;
  const z = (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) / 1.08883;
  const fx = x > 0.008856 ? x ** (1 / 3) : 7.787 * x + 16 / 116;
  const fy = y > 0.008856 ? y ** (1 / 3) : 7.787 * y + 16 / 116;
  const fz = z > 0.008856 ? z ** (1 / 3) : 7.787 * z + 16 / 116;
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIEDE2000 ΔE */
export function deltaE2000(l1: LabColor, l2: LabColor): number {
  const { L: L1, a: a1, b: b1 } = l1;
  const { L: L2, a: a2, b: b2 } = l2;
  const avgL = (L1 + L2) / 2;
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const avgC = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(avgC ** 7 / (avgC ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const avgCp = (C1p + C2p) / 2;
  let h1p = Math.atan2(b1, a1p) * (180 / Math.PI);
  if (h1p < 0) h1p += 360;
  let h2p = Math.atan2(b2, a2p) * (180 / Math.PI);
  if (h2p < 0) h2p += 360;
  let dhp = h2p - h1p;
  if (dhp > 180) dhp -= 360;
  if (dhp < -180) dhp += 360;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const T =
    1 -
    0.17 * Math.cos((((h1p + h2p) / 2 - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((h1p + h2p) * Math.PI) / 180) +
    0.32 * Math.cos((((h1p + h2p) / 2 + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((h1p + h2p - 63) * Math.PI) / 180);
  const dRo = 30 * Math.exp(-Math.pow(((h1p + h2p) / 2 - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(avgCp ** 7 / (avgCp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (avgL - 50) ** 2) / Math.sqrt(20 + (avgL - 50) ** 2);
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(2 * dRo * Math.PI / 180) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 +
      (dCp / Sc) ** 2 +
      (dHp / Sh) ** 2 +
      Rt * (dCp / Sc) * (dHp / Sh),
  );
}

const NEAR_WHITE = 240;
const NEAR_BLACK = 20;

export function isNearWhiteOrBlack(r: number, g: number, b: number): boolean {
  if (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) return true;
  if (r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK) return true;
  return false;
}

/** 区域众数采色（jimp worker，同步 spawn） */
export function sampleColorFromBbox(
  imagePath: string,
  bbox: number[],
  padding = 0.02,
): { hex: string; sampled: boolean; error?: string } {
  if (!fs.existsSync(imagePath)) {
    return { hex: '#000000', sampled: false, error: 'image not found' };
  }
  if (!isJimpAvailable()) {
    return { hex: '#000000', sampled: false, error: 'jimp not installed' };
  }
  if (bbox.length !== 4) {
    return { hex: '#000000', sampled: false, error: 'bbox must have 4 numbers' };
  }
  const out = runJimpWorker([
    'sample',
    imagePath,
    ...bbox.map(String),
    String(padding),
  ]);
  if (out.sampled === true && typeof out.hex === 'string') {
    return { hex: out.hex, sampled: true };
  }
  return {
    hex: '#000000',
    sampled: false,
    error: typeof out.error === 'string' ? out.error : 'sample failed',
  };
}

/** 宽松框裁图（jimp worker，同步 spawn） */
export function cropAssetFromBbox(
  imagePath: string,
  bbox: number[],
  outPath: string,
  padding = 0.02,
): { ok: boolean; error?: string } {
  if (!isJimpAvailable()) {
    return { ok: false, error: 'jimp not installed' };
  }
  if (!fs.existsSync(imagePath)) {
    return { ok: false, error: 'image not found' };
  }
  if (bbox.length !== 4) {
    return { ok: false, error: 'bbox must have 4 numbers' };
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const out = runJimpWorker([
    'crop',
    imagePath,
    ...bbox.map(String),
    String(padding),
    outPath,
  ]);
  if (out.ok === true && fs.existsSync(outPath)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: typeof out.error === 'string' ? out.error : 'crop failed',
  };
}

/** 尺寸归一后 RGB 直方图余弦相似度 ∈ [0,1]（半定量 score_floor 用） */
export function computeHistogramSimilarity(
  imagePathA: string,
  imagePathB: string,
): { ok: boolean; similarity?: number; error?: string } {
  if (!isJimpAvailable()) {
    return { ok: false, error: 'jimp not installed' };
  }
  if (!fs.existsSync(imagePathA)) {
    return { ok: false, error: `image A not found: ${imagePathA}` };
  }
  if (!fs.existsSync(imagePathB)) {
    return { ok: false, error: `image B not found: ${imagePathB}` };
  }
  const out = runJimpWorker(['hist-sim', imagePathA, imagePathB]);
  if (out.ok === true && typeof out.similarity === 'number') {
    return { ok: true, similarity: out.similarity };
  }
  return {
    ok: false,
    error: typeof out.error === 'string' ? out.error : 'hist-sim failed',
  };
}

/** N×N 分块最小直方图相似度（score_floor 哨兵用） */
export function computeTileMinSimilarity(
  imagePathA: string,
  imagePathB: string,
  grid = 4,
): { ok: boolean; similarity?: number; error?: string } {
  if (!isJimpAvailable()) {
    return { ok: false, error: 'jimp not installed' };
  }
  if (!fs.existsSync(imagePathA) || !fs.existsSync(imagePathB)) {
    return { ok: false, error: 'image not found' };
  }
  const out = runJimpWorker(['tile-min', imagePathA, imagePathB, String(grid)]);
  if (out.ok === true && typeof out.similarity === 'number') {
    return { ok: true, similarity: out.similarity };
  }
  return {
    ok: false,
    error: typeof out.error === 'string' ? out.error : 'tile-min failed',
  };
}

/**
 * 边缘密度 tile 网格（v2 哨兵）。采集层与 check 层共享此网格做坐标对账：
 * over_threshold_tiles 的 [row,col] ∈ [0,ROWS)×[0,COLS)。
 */
export const EDGE_TILE_ROWS = 8;
export const EDGE_TILE_COLS = 6;
/** 单 tile z-MAD 超阈判定（worker 内逐 tile）；经验拉伸 FP 地板下的结构差异分界，可调 */
export const EDGE_STRUCT_THRESHOLD = 0.55;
/**
 * 触发边缘哨兵 WARN 的最小「未被 defect.bbox 覆盖」tile 数（check 层）。
 * 经合成 FP 探针：忠实设备图（同内容 + 设备比例 + 状态栏偏移）拉伸对齐后约 3 个 tile 为纯 FP 地板；
 * 真缺陷屏 ≥6（add_card 6 / mine 8 / home 10）。取 5 落在 3 与 6 之间——吸收 FP 地板，仅在
 * ≥5 个未登记 tile 时 WARN（仍低置信、永不 gate）。三常量均为 FP 校准旋钮，集中于此便于调。
 * 注：5 为当前约束下**暂定值**——唯一干净 FP 样本是合成探针(3)，真·忠实真机渲染样本尚不存在
 * （这正是 round2 的起因）；待门禁逼宿主修好 home 后，应拿**修好的 home** 重跑 edge-tile，
 * 若掉到 <5 静默，才终验「忠实渲染不误报、坏渲染命中」并据此定稿地板。
 */
export const EDGE_SENTINEL_MIN_UNCOVERED = 5;

/**
 * 参考图 vs 实现截图的结构散度分块（半定量、布局敏感，补直方图盲区）。
 * worker 两图灰度拉伸到统一 TW×TH（整页对整页对齐）→ 逐 tile z-归一像素 MAD（结构差异，亮度不变）。
 * 返回 max 散度 ∈ [0,1] 与超阈 tile 的 [row,col] 列表（worker 内按阈值判定）。
 * 注：mockup≠device 像素本就不对齐、整屏基线偏高 → 仅作 WARN 低置信兜底，永不单独 gate。
 */
export function computeEdgeDensityTileDivergence(
  refPath: string,
  shotPath: string,
): { ok: boolean; divergence?: number; tiles?: number[][]; error?: string } {
  if (!isJimpAvailable()) {
    return { ok: false, error: 'jimp not installed' };
  }
  if (!fs.existsSync(refPath)) {
    return { ok: false, error: `ref not found: ${refPath}` };
  }
  if (!fs.existsSync(shotPath)) {
    return { ok: false, error: `shot not found: ${shotPath}` };
  }
  const out = runJimpWorker([
    'edge-tile',
    refPath,
    shotPath,
    String(EDGE_TILE_ROWS),
    String(EDGE_TILE_COLS),
    String(EDGE_STRUCT_THRESHOLD),
  ]);
  if (out.ok === true && typeof out.divergence === 'number') {
    const tiles = Array.isArray(out.tiles)
      ? (out.tiles as unknown[]).filter(
          (t): t is number[] => Array.isArray(t) && t.length === 2 && t.every(n => typeof n === 'number'),
        )
      : [];
    return { ok: true, divergence: Math.max(0, Math.min(1, out.divergence)), tiles };
  }
  return {
    ok: false,
    error: typeof out.error === 'string' ? out.error : 'edge-tile failed',
  };
}

export interface ImageStats {
  ok: boolean;
  width?: number;
  height?: number;
  /** 4bit/通道量化后唯一色数（≤64×64 下采样统计） */
  uniqueColors?: number;
  /** 灰度标准差 0-255（纯色≈0） */
  lumaStddev?: number;
  /** 非近白/近黑像素占比（空白裁图≈0） */
  contentRatio?: number;
  error?: string;
}

/** 图像内容统计（P0-B 裁剪产物验真的纯色/空白 sanity 用，jimp worker 同步 spawn） */
export function computeImageStats(imagePath: string): ImageStats {
  if (!isJimpAvailable()) return { ok: false, error: 'jimp not installed' };
  if (!fs.existsSync(imagePath)) return { ok: false, error: `image not found: ${imagePath}` };
  const out = runJimpWorker(['stats', imagePath]);
  if (out.ok === true && typeof out.uniqueColors === 'number') {
    return out as unknown as ImageStats;
  }
  return { ok: false, error: typeof out.error === 'string' ? out.error : 'stats failed' };
}

export interface ContactSheetEntry {
  key: string;
  bbox: number[];
  cropPath: string;
}

/**
 * 贴回对照 contact-sheet（P0-B 证据落盘）：左＝原图+bbox 红框，右＝crop 缩略图纵排。
 * args 经临时 JSON 文件传 worker（entries 可多、避免 argv 长度限制）。
 */
export function renderContactSheet(
  sourceImagePath: string,
  entries: ContactSheetEntry[],
  outPath: string,
): { ok: boolean; missing?: number; error?: string } {
  if (!isJimpAvailable()) return { ok: false, error: 'jimp not installed' };
  if (!fs.existsSync(sourceImagePath)) return { ok: false, error: `source not found: ${sourceImagePath}` };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const argsPath = path.join(
    require('os').tmpdir(),
    `contact-args-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
  );
  fs.writeFileSync(argsPath, JSON.stringify({ source: sourceImagePath, outPath, entries }), 'utf-8');
  try {
    const out = runJimpWorker(['contact', argsPath]);
    if (out.ok === true && fs.existsSync(outPath)) {
      return { ok: true, missing: typeof out.missing === 'number' ? out.missing : 0 };
    }
    return { ok: false, error: typeof out.error === 'string' ? out.error : 'contact sheet failed' };
  } finally {
    try { fs.unlinkSync(argsPath); } catch { /* ignore */ }
  }
}

export function isJimpAvailable(): boolean {
  try {
    require.resolve('jimp', { paths: [HARNESS_ROOT] });
    return true;
  } catch {
    return false;
  }
}

export interface ImageDims {
  /** 像素宽（无法解析则 null） */
  w: number | null;
  /** 像素高（无法解析则 null） */
  h: number | null;
  /** 文件字节数 */
  bytes: number;
  /** 'png' | 'jpeg' | null（未识别格式） */
  format: 'png' | 'jpeg' | null;
}

/**
 * 读图尺寸/字节——**不依赖 jimp**，纯解析 PNG/JPEG 文件头。
 * 供 B 占位退化判定：pixel_1to1 下即便 jimp 不可用，也能判 1×1 / 过小 / 非法 PNG（Q4 决策：不 SKIP）。
 * PNG：8B 签名 + IHDR，W/H 为 offset 16/20 的 big-endian uint32。
 * JPEG：扫 SOF0–SOF15（除 DHT 0xC4 / JPG 0xC8 / DAC 0xCC）取 H/W。
 * 其它格式（webp 等）：仅返回 bytes，w/h=null（占位判定回落到字节/面积信号）。
 */
export function readImageDimensions(absPath: string): ImageDims | null {
  if (!fs.existsSync(absPath)) return null;
  let bytes: number;
  let buf: Buffer;
  try {
    bytes = fs.statSync(absPath).size;
    const fd = fs.openSync(absPath, 'r');
    try {
      const cap = Math.min(bytes, 65536);
      buf = Buffer.alloc(cap);
      fs.readSync(fd, buf, 0, cap, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
  // PNG
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes, format: 'png' };
  }
  // JPEG
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < buf.length) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(off + 7), h: buf.readUInt16BE(off + 5), bytes, format: 'jpeg' };
      }
      const segLen = buf.readUInt16BE(off + 2);
      if (segLen < 2) break;
      off += 2 + segLen;
    }
    return { w: null, h: null, bytes, format: 'jpeg' };
  }
  return { w: null, h: null, bytes, format: null };
}
