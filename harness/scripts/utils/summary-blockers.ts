// ============================================================================
// summary-blockers.ts — CheckResult[] → summary.json blockers[] 映射（可测纯函数）
// ----------------------------------------------------------------------------
// 抽离自 harness-runner.writeRunSummary，使「check 层字段保真传到 summary」可单测。
// review#3 病灶：blocker 映射漏传 c.blocking_class → device_test_run 崩溃的 device_toolchain
// 标签在真实链路中丢失 → goal-runner 失败分类误落 code_regression。
// ============================================================================

import type { CheckResult } from './types';
import { resolveBlockerActionability } from './goal-failure-classifier';

export interface SummaryBlockerEntry {
  id: string;
  severity: string;
  status: string;
  classification?: string;
  /** check 层 blocking_class（如 device_toolchain）须保真传到 goal-runner 的失败分类 */
  blocking_class?: string;
  details_excerpt: string;
  affected_files?: string[];
  suggestion?: string;
  /** t1d（plan e6a3c9f4）：产出来源（safeRun origin / profile dispatch / check-<phase>.ts 回退） */
  source?: string;
  /** P0-4（plan 7c4f2e9b）：注册表解析后的 actionability（runner 决策梯③层/回喂过滤/报告共同消费） */
  actionability?: 'agent_fixable' | 'human_only' | 'toolchain_blocked';
  /** P1-7（plan 7c4f2e9b）：operator 专用说明——goal-report 渲染，不进 agent 重试回喂 */
  operator_note?: string;
}

/**
 * 从 checks 过滤 FAIL+BLOCKER 并映射为 summary blockers[]。
 * excerpt / extractFailureClassification 由调用方注入（保持与 harness-runner 既有实现一致、不重复定义）。
 */
export function buildSummaryBlockers(
  checks: CheckResult[],
  excerpt: (text: string, max: number) => string,
  extractFailureClassification: (details: string) => string | undefined,
): SummaryBlockerEntry[] {
  return checks
    .filter(c => c.status === 'FAIL' && c.severity === 'BLOCKER')
    .map(c => {
      const classification = c.failure_kind ?? extractFailureClassification(c.details);
      // P0-4（plan 7c4f2e9b）：actionability 经单一注册表解析后落 summary（显式→映射→缺省）
      const actionability = resolveBlockerActionability({
        id: c.id,
        classification,
        blocking_class: c.blocking_class,
        actionability: c.actionability,
      });
      return {
        id: c.id,
        severity: c.severity,
        status: c.status,
        classification,
        ...(c.blocking_class ? { blocking_class: c.blocking_class } : {}),
        details_excerpt: excerpt(c.details, 800),
        affected_files: c.affected_files,
        suggestion: c.suggestion,
        ...(c.source ? { source: c.source } : {}),
        actionability,
        ...(c.operator_note ? { operator_note: c.operator_note } : {}),
      };
    });
}
