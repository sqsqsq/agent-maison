// ============================================================================
// spec · ui-spec 结构守门（hmos-app / spec.ui_spec capability）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from '../../../harness/scripts/utils/types';
import { relFeatureArtifact } from '../../../harness/config';
import {
  UI_CHANGE_REQUIRES_UI_SPEC,
  collectAllComponentNodes,
  loadUiSpecFile,
  parseUiChangeFromSpecMarkdown,
  structureFailOrWarn,
  uiSpecAbsPath,
  uiSpecRelPath,
  type VisualEnforcementMode,
} from '../../../harness/scripts/utils/ui-spec-shared';
import { missingUiSpecGateScreens } from './ui-spec-gate';
import { validateUiSpecSchema } from './ui-spec-schema-validate';
import { isGoalHeadlessEnv } from '../../../harness/scripts/utils/phase-state';
import { isPixel1to1 } from '../../../harness/scripts/utils/fidelity-shared';
import { readCanaryToolReadSignal } from '../../../harness/scripts/utils/multimodal-probe';
import { loadFrameworkConfig } from '../../../harness/config';

function ruleDesc(
  ctx: CheckContext,
  section: 'structure_checks' | 'semantic_checks' | 'traceability_checks',
  id: string,
): string {
  const checks = ctx.phaseRule[section] as Record<string, { description: string }>;
  return checks?.[id]?.description?.trim() ?? id;
}

function skipResult(desc: string, prdRel: string, details: string): CheckResult {
  return {
    id: 'ui_spec_structure',
    category: 'structure',
    description: desc,
    severity: 'MINOR',
    status: 'SKIP',
    details,
    affected_files: [prdRel],
  };
}

/** 供 harness / 白盒单测调用 */
export function checkUiSpecStructure(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const enforcement = ctx.uiSpecEnforcement as VisualEnforcementMode | undefined;
  const desc = ruleDesc(ctx, 'structure_checks', 'ui_spec_structure');
  const prdRel = relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md');
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);

  if (ctx.skipUiSpec) {
    const audit = process.env.HARNESS_SKIP_UI_SPEC_REASON || '（未设置 HARNESS_SKIP_UI_SPEC_REASON）';
    return [{
      id: 'ui_spec_structure',
      category: 'structure',
      description: desc,
      severity: 'MINOR',
      status: 'SKIP',
      details: `已跳过 ui-spec 检查（--skip-ui-spec）。审计说明：${audit}`,
      affected_files: [prdRel, uiSpecRel],
    }];
  }

  if (enforcement === 'off') {
    return [skipResult(desc, prdRel, 'framework.config.json 中 spec.ui_spec_enforcement=off')];
  }

  const uiChange = parseUiChangeFromSpecMarkdown(specMarkdown);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    if (enforcement === undefined) {
      return [];
    }
    if (uiChange && !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
      return [{
        id: 'ui_spec_structure',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'PASS',
        details: `ui_change=${uiChange}：不要求 ui-spec.yaml。`,
        affected_files: [prdRel],
      }];
    }
    if (enforcement === 'strict') {
      return [{
        id: 'ui_spec_structure',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details: 'ui_change=new_or_changed 但未找到 ui-spec.yaml；已 opt-in spec.ui_spec_enforcement=strict。',
        suggestion: `产出 ${uiSpecRel}，见 ui-spec.md。`,
        affected_files: [prdRel, uiSpecRel],
      }];
    }
    return [{
      id: 'ui_spec_structure',
      category: 'structure',
      description: desc,
      severity: 'MAJOR',
      status: 'WARN',
      details: 'ui_change 要求 UI 形态但未检测到 ui-spec.yaml；参见 ui-spec.md。',
      affected_files: [prdRel, uiSpecRel],
    }];
  }

  const absPath = uiSpecAbsPath(ctx.projectRoot, ctx.feature);
  if (!fs.existsSync(absPath)) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'ui_spec_structure',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `ui_change=${uiChange} 要求 ui-spec.yaml，但 ${uiSpecRel} 不存在。`,
      suggestion: 'spec Step 2 须产出 ui-spec.yaml（组件树 + token + 资产 + 逐字文案）。',
      affected_files: [prdRel, uiSpecRel],
    }];
  }

  const doc = loadUiSpecFile(absPath);
  if (!doc) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'ui_spec_structure',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: `${uiSpecRel} 存在但 YAML 解析失败。`,
      affected_files: [uiSpecRel],
    }];
  }

  const issues: string[] = [];
  const warnings: string[] = [];

  // 运行时 schema 校验（enum/类型/additionalProperties），对照 ui-spec.schema.json
  for (const e of validateUiSpecSchema(doc)) {
    issues.push(`schema: ${e}`);
  }

  const tokens = doc.tokens;
  if (!tokens || typeof tokens !== 'object' || Object.keys(tokens).length === 0) {
    issues.push('tokens 须为非空对象');
  }

  for (const a of doc.assets ?? []) {
    if (!a?.key) {
      issues.push('assets[] 每项须含 key');
      continue;
    }
    const hasPath = typeof a.resolved_path === 'string' && a.resolved_path.trim().length > 0;
    const isPlaceholder = Boolean(a.placeholder);
    if (!hasPath && !isPlaceholder) {
      issues.push(`asset ${a.key}：须 resolved_path 或 placeholder: true + rationale`);
    }
    if (isPlaceholder && (!a.rationale || !String(a.rationale).trim())) {
      issues.push(`asset ${a.key}：placeholder 须含 rationale`);
    }
    if (hasPath) {
      const resolved = path.resolve(ctx.projectRoot, a.resolved_path as string);
      if (!fs.existsSync(resolved)) {
        warnings.push(`asset ${a.key}：resolved_path 不存在 ${a.resolved_path}`);
      }
    }
  }

  for (const s of doc.screens ?? []) {
    if (!s.id || !s.priority) {
      issues.push('screens[] 每项须含 id 与 priority');
      continue;
    }
    const isLight = Boolean(s.lightweight) || s.priority === 'P2' || s.priority === 'P3';
    if (!isLight && !s.root) {
      issues.push(`screen ${s.id}（${s.priority}）：须含 root 组件树`);
    }
    if (s.priority === 'P0' && s.root) {
      const nodes = collectAllComponentNodes({ screens: [s], tokens: {}, assets: [] } as typeof doc);
      const withText = nodes.filter(n => typeof n.text === 'string' && n.text.trim());
      if (withText.length === 0) {
        warnings.push(`screen ${s.id}：P0 屏建议含逐字 text 节点`);
      }
      const withBbox = nodes.filter(n => Array.isArray(n.bbox) && n.bbox.length === 4);
      if (withBbox.length === 0) {
        warnings.push(`screen ${s.id}：P0 屏建议含 bbox（原图 ground truth）`);
      }
      // P2：P0 屏所有非容器节点（含深层嵌套）应写 id，否则 plan visual-parity coverage 无法要求其映射
      const nodesNoId = nodes.filter(n => n.type !== 'navigation_frame' && !n.id);
      const childrenNoId = nodesNoId.map(n => n.type);
      if (childrenNoId.length > 0) {
        warnings.push(
          `screen ${s.id}：P0 屏有 ${childrenNoId.length} 个子节点缺 id（${childrenNoId.slice(0, 3).join(',')}…），` +
          `visual-parity 无法要求映射，结构核对会留盲区；建议为关键节点补 id。`,
        );
      }
    }
  }

  const verified = doc.verified ?? 'unverified';
  if (verified === 'verified') {
    const method = (doc.verified_method ?? '').trim();
    if (!method || method === 'none') {
      issues.push('verified=verified 时 verified_method 须为 vl_multimodal，不得为 none/空');
    } else if (method === 'human_gate') {
      issues.push('verified=verified 与 human_gate 不匹配；人工 gate 须用 verified: human_confirmed');
    } else if (method !== 'vl_multimodal') {
      issues.push(`verified_method 非法：${method}（verified=verified 时须 vl_multimodal）`);
    }
  }
  if (verified === 'unverified') {
    warnings.push(
      'ui-spec verified=unverified：DSL 未过原图 gate；下游 parity 只报结构不报保真。',
    );
  }

  if (issues.length > 0) {
    const { severity, status } = structureFailOrWarn(enforcement);
    return [{
      id: 'ui_spec_structure',
      category: 'structure',
      description: desc,
      severity,
      status,
      details: issues.join('；'),
      affected_files: [uiSpecRel],
    }];
  }

  const detailParts = [
    `ui_change=${uiChange}；screens=${doc.screens?.length ?? 0}；tokens=${Object.keys(tokens ?? {}).length}；assets=${doc.assets?.length ?? 0}；verified=${verified}`,
    '本规则只查结构完整，非对图保真（保真由 DSL gate + 静态分 + 渲染 diff 承担）。',
  ];
  if (warnings.length > 0) {
    detailParts.push(`提示：${warnings.join('；')}`);
  }

  // 有 warning 时一律降级（不得 PASS）；严格度随档位：strict 视为完整性缺陷 → MAJOR，
  // warn/reachable → MAJOR/WARN。修复历史反向逻辑：此前 strict 下 warning 反而落 PASS。
  const hasWarn = warnings.length > 0;
  return [{
    id: 'ui_spec_structure',
    category: 'structure',
    description: desc,
    severity: hasWarn ? 'MAJOR' : 'BLOCKER',
    status: hasWarn ? 'WARN' : 'PASS',
    details: detailParts.join('\n'),
    affected_files: [uiSpecRel],
  }];
}

/** DSL↔原图校验 gate（人工 / 多模态） */
export function checkUiSpecFidelityGate(ctx: CheckContext, specMarkdown: string): CheckResult[] {
  const uiChange = parseUiChangeFromSpecMarkdown(specMarkdown);
  if (!uiChange || !UI_CHANGE_REQUIRES_UI_SPEC.has(uiChange)) {
    return [];
  }
  const desc = ruleDesc(ctx, 'structure_checks', 'ui_spec_fidelity_gate');
  const uiSpecRel = uiSpecRelPath(ctx.projectRoot, ctx.feature);
  const doc = loadUiSpecFile(uiSpecAbsPath(ctx.projectRoot, ctx.feature));
  if (!doc) {
    return [];
  }
  const verified = doc.verified ?? 'unverified';
  if (verified === 'verified') {
    const method = (doc.verified_method ?? '').trim();
    if (!method || method === 'none' || method === 'human_gate') {
      const soft = ctx.uiSpecEnforcement === 'warn' || ctx.uiSpecEnforcement === 'reachable';
      const hint = method === 'human_gate'
        ? 'human_gate 须配合 verified: human_confirmed'
        : `须 vl_multimodal，收到 ${method || '(empty)'}`;
      return [{
        id: 'ui_spec_fidelity_gate',
        category: 'structure',
        description: desc,
        severity: soft ? 'MAJOR' : 'BLOCKER',
        status: soft ? 'WARN' : 'FAIL',
        details: `ui-spec verified=verified 但 verified_method 无效（${hint}）`,
        affected_files: [uiSpecRel],
      }];
    }
    return [{
      id: 'ui_spec_fidelity_gate',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: `ui-spec verified=${verified}（method=${doc.verified_method ?? 'n/a'}）`,
      affected_files: [uiSpecRel],
    }];
  }
  if (verified === 'human_confirmed') {
    // G1：headless goal-mode 无交互真人，verified: human_confirmed 必为自我认证人工
    // （homepage「headless auto · 待人工复核」却标 human_confirmed 即此）。**任何档位**下都
    // 不得在 headless 自签人工 gate；须改 vl_multimodal（诚实标 VL 核对）或留待真人逐屏 [x] 确认。
    if (isGoalHeadlessEnv()) {
      return [{
        id: 'ui_spec_fidelity_gate',
        category: 'structure',
        description: desc,
        severity: 'BLOCKER',
        status: 'FAIL',
        details:
          'headless goal-mode 无交互真人，verified: human_confirmed 系自我认证人工；pixel_1to1 下不允许自签人工 gate。',
        suggestion:
          '改 verified: verified + verified_method: vl_multimodal（VL 多模态核对，不冒称人工）；或留待真人逐屏 [x] 确认后再标 human_confirmed。',
        affected_files: [uiSpecRel],
      }];
    }
    const missing = missingUiSpecGateScreens(doc, specMarkdown);
    if (missing.length > 0) {
      const soft = ctx.uiSpecEnforcement === 'warn' || ctx.uiSpecEnforcement === 'reachable';
      return [{
        id: 'ui_spec_fidelity_gate',
        category: 'structure',
        description: desc,
        severity: soft ? 'MAJOR' : 'BLOCKER',
        status: soft ? 'WARN' : 'FAIL',
        details:
          `ui-spec verified=human_confirmed 但 spec.md 缺逐屏 [x] gate 证据：${missing.join(', ')}`,
        suggestion: '在 spec.md 增加 UI-spec gate 段，逐 P0 屏写 `- [x] <screen_id>`。',
        affected_files: [uiSpecRel, relFeatureArtifact(ctx.projectRoot, ctx.feature, 'spec.md')],
      }];
    }
    return [{
      id: 'ui_spec_fidelity_gate',
      category: 'structure',
      description: desc,
      severity: 'BLOCKER',
      status: 'PASS',
      details: `ui-spec verified=human_confirmed；spec gate [x] 已覆盖 P0 屏（method=${doc.verified_method ?? 'human_gate'}）`,
      affected_files: [uiSpecRel],
    }];
  }
  const soft = ctx.uiSpecEnforcement === 'warn' || ctx.uiSpecEnforcement === 'reachable';
  // t6⑥（plan c6d8f2b4）：pixel_1to1 + 真视觉实测在位（fresh canary verdict=tool_read；
  // ocr_capable 不算——其语义=仅文字题对、vision 仍 none）→ unverified 一律 BLOCKER，
  // 软档不豁免（bc-openCard 实证：unverified WARN 放行 → 几何合同空白 spec 流入下游）。
  // 盲/ocr_capable 宿主不升级，继续按 d4a8f3c6 降级阶梯钳制，零新增噪声。
  let sightedPixel1to1 = false;
  if (isPixel1to1(ctx)) {
    try {
      const adapterName = loadFrameworkConfig(ctx.projectRoot).agent_adapter;
      sightedPixel1to1 = readCanaryToolReadSignal(ctx.projectRoot, adapterName);
    } catch {
      sightedPixel1to1 = false; // 配置不可读 → 不升级（保守，不新增噪声）
    }
  }
  return [{
    id: 'ui_spec_fidelity_gate',
    category: 'structure',
    description: desc,
    severity: sightedPixel1to1 ? 'BLOCKER' : soft ? 'MAJOR' : 'BLOCKER',
    status: sightedPixel1to1 ? 'FAIL' : soft ? 'WARN' : 'FAIL',
    details: sightedPixel1to1
      ? 'ui-spec verified=unverified 且宿主真视觉实测在位（canary tool_read）+ fidelity_target=pixel_1to1：' +
        '有视觉能力却不核对 ui-spec 与原图，无软档豁免——未验真的 spec 流入下游是几何盲区根因之一（t6⑥）。'
      : 'ui-spec verified=unverified：未经人工 [x] gate 或多模态核对，不得作为保真基线进 plan（可降级继续但须显式标注）。',
    suggestion: '逐屏人工确认 ui-spec 与原图一致，设 verified: human_confirmed；或用 VL 多模态 gate。',
    affected_files: [uiSpecRel],
  }];
}
