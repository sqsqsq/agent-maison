/**
 * round6 回归夹具单测（plan f2d8c4a6 · P0-A/B/C/E + P2）：
 *   夹具=宿主 homepage goal-run 20260702T061511Z 真实坏态（fixtures/round6，见其 README）。
 *   验收铁律：坏态必 FAIL、正样本必 PASS（FP 校准承重，宁可漏报不可恒误报）。
 *   - P0-A：转置 ui-spec → orientation 预检系统性命中；OCR 交叉校验判"transposed"；
 *           确定性换轴修正版 → OCR 判"as_is"（正样本经 OCR 词框对齐验证，防造样本与判定同轴自洽）。
 *   - P0-B：204×2938 竖条/纯蓝/空白三废图 sanity 必 FAIL；修正 bbox 重裁真图标必 PASS；
 *           sanity 过但缺 VL 辨认 → pending（授权不豁免验真）；VL match / 真人 bbox_verified_by → verified。
 *   - P0-C：user_requirement 授权在、废图已存在 → acquisition 放行裁剪但 asset_crop_validation 仍拦（拆位证明）。
 *   - 物化前置：verdict 缺失/failed → collectUnverifiedCropLines 非空（coding visual_parity_unverified_crop 消费）。
 *   OCR/jimp 实跑用例按仓库惯例以 isOcrAvailable/isJimpAvailable 守卫（仿 ocr-toolkit.unit.test.ts）。
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectTextBboxNodes,
  assessBboxOrientation,
  assessBboxSemantics,
  transposeBbox,
  checkUiSpecBboxSemantic,
  ORIENTATION_MIN_NODES,
  BBOX_MIN_DECISIVE,
} from '../../ui-spec-bbox-semantic';
import {
  classifyCropKind,
  runCropSanity,
  checkAssetCropValidation,
  loadCropValidationVerdicts,
  collectUnverifiedCropLines,
  cropValidationVerdictsAbsPath,
  sha256File,
} from '../../asset-crop-validation';
import { checkAssetAcquisition } from '../../asset-acquisition';
import { isOcrAvailable, ocrImageWords, clusterOcrLines } from '../../ocr-toolkit';
import { isJimpAvailable, cropAssetFromBbox, computeImageStats } from '../../image-toolkit';
import { loadUiSpecFile, type UiSpecDoc } from '../../../../../harness/scripts/utils/ui-spec-shared';
import type { CheckContext, PhaseRuleSpec } from '../../../../../harness/scripts/utils/types';
import type { UnitCaseResult } from '../../../../../harness/tests/run-unit';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'round6');
const TRANSPOSED_SPEC = path.join(FIXTURES, 'transposed-ui-spec.yaml');
const ADD_CARD_JPG = path.join(FIXTURES, 'mockups', 'add_card.jpg');
const BAD_STRIP = path.join(FIXTURES, 'bad-crops', 'ill_card_pack_guide.png');
const BAD_SOLID = path.join(FIXTURES, 'bad-crops', 'icon_header_watch.png');
const BAD_BLANK = path.join(FIXTURES, 'bad-crops', 'icon_category_transit.png');

const cases: Array<{ name: string; run: () => void }> = [];
function test(name: string, run: () => void): void {
  cases.push({ name, run });
}

function loadTransposedDoc(): UiSpecDoc {
  const doc = loadUiSpecFile(TRANSPOSED_SPEC);
  assert.ok(doc, 'round6 转置 ui-spec 夹具须可解析');
  return doc!;
}

/** 确定性换轴：全文档 bbox/source_bbox [y,x,h,w]→[x,y,w,h]（P2 正样本②的运行时制作） */
function axisFixDoc(doc: UiSpecDoc): UiSpecDoc {
  const fixed = JSON.parse(JSON.stringify(doc)) as UiSpecDoc;
  const fixNode = (n: { bbox?: number[]; children?: unknown[] }): void => {
    if (Array.isArray(n.bbox) && n.bbox.length === 4) n.bbox = transposeBbox(n.bbox);
    for (const c of (n.children ?? []) as Array<{ bbox?: number[]; children?: unknown[] }>) fixNode(c);
  };
  for (const s of fixed.screens ?? []) if (s.root) fixNode(s.root);
  for (const t of Object.values(fixed.tokens ?? {})) {
    if (Array.isArray(t.source_bbox) && t.source_bbox.length === 4) t.source_bbox = transposeBbox(t.source_bbox);
  }
  for (const a of fixed.assets ?? []) {
    if (Array.isArray(a.source_bbox) && a.source_bbox.length === 4) a.source_bbox = transposeBbox(a.source_bbox);
  }
  return fixed;
}

// ---- 端到端 ctx/项目脚手架（最小 stub，本组 check 不依赖 resolvedProfile）----

function stubPhaseRule(): PhaseRuleSpec {
  return {
    phase: 'spec',
    structure_checks: {
      ui_spec_bbox_semantic: { description: 'bbox semantic gate' },
      asset_crop_validation: { description: 'crop validation gate' },
      asset_acquisition: { description: 'asset acquisition' },
    },
  } as unknown as PhaseRuleSpec;
}

const SPEC_MD = [
  '# spec',
  '',
  '```yaml',
  'ui_change: new_or_changed',
  'fidelity_target: pixel_1to1',
  'visual_handoff:',
  '  kind: img_dir',
  '  authoritative_refs:',
  '    - id: add_card',
  '      path: doc/refs/add_card.jpg',
  '```',
  '',
].join('\n');

function mkProject(uiSpecYaml: string): { root: string; ctx: CheckContext } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'round6-unit-'));
  const specDir = path.join(root, 'doc', 'features', 'homepage', 'spec');
  fs.mkdirSync(specDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'doc', 'refs'), { recursive: true });
  fs.copyFileSync(ADD_CARD_JPG, path.join(root, 'doc', 'refs', 'add_card.jpg'));
  fs.writeFileSync(path.join(specDir, 'spec.md'), SPEC_MD, 'utf-8');
  fs.writeFileSync(path.join(specDir, 'ui-spec.yaml'), uiSpecYaml, 'utf-8');
  const ctx = {
    phase: 'spec',
    feature: 'homepage',
    projectRoot: root,
    frameworkRoot: root,
    frameworkRel: '.',
    harnessRoot: root,
    layoutKind: 'root',
    phaseRule: stubPhaseRule(),
    featureSpec: { feature: 'homepage' },
    fidelityTarget: 'pixel_1to1',
  } as unknown as CheckContext;
  return { root, ctx };
}

/** 只留 add_card 屏（OCR 夹具屏，spike 实测 7/7 decisive）+ 指定资产子集的 ui-spec 文本 */
function docToYaml(doc: UiSpecDoc): string {
  // 夹具消费方无注释需求，JSON 是合法 YAML——避免引入 dump 依赖
  return JSON.stringify(doc, null, 2);
}

function subsetAddCard(doc: UiSpecDoc, assetKeys: string[]): UiSpecDoc {
  const sub = JSON.parse(JSON.stringify(doc)) as UiSpecDoc;
  sub.screens = (sub.screens ?? []).filter(s => s.id === 'add_card');
  sub.assets = (sub.assets ?? []).filter(a => assetKeys.includes(a.key));
  // 子集屏的 source_ref 统一指到 add_card（夹具只 vendored 这张 mockup）
  for (const a of sub.assets) a.source_ref = 'add_card';
  return sub;
}

// ============================================================
// P0-A 第 0 层：orientation 预检（零依赖，恒跑）
// ============================================================

test('p0a_orientation_bad_state_systematic', () => {
  const nodes = collectTextBboxNodes(loadTransposedDoc());
  assert.ok(nodes.length >= ORIENTATION_MIN_NODES, `文本节点数 ${nodes.length} 应 ≥${ORIENTATION_MIN_NODES}`);
  const o = assessBboxOrientation(nodes);
  assert.ok(o.systematic, `转置坏态应判系统性反常，实际 ${o.anomalous}/${o.eligible}`);
  assert.ok(o.ratio > 0.9, `坏态反常率应接近 100%，实际 ${o.ratio}`);
});

test('p0a_orientation_fixed_state_clean', () => {
  const nodes = collectTextBboxNodes(axisFixDoc(loadTransposedDoc()));
  const o = assessBboxOrientation(nodes);
  assert.ok(!o.systematic, `换轴修正版不应判系统性反常，实际 ${o.anomalous}/${o.eligible}`);
});

test('p0a_orientation_small_sample_no_fire', () => {
  // 少于 ORIENTATION_MIN_NODES 不判（防小样本误报）
  const nodes = collectTextBboxNodes(loadTransposedDoc()).slice(0, ORIENTATION_MIN_NODES - 1);
  const o = assessBboxOrientation(nodes);
  assert.ok(!o.systematic, '样本不足不得判系统性');
});

// ============================================================
// P0-A 第 1 层：OCR 交叉校验（isOcrAvailable 守卫）
// ============================================================

test('p0a_ocr_bad_transposed_fixed_asis', () => {
  if (!isOcrAvailable()) return; // 仓库惯例：OCR 环境缺失跳过（CI 已 vendored chi_sim，正常恒跑）
  const ocr = ocrImageWords(ADD_CARD_JPG);
  assert.ok(ocr.ok && ocr.words, `add_card mockup OCR 应成功：${ocr.error ?? ''}`);
  const lines = clusterOcrLines(ocr.words!.filter(w => w.text.replace(/\s+/g, '').length > 0));

  const badDoc = subsetAddCard(loadTransposedDoc(), []);
  const badNodes = collectTextBboxNodes(badDoc);
  assert.ok(badNodes.length >= BBOX_MIN_DECISIVE, `add_card 屏文本节点 ${badNodes.length} 应 ≥${BBOX_MIN_DECISIVE}`);
  const linesByScreen = new Map([['add_card', lines]]);

  const bad = assessBboxSemantics(badNodes, linesByScreen);
  assert.ok(bad.systematicTransposed, `坏态应判系统性转置（decisive=${bad.decisive}, trans=${bad.transposedCount}, asis=${bad.asIsCount}）`);
  assert.strictEqual(bad.asIsCount, 0, `坏态不应有原语义票（实际 ${bad.asIsCount}——若非 0 说明阈值漂移）`);

  const fixedNodes = collectTextBboxNodes(axisFixDoc(badDoc));
  const fixed = assessBboxSemantics(fixedNodes, linesByScreen);
  assert.ok(fixed.systematicAsIs, `修正版应被 OCR 正面验证（decisive=${fixed.decisive}, asis=${fixed.asIsCount}, trans=${fixed.transposedCount}）`);
  assert.strictEqual(fixed.transposedCount, 0, 'FP 铁律：修正版不得有任何转置票');
});

test('p0a_check_end_to_end_bad_blocker_fixed_pass', () => {
  if (!isOcrAvailable()) return;
  const badDoc = subsetAddCard(loadTransposedDoc(), []);
  {
    const { ctx } = mkProject(docToYaml(badDoc));
    const r = checkUiSpecBboxSemantic(ctx, SPEC_MD);
    const hit = r.find(x => x.id === 'ui_spec_bbox_semantic');
    assert.ok(hit, '应产出 ui_spec_bbox_semantic 结果');
    assert.strictEqual(hit!.status, 'FAIL', `坏态 pixel_1to1 应 FAIL，实际 ${hit!.status}：${hit!.details.slice(0, 200)}`);
    assert.strictEqual(hit!.severity, 'BLOCKER');
    assert.ok(/转置/.test(hit!.details), 'details 应指认转置');
  }
  {
    const { ctx } = mkProject(docToYaml(axisFixDoc(badDoc)));
    const r = checkUiSpecBboxSemantic(ctx, SPEC_MD);
    const hit = r.find(x => x.id === 'ui_spec_bbox_semantic');
    assert.ok(hit, '应产出 ui_spec_bbox_semantic 结果');
    assert.strictEqual(hit!.status, 'PASS', `修正版应 PASS（FP 铁律），实际 ${hit!.status}：${hit!.details.slice(0, 200)}`);
    const toolchain = r.find(x => x.id === 'ui_spec_bbox_semantic_ocr_unavailable');
    assert.ok(!toolchain, '正常 OCR 环境不应报 ocr_unavailable');
  }
});

// ============================================================
// P0-B：确定性 sanity（坏态三废图必 FAIL；重裁正样本必 PASS）
// ============================================================

test('p0b_sanity_strip_fail', () => {
  const r = runCropSanity(BAD_STRIP, classifyCropKind('ill_card_pack_guide'));
  assert.strictEqual(r.status, 'fail', `204×2938 竖条应判废，实际 ${r.status}`);
  assert.ok(r.reasons.some(x => /条状/.test(x)), `应命中条状塌缩：${r.reasons.join(';')}`);
});

test('p0b_sanity_solid_fail', () => {
  if (!isJimpAvailable()) return;
  const r = runCropSanity(BAD_SOLID, classifyCropKind('icon_header_watch'));
  assert.strictEqual(r.status, 'fail', `纯蓝块应判废，实际 ${r.status}: ${r.reasons.join(';')}`);
});

test('p0b_sanity_blank_fail', () => {
  if (!isJimpAvailable()) return;
  const r = runCropSanity(BAD_BLANK, classifyCropKind('icon_category_transit'));
  assert.strictEqual(r.status, 'fail', `空白小图应判废，实际 ${r.status}: ${r.reasons.join(';')}`);
  assert.ok(r.reasons.some(x => /纯色|空白/.test(x)), `应命中纯色/空白：${r.reasons.join(';')}`);
});

test('p0b_sanity_recrop_fixed_bbox_pass', () => {
  if (!isJimpAvailable()) return;
  // P2 正样本③：icon_category_bank 转置声明 [0.28,0.08,0.08,0.10] → 修正 [0.08,0.28,0.10,0.08] 重裁
  const out = path.join(os.tmpdir(), `round6-recrop-${Date.now()}.png`);
  const crop = cropAssetFromBbox(ADD_CARD_JPG, [0.08, 0.28, 0.10, 0.08], out);
  assert.ok(crop.ok, `重裁应成功：${crop.error ?? ''}`);
  try {
    const r = runCropSanity(out, 'icon', { w: 1084, h: 2412 });
    assert.strictEqual(r.status, 'pass', `修正 bbox 重裁的真图标应 PASS（FP 铁律），实际 ${r.status}: ${r.reasons.join(';')}`);
    const stats = computeImageStats(out);
    assert.ok((stats.uniqueColors ?? 0) > 10, `真图标应有丰富内容（实测 uniqueColors=45 量级），实际 ${stats.uniqueColors}`);
  } finally {
    try { fs.unlinkSync(out); } catch { /* ignore */ }
  }
});

test('p0b_kind_classification', () => {
  assert.strictEqual(classifyCropKind('icon_service_huawei_card'), 'icon');
  assert.strictEqual(classifyCropKind('logo_unionpay'), 'icon');
  assert.strictEqual(classifyCropKind('icon_tab_home_active'), 'icon');
  assert.strictEqual(classifyCropKind('ill_card_pack_guide'), 'illustration');
  assert.strictEqual(classifyCropKind('promo_ill_digital_finance'), 'illustration');
});

// ============================================================
// P0-B 端到端 + P0-C 拆位：授权在 ≠ 验真过
// ============================================================

const YAML_LIB = ((): { stringify: (v: unknown) => string } => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('yaml');
})();

test('p0bc_authorized_bad_crop_blocked_by_validation_not_acquisition', () => {
  if (!isJimpAvailable()) return;
  // user_requirement 授权 + 废图已存在：acquisition 不再拦（已存在），但 asset_crop_validation 必拦——授权≠验真
  const badDoc = subsetAddCard(loadTransposedDoc(), ['icon_category_transit']);
  const { root, ctx } = mkProject(docToYaml(badDoc));
  const assetsDir = path.join(root, 'doc', 'features', 'homepage', 'spec', 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.copyFileSync(BAD_BLANK, path.join(assetsDir, 'icon_category_transit.png'));

  const acq = checkAssetAcquisition(ctx);
  assert.ok(!acq.find(x => x.id === 'asset_crop_confirm_required'), 'user_requirement 授权在，acquisition 授权门不应拦');

  const val = checkAssetCropValidation(ctx);
  const fail = val.find(x => x.id === 'asset_crop_validation' && x.status === 'FAIL');
  assert.ok(fail, `废图应被验真门禁拦下（授权不豁免验真）：${JSON.stringify(val.map(v => ({ id: v.id, status: v.status })))}`);
  assert.strictEqual(fail!.severity, 'BLOCKER');

  const verdicts = loadCropValidationVerdicts(root, 'homepage');
  assert.ok(verdicts, '应落盘机器裁决 json');
  assert.strictEqual(verdicts!.entries['icon_category_transit']?.verdict, 'failed');

  const lines = collectUnverifiedCropLines(root, 'homepage', badDoc);
  assert.ok(lines.length > 0, 'coding 物化前置应拿到未验真清单');
});

test('p0b_sanity_pass_but_no_vl_pending_then_verified_paths', () => {
  if (!isJimpAvailable()) return;
  // 好图 + 无 VL 记录 → pending（pixel_1to1 FAIL 不静默放行）；VL match → verified；真人 bbox_verified_by → verified
  const goodCropSrc = path.join(os.tmpdir(), `round6-good-${Date.now()}.png`);
  const crop = cropAssetFromBbox(ADD_CARD_JPG, [0.08, 0.28, 0.10, 0.08], goodCropSrc);
  assert.ok(crop.ok);
  try {
    const mk = (mutate?: (doc: UiSpecDoc) => void, vlYaml?: string) => {
      const doc = subsetAddCard(axisFixDoc(loadTransposedDoc()), ['icon_category_bank']);
      mutate?.(doc);
      const { root, ctx } = mkProject(docToYaml(doc));
      const assetsDir = path.join(root, 'doc', 'features', 'homepage', 'spec', 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.copyFileSync(goodCropSrc, path.join(assetsDir, 'icon_category_bank.png'));
      if (vlYaml) {
        const reportsDir = path.join(root, 'doc', 'features', 'homepage', 'spec', 'reports');
        fs.mkdirSync(reportsDir, { recursive: true });
        fs.writeFileSync(path.join(reportsDir, 'asset-crop-vl.yaml'), vlYaml, 'utf-8');
      }
      return { root, ctx };
    };

    // ① 无 VL 记录 → pending FAIL（pixel_1to1 硬策略）
    {
      const { root, ctx } = mk();
      const r = checkAssetCropValidation(ctx);
      const pending = r.find(x => x.id === 'asset_crop_validation_pending_confirm');
      assert.ok(pending && pending.status === 'FAIL', `缺 VL 记录应 pending FAIL，实际：${JSON.stringify(r.map(v => ({ id: v.id, status: v.status })))}`);
      assert.strictEqual(loadCropValidationVerdicts(root, 'homepage')!.entries['icon_category_bank']?.verdict, 'pending');
    }
    // ② VL match=true → verified PASS
    {
      const vl = YAML_LIB.stringify({ entries: [{ key: 'icon_category_bank', identified_as: '橙色银行卡线性图标', match: true, by: 'vl-isolated' }] });
      const { root, ctx } = mk(undefined, vl);
      const r = checkAssetCropValidation(ctx);
      assert.ok(!r.find(x => x.status === 'FAIL'), `VL match 后不应 FAIL：${JSON.stringify(r.map(v => ({ id: v.id, status: v.status })))}`);
      assert.strictEqual(loadCropValidationVerdicts(root, 'homepage')!.entries['icon_category_bank']?.verdict, 'verified');
    }
    // ③ VL match=false → failed BLOCKER（辨认失配=裁错内容）
    {
      const vl = YAML_LIB.stringify({ entries: [{ key: 'icon_category_bank', identified_as: '公交车图标', match: false, by: 'vl-isolated' }] });
      const { ctx } = mk(undefined, vl);
      const r = checkAssetCropValidation(ctx);
      const fail = r.find(x => x.id === 'asset_crop_validation' && x.status === 'FAIL');
      assert.ok(fail && /失配/.test(fail.details), 'VL 失配应 FAIL 且指认失配');
    }
    // ④ 真人 bbox_verified_by → verified（VL 不可用时的逃生阀）；自动化身份不算
    {
      const { root, ctx } = mk(doc => {
        (doc.assets![0] as { bbox_verified_by?: string }).bbox_verified_by = '张工';
      });
      const r = checkAssetCropValidation(ctx);
      assert.ok(!r.find(x => x.status === 'FAIL'), '真人验真署名应放行');
      assert.strictEqual(loadCropValidationVerdicts(root, 'homepage')!.entries['icon_category_bank']?.verdict, 'verified');
    }
    {
      const { ctx } = mk(doc => {
        (doc.assets![0] as { bbox_verified_by?: string }).bbox_verified_by = 'goal-mode-auto';
      });
      const r = checkAssetCropValidation(ctx);
      const pending = r.find(x => x.id === 'asset_crop_validation_pending_confirm');
      assert.ok(pending, '自动化身份签 bbox_verified_by 不算验真（堵自报）');
    }
  } finally {
    try { fs.unlinkSync(goodCropSrc); } catch { /* ignore */ }
  }
});

// ============================================================
// 物化前置（coding 消费面）：verdict 缺失/未 verified → 非空清单
// ============================================================

// ============================================================
// review 修复回归（codex P1/P2 + cursor FP 出口，2026-07-02）
// ============================================================

test('p0b_vl_selfsign_rejected', () => {
  if (!isJimpAvailable()) return;
  // codex P1：match:true 但署名为自动化自报/缺失 → pending，不得 verified
  const goodCropSrc = path.join(os.tmpdir(), `round6-selfsign-${Date.now()}.png`);
  assert.ok(cropAssetFromBbox(ADD_CARD_JPG, [0.08, 0.28, 0.10, 0.08], goodCropSrc).ok);
  try {
    for (const by of ['goal-mode-auto', undefined]) {
      const doc = subsetAddCard(axisFixDoc(loadTransposedDoc()), ['icon_category_bank']);
      const { root, ctx } = mkProject(docToYaml(doc));
      const assetsDir = path.join(root, 'doc', 'features', 'homepage', 'spec', 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.copyFileSync(goodCropSrc, path.join(assetsDir, 'icon_category_bank.png'));
      const reportsDir = path.join(root, 'doc', 'features', 'homepage', 'spec', 'reports');
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(
        path.join(reportsDir, 'asset-crop-vl.yaml'),
        YAML_LIB.stringify({ entries: [{ key: 'icon_category_bank', identified_as: '银行卡图标', match: true, ...(by ? { by } : {}) }] }),
        'utf-8',
      );
      const r = checkAssetCropValidation(ctx);
      const pending = r.find(x => x.id === 'asset_crop_validation_pending_confirm');
      assert.ok(pending && pending.status === 'FAIL', `by=${by ?? '缺失'} 的 match:true 应 pending（自签不算），实际：${JSON.stringify(r.map(v => ({ id: v.id, status: v.status })))}`);
      assert.strictEqual(loadCropValidationVerdicts(root, 'homepage')!.entries['icon_category_bank']?.verdict, 'pending');
    }
  } finally {
    try { fs.unlinkSync(goodCropSrc); } catch { /* ignore */ }
  }
});

test('p0b_human_overrule_sanity_fail', () => {
  // cursor FP 出口：真人 bbox_verified_by 可翻案 sanity 启发阈值误伤（如合法超长横幅）；自动化署名不能翻
  const mk = (signer: string) => {
    const doc = subsetAddCard(loadTransposedDoc(), ['icon_category_transit']);
    (doc.assets![0] as { bbox_verified_by?: string }).bbox_verified_by = signer;
    const { root, ctx } = mkProject(docToYaml(doc));
    const assetsDir = path.join(root, 'doc', 'features', 'homepage', 'spec', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.copyFileSync(BAD_STRIP, path.join(assetsDir, 'icon_category_transit.png')); // 条状 sanity 必 fail
    return { root, ctx };
  };
  {
    const { root, ctx } = mk('张工');
    const r = checkAssetCropValidation(ctx);
    assert.ok(!r.find(x => x.status === 'FAIL'), `真人翻案后不应 FAIL：${JSON.stringify(r.map(v => ({ id: v.id, status: v.status })))}`);
    const entry = loadCropValidationVerdicts(root, 'homepage')!.entries['icon_category_transit'];
    assert.strictEqual(entry?.verdict, 'verified');
    assert.ok((entry?.reasons ?? []).some(x => /翻案/.test(x)), '翻案须留痕（reasons 记录 sanity 原判）');
  }
  {
    const { ctx } = mk('goal-mode-auto');
    const r = checkAssetCropValidation(ctx);
    assert.ok(r.find(x => x.id === 'asset_crop_validation' && x.status === 'FAIL'), '自动化署名不能翻案 sanity');
  }
});

test('p0b_stale_verdict_binding_rejected', () => {
  if (!isJimpAvailable()) return;
  // codex P2：verified 裁决与产物内容/声明绑定——重裁换图/改 source_bbox 后旧 verified 不放行
  const goodCropSrc = path.join(os.tmpdir(), `round6-bind-${Date.now()}.png`);
  assert.ok(cropAssetFromBbox(ADD_CARD_JPG, [0.08, 0.28, 0.10, 0.08], goodCropSrc).ok);
  try {
    const doc = subsetAddCard(axisFixDoc(loadTransposedDoc()), ['icon_category_bank']);
    const { root, ctx } = mkProject(docToYaml(doc));
    const assetsDir = path.join(root, 'doc', 'features', 'homepage', 'spec', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const cropAbs = path.join(assetsDir, 'icon_category_bank.png');
    fs.copyFileSync(goodCropSrc, cropAbs);
    const reportsDir = path.join(root, 'doc', 'features', 'homepage', 'spec', 'reports');
    fs.mkdirSync(reportsDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportsDir, 'asset-crop-vl.yaml'),
      YAML_LIB.stringify({ entries: [{ key: 'icon_category_bank', identified_as: '银行卡图标', match: true, by: 'vl-isolated' }] }),
      'utf-8',
    );
    const r = checkAssetCropValidation(ctx);
    assert.ok(!r.find(x => x.status === 'FAIL'), '前置：验真应通过');
    // 绑定一致 → 放行
    assert.strictEqual(collectUnverifiedCropLines(root, 'homepage', doc).length, 0, '绑定一致应放行');
    // ① 产物内容变化 → 拦
    fs.copyFileSync(BAD_BLANK, cropAbs);
    let lines = collectUnverifiedCropLines(root, 'homepage', doc);
    assert.ok(lines.length === 1 && /sha256|内容已变化/.test(lines[0]), `换图后应拦：${lines.join('|')}`);
    fs.copyFileSync(goodCropSrc, cropAbs);
    // ② source_bbox 变更 → 拦
    const doc2 = JSON.parse(JSON.stringify(doc)) as UiSpecDoc;
    doc2.assets![0].source_bbox = [0.5, 0.5, 0.1, 0.1];
    lines = collectUnverifiedCropLines(root, 'homepage', doc2);
    assert.ok(lines.length === 1 && /source_bbox/.test(lines[0]), `改 bbox 后应拦：${lines.join('|')}`);
    // ③ 模块 media 物化副本 hash 不一致 → 拦；一致 → 放行
    const contracts = { modules: [{ package_path: 'mod' }] } as unknown as NonNullable<CheckContext['featureSpec']['contracts']>;
    const mediaDir = path.join(root, 'mod', 'src', 'main', 'resources', 'base', 'media');
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.copyFileSync(BAD_BLANK, path.join(mediaDir, 'icon_category_bank.png'));
    lines = collectUnverifiedCropLines(root, 'homepage', doc, { contracts });
    assert.ok(lines.length === 1 && /物化副本/.test(lines[0]), `media 副本被换应拦：${lines.join('|')}`);
    fs.copyFileSync(goodCropSrc, path.join(mediaDir, 'icon_category_bank.png'));
    assert.strictEqual(collectUnverifiedCropLines(root, 'homepage', doc, { contracts }).length, 0, 'media 副本一致应放行');
  } finally {
    try { fs.unlinkSync(goodCropSrc); } catch { /* ignore */ }
  }
});

test('materialize_gate_missing_report_blocks_all', () => {
  const doc = subsetAddCard(loadTransposedDoc(), ['icon_category_bank', 'icon_category_transit']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'round6-mat-'));
  const lines = collectUnverifiedCropLines(root, 'homepage', doc);
  assert.strictEqual(lines.length, 1, '报告缺失应产出整组未验真提示');
  assert.ok(/未跑 asset_crop_validation/.test(lines[0]));
});

test('materialize_gate_requires_full_binding', () => {
  // codex 二轮 P1：最小 verified（缺 sha256/resolved_path/source_bbox 绑定）＝旧格式/手写裁决，必须拦；
  // 绑定字段齐全且与当前产物/声明一致才放行。
  const doc = subsetAddCard(loadTransposedDoc(), ['icon_category_bank']);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'round6-mat2-'));
  const verdictAbs = cropValidationVerdictsAbsPath(root, 'homepage');
  fs.mkdirSync(path.dirname(verdictAbs), { recursive: true });

  // ① 缺绑定字段的最小 verified → 拦
  fs.writeFileSync(verdictAbs, JSON.stringify({
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    entries: { icon_category_bank: { verdict: 'verified', kind: 'icon' } },
  }), 'utf-8');
  let lines = collectUnverifiedCropLines(root, 'homepage', doc);
  assert.ok(lines.length === 1 && /缺绑定字段/.test(lines[0]), `最小 verified 应被拦：${lines.join('|')}`);

  // ② 绑定字段齐全且一致 → 放行
  const rel = 'doc/features/homepage/spec/assets/icon_category_bank.png';
  const cropAbs = path.join(root, rel);
  fs.mkdirSync(path.dirname(cropAbs), { recursive: true });
  fs.copyFileSync(BAD_BLANK, cropAbs); // 内容无所谓，绑定只看 hash 一致
  fs.writeFileSync(verdictAbs, JSON.stringify({
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    entries: {
      icon_category_bank: {
        verdict: 'verified',
        kind: 'icon',
        sha256: sha256File(cropAbs),
        resolved_path: rel,
        source_bbox: doc.assets![0].source_bbox,
      },
    },
  }), 'utf-8');
  lines = collectUnverifiedCropLines(root, 'homepage', doc);
  assert.strictEqual(lines.length, 0, `完整绑定且一致应放行：${lines.join('|')}`);
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
