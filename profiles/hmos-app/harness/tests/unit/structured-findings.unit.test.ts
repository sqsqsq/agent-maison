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

function runCaptureWithDump(
  root: string,
  dump: unknown | null,
  opts?: { dumpOk?: boolean; badJson?: boolean },
): ReturnType<typeof captureVisualDiff> {
  return captureVisualDiff({
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
      if (opts?.dumpOk === false) return { ok: false, error: 'dump-ui 执行失败（设备无响应）' };
      fs.mkdirSync(path.dirname(args.destAbs), { recursive: true });
      fs.writeFileSync(args.destAbs, opts?.badJson ? '{not json' : JSON.stringify(dump), 'utf-8');
      return { ok: true };
    },
    screenIdentity: IDENTITY_ADD_BANK,
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
    // 诊断一致性：身份不通过按 spec 记 screen_identity_mismatch，但**不得越过证据**
    // 断言成因（既不说"确是错页"、也不说"确非错页"）——须与 fuseEligibility 同口径。
    const detail = r.errors.find(e => e.includes('add_bank')) ?? '';
    assert.ok(/screen_identity_mismatch/.test(detail), `记法须遵循 spec：${detail}`);
    assert.ok(/成因未确证/.test(detail), `须如实标注成因未确证：${detail}`);
    assert.ok(!/非错页/.test(detail), `不得断言"确非错页"（同样越过证据）：${detail}`);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_missing_screens_stay_ineligible_until_t3_lands', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-wrongpage-'));
  try {
    // 看起来最"干净"的错页形态：dump 成功、身份不命中、且树里有本应用组件 id。
    // 即便如此也**不得**放行——t3 已确认 dump 会残留旧页组件树，"锁屏节点 + 残留旧页
    // 节点"的组合同样满足该前缀，故前缀不能证明应用当前在前台（review 实测复现）。
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
    assert.strictEqual(r.fuseEligibility?.eligible, false, 't3 收口前缺屏一律无熔断资格');
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, []);
    assert.ok(/缺屏熔断通道未开通/.test(r.fuseEligibility?.reason ?? ''), r.fuseEligibility?.reason);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_lockscreen_plus_stale_app_nodes_must_not_be_eligible', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-t4-stale-'));
  try {
    // review 复现的**已知风险形态**：锁屏节点与残留的应用旧页节点同时在树里。
    // 任何"看到应用 id 前缀就算前台"的启发式都会在此误判成内容问题并进熔断。
    const lockPlusStale = {
      schema_version: 'hylyre-hypium-ui-dump-v1',
      tree: {
        attributes: { bounds: '[0,0][1260,2720]' },
        children: [
          { attributes: { text: '上滑解锁', bounds: '[0,2400][1260,2500]' } },
          // 被锁屏遮住、但仍留在树里的应用旧页
          { attributes: { id: 'maison:demo:all_banks:all_banks_frame', bounds: '[0,0][1260,2720]' } },
        ],
      },
    };
    // 预置一条**已有真人裁决**的旧条目——误删它就会再次要求人工签字（t1 要消灭的现象）
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

    const r = runCaptureWithDump(root, lockPlusStale);
    assert.strictEqual(
      r.fuseEligibility?.eligible,
      false,
      '锁屏 + 残留应用节点绝不能被判成内容问题（前缀启发式在此必然误判）',
    );
    assert.deepStrictEqual(r.fuseEligibility?.actionableMissingIds, []);
    // **不熔断还不够——更不能误删旧裁决**（review 抓出的消费端遗漏）。
    // 该形态下无法确证"是错页"，删除旧条目会清掉已有的真人签字。
    const after = JSON.parse(fs.readFileSync(path.join(shotsDir, 'visual-diff.json'), 'utf-8')) as {
      screens: Array<{ screen_id: string; confirmed_by?: string }>;
    };
    const kept = after.screens.find(s => s.screen_id === 'add_bank');
    assert.ok(kept, `未确证的失配不得删除旧裁决，实得 screens=${JSON.stringify(after.screens)}`);
    assert.strictEqual(kept?.confirmed_by, 'human@example.com', '真人裁决必须原样保留');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('t4_matrix_capture_not_run_verdict_is_ineligible', () => {
  assert.strictEqual(CAPTURE_NOT_RUN_ELIGIBILITY.eligible, false);
  assert.deepStrictEqual(CAPTURE_NOT_RUN_ELIGIBILITY.actionableMissingIds, []);
  assert.ok(/capture_not_run/.test(CAPTURE_NOT_RUN_ELIGIBILITY.reason));
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
