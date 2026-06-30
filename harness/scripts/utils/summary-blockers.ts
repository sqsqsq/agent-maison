// ============================================================================
// summary-blockers.ts — CheckResult[] → summary.json blockers[] 映射（可测纯函数）
// ----------------------------------------------------------------------------
// 抽离自 harness-runner.writeRunSummary，使「check 层字段保真传到 summary」可单测。
// review#3 病灶：blocker 映射漏传 c.blocking_class → device_test_run 崩溃的 device_toolchain
// 标签在真实链路中丢失 → goal-runner 失败分类误落 code_regression。
// ============================================================================

import type { CheckResult } from './types';

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
    .map(c => ({
      id: c.id,
      severity: c.severity,
      status: c.status,
      classification: c.failure_kind ?? extractFailureClassification(c.details),
      ...(c.blocking_class ? { blocking_class: c.blocking_class } : {}),
      details_excerpt: excerpt(c.details, 800),
      affected_files: c.affected_files,
      suggestion: c.suggestion,
    }));
}
