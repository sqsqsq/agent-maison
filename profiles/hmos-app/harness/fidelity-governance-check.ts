// ============================================================================
// fidelity-governance-check.ts — P0-1 反降级治理（fidelity_target + defer 人工签字）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import {
  effectiveAssetAcquisitionMode,
  fidelityRatchetFailOrWarn,
  findUnsignedRefElementDefers,
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

function ruleDesc(ctx: CheckContext, id: string): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
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

  if (fidelityTarget !== 'pixel_1to1') {
    return results;
  }

  const unsignedDeferrals = deferrals.filter(d => !d.human_signed);
  if (unsignedDeferrals.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    results.push({
      id: 'fidelity_deferrals_human_sign',
      category: 'structure',
      description: ruleDesc(ctx, 'fidelity_deferrals'),
      severity,
      status,
      details:
        `pixel_1to1 下 fidelity_deferrals 须人类签字（human_signed: true）；未签字：${unsignedDeferrals.map(d => d.element_id).join(', ')}`,
      suggestion: 'goal-runner 须暂停求人工确认；headless 无批准即 BLOCKER。',
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
    const deferViolations = findUnsignedRefElementDefers(refDoc, deferrals);
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
