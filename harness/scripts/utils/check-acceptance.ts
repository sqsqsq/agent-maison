// ============================================================================
// check-acceptance.ts — acceptance.yaml 结构级门禁（多阶段复用）
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';
import type { CheckContext, CheckResult } from './types';
import {
  VALID_UT_LAYERS,
  acceptanceYamlRel,
  acceptanceYamlPath,
  collectDeviceScopeIds,
  hasNonEmptyFocus,
  isDeviceUtLayer,
  isUnitUtLayer,
  legacyDeviceTestingTodoPath,
  legacyTodoFileExists,
  normalizeUtLayer,
} from './acceptance-layering';

// 与各 phase checker 的 ruleDesc 签名对齐（section 为 phase-rules YAML 桶名）
type RuleDescFn = (ctx: CheckContext, section: string, id: string) => string;

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function checkAcceptanceYamlPresent(
  ctx: CheckContext,
  ruleDesc: RuleDescFn,
): CheckResult[] {
  const id = 'acceptance_yaml_present';
  const rel = acceptanceYamlRel(ctx.feature);
  if (!ctx.featureSpec.acceptance) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${rel} 不存在或无法解析。`,
      suggestion: '按 Skill 1 §6 从 PRD 提取 acceptance.yaml（含 ut_layer / ut_focus / device_focus）。',
    }];
  }
  if (!fs.existsSync(acceptanceYamlPath(ctx.projectRoot, ctx.feature))) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `磁盘上缺少 ${rel}。`,
    }];
  }
  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `${rel} 已存在。`,
  }];
}

export function checkAcceptanceUtLayerComplete(
  ctx: CheckContext,
  ruleDesc: RuleDescFn,
): CheckResult[] {
  const id = 'acceptance_ut_layer_complete';
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'acceptance.yaml 不可用。',
    }];
  }

  const issues: string[] = [];
  for (const c of acceptance.criteria ?? []) {
    const layer = normalizeUtLayer(c.ut_layer);
    if (!layer) {
      issues.push(`${c.id}: ut_layer 非法或缺失（允许：${VALID_UT_LAYERS.join(', ')}）`);
    }
  }
  for (const b of acceptance.boundaries ?? []) {
    const layer = normalizeUtLayer(b.ut_layer);
    if (!layer) {
      issues.push(`${b.id}: ut_layer 非法或缺失（允许：${VALID_UT_LAYERS.join(', ')}）`);
    }
  }

  if (issues.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${issues.length} 条 ut_layer 不合规：\n${issues.slice(0, 15).join('\n')}`,
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `全部 ${(acceptance.criteria?.length ?? 0) + (acceptance.boundaries?.length ?? 0)} 条 AC/BD 均有合法 ut_layer。`,
  }];
}

export function checkAcceptanceDeviceFocusPresent(
  ctx: CheckContext,
  ruleDesc: RuleDescFn,
): CheckResult[] {
  const id = 'acceptance_device_focus_present';
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'SKIP',
      details: 'acceptance.yaml 不可用。',
    }];
  }

  const missing: string[] = [];
  const unitOnlyDeviceFocus: string[] = [];

  const scan = (
    itemId: string,
    utLayer: string | undefined,
    utFocus?: string,
    deviceFocus?: string,
  ) => {
    const layer = normalizeUtLayer(utLayer);
    if (layer === 'unit' && hasNonEmptyFocus(deviceFocus)) {
      unitOnlyDeviceFocus.push(`${itemId}: ut_layer=unit 不应填写 device_focus`);
    }
    if (isDeviceUtLayer(utLayer) && !hasNonEmptyFocus(deviceFocus)) {
      missing.push(`${itemId} (ut_layer=${utLayer ?? '?'})`);
    }
    if (layer === 'both') {
      if (!hasNonEmptyFocus(utFocus)) {
        missing.push(`${itemId}: ut_layer=both 缺少 ut_focus`);
      }
      if (!hasNonEmptyFocus(deviceFocus)) {
        missing.push(`${itemId}: ut_layer=both 缺少 device_focus`);
      }
    }
    if (isUnitUtLayer(utLayer) && layer !== 'both' && !hasNonEmptyFocus(utFocus)) {
      missing.push(`${itemId}: ut_layer=${layer ?? 'unit(默认)'} 缺少 ut_focus`);
    }
  };

  for (const c of acceptance.criteria ?? []) {
    scan(c.id, c.ut_layer, c.ut_focus, (c as { device_focus?: string }).device_focus);
  }
  for (const b of acceptance.boundaries ?? []) {
    scan(b.id, b.ut_layer, b.ut_focus, (b as { device_focus?: string }).device_focus);
  }

  const allIssues = [...unitOnlyDeviceFocus, ...missing];
  if (allIssues.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'BLOCKER',
      status: 'FAIL',
      details: `${allIssues.length} 条 device_focus / ut_focus 不合规：\n${allIssues.slice(0, 15).join('\n')}`,
      suggestion:
        'ut_layer=device|both 必填 device_focus；both 须同时填写 ut_focus 与 device_focus（禁止混写在单段 ut_focus）。',
    }];
  }

  const deviceCount = collectDeviceScopeIds(acceptance).length;
  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'BLOCKER',
    status: 'PASS',
    details: `device/both 共 ${deviceCount} 条均已声明 device_focus（及 both 的 ut_focus）。`,
  }];
}

/** 过渡期：仍存在 legacy todo 且无完整 device_focus 时 WARN */
export function checkLegacyDeviceTestingTodoDeprecation(
  ctx: CheckContext,
  ruleDesc: RuleDescFn,
): CheckResult[] {
  const id = 'legacy_device_testing_todo_deprecated';
  const acceptance = ctx.featureSpec.acceptance;
  if (!acceptance) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MINOR',
      status: 'SKIP',
      details: 'acceptance.yaml 不可用。',
    }];
  }

  if (!legacyTodoFileExists(ctx.projectRoot, ctx.feature)) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MINOR',
      status: 'PASS',
      details: '未检测到 legacy device-testing-todo.md。',
    }];
  }

  const relTodo = path.relative(ctx.projectRoot, legacyDeviceTestingTodoPath(ctx.projectRoot, ctx.feature)).replace(/\\/g, '/');
  const deviceIds = collectDeviceScopeIds(acceptance);
  const missingFocus = deviceIds.filter(id => {
    const c = acceptance.criteria?.find(x => x.id === id);
    const b = acceptance.boundaries?.find(x => x.id === id);
    const item = c ?? b;
    if (!item) return false;
    return !hasNonEmptyFocus((item as { device_focus?: string }).device_focus);
  });

  if (missingFocus.length > 0) {
    return [{
      id,
      category: 'structure',
      description: ruleDesc(ctx, 'structure_checks', id),
      severity: 'MINOR',
      status: 'WARN',
      details:
        `仍存在 ${relTodo}，且 ${missingFocus.length} 条 device 层 AC/BD 尚未在 acceptance.yaml 填写 device_focus。\n` +
        'Framework 已废弃 todo 交接物：请将真机要点写入 acceptance.yaml > device_focus 后删除 todo。',
      suggestion: `待迁移 id 示例：${missingFocus.slice(0, 8).join(', ')}`,
    }];
  }

  return [{
    id,
    category: 'structure',
    description: ruleDesc(ctx, 'structure_checks', id),
    severity: 'MINOR',
    status: 'WARN',
    details:
      `仍存在 ${relTodo}，但 acceptance.yaml 已具备 device_focus。请删除 legacy 文件以免 AI 误读双源清单。`,
  }];
}

export function runAcceptanceYamlStructureChecks(
  ctx: CheckContext,
  ruleDesc: RuleDescFn,
): CheckResult[] {
  const results: CheckResult[] = [];
  results.push(...checkAcceptanceYamlPresent(ctx, ruleDesc));
  if (!ctx.featureSpec.acceptance) return results;
  results.push(...checkAcceptanceUtLayerComplete(ctx, ruleDesc));
  results.push(...checkAcceptanceDeviceFocusPresent(ctx, ruleDesc));
  results.push(...checkLegacyDeviceTestingTodoDeprecation(ctx, ruleDesc));
  return results;
}

/** option_a（L3 不可测）：对应 acceptance 条目须声明非空 device_focus */
export function acceptanceHasDeviceFocusRef(
  acceptance: NonNullable<CheckContext['featureSpec']['acceptance']>,
  acceptanceId: string,
): boolean {
  const needle = acceptanceId.trim();
  for (const c of acceptance.criteria ?? []) {
    if (c.id === needle && hasNonEmptyFocus((c as { device_focus?: string }).device_focus)) return true;
  }
  for (const b of acceptance.boundaries ?? []) {
    if (b.id === needle && hasNonEmptyFocus((b as { device_focus?: string }).device_focus)) return true;
  }
  return false;
}
