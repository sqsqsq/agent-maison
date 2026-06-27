/**
 * arkui-clip-overlap — a1 ArkUI 防裁切/防叠帧/防重叠纯检测（低置信启发式）。
 * R1 Swiper/Grid 含 Image + 容器矮高度 → 裁切；R2 Swiper 多项可见 → 叠帧；
 * R3 Stack Image+Text 绝对定位未 clip → 重叠。含「小图标自身高度不误报」回归。
 */
import * as assert from 'assert';
import { detectClipOverlapRisks } from '../../../profiles/hmos-app/harness/arkui-static-rules';
import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

function hits(content: string): string[] {
  return detectClipOverlapRisks(content, 'X.ets');
}

// R1 裁切
test('a1 R1: Swiper 含 Image + 容器矮高度 → 命中', () => {
  const c = "Swiper() {\n  Image($r('app.media.icon')).width(48).height(48)\n}\n.height(64)";
  assert.ok(hits(c).some(h => h.includes('裁切')));
});

test('a1 R1 回归: 容器高度足够、仅小图标 height → 不误报', () => {
  const c = "Swiper() {\n  Image($r('app.media.icon')).width(48).height(48)\n}\n.height(200)";
  assert.ok(!hits(c).some(h => h.includes('裁切')));
});

// R2 叠帧
test('a1 R2: Swiper displayCount(3) → 叠帧命中', () => {
  const c = "Swiper() {\n  ForEach(this.banners, (b) => {})\n}\n.displayCount(3)";
  assert.ok(hits(c).some(h => h.includes('叠帧')));
});

test('a1 R2: Swiper prevMargin → 叠帧命中', () => {
  const c = "Swiper() {\n  Image($r('app.media.b'))\n}\n.prevMargin(20).nextMargin(20)";
  assert.ok(hits(c).some(h => h.includes('叠帧')));
});

test('a1 R2: Swiper displayCount(1) → 不命中', () => {
  const c = "Swiper() {\n  Image($r('app.media.b'))\n}\n.displayCount(1).height(200)";
  assert.strictEqual(hits(c).length, 0);
});

// R3 重叠
test('a1 R3: Stack Image+Text 绝对定位未 clip → 重叠命中', () => {
  const c = "Stack() {\n  Image($r('app.media.bg'))\n  Text('卡包').position({ x: 0, y: 0 })\n}";
  assert.ok(hits(c).some(h => h.includes('重叠')));
});

test('a1 R3: Stack 已 .clip(true) → 不命中', () => {
  const c = "Stack() {\n  Image($r('app.media.bg'))\n  Text('卡包').position({ x: 0, y: 0 })\n}\n.clip(true)";
  assert.ok(!hits(c).some(h => h.includes('重叠')));
});

test('a1 干净: 普通 Column → 无命中', () => {
  assert.strictEqual(hits("Column() {\n  Text('hi')\n}").length, 0);
});

export function runAll(): UnitCaseResult[] {
  return CASES.map(c => {
    try {
      c.run();
      return { name: c.name, ok: true };
    } catch (e) {
      return { name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) };
    }
  });
}
