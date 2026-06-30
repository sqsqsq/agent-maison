#!/usr/bin/env node
'use strict';

/**
 * ocr-worker — tesseract.js chi_sim 文本框识别（采集层调用，spawnSync 阻塞）。
 * bbox 语义与 image-jimp-worker 一致：[x, y, w, h] 归一化 ∈ [0,1]（除以本图自身 W/H，
 * 故跨"设备截图 vs mockup"尺寸差仍可比相对位置）。
 *
 * argv: ocr <imagePath> <langPath>   （langPath = 含 chi_sim.traineddata 的目录）
 * stdout: { ok, width, height, words:[{text, conf, bbox:[x,y,w,h]}] } 或 { ok:false, error }
 */

const path = require('path');
const harnessRoot = path.resolve(__dirname, '../../../harness');
const Jimp = require(require.resolve('jimp', { paths: [harnessRoot] }));
const { createWorker } = require(require.resolve('tesseract.js', { paths: [harnessRoot] }));

function fail(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(msg) }));
  process.exit(0);
}

(async () => {
  const imgPath = process.argv[2];
  const langPath = process.argv[3];
  if (!imgPath || !langPath) return fail('usage: ocr <imagePath> <langPath>');

  let W = 0;
  let H = 0;
  try {
    const img = await Jimp.read(imgPath);
    W = img.bitmap.width;
    H = img.bitmap.height;
  } catch (e) {
    return fail(`jimp read failed: ${e && e.message ? e.message : e}`);
  }
  if (!W || !H) return fail('image has zero dimensions');

  let worker;
  try {
    // langPath 本地物化（chi_sim.traineddata，已 gunzip）→ cacheMethod none + gzip false，绝不运行时 CDN 拉。
    worker = await createWorker('chi_sim', 1, { langPath, cacheMethod: 'none', gzip: false });
    const { data } = await worker.recognize(imgPath, {}, { text: true, blocks: true });
    const words = [];
    for (const b of data.blocks || []) {
      for (const p of b.paragraphs || []) {
        for (const l of p.lines || []) {
          for (const w of l.words || []) {
            const t = (w.text || '').trim();
            if (!t) continue;
            const bb = w.bbox || {};
            const x0 = Number(bb.x0) || 0;
            const y0 = Number(bb.y0) || 0;
            const x1 = Number(bb.x1) || 0;
            const y1 = Number(bb.y1) || 0;
            words.push({
              text: t,
              conf: Math.round(Number(w.confidence) || 0),
              bbox: [x0 / W, y0 / H, Math.max(0, x1 - x0) / W, Math.max(0, y1 - y0) / H],
            });
          }
        }
      }
    }
    process.stdout.write(JSON.stringify({ ok: true, width: W, height: H, words }));
  } catch (e) {
    return fail(`tesseract failed: ${e && e.message ? e.message : e}`);
  } finally {
    if (worker) { try { await worker.terminate(); } catch { /* ignore */ } }
  }
  process.exit(0);
})();
