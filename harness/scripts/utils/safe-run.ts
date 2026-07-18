// ============================================================================
// safeRun — check 脚本执行单条检查时的异常兜底工具
// ============================================================================
// 各 check-*.ts 的 Main Checker 用 safeRun 包裹每个检查函数，避免单条检查抛错
// 就中断整个 phase。历史上每个脚本各自定义了一份，且存在两种行为：
//   - 纯兜底：任何异常都收敛为 MINOR/SKIP（catalog/glossary/testing）
//   - 区分程序错误：TypeError/RangeError/SyntaxError 视为 Harness bug，升级为
//     BLOCKER/FAIL 并附堆栈（plan/spec/ut/review/coding）
// 此处收敛为单一工厂，用 `classifyProgrammerErrors` 选择行为，保持各脚本语义不变。
// ============================================================================

import type { CheckResult } from './types';

export interface SafeRunOptions {
  /** 将 TypeError/RangeError/SyntaxError 视为 Harness 内部 bug，升级为 BLOCKER/FAIL 并附堆栈。 */
  classifyProgrammerErrors?: boolean;
}

export function makeSafeRun(
  options: SafeRunOptions = {},
): (fn: () => CheckResult[], checkId: string) => CheckResult[] {
  const { classifyProgrammerErrors = false } = options;
  return function safeRun(fn: () => CheckResult[], checkId: string): CheckResult[] {
    try {
      return fn();
    } catch (err) {
      const e = err as Error;
      const isProgrammerError =
        classifyProgrammerErrors &&
        (e instanceof TypeError || e instanceof RangeError || e instanceof SyntaxError);
      return [{
        id: checkId,
        category: 'structure',
        description: `${checkId} 执行异常`,
        severity: isProgrammerError ? 'BLOCKER' : 'MINOR',
        status: isProgrammerError ? 'FAIL' : 'SKIP',
        details: isProgrammerError
          ? `[Harness 内部错误] ${e.message}\n${e.stack ?? ''}`
          : `检查执行时发生错误：${e.message}`,
      }];
    }
  };
}
