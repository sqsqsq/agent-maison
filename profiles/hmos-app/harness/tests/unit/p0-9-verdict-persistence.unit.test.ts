/**
 * P0-9 判定持久化单测（plan e7a91b3c）：
 *   病灶＝mergeCapturedScreenEntry 以像素恒等作证据新鲜度键——真机状态栏时钟/轮播必漂移，
 *   agent 的 warn+must_fix 乃至真人 confirmed_by 的 pass 都活不过下一次 capture（2026-07-05
 *   回修轮实锤：第 7 次已写 5 屏 warn+must_fix，goal-runner 终跑 harness 重采后全灭）。
 *   验收铁律：
 *   - 【病灶动态复刻·必备】agent 写 warn+must_fix → 下一轮 capture（新采字节不同）不清空；
 *   - 换 build（指纹变）/盘上文件被替换/entry 缺指纹(legacy)/当前指纹不可算 → 一律照常重采失效
 *     （codex skip 硬前提：指纹缺失/不可读/计算失败不得 skip）；
 *   - 真人 confirmed_by pass 同 build 下跨 capture 存活；
 *   - isStaleVisualDiffVerdict 改键：文件级校验保留 + 指纹可算时缺失/不一致=stale。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  captureVisualDiff,
  canSkipRecaptureForScreen,
} from '../../visual-diff-capture';
import {
  hashScreenshotFile,
  isStaleVisualDiffVerdict,
  type VisualDiffScreenEntry,
} from '../../visual-diff-check';
import { computeHapBuildFingerprint, resolveCurrentBuildFingerprint } from '../../build-fingerprint';
import { clearFrameworkConfigCache } from '../../../../../harness/config';
import type { UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

const FP_A = 'aaaaaaaaaaaa';
const FP_B = 'bbbbbbbbbbbb';

const UI_DOC: UiSpecDoc = {
  screens: [
    { id: 'home', priority: 'P0', ref_id: 'home', root: { type: 'navigation_frame', order: 0 } },
  ],
  tokens: {},
  assets: [],
} as unknown as UiSpecDoc;

interface Fixture {
  root: string;
  shotAbs: string;
  shotRel: string;
  jsonPath: string;
  mdPath: string;
}

function mkFixture(entry: Partial<VisualDiffScreenEntry>, shotBytes: Buffer): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p09-persist-'));
  const shotsDir = path.join(root, 'doc', 'features', 'homepage', 'device-testing', 'device-screenshots');
  fs.mkdirSync(shotsDir, { recursive: true });
  const shotAbs = path.join(shotsDir, 'shot-home.png');
  const shotRel = 'doc/features/homepage/device-testing/device-screenshots/shot-home.png';
  fs.writeFileSync(shotAbs, shotBytes);
  const hash = hashScreenshotFile(shotAbs)!;
  const jsonPath = path.join(shotsDir, 'visual-diff.json');
  const full: VisualDiffScreenEntry = {
    screen_id: 'home',
    verdict: 'warn',
    screenshot_path: shotRel,
    ref_id: 'home',
    screenshot_hash: hash,
    evaluated_screenshot_hash: hash,
    evaluated_build_fingerprint: FP_A,
    must_fix: ['底部 tab 缺胶囊图标'],
    reverse_missing: [],
    defects: [],
    ...entry,
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify({ schema_version: '1.0', screens: [full] }, null, 2)}\n`);
  return {
    root,
    shotAbs,
    shotRel,
    jsonPath,
    mdPath: path.join(root, 'doc', 'features', 'homepage', 'device-testing', 'visual-diff.md'),
  };
}

function runCapture(fx: Fixture, currentFp: string | null): { calls: number; result: ReturnType<typeof captureVisualDiff> } {
  let calls = 0;
  const result = captureVisualDiff({
    projectRoot: fx.root,
    feature: 'homepage',
    uiDoc: UI_DOC,
    currentBuildFingerprint: currentFp,
    screenshotFn: args => {
      calls++;
      // 模拟真机重采：状态栏时钟变化 → 字节必然不同
      fs.writeFileSync(args.destAbs, crypto.randomBytes(64));
      return { ok: true };
    },
  });
  return { calls, result };
}

function readScreen(fx: Fixture): VisualDiffScreenEntry {
  const rep = JSON.parse(fs.readFileSync(fx.jsonPath, 'utf-8')) as { screens: VisualDiffScreenEntry[] };
  return rep.screens.find(s => s.screen_id === 'home')!;
}

test('p0_9a_lesion_replay_warn_must_fix_survives_recapture', () => {
  // 【病灶动态复刻】同 build：agent 的 warn+must_fix 跨 capture 存活，屏被跳采（截图函数零调用）
  const fx = mkFixture({}, Buffer.from('bytes-A'));
  try {
    const { calls, result } = runCapture(fx, FP_A);
    assert.strictEqual(calls, 0, '同 build 已定屏不得重采');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.screensPreservedBuildValid, 1);
    assert.strictEqual(result.screensWritten, 0);
    const s = readScreen(fx);
    assert.strictEqual(s.verdict, 'warn', '判定不得被清空（本轮实锤病灶）');
    assert.deepStrictEqual(s.must_fix, ['底部 tab 缺胶囊图标'], 'must_fix 回修指令不得被销毁');
    assert.ok(fs.readFileSync(fx.shotAbs, 'utf-8') === 'bytes-A', '绑定截图文件不得被覆盖');
    assert.ok(/build 指纹有效跳采/.test(fs.readFileSync(fx.mdPath, 'utf-8')), 'md 投影须标注合法跳采');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('p0_9a_human_confirmed_pass_survives_recapture', () => {
  const fx = mkFixture({ verdict: 'pass', confirmed_by: 'shengqsq', must_fix: [] }, Buffer.from('bytes-A'));
  try {
    const { calls } = runCapture(fx, FP_A);
    assert.strictEqual(calls, 0);
    const s = readScreen(fx);
    assert.strictEqual(s.verdict, 'pass');
    assert.strictEqual(s.confirmed_by, 'shengqsq', '真人确认不得被重采清空（T2 可达性）');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('p0_9a_build_change_invalidates_and_recaptures', () => {
  // 换 build（改码重装）→ 判定自动失效重判（语义恰好正确）
  const fx = mkFixture({}, Buffer.from('bytes-A'));
  try {
    const { calls, result } = runCapture(fx, FP_B);
    assert.strictEqual(calls, 1, '换 build 必须重采');
    assert.strictEqual(result.screensInvalidated, 1);
    const s = readScreen(fx);
    assert.strictEqual(s.verdict, 'pending');
    assert.strictEqual(s.evaluated_build_fingerprint, FP_B, '新采屏须盖新构建指纹戳');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('p0_9a_build_change_identical_bytes_still_invalidates', () => {
  // codex P1：换 build 后即便新截图字节恰好与旧图相同（静态屏极端情形），也必须重判——
  // merge 保留条件须含指纹一致，不能只看像素 hash。
  const fx = mkFixture({}, Buffer.from('bytes-A'));
  try {
    let calls = 0;
    const result = captureVisualDiff({
      projectRoot: fx.root,
      feature: 'homepage',
      uiDoc: UI_DOC,
      currentBuildFingerprint: FP_B, // build 已换
      screenshotFn: args => {
        calls++;
        fs.writeFileSync(args.destAbs, Buffer.from('bytes-A')); // 字节恰好相同
        return { ok: true };
      },
    });
    assert.strictEqual(calls, 1, '换 build 必须重采');
    assert.strictEqual(result.screensInvalidated, 1, '字节相同也须失效（改码必重判）');
    assert.strictEqual(readScreen(fx).verdict, 'pending');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('p0_9a_skip_hard_preconditions', () => {
  // codex 硬前提：指纹 null / entry 缺指纹(legacy) / 盘上文件被替换 → 一律不得 skip
  const nullFp = mkFixture({}, Buffer.from('bytes-A'));
  try {
    const { calls } = runCapture(nullFp, null);
    assert.strictEqual(calls, 1, '当前指纹不可算不得 skip');
    assert.strictEqual(readScreen(nullFp).verdict, 'pending');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(nullFp.root, { recursive: true, force: true });
  }

  const legacy = mkFixture({ evaluated_build_fingerprint: undefined }, Buffer.from('bytes-A'));
  try {
    const { calls } = runCapture(legacy, FP_A);
    assert.strictEqual(calls, 1, 'legacy 无指纹判定视 stale，照常重采');
    assert.strictEqual(readScreen(legacy).verdict, 'pending');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(legacy.root, { recursive: true, force: true });
  }

  const swapped = mkFixture({}, Buffer.from('bytes-A'));
  try {
    fs.writeFileSync(swapped.shotAbs, Buffer.from('bytes-DOCTORED')); // 盘上文件被换（伪证）
    const { calls } = runCapture(swapped, FP_A);
    assert.strictEqual(calls, 1, '绑定文件被替换不得 skip');
    assert.strictEqual(readScreen(swapped).verdict, 'pending');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(swapped.root, { recursive: true, force: true });
  }
});

test('p0_9c_freshness_shapes_for_e1_gate', () => {
  // P0-9c 双向：①合法全跳采 → ok=true、screensPreserved=0、preservedBuildValid=1
  //（E1 公式 stalePreserved = written===0 && preserved>0 不触发——合法新鲜不误伤）；
  // ②采集失败回退 → ok=false/no_captures + p0CaptureFailures（E1 照拦，反陈旧证据语义不丢）。
  const okFx = mkFixture({}, Buffer.from('bytes-A'));
  try {
    const { result } = runCapture(okFx, FP_A);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.screensWritten, 0);
    assert.strictEqual(result.screensPreserved ?? 0, 0, '合法跳采不得计入 preserved（E1 口径隔离）');
    assert.strictEqual(result.screensPreservedBuildValid, 1);
    assert.strictEqual((result.p0CaptureFailures ?? []).length, 0);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(okFx.root, { recursive: true, force: true });
  }

  const failFx = mkFixture({ evaluated_build_fingerprint: undefined }, Buffer.from('bytes-A'));
  try {
    // 指纹 legacy → 须重采，但截图失败 → 采集失败回退旧 json 的形状（E1 FAIL 语义保留）
    const result = captureVisualDiff({
      projectRoot: failFx.root,
      feature: 'homepage',
      uiDoc: UI_DOC,
      currentBuildFingerprint: FP_A,
      screenshotFn: () => ({ ok: false, error: 'Permission denied' }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.skippedReason, 'no_captures');
    assert.deepStrictEqual(result.p0CaptureFailures, ['home'], '采集失败须记 P0 失败（E1 照拦）');
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(failFx.root, { recursive: true, force: true });
  }
});

test('p0_9a_can_skip_pure_predicate', () => {
  const fx = mkFixture({}, Buffer.from('bytes-A'));
  try {
    const entry = readScreen(fx);
    assert.strictEqual(canSkipRecaptureForScreen(entry, fx.root, FP_A), true);
    assert.strictEqual(canSkipRecaptureForScreen(entry, fx.root, FP_B), false);
    assert.strictEqual(canSkipRecaptureForScreen(entry, fx.root, null), false);
    assert.strictEqual(canSkipRecaptureForScreen({ ...entry, verdict: 'pending' }, fx.root, FP_A), false);
    assert.strictEqual(
      canSkipRecaptureForScreen({ ...entry, evaluated_screenshot_hash: undefined }, fx.root, FP_A),
      false,
    );
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('p0_9a_stale_verdict_fingerprint_rules', () => {
  const fx = mkFixture({}, Buffer.from('bytes-A'));
  try {
    const entry = readScreen(fx);
    // 文件在、指纹一致 → 新鲜
    assert.strictEqual(isStaleVisualDiffVerdict(entry, fx.root, { currentBuildFingerprint: FP_A }), false);
    // 指纹不一致 → stale（改码必重判）
    assert.strictEqual(isStaleVisualDiffVerdict(entry, fx.root, { currentBuildFingerprint: FP_B }), true);
    // entry 缺指纹（legacy）+ 当前可算 → stale
    assert.strictEqual(
      isStaleVisualDiffVerdict({ ...entry, evaluated_build_fingerprint: undefined }, fx.root, { currentBuildFingerprint: FP_A }),
      true,
    );
    // 当前指纹不可算 → 指纹校验不启用，退回文件级（不误伤既有交互态/单测环境）
    assert.strictEqual(
      isStaleVisualDiffVerdict({ ...entry, evaluated_build_fingerprint: undefined }, fx.root, { currentBuildFingerprint: null }),
      false,
    );
    // 文件级校验保留：盘上文件被换 → stale（与指纹无关）
    fs.writeFileSync(fx.shotAbs, Buffer.from('bytes-DOCTORED'));
    assert.strictEqual(isStaleVisualDiffVerdict(entry, fx.root, { currentBuildFingerprint: FP_A }), true);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
});

test('p0_9a_build_fingerprint_source_rules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p09-fp-'));
  try {
    const hap = path.join(root, 'app.hap');
    fs.writeFileSync(hap, Buffer.from('hap-content-v1'));
    const fp1 = computeHapBuildFingerprint(hap);
    assert.ok(fp1 && /^[0-9a-f]{12}$/.test(fp1), `指纹=hap 内容 sha256 前 12 hex：${fp1}`);
    assert.strictEqual(computeHapBuildFingerprint(hap), fp1, '同内容指纹稳定');
    fs.writeFileSync(hap, Buffer.from('hap-content-v2'));
    assert.notStrictEqual(computeHapBuildFingerprint(hap), fp1, '内容变指纹必变（mtime/size 不作键）');
    assert.strictEqual(computeHapBuildFingerprint(path.join(root, 'missing.hap')), null, '缺文件 → null（不得 skip）');
    assert.strictEqual(computeHapBuildFingerprint(null), null);
    // install meta 缺失 → null（check 端保守：指纹校验不启用）
    assert.strictEqual(resolveCurrentBuildFingerprint(root, 'homepage', 'testing'), null);
  } finally {
    clearFrameworkConfigCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (e) {
      results.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
