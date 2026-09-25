// 绕过反例：用与正例完全相同的检查函数，对故意绕过接缝的 Consumer 求值——必须判负。
//
// 独立成文件是硬约束：component-closure.unit.test.ts 对 closure.test.ts 做命名空间导入，
// 会把其中每个导出函数都执行并按返回值写进 ut/testing 证据链；把一个"恒返回 false"的导出
// 放进去会当场打红正链。

import { consumerAvoidsSeamBypass } from './seam-no-bypass-check';

/** 正例 Consumer：不依赖具体 Provider → true。 */
export function bypassCheckAcceptsCleanConsumer(): boolean {
  return consumerAvoidsSeamBypass('LedgerIntakeConsumer.ts');
}

/** 反例 Consumer：直接 import 了具体 Provider → false。 */
export function bypassCheckRejectsBypassingConsumer(): boolean {
  return consumerAvoidsSeamBypass('LedgerIntakeBypass.ts');
}
