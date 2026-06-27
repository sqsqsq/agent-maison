#!/usr/bin/env node
'use strict';

/**
 * jimp worker — bbox 语义 SSOT：[x, y, w, h] 归一化（见 ui-spec.schema.json）
 * argv: crop <imagePath> <x> <y> <w> <h> <padding> <outPath>
 *       sample <imagePath> <x> <y> <w> <h> <padding>
 */

const path = require('path');
const harnessRoot = path.resolve(__dirname, '../../../harness');
const Jimp = require(require.resolve('jimp', { paths: [harnessRoot] }));

const NEAR_WHITE = 240;
const NEAR_BLACK = 20;
const EDGE_STRUCT_THRESHOLD = 0.55;

function isNearWhiteOrBlack(r, g, b) {
  if (r >= NEAR_WHITE && g >= NEAR_WHITE && b >= NEAR_WHITE) return true;
  if (r <= NEAR_BLACK && g <= NEAR_BLACK && b <= NEAR_BLACK) return true;
  return false;
}

function rgbToHex(r, g, b) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** [x,y,w,h] 归一化 → 像素矩形 + padding */
function bboxPixels(img, bbox, padding) {
  const iw = img.bitmap.width;
  const ih = img.bitmap.height;
  const [nx, ny, nw, nh] = bbox.map(Number);
  const padX = nw * padding;
  const padY = nh * padding;
  const left = Math.max(0, nx - padX);
  const top = Math.max(0, ny - padY);
  const right = Math.min(1, nx + nw + padX);
  const bottom = Math.min(1, ny + nh + padY);
  const x = Math.max(0, Math.floor(left * iw));
  const y = Math.max(0, Math.floor(top * ih));
  const x2 = Math.min(iw, Math.ceil(right * iw));
  const y2 = Math.min(ih, Math.ceil(bottom * ih));
  const cw = Math.max(1, x2 - x);
  const ch = Math.max(1, y2 - y);
  return { x, y, cw, ch, w: iw, h: ih };
}

/** crop 后 auto-trim 近白/近黑边缘（文档「宽松框 + trim」） */
function trimUniformEdges(img, minContentRatio = 0.12) {
  const { width: w, height: h, data } = img.bitmap;
  const isContent = (px, py) => {
    const idx = (py * w + px) << 2;
    return !isNearWhiteOrBlack(data[idx], data[idx + 1], data[idx + 2]);
  };
  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  while (top < bottom) {
    let content = 0;
    for (let px = left; px <= right; px++) if (isContent(px, top)) content++;
    if (content / (right - left + 1) >= minContentRatio) break;
    top++;
  }
  while (bottom > top) {
    let content = 0;
    for (let px = left; px <= right; px++) if (isContent(px, bottom)) content++;
    if (content / (right - left + 1) >= minContentRatio) break;
    bottom--;
  }
  while (left < right) {
    let content = 0;
    for (let py = top; py <= bottom; py++) if (isContent(left, py)) content++;
    if (content / (bottom - top + 1) >= minContentRatio) break;
    left++;
  }
  while (right > left) {
    let content = 0;
    for (let py = top; py <= bottom; py++) if (isContent(right, py)) content++;
    if (content / (bottom - top + 1) >= minContentRatio) break;
    right--;
  }
  if (right <= left || bottom <= top) return img;
  return img.clone().crop(left, top, right - left + 1, bottom - top + 1);
}

async function runCrop(imagePath, bbox, padding, outPath) {
  const img = await Jimp.read(imagePath);
  const { x, y, cw, ch } = bboxPixels(img, bbox, padding);
  let cropped = img.clone().crop(x, y, cw, ch);
  cropped = trimUniformEdges(cropped);
  await cropped.writeAsync(outPath);
  return { ok: true, width: cropped.bitmap.width, height: cropped.bitmap.height };
}

async function runSample(imagePath, bbox, padding) {
  const img = await Jimp.read(imagePath);
  const { x, y, cw, ch, w } = bboxPixels(img, bbox, padding);
  const counts = new Map();
  let total = 0;
  for (let py = y; py < y + ch; py++) {
    for (let px = x; px < x + cw; px++) {
      const idx = (py * w + px) << 2;
      const r = img.bitmap.data[idx];
      const g = img.bitmap.data[idx + 1];
      const b = img.bitmap.data[idx + 2];
      if (isNearWhiteOrBlack(r, g, b)) continue;
      const hex = rgbToHex(r, g, b);
      counts.set(hex, (counts.get(hex) || 0) + 1);
      total++;
    }
  }
  if (total === 0) {
    return { sampled: false, error: 'region empty after near-white/black filter' };
  }
  let best = '#000000';
  let bestN = 0;
  for (const [hex, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = hex;
    }
  }
  return { sampled: true, hex: best, samples: total };
}

async function runHistSim(pathA, pathB) {
  if (!pathA || !pathB) {
    return { ok: false, error: 'hist-sim requires two image paths' };
  }
  const imgA = await Jimp.read(pathA);
  const imgB = await Jimp.read(pathB);
  const size = 64;
  imgA.resize(size, size);
  imgB.resize(size, size);
  const bins = 8;
  const nBins = bins * bins * bins;
  const histA = new Float64Array(nBins);
  const histB = new Float64Array(nBins);
  const push = (img, hist) => {
    const { width: w, height: h, data } = img.bitmap;
    for (let i = 0; i < w * h; i++) {
      const idx = i << 2;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const bi = Math.min(bins - 1, (b * bins) >> 8);
      const gi = Math.min(bins - 1, (g * bins) >> 8);
      const ri = Math.min(bins - 1, (r * bins) >> 8);
      hist[ri * bins * bins + gi * bins + bi] += 1;
    }
  };
  push(imgA, histA);
  push(imgB, histB);
  let normA = 0;
  let normB = 0;
  let dot = 0;
  for (let i = 0; i < nBins; i++) {
    normA += histA[i] * histA[i];
    normB += histB[i] * histB[i];
    dot += histA[i] * histB[i];
  }
  if (normA === 0 || normB === 0) {
    return { ok: false, error: 'empty histogram' };
  }
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return { ok: true, similarity: Math.max(0, Math.min(1, similarity)) };
}

/** N×N 分块直方图相似度，返回最小块（破全局白底稀释） */
async function runTileMinSim(pathA, pathB, gridStr) {
  if (!pathA || !pathB) {
    return { ok: false, error: 'tile-min requires two image paths' };
  }
  const grid = Math.max(2, Math.min(8, parseInt(gridStr, 10) || 4));
  const imgA = await Jimp.read(pathA);
  const imgB = await Jimp.read(pathB);
  const size = 128;
  imgA.resize(size, size);
  imgB.resize(size, size);
  const tile = Math.floor(size / grid);
  let minSim = 1;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x = gx * tile;
      const y = gy * tile;
      const w = gx === grid - 1 ? size - x : tile;
      const h = gy === grid - 1 ? size - y : tile;
      const cropA = imgA.clone().crop(x, y, w, h);
      const cropB = imgB.clone().crop(x, y, w, h);
      const tmpA = path.join(require('os').tmpdir(), `tile-a-${gx}-${gy}.png`);
      const tmpB = path.join(require('os').tmpdir(), `tile-b-${gx}-${gy}.png`);
      await cropA.writeAsync(tmpA);
      await cropB.writeAsync(tmpB);
      const part = await runHistSim(tmpA, tmpB);
      try { require('fs').unlinkSync(tmpA); } catch { /* ignore */ }
      try { require('fs').unlinkSync(tmpB); } catch { /* ignore */ }
      if (part.ok && typeof part.similarity === 'number') {
        minSim = Math.min(minSim, part.similarity);
      }
    }
  }
  return { ok: true, similarity: minSim, grid };
}

/**
 * 结构散度分块（整页设计稿 vs 整屏设备图）。两图灰度**拉伸到统一 TW×TH**（整页对整页，按内容行占比对齐）
 * → 逐 tile 对像素做 z-归一（减均值/除标准差，亮度/对比不变）后求 MAD，归一到 [0,1]。
 * 度量「结构差异」而非「边缘能量」：结构不同的 tile（裁切/叠帧/形态）拉开，干净自比为 0。
 * 对齐策略（实测定，非 plan 初版 F4 的 letterbox）：两图均整页捕获但宽高比差大（稿 0.349 vs 机 0.623），
 * 合成 FP 探针显示**拉伸（3 FP）显著优于 letterbox（8 FP）**——letterbox 因不同比例占不同子区反而错位；
 * 纯比例差拉伸后 0 FP，残留 ~3 FP 来自状态栏偏移，由 check 层「最小未覆盖 tile 数」吸收。
 * mockup≠device 本就不像素对齐 → 仅作 WARN 低置信兜底 + 高阈值，永不单独 gate。
 * threshStr：单 tile z-MAD 超阈（由 toolkit EDGE_STRUCT_THRESHOLD 传入，缺省 0.55）。
 */
async function runEdgeTile(refPath, shotPath, rowsStr, colsStr, threshStr) {
  if (!refPath || !shotPath) {
    return { ok: false, error: 'edge-tile requires ref and shot paths' };
  }
  const rows = Math.max(2, Math.min(16, parseInt(rowsStr, 10) || 8));
  const cols = Math.max(2, Math.min(16, parseInt(colsStr, 10) || 6));
  const thresh = parseFloat(threshStr) || EDGE_STRUCT_THRESHOLD;
  const TW = 180;
  const TH = 360;
  const toGray = (img) => {
    const g = img.clone().greyscale().resize(TW, TH);
    const { data } = g.bitmap;
    const a = new Float64Array(TW * TH);
    for (let i = 0; i < TW * TH; i++) a[i] = data[i << 2];
    return a;
  };
  const aRef = toGray(await Jimp.read(refPath));
  const aShot = toGray(await Jimp.read(shotPath));
  const tileH = TH / rows;
  const tileW = TW / cols;
  const zMad = (r, c) => {
    const x0 = Math.floor(c * tileW);
    const x1 = Math.floor((c + 1) * tileW);
    const y0 = Math.floor(r * tileH);
    const y1 = Math.floor((r + 1) * tileH);
    const va = [];
    const vb = [];
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        va.push(aRef[y * TW + x]);
        vb.push(aShot[y * TW + x]);
      }
    }
    const n = va.length;
    if (n === 0) return 0;
    const mean = (v) => v.reduce((s, x) => s + x, 0) / n;
    const ma = mean(va);
    const mb = mean(vb);
    const std = (v, m) => Math.sqrt(v.reduce((s, x) => s + (x - m) * (x - m), 0) / n) || 1;
    const sa = std(va, ma);
    const sb = std(vb, mb);
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.abs((va[i] - ma) / sa - (vb[i] - mb) / sb);
    return Math.min(1, s / n / 2);
  };
  let maxDiv = 0;
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const div = zMad(r, c);
      if (div > maxDiv) maxDiv = div;
      if (div >= thresh) tiles.push([r, c]);
    }
  }
  return { ok: true, divergence: Math.max(0, Math.min(1, maxDiv)), tiles, grid: { rows, cols } };
}

async function main() {
  const [cmd, imagePath, ...rest] = process.argv.slice(2);
  if (cmd === 'crop') {
    const [x, y, w, h, paddingStr, outPath] = rest;
    const padding = parseFloat(paddingStr);
    const result = await runCrop(imagePath, [x, y, w, h], padding, outPath);
    process.stdout.write(JSON.stringify(result));
    return;
  }
  if (cmd === 'sample') {
    const [x, y, w, h, paddingStr] = rest;
    const padding = parseFloat(paddingStr);
    const result = await runSample(imagePath, [x, y, w, h], padding);
    process.stdout.write(JSON.stringify(result));
    return;
  }
  if (cmd === 'hist-sim') {
    const [pathB] = rest;
    const result = await runHistSim(imagePath, pathB);
    process.stdout.write(JSON.stringify(result));
    return;
  }
  if (cmd === 'tile-min') {
    const [pathB, gridStr] = rest;
    const result = await runTileMinSim(imagePath, pathB, gridStr);
    process.stdout.write(JSON.stringify(result));
    return;
  }
  if (cmd === 'edge-tile') {
    const [shotPath, rowsStr, colsStr, threshStr] = rest;
    const result = await runEdgeTile(imagePath, shotPath, rowsStr, colsStr, threshStr);
    process.stdout.write(JSON.stringify(result));
    return;
  }
  process.stderr.write(`unknown cmd: ${cmd}\n`);
  process.exit(2);
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, sampled: false, error: e.message }));
  process.exit(1);
});
