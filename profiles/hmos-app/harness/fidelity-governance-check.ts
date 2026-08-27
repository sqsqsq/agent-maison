// ============================================================================
// fidelity-governance-check.ts — P0-1 反降级治理（fidelity_target + strict defer）
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
  isP0VisualElementId,
  isHardPixelContract,
  loadRefElementsFile,
  parseAssetAcquisitionModeFromHandoffDoc,
  parseFidelityDeferrals,
  parseFidelityTargetFromHandoffDoc,
  refElementsAbsPath,
  refElementsRelPath,
  assetManifestAbsPath,
} from '../../../harness/scripts/utils/fidelity-shared';
import {
  loadUiSpecFile,
  parseVisualHandoffYamlRoot,
  uiSpecAbsPath,
  uiSpecRelPath,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { isGoalHeadlessEnv } from '../../../harness/scripts/utils/phase-state';
import { resolveEffectiveVisionContext } from '../../../harness/scripts/utils/effective-vision-context';

/** 钳制只由当前执行能力造成；产物质量不会再生成第二种“策略盲”。 */
function describeClampCause(ctx: CheckContext): string {
  const noOcr = ctx.fidelityClampReason === 'no_vision_no_ocr';
  const fallback = noOcr ? '当前宿主无视觉能力且 OCR 不可用' : '当前宿主无视觉能力（OCR 辅助）';
  try {
    const vision = resolveEffectiveVisionContext({
      projectRoot: ctx.projectRoot,
      feature: ctx.feature,
      frameworkRoot: ctx.frameworkRoot,
    });
    const probed = vision.vision_capability.verdict;
    if (probed === 'none') {
      return `${fallback}（能力实测=none）`;
    }
    if (probed === 'unknown') {
      return (
        '**视觉能力尚未证实（unknown，非"已确认无能力"）→ 保守降级**：' +
        `${noOcr ? '且 OCR 不可用；' : ''}尚未拿到金丝雀实测结论，故按盲档保守跑——` +
        '先把能力探出来（goal 模式 `--refresh-vision-probe` 强制重探），' +
        '探到有视觉即自动回升；此刻**不能**据此断言宿主看不见，也不必先换模型'
      );
    }
    return (
      `当前能力解析为 ${probed}，与落盘 clamp 不一致；请重新运行 initializer 刷新 capability snapshot。`
    );
  } catch {
    return fallback;
  }
}

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
  // E2（多模态降级阶梯 plan d4a8f3c6）：fidelityTarget 现为**能力钳制后的有效档位**；
  // declaredFidelityTarget 是原始声明（未钳制时与 fidelityTarget 相同）。区分"能力钳制的合法
  // 降级"与"agent 擅自降级"——只有后者才是本文件要拦的违规。
  const declaredFidelityTarget = ctx.declaredFidelityTarget ?? fidelityTarget;
  const capabilityClamped = Boolean(ctx.fidelityClamped);
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
      // E2④：钳制事实在首屏显著提示（goal report / summary 最先读到的 check）。
      // 注意：「能力钳制」四字是**下游消费方契约**（harness-runner 据此产
      // fidelity_capability_clamped readiness signal），不得改写；t5 只改其后的**成因描述**。
      capabilityClamped
        ? `（能力钳制：desired=${declaredFidelityTarget} 因${describeClampCause(ctx)}钳至 ${fidelityTarget}；` +
          '成因消除后可 ratchet 回升，desired 已保留不受影响）'
        : '',
      `asset_acquisition_mode=${declaredAsset}`,
      effectiveAsset !== declaredAsset ? `effective_asset_mode=${effectiveAsset}（pixel_1to1 联动抬升）` : '',
    ].filter(Boolean).join('；'),
    affected_files: [prdRel],
  });

  // G2：扫真实需求文本（spec.md + ref 目录原始需求 md）识别 1:1 意图；命中但档位非 pixel_1to1
  // → headless 视为降级判 BLOCKER（无人可问），交互态 WARN 提示。
  // E2③（cursor 硬冲突修正）：capabilityClamped=true 时这不是"agent 擅自降级"，是能力天花板钳制
  // 的合法结果——continuing to BLOCKER 会把"没有视觉能力"的宿主判定为永远无法通过 spec 的死局，
  // 与"不能异常中断"的目标直接冲突。
  // 【P1 修正（codex review）】"合法钳制"的前提是 declared 本身就诚实声明了 pixel_1to1——若
  // declared 早已是 semantic_layout（agent 自己没有如实声明 1:1 意图，与能力钳制无关的独立
  // 违规），即便之后又被能力进一步钳到更低档，也不能算"desired 已保留 pixel_1to1"（那是假话）；
  // 这种情况仍须走 intent_nudge 追责，只是在 details 里如实附注"即便声明 pixel_1to1 环境也会
  // 钳到 X"，不让 agent 以"反正钳了"为由不诚实声明。
  if (fidelityTarget !== 'pixel_1to1') {
    const intentText = collectIntentScanText(ctx.projectRoot, doc, specMarkdown);
    if (detectPixel1to1Intent(intentText)) {
      if (capabilityClamped && declaredFidelityTarget === 'pixel_1to1') {
        results.push({
          id: 'fidelity_target_capability_clamped',
          category: 'structure',
          description: ruleDesc(ctx, 'fidelity_target'),
          severity: 'MINOR',
          status: 'PASS',
          details:
            `需求文本含 1:1 还原措辞，desired fidelity_target 保留 pixel_1to1（供 ratchet 回升）` +
            `但当前宿主能力钳制有效档位为 ${fidelityTarget}——这是合法的能力降级，非 agent 违规。`,
          suggestion: '更换具备视觉能力的 adapter/模型，或修复 OCR 环境后重跑，档位会自动回升。',
          affected_files: [prdRel],
        });
      } else {
        const clampNote = capabilityClamped
          ? `（即便如实声明 pixel_1to1，当前宿主能力也会将其钳至 ${fidelityTarget}——但仍须如实
声明，否则能力恢复后 ratchet 无法自动回升）`.replace(/\n/g, '')
          : '';
        results.push({
          id: 'fidelity_target_intent_nudge',
          category: 'structure',
          description: ruleDesc(ctx, 'fidelity_target'),
          severity: headless ? 'BLOCKER' : 'MAJOR',
          status: headless ? 'FAIL' : 'WARN',
          details:
            `需求文本含 1:1 还原措辞（完全参考/像素级/严格按图 等）但 fidelity_target=${fidelityTarget}` +
            `${headless ? '；headless 下不得自动降级' : '；疑似档位降级'}${clampNote}。`,
          suggestion: '置 fidelity_target: pixel_1to1（激活全链 ratchet）；当前能力不足则按 capability-missing defer。',
          affected_files: [prdRel],
        });
      }
    }
  }

  // strict pixel contract 不允许把 required visual element 降成 defer。best_effort 的 defer
  // 仍可作为显式债务，由债务/披露链承载；任何 human_signed/signed_by 仅为 legacy provenance。
  if (!(fidelityTarget === 'pixel_1to1' && ctx.acceptanceStrictness === 'hard')) {
    return results;
  }

  const strictDeferrals = deferrals;
  if (strictDeferrals.length > 0) {
    results.push({
      id: 'fidelity_deferrals_strict_contract',
      category: 'structure',
      description: ruleDesc(ctx, 'fidelity_deferrals'),
      severity: 'BLOCKER',
      status: 'FAIL',
      details:
        `pixel_1to1 + hard 下 required visual element 不得 defer：${strictDeferrals.map(d => d.element_id).join(', ')}；` +
        'legacy human_signed/signed_by 不改变质量结论。',
      suggestion: '实现并机器验证这些元素；若需求目标确需降低，作为 correction/successor 输入重新冻结需求。',
      affected_files: [prdRel],
    });
  }

  const refAbs = refElementsAbsPath(ctx.projectRoot, ctx.feature);
  const refDoc = fs.existsSync(refAbs) ? loadRefElementsFile(refAbs) : null;
  if (refDoc) {
    const refRel = refElementsRelPath(ctx.projectRoot, ctx.feature);
    const deferViolations = findUnsignedRefElementDefers(refDoc, deferrals, { requireExplicitSigner: headless });
    if (deferViolations.length > 0) {
      const { severity, status } = fidelityRatchetFailOrWarn(ctx, false);
      results.push({
        id: 'ref_elements_strict_defer',
        category: 'structure',
        description: ruleDesc(ctx, 'fidelity_deferrals'),
        severity,
        status,
        details: `pixel_1to1 + hard 下 ref-elements.yaml disposition=defer 不可由人签放行：${deferViolations.join('；')}`,
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

    if (verified === 'verified' && hasDeferredElements && strictDeferrals.length > 0) {
      const { severity, status } = fidelityRatchetFailOrWarn(ctx, false);
      results.push({
        id: 'fidelity_no_self_defer_verified',
        category: 'structure',
        description: ruleDesc(ctx, 'fidelity_no_self_defer_verified'),
        severity,
        status,
        details: 'pixel_1to1 禁止 spec 自我 defer 且 ui-spec verified=verified；须当前 hash-bound vl_multimodal 机器证据且不存在 strict defer，legacy human_confirmed 无效',
        affected_files: [prdRel, uiSpecRel],
      });
    }
  }

  if (effectiveAsset === 'user_dir') {
    const manifestRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'asset-manifest.yaml');
    const manifestPath = assetManifestAbsPath(ctx.projectRoot, ctx.feature);
    if (!fs.existsSync(manifestPath)) {
      const { severity, status } = fidelityRatchetFailOrWarn(ctx, !isHardPixelContract(ctx));
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
