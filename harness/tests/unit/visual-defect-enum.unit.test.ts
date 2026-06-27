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
  type VisualDiffScreenEntry,
} from '../../../profiles/hmos-app/harness/visual-diff-check';
import { computeEdgeDensityTileDivergence, isJimpAvailable } from '../../../profiles/hmos-app/harness/image-toolkit';
import type { UnitCaseResult } from '../run-unit';

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
