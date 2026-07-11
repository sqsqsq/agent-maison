// ============================================================================
// layout-oracle.unit.test.ts — plan c6d8f2b4：T8 几何不变量 / M1 自报退化 /
// schema 1.1（reported_*、region_attest、evaluation_invalidated）白盒回归
// ============================================================================
//
// 覆盖矩阵：
//   1. dump 解析：bounds 字符串 / hypium-ui-dump-v1 / app 窗口子树选取
//   2. locator：exact_id > unique_text > structural-lite；歧义即 unmatched；覆盖率
//   3. A 类：forbidden_overlap 命中/不命中/定位失败 WARN；protected_region；越界；
//           close 默认规则仅 advisory（校准 D5 前不硬 gate）
//   4. B 类：layout_group 背离 / order 逆序 WARN；覆盖率不足整类 SKIP
//   5. C 类：间距比例 advisory（永不 gate）
//   6. M1：bc-openCard 反例靶——跨屏常数 iou / 逐位抄 floor / 压线
//   7. schema 1.1：legacy fidelity_score/geometric_iou → reported_* 映射；
//      region_attest 校验；evaluation_invalidated await 资格排除
//   8. t6④：collectScreenLocalTexts 本地分母不含其它屏文本
// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseBoundsString,
  parseHypiumDump,
  locateElements,
  collectDeclaredElements,
  collectLayoutOracleForScreen,
  LOCATOR_COVERAGE_THRESHOLD,
  type LayoutOracleScreenResult,
} from '../../layout-oracle-check';
import {
  collectSelfreportDegeneracy,
  validateVisualDiffJson,
  isScreenAwaitConfirmEligible,
  computeDefectFingerprint,
  collectDefectFingerprints,
  fingerprintSetsEqual,
  isRoundFingerprintable,
  type VisualDiffScreenEntry,
} from '../../visual-diff-check';
import { collectScreenLocalTexts } from '../../capture-completeness-check';
import type { UiSpecScreen, UiSpecComponentNode } from '../../../../../harness/scripts/utils/ui-spec-shared';

export interface UnitCaseResult {
  name: string;
  ok: boolean;
  error?: string;
}

function assert(cond: unknown, label: string): void {
  if (!cond) throw new Error(label);
}

// --- dump 构造 helper（形状对齐真机 hylyre-hypium-ui-dump-v1，E9 实证） -------

interface RawNode {
  attributes: Record<string, string>;
  children?: RawNode[];
}

function node(
  bounds: string,
  extra: Partial<Record<'type' | 'text' | 'id' | 'key' | 'clickable', string>> = {},
  children: RawNode[] = [],
): RawNode {
  return {
    attributes: {
      bounds,
      clickable: extra.clickable ?? 'false',
      id: extra.id ?? '',
      key: extra.key ?? '',
      scrollable: 'false',
      text: extra.text ?? '',
      type: extra.type ?? 'Column',
    },
    children,
  };
}

function mkDump(appChildren: RawNode[]): unknown {
  return {
    schema_version: 'hylyre-hypium-ui-dump-v1',
    source: 'hypium.UiTree',
    tree: node('[0,0][1320,2120]', { type: '' }, [
      node('[0,0][1320,117]', { type: 'StatusBar' }),
      node('[0,117][1320,2120]', { type: 'root' }, appChildren),
    ]),
  };
}

function mkScreen(partial: Partial<UiSpecScreen> & { id: string }): UiSpecScreen {
  return { priority: 'P0', ...partial } as UiSpecScreen;
}

function uiNode(partial: Partial<UiSpecComponentNode> & { type: string; order: number }): UiSpecComponentNode {
  return partial as UiSpecComponentNode;
}

function runOracle(screen: UiSpecScreen, dumpJson: unknown): LayoutOracleScreenResult {
  const dump = parseHypiumDump(dumpJson);
  if (!dump) throw new Error('dump 解析失败');
  return collectLayoutOracleForScreen({ screenId: screen.id, screen, dump });
}

// --- 用例 --------------------------------------------------------------------

const cases: Array<{ name: string; fn: () => void }> = [];

cases.push({
  name: 'parseBoundsString：合法/非法/负坐标',
  fn: () => {
    assert(JSON.stringify(parseBoundsString('[0,117][1320,2120]')) === JSON.stringify({ x1: 0, y1: 117, x2: 1320, y2: 2120 }), '标准形状');
    assert(parseBoundsString('[-5,0][10,20]')?.x1 === -5, '负坐标可解析（离屏节点）');
    assert(parseBoundsString('bogus') === null, '非法返回 null');
    assert(parseBoundsString(undefined) === null, 'undefined 返回 null');
  },
});

cases.push({
  name: 'parseHypiumDump：schema 校验 + app 子树选 type=root（裁掉状态栏）',
  fn: () => {
    const dump = parseHypiumDump(mkDump([node('[40,200][1280,400]', { text: '标题' })]));
    assert(dump, '解析成功');
    assert(dump!.appRoot.type === 'root', 'app 子树=type root');
    assert(dump!.appRect.y1 === 117, 'app 窗口起于状态栏之下');
    assert(parseHypiumDump({ schema_version: 'other', tree: {} }) === null, '非本 schema 拒绝');
  },
});

cases.push({
  name: 'locator：exact_id 优先；unique_text 回退；歧义 unmatched',
  fn: () => {
    const dump = parseHypiumDump(mkDump([
      node('[40,200][1280,320]', { id: 'close_btn', clickable: 'true' }),
      node('[40,400][1280,520]', { text: '储蓄卡' }),
      node('[40,600][1280,720]', { text: '重复文本' }),
      node('[40,800][1280,920]', { text: '重复文本' }),
    ]))!;
    const { located, coverage } = locateElements(
      [
        { elementId: 'close_btn' },
        { elementId: 'debit_row', text: '储蓄卡' },
        { elementId: 'dup_row', text: '重复文本' },
      ],
      dump.appRoot,
    );
    assert(located.get('close_btn')?.confidence === 'exact_id', 'exact_id 命中');
    assert(located.get('debit_row')?.confidence === 'unique_text', 'unique_text 命中');
    assert(located.get('dup_row')?.confidence === 'unmatched', '同文本多节点=歧义不强猜');
    assert(Math.abs(coverage - 2 / 3) < 1e-9, '覆盖率 2/3');
  },
});

cases.push({
  name: 'A1 forbidden_overlap：相交 hard 命中；不相交零命中；定位失败降 WARN',
  fn: () => {
    const screen = mkScreen({
      id: 'card_type_sheet',
      root: uiNode({ type: 'overlay_panel', order: 0, children: [
        uiNode({ type: 'action_button', order: 1, id: 'close_btn' }),
        uiNode({ type: 'content_display', order: 2, id: 'bank_surface' }),
      ] }),
      forbidden_overlap: [['close_btn', 'bank_surface']],
    });
    // 相交（bc-openCard (b) 靶形态：X 与银行卡区域重叠）
    const hit = runOracle(screen, mkDump([
      node('[1180,700][1280,800]', { id: 'close_btn', clickable: 'true' }),
      node('[40,750][1280,1100]', { id: 'bank_surface' }),
    ]));
    assert(hit.findings.some(f => f.tier === 'hard' && f.signal === 'A1_forbidden_overlap'), '相交 → hard');
    // 不相交
    const ok = runOracle(screen, mkDump([
      node('[1180,700][1280,800]', { id: 'close_btn', clickable: 'true' }),
      node('[40,900][1280,1100]', { id: 'bank_surface' }),
    ]));
    assert(!ok.findings.some(f => f.signal === 'A1_forbidden_overlap'), '不相交零命中');
    // 定位失败（未设 .id、无文本锚）→ 声明未生效 WARN
    const miss = runOracle(screen, mkDump([node('[40,900][1280,1100]', { id: 'bank_surface' })]));
    assert(miss.findings.some(f => f.tier === 'warn' && f.signal === 'A1_forbidden_overlap_unlocatable'), '定位失败 → warn');
  },
});

cases.push({
  name: 'A1 protected_region：非亲缘可交互控件侵入 → hard；祖先豁免',
  fn: () => {
    const screen = mkScreen({
      id: 's',
      root: uiNode({ type: 'navigation_frame', order: 0, children: [
        uiNode({ type: 'content_display', order: 1, id: 'bank_surface' }),
      ] }),
      protected_region: ['bank_surface'],
    });
    const hit = runOracle(screen, mkDump([
      node('[40,750][1280,1100]', { id: 'bank_surface' }),
      node('[1200,760][1280,840]', { id: 'floating_x', clickable: 'true' }),
    ]));
    assert(hit.findings.some(f => f.tier === 'hard' && f.signal === 'A1_protected_region'), '侵入 → hard');
    // 亲缘（保护区自己的可点击父容器）不算
    const kin = runOracle(screen, mkDump([
      node('[40,700][1280,1200]', { clickable: 'true' }, [node('[40,750][1280,1100]', { id: 'bank_surface' })]),
    ]));
    assert(!kin.findings.some(f => f.signal === 'A1_protected_region'), '祖先豁免');
  },
});

cases.push({
  name: 'A2 越界 hard；A3 close 默认规则仅 advisory（校准 D5 前不硬 gate）',
  fn: () => {
    const screen = mkScreen({
      id: 'sheet',
      root: uiNode({ type: 'overlay_panel', order: 0, children: [
        uiNode({ type: 'content_display', order: 1, id: 'title_row' }),
      ] }),
    });
    const res = runOracle(screen, mkDump([
      // title_row 与右上角小型可点击叶子（疑似 close）相交
      node('[40,700][1280,820]', { id: 'title_row' }),
      node('[1220,710][1290,780]', { id: '', clickable: 'true' }),
      // 越界元素
      node('[1200,2100][1400,2200]', { id: 'title_row_dup' }),
    ]));
    const advisory = res.findings.filter(f => f.signal === 'A3_close_overlap_default');
    assert(advisory.length > 0 && advisory.every(f => f.tier === 'advisory'), 'close 默认规则=advisory');
    // 越界：title_row 在屏内不触发；构造声明元素越界
    const screen2 = mkScreen({
      id: 's2',
      root: uiNode({ type: 'navigation_frame', order: 0, children: [
        uiNode({ type: 'content_display', order: 1, id: 'runaway' }),
      ] }),
    });
    const res2 = runOracle(screen2, mkDump([node('[1200,2100][1400,2200]', { id: 'runaway' })]));
    assert(res2.findings.some(f => f.tier === 'hard' && f.signal === 'A2_out_of_screen'), '越界 → hard');
  },
});

cases.push({
  name: 'B 类：layout_group 背离/order 逆序 → warn；locator 覆盖率不足整类 SKIP',
  fn: () => {
    const screen = mkScreen({
      id: 's',
      root: uiNode({ type: 'navigation_frame', order: 0, children: [
        uiNode({ type: 'content_display', order: 1, id: 'a', layout_group: 'row1' }),
        uiNode({ type: 'content_display', order: 2, id: 'b', layout_group: 'row1' }),
        uiNode({ type: 'content_display', order: 3, id: 'c' }),
      ] }),
    });
    // a/b 声明同组，但运行时纵向分离且不共直接父容器 → B1 warn；c(order=3) 在 b(order=2) 上方 → B3 warn
    const res = runOracle(screen, mkDump([
      node('[40,200][640,320]', { id: 'a' }),
      node('[40,1500][640,1620]', { id: 'b' }),
      node('[40,400][640,520]', { id: 'c' }),
    ]));
    assert(res.findings.some(f => f.tier === 'warn' && f.signal === 'B1_layout_group_divergent'), 'B1 warn');
    assert(res.findings.some(f => f.tier === 'warn' && f.signal === 'B3_order_inverted'), 'B3 warn');
    assert(!res.bClassSkipped, '覆盖率足够时 B 类运行');
    // 覆盖率不足：三元素只有一个可定位
    const low = runOracle(screen, mkDump([node('[40,200][640,320]', { id: 'a' })]));
    assert(low.coverage < LOCATOR_COVERAGE_THRESHOLD && low.bClassSkipped, '覆盖率不足 → B 类 SKIP');
  },
});

cases.push({
  name: 'C1 间距比例：偏差超 tolerance → advisory（永不 hard/warn）',
  fn: () => {
    const screen = mkScreen({
      id: 's',
      root: uiNode({ type: 'navigation_frame', order: 0, children: [
        uiNode({ type: 'content_display', order: 1, id: 'a', bbox: [0.05, 0.10, 0.9, 0.05] }),
        // 参考推导间距=0.35-(0.10+0.05)=0.20；运行时间距造大偏差
        uiNode({ type: 'content_display', order: 2, id: 'b', bbox: [0.05, 0.35, 0.9, 0.05] }),
      ] }),
    });
    const res = runOracle(screen, mkDump([
      node('[40,200][1280,300]', { id: 'a' }),
      node('[40,1800][1280,1900]', { id: 'b' }),
    ]));
    const c1 = res.findings.filter(f => f.signal === 'C1_gap_ratio_divergent');
    assert(c1.length === 1 && c1[0].tier === 'advisory', 'C1 → advisory');
  },
});

cases.push({
  name: 'M1：bc-openCard 反例靶——8 屏 iou 恒等=常数组；7 屏逐位抄 floor；压线',
  fn: () => {
    const floors = [0.95, 0.9950983655946058, 0.9869080098975135, 0.9934442456736912, 0.9827374511627001, 0.8501662716324709, 0.99, 0.99];
    const screens: VisualDiffScreenEntry[] = floors.map((f, i) => ({
      screen_id: `s${i}`,
      verdict: 'pass',
      reported_geometric_iou: 0.95,
      // 7/8 屏逐位抄 floor（i=5 例外，仿 card_detail 0.943）
      reported_fidelity_score: i === 5 ? 0.9433496414002379 : f,
      score_floor: f,
      defects: [],
    }));
    const d = collectSelfreportDegeneracy(screens);
    assert(d.constantGroups.some(g => g.includes('geometric_iou=0.95') && g.includes('8 屏')), '常数 iou 检出');
    assert(d.copyFloor.length === 7, `抄 floor 7 屏（实际 ${d.copyFloor.length}）`);
    // 压线：非逐位相等但 |Δ|<ε 且 defects=[]
    const graze = collectSelfreportDegeneracy([
      { screen_id: 'g', verdict: 'pass', reported_fidelity_score: 0.9901, score_floor: 0.99, defects: [] },
    ]);
    assert(graze.grazing.length === 1, '压线检出');
    // 健康样本：各屏独立取值 → 零命中
    const healthy = collectSelfreportDegeneracy(
      [0.91, 0.87, 0.95, 0.78].map((v, i) => ({
        screen_id: `h${i}`,
        verdict: 'pass' as const,
        reported_fidelity_score: v,
        reported_geometric_iou: v - 0.03,
        score_floor: 0.5 + i * 0.01,
        defects: [],
      })),
    );
    assert(healthy.constantGroups.length === 0 && healthy.copyFloor.length === 0 && healthy.grazing.length === 0, '健康样本零命中');
  },
});

cases.push({
  name: 'schema 1.1：legacy fidelity_score/geometric_iou 读入映射 reported_*',
  fn: () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-oracle-'));
    try {
      const shot = path.join(tmp, 'shot.png');
      fs.writeFileSync(shot, 'png');
      const r = validateVisualDiffJson(
        {
          schema_version: '1.0',
          screens: [{
            screen_id: 'legacy',
            verdict: 'pass',
            screenshot_path: shot,
            ref_id: 'r',
            fidelity_score: 0.95,
            geometric_iou: 0.9,
            defects: [],
            reverse_missing: [],
          }],
        },
        tmp,
      );
      assert(r.report, 'best-effort report 存在');
      const s = r.report!.screens[0];
      assert(s.reported_fidelity_score === 0.95 && s.reported_geometric_iou === 0.9, 'legacy → reported_* 映射');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
});

cases.push({
  name: 'schema 1.1：region_attest 校验（method/verdict 枚举；paired 须 evidence）',
  fn: () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-oracle-'));
    try {
      const shot = path.join(tmp, 'shot.png');
      fs.writeFileSync(shot, 'png');
      const r = validateVisualDiffJson(
        {
          schema_version: '1.1',
          screens: [{
            screen_id: 's',
            verdict: 'pass',
            screenshot_path: shot,
            ref_id: 'r',
            defects: [],
            region_attest: [
              { region: 'bank_row', verdict: 'no_diff', method: 'paired_crop_compare' }, // 缺 evidence
              { region: 'title', verdict: 'bogus', method: 'human' }, // 非法 verdict
            ],
          }],
        },
        tmp,
      );
      assert(!r.ok, '须报 schema 错误');
      assert(r.errors.some(e => e.includes('evidence 必填')), 'paired 缺 evidence 拦截');
      assert(r.errors.some(e => e.includes('verdict 非法')), 'verdict 枚举拦截');
      // evaluation_invalidated 非布尔拦截
      const r2 = validateVisualDiffJson(
        {
          schema_version: '1.1',
          screens: [{ screen_id: 's', verdict: 'pending', screenshot_path: shot, ref_id: 'r', evaluation_invalidated: 'yes' }],
        },
        tmp,
      );
      assert(r2.errors.some(e => e.includes('evaluation_invalidated')), 'evaluation_invalidated 类型拦截');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
});

cases.push({
  name: 't4③：evaluation_invalidated 屏排除出 await_human_confirm 资格',
  fn: () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-oracle-'));
    try {
      const shot = path.join(tmp, 'shot.png');
      fs.writeFileSync(shot, 'png-bytes');
      const { createHash } = require('crypto') as typeof import('crypto');
      const hash = createHash('sha256').update(fs.readFileSync(shot)).digest('hex').slice(0, 16);
      const base: VisualDiffScreenEntry = {
        screen_id: 's',
        verdict: 'pass',
        screenshot_path: shot,
        evaluated_screenshot_hash: hash,
        evaluated_build_fingerprint: 'fp1234567890',
        must_fix: [],
      };
      assert(isScreenAwaitConfirmEligible(base, tmp, 'fp1234567890'), '干净 pass 屏合格');
      assert(
        !isScreenAwaitConfirmEligible({ ...base, evaluation_invalidated: true }, tmp, 'fp1234567890'),
        '评估失效屏不合格（须 critic 重评清标记后再签）',
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  },
});

cases.push({
  name: 't6④：collectScreenLocalTexts 只含本屏文本与本屏 ref-elements（不吃其它屏/全局）',
  fn: () => {
    const screen = mkScreen({
      id: 'card_type_sheet',
      ref_id: 'ref_card_type_sheet',
      root: uiNode({ type: 'overlay_panel', order: 0, children: [
        uiNode({ type: 'content_display', order: 1, text: '选择卡类型' }),
        uiNode({ type: 'list_selection', order: 2, text: '储蓄卡' }),
      ] }),
    });
    const texts = collectScreenLocalTexts(screen, [
      { element_id: 'bank_row', screen_ref_id: 'ref_card_type_sheet', text: '招商银行', disposition: 'implement' },
      { element_id: 'other', screen_ref_id: 'ref_add_home', text: '工商银行', disposition: 'implement' },
    ]);
    assert(texts.includes('选择卡类型') && texts.includes('储蓄卡'), '本屏节点文本在');
    assert(texts.includes('招商银行'), '本屏 ref-elements 在');
    assert(!texts.includes('工商银行'), '其它屏 ref-elements 不在（这正是挂靠洞）');
  },
});

cases.push({
  name: 'collectDeclaredElements：节点 id + must_have_elements 去重合并',
  fn: () => {
    const screen = mkScreen({
      id: 's',
      must_have_elements: ['title', 'extra'],
      root: uiNode({ type: 'navigation_frame', order: 0, children: [
        uiNode({ type: 'content_display', order: 1, id: 'title', text: '标题' }),
      ] }),
    });
    const els = collectDeclaredElements(screen);
    assert(els.length === 2, '去重后 2 项');
    assert(els.find(e => e.elementId === 'title')?.text === '标题', '节点文本随行');
  },
});

cases.push({
  name: 'A-4 两两扫描：非亲缘相交 → advisory；亲缘豁免；上限 8 条（cursor rev8 专测补位）',
  fn: () => {
    const screen = mkScreen({ id: 's', root: uiNode({ type: 'navigation_frame', order: 0 }) });
    // 两个非亲缘可交互叶子相交 → advisory
    const hit = runOracle(screen, mkDump([
      node('[100,300][300,420]', { id: 'btn_a', clickable: 'true' }),
      node('[250,380][450,500]', { id: 'btn_b', clickable: 'true' }),
    ]));
    const a4 = hit.findings.filter(f => f.signal === 'A4_pairwise_overlap');
    assert(a4.length === 1 && a4[0].tier === 'advisory', `非亲缘相交应 1 条 advisory（实际 ${a4.length}）`);
    // 亲缘（父可点击容器包子按钮）豁免
    const kin = runOracle(screen, mkDump([
      node('[100,300][500,600]', { id: 'card', clickable: 'true' }, [
        node('[150,350][300,450]', { id: 'inner_btn', clickable: 'true' }),
      ]),
    ]));
    assert(!kin.findings.some(f => f.signal === 'A4_pairwise_overlap'), '祖先-后代不算 overlap');
    // 上限 8：10 个叶子全部互相叠在同一区域（45 对相交）→ 只出 8 条防噪
    const pile = runOracle(screen, mkDump(
      Array.from({ length: 10 }, (_, i) => node(`[${100 + i},${300 + i}][${400 + i},${600 + i}]`, { id: `p${i}`, clickable: 'true' })),
    ));
    const pileA4 = pile.findings.filter(f => f.signal === 'A4_pairwise_overlap');
    assert(pileA4.length === 8, `上限 8 条（实际 ${pileA4.length}）`);
  },
});

cases.push({
  name: 't9 指纹：bbox 分桶吸收抖动；同义改写不改指纹；集合比较',
  fn: () => {
    const d = (bbox?: number[]) => ({ class: 'overlap' as const, element: 'close_btn', severity: 'major' as const, note: 'X 与银行卡重叠', bbox });
    const f1 = computeDefectFingerprint('sheet', d([0.81, 0.52, 0.1, 0.05]));
    const f2 = computeDefectFingerprint('sheet', d([0.83, 0.54, 0.12, 0.07])); // 像素抖动 → 同桶
    assert(f1 === f2, `0.1 网格分桶应吸收抖动：${f1} vs ${f2}`);
    // 同义改写（note 措辞变）不改指纹——熔断判据与自然语言解耦
    const f3 = computeDefectFingerprint('sheet', { ...d([0.81, 0.52, 0.1, 0.05]), note: '关闭按钮压住了银行区域（换个说法）' });
    assert(f1 === f3, 'note 措辞不参与指纹');
    const screens: VisualDiffScreenEntry[] = [
      { screen_id: 'sheet', verdict: 'fail', defects: [d([0.81, 0.52, 0.1, 0.05]), { class: 'clipping', severity: 'minor', note: 'x', element: 'title' }] },
    ];
    const set1 = collectDefectFingerprints(screens);
    assert(set1.length === 2, '去重后 2 条');
    assert(fingerprintSetsEqual(set1, [...set1].reverse()), '集合比较与顺序无关');
    assert(!fingerprintSetsEqual(set1, set1.slice(0, 1)), '子集不相等');
    // rev9（codex：同数异质问题会被计数近似误判成无进展 → 错误熔断）：
    // must_fix 未转录为结构化 defects 的轮次**无资格**参与指纹比较——不比较、不真空成立、不数数近似。
    const mfOnly: VisualDiffScreenEntry[] = [
      { screen_id: 'sheet', verdict: 'warn', defects: [], must_fix: ['加大标题与银行卡间距', '关闭钮移出卡片区域'] },
    ];
    assert(!isRoundFingerprintable(mfOnly), 'must_fix 未转录 → 轮次无指纹资格（防同数异质误熔断）');
    const transcribed: VisualDiffScreenEntry[] = [
      {
        screen_id: 'sheet', verdict: 'warn',
        must_fix: ['加大标题与银行卡间距'],
        defects: [{ class: 'shape_mismatch', severity: 'major', note: '标题间距', element: 'title_row', bbox: [0.1, 0.1, 0.8, 0.1] }],
      },
    ];
    assert(isRoundFingerprintable(transcribed), '已转录（must_fix 有对应结构化 defect）→ 有资格');
    assert(isRoundFingerprintable(screens), '纯 defects 轮次有资格');
    // rev10（codex 追打）：部分转录（must_fix 2 条、defects 1 条）→ 未转录余量漏纹，无资格
    const partial: VisualDiffScreenEntry[] = [
      {
        screen_id: 'sheet', verdict: 'warn',
        must_fix: ['加大标题与银行卡间距', '关闭钮移出卡片区域'],
        defects: [{ class: 'shape_mismatch', severity: 'major', note: '标题间距', element: 'title_row', bbox: [0.1, 0.1, 0.8, 0.1] }],
      },
    ];
    assert(!isRoundFingerprintable(partial), '部分转录（must_fix 多于 defects）→ 无资格（必要条件近似，错向安全侧）');
    // review-fix 轮4（codex P1）：T8 转录 defect 的 source.finding_id 进指纹——同 class/
    // 同元素/同 0.1 桶的两个不同 T8 finding（如两个 B 类 signal 都映射 shape_mismatch）
    // 必须得到不同指纹，否则"修掉 A、冒出 B"会撞同指纹误熔断。
    const t8a = computeDefectFingerprint('sheet', {
      ...d([0.81, 0.52, 0.1, 0.05]),
      source: { producer: 'T8', finding_id: 'aaaa111122223333', signal: 'B1_sibling_order' },
    });
    const t8b = computeDefectFingerprint('sheet', {
      ...d([0.81, 0.52, 0.1, 0.05]),
      source: { producer: 'T8', finding_id: 'bbbb444455556666', signal: 'B2_depth_mismatch' },
    });
    assert(t8a !== t8b, '不同 finding_id 的转录 defect 指纹必须互异（防同桶碰撞误熔断）');
    assert(t8a !== f1, '带 source 的指纹与 legacy 四元组不同（跨格式比较不相等 → 熔断推迟，错向安全侧）');
    const t8aAgain = computeDefectFingerprint('sheet', {
      ...d([0.83, 0.54, 0.12, 0.07]), note: '措辞换了',
      source: { producer: 'T8', finding_id: 'aaaa111122223333', signal: 'B1_sibling_order' },
    });
    assert(t8a === t8aAgain, '同 finding_id：像素抖动/措辞改写仍同指纹（稳定身份跨轮成立）');
  },
});

export function runAll(): UnitCaseResult[] {
  const out: UnitCaseResult[] = [];
  for (const c of cases) {
    try {
      c.fn();
      out.push({ name: c.name, ok: true });
    } catch (e) {
      out.push({ name: c.name, ok: false, error: (e as Error).message });
    }
  }
  return out;
}
