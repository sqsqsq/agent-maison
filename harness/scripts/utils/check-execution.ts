import type { CheckContext, CheckResult, Severity } from './types';

/** Catch an individual checker failure without inventing a product verdict or changing its obligation. */
export function executeCheck(
  ctx: Pick<CheckContext<'feature' | 'request'>, 'phaseRule'>,
  fn: () => CheckResult[],
  checkId: string,
  options: { severity?: Severity; failClosed?: boolean } = {},
): CheckResult[] {
  try {
    return fn().map(result => result.source ? result : { ...result, source: checkId });
  } catch (error) {
    const rule = ctx.phaseRule?.structure_checks?.[checkId] ?? ctx.phaseRule?.traceability_checks?.[checkId]
      ?? ctx.phaseRule?.semantic_checks?.[checkId];
    const severity = options.severity ?? (options.failClosed ? 'BLOCKER' : rule?.severity) ?? 'BLOCKER';
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    return [{
      id: checkId, category: 'structure', description: `${checkId} 未取得检查结论`,
      severity, status: 'SKIP', source: checkId,
      details: `[Harness 内部错误] 检查未执行完成，产品结论未知：${detail}`,
      failure_kind: 'framework_bug', blocking_class: 'framework_internal', actionability: 'framework_blocked',
      suggestion: '请 AgentMaison 维护者修复检查实现后重新发起同一请求，复验受影响阶段；保留已有有效产物。不要修改产品或 framework 发布件来绕过，也不要无变化重试。',
    }];
  }
}
