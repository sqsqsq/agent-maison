// 反例 Consumer：故意绕过接缝，直接依赖具体 Provider。
// 只被 test/ledger/seam-bypass.case.ts 引用，用来证明绕过检查真的能判负——
// 正链的 Consumer 是 LedgerIntakeConsumer.ts，本文件不参与任何 obligation。

import { autoLedgerSource } from './LedgerSourceSeam';

export function bypassingLedgerIntake(): number {
  return autoLedgerSource.read().reduce((sum, item) => sum + item, 0);
}
