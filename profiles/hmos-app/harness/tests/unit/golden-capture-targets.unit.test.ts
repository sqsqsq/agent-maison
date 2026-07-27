/**
 * golden-capture-targets.unit.test.ts — golden 显式 capture targets（c4e8b1d3 G3 生产接线）
 *
 * 三个钉死用例（plan v17）：
 *   ① golden 显式选择 P1 bank_card_list_sheet → 采集产出 bank_card_list_sheet__overlay__0
 *     （现状 collectP0OverlayTargetIds 先过 P0 过滤，P1 屏永不进 overlay 遍历——本接线是
 *      contract 可被生产满足的前提）；
 *   ② 普通 visual-diff 不传 golden targets → 仍不采普通 P1（防全局扩面）；
 *   ③ contract 要求的 declared 屏在 ui-spec 缺失 / 形态不符 → fail-closed（errors +
 *      p0CaptureFailures 点名，不静默跳过）。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { captureVisualDiff, loadGoldenContractTargetsFromEnv } from '../../visual-diff-capture';
import {
  collectP0VisualTargetIds,
  resolveGoldenCaptureTargets,
} from '../../visual-diff-targets';
import type { UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

/** 缩到最小的 bc-openCard 形态：1 个 P0 顶层屏 + 1 个 P1 overlay-root 屏（golden 关切点） */
const UI_DOC: UiSpecDoc = {
  screens: [
    { id: 'all_banks', priority: 'P0', ref_id: 'all_banks', root: { type: 'navigation_frame', order: 0 } },
    {
      id: 'bank_card_list_sheet', priority: 'P1', ref_id: 'bank_card_list_sheet',
      root: { type: 'overlay_panel', order: 0 },
    },
  ],
  tokens: {}, assets: [],
} as unknown as UiSpecDoc;

const GOLDEN = [
  { declared: 'all_banks', capture: 'all_banks' },
  { declared: 'bank_card_list_sheet', capture: 'bank_card_list_sheet__overlay__0' },
];

function mkRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'golden-cap-'));
}

function runCapture(root: string, golden?: typeof GOLDEN): ReturnType<typeof captureVisualDiff> {
  return captureVisualDiff({
    projectRoot: root,
    feature: 'bc-openCard',
    uiDoc: UI_DOC,
    ...(golden ? { goldenTargets: golden } : {}),
    screenshotFn: args => {
      fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
      fs.writeFileSync(args.destAbs, crypto.randomBytes(64));
      return { ok: true };
    },
  });
}

function screenIds(root: string): string[] {
  const p = path.join(root, 'doc', 'features', 'bc-openCard', 'device-testing', 'device-screenshots', 'visual-diff.json');
  if (!fs.existsSync(p)) return [];
  const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as { screens: Array<{ screen_id: string }> };
  return doc.screens.map(s => s.screen_id);
}

test('① golden 显式选择 P1 bank_card_list_sheet → 产出 bank_card_list_sheet__overlay__0', () => {
  const root = mkRoot();
  const r = runCapture(root, GOLDEN);
  assert.strictEqual(r.ok, true, `capture 须成功：${r.errors.join('; ')}`);
  const ids = screenIds(root);
  assert.ok(ids.includes('bank_card_list_sheet__overlay__0'),
    `P1 overlay 须被显式采集：${ids.join(', ')}`);
  assert.ok(ids.includes('all_banks'), 'P0 屏照常采集');
});

test('② 普通 visual-diff 不传 golden targets → 仍不采普通 P1（防全局扩面）', () => {
  const root = mkRoot();
  const r = runCapture(root);
  assert.strictEqual(r.ok, true, r.errors.join('; '));
  const ids = screenIds(root);
  assert.ok(!ids.some(id => id.startsWith('bank_card_list_sheet')),
    `P1 屏不得进入普通采集：${ids.join(', ')}`);
  // 纯函数口径同断言：P0 target 集合不含 P1
  assert.ok(!collectP0VisualTargetIds(UI_DOC).some(id => id.startsWith('bank_card_list_sheet')),
    'collectP0VisualTargetIds 保持 P0-only');
});

test('③ contract 屏在 ui-spec 缺失 / 形态不符 → fail-closed（errors + p0CaptureFailures 点名）', () => {
  // 缺失：declared 屏不在 ui-spec
  const missing = resolveGoldenCaptureTargets(UI_DOC, [{ declared: 'ghost_screen', capture: 'ghost_screen' }]);
  assert.strictEqual(missing.failures.length, 1);
  assert.ok(missing.failures[0].reason.includes('缺失'), missing.failures[0].reason);

  // 形态不符：contract 期望 overlay capture，但屏不是 overlay root
  const shape = resolveGoldenCaptureTargets(UI_DOC, [{ declared: 'all_banks', capture: 'all_banks__overlay__0' }]);
  assert.strictEqual(shape.failures.length, 1);
  assert.ok(shape.failures[0].reason.includes('capture id 失配'), shape.failures[0].reason);

  // 反向形态不符：overlay-root 屏却期望同名 capture
  const shape2 = resolveGoldenCaptureTargets(UI_DOC, [{ declared: 'bank_card_list_sheet', capture: 'bank_card_list_sheet' }]);
  assert.strictEqual(shape2.failures.length, 1);
  assert.ok(shape2.failures[0].reason.includes('形态不符'), shape2.failures[0].reason);

  // 集成面：capture 结果把失败点名进 errors + p0CaptureFailures（不静默）
  const root = mkRoot();
  const r = runCapture(root, [
    { declared: 'all_banks', capture: 'all_banks' },
    { declared: 'ghost_screen', capture: 'ghost_screen__overlay__0' },
  ] as typeof GOLDEN);
  assert.ok(r.errors.some(e => e.includes('golden_contract:ghost_screen')),
    `errors 须点名 golden 失败：${r.errors.join('; ')}`);
  assert.ok((r.p0CaptureFailures ?? []).includes('ghost_screen'),
    `p0CaptureFailures 须含 ghost_screen：${(r.p0CaptureFailures ?? []).join(', ')}`);
});

test('随包 contract 文件：shape 合法 + 与 env 装载器互通 + bank_card_list_sheet 映射在场', () => {
  const contractAbs = path.resolve(__dirname, '../../../../../harness/scripts/consumer-golden/bc-opencard.golden-contract.json');
  assert.ok(fs.existsSync(contractAbs), `随包 contract 须存在：${contractAbs}`);
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  process.env.MAISON_GOLDEN_CONTRACT = contractAbs;
  try {
    const targets = loadGoldenContractTargetsFromEnv(path.dirname(contractAbs));
    assert.ok(targets && targets.length === 10, `contract 须固定 10 屏：${targets?.length}`);
    assert.ok(targets!.some(t => t.declared === 'bank_card_list_sheet' && t.capture === 'bank_card_list_sheet__overlay__0'),
      'P1 屏 declared↔capture 映射须在 contract 内');
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
  }
});

test('round19 P1：golden 模式盖 captured_in_run 戳，且跨 run 同 build 强制重采；同 run 重试仍可跳采', () => {
  const FP = 'aaaaaaaaaaaa';
  const prevRun = process.env.MAISON_GOAL_RUN_ID;
  const root = mkRoot();
  const shotRel = 'doc/features/bc-openCard/device-testing/device-screenshots/shot-all_banks.png';
  const shotAbs = path.join(root, shotRel);
  fs.mkdirSync(path.dirname(shotAbs), { recursive: true });
  fs.writeFileSync(shotAbs, Buffer.from('stable-bytes'));
  // 既有已定判定：run-A 采集、同 build、evaluated hash 与盘上一致（P0-9a 可跳采形态）
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { hashScreenshotFile } = require('../../visual-diff-check') as { hashScreenshotFile: (p: string) => string | null };
  const diskHash = hashScreenshotFile(shotAbs)!;
  const vdPath = path.join(root, 'doc/features/bc-openCard/device-testing/device-screenshots/visual-diff.json');
  fs.writeFileSync(vdPath, JSON.stringify({
    schema_version: '1.1',
    screens: [{
      screen_id: 'all_banks', screenshot_path: shotRel, verdict: 'pass',
      screenshot_hash: diskHash, evaluated_screenshot_hash: diskHash,
      evaluated_build_fingerprint: FP, captured_in_run: 'run-A',
    }],
  }, null, 2));
  const capture = (golden: boolean): number => {
    let calls = 0;
    captureVisualDiff({
      projectRoot: root, feature: 'bc-openCard', uiDoc: UI_DOC,
      currentBuildFingerprint: FP,
      ...(golden ? { goldenTargets: [{ declared: 'all_banks', capture: 'all_banks' }] } : {}),
      screenshotFn: args => {
        calls++;
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, crypto.randomBytes(64));
        return { ok: true };
      },
    });
    return calls;
  };
  try {
    // 普通模式，run-B：P0-9a 判定持久，跳采（行为不变）
    process.env.MAISON_GOAL_RUN_ID = 'run-B';
    assert.strictEqual(capture(false), 0, '普通模式同 build 已定屏不得重采（P0-9a 保持）');
    // golden 模式，run-B：条目是 run-A 采的 → 强制本 run 重采
    assert.ok(capture(true) >= 1, 'golden 模式跨 run 须强制重采');
    const doc = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<{ screen_id: string; captured_in_run?: string }> };
    const entry = doc.screens.find(s => s.screen_id === 'all_banks')!;
    assert.strictEqual(entry.captured_in_run, 'run-B', `重采后 run 戳须更新：${JSON.stringify(entry)}`);
    // golden 模式，同 run 重试：条目已是 run-B 采的 → 可跳采（同 run 内不空转）
    // 注：上一步重采字节已变、verdict 回 pending，pending 本就不可跳采——先把判定补齐成可跳采形态
    const doc2 = JSON.parse(fs.readFileSync(vdPath, 'utf-8')) as { screens: Array<Record<string, unknown>> };
    const e2 = doc2.screens.find(s => s.screen_id === 'all_banks')!;
    const nowHash = hashScreenshotFile(shotAbs)!;
    e2.verdict = 'pass';
    e2.screenshot_hash = nowHash;
    e2.evaluated_screenshot_hash = nowHash;
    e2.evaluated_build_fingerprint = FP;
    fs.writeFileSync(vdPath, JSON.stringify({ schema_version: '1.1', screens: doc2.screens }, null, 2));
    assert.strictEqual(capture(true), 0, 'golden 同 run 重试（run 戳一致）可跳采');
  } finally {
    if (prevRun === undefined) delete process.env.MAISON_GOAL_RUN_ID;
    else process.env.MAISON_GOAL_RUN_ID = prevRun;
  }
});

test('round20 P1：golden 负向证据生产——导航+dump 写 wrapper（run/build 绑定）；能力缺失 fail-closed 点名', () => {
  const prevRun = process.env.MAISON_GOAL_RUN_ID;
  process.env.MAISON_GOAL_RUN_ID = 'run-F';
  try {
    const root = mkRoot();
    const forbidden = [{ id: 'HomeTab', anchor: 'bank_card_section', evidence: 'device-testing/device-screenshots/layout-HomeTab.json' }];
    const r = captureVisualDiff({
      projectRoot: root,
      feature: 'bc-openCard',
      uiDoc: UI_DOC,
      goldenTargets: GOLDEN.filter(t => t.declared === 'all_banks'),
      goldenForbidden: forbidden,
      currentBuildFingerprint: 'fp0123456789',
      navConfig: { all_banks: [], HomeTab: [] },
      navExecutorFn: () => ({ ok: true }),
      layoutDumpFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, JSON.stringify({ nodes: [{ id: 'home_root' }] }));
        return { ok: true };
      },
      screenshotFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, crypto.randomBytes(64));
        return { ok: true };
      },
    });
    assert.strictEqual(r.ok, true, r.errors.join('; '));
    const evidenceAbs = path.join(root, 'doc', 'features', 'bc-openCard', 'device-testing', 'device-screenshots', 'layout-HomeTab.json');
    assert.ok(fs.existsSync(evidenceAbs), 'wrapper 证据须落盘');
    const ev = JSON.parse(fs.readFileSync(evidenceAbs, 'utf-8')) as Record<string, unknown>;
    assert.strictEqual(ev.kind, 'golden_forbidden_evidence');
    assert.strictEqual(ev.run_id, 'run-F', 'run 绑定须盖戳');
    assert.strictEqual(ev.evaluated_build_fingerprint, 'fp0123456789', 'build 绑定须盖戳');
    assert.ok(JSON.stringify(ev.tree).includes('home_root'), 'tree 须承载 dump 内容');

    // 能力缺失（无 layoutDumpFn）→ fail-closed：errors + p0CaptureFailures 点名，不静默
    const root2 = mkRoot();
    const r2 = captureVisualDiff({
      projectRoot: root2, feature: 'bc-openCard', uiDoc: UI_DOC,
      goldenTargets: GOLDEN.filter(t => t.declared === 'all_banks'),
      goldenForbidden: forbidden,
      navConfig: { all_banks: [], HomeTab: [] },
      navExecutorFn: () => ({ ok: true }),
      screenshotFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, crypto.randomBytes(64));
        return { ok: true };
      },
    });
    assert.ok(r2.errors.some(e => e.includes('golden_forbidden:HomeTab')),
      `能力缺失须点名：${r2.errors.join('; ')}`);
    assert.ok((r2.p0CaptureFailures ?? []).includes('HomeTab'), 'p0CaptureFailures 须含 HomeTab');
  } finally {
    if (prevRun === undefined) delete process.env.MAISON_GOAL_RUN_ID;
    else process.env.MAISON_GOAL_RUN_ID = prevRun;
  }
});

test('env 设了却读不出（路径错）→ 抛错 fail-closed（golden 回归不许静默降级 P0-only）', () => {
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  process.env.MAISON_GOLDEN_CONTRACT = path.join(os.tmpdir(), 'nonexistent-golden-contract.json');
  try {
    assert.throws(() => loadGoldenContractTargetsFromEnv(os.tmpdir()), /不存在/);
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
  }
});

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).stack ?? String(err) });
    }
  }
  return results;
}
