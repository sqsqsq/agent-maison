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
  process.stderr.write(`unknown cmd: ${cmd}\n`);
  process.exit(2);
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, sampled: false, error: e.message }));
  process.exit(1);
});
