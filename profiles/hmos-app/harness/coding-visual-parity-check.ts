// ============================================================================
// coding · visual parity 确定性守门（hmos-app / coding.visual_parity capability）
// ============================================================================
// 边界（review#5）：D 查「在不在」非「对不对」——必要不充分。
// unverified ui-spec 下只报结构 presence，报告显式标注「基线未校验，非保真结论」。
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureFile } from '../../../harness/config';
import {
  UI_CHANGE_REQUIRES_UI_SPEC,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  structureFailOrWarn,
  uiSpecAbsPath,
  uiSpecRelPath,
  type VisualEnforcementMode,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { computeStaticFidelityScore } from './static-fidelity-score';
import {
  runVisualParityBackstop,
  collectVariantParityIssues,
  collectRenderFaithfulnessIssues,
  collectAssetRenderIssues,
  collectPlaceholderAssetIssues,
  collectBakedTextAssetIssues,
  collectIconSubstitutionIssues,
  collectActionButtonVariantDeclIssues,
} from './visual-parity-backstop';
import { isPixel1to1, fidelityRatchetFailOrWarn } from '../../../harness/scripts/utils/fidelity-shared';

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

function loadSpecMarkdown(ctx: CheckContext): string | null {
  const p = path.join(ctx.projectRoot, 'doc', 'features', ctx.feature, 'spec', 'spec.md');
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf-8');
}

/** 供 harness / 白盒单测调用 */
export function checkVisualParity(ctx: CheckContext): CheckResult[] {
  const enforcement = ctx.visualParityEnforcement as VisualEnforcementMode | undefined;
  const desc = ruleDesc(ctx, 'structure_checks', 'visual_parity');
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);

  if (ctx.skipVisualParity) {
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: '已跳过 visual parity（--skip-visual-parity）',
      affected_files: [uiSpecRel],
    }];
  }

  if (enforcement === 'off') {
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: 'framework.config.json 中 coding.visual_parity_enforcement=off',
      affected_files: [uiSpecRel],
    }];
  }

  const specMd = loadSpecMarkdown(ctx);
  const uiChange = specMd ? parseUiChangeFromSpecMarkdown(specMd) : null;
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `${uiSpecRel} 不存在，无法做 parity 核对。`,
      affected_files: [uiSpecRel],
    }];
  }

  const baselineUnverified = (doc.verified ?? 'unverified') === 'unverified';
  const backstopIssues = runVisualParityBackstop(ctx, doc, baselineUnverified);
  const issues = backstopIssues.map(i => i.detail);

  const boundaryNote =
    '【背板】visual_parity 仅保留 C2 语义色绑定 + C3 must_have_elements presence；保真信号见 static_fidelity_score 与 device visual_diff。';
  const baselineNote = baselineUnverified
    ? '【基线未校验】ui-spec verified=unverified：以下仅为结构 presence，非保真结论。'
    : '';

  const results: CheckResult[] = [];

  if (issues.length > 0) {
    const soft = !isPixel1to1(ctx) && (enforcement === 'warn' || enforcement === 'reachable');
    const ratchet = isPixel1to1(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : structureFailOrWarn(enforcement);
    const { severity, status } = soft
      ? { severity: 'MAJOR' as const, status: 'WARN' as const }
      : ratchet;
    results.push({
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [baselineNote, boundaryNote, issues.join('；')].filter(Boolean).join('\n'),
      affected_files: [uiSpecRel, relFeatureFile(ctx.projectRoot, ctx.feature, 'contracts.yaml')],
    });
  } else {
    results.push({
      id: 'visual_parity',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: [baselineNote, boundaryNote, 'C2 语义色绑定 + C3 must_have 均已通过'].filter(Boolean).join('\n'),
      affected_files: [uiSpecRel],
    });
  }

  // G3 Slice 3：variant 静态轻启发式（WARN/低置信，仅早警；可靠核对走 device visual-diff）
  const variantIssues = collectVariantParityIssues(ctx, doc, baselineUnverified);
  if (variantIssues.length > 0) {
    results.push({
      id: 'visual_parity_variant',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: ['【启发式·低置信，以 device visual-diff 为准】', ...variantIssues.map(i => i.detail)].join('\n'),
      suggestion: '核对按钮填充与 variant 是否一致；最终以真机 visual-diff 像素核对为准。',
      affected_files: [uiSpecRel],
    });
  }

  // v3 渲染忠实度：声明 width_ratio/align 几何 + tonal 填充 vs 源码渲染（P0 屏先行，低置信 WARN）
  const renderIssues = collectRenderFaithfulnessIssues(ctx, doc, baselineUnverified);
  if (renderIssues.length > 0) {
    results.push({
      id: 'visual_parity_render',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: ['【渲染忠实度·低置信，以 device visual-diff 为准】', ...renderIssues.map(i => i.detail)].join('\n'),
      suggestion: '核对按钮占宽(width_ratio)与填充(tonal/实心)是否按 spec 渲染；最终以真机 visual-diff 像素核对为准。',
      affected_files: [uiSpecRel],
    });
  }

  // s1 asset 真渲染：声明 asset_ref 却未 $r 引用 media（catches #6 tab 仅文字）
  // review#4：pixel_1to1 下「声明却未真实渲染」(not_rendered) 升 BLOCKER；显式 placeholder 豁免仍 WARN。
  const assetIssues = collectAssetRenderIssues(ctx, doc, baselineUnverified);
  if (assetIssues.length > 0) {
    const hardNotRendered = isPixel1to1(ctx) && assetIssues.some(i => i.assetRole === 'not_rendered');
    const { severity, status } = hardNotRendered
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_asset_render',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        hardNotRendered ? '【asset 真渲染·pixel_1to1 阻断：声明 asset_ref 却未渲染】' : '【asset 真渲染·低置信，以 device visual-diff 为准】',
        ...assetIssues.map(i => i.detail),
      ].join('\n'),
      suggestion: '声明 asset_ref 的元素须在对应组件 $r 引用并渲染该 media（如 tab 图标）；动态渲染/显式 placeholder 可豁免。',
      affected_files: [uiSpecRel],
    });
  }

  // B s1.5 asset 物化真图校验：被 $r('app.media.*') 引用的【模块实际】media 必须是真图，禁 1×1/退化占位冒充。
  // 以模块 resources/base/media 为准（不信 contracts/根 media path，那归 F）；pixel_1to1 → BLOCKER。
  const materializeIssues = collectPlaceholderAssetIssues(ctx, doc, baselineUnverified);
  if (materializeIssues.length > 0) {
    const { severity, status } = isPixel1to1(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_asset_materialized',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        '【asset 物化真图校验】被 $r 引用的模块 media 须为真图（非 1×1/退化占位）；以 <module>/src/main/resources/base/media 为准，不信 contracts/根 media path。',
        ...materializeIssues.map(i => i.detail),
      ].join('\n'),
      suggestion: '把 ui-spec assets[].resolved_path 的真裁图复制进引用模块 <module>/src/main/resources/base/media/<key>.<ext>；缺真图须显式 placeholder + 用户知情，禁占位冒充。',
      affected_files: [uiSpecRel],
    });
  }

  // round5 P0-A：素材原子化——被 $r 引用的非 placeholder 素材图不得烤入 ui-spec 声明文本（整段大图 → 双渲染/烤字）。
  const bakedText = collectBakedTextAssetIssues(ctx, doc, baselineUnverified);
  if (bakedText.issues.length > 0) {
    const { severity, status } = isPixel1to1(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_asset_baked_text',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        '【素材原子化·P0-A】素材图内烤入 ui-spec 声明文本＝整段界面当背景大图，会与真实组件双渲染/烤字：',
        ...bakedText.issues.map(i => i.detail),
      ].join('\n'),
      suggestion:
        '把整段大图重裁为原子插画（仅图形、无声明文本）；文字/交互控件/底部 tab 用真实组件渲染。营销插画确需含字则设 baked_text_defer + 真人署名。',
      affected_files: [uiSpecRel],
    });
  }
  // round5 P0-A/X4：OCR 是烤字门禁唯一承重探测；pixel_1to1 下不可用不得 WARN 放行 → toolchain BLOCKER（指向"修 OCR 环境"，见 goal-failure-classifier）。
  if (bakedText.ocrUnavailable) {
    const { severity, status } = isPixel1to1(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_ocr_unavailable',
      category: 'structure',
      description: desc,
      severity,
      status,
      details:
        '【P0-A OCR 不可用】烤字门禁的 OCR 承重探测不可用/失败（tesseract.js 未装或 chi_sim 未物化，或素材图 OCR 失败）——pixel_1to1 下无法核验素材是否烤字，不得放行。',
      suggestion:
        '修复 OCR 环境：确认 harness 已装 tesseract.js 且 profiles/hmos-app/vendor/tessdata/chi_sim.traineddata 已物化；恢复后重跑（此 id 归 toolchain，signature 重复即 halt 求人）。',
      affected_files: [uiSpecRel],
    });
  }

  // round5 P0-B（Q5 采纳）：声明 required 品牌图标却用 sys.symbol 系统单色图标静默替代 → pixel_1to1 BLOCKER（含全局底 tab 图标）。
  const iconSubIssues = collectIconSubstitutionIssues(ctx, doc, baselineUnverified);
  if (iconSubIssues.length > 0) {
    const { severity, status } = isPixel1to1(ctx)
      ? fidelityRatchetFailOrWarn(ctx, false)
      : { severity: 'MAJOR' as const, status: 'WARN' as const };
    results.push({
      id: 'visual_parity_icon_substitution',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        '【图标替代·P0-B】ui-spec 声明 required 品牌图标(icon.kind=brand_logo/illustration)，源码却用 sys.symbol 系统单色图标替代：',
        ...iconSubIssues.map(i => i.detail),
      ].join('\n'),
      suggestion:
        '为参考图中的彩色/品牌图标裁原子图标素材并 $r(app.media.<key>) 渲染（含底部 tab 图标）；确需系统单色图标则声明 icon.kind=system_symbol，或显式 placeholder + 真人署名。',
      affected_files: [uiSpecRel],
    });
  }

  // a2 通用 spec 质量：pixel_1to1 P0 action_button 须声明 variant（低优先 WARN，非本案修复路径）
  const variantDeclIssues = collectActionButtonVariantDeclIssues(ctx, doc, baselineUnverified);
  if (variantDeclIssues.length > 0) {
    results.push({
      id: 'visual_parity_variant_decl',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: ['【通用 spec 质量·低置信】', ...variantDeclIssues.map(i => i.detail)].join('\n'),
      suggestion: 'pixel_1to1 P0 屏 action_button 须声明 variant（filled|tonal|outlined|ghost|text）以承载形态保真。',
      affected_files: [uiSpecRel],
    });
  }

  // static fidelity score (K)
  results.push(...computeStaticFidelityScore(ctx, doc, baselineUnverified));

  return results;
}
