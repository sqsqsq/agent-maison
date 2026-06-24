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

export function isJimpAvailable(): boolean {
  try {
    require.resolve('jimp', { paths: [HARNESS_ROOT] });
    return true;
  } catch {
    return false;
  }
}
