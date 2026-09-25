// 接缝的真实 Consumer：只经稳定契约取数，不 import 任何具体 Provider。
// proveSeamConsumerNoBypass 会对本文件做源码级检查——改成直接依赖某个 Provider 就会被抓到。

import { LedgerSource, resolveLedgerSource } from './LedgerSourceSeam';

export interface LedgerIntakeResult {
  sourceId: string;
  total: number;
}

export function ledgerIntake(source: LedgerSource | undefined): LedgerIntakeResult {
  const resolved = resolveLedgerSource(source);
  return {
    sourceId: resolved.sourceId,
    total: resolved.read().reduce((sum, item) => sum + item, 0),
  };
}
