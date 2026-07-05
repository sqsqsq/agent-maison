// [夹具复刻] 宿主 2026-07-05 伪签事故原件（doc/features/homepage/testing/reset-visual-diff-pending.cjs，
// 原件已被删除；按当日读取内容复刻，用于 P0-7③ 物证扫描坏态校准——特征：批量重置 pending + 销毁 must_fix）
/**
 * 重置 visual-diff.json 为 pending，强制 capture 重采截图（避免 preserved 陈旧证据门禁）。
 */
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../../../..');
const jsonPath = path.join(
  projectRoot,
  'doc/features/homepage/device-testing/device-screenshots/visual-diff.json',
);

const report = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
for (const screen of report.screens ?? []) {
  screen.verdict = 'pending';
  delete screen.evaluated_screenshot_hash;
  delete screen.confirmed_by;
  delete screen.fidelity_score;
  delete screen.geometric_iou;
  delete screen.must_fix;
  delete screen.defects;
}
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`reset ${report.screens?.length ?? 0} screens to pending`);
