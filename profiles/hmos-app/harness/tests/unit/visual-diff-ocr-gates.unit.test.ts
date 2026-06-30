/**
 * visual-diff-ocr-gates 单测（T5 越界）：collectOutOfBoundsGlobalElements。
 * OCR 注入（不跑真 OCR）：构造 canned words 验证——非属主屏底部 band 出现全局元素文本=越界；
 * 属主屏合法；texts 须全部命中；band 外不算；OCR 失败不误报；无声明返回 []。
 */
import * as assert from 'assert';
import * as path from 'path';
import { collectOutOfBoundsGlobalElements, type OcrFn } from '../../visual-diff-ocr-gates';
import { isOcrAvailable } from '../../ocr-toolkit';
import type { OcrWord, OcrResult } from '../../ocr-toolkit';
import type { VisualDiffScreenEntry } from '../../visual-diff-check';
import type { UiSpecGlobalElement } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function word(text: string, cy: number): OcrWord {
  return { text, conf: 90, bbox: [0.4, cy - 0.01, 0.1, 0.02] };
}
/** 按 screen_id → words 注入的假 OCR */
function fakeOcr(byScreen: Record<string, OcrWord[]>): OcrFn {
  return (shotAbs: string): OcrResult => {
    // resolveShotAbs 把 rel 原样返回（见各用例），shotAbs 即 screen 的 screenshot_path
    const key = Object.keys(byScreen).find(k => shotAbs.includes(k));
    if (!key) return { ok: true, width: 1080, height: 2400, words: [] };
    return { ok: true, width: 1080, height: 2400, words: byScreen[key] };
  };
}

const BOTTOM_TAB: UiSpecGlobalElement = {
  id: 'bottom_tab',
  texts: ['首页', '我的'],
  owner_screen_ids: ['home_no_card', 'home_with_card', 'mine'],
};
const screens: VisualDiffScreenEntry[] = [
  { screen_id: 'card_pack', verdict: 'pass', screenshot_path: 'shot-card_pack.png', ref_id: 'card_pack' },
  { screen_id: 'mine', verdict: 'pass', screenshot_path: 'shot-mine.png', ref_id: 'mine' },
];
const idResolve = (rel: string): string => rel;

test('T5: 子页 card_pack 底部出现「首页+我的」→ 越界命中', () => {
  const ocr = fakeOcr({
    'card_pack': [word('首页', 0.96), word('我的', 0.96), word('管理非本机卡片', 0.2)],
    'mine': [word('首页', 0.96), word('我的', 0.96)], // 属主屏合法
  });
  const v = collectOutOfBoundsGlobalElements([BOTTOM_TAB], screens, idResolve, ocr);
  assert.strictEqual(v.violations.length, 1, `应仅 card_pack 越界：${JSON.stringify(v)}`);
  assert.strictEqual(v.violations[0].screen_id, 'card_pack');
  assert.strictEqual(v.violations[0].element_id, 'bottom_tab');
  assert.strictEqual(v.ocrUnavailable.length, 0, 'OCR 正常不应有降级');
});

test('T5: 属主屏 mine 出现底部 tab → 合法不命中', () => {
  const ocr = fakeOcr({ 'mine': [word('首页', 0.96), word('我的', 0.96)] });
  const v = collectOutOfBoundsGlobalElements([BOTTOM_TAB], [screens[1]], idResolve, ocr);
  assert.strictEqual(v.violations.length, 0);
});

test('T5: 只命中部分文本（仅"首页"无"我的"）→ 不越界（须全部命中）', () => {
  const ocr = fakeOcr({ 'card_pack': [word('首页', 0.96)] });
  const v = collectOutOfBoundsGlobalElements([BOTTOM_TAB], [screens[0]], idResolve, ocr);
  assert.strictEqual(v.violations.length, 0);
});

test('T5: 文本在顶部非底部 band → 不越界（band 过滤）', () => {
  const ocr = fakeOcr({ 'card_pack': [word('首页', 0.1), word('我的', 0.1)] });
  const v = collectOutOfBoundsGlobalElements([BOTTOM_TAB], [screens[0]], idResolve, ocr);
  assert.strictEqual(v.violations.length, 0, '顶部 0.1 不在默认底部 band 0.85+');
});

test('T5: OCR 失败 → 不误判越界，但产出降级信号（不静默放过）', () => {
  const ocr: OcrFn = () => ({ ok: false, error: 'ocr unavailable' });
  const v = collectOutOfBoundsGlobalElements([BOTTOM_TAB], screens, idResolve, ocr);
  assert.strictEqual(v.violations.length, 0, 'OCR 失败不应误判越界');
  // card_pack 是非属主屏、须检测但 OCR 失败 → 进降级清单（mine 是属主屏不计）
  assert.deepStrictEqual(v.ocrUnavailable, ['card_pack'], 'OCR 失败的非属主屏须进 ocrUnavailable 降级清单');
});

test('T5: 无 global_elements 声明 → 空结果（且不调用 OCR）', () => {
  let called = false;
  const ocr: OcrFn = () => { called = true; return { ok: true, words: [] }; };
  assert.strictEqual(collectOutOfBoundsGlobalElements(undefined, screens, idResolve, ocr).violations.length, 0);
  assert.strictEqual(collectOutOfBoundsGlobalElements([], screens, idResolve, ocr).violations.length, 0);
  assert.strictEqual(called, false, '无声明不应跑 OCR');
});

test('T5: 自定义 band（如顶部标题区）', () => {
  const topTitle: UiSpecGlobalElement = {
    id: 'home_title', texts: ['钱包'], owner_screen_ids: ['home_no_card'],
    band: { start: 0, end: 0.15 },
  };
  const ocr = fakeOcr({ 'card_pack': [word('钱包', 0.08)] });
  const v = collectOutOfBoundsGlobalElements([topTitle], [screens[0]], idResolve, ocr);
  assert.strictEqual(v.violations.length, 1, '顶部 band 自定义命中');
});

test('T5 集成: 真实 card_pack fixture + 真 OCR 穿过门禁 → 越界命中（端到端）', () => {
  if (!isOcrAvailable()) return; // 守卫跳过
  const fixture = path.join(__dirname, '..', 'fixtures', 'ocr', 'card_pack.png');
  const ge: UiSpecGlobalElement = { id: 'bottom_tab', texts: ['首页', '我的'], owner_screen_ids: ['home', 'mine'] };
  const scr: VisualDiffScreenEntry[] = [
    { screen_id: 'card_pack', verdict: 'pass', screenshot_path: fixture, ref_id: 'card_pack' },
  ];
  // resolveShotAbs 直接返回绝对 fixture 路径；用默认真 OCR（不注入）
  const v = collectOutOfBoundsGlobalElements([ge], scr, () => fixture);
  assert.strictEqual(v.violations.length, 1, `真实 card_pack 应判越界（底部泄漏 首页/我的）：${JSON.stringify(v)}`);
  assert.strictEqual(v.violations[0].element_id, 'bottom_tab');
  assert.strictEqual(v.ocrUnavailable.length, 0, '真 OCR 可用不应降级');
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
