/**
 * ocr-toolkit 单测（T0）：
 *   - 纯模糊匹配函数（恒跑、快）：fuzzyTextPresent 容忍 OCR 掉字、fuzzyTextInBand 定位 band。
 *   - OCR 实跑（isOcrAvailable 守卫跳过，仿 jimp 测试）：card_pack 设备图能读出"首页/我的"在底部 band
 *     （=泄漏 tab 的确定性证据，T5 据此 gate）+ 内容文案命中 + 优雅降级不抛。
 * 真实样本来自 SimulatedWalletForHmos/homepage（vendoring 进 fixtures/ocr，亦作 T1/T5 回归底图）。
 */
import * as assert from 'assert';
import * as path from 'path';
import {
  isOcrAvailable,
  ocrImageWords,
  fuzzyTextPresent,
  fuzzyTextInBand,
  wordCenterY,
  type OcrWord,
} from '../../ocr-toolkit';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const CARD_PACK = path.join(__dirname, '..', 'fixtures', 'ocr', 'card_pack.png');

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function w(text: string, cy: number): OcrWord {
  // 构造一个中心 y≈cy 的 word（高度取 0.02）
  return { text, conf: 90, bbox: [0.4, cy - 0.01, 0.1, 0.02] };
}

// ---- 纯模糊函数（恒跑） ----

test('fuzzyTextPresent: 精确子串命中', () => {
  assert.ok(fuzzyTextPresent([w('管理非本机卡片', 0.2)], '管理非本机卡片'));
});

test('fuzzyTextPresent: OCR 掉字仍命中（添加卡片→添卡片）', () => {
  const words = [w('添卡片', 0.2), w('银行卡', 0.25)];
  assert.ok(fuzzyTextPresent(words, '添加卡片'), '掉 1 字应仍模糊命中');
});

test('fuzzyTextPresent: 无关文本不命中', () => {
  assert.ok(!fuzzyTextPresent([w('天气晴朗', 0.2)], '管理非本机卡片'));
});

test('fuzzyTextInBand: 底部 band 命中 / 顶部不命中', () => {
  const words = [w('首页', 0.95), w('我的', 0.95), w('钱包', 0.05)];
  assert.ok(fuzzyTextInBand(words, '首页', 0.85), '底部 0.95 应在 band 内');
  assert.ok(fuzzyTextInBand(words, '我的', 0.85));
  assert.ok(!fuzzyTextInBand(words, '钱包', 0.85), '顶部 0.05 不应在底部 band');
});

test('wordCenterY: 中心 y 计算', () => {
  assert.strictEqual(Math.round(wordCenterY({ text: 'x', conf: 1, bbox: [0, 0.9, 0.1, 0.04] }) * 100) / 100, 0.92);
});

// ---- OCR 实跑（守卫跳过） ----

test('OCR: card_pack 设备图读出"首页/我的"在底部 band（泄漏 tab 确定性证据）', () => {
  if (!isOcrAvailable()) return; // 无 tesseract/数据 → 跳过（不失败），交由 CI 装依赖后覆盖
  const r = ocrImageWords(CARD_PACK);
  assert.ok(r.ok, `OCR 应成功：${r.error ?? ''}`);
  assert.ok((r.words?.length ?? 0) > 0, 'words 应非空');
  const words = r.words ?? [];
  assert.ok(fuzzyTextInBand(words, '首页', 0.85), '"首页"应在底部 band 被读出');
  assert.ok(fuzzyTextInBand(words, '我的', 0.85), '"我的"应在底部 band 被读出');
});

test('OCR: card_pack 读出内容文案（管理非本机卡片 / 银行卡）', () => {
  if (!isOcrAvailable()) return;
  const r = ocrImageWords(CARD_PACK);
  assert.ok(r.ok, `OCR 应成功：${r.error ?? ''}`);
  const words = r.words ?? [];
  assert.ok(fuzzyTextPresent(words, '管理非本机卡片') || fuzzyTextPresent(words, '银行卡'), '应读出关键内容文案');
});

test('OCR: 优雅降级——不存在的图 → ok:false 不抛', () => {
  const r = ocrImageWords(path.join(__dirname, 'no-such-image-xyz.png'));
  assert.strictEqual(r.ok, false);
  assert.ok(typeof r.error === 'string' && r.error.length > 0);
});

export function runAll(): UnitCaseResult[] {
  return cases.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (err) {
      return { name: c.name, ok: false, error: err instanceof Error ? (err.stack ?? err.message) : String(err) };
    }
  });
}
