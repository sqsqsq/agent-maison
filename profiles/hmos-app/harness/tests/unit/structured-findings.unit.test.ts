/**
 * structured-findings 单测（t0/t2/t6b，plan f7a3d9c2）：
 * - finding_id 稳定性（emit 定稿、elements 顺序无关、bbox 桶内抖动不变 id）
 * - T8 findings 结构化字段（elements/B 类 bbox）
 * - 转录对账纯函数（normRectIoU / signalExpectedClasses / actionable 谓词）
 * - 守恒断言（t6b）：非 pixel_1to1 的 actionable=false → fuse decision 恒 false
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { captureVisualDiff, CAPTURE_NOT_RUN_ELIGIBILITY } from '../../visual-diff-capture';
import { evaluateVisualRound } from '../../../../../harness/scripts/utils/visual-rounds-ledger';
import type { UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import {
  computeLayoutFindingId,
  collectLayoutOracleForScreen,
  layoutBBoxBucket,
  parseHypiumDump,
} from '../../layout-oracle-check';
import {
  hasActionableVisualResidual,
  normRectIoU,
  normRectsOverlap,
  signalExpectedClasses,
  defaultClassForSignal,
  computeScreensHash,
  LOOP_ACTIONABLE_HIT_IDS,
  type VisualDiffScreenEntry,
} from '../../visual-diff-check';
import type { UiSpecScreen } from '../../../../../harness/scripts/utils/ui-spec-shared';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

test('finding_id_stable_order_free_and_bucketed', () => {
  const id1 = computeLayoutFindingId('home', 'A1_forbidden_overlap', ['a', 'b'], [0.11, 0.2, 0.3, 0.4]);
  const id2 = computeLayoutFindingId('home', 'A1_forbidden_overlap', ['b', 'a'], [0.11, 0.2, 0.3, 0.4]);
  assert.strictEqual(id1, id2, 'elements 顺序无关');
  // bbox 0.1 网格桶内抖动（0.11→0.13 同桶 0.1）不变 id；跨桶（0.11→0.16→0.2）变 id
  const jitter = computeLayoutFindingId('home', 'A1_forbidden_overlap', ['a', 'b'], [0.13, 0.2, 0.3, 0.4]);
  assert.strictEqual(id1, jitter, '桶内像素抖动不变 id（跨轮对账稳定）');
  const crossBucket = computeLayoutFindingId('home', 'A1_forbidden_overlap', ['a', 'b'], [0.16, 0.2, 0.3, 0.4]);
  assert.notStrictEqual(id1, crossBucket, '跨桶变 id');
  assert.notStrictEqual(
    id1,
    computeLayoutFindingId('mine', 'A1_forbidden_overlap', ['a', 'b'], [0.11, 0.2, 0.3, 0.4]),
    'screen 参与身份',
  );
  assert.strictEqual(layoutBBoxBucket(undefined), 'nobbox');
});

function overlapDump(): ReturnType<typeof parseHypiumDump> {
  return parseHypiumDump({
    schema_version: 'hylyre-hypium-ui-dump-v1',
    tree: {
      attributes: { bounds: '[0,0][1000,2000]', type: 'Screen', text: '', id: '', key: '', clickable: 'false' },
      children: [
        {
          attributes: { bounds: '[0,100][1000,2000]', type: 'root', text: '', id: '', key: '', clickable: 'false' },
          children: [
            { attributes: { bounds: '[100,200][400,400]', type: 'Button', text: '关闭', id: 'close', key: '', clickable: 'true' }, children: [] },
            { attributes: { bounds: '[300,300][700,600]', type: 'Image', text: '', id: 'bank_surface', key: '', clickable: 'true' }, children: [] },
          ],
        },
      ],
    },
  });
}

test('t8_findings_carry_finding_id_and_elements', () => {
  const dump = overlapDump();
  assert.ok(dump);
  const screen = {
    id: 'card',
    priority: 'P0',
    forbidden_overlap: [['close', 'bank_surface']],
    root: { type: 'stack', children: [
      { id: 'close', type: 'button', text: '关闭' },
      { id: 'bank_surface', type: 'image' },
    ] },
  } as unknown as UiSpecScreen;
  const res = collectLayoutOracleForScreen({ screenId: 'card', screen, dump: dump! });
  const hard = res.findings.find(f => f.signal === 'A1_forbidden_overlap');
  assert.ok(hard, `应有 A1 hard 命中：${JSON.stringify(res.findings.map(f => f.signal))}`);
  assert.ok(/^[0-9a-f]{16}$/.test(hard!.finding_id), 'finding_id emit 时定稿（16 hex）');
  assert.deepStrictEqual([...hard!.elements].sort(), ['bank_surface', 'close'], 'elements 结构化携带');
  assert.ok(hard!.bbox && hard!.bbox.length === 4, 'hard 携 bbox');
  // 两次收集同 dump → 同 id（跨轮稳定）
  const res2 = collectLayoutOracleForScreen({ screenId: 'card', screen, dump: dump! });
  const hard2 = res2.findings.find(f => f.signal === 'A1_forbidden_overlap');
  assert.strictEqual(hard!.finding_id, hard2!.finding_id);
});

test('iou_and_signal_class_mapping', () => {
  assert.ok(normRectIoU([0, 0, 1, 1], [0, 0, 1, 1]) > 0.999);
  assert.ok(normRectIoU([0, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]) === 0, '不相交 IoU=0');
  // 大框吞小框：相交但 IoU 低 → 不足 0.5（防"一个大 bbox 误消一切账"）
  assert.ok(normRectIoU([0, 0, 1, 1], [0.1, 0.1, 0.2, 0.2]) < 0.5);
  assert.ok(normRectsOverlap([0, 0, 0.5, 0.5], [0.4, 0.4, 0.2, 0.2]));
  assert.ok(signalExpectedClasses('A1_forbidden_overlap').has('overlap'));
  assert.ok(signalExpectedClasses('A2_out_of_screen').has('clipping'));
  assert.ok(signalExpectedClasses('B1_layout_group_divergent').has('shape_mismatch'));
  assert.strictEqual(defaultClassForSignal('A2_out_of_screen'), 'clipping');
  assert.strictEqual(defaultClassForSignal('B3_order_inverted'), 'shape_mismatch');
});

test('actionable_residual_predicate_structured_not_prefix', () => {
  const cleanScreens: VisualDiffScreenEntry[] = [
    { screen_id: 'home', verdict: 'pass', defects: [{ class: 'other', severity: 'minor', note: 'x' }] } as VisualDiffScreenEntry,
  ];
  // candidate-pass+minor defects+只差人签：human_confirm FAIL 不算 actionable（rev5 阻断②）
  assert.strictEqual(
    hasActionableVisualResidual(cleanScreens, [{ id: 'visual_diff_human_confirm_required', status: 'FAIL' }]),
    false,
    'T2 求人路径不被 fuse 抢走',
  );
  // capability degradation / unstable / receipt 均排除
  for (const id of [
    'visual_diff_layout_invariants_unstable',
    'visual_diff_layout_dump_missing',
    'visual_diff_critic_receipt',
    // review-fix（cursor I-2）：纯举证缺口=evidence repair，不入 UI defect fuse
    'visual_diff_region_attest',
    'visual_diff_attest_evidence',
    'visual_diff_text_placement_degraded',
    'visual_diff_edge_sentinel',
  ]) {
    assert.strictEqual(
      hasActionableVisualResidual(cleanScreens, [{ id, status: 'FAIL' }]),
      false,
      `${id} 不入 actionable（非前缀猜测）`,
    );
    assert.ok(!LOOP_ACTIONABLE_HIT_IDS.has(id));
  }
  // 真残差：fail 屏 / must_fix / T8 hard FAIL / T8-M1 blocking WARN
  assert.ok(hasActionableVisualResidual([{ screen_id: 'x', verdict: 'fail', must_fix: ['修'] } as VisualDiffScreenEntry], []));
  assert.ok(hasActionableVisualResidual(cleanScreens, [{ id: 'visual_diff_layout_invariants', status: 'FAIL' }]));
  assert.ok(hasActionableVisualResidual(cleanScreens, [{ id: 'visual_diff_layout_invariants', status: 'WARN' }]), '未解决 T8 WARN 属 loop-actionable');
  assert.ok(hasActionableVisualResidual(cleanScreens, [{ id: 'visual_diff_selfreport_integrity', status: 'WARN' }]));
});

// ============================================================================
// t4（plan f3a8c6d2）：熔断资格矩阵——**经真实生产者 captureVisualDiff**。
// 前四版之所以每轮都被 review 找出反例，正是因为测试打在纯函数/源码正则上，绕过了
// "锁屏 dump 最终会被生产者归成什么"这条真链路。此处一律用真实 layoutDumpFn/
// screenshotFn 夹具驱动 capture，断言它产出的**唯一裁决对象**。
// ============================================================================
const UI_DOC_ONE_P0 = {
  screens: [{ id: 'add_bank', priority: 'P0', ref_id: 'ref_a', root: { type: 'navigation_frame', order: 0 } }],
  tokens: {},
  assets: [],
} as unknown as UiSpecDoc;

/** 目标页身份：id 锚（宿主真实形态）+ none_of 兜底（纯文本锚工程） */
const IDENTITY_ADD_BANK = new Map([[
  'add_bank',
  {
    all_of: [{ id: 'maison:demo:add_bank:add_bank_frame' }],
    none_of: [{ text: '管理非本机卡片' }],
  },
]]);

/** 双屏夹具（t4 混合轮 / 全 mismatched 轮） */
const UI_DOC_TWO_P0 = {
  screens: [
    { id: 'add_bank', priority: 'P0', ref_id: 'ref_a', root: { type: 'navigation_frame', order: 0 } },
    { id: 'all_banks', priority: 'P0', ref_id: 'ref_b', root: { type: 'navigation_frame', order: 0 } },
  ],
  tokens: {},
  assets: [],
} as unknown as UiSpecDoc;

const IDENTITY_TWO_P0 = new Map([
  ['add_bank', { all_of: [{ id: 'maison:demo:add_bank:add_bank_frame' }] }],
  ['all_banks', { all_of: [{ id: 'maison:demo:all_banks:all_banks_frame' }] }],
]);

function runCaptureWithDump(
  root: string,
  dump: unknown | null,
  opts?: {
    dumpOk?: boolean;
    badJson?: boolean;
    noLayoutDumpFn?: boolean;
    /** 逐屏 dump（screenId → dump 树）；缺省回落 opts 单一 dump 或 dump == null */
    dumpByScreen?: Record<string, unknown>;
  },
): ReturnType<typeof captureVisualDiff> {
  return captureVisualDiff({
    projectRoot: root,
    feature: 'demo',
    uiDoc: opts?.dumpByScreen ? UI_DOC_TWO_P0 : UI_DOC_ONE_P0,
    currentBuildFingerprint: null,
    screenshotFn: args => {
      fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
      fs.writeFileSync(args.destAbs, Buffer.from('png'));
      return { ok: true };
    },
    layoutDumpFn: opts?.noLayoutDumpFn
      ? undefined
      : args => {
          if (opts?.dumpOk === false) return { ok: false, error: 'dump-ui 执行失败（设备无响应）' };
          fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
          const tree = opts?.dumpByScreen?.[args.screenId] ?? dump;
          fs.writeFileSync(args.destAbs, opts?.badJson ? '{not json' : JSON.stringify(tree), 'utf-8');
          return { ok: true };
        },
    screenIdentity: opts?.dumpByScreen ? IDENTITY_TWO_P0 : IDENTITY_ADD_BANK,
  });
}

test('t4_matrix_dump_failure_is_not_content_evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-dumpfail-'));
  try {
    const r = runCaptureWithDump(root, null, { dumpOk: false });
    assert.strictEqual(r.fuseEligibility?.eligible, false, 'dump 执行失败的轮次不得有熔断资格');
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, []);
    // 该屏归 probe_failed（非 mismatched），故诊断文案不得声称"疑似身份失配"
    assert.ok(
      !/疑似身份失配/.test(r.fuseEligibility?.reason ?? ''),
      `dump 失败不得被描述成身份失配：${r.fuseEligibility?.reason}`,
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_unparsable_dump_is_not_content_evidence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-badjson-'));
  try {
    const r = runCaptureWithDump(root, null, { badJson: true });
    assert.strictEqual(r.fuseEligibility?.eligible, false, 'dump 不可解析的轮次不得有熔断资格');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_lockscreen_dump_is_not_mismatch', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-lock-'));
  try {
    // 真实锁屏 dump 形态：dump 成功、身份不命中，但树里没有被测应用的任何组件。
    // 这正是前几版把环境故障误判成"内容正证据"的入口。
    const lockScreen = {
      schema_version: 'hylyre-hypium-ui-dump-v1',
      tree: {
        attributes: { bounds: '[0,0][1260,2720]' },
        children: [
          { attributes: { text: '上滑解锁', bounds: '[0,2400][1260,2500]' } },
          { attributes: { text: '无 SIM 卡 | 仅限紧急呼叫', bounds: '[0,2500][1260,2600]' } },
        ],
      },
    };
    const r = runCaptureWithDump(root, lockScreen);
    assert.ok((r.p0CaptureFailures ?? []).includes('add_bank'), '仍应记 P0 采集失败');
    assert.strictEqual(
      r.fuseEligibility?.eligible,
      false,
      '锁屏页身份不命中 ≠ 应用错页——不得作为内容正证据（前几版在此误判）',
    );
    // 诊断一致性：身份不通过按 spec 记 screen_identity_mismatch；锁屏 dump 无页面
    // 组件前缀 ⇒ probe_failed（不得断言"是错页"，锁屏/桌面/系统态同此分支）。
    const detail = r.errors.find(e => e.includes('add_bank')) ?? '';
    assert.ok(/screen_identity_mismatch/.test(detail), `记法须遵循 spec：${detail}`);
    assert.ok(/无页面组件前缀/.test(detail), `须标注无页面组件前缀（probe_failed 依据）：${detail}`);
    assert.ok(!/非错页/.test(detail), `不得断言"确非错页"（同样越过证据）：${detail}`);
    assert.ok(!/无页面组件前缀.*(mismatched|错页)/.test(detail), `无前缀不得并入错页语气：${detail}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_wrong_page_missing_screen_is_actionable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-wrongpage-'));
  try {
    // 预置**已有错误旧条目**（复放 0.997 错页高分）——确定性 mismatch 后必须瞬时失效，
    // 旧 score/verdict 不得继续被消费。
    const shotsDir = path.join(root, 'doc', 'features', 'demo', 'device-testing', 'device-screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, 'visual-diff.json'), JSON.stringify({
      schema_version: '1.1',
      screens: [{
        screen_id: 'add_bank', verdict: 'pending', score_floor: 0.997, screenshot_hash: 'h-wrongpage',
      }],
    }, null, 2));
    // 应用内错页形态：dump 成功、目标身份不命中、但树里有本应用**页面组件** id 前缀
    //（宿主校准：锁屏/桌面 dump 的页面组件前缀命中为 0，前缀在场 ⇒ 应用页面树在场）。
    // t3 收口后此形态=确定性 mismatched ⇒ 内容可行动缺屏，进 missing_screen 指纹。
    const wrongPage = {
      schema_version: 'hylyre-hypium-ui-dump-v1',
      tree: {
        attributes: { bounds: '[0,0][1260,2720]' },
        children: [
          { attributes: { id: 'maison:demo:all_banks:all_banks_frame', text: '全部银行', bounds: '[0,0][1260,2720]' } },
        ],
      },
    };
    const r = runCaptureWithDump(root, wrongPage);
    assert.ok((r.p0CaptureFailures ?? []).includes('add_bank'), '错页仍记 P0 采集失败（缺可用截图）');
    assert.strictEqual(r.fuseEligibility?.eligible, true, '确定错页缺屏须具备熔断资格');
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, ['add_bank'], '缺屏 id 进 actionable');
    // 旧裁决须瞬时失效（0.997 错页高分不得跨轮存活）
    const after = JSON.parse(fs.readFileSync(path.join(shotsDir, 'visual-diff.json'), 'utf-8')) as {
      screens: Array<{ screen_id: string }>;
    };
    assert.ok(!after.screens.some(s => s.screen_id === 'add_bank'), 'mismatch 缺屏不得残留旧裁决');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_lock_desktop_dump_is_probe_failed_and_preserves_verdict', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-stale-'));
  try {
    // 宿主实测锁屏/桌面 dump 形态（2026-08-13 校准）：**无页面组件前缀**，即使出现
    // 宿主 bundle（桌面应用图标 id）也不是页面组件前缀——一律 probe_failed。
    // 绝不会被误判成 mismatched，也绝不会删除旧裁决（review 曾把环境故障算成内容问题）。
    const lockScreen = {
      schema_version: 'hylyre-hypium-ui-dump-v1',
      tree: {
        attributes: { bounds: '[0,0][1260,2720]' },
        children: [
          { attributes: { text: '上滑解锁', bounds: '[0,2400][1260,2500]' } },
          // 桌面 dump 的真实成分：宿主 bundle 应用图标（非页面组件前缀）
          { attributes: { id: 'AppIconCommonView_com.example.simulatedwallet.PhoneAbility', bounds: '[0,2500][1260,2600]' } },
        ],
      },
    };
    // 预置一条**已有真人裁决**的旧条目——probe_failed 不得删除它（t1 要消灭误删重签）
    const shotsDir = path.join(root, 'doc', 'features', 'demo', 'device-testing', 'device-screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, 'visual-diff.json'), JSON.stringify({
      schema_version: '1.1',
      screens: [{
        screen_id: 'add_bank',
        verdict: 'pass',
        screenshot_hash: 'h-old',
        confirmed_by: 'human@example.com',
      }],
    }, null, 2));

    const r = runCaptureWithDump(root, lockScreen);
    assert.strictEqual(
      r.fuseEligibility?.eligible,
      false,
      '锁屏/桌面（无页面组件前缀）不得被判成内容问题（bundle 图标命中不是页面组件前缀）',
    );
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, []);
    // probe_failed：不删旧裁决——误删会清掉已有的真人签字
    const after = JSON.parse(fs.readFileSync(path.join(shotsDir, 'visual-diff.json'), 'utf-8')) as {
      screens: Array<{ screen_id: string; confirmed_by?: string }>;
    };
    const kept = after.screens.find(s => s.screen_id === 'add_bank');
    assert.ok(kept, `probe_failed 不得删除旧条目，实得 screens=${JSON.stringify(after.screens)}`);
    assert.strictEqual(kept?.confirmed_by, 'human@example.com', '真人裁决必须原样保留');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t3_non_maison_colon_ids_are_not_page_prefix_probe_failed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t3-nonmaison-'));
  try {
    // review P1：页面组件前缀只认规范 `maison:`。identity 锚为任意三段式冒号 id
    //（`foo:bar:*`）时不得推导为页面组件前缀——dump 中即使出现同族 `foo:bar:*` id
    //（目标锚缺失）也不得判 mismatched / 删旧裁决 / 进熔断，必须 probe_failed。
    const identity = new Map([[
      'add_bank',
      { all_of: [{ id: 'foo:bar:add_bank_frame' }] },
    ]]);
    const shotsDir = path.join(root, 'doc', 'features', 'demo', 'device-testing', 'device-screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, 'visual-diff.json'), JSON.stringify({
      schema_version: '1.1',
      screens: [{
        screen_id: 'add_bank', verdict: 'pass', screenshot_hash: 'h-old',
        confirmed_by: 'human@example.com',
      }],
    }, null, 2));

    const r = captureVisualDiff({
      projectRoot: root,
      feature: 'demo',
      uiDoc: UI_DOC_ONE_P0,
      currentBuildFingerprint: null,
      screenshotFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, Buffer.from('png'));
        return { ok: true };
      },
      layoutDumpFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        // 同族 foo:bar:* id（非目标锚）——过宽实现会把它当页面前缀而误判 mismatched
        fs.writeFileSync(args.destAbs, JSON.stringify({
          schema_version: 'hylyre-hypium-ui-dump-v1',
          tree: {
            attributes: { bounds: '[0,0][1260,2720]' },
            children: [{ attributes: { id: 'foo:bar:all_banks_frame', bounds: '[0,0][1260,2720]' } }],
          },
        }), 'utf-8');
        return { ok: true };
      },
      screenIdentity: identity,
    });
    assert.ok((r.p0CaptureFailures ?? []).includes('add_bank'), '仍记 P0 采集失败');
    assert.strictEqual(
      r.fuseEligibility?.eligible,
      false,
      '非 Maison 冒号 ID 不构成页面组件前缀——不得进熔断（probe_failed）',
    );
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, []);
    // probe_failed：不得删除旧裁决 / confirmed_by
    const after = JSON.parse(fs.readFileSync(path.join(shotsDir, 'visual-diff.json'), 'utf-8')) as {
      screens: Array<{ screen_id: string; confirmed_by?: string }>;
    };
    const kept = after.screens.find(s => s.screen_id === 'add_bank');
    assert.ok(kept, '非 Maison 前缀不得删除旧条目');
    assert.strictEqual(kept?.confirmed_by, 'human@example.com', '真人裁决保留');
    assert.ok(
      r.errors.some(e => e.includes('add_bank') && /无页面组件前缀/.test(e)),
      `诊断须标注无页面组件前缀：${r.errors.join('|')}`,
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_capture_not_run_verdict_is_ineligible', () => {
  assert.strictEqual(CAPTURE_NOT_RUN_ELIGIBILITY.eligible, false);
  assert.deepStrictEqual(CAPTURE_NOT_RUN_ELIGIBILITY.actionableMissingIds, []);
  assert.ok(/capture_not_run/.test(CAPTURE_NOT_RUN_ELIGIBILITY.reason));
});

test('t3_gate_confirmed_identity_without_dump_ability_is_probe_failed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t3-nodump-'));
  try {
    // 事故根因（t3 裁定 4）：confirmed identity 但无 layoutDumpFn 时，旧实现直接
    // matched——未经身份验证的截图仍可进正式目录（历史 0.997 条目即
    // layout_dump_status=unavailable 时代的产物）。必须 probe_failed：不落正式截图、
    // 不得视为内容问题、不删旧裁决。
    const shotsDir = path.join(root, 'doc', 'features', 'demo', 'device-testing', 'device-screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, 'visual-diff.json'), JSON.stringify({
      schema_version: '1.1',
      screens: [{
        screen_id: 'add_bank', verdict: 'pass', screenshot_hash: 'h-old',
        confirmed_by: 'human@example.com',
      }],
    }, null, 2));

    const r = captureVisualDiff({
      projectRoot: root,
      feature: 'demo',
      uiDoc: UI_DOC_ONE_P0,
      currentBuildFingerprint: null,
      screenshotFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, Buffer.from('png'));
        return { ok: true };
      },
      // 无 layoutDumpFn——身份验真能力缺失
      screenIdentity: IDENTITY_ADD_BANK,
    });
    assert.ok((r.p0CaptureFailures ?? []).includes('add_bank'), '缺 dump 能力的轮次须记 P0 采集失败');
    assert.strictEqual(r.fuseEligibility?.eligible, false, '身份无法验真不得有熔断资格');
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, []);
    assert.ok(!fs.existsSync(path.join(shotsDir, 'shot-add_bank.png')), '正式截图目录零写入');
    // probe_failed：旧条目与 confirmed_by 原样保留
    const after = JSON.parse(fs.readFileSync(path.join(shotsDir, 'visual-diff.json'), 'utf-8')) as {
      screens: Array<{ screen_id: string; confirmed_by?: string }>;
    };
    const kept = after.screens.find(s => s.screen_id === 'add_bank');
    assert.ok(kept, 'probe_failed 不得删除旧条目');
    assert.strictEqual(kept?.confirmed_by, 'human@example.com', 'confirmed_by 真人裁决必须保留');
    // 诊断必须点名身份确认却无法验真
    assert.ok(
      r.errors.some(e => e.includes('add_bank') && /无法验真|无 layoutDumpFn|dump 能力缺失/.test(e)),
      `诊断须点明无法验真：${r.errors.join('|')}`,
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_mixed_round_mismatch_plus_probe_failed_is_ineligible', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-mixed-'));
  try {
    // 混合轮：一屏确证错页（mismatched，有页面前缀）、一屏证据不足（probe_failed，
    // 锁屏形态无前缀）——整轮 fail-safe ineligible，缺屏一律不进 actionable。
    const r = runCaptureWithDump(root, null, {
      dumpByScreen: {
        add_bank: {
          schema_version: 'hylyre-hypium-ui-dump-v1',
          tree: {
            attributes: { bounds: '[0,0][1260,2720]' },
            children: [
              { attributes: { id: 'maison:demo:all_banks:all_banks_frame', bounds: '[0,0][1260,2720]' } },
            ],
          },
        },
        all_banks: {
          schema_version: 'hylyre-hypium-ui-dump-v1',
          tree: {
            attributes: { bounds: '[0,0][1260,2720]' },
            children: [{ attributes: { text: '上滑解锁', bounds: '[0,2400][1260,2500]' } }],
          },
        },
      },
    });
    assert.strictEqual(r.fuseEligibility?.eligible, false, '混合轮必须整轮 ineligible（fail-safe）');
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_all_mismatched_missing_screens_are_actionable_sorted', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-allmm-'));
  try {
    // 两屏均确证错页（各自的 dump 都含**另一页**的页面前缀，目标锚缺失）→ 整轮合格，
    // actionableMissingIds=去重、稳定排序后的全部缺屏。
    const r = runCaptureWithDump(root, null, {
      dumpByScreen: {
        add_bank: {
          schema_version: 'hylyre-hypium-ui-dump-v1',
          tree: {
            attributes: { bounds: '[0,0][1260,2720]' },
            children: [
              { attributes: { id: 'maison:demo:all_banks:all_banks_frame', bounds: '[0,0][1260,2720]' } },
            ],
          },
        },
        all_banks: {
          schema_version: 'hylyre-hypium-ui-dump-v1',
          tree: {
            attributes: { bounds: '[0,0][1260,2720]' },
            children: [
              { attributes: { id: 'maison:demo:add_bank:add_bank_frame', bounds: '[0,0][1260,2720]' } },
            ],
          },
        },
      },
    });
    assert.strictEqual(r.fuseEligibility?.eligible, true, '全 mismatch 缺屏轮须有熔断资格');
    assert.deepStrictEqual(
      r.fuseEligibility?.actionableMissingIds,
      ['add_bank', 'all_banks'],
      'actionableMissingIds=全部缺屏、稳定排序',
    );
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t3_overlay_mismatch_invalidates_same_rule_as_main_screen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t3-overlay-'));
  try {
    // overlay 屏（P0 屏内 sheet 子节点）走同一 gate：确定性 mismatched → 同样瞬时失效。
    const doc = {
      screens: [{
        id: 'add_bank', priority: 'P0', ref_id: 'ref_a',
        root: {
          type: 'navigation_frame', order: 0,
          children: [{ id: 'my_sheet', type: 'sheet', order: 1 }],
        },
      }],
      tokens: {}, assets: [],
    } as unknown as UiSpecDoc;
    const overlayId = 'add_bank__overlay__my_sheet';
    const identity = new Map([[overlayId, { all_of: [{ id: 'maison:demo:overlay:my_sheet_frame' }] }]]);
    const shotsDir = path.join(root, 'doc', 'features', 'demo', 'device-testing', 'device-screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    fs.writeFileSync(path.join(shotsDir, 'visual-diff.json'), JSON.stringify({
      schema_version: '1.1',
      screens: [{
        screen_id: overlayId, verdict: 'pass', screenshot_hash: 'h-old',
        confirmed_by: 'human@example.com',
      }],
    }, null, 2));

    const r = captureVisualDiff({
      projectRoot: root,
      feature: 'demo',
      uiDoc: doc,
      currentBuildFingerprint: null,
      // overlay 有到达步骤；主屏空步骤（无 identity 走既有放行路径，专注 overlay 语义）
      navConfig: { add_bank: [], [overlayId]: [{ touch: { by_id: 'x' } }] },
      navExecutorFn: () => ({ ok: true }),
      screenshotFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, Buffer.from('png'));
        return { ok: true };
      },
      layoutDumpFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        // overlay 目标锚不中，但树含主屏页面前缀 ⇒ 确定性 mismatched
        fs.writeFileSync(args.destAbs, JSON.stringify({
          schema_version: 'hylyre-hypium-ui-dump-v1',
          tree: {
            attributes: { bounds: '[0,0][1260,2720]' },
            children: [
              { attributes: { id: 'maison:demo:add_bank:add_bank_frame', bounds: '[0,0][1260,2720]' } },
            ],
          },
        }), 'utf-8');
        return { ok: true };
      },
      screenIdentity: identity,
    });
    assert.ok((r.p0CaptureFailures ?? []).includes(overlayId), 'overlay 错页记 P0 采集失败');
    assert.strictEqual(r.fuseEligibility?.eligible, true, 'overlay 与主屏同资格判据');
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, [overlayId]);
    assert.ok(!fs.existsSync(path.join(shotsDir, `shot-${overlayId}.png`)), 'overlay 正式截图零写入');
    const after = JSON.parse(fs.readFileSync(path.join(shotsDir, 'visual-diff.json'), 'utf-8')) as {
      screens: Array<{ screen_id: string }>;
    };
    assert.ok(!after.screens.some(s => s.screen_id === overlayId), 'overlay mismatch 旧裁决须失效（与主屏同规则）');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_none_of_hit_is_not_ownership_proof', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-noneof-'));
  try {
    // 反例钉死（review 复现）：把锁屏文案配成 none_of 锚，锁屏树会同时"缺 all_of"
    // 且"命中 none_of"。若把 none_of 命中当所有权证明，锁屏就会被判成应用错页并进熔断。
    const identity = new Map([[
      'add_bank',
      { all_of: [{ id: 'maison:demo:add_bank:add_bank_frame' }], none_of: [{ text: '上滑解锁' }] },
    ]]);
    const lockScreen = {
      schema_version: 'hylyre-hypium-ui-dump-v1',
      tree: {
        attributes: { bounds: '[0,0][1260,2720]' },
        children: [{ attributes: { text: '上滑解锁', bounds: '[0,2400][1260,2500]' } }],
      },
    };
    const r = captureVisualDiff({
      projectRoot: root,
      feature: 'demo',
      uiDoc: UI_DOC_ONE_P0,
      currentBuildFingerprint: null,
      screenshotFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, Buffer.from('png'));
        return { ok: true };
      },
      layoutDumpFn: args => {
        fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
        fs.writeFileSync(args.destAbs, JSON.stringify(lockScreen), 'utf-8');
        return { ok: true };
      },
      screenIdentity: identity,
    });
    assert.strictEqual(
      r.fuseEligibility?.eligible,
      false,
      'none_of 命中不构成应用所有权证明——锁屏不得被判成内容问题',
    );
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_missing_p0_screens_are_actionable_but_env_blocked_rounds_are_not', () => {
  const cleanScreens: VisualDiffScreenEntry[] = [
    { screen_id: 'home', verdict: 'pass' } as VisualDiffScreenEntry,
  ];
  // 基线：无缺屏、无 hit → 无残差（回归）
  assert.strictEqual(hasActionableVisualResidual(cleanScreens, []), false, '基线不变');
  assert.strictEqual(
    hasActionableVisualResidual(cleanScreens, [], []),
    false,
    '空缺屏集合等价于不传（行为与改动前一致）',
  );
  // 内容态缺屏（应用前台、错页）→ 必须算残差，否则永不熔断
  assert.ok(
    hasActionableVisualResidual(cleanScreens, [], ['all_banks', 'add_card_result']),
    '内容可行动的 P0 缺屏必须计入 actionable（修采集也是"有事可修"）',
  );
  // 环境阻断态由调用方剔除后传空集——此处断言"传空即不改变判定"，
  // 与上一条共同构成"锁屏轮不产生 fuse"的机器保证（分类在 check-testing，见 t4 注入点）。
  assert.strictEqual(
    hasActionableVisualResidual(cleanScreens, [], []),
    false,
    '环境阻断轮（缺屏被上游剔除）不得被改口成内容残差',
  );
});

test('screens_hash_order_free_and_binding_sensitive', () => {
  const a: VisualDiffScreenEntry[] = [
    { screen_id: 'home', verdict: 'pass', evaluated_screenshot_hash: 'h1' } as VisualDiffScreenEntry,
    { screen_id: 'mine', verdict: 'pass', evaluated_screenshot_hash: 'h2' } as VisualDiffScreenEntry,
  ];
  const b = [...a].reverse();
  assert.strictEqual(computeScreensHash(a), computeScreensHash(b), '屏序无关');
  const c = [{ ...a[0], evaluated_screenshot_hash: 'h9' } as VisualDiffScreenEntry, a[1]];
  assert.notStrictEqual(computeScreensHash(a), computeScreensHash(c), '绑定 hash 变 → 状态变');
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
