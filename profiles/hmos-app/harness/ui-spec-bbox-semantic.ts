// ============================================================================
// ui-spec-bbox-semantic.ts — P0-A bbox 坐标语义确定性门禁（plan f2d8c4a6）
// ----------------------------------------------------------------------------
// 背景（round6 真凶）：framework bbox SSOT=[x,y,w,h]（image-jimp-worker.cjs / ui-spec.schema.json），
//   但 VL 产 ui-spec 实际吐过系统性 [y,x,h,w] 转置（宿主 homepage 全文档命中），一个转置同时污染
//   素材裁剪、token 采色、布局 ground truth 三条线，而全链路无任何机器校验。
// 判定分两层（阈值全部来自 2026-07-02 OCR spike 对 6 张真实 mockup 的实测标定）：
//   第 0 层 orientation 预检（零依赖，OCR 挂了也能拦）：横排多字文本节点 h 显著大于 w 属形态反常，
//     系统性出现（≥60% 且 ≥5 个）→ 疑似转置。坏态实测 47/47 命中。
//   第 1 层 OCR 交叉校验：原图 OCR 词框行聚类后，对每个文本节点算「声明 bbox vs OCR 行框」在
//     原语义与转置语义（[b1,b0,b3,b2]）下的最大 IoU；两语义差 > margin 且赢家 IoU ≥ floor 记 decisive。
//     decisive ≥5 且转置占比 ≥80% → 系统性转置 BLOCKER。坏态实测 22:0 判转置、修正态 22:0 判正确。
// OCR 失败策略（外部评审采纳，写硬）：pixel_1to1 下 OCR 不可用/全失败/文本覆盖率不足 → 本 check
//   不得 PASS（toolchain 归因，沿 round5 visual_parity_ocr_unavailable 先例），绝不静默 SKIP；
//   此时第 0 层仍独立生效。
// 门禁只判不改：转置修复由 spec agent 按 details 的逐节点对照表执行（全文档 bbox/source_bbox 统一
//   换轴 [y,x,h,w]→[x,y,w,h]），修后须重过本 check + asset_crop_validation——不自动回写、不自签。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import {
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  uiSpecAbsPath,
  uiSpecRelPath,
  UI_CHANGE_REQUIRES_UI_SPEC,
  walkComponentNodes,
  type UiSpecComponentNode,
  type UiSpecDoc,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { isPixel1to1, fidelityRatchetFailOrWarn } from '../../../harness/scripts/utils/fidelity-shared';
import {
  clusterOcrLines,
  fuzzyMatchRatio,
  isOcrAvailable,
  ocrImageWords,
  type OcrLine,
} from './ocr-toolkit';
import {
  buildAuthoritativeRefImageIndex,
  resolveRefSourceImage,
} from './authoritative-ref-images';

// ---- 阈值（OCR spike 2026-07-02 实测标定，见 tests/fixtures/round6/README.md）----

/** 第 0 层：参与 orientation 判定的最小多字文本节点数（少于此不判，防小样本误报） */
export const ORIENTATION_MIN_NODES = 5;
/** 第 0 层：反常节点占比阈值（坏态实测 100%，取 0.6 留余量） */
export const ORIENTATION_ANOMALY_RATIO = 0.6;
/** 第 0 层：h ≥ w×此系数才计反常（排除近方形短文本，防误伤） */
export const ORIENTATION_HW_FACTOR = 1.15;
/** 第 1 层：两语义 IoU 差超此值才算 decisive（实测赢家中位 IoU 0.103、输家 0） */
export const BBOX_IOU_DECISIVE_MARGIN = 0.04;
/** 第 1 层：decisive 赢家 IoU 下限（防两边都≈0 的噪声票） */
export const BBOX_IOU_FLOOR = 0.08;
/** 第 1 层：系统性判定最小 decisive 节点数 */
export const BBOX_MIN_DECISIVE = 5;
/** 第 1 层：decisive 中转置占比 ≥ 此值 → 系统性转置（坏态实测 100%） */
export const BBOX_TRANSPOSED_FRACTION = 0.8;
/** OCR 文本覆盖率下限：命中候选行的文本节点 / 全部多字文本节点（实测 46/47≈98%，mine 屏 89%） */
export const BBOX_OCR_MIN_COVERAGE = 0.5;
/** 候选行模糊命中率下限（沿 ocr-toolkit fuzzyTextPresent 缺省） */
const LINE_MATCH_MIN_RATIO = 0.6;

export interface TextBboxNode {
  screenId: string;
  /** 屏的 ref_id（解析原图用），缺省回落 screenId */
  refId: string;
  nodeId: string;
  text: string;
  bbox: [number, number, number, number];
}

/** 收集全文档带 text+bbox 的组件节点（规整后 text 长度 ≥2 才参与判定；"+"/"5" 等单字符除外） */
export function collectTextBboxNodes(doc: UiSpecDoc): TextBboxNode[] {
  const out: TextBboxNode[] = [];
  for (const s of doc.screens ?? []) {
    if (!s.root) continue;
    const nodes: UiSpecComponentNode[] = [];
    walkComponentNodes(s.root, nodes);
    for (const n of nodes) {
      const text = typeof n.text === 'string' ? n.text.replace(/\s+/g, '') : '';
      const bbox = n.bbox;
      if (text.length < 2 || !Array.isArray(bbox) || bbox.length !== 4) continue;
      out.push({
        screenId: s.id,
        refId: s.ref_id ?? s.id,
        nodeId: n.id ?? n.type ?? '(anonymous)',
        text: n.text as string,
        bbox: bbox as [number, number, number, number],
      });
    }
  }
  return out;
}

export interface OrientationAssessment {
  eligible: number;
  anomalous: number;
  ratio: number;
  systematic: boolean;
}

/** 第 0 层：横排多字文本 w<h 系统性反常判定（零依赖） */
export function assessBboxOrientation(nodes: TextBboxNode[]): OrientationAssessment {
  const eligible = nodes.length;
  let anomalous = 0;
  for (const n of nodes) {
    const [, , w, h] = n.bbox;
    if (h >= w * ORIENTATION_HW_FACTOR) anomalous++;
  }
  const ratio = eligible > 0 ? anomalous / eligible : 0;
  return {
    eligible,
    anomalous,
    ratio,
    systematic: eligible >= ORIENTATION_MIN_NODES && ratio >= ORIENTATION_ANOMALY_RATIO,
  };
}

function iou(a: readonly number[], b: readonly number[]): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

/** bbox 的转置解读：[x,y,w,h] ↔ [y,x,h,w] */
export function transposeBbox(b: readonly number[]): [number, number, number, number] {
  return [b[1], b[0], b[3], b[2]];
}

export type NodeSemanticVerdict = 'as_is' | 'transposed' | 'inconclusive' | 'unmatched';

export interface NodeSemanticScore {
  node: TextBboxNode;
  verdict: NodeSemanticVerdict;
  iouAsIs: number;
  iouTransposed: number;
}

/** 第 1 层单节点评分：候选行取两语义下最大 IoU */
export function scoreNodeAgainstLines(node: TextBboxNode, lines: OcrLine[]): NodeSemanticScore {
  const candidates = lines.filter(l => fuzzyMatchRatio(l.text, node.text) >= LINE_MATCH_MIN_RATIO);
  if (candidates.length === 0) {
    return { node, verdict: 'unmatched', iouAsIs: 0, iouTransposed: 0 };
  }
  let iouAsIs = 0;
  let iouTransposed = 0;
  const tb = transposeBbox(node.bbox);
  for (const c of candidates) {
    iouAsIs = Math.max(iouAsIs, iou(node.bbox, c.box));
    iouTransposed = Math.max(iouTransposed, iou(tb, c.box));
  }
  let verdict: NodeSemanticVerdict = 'inconclusive';
  if (iouTransposed > iouAsIs + BBOX_IOU_DECISIVE_MARGIN && iouTransposed >= BBOX_IOU_FLOOR) {
    verdict = 'transposed';
  } else if (iouAsIs > iouTransposed + BBOX_IOU_DECISIVE_MARGIN && iouAsIs >= BBOX_IOU_FLOOR) {
    verdict = 'as_is';
  }
  return { node, verdict, iouAsIs, iouTransposed };
}

export interface BboxSemanticAssessment {
  scores: NodeSemanticScore[];
  matched: number;
  coverage: number;
  decisive: number;
  transposedCount: number;
  asIsCount: number;
  /** decisive 足量且转置占比超阈 → 系统性转置 */
  systematicTransposed: boolean;
  /** decisive 足量且原语义占比超阈 → OCR 正面验证语义正确 */
  systematicAsIs: boolean;
}

/** 第 1 层汇总：按屏 OCR 行 × 文本节点评分后做系统性判定 */
export function assessBboxSemantics(
  nodes: TextBboxNode[],
  linesByScreen: Map<string, OcrLine[]>,
): BboxSemanticAssessment {
  const scores: NodeSemanticScore[] = [];
  for (const n of nodes) {
    const lines = linesByScreen.get(n.screenId);
    if (!lines || lines.length === 0) {
      scores.push({ node: n, verdict: 'unmatched', iouAsIs: 0, iouTransposed: 0 });
      continue;
    }
    scores.push(scoreNodeAgainstLines(n, lines));
  }
  const matched = scores.filter(s => s.verdict !== 'unmatched').length;
  const decisiveScores = scores.filter(s => s.verdict === 'transposed' || s.verdict === 'as_is');
  const transposedCount = decisiveScores.filter(s => s.verdict === 'transposed').length;
  const asIsCount = decisiveScores.length - transposedCount;
  const decisive = decisiveScores.length;
  return {
    scores,
    matched,
    coverage: nodes.length > 0 ? matched / nodes.length : 0,
    decisive,
    transposedCount,
    asIsCount,
    systematicTransposed:
      decisive >= BBOX_MIN_DECISIVE && transposedCount / decisive >= BBOX_TRANSPOSED_FRACTION,
    systematicAsIs:
      decisive >= BBOX_MIN_DECISIVE && asIsCount / decisive >= BBOX_TRANSPOSED_FRACTION,
  };
}

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.ui_spec_bbox_semantic?.description?.trim() ?? 'ui_spec_bbox_semantic';
}

function fmtBbox(b: readonly number[]): string {
  return `[${b.map(v => Number(v).toFixed(2)).join(',')}]`;
}

const FIX_SUGGESTION =
  '疑似全文档 bbox 按 [y,x,h,w] 语义产出（SSOT=[x,y,w,h]，见 ui-spec.schema.json / reference/ui-spec.md few-shot）。' +
  '修复：对 ui-spec 全部 bbox 与 tokens[].source_bbox / assets[].source_bbox 统一换轴 [y,x,h,w]→[x,y,w,h]' +
  '（同一生成器产出、同一转置——文本节点判定结果对无文本的 asset/token bbox 连坐生效），' +
  '修正后重跑 spec harness：本 check 须转为 PASS 且 asset_crop_validation 对重裁产物验真通过。' +
  '不得只改判定不改数据，也不得由自动化身份自签验真。';

/**
 * P0-A 主检查（spec 阶段）。签名对齐 spec.ui_spec capability 既有导出（ctx, specMarkdown）。
 */
export function checkUiSpecBboxSemantic(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const desc = ruleDesc(ctx);
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const uiChange = parseUiChangeFromSpecMarkdown(specMarkdown);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) return [];
  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) return [];

  const nodes = collectTextBboxNodes(doc);
  if (nodes.length === 0) {
    return [{
      id: 'ui_spec_bbox_semantic',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'PASS',
      details: 'ui-spec 无带 text+bbox 的多字文本节点，坐标语义无从判定（轻量 spec 合法形态）。',
      affected_files: [uiSpecRel],
    }];
  }

  const results: CheckResult[] = [];
  const orientation = assessBboxOrientation(nodes);

  // ---- 第 1 层：OCR 交叉校验（能跑则跑；失败策略见下）----
  let ocrFailureNote: string | null = null;
  let assessment: BboxSemanticAssessment | null = null;
  if (!isOcrAvailable()) {
    ocrFailureNote = 'OCR 不可用（tesseract.js 未装或 chi_sim 未物化）';
  } else {
    const refIndex = buildAuthoritativeRefImageIndex(ctx, specMarkdown);
    const linesByScreen = new Map<string, OcrLine[]>();
    const ocrErrors: string[] = [];
    const screenRefs = new Map<string, string>();
    for (const n of nodes) {
      if (!screenRefs.has(n.screenId)) screenRefs.set(n.screenId, n.refId);
    }
    for (const [screenId, refId] of screenRefs) {
      const srcPick = resolveRefSourceImage(refIndex, refId);
      if (!srcPick.path) {
        ocrErrors.push(`${screenId}: 无法解析参考原图（${srcPick.note ?? 'authoritative_ref 缺失'}）`);
        continue;
      }
      const ocr = ocrImageWords(srcPick.path);
      if (!ocr.ok || !ocr.words) {
        ocrErrors.push(`${screenId}: OCR 失败（${ocr.error ?? 'unknown'}）`);
        continue;
      }
      linesByScreen.set(screenId, clusterOcrLines(ocr.words.filter(w => w.text.replace(/\s+/g, '').length > 0)));
    }
    if (linesByScreen.size === 0) {
      ocrFailureNote = `全部屏 OCR/原图解析失败：${ocrErrors.join('；') || '无可用参考原图'}`;
    } else {
      assessment = assessBboxSemantics(nodes, linesByScreen);
      if (ocrErrors.length > 0) {
        ocrFailureNote = `部分屏不可核验：${ocrErrors.join('；')}`;
      }
    }
  }

  // ---- 裁决（优先级：OCR 正面验证 > OCR 判转置 > orientation 预检 > 覆盖率不足）----
  const pixel = isPixel1to1(ctx);

  if (assessment?.systematicTransposed) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    const table = assessment.scores
      .filter(s => s.verdict === 'transposed')
      .slice(0, 12)
      .map(s =>
        `  ${s.node.screenId}/${s.node.nodeId} "${s.node.text.slice(0, 12)}" 声明${fmtBbox(s.node.bbox)} ` +
        `原语义IoU=${s.iouAsIs.toFixed(3)} 转置IoU=${s.iouTransposed.toFixed(3)}`)
      .join('\n');
    results.push({
      id: 'ui_spec_bbox_semantic',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `【P0-A 系统性 bbox 转置】OCR 交叉校验：decisive ${assessment.decisive} 节点中 ` +
        `${assessment.transposedCount} 个判转置（原语义 ${assessment.asIsCount}）；` +
        `orientation 预检 ${orientation.anomalous}/${orientation.eligible} 反常。逐节点对照（前 12）：\n${table}`,
      suggestion: FIX_SUGGESTION,
      affected_files: [uiSpecRel],
    });
    return results;
  }

  if (assessment?.systematicAsIs) {
    // OCR 正面验证语义正确 → orientation 反常降级为注记（竖排/异形布局等罕见形态由证据说话）
    const mismatches = assessment.scores.filter(s => s.verdict === 'transposed');
    results.push({
      id: 'ui_spec_bbox_semantic',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'PASS',
      details:
        `bbox 坐标语义 OCR 验证通过：decisive ${assessment.decisive}（原语义 ${assessment.asIsCount} : 转置 ${assessment.transposedCount}），` +
        `覆盖率 ${(assessment.coverage * 100).toFixed(0)}%` +
        (mismatches.length > 0
          ? `；个别节点疑似框错（非系统性，建议复核）：${mismatches.map(m => `${m.node.screenId}/${m.node.nodeId}`).join(', ')}`
          : '') +
        (ocrFailureNote ? `；${ocrFailureNote}` : ''),
      affected_files: [uiSpecRel],
    });
    return results;
  }

  if (orientation.systematic) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    const sample = nodes
      .filter(n => n.bbox[3] >= n.bbox[2] * ORIENTATION_HW_FACTOR)
      .slice(0, 8)
      .map(n => `  ${n.screenId}/${n.nodeId} "${n.text.slice(0, 12)}" ${fmtBbox(n.bbox)} (w<h)`)
      .join('\n');
    results.push({
      id: 'ui_spec_bbox_semantic',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        `【P0-A orientation 预检】横排多字文本节点 ${orientation.anomalous}/${orientation.eligible} ` +
        `(${(orientation.ratio * 100).toFixed(0)}%) 呈 w<h 形态反常——横排文本框宽应显著大于高，系统性反常=疑似 [y,x,h,w] 转置。` +
        (assessment
          ? `OCR 层未能正面裁决（decisive=${assessment.decisive}，覆盖率 ${(assessment.coverage * 100).toFixed(0)}%）。`
          : `OCR 层不可用（${ocrFailureNote ?? '未知原因'}），本层独立生效。`) +
        `\n样例（前 8）：\n${sample}`,
      suggestion: FIX_SUGGESTION,
      affected_files: [uiSpecRel],
    });
    return results;
  }

  // ---- 无系统性转置信号：处理 OCR 证据缺失（pixel_1to1 不得静默 PASS）----
  if (ocrFailureNote && !assessment) {
    results.push({
      id: 'ui_spec_bbox_semantic_ocr_unavailable',
      category: 'structure',
      description: desc,
      severity: pixel ? 'BLOCKER' : 'MAJOR',
      status: pixel ? 'FAIL' : 'WARN',
      details:
        `【P0-A OCR 承重不可用】${ocrFailureNote}——pixel_1to1 下无法核验 bbox 坐标语义，不得放行` +
        `（orientation 预检未见系统性反常，但那只是必要条件非充分验证）。`,
      suggestion:
        '修复 OCR 环境（harness 装 tesseract.js + profiles/hmos-app/vendor/tessdata/chi_sim.traineddata）' +
        '或补齐 authoritative_ref 可达原图后重跑（此 id 归 toolchain，signature 重复即 halt 求人）。',
      affected_files: [uiSpecRel],
    });
    return results;
  }

  if (assessment && assessment.coverage < BBOX_OCR_MIN_COVERAGE) {
    results.push({
      id: 'ui_spec_bbox_semantic',
      category: 'structure',
      description: desc,
      severity: pixel ? 'BLOCKER' : 'MAJOR',
      status: pixel ? 'FAIL' : 'WARN',
      details:
        `【P0-A OCR 覆盖不足】文本节点 OCR 命中率 ${(assessment.coverage * 100).toFixed(0)}%` +
        `（${assessment.matched}/${nodes.length}，阈值 ${BBOX_OCR_MIN_COVERAGE * 100}%）——证据不足以核验 bbox 语义，` +
        'pixel_1to1 下不得静默 PASS。' + (ocrFailureNote ? `${ocrFailureNote}。` : ''),
      suggestion:
        '核对 authoritative_ref 原图是否与 ui-spec 屏一一对应、文本是否可辨（截图分辨率/语言包）；' +
        '若参考图本身无文本（纯图形屏），在 spec 说明并走人工确认。',
      affected_files: [uiSpecRel],
    });
    return results;
  }

  // decisive 不足但覆盖率够：候选行命中了但 IoU 两边都探不出——bbox 松散但非转置证据，放行 + 注记
  results.push({
    id: 'ui_spec_bbox_semantic',
    category: 'structure',
    description: desc,
    severity: 'MINOR',
    status: 'PASS',
    details:
      `未见系统性 bbox 转置：orientation ${orientation.anomalous}/${orientation.eligible} 反常（阈值 ${ORIENTATION_ANOMALY_RATIO * 100}%），` +
      (assessment
        ? `OCR decisive ${assessment.decisive}（转置 ${assessment.transposedCount} : 原语义 ${assessment.asIsCount}），覆盖率 ${(assessment.coverage * 100).toFixed(0)}%。` +
          `decisive < ${BBOX_MIN_DECISIVE} 表示 bbox 与 OCR 词框对位松散——语义无转置证据，精度问题由 asset_crop_validation/后续环节兜。`
        : '') +
      (ocrFailureNote ? `；${ocrFailureNote}` : ''),
    affected_files: [uiSpecRel],
  });
  return results;
}
