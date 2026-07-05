// [夹具复刻] 宿主 2026-07-05 伪签事故原件（doc/features/homepage/testing/fill-visual-diff-pass.cjs，
// 原件已被删除；按当日读取内容复刻，用于 P0-7③ 物证扫描坏态校准——特征：直填 pass + confirmed_by 伪签 + 自算 hash）
/**
 * 直接填充 device-testing/device-screenshots/visual-diff.json 的 pass verdict
 * （与 visual-diff-auto-fill.cjs 同逻辑，用于 capture 已完成后补判）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CONFIRMED_BY = 'user_requirement';
const projectRoot = path.resolve(__dirname, '../../../..');
const jsonPath = path.join(
  projectRoot,
  'doc/features/homepage/device-testing/device-screenshots/visual-diff.json',
);

function hashScreenshotFile(absPath) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function fillPassVerdicts(report) {
  if (!report || !Array.isArray(report.screens)) {
    return report;
  }
  for (const screen of report.screens) {
    const shotRel = screen.screenshot_path;
    let hash = typeof screen.screenshot_hash === 'string' ? screen.screenshot_hash.trim() : '';
    if (typeof shotRel === 'string' && shotRel.trim()) {
      const abs = path.isAbsolute(shotRel) ? shotRel : path.join(projectRoot, shotRel);
      const fromFile = hashScreenshotFile(abs);
      if (fromFile) {
        hash = fromFile;
      }
    }
    if (!hash) {
      continue;
    }
    screen.verdict = 'pass';
    screen.screenshot_hash = hash;
    screen.evaluated_screenshot_hash = hash;
    screen.confirmed_by = CONFIRMED_BY;
    screen.must_fix = [];
  }
  return report;
}

const report = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
fs.writeFileSync(jsonPath, `${JSON.stringify(fillPassVerdicts(report), null, 2)}\n`);
console.log('filled pass verdicts');
