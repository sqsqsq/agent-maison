// ============================================================================
// capture-completeness-check.ts — P0-2 捕获完整性（分母=ref-elements.yaml）
// ============================================================================

import * as fs from 'fs';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import {
  fidelityRatchetFailOrWarn,
  loadRefElementsFile,
  refElementsAbsPath,
  type RefElementEntry,
} from '../../../harness/scripts/utils/fidelity-shared';
import {
  collectAllComponentNodes,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  UI_CHANGE_REQUIRES_UI_SPEC,
  uiSpecAbsPath,
  uiSpecRelPath,
} from '../../../harness/scripts/utils/ui-spec-shared';

function ruleDesc(ctx: CheckContext): string {
  const checks = ctx.phaseRule.structure_checks as Record<string, { description: string }>;
  return checks?.capture_completeness?.description?.trim() ?? 'capture_completeness';
}

function uiSpecCoversElement(
  elementId: string,
  nodeIds: Set<string>,
  mustHave: Set<string>,
): boolean {
  if (nodeIds.has(elementId) || mustHave.has(elementId)) return true;
  const lower = elementId.toLowerCase();
  for (const id of nodeIds) {
    if (id.toLowerCase() === lower) return true;
  }
  for (const id of mustHave) {
    if (id.toLowerCase() === lower) return true;
  }
  return false;
}

function denominatorElements(refElements: RefElementEntry[]): RefElementEntry[] {
  return refElements.filter(e => e.disposition !== 'defer');
}

export function checkCaptureCompleteness(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const uiChange = parseUiChangeFromSpecMarkdown(specMarkdown);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }

  const refRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'ref-elements.yaml');
  const refAbs = refElementsAbsPath(ctx.projectRoot, ctx.feature);
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const desc = ruleDesc(ctx);

  if (ctx.fidelityTarget !== 'pixel_1to1') {
    if (!fs.existsSync(refAbs)) {
      return [{
        id: 'capture_completeness',
        category: 'structure',
        description: desc,
        severity: 'MINOR',
        status: 'SKIP',
        details: 'semantic_layout 下 ref-elements.yaml 可选；pixel_1to1 下必填',
        affected_files: [refRel, uiSpecRel],
      }];
    }
  } else if (!fs.existsSync(refAbs)) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, false);
    return [{
      id: 'capture_completeness',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `pixel_1to1 须产出参考图侧独立枚举 ${refRel}（分母不得取自 ui-spec 自身）`,
      suggestion: 'spec 分区扫描模板逐元素 implement|defer，落 spec/ref-elements.yaml',
      affected_files: [refRel, uiSpecRel],
    }];
  }

  const refDoc = loadRefElementsFile(refAbs);
  if (!refDoc) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, ctx.fidelityTarget !== 'pixel_1to1');
    return [{
      id: 'capture_completeness',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `${refRel} 存在但 YAML 解析失败或缺少 elements[]`,
      affected_files: [refRel],
    }];
  }

  const uiDoc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!uiDoc) {
    return [];
  }

  const nodes = collectAllComponentNodes(uiDoc);
  const nodeIds = new Set(nodes.map(n => n.id).filter((id): id is string => Boolean(id)));
  const mustHave = new Set(
    (uiDoc.screens ?? []).flatMap(s => s.must_have_elements ?? []),
  );

  const denom = denominatorElements(refDoc.elements);
  if (denom.length === 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, true);
    return [{
      id: 'capture_completeness',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `${refRel} elements 为空；参考图侧枚举不得为空`,
      affected_files: [refRel],
    }];
  }

  const missing: string[] = [];
  for (const el of denom) {
    if (el.disposition === 'defer') continue;
    if (!uiSpecCoversElement(el.element_id, nodeIds, mustHave)) {
      missing.push(el.element_id);
    }
  }

  const covered = denom.length - missing.length;
  const ratio = covered / denom.length;
  const ratioPct = (ratio * 100).toFixed(0);

  if (missing.length > 0) {
    const { severity, status } = fidelityRatchetFailOrWarn(ctx, ratio >= 0.85);
    return [{
      id: 'capture_completeness',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: [
        `参考图枚举覆盖 ${covered}/${denom.length}（${ratioPct}%）`,
        `ui-spec/must_have 未覆盖：${missing.slice(0, 12).join(', ')}${missing.length > 12 ? '…' : ''}`,
        '【边界】依赖 VL 视觉枚举，非 100% 上限；被动漏看由 testing 双向 diff 兜底。',
      ].join('\n'),
      affected_files: [refRel, uiSpecRel],
    }];
  }

  return [{
    id: 'capture_completeness',
    category: 'structure',
    description: desc,
    severity: 'BLOCKER',
    status: 'PASS',
    details: `参考图枚举 ${denom.length} 项均已映射到 ui-spec/must_have（${ratioPct}%）`,
    affected_files: [refRel, uiSpecRel],
  }];
}
