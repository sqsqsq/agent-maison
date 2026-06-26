// ============================================================================
// fidelity-governance-check.ts — P0-1 反降级治理（fidelity_target + defer 人工签字）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import {
  detectPixel1to1Intent,
  effectiveAssetAcquisitionMode,
  fidelityRatchetFailOrWarn,
  findUnsignedRefElementDefers,
  isHumanSignedDeferral,
  isP0VisualElementId,
  isPixel1to1,
  loadRefElementsFile,
  parseAssetAcquisitionModeFromHandoffDoc,
  parseFidelityDeferrals,
  parseFidelityTargetFromHandoffDoc,
  refElementsAbsPath,
} from '../../../harness/scripts/utils/fidelity-shared';
import {
  loadUiSpecFile,
  parseVisualHandoffYamlRoot,
  uiSpecAbsPath,
  uiSpecRelPath,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { isGoalHeadlessEnv } from '../../../harness/scripts/utils/phase-state';

function ruleDesc(ctx: CheckContext, id: string): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

/**
 * G2：汇集可扫描的需求文本——spec.md + authoritative_refs 路径所在目录里的 .md（常含原始需求）。
 * homepage「完全参考」强信号在原始需求文档、生成的 spec.md 已丢失，故须回到 ref 目录扫。
 */
function collectIntentScanText(
  projectRoot: string,
  doc: Record<string, unknown> | null,
  specMarkdown: string,
): string {
  const parts: string[] = [specMarkdown];
  const vh = doc?.visual_handoff as Record<string, unknown> | undefined;
  const refs = vh?.authoritative_refs as Array<{ path?: string }> | undefined;
  if (Array.isArray(refs)) {
    const scanned = new Set<string>();
    for (const r of refs) {
      if (typeof r.path !== 'string' || r.path.includes('${')) continue;
      const abs = path.isAbsolute(r.path) ? r.path : path.resolve(projectRoot, r.path);
      const dir = path.dirname(abs);
      if (scanned.has(dir)) continue;
      scanned.add(dir);
      try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        for (const f of fs.readdirSync(dir)) {
          if (f.toLowerCase().endsWith('.md')) {
            parts.push(fs.readFileSync(path.join(dir, f), 'utf-8').slice(0, 20000));
          }
        }
      } catch { /* best-effort */ }
    }
  }
  return parts.join('\n');
}

export function checkFidelityGovernance(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const doc = parseVisualHandoffYamlRoot(specMarkdown);
  if (!doc) {
    return [];
  }
  const fidelityTarget = ctx.fidelityTarget ?? parseFidelityTargetFromHandoffDoc(doc);
  const declaredAsset = ctx.assetAcquisitionMode ?? parseAssetAcquisitionModeFromHandoffDoc(doc);
  const effectiveAsset = ctx.effectiveAssetAcquisitionMode
    ?? effectiveAssetAcquisitionMode(fidelityTarget, declaredAsset);
  const deferrals = ctx.fidelityDeferrals ?? parseFidelityDeferrals(doc);
  const headless = isGoalHeadlessEnv();

  const prdRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const results: CheckResult[] = [];

  results.push({
    id: 'fidelity_target_declared',
    category: 'structure',
    description: ruleDesc(ctx, 'fidelity_target'),
    severity: 'MINOR',
    status: 'PASS',
    details: [
      `fidelity_target=${fidelityTarget}`,
      `asset_acquisition_mode=${declaredAsset}`,
      effectiveAsset !== declaredAsset ? `effective_asset_mode=${effectiveAsset}（pixel_1to1 联动抬升）` : '',
    ].filter(Boolean).join('；'),
    affected_files: [prdRel],
  });

  // G2：扫真实需求文本（spec.md + ref 目录原始需求 md）识别 1:1 意图；命中但档位非 pixel_1to1
  // → headless 视为降级判 BLOCKER（无人可问），交互态 WARN 提示。
  if (fidelityTarget !== 'pixel_1to1') {
    const intentText = collectIntentScanText(ctx.projectRoot, doc, specMarkdown);
    if (detectPixel1to1Intent(intentText)) {
      results.push({
        id: 'fidelity_target_intent_nudge',
        category: 'structure',
        description: ruleDesc(ctx, 'fidelity_target'),
        severity: headless ? 'BLOCKER' : 'MAJOR',
        status: headless ? 'FAIL' : 'WARN',
        details:
          `需求文本含 1:1 还原措辞（完全参考/像素级/严格按图 等）但 fidelity_target=${fidelityTarget}` +
          `${headless ? '；headless 下不得自动降级' : '；疑似档位降级'}。`,
        suggestion: '置 fidelity_target: pixel_1to1（激活全链 ratchet）；headless 须按 §9 求人或判 BLOCKER。',
        affected_files: [prdRel],
      });
    }
  }

  if (fidelityTarget !== 'pixel_1to1') {
    return results;
  }

  // G1：human_signed:true 但 signed_by 为自动化身份（如 goal-mode-auto）= 自签伪造，不算人签。
  const unsignedDeferrals = deferrals.filter(d => !isHumanSignedDeferral(d, { requireExplicitSigner: headless }));
  if (unsignedDeferrals.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    results.push({
      id: 'fidelity_deferrals_human_sign',
      category: 'structure',
      description: ruleDesc(ctx, 'fidelity_deferrals'),
      severity,
      status,
      details:
        `pixel_1to1 下 fidelity_deferrals 须真人签字（human_signed:true 且 signed_by 非自动化身份）；` +
        `未签字/自动化身份冒签（goal-mode-auto 等不算人签）：${unsignedDeferrals.map(d => `${d.element_id}${d.signed_by ? `(signed_by=${d.signed_by})` : ''}`).join(', ')}`,
      suggestion: 'goal-runner 须暂停求人工确认；headless 无真人批准即 BLOCKER（自签不算）。',
      affected_files: [prdRel],
    });
  } else if (deferrals.length > 0) {
    results.push({
      id: 'fidelity_deferrals_human_sign',
      category: 'structure',
      description: ruleDesc(ctx, 'fidelity_deferrals'),
      severity: 'BLOCKER',
      status: 'PASS',
      details: `${deferrals.length} 条 defer 均已 human_signed`,
      affected_files: [prdRel],
    });
  }

  const refAbs = refElementsAbsPath(ctx.projectRoot, ctx.feature);
  const refDoc = fs.existsSync(refAbs) ? loadRefElementsFile(refAbs) : null;
  if (refDoc) {
    const refRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'ref-elements.yaml');
    const deferViolations = findUnsignedRefElementDefers(refDoc, deferrals, { requireExplicitSigner: headless });
    if (deferViolations.length > 0) {
      const { severity, status } = fidelityRatchetFailOrWarn(ctx, false);
      results.push({
        id: 'ref_elements_defer_human_sign',
        category: 'structure',
        description: ruleDesc(ctx, 'fidelity_deferrals'),
        severity,
        status,
        details: `ref-elements.yaml disposition=defer 须映射 fidelity_deferrals 且 human_signed：${deferViolations.join('；')}`,
        affected_files: [prdRel, refRel],
      });
    }
  }

  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (uiDoc) {
    const verified = uiDoc.verified ?? 'unverified';
    const deferredInSpec = (uiDoc.screens ?? []).flatMap(s => s.must_have_elements ?? []);
    const hasDeferredElements = deferredInSpec.length > 0
      || deferrals.some(d => isP0VisualElementId(d.element_id));

    if (verified === 'verified' && hasDeferredElements && unsignedDeferrals.length > 0) {
      const { severity, status } = fidelityRatchetFailOrWarn(ctx, false);
      results.push({
        id: 'fidelity_no_self_defer_verified',
        category: 'structure',
        description: ruleDesc(ctx, 'fidelity_no_self_defer_verified'),
        severity,
        status,
        details: 'pixel_1to1 禁止 spec 自我 defer 且 ui-spec verified=verified；须 human_confirmed 或 vl_multimodal + 无未签字 defer',
        affected_files: [prdRel, uiSpecRel],
      });
    }
  }

  if (effectiveAsset === 'user_dir') {
    const manifestRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'asset-manifest.yaml');
    const manifestPath = path.join(ctx.projectRoot, 'doc', 'features', ctx.feature, 'spec', 'asset-manifest.yaml');
    if (!fs.existsSync(manifestPath)) {
      const { severity, status } = fidelityRatchetFailOrWarn(ctx, !isPixel1to1(ctx));
      results.push({
        id: 'asset_manifest_required',
        category: 'structure',
        description: ruleDesc(ctx, 'asset_manifest'),
        severity,
        status,
        details: `pixel_1to1 联动 user_dir 须产出 ${manifestRel} 向用户索要素材`,
        affected_files: [prdRel],
      });
    }
  }

  return results;
}
