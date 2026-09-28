/**
 * visual-defect-enum — v1 缺陷枚举契约 + v2 边缘哨兵坐标对账。
 *   - validateVisualDiffJson：defects[] / edge_* 字段 schema（合法放行、各非法命中）；
 *   - collectEdgeSentinelUncovered：超阈 tile 与 defect.bbox 的几何覆盖换算
 *     （未覆盖→登记复核；defect.bbox 恰覆盖→不再登记，即 reviewer 要求的对账夹具）。
 */
import * as assert from 'assert';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  validateVisualDiffJson,
  collectEdgeSentinelUncovered,
  collectWarnP0NoActionable,
  defectRepairAuthority,
  effectiveScreens,
  type VisualDiffScreenEntry,
} from '../../../profiles/hmos-app/harness/visual-diff-check';
import { computeEdgeDensityTileDivergence, isJimpAvailable } from '../../../profiles/hmos-app/harness/image-toolkit';
import type { UnitCaseResult } from '../run-unit';
import { loadRefElementsFile } from '../../scripts/utils/fidelity-shared';

const CASES: Array<{ name: string; run: () => void | Promise<void> }> = [];
function test(name: string, run: () => void | Promise<void>): void {
  CASES.push({ name, run });
}

const HARNESS_ROOT = path.resolve(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadJimp(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(require.resolve('jimp', { paths: [HARNESS_ROOT] }));
  } catch {
    return null;
  }
}

const ROOT = os.tmpdir();

/** 单屏骨架（screenshot_path 不存在会另报错，但与 defects/edge 校验无关，断言只针对目标子串） */
function screen(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    screen_id: 'home_no_card',
    verdict: 'pass',
    screenshot_path: 'shot.png',
    ref_id: 'home_no_card',
    fidelity_score: 0.9,
    geometric_iou: 0.9,
    ...extra,
  };
}

function validateErrors(extra: Record<string, unknown>): string[] {
  const raw = { schema_version: '1.0', screens: [screen(extra)] };
  return validateVisualDiffJson(raw, ROOT).errors;
}

function hasErr(errors: string[], needle: string): boolean {
  return errors.some(e => e.includes(needle));
}

// ---- v1：defects[] schema ----

test('v1: 合法 defects → 无 defects schema 报错', () => {
  const errs = validateErrors({
    defects: [
      { class: 'clipping', element: 'service_grid', bbox: [0.1, 0.2, 0.3, 0.1], severity: 'major', note: '宫格图标上半被裁' },
      { class: 'shape_mismatch', severity: 'minor', note: '按钮偏宽' },
    ],
  });
  assert.ok(!hasErr(errs, 'defects'), `合法 defects 不应报错：${errs.join('；')}`);
});

test('v1: 非法 class → 命中', () => {
  assert.ok(hasErr(validateErrors({ defects: [{ class: 'bogus', severity: 'major', note: 'x' }] }), 'class 非法'));
});

test('v1: 非法 severity → 命中', () => {
  assert.ok(hasErr(validateErrors({ defects: [{ class: 'clipping', severity: 'huge', note: 'x' }] }), 'severity 非法'));
});

test('v1: 缺 note → 命中', () => {
  assert.ok(hasErr(validateErrors({ defects: [{ class: 'clipping', severity: 'major' }] }), 'note 必填'));
});

test('v1: bbox 越界 → 命中', () => {
  assert.ok(hasErr(validateErrors({ defects: [{ class: 'clipping', severity: 'major', note: 'x', bbox: [0.1, 0.2, 1.5, 0.1] }] }), 'bbox 须为 4 个'));
});

test('v1: defects 非数组 → 命中', () => {
  assert.ok(hasErr(validateErrors({ defects: { class: 'clipping' } }), 'defects 须为数组'));
});

// ---- plan c4e7a9b2 t2（A2）：missing_render 必带 ref_element；唯一授权判定 + 有效视图 ----

test('A2: missing_render 缺 ref_element → schema 命中；带 ref_element / 其余类不要求', () => {
  assert.ok(hasErr(validateErrors({ defects: [{ class: 'missing_render', element: 'result_done', severity: 'major', note: 'x' }] }), 'ref_element'));
  assert.ok(!hasErr(validateErrors({ defects: [{ class: 'missing_render', ref_element: 'result_nfc_card', severity: 'major', note: 'x' }] }), 'ref_element'));
  assert.ok(!hasErr(validateErrors({ defects: [{ class: 'shape_mismatch', element: 'result_status', severity: 'major', note: 'x' }] }), 'ref_element'));
});

const A2_SCOPE = {
  refElements: [
    { element_id: 'result_nfc_card', disposition: 'excluded' as const, requirement_quote: '再往下的激活nfc部分本次先不需要' },
    { element_id: 'result_banner', disposition: 'defer' as const },
    { element_id: 'result_done', disposition: 'implement' as const },
  ],
  uiSpecIds: new Set(['result_status']),
};

test('A2: defectRepairAuthority 四态判定表', () => {
  const mr = (ref?: string) => ({ class: 'missing_render' as const, element: 'result_done', ...(ref ? { ref_element: ref } : {}), severity: 'major' as const, note: 'x' });
  assert.strictEqual(defectRepairAuthority(mr(), A2_SCOPE), 'incomplete');
  assert.strictEqual(defectRepairAuthority(mr('result_nfc_card'), A2_SCOPE), 'excluded');
  assert.strictEqual(defectRepairAuthority(mr('RESULT_NFC_CARD'), A2_SCOPE), 'excluded', 'element_id 大小写不敏感（与 uiSpecCoversElementId 同口径）');
  assert.strictEqual(defectRepairAuthority(mr('result_unknown'), A2_SCOPE), 'scope_unclear');
  assert.strictEqual(defectRepairAuthority(mr('result_done'), A2_SCOPE), 'authorized');
  assert.strictEqual(defectRepairAuthority(mr('result_banner'), A2_SCOPE), 'authorized', 'defer 维持现状（既有债务路径）');
  assert.strictEqual(defectRepairAuthority(mr('result_status'), A2_SCOPE), 'authorized', 'ui-spec 已声明元素即登记');
  assert.strictEqual(defectRepairAuthority(mr('result_nfc_card'), { refElements: null, uiSpecIds: new Set<string>() }), 'scope_unclear');
  assert.strictEqual(defectRepairAuthority({ class: 'shape_mismatch', element: 'result_done', severity: 'major', note: 'x' }, A2_SCOPE), 'authorized');
});

test('三轮返修#1: 排除范围优先于缺陷分类；非 missing_render 锚点须已登记', () => {
  const d = (cls: 'shape_mismatch' | 'other' | 'clipping', extra: Record<string, unknown>) =>
    ({ class: cls, severity: 'major' as const, note: 'x', ...extra });
  assert.strictEqual(defectRepairAuthority(d('shape_mismatch', { element: 'result_done', ref_element: 'result_nfc_card' }), A2_SCOPE), 'excluded', '换成 shape_mismatch 仍 excluded');
  assert.strictEqual(defectRepairAuthority(d('other', { element: 'result_done', ref_element: 'result_nfc_card' }), A2_SCOPE), 'excluded', 'other 同样');
  assert.strictEqual(defectRepairAuthority(d('clipping', { element: 'result_nfc_card' }), A2_SCOPE), 'excluded', '锚点本身是 excluded 元素');
  assert.strictEqual(defectRepairAuthority(d('shape_mismatch', { element: 'result_status' }), A2_SCOPE), 'authorized', 'ui-spec 已声明锚点照常返修');
  assert.strictEqual(defectRepairAuthority(d('shape_mismatch', { element: 'result_banner' }), A2_SCOPE), 'authorized', 'ref-elements 登记（defer）锚点维持现状');
  assert.strictEqual(defectRepairAuthority(d('shape_mismatch', { element: 'result_mystery' }), A2_SCOPE), 'scope_unclear', '锚点未登记不直接授权');
  // 五轮返修：无锚点一律 incomplete（T8 转录模板恒带 finding.elements[0]，来源标签不构成授权），仅无声明源维持 authorized
  const t8 = { producer: 'T8' as const, finding_id: 'nonexistent', signal: 'clip' };
  const provider = { producer: 'visual_provider' as const, invoke_id: 'review-i1' };
  assert.strictEqual(defectRepairAuthority(d('other', { source: t8, bbox: [0.1, 0.1, 0.2, 0.2] }), A2_SCOPE), 'incomplete', '来源标签不构成授权：自称 T8 无锚点同判证据不全');
  assert.strictEqual(defectRepairAuthority(d('clipping', { source: t8, element: 'result_done' }), A2_SCOPE), 'authorized', '真实 T8 转录形状（带已声明锚点）照常返修');
  assert.strictEqual(defectRepairAuthority(d('shape_mismatch', { source: provider, bbox: [0.1, 0.1, 0.2, 0.2] }), A2_SCOPE), 'incomplete', 'provider 源无锚点不得借省略标识重获授权');
  assert.strictEqual(defectRepairAuthority(d('other', {}), A2_SCOPE), 'incomplete', '无 source（primary 手写）无锚点同判证据不全');
  assert.strictEqual(defectRepairAuthority(d('shape_mismatch', { source: provider }), { refElements: null, uiSpecIds: new Set<string>() }), 'authorized', '无声明源（legacy）维持现状');
});

test('A2: effectiveScreens 剔除 excluded/scope_unclear 及只由它们支撑的 must_fix/fail，保留其余并重映射 refs', () => {
  const nfc = { class: 'missing_render' as const, element: 'result_done', ref_element: 'result_nfc_card', severity: 'major' as const, note: 'nfc', must_fix_refs: [0] };
  const unclear = { class: 'missing_render' as const, element: 'result_done', ref_element: 'result_qr', severity: 'major' as const, note: 'qr', must_fix_refs: [1] };
  const real = { class: 'shape_mismatch' as const, element: 'result_status', severity: 'major' as const, note: 'real', must_fix_refs: [2] };
  const onlyExcluded: VisualDiffScreenEntry = { screen_id: 'a', verdict: 'fail', must_fix: ['add nfc'], defects: [{ ...nfc }] };
  const mixed: VisualDiffScreenEntry = { screen_id: 'b', verdict: 'fail', must_fix: ['add nfc', 'add qr', 'fix status'], defects: [nfc, unclear, real] };
  const view = effectiveScreens({ screens: [onlyExcluded, mixed] }, A2_SCOPE);
  assert.strictEqual(view.screens[0].verdict, 'pass');
  assert.deepStrictEqual(view.screens[0].must_fix, []);
  assert.deepStrictEqual(view.screens[0].defects, []);
  assert.strictEqual(view.screens[1].verdict, 'fail');
  assert.deepStrictEqual(view.screens[1].must_fix, ['fix status']);
  assert.deepStrictEqual(view.screens[1].defects?.map(d => [d.note, d.must_fix_refs]), [['real', [0]]]);
  assert.deepStrictEqual(view.excluded.map(e => `${e.screen_id}/${e.ref_element}`), ['a/result_nfc_card', 'b/result_nfc_card']);
  assert.deepStrictEqual(view.scopeUnclear.map(e => `${e.screen_id}/${e.ref_element}`), ['b/result_qr']);
  assert.strictEqual(onlyExcluded.verdict, 'fail', '原始观察不得被改写');
  assert.strictEqual(onlyExcluded.defects?.length, 1);
});

test('返修#2: effectiveScreens 从 reverse_missing 剔除 excluded 元素（原始保留、其余照留）', () => {
  // 三轮返修#2：未登记元素同样剔除并进 scopeUnclear；已登记（implement / ui-spec）照留
  const s: VisualDiffScreenEntry = { screen_id: 'r', verdict: 'pass', defects: [], reverse_missing: ['RESULT_NFC_CARD', 'result_done', 'result_status', 'result_qr'] };
  const view = effectiveScreens({ screens: [s] }, A2_SCOPE);
  assert.deepStrictEqual(view.screens[0].reverse_missing, ['result_done', 'result_status']);
  assert.deepStrictEqual(s.reverse_missing, ['RESULT_NFC_CARD', 'result_done', 'result_status', 'result_qr'], '原始观察不改写');
  assert.deepStrictEqual(view.excluded.map(e => `${e.screen_id}/${e.ref_element}`), ['r/RESULT_NFC_CARD']);
  assert.deepStrictEqual(view.scopeUnclear.map(e => `${e.screen_id}/${e.ref_element}`), ['r/result_qr']);
});

test('返修#3: loadRefElementsFile 把缺省/非法 disposition 读兼容为 implement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-el-'));
  try {
    const p = path.join(dir, 'ref-elements.yaml');
    fs.writeFileSync(p, JSON.stringify({ elements: [
      { element_id: 'a', disposition: 'implement' }, { element_id: 'b' }, { element_id: 'c', disposition: 'defer' },
      { element_id: 'd', disposition: 'excluded', requirement_quote: 'q' }, { element_id: 'e', disposition: 'exclude' },
    ] }));
    assert.deepStrictEqual(loadRefElementsFile(p)?.elements.map(e => `${e.element_id}:${e.disposition}`),
      ['a:implement', 'b:implement', 'c:defer', 'd:excluded', 'e:implement']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- v2：edge_* schema ----

test('v2: 合法 edge 字段 → 无 edge schema 报错', () => {
  const errs = validateErrors({ edge_over_threshold_tiles: [[2, 4], [3, 1]], edge_tile_divergence: 0.7 });
  assert.ok(!hasErr(errs, 'edge_'), `合法 edge 不应报错：${errs.join('；')}`);
});

test('v2: edge_tile_divergence 越界 → 命中', () => {
  assert.ok(hasErr(validateErrors({ edge_tile_divergence: 1.5 }), 'edge_tile_divergence'));
});

test('v2: edge_over_threshold_tiles 非 [row,col] 对 → 命中', () => {
  assert.ok(hasErr(validateErrors({ edge_over_threshold_tiles: [[2, 4, 5]] }), 'edge_over_threshold_tiles'));
});

// ---- v2：坐标对账 + 最小未覆盖地板（collectEdgeSentinelUncovered，MIN=5 吸收 FP 地板） ----

const SIX_TILES: number[][] = [[2, 0], [2, 1], [3, 0], [3, 1], [6, 4], [6, 5]];

test('v2 哨兵: ≥5 未覆盖 tile → 登记复核', () => {
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'home', verdict: 'pass', edge_over_threshold_tiles: SIX_TILES, defects: [] },
  ];
  const out = collectEdgeSentinelUncovered(screens);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tiles.length, 6);
});

test('v2 哨兵: FP 地板（3 tile）< 阈值 → 不登记', () => {
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'home', verdict: 'pass', edge_over_threshold_tiles: [[2, 0], [2, 1], [3, 0]], defects: [] },
  ];
  assert.strictEqual(collectEdgeSentinelUncovered(screens).length, 0);
});

test('v2 对账: defect.bbox 覆盖 1 tile、余 5 仍登记且排除已覆盖（reviewer 要求夹具）', () => {
  // tile [2,0] 归一矩形 = [0, 0.25, 1/6, 1/8]；bbox [0,0.24,0.1,0.05] 仅与之相交
  const screens: VisualDiffScreenEntry[] = [
    {
      screen_id: 'home',
      verdict: 'pass',
      edge_over_threshold_tiles: SIX_TILES,
      defects: [{ class: 'shape_mismatch', bbox: [0, 0.24, 0.1, 0.05], severity: 'major', note: '覆盖 [2,0]' }],
    },
  ];
  const out = collectEdgeSentinelUncovered(screens);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].tiles.length, 5);
  assert.ok(!out[0].tiles.some(t => t[0] === 2 && t[1] === 0), '[2,0] 应被 defect.bbox 排除');
});

test('v2 对账: 覆盖至余 4(<5) → 不再登记', () => {
  // bbox [0,0.24,0.34,0.05] 覆盖 [2,0]+[2,1]，余 4 < 5
  const screens: VisualDiffScreenEntry[] = [
    {
      screen_id: 'home',
      verdict: 'pass',
      edge_over_threshold_tiles: SIX_TILES,
      defects: [{ class: 'clipping', bbox: [0, 0.24, 0.34, 0.05], severity: 'major', note: '覆盖 [2,0][2,1]' }],
    },
  ];
  assert.strictEqual(collectEdgeSentinelUncovered(screens).length, 0);
});

test('v2 哨兵: 无 edge tile → 不登记', () => {
  const screens: VisualDiffScreenEntry[] = [{ screen_id: 'home', verdict: 'pass', defects: [] }];
  assert.strictEqual(collectEdgeSentinelUncovered(screens).length, 0);
});

// ---- T4：P0 warn 屏零可执行信号（collectWarnP0NoActionable） ----

const T4_P0 = ['home_with_card', 'manage_non_local', 'card_pack'];

test('T4: P0 warn + must_fix 空 → 命中（home_with_card/manage_non_local 压线逃逸）', () => {
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'home_with_card', verdict: 'warn', fidelity_score: 0.52, defects: [], reverse_missing: [] },
    { screen_id: 'manage_non_local', verdict: 'warn', fidelity_score: 0.48, defects: [], reverse_missing: [] },
  ];
  const hit = collectWarnP0NoActionable(screens, T4_P0).map(s => s.screen_id);
  assert.deepStrictEqual(hit.sort(), ['home_with_card', 'manage_non_local']);
});

test('T4: P0 warn 但带非空 must_fix → 不命中（已说清改哪）', () => {
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'home_with_card', verdict: 'warn', must_fix: ['卡包描述应在卡夹插画下方'], defects: [], reverse_missing: [] },
  ];
  assert.strictEqual(collectWarnP0NoActionable(screens, T4_P0).length, 0);
});

test('T4 (review#1): P0 warn 仅带 defects/reverse_missing 但 must_fix 空 → 仍命中（证据不替代回修指令）', () => {
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'home_with_card', verdict: 'warn', defects: [{ class: 'shape_mismatch', severity: 'minor', note: 'x' }], reverse_missing: [] },
    { screen_id: 'manage_non_local', verdict: 'warn', defects: [], reverse_missing: ['non_local_title'] },
  ];
  const hit = collectWarnP0NoActionable(screens, T4_P0).map(s => s.screen_id);
  assert.deepStrictEqual(hit.sort(), ['home_with_card', 'manage_non_local']);
});

test('T4: 非 P0 warn 零信号 → 不命中（只收紧 P0）', () => {
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'some_p2_screen', verdict: 'warn', defects: [], reverse_missing: [] },
  ];
  assert.strictEqual(collectWarnP0NoActionable(screens, T4_P0).length, 0);
});

test('T4: pass 屏不计入（只针对 warn）', () => {
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'card_pack', verdict: 'pass', fidelity_score: 0.98, defects: [], reverse_missing: [] },
  ];
  assert.strictEqual(collectWarnP0NoActionable(screens, T4_P0).length, 0);
});

// ---- v2 FP-safe（端到端 worker，jimp 不可用则跳过）：同内容仅设备比例缩放，拉伸应抵消 ----

test('v2 FP: 同内容仅设备比例缩放 → 拉伸抵消、哨兵静默（FP-safe）', async () => {
  const Jimp = loadJimp();
  if (!Jimp || !isJimpAvailable()) return; // 无 jimp 环境跳过，不失败
  const w = 200;
  // 整页稿：10 条水平带（结构/边缘），宽高比 0.349（200×573）
  const ref = new Jimp(w, 573, 0xffffffff);
  ref.scan(0, 0, w, 573, (_x: number, y: number, idx: number) => {
    const v = Math.floor(y / (573 / 10)) % 2 ? 40 : 220;
    ref.bitmap.data[idx] = v;
    ref.bitmap.data[idx + 1] = v;
    ref.bitmap.data[idx + 2] = v;
    ref.bitmap.data[idx + 3] = 255;
  });
  const dev = ref.clone().resize(w, 321); // 同内容、设备宽高比 0.623
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fp-'));
  const refP = path.join(dir, 'ref.png');
  const devP = path.join(dir, 'dev.png');
  await ref.writeAsync(refP);
  await dev.writeAsync(devP);
  const res = computeEdgeDensityTileDivergence(refP, devP);
  assert.ok(res.ok, `edge-tile 应成功：${res.error ?? ''}`);
  const screen: VisualDiffScreenEntry = {
    screen_id: 's',
    verdict: 'pass',
    edge_over_threshold_tiles: res.tiles ?? [],
    defects: [],
  };
  assert.strictEqual(
    collectEdgeSentinelUncovered([screen]).length,
    0,
    `同内容仅设备比例缩放不应触发哨兵（拉伸抵消比例差），tiles=${JSON.stringify(res.tiles)}`,
  );
});

export async function runAll(): Promise<UnitCaseResult[]> {
  const out: UnitCaseResult[] = [];
  for (const c of CASES) {
    try {
      await c.run();
      out.push({ name: c.name, ok: true });
    } catch (e) {
      out.push({ name: c.name, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) });
    }
  }
  return out;
}
