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

// ============================================================
// Phase 2（P0-D / P1-A / P1-B）：完整性外部对照、结构 lint、文案白名单、render 升级、review 视觉维度
// ============================================================

import {
  checkCaptureExternalAudit,
  checkUiSpecStructureLint,
  collectSpecTextUniverse,
  isLineCoveredBySpecTexts,
} from '../../capture-completeness-check';
import {
  collectVisibleTextIssues,
  collectRenderFaithfulnessIssues,
  collectInvisiblePresenceIssues,
  chainIsHardInvisible,
  extractComponentChain,
} from '../../visual-parity-backstop';
import { checkVisualFidelityReview } from '../../../../../harness/scripts/check-review';

const MINE_ETS = path.join(FIXTURES, 'source', 'MineTabPage.ets.txt');
const GUIDE_ETS = path.join(FIXTURES, 'source', 'CardGuideSection.ets.txt');
const STRING_JSON = path.join(FIXTURES, 'source', 'string.json.txt');

test('p0d_line_cover_units', () => {
  const spec = ['集中管理您的卡证票券钥匙', '添加管理卡片', '卡包'];
  // OCR 常把同 y 带两个元素聚成一行——联合覆盖须命中
  assert.ok(isLineCoveredBySpecTexts('集中管理您的卡证票券钥匙添加管理卡片', spec), '聚合行应被联合覆盖');
  assert.ok(isLineCoveredBySpecTexts('卡包', spec), '短行子串应覆盖');
  assert.ok(!isLineCoveredBySpecTexts('金融信息', spec), '原图外文本不得被覆盖');
  assert.ok(!isLineCoveredBySpecTexts('银行卡/交通卡/门禁卡等', spec), '漏抽副标题不得被覆盖');
});

test('p0d_external_audit_missed_text_fail_full_capture_pass', () => {
  if (!isOcrAvailable()) return;
  // 坏态：spec 文本集刻意缺失（只留 2 条）→ 原图 OCR 大量行未覆盖 → FAIL
  const badDoc = subsetAddCard(axisFixDoc(loadTransposedDoc()), []);
  for (const s of badDoc.screens ?? []) {
    if (s.root?.children) s.root.children = s.root.children.filter(c => ['add_card_nav_title', 'add_card_bank'].includes(c.id ?? ''));
  }
  {
    const { ctx } = mkProject(docToYaml(badDoc));
    const r = checkCaptureExternalAudit(ctx, SPEC_MD);
    const hit = r.find(x => x.id === 'capture_completeness_external');
    assert.ok(hit && hit.status === 'FAIL' && hit.severity === 'BLOCKER',
      `漏抽应 FAIL：${JSON.stringify(r.map(v => ({ id: v.id, status: v.status })))}`);
    assert.ok(/未被 spec 捕获/.test(hit!.details));
  }
  // 正样本：把原图 OCR 全部行文本塞进 ref-elements 当分母 → 全覆盖 PASS（FP 铁律）
  {
    const fullDoc = subsetAddCard(axisFixDoc(loadTransposedDoc()), []);
    const { root, ctx } = mkProject(docToYaml(fullDoc));
    const ocr = ocrImageWords(ADD_CARD_JPG);
    assert.ok(ocr.ok && ocr.words);
    const lines = clusterOcrLines(ocr.words!.filter(w => w.text.replace(/\s+/g, '').length > 0));
    const refEls = lines.map((l, i) => ({ element_id: `ocr_line_${i}`, text: l.text, disposition: 'implement' }));
    fs.writeFileSync(
      path.join(root, 'doc', 'features', 'homepage', 'spec', 'ref-elements.yaml'),
      YAML_LIB.stringify({ schema_version: '1.0', elements: refEls }),
      'utf-8',
    );
    const r = checkCaptureExternalAudit(ctx, SPEC_MD);
    const hit = r.find(x => x.id === 'capture_completeness_external');
    assert.ok(hit && hit.status === 'PASS', `全捕获应 PASS（FP 铁律）：${hit?.details.slice(0, 300)}`);
  }
});

test('p0d_structure_lint_flat_list_and_subtitle', () => {
  const mkDoc = (mutate: (doc: UiSpecDoc) => void): UiSpecDoc => {
    const doc: UiSpecDoc = {
      schema_version: '1.0',
      screens: [{
        id: 's1', priority: 'P0', ref_id: 'add_card',
        root: {
          type: 'navigation_frame', order: 0,
          children: [
            { type: 'list_selection', order: 0, id: 'r1', text: '银行卡' },
            { type: 'list_selection', order: 1, id: 'r2', text: '交通卡' },
            { type: 'list_selection', order: 2, id: 'r3', text: '门禁卡' },
            { type: 'list_selection', order: 3, id: 'r4', text: '车钥匙' },
          ],
        },
      }],
      tokens: {}, assets: [],
    } as unknown as UiSpecDoc;
    mutate(doc);
    return doc;
  };
  const runLint = (doc: UiSpecDoc) => {
    const { ctx } = mkProject(docToYaml(doc));
    return checkUiSpecStructureLint(ctx, SPEC_MD);
  };
  // 坏态①：≥3 连续 list_selection 平铺在 root → FAIL
  {
    const r = runLint(mkDoc(() => { /* as-is */ }));
    const hit = r.find(x => x.id === 'ui_spec_structure_lint');
    assert.ok(hit && hit.status === 'FAIL', `平铺应 FAIL：${hit?.details.slice(0, 200)}`);
    assert.ok(/分组容器/.test(hit!.details));
  }
  // 正样本①：逐节点声明 layout_group → PASS
  {
    const r = runLint(mkDoc(doc => {
      for (const c of doc.screens[0].root!.children!) (c as { layout_group?: string }).layout_group = 'card_categories';
    }));
    assert.strictEqual(r.find(x => x.id === 'ui_spec_structure_lint')?.status, 'PASS');
  }
  // 正样本②：包进 bg_color 分组容器 → PASS
  {
    const r = runLint(mkDoc(doc => {
      const rows = doc.screens[0].root!.children!;
      doc.screens[0].root!.children = [
        { type: 'content_display', order: 0, id: 'group_card', bg_color: 'card.bg', children: rows } as never,
      ];
    }));
    assert.strictEqual(r.find(x => x.id === 'ui_spec_structure_lint')?.status, 'PASS');
  }
  // 坏态②：subtitle 无 subtitle_position → FAIL；显式 trailing → PASS
  {
    const r = runLint(mkDoc(doc => {
      const c = doc.screens[0].root!.children![0] as { subtitle?: string; layout_group?: string };
      c.subtitle = '银行卡/交通卡/门禁卡等';
      for (const n of doc.screens[0].root!.children!) (n as { layout_group?: string }).layout_group = 'g';
    }));
    const hit = r.find(x => x.id === 'ui_spec_structure_lint');
    assert.ok(hit && hit.status === 'FAIL' && /subtitle_position/.test(hit.details), 'subtitle 缺位置声明应 FAIL');
  }
  {
    const r = runLint(mkDoc(doc => {
      const c = doc.screens[0].root!.children![0] as { subtitle?: string; subtitle_position?: string };
      c.subtitle = '银行卡/交通卡/门禁卡等';
      c.subtitle_position = 'trailing';
      for (const n of doc.screens[0].root!.children!) (n as { layout_group?: string }).layout_group = 'g';
    }));
    assert.strictEqual(r.find(x => x.id === 'ui_spec_structure_lint')?.status, 'PASS');
  }
  // 坏态③：global bottom_tab 容器无 bg_color → FAIL
  {
    const r = runLint(mkDoc(doc => {
      for (const n of doc.screens[0].root!.children!) (n as { layout_group?: string }).layout_group = 'g';
      (doc as { global_elements?: unknown[] }).global_elements = [
        { id: 'bottom_tab', texts: ['首页', '我的'], owner_screen_ids: ['s1'] },
      ];
      doc.screens[0].root!.children!.push({ type: 'navigation_frame', order: 9, id: 'bottom_tab' } as never);
    }));
    const hit = r.find(x => x.id === 'ui_spec_structure_lint');
    assert.ok(hit && hit.status === 'FAIL' && /bottom_tab/.test(hit.details), '浮动 tab 无容器 bg 应 FAIL');
  }
});

test('p1a_visible_text_whitelist_fabricated_titles', () => {
  // 坏态=round6 真实脑补：MineTabPage 引用 string.json 的 finance_section_title/settings_section_title
  const setup = (extraSpecTexts: string[], exemptions?: Array<{ text: string; rationale?: string }>) => {
    const { root, ctx } = mkProject(docToYaml(subsetAddCard(axisFixDoc(loadTransposedDoc()), [])));
    const etsDir = path.join(root, 'mod', 'src', 'main', 'ets', 'pages');
    fs.mkdirSync(etsDir, { recursive: true });
    fs.copyFileSync(MINE_ETS, path.join(etsDir, 'MineTabPage.ets'));
    const resDir = path.join(root, 'mod', 'src', 'main', 'resources', 'base', 'element');
    fs.mkdirSync(resDir, { recursive: true });
    fs.copyFileSync(STRING_JSON, path.join(resDir, 'string.json'));
    if (exemptions) {
      const exDir = path.join(root, 'doc', 'features', 'homepage', 'coding');
      fs.mkdirSync(exDir, { recursive: true });
      fs.writeFileSync(path.join(exDir, 'visible-text-exemptions.yaml'), YAML_LIB.stringify({ entries: exemptions }), 'utf-8');
    }
    (ctx as { featureSpec: { contracts?: unknown } }).featureSpec.contracts = { modules: [{ name: 'mod', package_path: 'mod' }] };
    // spec 文本集 = string.json 全部值（模拟"原图有这些文案"）除脑补两条 + 额外
    const all = JSON.parse(fs.readFileSync(STRING_JSON, 'utf-8')) as { string: Array<{ name: string; value: string }> };
    const specTexts = all.string
      .filter(s => !['finance_section_title', 'settings_section_title'].includes(s.name))
      .map(s => s.value)
      .concat(extraSpecTexts);
    return { ctx, specTexts };
  };
  // 坏态：脑补两标题被拦，且不误伤其它合法文案
  {
    const { ctx, specTexts } = setup([]);
    const issues = collectVisibleTextIssues(ctx, specTexts, false);
    const texts = issues.map(i => i.detail).join('\n');
    assert.ok(/金融信息/.test(texts) && /设置与帮助/.test(texts), `应拦脑补标题：${texts.slice(0, 300)}`);
    assert.strictEqual(issues.length, 2, `不得误伤合法文案（实际 ${issues.length}）：${texts.slice(0, 400)}`);
  }
  // 正样本：文本进 spec 集 → 0 违规（FP 铁律）
  {
    const { ctx, specTexts } = setup(['金融信息', '设置与帮助']);
    assert.strictEqual(collectVisibleTextIssues(ctx, specTexts, false).length, 0);
  }
  // 豁免表带 rationale → 放行；无 rationale → 不生效
  {
    const { ctx, specTexts } = setup([], [
      { text: '金融信息', rationale: '产品确认的分组标题（非原图，功能必需）' },
      { text: '设置与帮助', rationale: '同上' },
    ]);
    assert.strictEqual(collectVisibleTextIssues(ctx, specTexts, false).length, 0, '带理由豁免应放行');
  }
  {
    const { ctx, specTexts } = setup([], [{ text: '金融信息' }, { text: '设置与帮助' }]);
    assert.strictEqual(collectVisibleTextIssues(ctx, specTexts, false).length, 2, '无 rationale 豁免不生效（自报不算）');
  }
});

test('p1a_render_fullwidth_detected_on_vendored_source', () => {
  // round6 真实坏态源码：CardGuideSection Button .width('100%') vs spec 声明 width_ratio 0.28 + align end
  const { root, ctx } = mkProject(docToYaml((() => {
    const doc = subsetAddCard(axisFixDoc(loadTransposedDoc()), []);
    doc.screens[0].root!.children = [{
      type: 'action_button', order: 0, id: 'card_pack_add_btn',
      text: '添加管理卡片', variant: 'tonal', width_ratio: 0.28, align: 'end',
    } as never];
    (doc as { verified?: string }).verified = 'verified';
    return doc;
  })()));
  const etsDir = path.join(root, 'mod', 'src', 'main', 'ets', 'components');
  fs.mkdirSync(etsDir, { recursive: true });
  fs.copyFileSync(GUIDE_ETS, path.join(etsDir, 'CardGuideSection.ets'));
  const planDir = path.join(root, 'doc', 'features', 'homepage', 'plan');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(
    path.join(planDir, 'visual-parity.yaml'),
    YAML_LIB.stringify({ components: [{ ui_spec_node_id: 'card_pack_add_btn', contract_component: 'CardGuideSection' }] }),
    'utf-8',
  );
  (ctx as { featureSpec: { contracts?: unknown } }).featureSpec.contracts = { modules: [{ name: 'mod', package_path: 'mod' }] };
  const doc = loadUiSpecFile(path.join(root, 'doc', 'features', 'homepage', 'spec', 'ui-spec.yaml'))!;
  const issues = collectRenderFaithfulnessIssues(ctx, doc, false);
  assert.ok(issues.length >= 1 && /全宽/.test(issues[0].detail),
    `应检出按钮全宽违规（round6 坏态）：${JSON.stringify(issues.map(i => i.detail))}`);
});

test('p0d_external_audit_p0_screen_unaudited_blocks', () => {
  if (!isOcrAvailable()) return;
  // codex 二轮 P1：两屏一成一败仍阻断——未审计 P0 屏的外部分母完全没建立，不得被其它屏的通过豁免
  const mkTwoScreens = (unauditedPriority: 'P0' | 'P1') => {
    const doc = subsetAddCard(axisFixDoc(loadTransposedDoc()), []);
    doc.screens.push({
      id: 'ghost_screen', priority: unauditedPriority, ref_id: 'no_such_ref',
      root: { type: 'navigation_frame', order: 0, children: [] },
    } as never);
    const { root, ctx } = mkProject(docToYaml(doc));
    // add_card 屏全覆盖（OCR 行全塞进 ref-elements）——只剩 ghost_screen 无法审计
    const ocr = ocrImageWords(ADD_CARD_JPG);
    const lines = clusterOcrLines(ocr.words!.filter(w => w.text.replace(/\s+/g, '').length > 0));
    fs.writeFileSync(
      path.join(root, 'doc', 'features', 'homepage', 'spec', 'ref-elements.yaml'),
      YAML_LIB.stringify({ schema_version: '1.0', elements: lines.map((l, i) => ({ element_id: `l${i}`, text: l.text, disposition: 'implement' })) }),
      'utf-8',
    );
    return checkCaptureExternalAudit(ctx, SPEC_MD);
  };
  {
    const r = mkTwoScreens('P0');
    const hit = r.find(x => x.id === 'capture_completeness_external_ocr_unavailable');
    assert.ok(hit && hit.status === 'FAIL' && /P0 屏外部分母缺失/.test(hit.details),
      `P0 屏未审计应 FAIL：${JSON.stringify(r.map(v => ({ id: v.id, status: v.status })))}`);
  }
  {
    const r = mkTwoScreens('P1');
    const hit = r.find(x => x.id === 'capture_completeness_external');
    assert.ok(hit && hit.status === 'PASS', `P1 屏未审计应降为注记不阻断：${JSON.stringify(r.map(v => ({ id: v.id, status: v.status })))}`);
    assert.ok(/部分屏未审计/.test(hit!.details));
  }
});

test('p0d_structure_lint_missing_global_container_node', () => {
  // codex 二轮 P1：global_elements 声明了 bottom_tab 但组件树无对应容器节点 → 必拦（round6 tab 崩坏形态）
  const doc: UiSpecDoc = {
    schema_version: '1.0',
    global_elements: [{ id: 'bottom_tab', texts: ['首页', '我的'], owner_screen_ids: ['s1'] }],
    screens: [{
      id: 's1', priority: 'P0', ref_id: 'add_card',
      root: { type: 'navigation_frame', order: 0, children: [{ type: 'content_display', order: 0, id: 'title', text: '钱包' }] },
    }],
    tokens: {}, assets: [],
  } as unknown as UiSpecDoc;
  const { ctx } = mkProject(docToYaml(doc));
  const r = checkUiSpecStructureLint(ctx, SPEC_MD);
  const hit = r.find(x => x.id === 'ui_spec_structure_lint');
  assert.ok(hit && hit.status === 'FAIL' && /无对应容器节点/.test(hit.details),
    `缺容器节点应 FAIL：${hit?.details.slice(0, 200)}`);
});

test('p1a_exemption_asymmetric_no_umbrella', () => {
  if (!fs.existsSync(MINE_ETS)) return;
  // cursor 意见采纳：宽豁免（「设置」）不得连带掩盖脑补长标题（「设置与帮助」）
  const { root, ctx } = (() => {
    const { root, ctx } = mkProject(docToYaml(subsetAddCard(axisFixDoc(loadTransposedDoc()), [])));
    const etsDir = path.join(root, 'mod', 'src', 'main', 'ets', 'pages');
    fs.mkdirSync(etsDir, { recursive: true });
    fs.copyFileSync(MINE_ETS, path.join(etsDir, 'MineTabPage.ets'));
    const resDir = path.join(root, 'mod', 'src', 'main', 'resources', 'base', 'element');
    fs.mkdirSync(resDir, { recursive: true });
    fs.copyFileSync(STRING_JSON, path.join(resDir, 'string.json'));
    const exDir = path.join(root, 'doc', 'features', 'homepage', 'coding');
    fs.mkdirSync(exDir, { recursive: true });
    fs.writeFileSync(path.join(exDir, 'visible-text-exemptions.yaml'),
      YAML_LIB.stringify({ entries: [{ text: '设置', rationale: '宽豁免测试' }] }), 'utf-8');
    (ctx as { featureSpec: { contracts?: unknown } }).featureSpec.contracts = { modules: [{ name: 'mod', package_path: 'mod' }] };
    return { root, ctx };
  })();
  void root;
  const all = JSON.parse(fs.readFileSync(STRING_JSON, 'utf-8')) as { string: Array<{ name: string; value: string }> };
  const specTexts = all.string
    .filter(s => !['finance_section_title', 'settings_section_title'].includes(s.name))
    .map(s => s.value);
  const issues = collectVisibleTextIssues(ctx, specTexts, false);
  assert.ok(issues.some(i => /设置与帮助/.test(i.detail)), `豁免「设置」不得掩盖「设置与帮助」：${issues.map(i => i.detail).join('|').slice(0, 300)}`);
});

test('invisible_presence_chain_units', () => {
  // 链判定单元：字面硬不可见三态 + 合法形态不误伤
  assert.ok(chainIsHardInvisible('.fontSize(1).opacity(0)'), 'opacity(0) 必中');
  assert.ok(chainIsHardInvisible('.width(0).height(0).opacity(0)'), '三连零必中');
  assert.ok(chainIsHardInvisible('.visibility(Visibility.None)'), 'Visibility.None 必中');
  assert.strictEqual(chainIsHardInvisible('.opacity(this.fade)'), null, '变量绑定不判（动画合法）');
  assert.strictEqual(chainIsHardInvisible('.opacity(0.5)'), null, '半透明不判');
  assert.strictEqual(chainIsHardInvisible('.width(0)'), null, '单维零不判（折叠布局合法）');
  // 链提取：跨行链 + 字符串内括号不干扰
  const src = `Image($r('app.media.x'))\n  .width(0)\n  .height(0)\n  .opacity(0)\nText('好的(备注)')`;
  const { args, chain } = extractComponentChain(src, 0);
  assert.ok(/app\.media\.x/.test(args) && chainIsHardInvisible(chain), `跨行链应完整提取：${chain}`);
});

test('invisible_presence_comment_and_string_aware', () => {
  // codex P2 采纳：注释/字符串里的"假代码"不判；注释断链不能成为逃逸口；真实 CJK 字面量仍可判
  const mkOne = (ets: string) => {
    const { root, ctx } = mkProject(docToYaml(subsetAddCard(axisFixDoc(loadTransposedDoc()), [])));
    const etsDir = path.join(root, 'mod', 'src', 'main', 'ets', 'pages');
    fs.mkdirSync(etsDir, { recursive: true });
    fs.writeFileSync(path.join(etsDir, 'X.ets'), ets, 'utf-8');
    (ctx as { featureSpec: { contracts?: unknown } }).featureSpec.contracts = { modules: [{ name: 'mod', package_path: 'mod' }] };
    return collectInvisiblePresenceIssues(ctx);
  };
  // ① 行注释/块注释/字符串里的假代码 → 0（此前会误判 BLOCKER）
  assert.strictEqual(mkOne([
    "// Text($r('app.string.tab_home')).opacity(0)",
    "/* Image($r('app.media.y')).width(0).height(0).opacity(0) */",
    "const s = \"Text($r('app.string.x')).opacity(0)\";",
  ].join('\n')).length, 0, '注释/字符串内假代码不得误报');
  // ② 注释断链逃逸不了：链段之间夹注释仍完整提取
  assert.strictEqual(mkOne([
    "Text($r('app.string.tab_home')) // presence",
    "  .fontSize(1) /* keep */",
    "  .opacity(0)",
  ].join('\n')).length, 1, '注释夹在链中不得断链逃逸');
  // ③ 真实 CJK 字面量透明挂载仍可判（不因字符串感知而漏检——起点在代码区、参数原样切片）
  assert.strictEqual(mkOne("Text('首页').opacity(0)").length, 1, 'CJK 字面量透明挂载仍须命中');
});

test('invisible_presence_host_cheat_fixtures_fail_clean_pass', () => {
  // 坏态=宿主实锤作弊源码（bottomTabPresence 透明文本 / 三连零 Image / 透明 SymbolGlyph）；
  // 正样本=干净组件（CardGuideSection，真实渲染）零误报（FP 铁律）
  const { root, ctx } = mkProject(docToYaml(subsetAddCard(axisFixDoc(loadTransposedDoc()), [])));
  const etsDir = path.join(root, 'mod', 'src', 'main', 'ets', 'pages');
  fs.mkdirSync(etsDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'source', 'HomeTabPage-invisible-cheat.ets.txt'), path.join(etsDir, 'HomeTabPage.ets'));
  fs.copyFileSync(path.join(FIXTURES, 'source', 'ServiceGridSwiper-invisible-cheat.ets.txt'), path.join(etsDir, 'ServiceGridSwiper.ets'));
  fs.copyFileSync(GUIDE_ETS, path.join(etsDir, 'CardGuideSection.ets'));
  (ctx as { featureSpec: { contracts?: unknown } }).featureSpec.contracts = { modules: [{ name: 'mod', package_path: 'mod' }] };

  const issues = collectInvisiblePresenceIssues(ctx);
  const byFile = (f: string) => issues.filter(i => i.id === f).length;
  assert.ok(byFile('HomeTabPage.ets') >= 3, `HomeTabPage 作弊应命中 ≥3（透明 tab 文本×2 + 零尺寸 plus 图）：${byFile('HomeTabPage.ets')}`);
  assert.ok(byFile('ServiceGridSwiper.ets') >= 4, `Swiper 作弊应命中 ≥4（透明 Symbol/Image 一串）：${byFile('ServiceGridSwiper.ets')}`);
  assert.strictEqual(byFile('CardGuideSection.ets'), 0, `干净组件零误报（FP 铁律）：${JSON.stringify(issues.filter(i => i.id === 'CardGuideSection.ets').map(i => i.detail))}`);
});

test('p1b_visual_fidelity_review_evidence_gate', () => {
  const { ctx } = mkProject(docToYaml(subsetAddCard(axisFixDoc(loadTransposedDoc()), [])));
  (ctx as { phaseRule: unknown }).phaseRule = {
    phase: 'review',
    structure_checks: { visual_fidelity_review: { description: 'visual fidelity review dimension' } },
  };
  // 坏态：round5 式五维报告（无视觉维度）→ pixel_1to1 FAIL
  {
    const report = '# review\n## 审查方法\n架构/分层/接口/资源/命名\n## 结论\n有条件通过';
    const r = checkVisualFidelityReview(ctx, report);
    const hit = r.find(x => x.id === 'visual_fidelity_review');
    assert.ok(hit && hit.status === 'FAIL' && hit.severity === 'BLOCKER', `无视觉维度应 FAIL：${hit?.status}`);
  }
  // 有维度但证据不全（pixel_1to1 全覆盖不许抽查）→ FAIL
  {
    const report = '# review\n## 视觉保真\n核对了 asset-crop-validation.json 全部 verified。\n## 结论\n通过';
    const r = checkVisualFidelityReview(ctx, report);
    const hit = r.find(x => x.id === 'visual_fidelity_review');
    assert.ok(hit && hit.status === 'FAIL' && /缺证据引用/.test(hit.details), '证据不全应 FAIL');
  }
  // P1-4②（c9e2a7f4 子批B）：结构类证据升级为台账逐条复核——仅提声明字段名（旧口径）不再算数
  {
    const report = [
      '# review', '## 视觉保真',
      '- 素材：asset-crop-validation.json 8/8 verified，contact-sheet 逐张人核一致',
      '- 可见文案：visible_text_whitelist 无违规，豁免表为空',
      '- 结构：subtitle_position/layout_group 与原图对照一致，分组容器齐', // 旧式泛引用，无台账
      '- must_have 全部有真实承载（消费 visual_parity 结果）',
      '## 结论\n通过',
    ].join('\n');
    const r = checkVisualFidelityReview(ctx, report);
    const hit = r.find(x => x.id === 'visual_fidelity_review');
    assert.ok(hit && hit.status === 'FAIL' && /structure-conformance|台账/.test(hit.details), '缺台账引用应 FAIL（P1-4②）');
  }
  // 四类证据全引用（含台账逐条复核）→ PASS
  {
    const report = [
      '# review', '## 视觉保真',
      '- 素材：asset-crop-validation.json 8/8 verified，contact-sheet 逐张人核一致',
      '- 可见文案：visible_text_whitelist 无违规，豁免表为空',
      '- 结构声明台账：structure-conformance.yaml 5/5 逐条打开 implemented_by 源码验证 how 属实，与原图一致',
      '- must_have 全部有真实承载（消费 visual_parity 结果）',
      '## 结论\n通过',
    ].join('\n');
    const r = checkVisualFidelityReview(ctx, report);
    assert.strictEqual(r.find(x => x.id === 'visual_fidelity_review')?.status, 'PASS');
  }
  // 非 UI 需求（ui_change: none）→ 不产生结果
  {
    const { root: r2, ctx: ctx2 } = mkProject(docToYaml(subsetAddCard(axisFixDoc(loadTransposedDoc()), [])));
    fs.writeFileSync(
      path.join(r2, 'doc', 'features', 'homepage', 'spec', 'spec.md'),
      '# spec\n\n```yaml\nui_change: none\n```\n', 'utf-8',
    );
    (ctx2 as { phaseRule: unknown }).phaseRule = (ctx as { phaseRule: unknown }).phaseRule;
    assert.strictEqual(checkVisualFidelityReview(ctx2, '# review').length, 0, '非 UI 需求不应产生视觉维度要求');
  }
});

// ============================================================
// Phase 3（P1-C）：文本块二部匹配观测——相对信号（同行/顺序/存在性），canned OCR 注入
// ============================================================

import { collectTextPlacementSignals, type OcrFn } from '../../visual-diff-ocr-gates';
import type { OcrWord, OcrResult } from '../../ocr-toolkit';
import type { VisualDiffScreenEntry } from '../../visual-diff-check';

/** 一行文本 → 单 word（cy 中心、h 行高） */
function lineWord(text: string, cy: number, x = 0.1, h = 0.02): OcrWord {
  return { text, conf: 90, bbox: [x, cy - h / 2, 0.3, h] };
}

function cannedOcr(byPath: Record<string, OcrWord[] | null>): OcrFn {
  return (abs: string): OcrResult => {
    const key = Object.keys(byPath).find(k => abs.includes(k));
    if (!key) return { ok: false, error: 'no canned' };
    const words = byPath[key];
    if (!words) return { ok: false, error: 'canned fail' };
    return { ok: true, width: 1080, height: 2400, words };
  };
}

const PLACEMENT_TEXTS = ['添加卡片', '银行卡/交通卡/门禁卡等', '管理非本机卡片', '暂无非本机卡片'];
/** 参考图 ground truth：前两条同一行（副标题右置），后两条依次下行 */
const REF_WORDS: OcrWord[] = [
  lineWord('添加卡片', 0.20, 0.06),
  lineWord('银行卡/交通卡/门禁卡等', 0.20, 0.5),
  lineWord('管理非本机卡片', 0.30),
  lineWord('暂无非本机卡片', 0.50),
];

function runPlacement(shotWords: OcrWord[] | null, refWords: OcrWord[] | null = REF_WORDS) {
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'card_pack', verdict: 'pass', ref_id: 'card_pack', screenshot_path: 'shots/card_pack.png' } as VisualDiffScreenEntry,
  ];
  return collectTextPlacementSignals(
    new Map([['card_pack', PLACEMENT_TEXTS]]),
    screens,
    rel => rel,
    () => 'refs/card_pack.jpg',
    cannedOcr({ 'shots/card_pack.png': shotWords, 'refs/card_pack.jpg': refWords }),
  );
}

test('p1c_placement_faithful_scaled_no_signal', () => {
  // 忠实实现：y 整体 ×1.3、行高变化（device≠mockup 缩放）——相对信号必须零误报（FP 铁律，
  // 这正是绝对偏移度量被证伪的场景：所有绝对位置都偏了，但同行/顺序关系保持）
  const shot = [
    lineWord('添加卡片', 0.26, 0.06, 0.026),
    lineWord('银行卡/交通卡/门禁卡等', 0.26, 0.5, 0.026),
    lineWord('管理非本机卡片', 0.39, 0.1, 0.026),
    lineWord('暂无非本机卡片', 0.65, 0.1, 0.026),
  ];
  const r = runPlacement(shot);
  assert.strictEqual(r.perScreen.length, 0, `忠实缩放实现不得有任何信号：${JSON.stringify(r.perScreen)}`);
});

test('p1c_placement_subtitle_split_fail', () => {
  // round6 坏态：副标题从右置（与主标题同行）被排成题下（分居两行）→ FAIL 级确定性信号
  const shot = [
    lineWord('添加卡片', 0.26, 0.06, 0.026),
    lineWord('银行卡/交通卡/门禁卡等', 0.34, 0.06, 0.026), // 掉到下一行（题下）
    lineWord('管理非本机卡片', 0.45, 0.1, 0.026),
    lineWord('暂无非本机卡片', 0.65, 0.1, 0.026),
  ];
  const r = runPlacement(shot);
  assert.strictEqual(r.perScreen.length, 1);
  const sig = r.perScreen[0];
  assert.ok(sig.fail_signals.some(x => /同一行.*分居两行/.test(x)), `应产同行拆分 FAIL 信号：${JSON.stringify(sig)}`);
});

test('p1c_placement_order_inversion_fail', () => {
  // round6 坏态："卡包文字排到页首"式纵向乱序（≥2 对逆序）→ FAIL 级
  const shot = [
    lineWord('添加卡片', 0.80, 0.06, 0.026), // 应在最上，实测掉到最下
    lineWord('银行卡/交通卡/门禁卡等', 0.80, 0.5, 0.026),
    lineWord('管理非本机卡片', 0.30, 0.1, 0.026),
    lineWord('暂无非本机卡片', 0.50, 0.1, 0.026),
  ];
  const r = runPlacement(shot);
  assert.strictEqual(r.perScreen.length, 1);
  assert.ok(r.perScreen[0].fail_signals.some(x => /纵向乱序/.test(x)), `应产乱序 FAIL 信号：${JSON.stringify(r.perScreen[0])}`);
});

test('p1c_placement_missing_text_must_fix', () => {
  // 存在性（唯一实测鲁棒信号）：参考图有、截图无 → per-element must_fix（advisory，喂 loop）
  const shot = [
    lineWord('添加卡片', 0.26, 0.06, 0.026),
    lineWord('银行卡/交通卡/门禁卡等', 0.26, 0.5, 0.026),
    lineWord('管理非本机卡片', 0.39, 0.1, 0.026),
    // 暂无非本机卡片 缺失
  ];
  const r = runPlacement(shot);
  assert.strictEqual(r.perScreen.length, 1);
  const sig = r.perScreen[0];
  assert.strictEqual(sig.fail_signals.length, 0, '单条缺失不应 FAIL 级（gross 门禁另管）');
  assert.ok(sig.must_fix.some(x => /暂无非本机卡片.*未识别到/.test(x)), `应产存在性 must_fix：${JSON.stringify(sig)}`);
});

test('p1c_placement_overlay_id_falls_back_to_base', () => {
  // codex 三轮 P1：overlay 屏 id（manage_non_local__overlay__0）须归一化回落基屏文本，
  // 否则半模态屏的同行拆分/乱序/缺失静默漏检（连 degraded 都不报）
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'card_pack__overlay__0', verdict: 'pass', screenshot_path: 'shots/overlay.png' } as VisualDiffScreenEntry,
  ];
  const shot = [
    lineWord('添加卡片', 0.26, 0.06, 0.026),
    lineWord('银行卡/交通卡/门禁卡等', 0.34, 0.06, 0.026), // 题下（坏态）
    lineWord('管理非本机卡片', 0.45, 0.1, 0.026),
    lineWord('暂无非本机卡片', 0.65, 0.1, 0.026),
  ];
  const r = collectTextPlacementSignals(
    new Map([['card_pack', PLACEMENT_TEXTS]]), // 只有基屏 key
    screens,
    rel => rel,
    () => 'refs/card_pack.jpg',
    cannedOcr({ 'shots/overlay.png': shot, 'refs/card_pack.jpg': REF_WORDS }),
  );
  assert.strictEqual(r.perScreen.length, 1, `overlay id 应回落基屏文本并产出信号：${JSON.stringify(r)}`);
  assert.ok(r.perScreen[0].fail_signals.some(x => /同一行.*分居两行/.test(x)));
});

test('p1c_t1_gross_missing_overlay_id_falls_back_to_base', () => {
  // codex 四轮 P1：T1 整块缺失门禁同款 overlay 归一化——anchors 键为基屏、screens 是 overlay id 时仍受检
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { collectGrossMissingAnchorText } = require('../../visual-diff-ocr-gates') as typeof import('../../visual-diff-ocr-gates');
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'manage_non_local__overlay__0', verdict: 'pass', screenshot_path: 'shots/mnl.png' } as VisualDiffScreenEntry,
  ];
  const anchors = new Map([['manage_non_local', ['管理非本机卡片', '暂无非本机卡片', '关闭', '返回']]]);
  // 截图 OCR 全空（整块缺失）→ 应产 violation 而非静默跳过
  const r = collectGrossMissingAnchorText(
    anchors, screens, (rel: string) => rel,
    cannedOcr({ 'shots/mnl.png': [] }),
  );
  assert.strictEqual(r.violations.length, 1, `overlay id 应回落基屏 anchors 并判整块缺失：${JSON.stringify(r)}`);
  assert.strictEqual(r.violations[0].screen_id, 'manage_non_local__overlay__0');
});

test('p1c_placement_short_text_substring_no_false_inversion', () => {
  // Checkpoint-2 实测校准回归（宿主 20260703T040107Z home_no_card 实况复刻）：
  // 顶栏加粗大字「钱包」设备 OCR 整行漏识别 → 短目标子串命中「欢迎使用钱包消息中心!」聚合长行
  // → 曾产两条假乱序。校准=子串冲突消解：「钱包」⊂「欢迎使用钱包消息中心!」且撞同一行时，
  // 行归更长目标，短目标重找次优/判未识别（注意：非"行长比"判据——那版会误伤同行聚合成员，已弃用）；
  // 宫格 vs 消息中心的真颠倒（真机实锤）必须仍报。
  const texts = ['钱包', 'Huawei Card', '信用卡还款', '欢迎使用钱包消息中心!'];
  const ref = [
    lineWord('钱包', 0.08, 0.05),                    // 参考图顶栏可识别
    lineWord('Huawei Card', 0.42, 0.1),              // 原图：宫格在上
    lineWord('信用卡还款', 0.42, 0.4),
    lineWord('欢迎使用钱包消息中心!', 0.52, 0.1),      // 消息中心在下
  ];
  const shot = [
    // 顶栏「钱包」漏识别（无该行）——真机实况
    lineWord('欢迎使用钱包消息中心!', 0.44, 0.1, 0.026), // 实机：消息中心跑到宫格上方（真缺陷）
    lineWord('Huawei Card', 0.55, 0.1, 0.026),
    lineWord('信用卡还款', 0.55, 0.4, 0.026),
  ];
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'home_no_card', verdict: 'pass', screenshot_path: 'shots/home.png' } as VisualDiffScreenEntry,
  ];
  const r = collectTextPlacementSignals(
    new Map([['home_no_card', texts]]),
    screens, rel => rel, () => 'refs/home.jpg',
    cannedOcr({ 'shots/home.png': shot, 'refs/home.jpg': ref }),
  );
  assert.strictEqual(r.perScreen.length, 1);
  const sig = r.perScreen[0];
  const all = [...sig.fail_signals, ...sig.must_fix].join('\n');
  assert.ok(!/「钱包」应在/.test(all), `「钱包」子串误配不得产乱序（FP 校准）：${all}`);
  assert.ok(sig.fail_signals.some(x => /纵向乱序/.test(x)), `宫格 vs 消息中心真颠倒必须仍报：${JSON.stringify(sig)}`);
});

test('p1c_placement_unmodeled_line_no_fp', () => {
  // 收尾批 P0-1（终局 run 20260703T181220Z mine 屏实况复刻）：参考图横幅拆三行，副文案行
  // "刷卡设置存在优化空间，设置后可提升刷卡体验"含「设置」但整行未建模——「设置」被冲突消解
  // 从标题行踢出后曾次优落进该行 → 4-5 对假乱序。残余覆盖判据后：该行不可被「设置」认领，
  // 「设置」落真实设置行（y=0.60）→ 零假乱序；横幅缺渲染的存在性 must_fix（真阳性）仍报。
  const texts = ['我的', '智闪刷卡设置待优化', '去优化', '华为支付', '银行电子账户', '设置'];
  const ref = [
    lineWord('我的', 0.08, 0.05),
    lineWord('智闪刷卡设置待优化', 0.20, 0.1),
    lineWord('刷卡设置存在优化空间，设置后可提升刷卡体验', 0.23, 0.1), // 未建模副文案行（FP 源）
    lineWord('去优化', 0.26, 0.7),
    lineWord('华为支付', 0.36, 0.1),
    lineWord('银行电子账户', 0.44, 0.1),
    lineWord('设置', 0.60, 0.1),
  ];
  const shot = [ // 实机：横幅整体未渲染（真缺陷），其余顺序正确
    lineWord('我的', 0.10, 0.05, 0.026),
    lineWord('华为支付', 0.30, 0.1, 0.026),
    lineWord('银行电子账户', 0.38, 0.1, 0.026),
    lineWord('设置', 0.55, 0.1, 0.026),
  ];
  const screens: VisualDiffScreenEntry[] = [
    { screen_id: 'mine', verdict: 'pending', screenshot_path: 'shots/mine.png' } as VisualDiffScreenEntry,
  ];
  const r = collectTextPlacementSignals(
    new Map([['mine', texts]]), screens, rel => rel, () => 'refs/mine.jpg',
    cannedOcr({ 'shots/mine.png': shot, 'refs/mine.jpg': ref }),
  );
  assert.strictEqual(r.perScreen.length, 1);
  const sig = r.perScreen[0];
  assert.strictEqual(sig.fail_signals.length, 0, `未建模行不得产假乱序（FP 铁律）：${JSON.stringify(sig.fail_signals)}`);
  assert.ok(sig.must_fix.some(x => /智闪刷卡设置待优化/.test(x)), `横幅缺渲染的存在性 must_fix 仍须报：${JSON.stringify(sig.must_fix)}`);
});

test('p0_2_verdict_abandonment_states', () => {
  // 收尾批 P0-2：fail_signals 非空 + pending = 弃判必报；不以 must_fix 有无为条件（codex：塞 must_fix
  // 仍 pending 也得报）；verdict 已判 fail 则不报
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { collectVerdictAbandonment } = require('../../visual-diff-ocr-gates') as typeof import('../../visual-diff-ocr-gates');
  const perScreen = [
    { screen_id: 'a', fail_signals: ['信号1'], must_fix: [] },
    { screen_id: 'b', fail_signals: ['信号2'], must_fix: [] },
    { screen_id: 'c', fail_signals: [], must_fix: ['仅advisory'] },
  ];
  const screens = [
    { screen_id: 'a', verdict: 'pending' } as VisualDiffScreenEntry,
    { screen_id: 'b', verdict: 'pending', must_fix: ['已有指令'] } as VisualDiffScreenEntry,
    { screen_id: 'c', verdict: 'pending' } as VisualDiffScreenEntry,
  ];
  const r = collectVerdictAbandonment(perScreen, screens);
  assert.strictEqual(r.length, 2, `a/b 均应判弃判（b 有 must_fix 也不豁免）：${JSON.stringify(r)}`);
  const b = r.find(x => x.screen_id === 'b')!;
  assert.ok(b.lines.includes('信号2') && b.lines.includes('已有指令'), 'details 应合并信号与既有 must_fix');
  // verdict=fail 已判 → 不算弃判
  const r2 = collectVerdictAbandonment(perScreen, [{ screen_id: 'a', verdict: 'fail' } as VisualDiffScreenEntry]);
  assert.strictEqual(r2.length, 0);
});

test('p0_3_nav_meta_read', () => {
  // 收尾批 P0-3(c)：device-test-run.meta.json 读取三态 + 坏 JSON 回退（宿主热修原样语义）
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readDeviceTestRunHylyreNavOpts } = require('../../visual-diff-hylyre-screenshot') as typeof import('../../visual-diff-hylyre-screenshot');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-meta-'));
  const logPath = path.join(dir, 'run.log');
  // ① 缺 meta → 保守缺省
  assert.deepStrictEqual(readDeviceTestRunHylyreNavOpts(logPath), { omitBundle: false });
  // ② aa_start_ok + pageName → omit + 透传
  fs.writeFileSync(path.join(dir, 'device-test-run.meta.json'),
    JSON.stringify({ aa_start_ok: true, hypium_page_name: 'PhoneAbility', omit_bundle_for_hylyre: true }), 'utf-8');
  assert.deepStrictEqual(readDeviceTestRunHylyreNavOpts(logPath), { omitBundle: true, hypiumPageName: 'PhoneAbility' });
  // ③ 坏 JSON → 保守回退
  fs.writeFileSync(path.join(dir, 'device-test-run.meta.json'), '{broken', 'utf-8');
  assert.deepStrictEqual(readDeviceTestRunHylyreNavOpts(logPath), { omitBundle: false });
});

test('p0_3_system_symbol_render_judgement', () => {
  // 收尾批 P0-3(d)：system_symbol 正规修法正反例——真渲染 SymbolGlyph($r('sys.symbol.plus')) 不误报；
  // 声明却零渲染仍检出（宿主一刀切 continue 会漏的洞）
  const mkCase = (etsBody: string) => {
    const doc: UiSpecDoc = {
      schema_version: '1.0',
      verified: 'verified',
      screens: [{
        id: 's1', priority: 'P0', ref_id: 's1',
        root: {
          type: 'navigation_frame', order: 0,
          children: [{
            type: 'action_button', order: 0, id: 'btn_add',
            icon: { kind: 'system_symbol', ref: 'sys.symbol.plus' },
          } as never],
        },
      }],
      tokens: {}, assets: [],
    } as unknown as UiSpecDoc;
    const { root, ctx } = mkProject(docToYaml(doc));
    const etsDir = path.join(root, 'mod', 'src', 'main', 'ets', 'pages');
    fs.mkdirSync(etsDir, { recursive: true });
    fs.writeFileSync(path.join(etsDir, 'P.ets'), etsBody, 'utf-8');
    (ctx as { featureSpec: { contracts?: unknown } }).featureSpec.contracts = { modules: [{ name: 'mod', package_path: 'mod' }] };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { collectAssetRenderIssues } = require('../../visual-parity-backstop') as typeof import('../../visual-parity-backstop');
    return collectAssetRenderIssues(ctx, doc, false).filter(i => i.assetRole === 'not_rendered');
  };
  assert.strictEqual(
    mkCase("struct P { build() { SymbolGlyph($r('sys.symbol.plus')).fontSize(22) } }").length, 0,
    '真渲染 sys.symbol 不得误报（P0-E 误报根治）');
  assert.strictEqual(
    mkCase("struct P { build() { Text('添加') } }").length, 1,
    '声明 system_symbol 却零渲染必须检出（一刀切 skip 会漏的洞）');
});

test('p1c_placement_degraded_not_silent', () => {
  // OCR 失败/参考图缺失 → 降级清单（不误报也不静默）
  const rShotFail = runPlacement(null);
  assert.deepStrictEqual(rShotFail.perScreen, []);
  assert.deepStrictEqual(rShotFail.ocrUnavailable, ['card_pack']);
  const rRefFail = runPlacement(REF_WORDS, null);
  assert.deepStrictEqual(rRefFail.refUnavailable, ['card_pack']);
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
