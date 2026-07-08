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
  extractLikelyRealTextRun,
  detectColumnGroups,
  collectAuditableOcrLines,
  clusterOcrLines,
  type OcrWord,
  type OcrLine,
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

// ==========================================================================
// E6（多模态降级阶梯 plan d4a8f3c6）：噪声候选真文本提取 + 列分组 + 共享清洗函数
// ==========================================================================

test('E6 extractLikelyRealTextRun: 案B chrys 实录噪声前缀 → 提取出真实银行名', () => {
  const r1 = extractLikelyRealTextRun('人《AA招商银行');
  assert.ok(r1, 'should extract a candidate');
  assert.strictEqual(r1!.candidate, '招商银行');
  assert.strictEqual(r1!.noisePrefix, '人《AA');
  assert.strictEqual(r1!.noiseSuffix, '');

  const r2 = extractLikelyRealTextRun('人@)工商银行');
  assert.ok(r2);
  assert.strictEqual(r2!.candidate, '工商银行');
});

test('E6 extractLikelyRealTextRun: 纯噪声（无 CJK）→ null', () => {
  assert.strictEqual(extractLikelyRealTextRun('@#$%123'), null);
});

test('E6 extractLikelyRealTextRun: 纯 CJK 无噪声 → candidate=全文，前后缀为空', () => {
  const r = extractLikelyRealTextRun('立即添加');
  assert.ok(r);
  assert.strictEqual(r!.candidate, '立即添加');
  assert.strictEqual(r!.noisePrefix, '');
  assert.strictEqual(r!.noiseSuffix, '');
});

test('E6 extractLikelyRealTextRun: 单字 CJK 游程（<2 字）→ null（太短噪声概率高）', () => {
  assert.strictEqual(extractLikelyRealTextRun('A卡B'), null);
});

test('E6 extractLikelyRealTextRun: 前后都有噪声——取最长游程作候选', () => {
  const r = extractLikelyRealTextRun('##交通银行@@');
  assert.ok(r);
  assert.strictEqual(r!.candidate, '交通银行');
  assert.strictEqual(r!.noisePrefix, '##');
  assert.strictEqual(r!.noiseSuffix, '@@');
});

test('E6 detectColumnGroups: 大 gap 拆两组（标签+数值同行布局）', () => {
  const line: OcrLine = {
    text: '余额1000元',
    box: [0, 0.5, 0.9, 0.03],
    words: [
      { text: '余额', conf: 90, bbox: [0.05, 0.5, 0.1, 0.03] },
      // 大 gap：下一词起点远超"余额"平均宽度的 1.5 倍
      { text: '1000元', conf: 90, bbox: [0.6, 0.5, 0.15, 0.03] },
    ],
  };
  const groups = detectColumnGroups(line);
  assert.strictEqual(groups.length, 2, JSON.stringify(groups));
  assert.strictEqual(groups[0], '余额');
  assert.strictEqual(groups[1], '1000元');
});

test('E6 detectColumnGroups: 紧邻词（无显著 gap）→ 单一分组', () => {
  const line: OcrLine = {
    text: '立即添加',
    box: [0.1, 0.5, 0.2, 0.03],
    words: [
      { text: '立即', conf: 90, bbox: [0.1, 0.5, 0.1, 0.03] },
      { text: '添加', conf: 90, bbox: [0.2, 0.5, 0.1, 0.03] },
    ],
  };
  const groups = detectColumnGroups(line);
  assert.strictEqual(groups.length, 1, JSON.stringify(groups));
  assert.strictEqual(groups[0], '立即添加');
});

test('E6 detectColumnGroups: 单词行 → 返回整行文本', () => {
  const line: OcrLine = { text: '单个', box: [0, 0, 0.1, 0.03], words: [{ text: '单个', conf: 90, bbox: [0, 0, 0.1, 0.03] }] };
  assert.deepStrictEqual(detectColumnGroups(line), ['单个']);
});

test('E6 同源化：collectAuditableOcrLines（从 ocr-toolkit 导出）与既有噪声过滤行为一致', () => {
  const words: OcrWord[] = [
    { text: '12:34', conf: 90, bbox: [0.4, 0.02, 0.1, 0.02] }, // 状态栏时间，应剔除
    { text: '首页', conf: 90, bbox: [0.4, 0.9, 0.1, 0.03] }, // 正常内容
    { text: '@', conf: 90, bbox: [0.1, 0.5, 0.02, 0.02] }, // 纯符号噪声
  ];
  const lines = clusterOcrLines(words);
  const audited = collectAuditableOcrLines(lines);
  const texts = audited.map(l => l.text);
  assert.ok(texts.includes('首页'), JSON.stringify(texts));
  assert.ok(!texts.some(t => t.includes('12:34')), '状态栏时间应被剔除：' + JSON.stringify(texts));
  assert.ok(!texts.includes('@'), '纯符号噪声应被剔除：' + JSON.stringify(texts));
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
