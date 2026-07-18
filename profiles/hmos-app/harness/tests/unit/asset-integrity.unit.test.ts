// ============================================================================
// asset-integrity.unit.test.ts — blind-visual-hardening d2 / P0-B
// ============================================================================
// 锁定：①role/criticality 机器派生与声明失配；②物化 sanity role 分档
//（复用 round6 真实废图夹具：空白/纯蓝——同时验证"单色 icon 合法"的反误伤边界）；
// ③分角色占位生成确定性 + SVG 可见性静态判 + system_symbol 不落文件；
// ④渲染可见性 calibrate：纯色"截图"上区域 invisible / 真实 mockup 内容区 visible
//（阈值版本 r1-calibrate 的 synthetic 双向校准锚）。
// jimp 实跑用例按仓库惯例以 isJimpAvailable 守卫。
// ============================================================================

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ASSET_SANITY_THRESHOLD_VERSION,
  assessMaterializedFile,
  collectIconKindEvidence,
  deriveAssetCriticality,
  deriveAssetRole,
  generateRolePlaceholder,
  placeholderGlyph,
  svgLooksVisible,
} from '../../asset-integrity';
import {
  REGION_MIN_LUMA_STDDEV,
  RENDER_VISIBILITY_THRESHOLD_VERSION,
  assessImageRegionVisibility,
} from '../../render-visibility';
import { isJimpAvailable, readImageDimensions } from '../../image-toolkit';
import type { UiSpecAsset, UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'round6');
const BAD_SOLID = path.join(FIXTURES, 'bad-crops', 'icon_header_watch.png');
const BAD_BLANK = path.join(FIXTURES, 'bad-crops', 'icon_category_transit.png');
const REAL_MOCKUP = path.join(FIXTURES, 'mockups', 'add_card.jpg');

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function docWith(opts: { p0?: boolean; brandKind?: boolean }): UiSpecDoc {
  return {
    screens: [{
      id: 's1',
      priority: opts.p0 === false ? 'P1' : 'P0',
      root: {
        type: 'navigation_frame',
        children: opts.brandKind === false ? [] : [{ type: 'content_display', icon: { kind: 'brand_logo' } }],
      } as never,
    }],
    tokens: {},
    assets: [],
  } as unknown as UiSpecDoc;
}

function asset(key: string, extra?: Partial<UiSpecAsset>): UiSpecAsset {
  return { key, acquisition: 'crop', ...extra } as UiSpecAsset;
}

// ---------------- ① role / criticality ----------------

test('role 派生：bank_logo_* → brand_logo；guide/ill → illustration；mask → mask；未知 → decoration', () => {
  const doc = docWith({});
  assert.strictEqual(deriveAssetRole(asset('bank_logo_icbc'), doc).role, 'brand_logo');
  assert.strictEqual(deriveAssetRole(asset('add_card_guide_image'), doc).role, 'illustration');
  assert.strictEqual(deriveAssetRole(asset('avatar_mask_round'), doc).role, 'mask');
  assert.strictEqual(deriveAssetRole(asset('bg_stripe'), doc).role, 'decoration');
});

test('role 声明失配：agent 把 brand_logo 声明成 decoration → declaredMismatch 非空（派生为准）', () => {
  const doc = docWith({});
  const d = deriveAssetRole(asset('bank_logo_cmb', { role: 'decoration' } as never), doc);
  assert.strictEqual(d.role, 'brand_logo');
  assert.ok(d.declaredMismatch, '应报声明失配');
});

test('criticality：brand_logo + 有屏（不看 priority 自报——全 P1 也 brand_critical）；无屏 → normal；decoration 恒 normal', () => {
  assert.strictEqual(deriveAssetCriticality('brand_logo', docWith({})), 'brand_critical');
  assert.strictEqual(deriveAssetCriticality('brand_logo', docWith({ p0: false })), 'brand_critical',
    'cursor P2：agent 全写 P1 不得把品牌素材降级');
  assert.strictEqual(deriveAssetCriticality('brand_logo', { screens: [], tokens: {}, assets: [] } as never), 'normal');
  assert.strictEqual(deriveAssetCriticality('decoration', docWith({})), 'normal');
});

test('icon.kind 证据收集：screens 树递归含 item_template', () => {
  const kinds = collectIconKindEvidence(docWith({}));
  assert.ok(kinds.has('brand_logo'));
});

// ---------------- ② 物化 sanity（role 分档；round6 真废图夹具）----------------

test(`sanity(${ASSET_SANITY_THRESHOLD_VERSION})：空白图任何 role 都 fail（brand_logo）`, () => {
  if (!isJimpAvailable()) return;
  const r = assessMaterializedFile(BAD_BLANK, 'brand_logo');
  assert.strictEqual(r.status, 'fail', r.reasons.join(';'));
  assert.ok(r.reasons.some(x => /空白/.test(x)), r.reasons.join(';'));
});

test('sanity：纯蓝块 brand_logo → fail 近纯色；同图作 icon → 合法（单色图标反误伤边界）', () => {
  if (!isJimpAvailable()) return;
  const asLogo = assessMaterializedFile(BAD_SOLID, 'brand_logo');
  assert.strictEqual(asLogo.status, 'fail', asLogo.reasons.join(';'));
  assert.ok(asLogo.reasons.some(x => /近纯色/.test(x)), asLogo.reasons.join(';'));
  const asIcon = assessMaterializedFile(BAD_SOLID, 'icon');
  assert.strictEqual(asIcon.status, 'pass', `单色 icon 不应误伤：${asIcon.reasons.join(';')}`);
});

test('sanity：真实截图作 illustration → pass（内容丰富不误报）', () => {
  if (!isJimpAvailable()) return;
  const r = assessMaterializedFile(REAL_MOCKUP, 'illustration');
  assert.strictEqual(r.status, 'pass', r.reasons.join(';'));
});

test('sanity：文件不存在 → fail（不静默）', () => {
  const r = assessMaterializedFile(path.join(os.tmpdir(), 'no-such-asset.png'), 'icon');
  assert.strictEqual(r.status, 'fail');
});

test('sanity 三态（codex P1-5 fail-closed）：jimp 不可用（注入降级）→ unverified，绝不折叠进 pass', () => {
  const r = assessMaterializedFile(REAL_MOCKUP, 'brand_logo', { jimpAvailableOverride: false });
  assert.strictEqual(r.status, 'unverified', JSON.stringify(r));
  assert.ok(r.reasons.some(x => /jimp 不可用/.test(x)), r.reasons.join(';'));
});

// ---------------- ③ 分角色占位 ----------------

test('placeholderGlyph：CJK 取首字、ASCII 取首字母大写、空 label 回退 key', () => {
  assert.strictEqual(placeholderGlyph('招商银行', 'bank_logo_cmb'), '招');
  assert.strictEqual(placeholderGlyph('icbc bank', 'x'), 'I');
  assert.strictEqual(placeholderGlyph('', 'k'), 'K');
});

test('generateRolePlaceholder：确定性（同输入恒同字节）+ SVG 可见 + 分角色 kind', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-'));
  try {
    const a = path.join(dir, 'a.svg');
    const b = path.join(dir, 'b.svg');
    const r1 = generateRolePlaceholder({ role: 'brand_logo', key: 'bank_logo_cmb', label: '招商银行', destAbs: a });
    const r2 = generateRolePlaceholder({ role: 'brand_logo', key: 'bank_logo_cmb', label: '招商银行', destAbs: b });
    assert.strictEqual(r1.kind, 'text_avatar');
    assert.ok(r1.written && r2.written);
    assert.strictEqual(fs.readFileSync(a, 'utf-8'), fs.readFileSync(b, 'utf-8'), '确定性：同输入恒同字节');
    assert.ok(svgLooksVisible(fs.readFileSync(a, 'utf-8')), '占位必须可见');
    const ill = generateRolePlaceholder({ role: 'illustration', key: 'guide', label: '', destAbs: path.join(dir, 'i.svg') });
    assert.strictEqual(ill.kind, 'illustration_frame');
    assert.ok(svgLooksVisible(fs.readFileSync(ill.destAbs!, 'utf-8')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateRolePlaceholder：system_symbol 不落文件（走 SymbolGlyph 指引）', () => {
  const r = generateRolePlaceholder({ role: 'system_symbol', key: 'k', label: 'x', destAbs: path.join(os.tmpdir(), 'never.svg') });
  assert.strictEqual(r.written, false);
  assert.ok(r.guidance && /SymbolGlyph/.test(r.guidance));
});

test('svgLooksVisible：全透明填充/无图形 → 不可见（禁空白占位）', () => {
  assert.strictEqual(svgLooksVisible('<svg xmlns="x"><rect fill="none"/></svg>'), false);
  assert.strictEqual(svgLooksVisible('<svg xmlns="x"></svg>'), false);
  assert.strictEqual(svgLooksVisible('not svg'), false);
});

// ---------------- ④ 渲染可见性 calibrate（synthetic 双向锚）----------------

test(`render-visibility(${RENDER_VISIBILITY_THRESHOLD_VERSION})：纯色"截图"内区域 → invisible（事故形态：区域无结构且与背景不可区分）`, () => {
  if (!isJimpAvailable()) return;
  const dims = readImageDimensions(BAD_SOLID);
  assert.ok(dims?.w && dims?.h, '夹具尺寸可读');
  const w = dims!.w!;
  const h = dims!.h!;
  const rect = { x1: Math.round(w * 0.3), y1: Math.round(h * 0.3), x2: Math.round(w * 0.7), y2: Math.round(h * 0.7) };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-'));
  try {
    const a = assessImageRegionVisibility(BAD_SOLID, rect, work, 't1');
    assert.strictEqual(a.status, 'invisible', `期望 invisible：${JSON.stringify(a)}`);
    assert.ok((a.lumaStddev ?? 99) < REGION_MIN_LUMA_STDDEV, '纯色区域 lumaStddev 应低于阈值');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('render-visibility：真实 mockup 内容区 → visible（反误报锚：有结构/有对比不误判）', () => {
  if (!isJimpAvailable()) return;
  const dims = readImageDimensions(REAL_MOCKUP);
  assert.ok(dims?.w && dims?.h);
  const w = dims!.w!;
  const h = dims!.h!;
  // 上部导航/内容带：真实 UI 截图该区域必有文本/结构
  const rect = { x1: Math.round(w * 0.05), y1: Math.round(h * 0.05), x2: Math.round(w * 0.6), y2: Math.round(h * 0.25) };
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rv-'));
  try {
    const a = assessImageRegionVisibility(REAL_MOCKUP, rect, work, 't2');
    assert.strictEqual(a.status, 'visible', `期望 visible：${JSON.stringify(a)}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('render-visibility：过小区域 → unknown（统计不稳定不硬判）', () => {
  const a = assessImageRegionVisibility(REAL_MOCKUP, { x1: 0, y1: 0, x2: 4, y2: 4 }, os.tmpdir(), 't3');
  assert.strictEqual(a.status, 'unknown');
});

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      out.push({ name: c.name, ok: true });
    } catch (err) {
      out.push({ name: c.name, ok: false, error: (err as Error).stack ?? (err as Error).message });
    }
  }
  return out;
}
