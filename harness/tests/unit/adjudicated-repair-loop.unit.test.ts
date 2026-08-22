// ============================================================================
// adjudicated-repair-loop.unit.test.ts — M2 纯函数层（plan e2b7c4a9 t2.6）
// ----------------------------------------------------------------------------
// 覆盖：
//   1. parseDefectReviewBlock：confirmed / disputed / 无块（unreviewed）/ 非法 verdict\n   2. levenshteinDistance：编辑距离基数（OCR 混淆判定核心）\n   3. collectTextPlacementSignals：OCR 混淆（编辑距离 ≤1）→ uncertain 不产 FAIL 级信号\n      与存在性 must_fix；整页参考图 vs 单视口 → 纵序比较降级 uncertain 注明口径缺口\n// ============================================================================

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { clearFrameworkConfigCache } from '../../config';
import {
  collectTextPlacementSignals,
  levenshteinDistance,
} from '../../../profiles/hmos-app/harness/visual-diff-ocr-gates';
import { parseDefectReviewBlock } from '../../scripts/utils/repair-candidates';
import type { OcrResult, OcrWord } from '../../../profiles/hmos-app/harness/ocr-toolkit';
import type { UnitCaseResult } from '../run-unit';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const cases: Array<{ name: string; run: () => void }> = [];

/** 登记用例（不执行）——runAll 统一遍历执行并捕获异常（标准模式，防假 PASS） */
function run(name: string, fn: () => void): void {
  cases.push({ name, run: fn });
}

/** 构造 OCR 结果：给定行的 (text, y) → 每行一个 word（单 word 即整行） */
function ocrOf(lines: Array<{ text: string; y: number }>, height: number = 2120, width: number = 1320): OcrResult {
  const words: OcrWord[] = lines.map((l, i) => ({
    text: l.text,
    conf: 90,
    bbox: [0.1, l.y / height, 0.8, 0.04],
  }));
  return { ok: true, width, height, words };
}

const SCREEN_TEXTS = new Map<string, string[]>([
  ['add_card_home', ['中信银行', '添加卡片']],
]);

const screenEntry = (id: string, shotRel: string) => ({
  screen_id: id,
  verdict: 'warn' as const,
  screenshot_path: shotRel,
});

function shotAbs(rel: string): string { return rel; }

export function runAll(): UnitCaseResult[] {
  const results: UnitCaseResult[] = [];

  run('parseDefectReviewBlock：confirmed/disputed 逐条解析 + 理由', () => {
    const r = parseDefectReviewBlock([
      '```defect-review',
      '- signal: 添加银行卡标题',
      '  verdict: confirmed',
      '  rationale: 截图核对确认为真缺陷',
      '- signal: 银行行布局',
      '  verdict: disputed',
      '  rationale: OCR 混淆，非真缺陷',
      '```',
    ].join('\n'));
    assert(r.ok, `块须可解析：${r.reason}`);
    assert(r.entries.length === 2, `两条：${r.entries.length}`);
    assert(r.entries[0].verdict === 'confirmed' && r.entries[0].signal === '添加银行卡标题', '第一条 confirmed');
    assert((r.entries[1].rationale?.includes('OCR') ?? false), '第二条 disputed + 理由');
  });

  run('parseDefectReviewBlock：无块 → ok:false（unreviewed，fail-closed）', () => {
    const empty = parseDefectReviewBlock('');
    assert(!empty.ok && empty.entries.length === 0, '空报告 → 无块');
    const noBlock = parseDefectReviewBlock('# 测试报告\n无 fenced 块');
    assert(!noBlock.ok, '无 fenced 块 → 失败（unreviewed）');
  });

  run('parseDefectReviewBlock：非法 verdict 按 disputed（fail-closed 不产候选）', () => {
    const r = parseDefectReviewBlock([
      '```defect-review',
      '- signal: X',
      '  verdict: maybe',
      '```',
    ].join('\n'));
    assert(r.ok && r.entries[0].verdict === 'disputed', `非法 verdict 归 disputed：${r.entries[0].verdict}`);
  });

  run('levenshteinDistance：编辑距离基数（中信/中国 银行 → 1）', () => {
    assert(levenshteinDistance('中信银行', '中国银行') === 1, '中信→中国 距离 1');
    assert(levenshteinDistance('中信银行', '中信银行') === 0, '全等 0');
    assert(levenshteinDistance('添加卡片', '添加卡') === 1, '掉字 1');
    assert(levenshteinDistance('添加卡片', '添加银行卡') === 3, '删插两字+替换 3');
    assert(levenshteinDistance('abcdef', 'xyz') === 6, '不相关 6');
  });

  run('collectTextPlacementSignals：OCR 混淆（编辑距离 ≤1）→ uncertain 不产 FAIL/必须修复', () => {
    const refWords = ocrOf([{ text: '中信银行', y: 100 }, { text: '添加卡片', y: 400 }]);
    const shotWords = ocrOf([
      { text: '中国银行', y: 100 },   // OCR 把「中信银行」误读为「中国银行」（编辑距离 1）
      { text: '添加卡片', y: 400 },
    ]);
    const res = collectTextPlacementSignals(
      SCREEN_TEXTS,
      [screenEntry('add_card_home', 'shot-a.png')],
      shotAbs,
      () => 'ref.png',
      (p: string) => (p === 'shot-a.png' ? shotWords : refWords),
    );
    const screen = res.perScreen.find((p) => p.screen_id === 'add_card_home');
    assert(!!screen, '屏须有信号记录');
    assert(screen!.fail_signals.length === 0, `OCR 混淆不得产 FAIL 级信号：${JSON.stringify(screen!.fail_signals)}`);
    assert(screen!.must_fix.length === 0, `OCR 混淆不得产存在性 must_fix（识别到近似文本≠缺失）：${JSON.stringify(screen!.must_fix)}`);
    assert((screen!.uncertain ?? []).length >= 1, `须归 uncertain：${JSON.stringify(screen!.uncertain)}`);
    assert(res.uncertainSignals.length >= 1, 'uncertainSignals 汇总须非空');
    assert(res.uncertainSignals[0].reason.includes('编辑距离'), '原因须注明编辑距离混淆');
  });

  run('collectTextPlacementSignals：整页参考图 vs 单视口 → 纵序比较降级 uncertain（注明口径缺口）', () => {
    // 参考图高 4350（整页拼接）> 截图高 2120（单视口）——「中信银行」在上、「添加卡片」在下，
    // 截图中 y 序颠倒（口径错配下不可靠）
    const refWords = ocrOf([
      { text: '中信银行', y: 100 },
      { text: '添加卡片', y: 400 },
    ], 4350, 1320);
    const shotWords = ocrOf([
      { text: '添加卡片', y: 100 },
      { text: '中信银行', y: 400 },
    ], 2120, 1320);
    const res = collectTextPlacementSignals(
      SCREEN_TEXTS,
      [screenEntry('add_card_home', 'shot-a.png')],
      shotAbs,
      () => 'ref.png',
      (p: string) => (p === 'shot-a.png' ? shotWords : refWords),
    );
    const screen = res.perScreen.find((p) => p.screen_id === 'add_card_home');
    assert(!!screen, '屏须有信号记录');
    assert(screen!.fail_signals.length === 0, `整页 vs 视口的纵序不得产 FAIL：${JSON.stringify(screen!.fail_signals)}`);
    const uncertain = screen!.uncertain ?? [];
    assert(uncertain.some((u) => u.includes('口径缺口')), `须注明口径缺口：${JSON.stringify(uncertain)}`);
    assert(
      res.uncertainSignals.some((u) => u.reason.includes('整页参考图')),
      `uncertainSignals 须含整页参考图标注：${JSON.stringify(res.uncertainSignals)}`,
    );
  });

  run('集合级混淆（60bcd1 真实机理）：候选同时含近似对，OCR 命中其一 → 双方 uncertain，不产 must_fix/FAIL', () => {
    // 真实候选集合同时含「中信银行」「中国银行」（如两行并列）；截图 OCR 只识别到其中
    // 一行「中国银行」——0.75 模糊匹配对两字差异不可靠，「中信银行」不得落成存在性 must_fix
    //（actionable），双方归 uncertain 交人。
    const texts = new Map<string, string[]>([
      ['all_banks', ['中信银行', '中国银行', '添加卡片']],
    ]);
    const refWords = ocrOf([
      { text: '中信银行', y: 100 },
      { text: '中国银行', y: 200 },
      { text: '添加卡片', y: 400 },
    ]);
    const shotWords = ocrOf([
      { text: '中国银行', y: 150 },
      { text: '添加卡片', y: 400 },
    ]);
    const res = collectTextPlacementSignals(
      texts,
      [screenEntry('all_banks', 'shot-a.png')],
      shotAbs,
      () => 'ref.png',
      (p: string) => (p === 'shot-a.png' ? shotWords : refWords),
    );
    const screen = res.perScreen.find((p) => p.screen_id === 'all_banks');
    assert(!!screen, `屏须有信号记录：${JSON.stringify(res.perScreen)}`);
    assert(screen!.fail_signals.length === 0, `不得产 FAIL：${JSON.stringify(screen!.fail_signals)}`);
    assert(
      !(screen!.must_fix ?? []).some((m) => m.includes('中信银行') || m.includes('中国银行')),
      `近似对不得落成存在性 must_fix：${JSON.stringify(screen!.must_fix)}`,
    );
    assert(
      (screen!.uncertain ?? []).length >= 1,
      `须归 uncertain（直接规则或集合级规则）：${JSON.stringify(screen!.uncertain)}`,
    );
  });

  run('整页判定用宽高比：同比例不同分辨率（1440×3120 vs 1080×2340）不误判整页', () => {
    // 同宽高比（2.167）、仅分辨率不同 → 不得按整页/视口口径降级；真实纵序乱序仍可判
    const refWords = ocrOf([
      { text: '中信银行', y: 100 },
      { text: '添加卡片', y: 600 },
    ], 3120, 1440);
    const shotWords = ocrOf([
      { text: '添加卡片', y: 100 },
      { text: '中信银行', y: 600 },
    ], 2340, 1080);
    const res = collectTextPlacementSignals(
      SCREEN_TEXTS,
      [screenEntry('add_card_home', 'shot-a.png')],
      shotAbs,
      () => 'ref.png',
      (p: string) => (p === 'shot-a.png' ? shotWords : refWords),
    );
    const screen = res.perScreen.find((p) => p.screen_id === 'add_card_home');
    assert(!!screen, '屏须有信号记录');
    assert(
      !(screen!.uncertain ?? []).some((u) => u.includes('口径缺口')),
      `同比例分辨率不得误判整页降级：${JSON.stringify(screen!.uncertain)}`,
    );
    // 单对逆序 → advisory（must_fix）而非 FAIL；绝不得因整页规则吞掉
    const hasInversion =
      (screen!.must_fix ?? []).some((m) => m.includes('顺序颠倒')) ||
      (screen!.fail_signals ?? []).some((f) => f.includes('纵向乱序'));
    assert(hasInversion, `真实逆序仍须可见：${JSON.stringify(screen!.must_fix)} / ${JSON.stringify(screen!.fail_signals)}`);
    // 不同宽高比（参考图显著更高）才降级
    const refWordsTall = ocrOf([
      { text: '中信银行', y: 100 },
      { text: '添加卡片', y: 2400 },
    ], 4350, 1320);
    const res2 = collectTextPlacementSignals(
      SCREEN_TEXTS,
      [screenEntry('add_card_home', 'shot-b.png')],
      shotAbs,
      () => 'ref.png',
      (p: string) => (p === 'shot-b.png' ? shotWords : refWordsTall),
    );
    const screen2 = res2.perScreen.find((p) => p.screen_id === 'add_card_home');
    assert(!!screen2 && (screen2.uncertain ?? []).some((u) => u.includes('口径缺口')),
      `真正整页（宽高比显著更高）须降级 uncertain：${JSON.stringify(screen2?.uncertain)}`);
  });

  run('uncertainSignals target 稳定（候选文本锚，非动态 reason）', () => {
    const refWords = ocrOf([{ text: '中信银行', y: 100 }, { text: '添加卡片', y: 400 }]);
    const shotWords = ocrOf([
      { text: '中国银行', y: 100 },
      { text: '添加卡片', y: 400 },
    ]);
    const res = collectTextPlacementSignals(
      SCREEN_TEXTS,
      [screenEntry('add_card_home', 'shot-a.png')],
      shotAbs,
      () => 'ref.png',
      (p: string) => (p === 'shot-a.png' ? shotWords : refWords),
    );
    assert(res.uncertainSignals.length >= 1, '须有 uncertain 信号');
    assert(res.uncertainSignals[0].target === '中信银行',
      `target 须为稳定候选锚（供 defect-review 恢复绑定）：${JSON.stringify(res.uncertainSignals[0])}`);
  });

  run('短串编辑距离 1 不得漏成 actionable（must_fix 前置判定）+ 近似对双方 target 精确断言', () => {
    // 短串（两字「中信」vs「中国」）——0.75 模糊匹配对短串两字差异不可靠，编辑距离判定
    // 必须在「未命中→must_fix」之前
    const texts = new Map<string, string[]>([['all_banks', ['中信', '添加卡片']]]);
    const refWords = ocrOf([{ text: '中信', y: 100 }, { text: '添加卡片', y: 400 }]);
    const shotWords = ocrOf([{ text: '中国', y: 100 }, { text: '添加卡片', y: 400 }]);
    const res = collectTextPlacementSignals(
      texts,
      [screenEntry('all_banks', 'shot-a.png')],
      shotAbs,
      () => 'ref.png',
      (p: string) => (p === 'shot-a.png' ? shotWords : refWords),
    );
    const screen = res.perScreen.find((p) => p.screen_id === 'all_banks');
    assert(!!screen, `屏须有信号记录：${JSON.stringify(res.perScreen)}`);
    assert(
      !(screen!.must_fix ?? []).some((m) => m.includes('中信')),
      `短串距离 1 不得漏成存在性 must_fix：${JSON.stringify(screen!.must_fix)}`,
    );
    assert(
      (screen!.uncertain ?? []).some((u) => u.includes('「中信」')),
      `须归 uncertain：${JSON.stringify(screen!.uncertain)}`,
    );
    // 近似对双方 target：候选集合同时含「中信」「中国」，OCR 只命中「中国」→ 双方都进 uncertain
    const texts2 = new Map<string, string[]>([['all_banks', ['中信', '中国', '添加卡片']]]);
    const refWords2 = ocrOf([
      { text: '中信', y: 100 }, { text: '中国', y: 200 }, { text: '添加卡片', y: 400 },
    ]);
    const shotWords2 = ocrOf([{ text: '中国', y: 150 }, { text: '添加卡片', y: 400 }]);
    const res2 = collectTextPlacementSignals(
      texts2,
      [screenEntry('all_banks', 'shot-b.png')],
      shotAbs,
      () => 'ref.png',
      (p: string) => (p === 'shot-b.png' ? shotWords2 : refWords2),
    );
    const targets = res2.uncertainSignals.map((u) => u.target);
    assert(targets.includes('中信') && targets.includes('中国'),
      `近似对双方 target 都须在 uncertain（原子组）：${JSON.stringify(targets)}`);
    assert(
      !(res2.perScreen.find((p) => p.screen_id === 'all_banks')?.must_fix ?? [])
        .some((m) => m.includes('中信') || m.includes('中国')),
      `近似对双方不得落成 must_fix：${JSON.stringify(res2.perScreen)}`,
    );
  });

  run('真实载体：真实 checkVisualDiff 产 structured.uncertain_signals → report-generator → script-report.json', () => {
    // 完整生产接线（review 修复）：
    //   真实 visual-diff check（OCR 注入缝）→ CheckResult.structured.uncertain_signals[]
    //   → 真实 report-generator → script-report.json 盘上断言
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maison-uncert-'));
    try {
      const dtDir = path.join(root, 'doc', 'features', 'bank-card', 'device-testing');
      const shotDir = path.join(dtDir, 'device-screenshots');
      const specDir = path.join(root, 'doc', 'features', 'bank-card', 'spec');
      const refDir = path.join(root, 'doc', 'features', 'bank-card', 'spec', 'assets');
      fs.mkdirSync(shotDir, { recursive: true });
      fs.mkdirSync(specDir, { recursive: true });
      fs.mkdirSync(refDir, { recursive: true });
      fs.writeFileSync(path.join(root, 'framework.config.json'), JSON.stringify({
        schema_version: '1.0', project_name: 'demo', project_type: 'app',
        project_profile: { name: 'hmos-app' }, agent_adapter: 'cursor',
        architecture: {
          outer_layers: [{ id: '01-Product', can_depend_on: [], intra_layer_deps: 'forbid' }],
          module_inner_layers: ['shared'], inner_dependency_direction: 'upward',
          cross_module_exports_file: 'index.ets',
        },
        paths: { features_dir: 'doc/features' },
      }, null, 2));
      // spec.md：ui_change + visual_handoff.authoritative_refs（真实可读 ref 图，供 P1-C 对照）
      const refRel = 'doc/features/bank-card/spec/assets/ref-home.png';
      fs.writeFileSync(path.join(refDir, 'ref-home.png'), 'png-bytes');
      fs.writeFileSync(path.join(specDir, 'spec.md'), [
        '```yaml', 'ui_change: new_or_changed', 'visual_handoff:',
        '  kind: authoritative_refs', '  authoritative_refs:',
        `    - id: home`, `      path: ${refRel}`, '```', '',
      ].join('\n'));
      fs.writeFileSync(path.join(dtDir, 'visual-diff.md'), '# diff');
      fs.writeFileSync(path.join(shotDir, 'shot-home.png'), 'png');
      fs.writeFileSync(path.join(specDir, 'ui-spec.yaml'), [
        'schema_version: "1.0"', 'verified: unverified', 'screens:',
        '  - id: home', '    priority: P0', '    ref_id: home',
        '    root:',
        '      type: navigation_frame',
        '      order: 0',
        '      children:',
        '        - id: t1', '          type: content_display', '          order: 0', '          text: 中信银行',
        '        - id: t2', '          type: content_display', '          order: 1', '          text: 添加卡片',
        'tokens: {}', 'assets: []',
      ].join('\n'));
      const { hashScreenshotFile } = require('../../../profiles/hmos-app/harness/visual-diff-check') as {
        hashScreenshotFile: (p: string) => string | null;
      };
      const realShotHash = hashScreenshotFile(path.join(shotDir, 'shot-home.png'));
      assert(!!realShotHash, '截图 hash 可算');
      fs.writeFileSync(path.join(shotDir, 'visual-diff.json'), JSON.stringify({
        schema_version: '1.0',
        screens: [{
          screen_id: 'home', verdict: 'warn', ref_id: 'home',
          screenshot_path: 'doc/features/bank-card/device-testing/device-screenshots/shot-home.png',
          screenshot_hash: realShotHash,
          evaluated_screenshot_hash: realShotHash,
          must_fix: ['修复文案'],
          defects: [{ class: 'shape_mismatch', element: 't1', severity: 'major', note: 'x', bbox: [0.1, 0.2, 0.3, 0.4] }],
        }],
      }, null, 2));
      // OCR 注入缝：ref 图与截图（截图 OCR 把「中信银行」读成「中国银行」→ uncertain）
      const { __testing_setVisualDiffOcrFn, checkVisualDiff } = require('../../../profiles/hmos-app/harness/visual-diff-check') as {
        __testing_setVisualDiffOcrFn: (fn: ((p: string) => unknown) | null) => void;
        checkVisualDiff: (ctx: unknown) => Array<{ id: string; status: string; structured?: { uncertain_signals?: unknown[] } }>;
      };
      const ocrStub = (imgPath: string) => {
        if (String(imgPath).includes('ref-home')) {
          return { ok: true, width: 1320, height: 2120, words: [
            { text: '中信银行', conf: 90, bbox: [0.1, 0.1, 0.4, 0.04] },
            { text: '添加卡片', conf: 90, bbox: [0.1, 0.3, 0.4, 0.04] },
          ] };
        }
        return { ok: true, width: 1320, height: 2120, words: [
          { text: '中国银行', conf: 90, bbox: [0.1, 0.1, 0.4, 0.04] },
          { text: '添加卡片', conf: 90, bbox: [0.1, 0.3, 0.4, 0.04] },
        ] };
      };
      const ctx = {
        phase: 'testing', feature: 'bank-card', projectRoot: root,
        frameworkRoot: path.resolve(__dirname, '..', '..'),
        harnessRoot: path.resolve(__dirname, '..', '..', 'harness'),
        frameworkRel: 'framework', layoutKind: 'flat-submodule',
        phaseRule: {
          phase: 'testing',
          structure_checks: {
            ui_spec_fidelity_gate: { description: 'gate' },
            visual_diff: { description: 'visual diff' },
            asset_acquisition: { description: 'asset acquisition' },
          },
        },
        featureSpec: { feature: 'bank-card' },
        specVisualSources: { external_roots: [], allow_absolute_paths: false, allow_network_paths: false },
      };
      (require('../../../profiles/hmos-app/harness/visual-diff-check') as { __testing_setVisualDiffOcrFn: (f: unknown) => void }).__testing_setVisualDiffOcrFn(ocrStub);
      const rs = checkVisualDiff(ctx as never);
      const vd = rs.find((x) => x.id === 'visual_diff');
      const payload = (vd?.structured ?? {}) as { uncertain_signals?: Array<{ item_fingerprint: string; screen_id: string }> };
      assert((payload.uncertain_signals ?? []).length >= 1,
        `真实 checkVisualDiff 须产 uncertain_signals[]：${JSON.stringify(rs.map((x) => ({ id: x.id, status: x.status })))}`);
      assert(/^[0-9a-f]{64}$/.test(payload.uncertain_signals![0].item_fingerprint), '身份 64-hex');
      assert(payload.uncertain_signals![0].screen_id === 'home', '条目带屏号');
      // 真实 report-generator 落盘
      const { generateScriptReport } = require('../../scripts/utils/report-generator') as {
        generateScriptReport: (
          h: string, p: string, f: string, r: string, c: Array<Record<string, unknown>>, fw?: string,
        ) => { checks: Array<{ id: string; structured?: { uncertain_signals?: unknown[] } }> };
      };
      const report = generateScriptReport(
        path.resolve(__dirname, '..', '..'), 'testing', 'bank-card', root,
        [rs.find((x) => x.id === 'visual_diff') as never],
        path.resolve(__dirname, '..', '..'),
      );
      const persisted = report.checks.find((c) => c.id === 'visual_diff');
      assert((persisted?.structured?.uncertain_signals ?? []).length >= 1,
        'report-generator 落盘须保留 uncertain_signals');
      const onDisk = JSON.parse(fs.readFileSync(
        path.join(root, 'doc', 'features', 'bank-card', 'testing', 'reports', 'script-report.json'),
        'utf-8',
      )) as { checks?: Array<{ id?: string; structured?: { uncertain_signals?: unknown[] } }> };
      assert((onDisk.checks?.find((c) => c.id === 'visual_diff')?.structured?.uncertain_signals ?? []).length >= 1,
        'script-report.json 盘上文件须含 uncertain_signals');
    } finally {
      (require('../../../profiles/hmos-app/harness/visual-diff-check') as { __testing_setVisualDiffOcrFn: (f: unknown) => void }).__testing_setVisualDiffOcrFn(null);
      clearFrameworkConfigCache();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // 标准执行模式：逐条执行并捕获异常（不可只登记 ok:true——那是假 PASS）。
  // 必须位于**全部 run() 注册之后**——注册顺序即执行顺序。
  for (const c of cases) {
    try {
      c.run();
      results.push({ name: c.name, ok: true });
    } catch (err) {
      results.push({ name: c.name, ok: false, error: (err as Error).message });
    }
  }
  return results;
}

if (require.main === module) {
  const results = runAll();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(r.ok ? `PASS ${r.name}` : `FAIL ${r.name}: ${r.error}`);
  }
  process.exit(failed.length > 0 ? 1 : 0);
}