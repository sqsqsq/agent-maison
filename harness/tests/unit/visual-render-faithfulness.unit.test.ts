/**
 * visual-render-faithfulness — v3 渲染忠实度判别块（coding 阶段源码解析，非图像采样）。
 * 覆盖四个导出 helper：全宽判定 / 多 Button 定位 / backgroundColor 采色 / tonal 实心化判定。
 * 编排（P0 过滤 + struct 查找）为直白 glue，核心检测力在这些 helper。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isExplicitFullWidth,
  locateButtonBody,
  resolveButtonBgHex,
  parseButtonBgArg,
  isSaturatedSolidFill,
  assetRenderedInRefs,
  isDeclaredButtonVariant,
  isInlineGeometry,
  isUnclassifiedIcon,
} from '../../../profiles/hmos-app/harness/visual-parity-backstop';
import { resourceKeyToRef } from '../../../profiles/hmos-app/harness/source-ref-scan';
import type { UnitCaseResult } from '../run-unit';

const CASES: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  CASES.push({ name, run });
}

const EMPTY_CONTRACTS = { modules: [] } as unknown as Parameters<typeof resolveButtonBgHex>[2];

// ---- 主信号：显式全宽 ----
test("v3 全宽: .width('100%') → true", () => assert.ok(isExplicitFullWidth("Button('x').width('100%')")));
test('v3 全宽: layoutWeight(1) → true', () => assert.ok(isExplicitFullWidth("Button('x').layoutWeight(1)")));
test("v3 全宽: width('35%') 内联 → false", () => assert.ok(!isExplicitFullWidth("Button('x').width('35%')")));
test('v3 全宽: 无 width → false', () => assert.ok(!isExplicitFullWidth("Button('x').fontSize(14)")));

// ---- 多 Button 定位 ----
test('v3 定位: 单 Button struct → 返回该段', () => {
  const body = "Column(){ Text('卡包'); Button('添加管理卡片').width('100%') }";
  const b = locateButtonBody(body, '添加管理卡片');
  assert.ok(b && b.includes('添加管理卡片'), `期望命中按钮段，得到 ${b}`);
});

test('v3 定位: 多 Button 按 copy 命中对应段', () => {
  const body = "Button('取消').width('20%') Button('添加管理卡片').width('100%')";
  const b = locateButtonBody(body, '添加管理卡片');
  assert.ok(b && b.includes('添加管理卡片') && b.includes("width('100%')") && !b.includes('取消'));
});

test('v3 定位: 多 Button 无 copy → null（保守跳过）', () => {
  assert.strictEqual(locateButtonBody("Button('a') Button('b')", undefined), null);
});

// ---- 辅信号采色：backgroundColor → hex ----
test('v3 采色: 十六进制字面 → hex', () => {
  assert.strictEqual(resolveButtonBgHex('Button(\'x\').backgroundColor("#0A59F7")', '/tmp', EMPTY_CONTRACTS), '#0A59F7');
});
test('v3 采色: 0xAARRGGBB → 去 alpha hex', () => {
  assert.strictEqual(resolveButtonBgHex("Button('x').backgroundColor(0xFF0A59F7)", '/tmp', EMPTY_CONTRACTS), '#0A59F7');
});
test('v3 采色: 无 backgroundColor → null', () => {
  assert.strictEqual(resolveButtonBgHex("Button('x').fontSize(14)", '/tmp', EMPTY_CONTRACTS), null);
});
test('v3 采色(P1): $r(app.color.X) token 路径不再被截断 → 提取 key', () => {
  assert.deepStrictEqual(
    parseButtonBgArg("Button('x').backgroundColor($r('app.color.wallet_primary')).width('100%')"),
    { token: 'wallet_primary' },
  );
});
test('v3 采色(P1) 端到端: token → color.json 解析为 hex', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-token-'));
  const elemDir = path.join(dir, 'M', 'src', 'main', 'resources', 'base', 'element');
  fs.mkdirSync(elemDir, { recursive: true });
  fs.writeFileSync(
    path.join(elemDir, 'color.json'),
    JSON.stringify({ color: [{ name: 'wallet_primary', value: '#0A59F7' }] }),
  );
  const contracts = { modules: [{ name: 'M', package_path: 'M' }] } as unknown as Parameters<typeof resolveButtonBgHex>[2];
  assert.strictEqual(
    resolveButtonBgHex("Button('x').backgroundColor($r('app.color.wallet_primary'))", dir, contracts),
    '#0A59F7',
  );
});

// ---- tonal 实心化判定（色度+暗度） ----
test('v3 实心: brand 蓝 #0A59F7 → true（高饱和实心）', () => assert.ok(isSaturatedSolidFill('#0A59F7')));
test('v3 实心: 浅 tonal #E6F1FB → false', () => assert.ok(!isSaturatedSolidFill('#E6F1FB')));
test('v3 实心: 浅灰 #E8EAED → false', () => assert.ok(!isSaturatedSolidFill('#E8EAED')));
test('v3 实心: 非法 hex → false（不抛）', () => assert.ok(!isSaturatedSolidFill('not-a-color')));

// ---- s1 asset 真渲染：assetRenderedInRefs ----
test('s1 asset: media 在 refs 集合 → rendered', () => {
  const refs = new Set([resourceKeyToRef('tab_icon_home_active', 'media')]);
  assert.ok(assetRenderedInRefs('tab_icon_home_active', refs));
});
test('s1 asset: media 不在 refs → not rendered（#6 声明却未渲染）', () => {
  const refs = new Set([resourceKeyToRef('other_icon', 'media')]);
  assert.ok(!assetRenderedInRefs('tab_icon_home_active', refs));
});

// ---- a2 通用 variant 声明（枚举对齐 UiSpecButtonVariant，拦 pill/fill） ----
test('a2 variant: 合法值 tonal/ghost/filled/outlined/text → true', () => {
  for (const v of ['tonal', 'ghost', 'filled', 'outlined', 'text']) {
    assert.ok(isDeclaredButtonVariant(v), `${v} 应合法`);
  }
});
test('a2 variant: pill/fill/缺失 → false（plan 旧枚举 pill/fill 已校正）', () => {
  for (const v of ['pill', 'fill', '', undefined]) {
    assert.ok(!isDeclaredButtonVariant(v as string | undefined), `${String(v)} 应非法`);
  }
});

// ---- v3 几何含 align 信号：isInlineGeometry ----
test('v3 几何: width_ratio 0.35 → inline', () => assert.ok(isInlineGeometry(0.35, undefined)));
test('v3 几何: align=end/start → inline（align 信号）', () => {
  assert.ok(isInlineGeometry(undefined, 'end'));
  assert.ok(isInlineGeometry(undefined, 'start'));
});
test('v3 几何: 全宽 0.9 / center / 皆无 → not inline', () => {
  assert.ok(!isInlineGeometry(0.9, undefined));
  assert.ok(!isInlineGeometry(undefined, 'center'));
  assert.ok(!isInlineGeometry(undefined, undefined));
});

// ---- s1 icon.kind 补全：isUnclassifiedIcon ----
test('s1 icon.kind: 有 icon 无 kind → true（建议补全）', () => assert.ok(isUnclassifiedIcon({})));
test('s1 icon.kind: 有 kind → false', () => assert.ok(!isUnclassifiedIcon({ kind: 'brand_logo' })));
test('s1 icon.kind: 无 icon → false', () => assert.ok(!isUnclassifiedIcon(undefined)));

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
