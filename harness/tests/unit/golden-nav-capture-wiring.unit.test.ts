/**
 * golden-nav-capture-wiring.unit.test.ts — c4e8b1d3 Todo 3 入口级接线
 *
 * 目标：nav 校验 / identity 解析 / capture 共用同一份解析后 canonical target 集合
 * `P0 ∪ golden positive capture targets ∪ golden forbidden nav targets`。
 *
 * 测试走 **check-testing 生产接线**（runDeviceVisualDiffCapture 入口：真实读盘
 * ui-spec / visual-diff-nav.json / env MAISON_GOLDEN_CONTRACT + 真实 validateNavConfigV2 /
 * captureVisualDiff），**不向 captureVisualDiff 直接注入 goldenTargets**；仅设备传输面
 * （screenshotFn/layoutDumpFn/navExecutorFn）注入 mock（CI 无真机）。
 *
 * 覆盖（plan Todo 3 补齐项 + 测试要求）：
 *   ① golden 点名 P1 屏 → nav 校验通过、进入 capture target 并产出 `__overlay__0`；
 *   ② golden forbidden target（HomeTab）→ 进 nav 到达集合、被导航并产出负向证据 wrapper；
 *   ③ 无 golden env → 仍严格 P0-only（P1 屏不采集；P1/负向键写进 nav 仍判多余/错写屏名）；
 *   ④ golden declared 缺失/形态不符 → nav gate fail-closed 点名（不跳过 nav 校验）；
 *   ⑤ identity 解析消费同一集合（golden P1 屏通过身份 gate、落 identity_fingerprint）；
 *      HomeTab 缺已确认 identity 在 pixel hard 下同样被 nav 校验拦截（证明 forbidden 在 identity 集内）。
 */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadResolvedProfile } from '../../profile-loader';
import { clearFrameworkConfigCache } from '../../config';
import { runDeviceVisualDiffCapture, __testing_checkDeviceTestRunGate, type DeviceVisualDiffCaptureDevices } from '../../scripts/check-testing';
import { identityFingerprintOf } from '../../../profiles/hmos-app/harness/visual-diff-capture';
import { computeHapSha256Full } from '../../../profiles/hmos-app/harness/build-fingerprint';
import { parseHylyreTrace } from '../../../profiles/hmos-app/harness/providers/device-test-run';
import type { CheckContext, CheckResult } from '../../scripts/utils/types';
import type { UnitCaseResult } from '../run-unit';

const FRAMEWORK_ROOT = path.resolve(__dirname, '..', '..', '..');
const FEATURE = 'bc-test';

export interface UnitCtx {
  projectRoot: string;
  ctx: CheckContext;
  holder: {
    hapPath: string | null;
    installPassed: boolean;
    installExternallyBlocked: boolean;
    buildReused: boolean;
    hylyreTracePath: string | null;
    deviceTestRunExecuted: boolean;
    installExecuted: boolean;
    installOk: boolean;
    hapSha256Full: string | null;
  };
}

function writeFile(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

function writeUiSpec(root: string): void {
  writeFile(root, `doc/features/${FEATURE}/spec/ui-spec.yaml`, [
    'schema_version: "1.0"',
    'verified: human_confirmed',
    'screens:',
    '  - id: all_banks',
    '    priority: P0',
    '    ref_id: all_banks',
    '    root: { type: navigation_frame, order: 0 }',
    '  - id: bank_card_list_sheet',
    '    priority: P1',
    '    ref_id: bank_card_list_sheet',
    '    root: { type: overlay_panel, order: 0 }',
    'tokens: {}',
    'assets: []',
  ].join('\n'));
}

/** 供 buildAuthoritativeRefImageIndex / parseUiChangeFromSpecMarkdown 消费的 spec.md */
function writeSpecMd(root: string): void {
  writeFile(root, `doc/features/${FEATURE}/spec/spec.md`, [
    '# bc-test spec',
    '',
    '```yaml',
    'ui_change: new_or_changed',
    '```',
    '',
  ].join('\n'));
}

/** pixel_1to1 + hard：requireConfirmedIdentity 生效（identity 集成员资格可判别） */
function writeFrameworkConfig(root: string): void {
  writeFile(root, 'framework.config.json', JSON.stringify({
    schema_version: '1.0',
    project_name: 'demo',
    project_type: 'app',
    project_profile: { name: 'hmos-app' },
    agent_adapter: 'cursor',
    architecture: {
      outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'forbid' }],
      module_inner_layers: ['shared', 'data', 'domain', 'presentation'],
      inner_dependency_direction: 'upward',
      cross_module_exports_file: 'index.ets',
    },
    paths: { features_dir: 'doc/features' },
  }, null, 2));
}

function setup(): UnitCtx {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-nav-cap-'));
  writeFrameworkConfig(projectRoot);
  writeUiSpec(projectRoot);
  writeSpecMd(projectRoot);
  clearFrameworkConfigCache();
  const fw = JSON.parse(fs.readFileSync(path.join(projectRoot, 'framework.config.json'), 'utf-8'));
  const resolvedProfile = loadResolvedProfile(projectRoot, fw);
  const ctx = {
    phase: 'testing',
    feature: FEATURE,
    projectRoot,
    frameworkRoot: FRAMEWORK_ROOT,
    phaseRule: {
      phase: 'testing',
      structure_checks: { visual_diff_capture: { description: 'visual diff capture' } },
      semantic_checks: {},
      traceability_checks: {},
    },
    resolvedProfile,
    fidelityTarget: 'pixel_1to1',
    acceptanceStrictness: 'hard',
  } as unknown as CheckContext;
  const holder = {
    hapPath: path.join(projectRoot, 'fake-unsigned-entry-signed.hap'),
    installPassed: true,
    installExternallyBlocked: false,
    buildReused: false,
    hylyreTracePath: null,
    deviceTestRunExecuted: true,
    installExecuted: false,
    installOk: false,
    hapSha256Full: null,
  };
  writeFile(projectRoot, 'fake-unsigned-entry-signed.hap', 'fake-hap-bytes');
  return { projectRoot, ctx, holder };
}

function teardown(c: UnitCtx): void {
  clearFrameworkConfigCache();
  fs.rmSync(c.projectRoot, { recursive: true, force: true });
}

interface NavFixtures {
  navFile: string;
  navV2: {
    schema_version: '2.0';
    screens: Record<string, {
      steps: unknown[];
      identity?: {
        all_of?: Array<Record<string, string>>;
      };
    }>;
  };
}

const IDENTITY: Record<string, { all_of: Array<{ id?: string; text?: string }> }> = {
  all_banks: { all_of: [{ id: 'maison:bc-test:screen:all_banks' }, { text: '全部银行' }] },
  'bank_card_list_sheet__overlay__0': { all_of: [{ id: 'maison:bc-test:sheet:overlay' }, { text: '银行卡列表' }] },
  HomeTab: { all_of: [{ id: 'maison:bc-test:home' }, { text: '首页' }] },
};

function baseNav(): NavFixtures {
  const navV2 = {
    schema_version: '2.0' as const,
    screens: {
      all_banks: { steps: [], identity: IDENTITY.all_banks },
      // golden 点名的 P1 overlay 屏：fix 前写进 nav 配置必被判「多余/错写屏名」
      'bank_card_list_sheet__overlay__0': {
        steps: [{ touch: { by_id: 'open-sheet-btn' } }],
        identity: IDENTITY['bank_card_list_sheet__overlay__0'],
      },
      HomeTab: { steps: [{ touch: { by_id: 'tab-home' } }], identity: IDENTITY.HomeTab },
    },
  };
  return { navFile: JSON.stringify(navV2, null, 2), navV2 };
}

/** golden contract fixture：正向 P0 all_banks + P1 overlay bank_card_list_sheet + forbidden HomeTab */
function goldenContract(): string {
  return JSON.stringify({
    schema_version: '1.0',
    feature: 'bc-test',
    positive_screens: [
      { declared: 'all_banks', capture: 'all_banks' },
      { declared: 'bank_card_list_sheet', capture: 'bank_card_list_sheet__overlay__0' },
    ],
    forbidden: [
      {
        id: 'HomeTab',
        anchor: 'bank_card_section',
        evidence: 'device-testing/device-screenshots/layout-HomeTab.json',
      },
    ],
  }, null, 2);
}

function writeGolden(root: string, content?: string): string {
  const abs = path.join(root, 'golden-contract.json');
  writeFile(root, 'golden-contract.json', content ?? goldenContract());
  return abs;
}

/** 布局 dump：按屏写确定的 hypium dump（quiescence 双 dump 同构 → 稳定）；
 * id/text 与 nav identity 锚点一一对应 → identity gate matched。 */
const DUMP_ANCHORS: Record<string, { id: string; text: string }> = {
  all_banks: { id: 'maison:bc-test:screen:all_banks', text: '全部银行' },
  'bank_card_list_sheet__overlay__0': { id: 'maison:bc-test:sheet:overlay', text: '银行卡列表' },
  HomeTab: { id: 'maison:bc-test:home', text: '首页' },
};

function dumpForScreen(screenId: string): string {
  const a = DUMP_ANCHORS[screenId] ?? { id: `maison:bc-test:screen:${screenId}`, text: screenId };
  return JSON.stringify({
    schema_version: 'hylyre-hypium-ui-dump-v1',
    tree: {
      attributes: { bounds: '[0,0][1080,2400]', type: 'stack', id: 'screen-root' },
      children: [
        {
          attributes: { bounds: '[0,100][1080,2300]', type: 'root', id: a.id },
          children: [
            { attributes: { bounds: '[20,120][400,220]', type: 'text', id: a.id, text: a.text } },
          ],
        },
      ],
    },
  }, null, 2);
}

function devices(
  events: Array<{ kind: string; screen: string }>,
): DeviceVisualDiffCaptureDevices {
  return {
    bundleName: 'com.example.bctest',
    screenshotFn: args => {
      events.push({ kind: 'shot', screen: args.screenId });
      fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
      // 每屏字节确定 → quiescence 整图判据同构稳定（不依赖 jimp）
      const salt = crypto.createHash('sha256').update(`shot:${args.screenId}`).digest();
      fs.writeFileSync(args.destAbs, Buffer.from(salt));
      return { ok: true };
    },
    layoutDumpFn: args => {
      events.push({ kind: 'dump', screen: args.screenId });
      fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
      fs.writeFileSync(args.destAbs, dumpForScreen(args.screenId), 'utf-8');
      return { ok: true };
    },
    navExecutorFn: args => {
      events.push({ kind: 'nav', screen: args.screenId });
      return { ok: true };
    },
  };
}

function loadVisualDiffJson(root: string): Array<Record<string, unknown>> {
  const p = path.join(root, 'doc', 'features', FEATURE, 'device-testing', 'device-screenshots', 'visual-diff.json');
  if (!fs.existsSync(p)) return [];
  const doc = JSON.parse(fs.readFileSync(p, 'utf-8')) as { screens: Array<Record<string, unknown>> };
  return doc.screens;
}

// ---------------------------------------------------------------------------
// ① golden 点名 P1 屏 → nav 校验通过并进入 capture target
// ---------------------------------------------------------------------------

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void { cases.push({ name, run }); }

test('① golden P1 bank_card_list_sheet：nav 校验通过（不判多余键）且产出 __overlay__0 采集', () => {
  const c = setup();
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  try {
    process.env.MAISON_GOLDEN_CONTRACT = writeGolden(c.projectRoot);
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, baseNav().navFile);
    const events: Array<{ kind: string; screen: string }> = [];
    const results = runDeviceVisualDiffCapture(c.ctx, c.holder, devices(events));
    const gate = results.find(r => r.id === 'visual_diff_capture') as CheckResult;
    assert.ok(gate, `须产出 visual_diff_capture 结果：${JSON.stringify(results.map(r => r.id))}`);
    assert.strictEqual(gate.status, 'PASS', `golden P1 屏合法时应 PASS：${JSON.stringify(results)}`);
    // P1 overlay 屏进入 capture target（pre-fix：P0-only 真源下该键被判「多余/错写屏名」）
    const ids = loadVisualDiffJson(c.projectRoot).map(s => s.screen_id);
    assert.ok(ids.includes('all_banks'), `P0 屏采集：${ids.join(', ')}`);
    assert.ok(ids.includes('bank_card_list_sheet__overlay__0'),
      `golden P1 overlay 须被采集：${ids.join(', ')}`);
    // nav 集合含 golden P1 屏且逐个被导航（nav 步骤生效）
    assert.ok(events.some(e => e.kind === 'nav' && e.screen === 'bank_card_list_sheet__overlay__0'),
      `overlay 屏须被导航：${events.map(e => `${e.kind}:${e.screen}`).join(',')}`);
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
    teardown(c);
  }
});

// ---------------------------------------------------------------------------
// ② golden forbidden target → nav 集合 + 负向证据
// ---------------------------------------------------------------------------

test('② golden forbidden HomeTab：进 nav 到达集合、被导航并产出 run/build 绑定 wrapper 证据', () => {
  const c = setup();
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  try {
    process.env.MAISON_GOLDEN_CONTRACT = writeGolden(c.projectRoot);
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, baseNav().navFile);
    const prevRun = process.env.MAISON_GOAL_RUN_ID;
    process.env.MAISON_GOAL_RUN_ID = 'run-golder-forbidden';
    try {
      const events: Array<{ kind: string; screen: string }> = [];
      const results = runDeviceVisualDiffCapture(c.ctx, c.holder, devices(events));
      const gate = results.find(r => r.id === 'visual_diff_capture') as CheckResult;
      assert.strictEqual(gate?.status, 'PASS', `HomeTab 键合法时须 PASS：${JSON.stringify(results)}`);
      // HomeTab 进入 nav 到达集合并被导航（只采 positive 会漏负向证据目标）
      assert.ok(events.some(e => e.kind === 'nav' && e.screen === 'HomeTab'),
        `HomeTab 须被导航：${events.map(e => `${e.kind}:${e.screen}`).join(',')}`);
      const evidenceAbs = path.join(
        c.projectRoot, 'doc', 'features', FEATURE, 'device-testing', 'device-screenshots', 'layout-HomeTab.json',
      );
      assert.ok(fs.existsSync(evidenceAbs), 'forbidden wrapper 证据须落盘');
      const ev = JSON.parse(fs.readFileSync(evidenceAbs, 'utf-8')) as Record<string, unknown>;
      assert.strictEqual(ev.kind, 'golden_forbidden_evidence');
      assert.strictEqual(ev.screen, 'HomeTab');
      assert.strictEqual(ev.run_id, 'run-golder-forbidden', 'run 绑定须盖戳');
      assert.strictEqual(typeof ev.evaluated_build_fingerprint, 'string', 'build 绑定须盖戳');
    } finally {
      if (prevRun === undefined) delete process.env.MAISON_GOAL_RUN_ID;
      else process.env.MAISON_GOAL_RUN_ID = prevRun;
    }
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
    teardown(c);
  }
});

// ---------------------------------------------------------------------------
// ③ 无 golden env → 严格 P0-only
// ---------------------------------------------------------------------------

test('③a 无 MAISON_GOLDEN_CONTRACT：target 集合 P0-only，P1 屏不进入采集', () => {
  const c = setup();
  try {
    assert.strictEqual(process.env.MAISON_GOLDEN_CONTRACT ?? '', '',
      '本用例须在无 golden env 下运行');
    // nav 只覆盖 P0 屏（golden P1 / forbidden 键都不出现）
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, JSON.stringify({
      schema_version: '2.0',
      screens: {
        all_banks: { steps: [], identity: IDENTITY.all_banks },
      },
    }, null, 2));
    const results = runDeviceVisualDiffCapture(c.ctx, c.holder, devices([]));
    const gate = results.find(r => r.id === 'visual_diff_capture') as CheckResult;
    assert.strictEqual(gate?.status, 'PASS', `P0-only nav 应 PASS：${JSON.stringify(results)}`);
    const ids = loadVisualDiffJson(c.projectRoot).map(s => s.screen_id);
    assert.deepStrictEqual(ids, ['all_banks'],
      `普通模式不得扩面采集 P1（golden P1 overlay 不得出现）：${ids.join(', ')}`);
  } finally {
    teardown(c);
  }
});

test('③b 无 MAISON_GOLDEN_CONTRACT：普通 P1 屏写入 nav 配置仍判「多余/错写屏名」', () => {
  const c = setup();
  try {
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, JSON.stringify({
      schema_version: '2.0',
      screens: {
        all_banks: { steps: [], identity: IDENTITY.all_banks },
        // 宿主 incident 形态：golden 点名的 P1 屏在普通模式下写进 nav → 必须仍 FAIL
        bank_card_detail: { steps: [{ touch: { by_id: 'x' } }] },
      },
    }, null, 2));
    const results = runDeviceVisualDiffCapture(c.ctx, c.holder, devices([]));
    const gate = results.find(r => r.id === 'visual_diff_capture') as CheckResult;
    assert.strictEqual(gate?.status, 'FAIL', `无 golden 时 P1 键须判多余：${JSON.stringify(results)}`);
    assert.ok((gate?.details ?? '').includes('多余/错写屏名'),
      `细节须点名多余键：${gate?.details}`);
  } finally {
    teardown(c);
  }
});

// ---------------------------------------------------------------------------
// ④ golden 目标缺失/形态不符 → fail-closed（不跳过 nav 校验）
// ---------------------------------------------------------------------------

test('④ golden declared 缺失 → nav gate fail-closed 点名（不静默，不跳过 nav 校验）', () => {
  const c = setup();
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  try {
    process.env.MAISON_GOLDEN_CONTRACT = writeGolden(c.projectRoot, JSON.stringify({
      schema_version: '1.0',
      feature: 'bc-test',
      positive_screens: [
        { declared: 'all_banks', capture: 'all_banks' },
        { declared: 'ghost_screen', capture: 'ghost_screen__overlay__0' },
      ],
      forbidden: [],
    }, null, 2));
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, baseNav().navFile);
    const results = runDeviceVisualDiffCapture(c.ctx, c.holder, devices([]));
    const gate = results.find(r => r.id === 'visual_diff_capture') as CheckResult;
    assert.strictEqual(gate?.severity, 'BLOCKER', `缺失须 BLOCKER：${JSON.stringify(results)}`);
    assert.strictEqual(gate?.status, 'FAIL', `缺失须 FAIL：${JSON.stringify(results)}`);
    assert.ok((gate?.details ?? '').includes('golden_contract:ghost_screen'),
      `细节须点名 golden 缺失屏：${gate?.details}`);
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
    teardown(c);
  }
});

test('④b golden 形态漂移（overlay-root 屏却期望同名 capture）→ nav gate fail-closed 点名', () => {
  const c = setup();
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  try {
    process.env.MAISON_GOLDEN_CONTRACT = writeGolden(c.projectRoot, JSON.stringify({
      schema_version: '1.0',
      feature: 'bc-test',
      positive_screens: [
        { declared: 'all_banks', capture: 'all_banks' },
        { declared: 'bank_card_list_sheet', capture: 'bank_card_list_sheet' }, // 形态漂移
      ],
      forbidden: [],
    }, null, 2));
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, baseNav().navFile);
    const results = runDeviceVisualDiffCapture(c.ctx, c.holder, devices([]));
    const gate = results.find(r => r.id === 'visual_diff_capture') as CheckResult;
    assert.strictEqual(gate?.status, 'FAIL', `形态漂移须 FAIL：${JSON.stringify(results)}`);
    assert.ok((gate?.details ?? '').includes('golden_contract:bank_card_list_sheet'),
      `细节须点名形态漂移屏：${gate?.details}`);
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
    teardown(c);
  }
});

// ---------------------------------------------------------------------------
// ⑤ identity 解析消费的 target 集合与 nav/capture 相同
// ---------------------------------------------------------------------------

test('⑤a golden P1 overlay 屏的已确认 identity 被 capture 消费（identity_fingerprint 落条目）', () => {
  const c = setup();
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  try {
    process.env.MAISON_GOLDEN_CONTRACT = writeGolden(c.projectRoot);
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, baseNav().navFile);
    const results = runDeviceVisualDiffCapture(c.ctx, c.holder, devices([]));
    const gate = results.find(r => r.id === 'visual_diff_capture') as CheckResult;
    assert.strictEqual(gate?.status, 'PASS', `identity 集应让 golden P1 屏过身份 gate：${JSON.stringify(results)}`);
    const screens = loadVisualDiffJson(c.projectRoot);
    const overlay = screens.find(s => s.screen_id === 'bank_card_list_sheet__overlay__0');
    assert.ok(overlay, 'overlay 屏条目须在场');
    const expected = identityFingerprintOf(IDENTITY['bank_card_list_sheet__overlay__0'] as Parameters<typeof identityFingerprintOf>[0]);
    assert.strictEqual(overlay!.identity_fingerprint, expected,
      `identity 解析须消费 golden P1 屏（指纹=${overlay!.identity_fingerprint} 期望=${expected}）`);
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
    teardown(c);
  }
});

test('⑤b golden forbidden HomeTab 缺已确认 identity → pixel hard 下 nav 校验拦截（forbidden 在 identity 集内）', () => {
  const c = setup();
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  try {
    process.env.MAISON_GOLDEN_CONTRACT = writeGolden(c.projectRoot);
    // HomeTab 只给步骤、不给 identity——若 identity 解析只消费 P0 集合则不会拦它
    const nav = baseNav().navV2;
    delete (nav.screens.HomeTab as { identity?: unknown }).identity;
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, JSON.stringify(nav));
    const results = runDeviceVisualDiffCapture(c.ctx, c.holder, devices([]));
    const gate = results.find(r => r.id === 'visual_diff_capture') as CheckResult;
    assert.strictEqual(gate?.status, 'FAIL',
      `forbidden 目标须纳入 identity 需求集（缺已确认 identity 即 FAIL）：${JSON.stringify(results)}`);
    assert.ok((gate?.details ?? '').includes('HomeTab'),
      `细节须点名 HomeTab 缺 identity：${gate?.details}`);
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
    teardown(c);
  }
});

// ---------------------------------------------------------------------------
// B07 D3（plan 6e4a2c8b）V4/V5：check-testing 生产接线——同键复用分支 × golden 采集
//   走真实 checkDeviceTestRunGate：第一轮 mock device_test.run 真跑并落执行键记录；第二轮同键
//   复用。只 mock 设备传输面（ready/run dispatch、hdc 设备身份、hylyre 三个构建器）。
// ---------------------------------------------------------------------------

const TRACE_GOLDEN = path.resolve(
  FRAMEWORK_ROOT, 'profiles', 'hmos-app', 'vendor', 'hylyre', 'src', 'hylyre', 'contracts', 'golden', 'trace', 'valid', 'all-passed.json',
);

/** 顶层/派生计划 + derive hint（步骤翻译基线）+ 安装候选：让 run 门禁的静态段全部放行 */
function writeReuseGateFixture(c: UnitCtx): { reportsDir: string; holder: Parameters<typeof __testing_checkDeviceTestRunGate>[1] } {
  const root = c.projectRoot;
  const reportsDir = path.join(root, 'doc', 'features', FEATURE, 'testing', 'reports');
  writeFile(root, 'AppScope/app.json5', '{ "app": { "bundleName": "com.example.bctest", "versionCode": 1, "versionName": "1.0.0" } }');
  writeFile(root, `doc/features/${FEATURE}/testing/test-plan.md`, [
    '## 测试用例', '',
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC | 执行通道 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    '| TC-001 | demo | 冷启动 | 点击钱包页并等待成功标题 | 通过 | P0 | AC-001 | hylyre |',
  ].join('\n'));
  const hintPath = path.join(reportsDir, 'derive-hint-from-plan.json');
  writeFile(root, path.relative(root, hintPath), JSON.stringify({
    test_cases: [{
      tc_id: 'TC-001', name: 'demo', precondition: '冷启动', steps_natural_language: '点击钱包页并等待成功标题',
      expected: '通过', priority: 'P0', ac_ref: 'AC-001', execution_channel: 'hylyre',
    }],
  }));
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(hintPath, past, past);
  writeFile(root, `doc/features/${FEATURE}/testing/reports/20260101T000000Z/hylyre/test-plan.hylyre.md`, [
    '## 测试用例清单', '',
    '| 用例编号 | 用例名称 | 前置条件 | 测试步骤 | 预期结果 | 优先级 | 关联 AC |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| TC-001 | demo | 冷启动 | {"touch":{"by_id":"tab_wallet"}}; {"wait_for":{"by_id":"success_title"}} | 通过 | P0 | AC-001 |',
  ].join('\n'));
  const holder = {
    ...c.holder,
    installExecuted: true,
    installOk: true,
    hapSha256Full: computeHapSha256Full(c.holder.hapPath!),
  };
  return { reportsDir, holder };
}

interface GateMocks {
  events: Array<{ kind: string; screen: string }>;
  navOpts: Array<Record<string, unknown>>;
  runCalls: number;
}

/** 只替换设备传输面；其余（执行键、复用判定、冻结件回填、采集入口）全走生产代码 */
function withGateMocks<T>(reportsDir: string, fn: (m: GateMocks) => T): T {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const registry = require('../../capability-registry') as Record<string, unknown>;
  const hylyreShot = require('../../../profiles/hmos-app/harness/visual-diff-hylyre-screenshot') as Record<string, unknown>;
  const hdcRunner = require('../../../profiles/hmos-app/harness/hdc-runner') as Record<string, unknown>;
  /* eslint-enable @typescript-eslint/no-require-imports */
  const saved = {
    ensureReady: registry.dispatchDeviceTestEnsureReady,
    run: registry.dispatchDeviceTestRun,
    identity: hdcRunner.resolveExecutionDeviceIdentity,
    shot: hylyreShot.buildHylyreVisualDiffScreenshotFn,
    dump: hylyreShot.buildHylyreLayoutDumpFn,
    nav: hylyreShot.buildHylyreNavExecutorFn,
  };
  const m: GateMocks = { events: [], navOpts: [], runCalls: 0 };
  const devs = devices(m.events);
  registry.dispatchDeviceTestEnsureReady = () => ({
    ok: true, pythonPath: 'python', hylyreVersion: '0.5.0', manifestVersion: '0.5.0',
    versionConsistent: true, source: 'env_override', doctorOk: true, errors: [],
  });
  registry.dispatchDeviceTestRun = (_ctx: unknown, opts: { traceOutPath: string; reportOutPath: string }) => {
    m.runCalls++;
    const trace = JSON.parse(fs.readFileSync(TRACE_GOLDEN, 'utf-8')) as Record<string, any>;
    trace.feature = FEATURE;
    trace.cases[0].id = 'TC-001';
    trace.cases[0].name = 'demo';
    trace.cases[0].ac_ref = 'AC-001';
    for (const call of trace.tool_calls as Array<Record<string, unknown>>) call.case = 'TC-001';
    fs.mkdirSync(path.dirname(opts.traceOutPath), { recursive: true });
    fs.writeFileSync(opts.traceOutPath, JSON.stringify(trace));
    fs.writeFileSync(opts.reportOutPath, '# Hylyre report\n');
    const logPath = path.join(path.dirname(opts.traceOutPath), 'device-test-run.log');
    fs.writeFileSync(logPath, 'mock run log\n');
    const t0 = Date.now() - 5000;
    // 宿主现场：主测试以 omit_bundle + page_name 启动，nav 须与之对齐
    fs.writeFileSync(path.join(reportsDir, 'device-test-run.meta.json'), JSON.stringify({
      ok: true, exit_code: 0, trace_path: opts.traceOutPath, report_path: opts.reportOutPath, log_path: logPath,
      run_started_at: new Date(t0).toISOString(), run_ended_at: new Date(t0 + 500).toISOString(),
      ran_at: new Date(t0 + 500).toISOString(), run_duration_ms: 500,
      omit_bundle_for_hylyre: true, hypium_page_name: 'PhoneAbility', aa_start_ok: true,
    }));
    return {
      executed: true, exitCode: 0, ok: true, command: 'mock hylyre run',
      reportPath: opts.reportOutPath, tracePath: opts.traceOutPath, trace: parseHylyreTrace(opts.traceOutPath),
      logPath, errors: [],
    };
  };
  hdcRunner.resolveExecutionDeviceIdentity = () => ({ device: 'dev-A', display_env: '1080x2400' });
  hylyreShot.buildHylyreVisualDiffScreenshotFn = () => devs.screenshotFn;
  hylyreShot.buildHylyreLayoutDumpFn = () => devs.layoutDumpFn;
  hylyreShot.buildHylyreNavExecutorFn = (opts: Record<string, unknown>) => { m.navOpts.push(opts); return devs.navExecutorFn; };
  try {
    return fn(m);
  } finally {
    registry.dispatchDeviceTestEnsureReady = saved.ensureReady;
    registry.dispatchDeviceTestRun = saved.run;
    hdcRunner.resolveExecutionDeviceIdentity = saved.identity;
    hylyreShot.buildHylyreVisualDiffScreenshotFn = saved.shot;
    hylyreShot.buildHylyreLayoutDumpFn = saved.dump;
    hylyreShot.buildHylyreNavExecutorFn = saved.nav;
  }
}

const REUSE_PASS_LINE =
  '同键复用：设备截图沿用被复用 run 的产物（visual-diff.json / device-screenshots），参考图或 ui-spec 变化时按现有截图重新比较，不重跑交互。';

/** 两轮门禁：第一轮 mock 真跑（spec.md 暂缺 → 不采集），第二轮同键复用（spec.md 就位） */
function runGateTwice(c: UnitCtx, m: GateMocks, holder: Parameters<typeof __testing_checkDeviceTestRunGate>[1]): {
  first: CheckResult[]; second: CheckResult[];
} {
  const specMd = path.join(c.projectRoot, 'doc', 'features', FEATURE, 'spec', 'spec.md');
  const specBody = fs.readFileSync(specMd, 'utf-8');
  fs.rmSync(specMd);
  const first = __testing_checkDeviceTestRunGate(c.ctx, { ...holder });
  const firstRun = first.find(r => r.id === 'device_test_run') as CheckResult & { structured?: Record<string, unknown> };
  assert.ok(firstRun, `第一轮须产出 device_test_run：${JSON.stringify(first.map(r => [r.id, r.status]))}`);
  assert.strictEqual(firstRun.status, 'PASS', `第一轮真跑须 PASS：${firstRun.details}`);
  assert.strictEqual(firstRun.structured?.reused_by_execution_key, false, '第一轮不是复用');
  assert.strictEqual(m.runCalls, 1, '第一轮真跑一次');
  assert.deepStrictEqual(m.events, [], '第一轮无 spec.md：不采集');
  fs.writeFileSync(specMd, specBody, 'utf-8');
  const second = __testing_checkDeviceTestRunGate(c.ctx, { ...holder });
  const secondRun = second.find(r => r.id === 'device_test_run') as CheckResult & { structured?: Record<string, unknown> };
  assert.ok(secondRun, `第二轮须产出 device_test_run：${JSON.stringify(second.map(r => [r.id, r.status]))}`);
  assert.strictEqual(secondRun.structured?.reused_by_execution_key, true, `第二轮须同键复用：${secondRun.details}`);
  assert.strictEqual(m.runCalls, 1, 'device_test 未重跑（复用只补采集）');
  return { first, second };
}

test('B07-V4 golden 生效时复用不绕过：不推"同键复用 PASS"、走采集入口、nav omitBundle=true、details 带 golden_contract', () => {
  const c = setup();
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  try {
    const goldenAbs = writeGolden(c.projectRoot);
    process.env.MAISON_GOLDEN_CONTRACT = goldenAbs;
    const sha16 = crypto.createHash('sha256').update(fs.readFileSync(goldenAbs)).digest('hex').slice(0, 16);
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, baseNav().navFile);
    const { reportsDir, holder } = writeReuseGateFixture(c);
    withGateMocks(reportsDir, m => {
      const { second } = runGateTwice(c, m, holder);
      const captures = second.filter(r => r.id === 'visual_diff_capture');
      assert.strictEqual(captures.length, 1, `恰一条 visual_diff_capture：${JSON.stringify(captures)}`);
      const cap = captures[0];
      assert.ok(!(cap.details ?? '').includes(REUSE_PASS_LINE), `golden 生效不得直接记复用 PASS：${cap.details}`);
      assert.strictEqual(cap.status, 'PASS', `采集入口须 PASS：${cap.details}`);
      assert.ok((cap.details ?? '').includes(`golden_contract=${sha16}`), `details 须披露 golden 身份：${cap.details}`);
      // 采集入口真的跑了：golden target 集合（P0 ∪ golden P1 ∪ forbidden）被导航/截图
      for (const screen of ['all_banks', 'bank_card_list_sheet__overlay__0', 'HomeTab']) {
        assert.ok(m.events.some(e => e.kind === 'nav' && e.screen === screen),
          `${screen} 须被导航：${m.events.map(e => `${e.kind}:${e.screen}`).join(',')}`);
      }
      assert.ok(m.events.some(e => e.kind === 'shot' && e.screen === 'all_banks'), 'P0 屏须截图');
      // nav 参数读顶层已回填的 device-test-run.meta.json（不是 reusable.runDir、不是 ''）
      assert.strictEqual(m.navOpts.length, 1, `nav 构建器恰调一次：${JSON.stringify(m.navOpts)}`);
      assert.strictEqual(m.navOpts[0].omitBundle, true, `nav 须与主测试启动方式对齐（omitBundle=true）：${JSON.stringify(m.navOpts[0])}`);
      assert.strictEqual(m.navOpts[0].hypiumPageName, 'PhoneAbility');
      assert.strictEqual(path.dirname(String(m.navOpts[0].logPath)), reportsDir, 'logPath 落在顶层 reportsDir');
      // 采集产物：golden P1 overlay 进入 visual-diff.json（同 ① 用例的生产语义）
      const ids = loadVisualDiffJson(c.projectRoot).map(s => s.screen_id);
      assert.ok(ids.includes('bank_card_list_sheet__overlay__0'), `golden P1 须被采集：${ids.join(', ')}`);
    });
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
    teardown(c);
  }
});

test('B07-V5 无 golden 时复用不变：逐字相同的 PASS 行 + golden_contract=none，传输面零事件', () => {
  const c = setup();
  const prev = process.env.MAISON_GOLDEN_CONTRACT;
  try {
    delete process.env.MAISON_GOLDEN_CONTRACT;
    writeFile(c.projectRoot, `doc/features/${FEATURE}/device-testing/visual-diff-nav.json`, baseNav().navFile);
    const { reportsDir, holder } = writeReuseGateFixture(c);
    withGateMocks(reportsDir, m => {
      const { second } = runGateTwice(c, m, holder);
      const captures = second.filter(r => r.id === 'visual_diff_capture');
      assert.strictEqual(captures.length, 1, `恰一条 visual_diff_capture：${JSON.stringify(captures)}`);
      assert.strictEqual(captures[0].status, 'PASS');
      assert.strictEqual(captures[0].severity, 'MINOR');
      assert.strictEqual(captures[0].details, `${REUSE_PASS_LINE}\ngolden_contract=none`, '复用 PASS 行逐字不变 + 身份披露');
      assert.deepStrictEqual(m.events, [], '无 golden：复用不触碰设备');
      assert.deepStrictEqual(m.navOpts, [], '无 golden：不装配 nav');
      assert.deepStrictEqual(loadVisualDiffJson(c.projectRoot), [], '无 golden：不产生新的采集产物');
    });
  } finally {
    if (prev === undefined) delete process.env.MAISON_GOLDEN_CONTRACT;
    else process.env.MAISON_GOLDEN_CONTRACT = prev;
    teardown(c);
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