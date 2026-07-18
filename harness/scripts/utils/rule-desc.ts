// ============================================================================
// ruleDesc — 共享的规则描述提取工具
// ============================================================================
// 各 check-*.ts 从 phaseRule 的 structure_checks / semantic_checks /
// traceability_checks 中按 id 取 description（trim 后），缺失时回落到 id 本身。
// 历史上每个 check 脚本都各自定义了一份同构实现，此处收敛为单一 SSOT。
// ============================================================================

import type { CheckContext } from './types';

export type RuleSection =
  | 'structure_checks'
  | 'semantic_checks'
  | 'traceability_checks';

export function ruleDesc(
  ctx: CheckContext,
  section: RuleSection,
  id: string,
): string {
  const checks = ctx.phaseRule[section] as
    | Record<string, { description?: string }>
    | undefined;
  return checks?.[id]?.description?.trim() ?? id;
}
