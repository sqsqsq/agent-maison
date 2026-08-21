// 宿主演进接缝夹具（总纲 §11.3）：稳定契约 + 两个真实 Provider + 缺失裁决。
// 这不是"接口摆设"——四项接缝证明会真的调用它，见 test/ledger/closure.test.ts。

/** 稳定能力契约：记账来源。Consumer 只认它，不认任何具体实现。 */
export interface LedgerSource {
  readonly sourceId: string;
  read(): number[];
}

/** Provider 甲：手动记账。 */
export const manualLedgerSource: LedgerSource = {
  sourceId: 'manual',
  read: () => [120, 80],
};

/** Provider 乙：自动记账。同契约、不同实现与不同数据。 */
export const autoLedgerSource: LedgerSource = {
  sourceId: 'auto',
  read: () => [45, 55, 100],
};

/**
 * 蓝图对该接缝的缺失/失败裁决 = block：Provider 不在场必须显式失败，
 * 不得静默返回空结果冒充成功。
 */
export const LEDGER_SOURCE_ABSENCE_SEMANTICS = 'block';

export function resolveLedgerSource(source: LedgerSource | undefined): LedgerSource {
  if (!source) throw new Error('ledger_source_absent');
  return source;
}
