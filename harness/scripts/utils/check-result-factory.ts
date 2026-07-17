// ============================================================================
// check-result-factory.ts — CheckResult 类型化构造 factory（t1a②，plan e6a3c9f4）
// ----------------------------------------------------------------------------
// 动机：BLOCKER 级失败若缺 suggestion，agent 只能"重跑→猜→重跑"（2.3.0 宿主反馈实锤）。
// 三层防线中的第二层：**新增/迁移的 checker 一律经本 factory 构造失败结果**，
// suggestion 在类型上必填——写不出修复建议的门禁不应该存在。
//   第一层（运行时兜底）：report-generator.resolveEffectiveSuggestion 对存量缺失补统一 fallback；
//   第三层（存量收紧）：blocker-suggestion-ratchet 元门禁锁死显式旧构造只减不增。
// 存量 checker 不强制迁移（ratchet 渐进收紧）；PASS/SKIP 结果不经本 factory（无 suggestion 语义）。
// ============================================================================

import type { CheckResult } from './types';

export interface BlockerFailParams {
  id: string;
  category: CheckResult['category'];
  description: string;
  details: string;
  /** 必填：面向 agent 的可执行修复指引（含具体动作/示例/SSOT 指向，禁止空泛"请修复"） */
  suggestion: string;
  affected_files?: string[];
  failure_kind?: string;
  blocking_class?: string;
  /** 编排边界的产出来源标签（safeRun origin / profile dispatch）；缺省由渲染层回退 check-<phase>.ts */
  source?: string;
}

/** 构造 severity=BLOCKER / status=FAIL 的检查结果；suggestion 类型必填。 */
export function blockerFail(params: BlockerFailParams): CheckResult {
  const { suggestion, ...rest } = params;
  return {
    ...rest,
    severity: 'BLOCKER',
    status: 'FAIL',
    suggestion,
  };
}

/** 构造 severity=MAJOR / status=FAIL；同样强制 suggestion（MAJOR 亦阻断人读排障）。 */
export function majorFail(params: BlockerFailParams): CheckResult {
  const { suggestion, ...rest } = params;
  return {
    ...rest,
    severity: 'MAJOR',
    status: 'FAIL',
    suggestion,
  };
}
