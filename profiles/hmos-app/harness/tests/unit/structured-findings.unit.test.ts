/**
 * structured-findings 单测（t0/t2/t6b，plan f7a3d9c2）：
 * - finding_id 稳定性（emit 定稿、elements 顺序无关、bbox 桶内抖动不变 id）
 * - T8 findings 结构化字段（elements/B 类 bbox）
 * - 转录对账纯函数（normRectIoU / signalExpectedClasses / actionable 谓词）
 * - 守恒断言（t6b）：非 pixel_1to1 的 actionable=false → fuse decision 恒 false
 */
import * as assert from 'assert';
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
