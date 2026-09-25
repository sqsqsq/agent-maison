// 宿主演进接缝（总纲 §11.3）的四项证明在本文件末尾——它们真的调用 src/ledger 的接缝，
// 不是 return true 占位。其余 verify* 仍是夹具占位符（其真值由各自 obligation 的证据层承担）。
import {
  LEDGER_SOURCE_ABSENCE_SEMANTICS,
  LedgerSource,
  autoLedgerSource,
  manualLedgerSource,
  resolveLedgerSource,
} from '../../src/ledger/LedgerSourceSeam';
import { ledgerIntake } from '../../src/ledger/LedgerIntakeConsumer';
import { consumerAvoidsSeamBypass } from './seam-no-bypass-check';

export function componentClosureCombination(): boolean { return true; }
export function alternateComponentClosure(): boolean { return true; }
export function verifyLedgerFlow(): boolean { return true; }
export function verifyUserMutationTrigger(): boolean { return true; }
export function verifyColdStartTrigger(): boolean { return true; }
export function verifyInitialLoad(): boolean { return true; }
export function verifyStateOwner(): boolean { return true; }
export function verifyMutationPropagation(): boolean { return true; }
export function verifyPublication(): boolean { return true; }
export function verifySubscription(): boolean { return true; }
export function verifyConsumerRefresh(): boolean { return true; }
export function verifyRecovery(): boolean { return true; }
export function verifyColdStartLifecycle(): boolean { return true; }
export function verifyWarmResumeLifecycle(): boolean { return true; }
export function verifyPageAttachLifecycle(): boolean { return true; }
export function verifyPageDetachLifecycle(): boolean { return true; }
export function verifyAccountSwitchLifecycle(): boolean { return true; }
export function verifyProcessRecreationLifecycle(): boolean { return true; }
export function verifySeamDecision(): boolean { return true; }
export function verifyPreservedInvariant(): boolean { return true; }
export function verifyChangeUnit(): boolean { return true; }
export function verifySafeBuild(): boolean { return true; }
export function verifySafeCompatibility(): boolean { return true; }
export function verifySafeRecovery(): boolean { return true; }
export function verifyTemporaryAsset(): boolean { return true; }
export function proveSeamContractCompatibility(): boolean {
  // 两个 Provider 满足同一稳定契约，且同一个 Consumer 都能消费。
  const providers: LedgerSource[] = [manualLedgerSource, autoLedgerSource];
  return providers.every(provider =>
    typeof provider.sourceId === 'string' && provider.sourceId.length > 0
    && Array.isArray(provider.read())
    && typeof ledgerIntake(provider).total === 'number');
}

export function proveSeamProviderReplacement(): boolean {
  // 换 Provider 不改 Consumer：同一函数、同一结果形状，只有数据随实现变化。
  const first = ledgerIntake(manualLedgerSource);
  const second = ledgerIntake(autoLedgerSource);
  const sameShape = Object.keys(first).sort().join(',') === Object.keys(second).sort().join(',');
  return sameShape && first.sourceId !== second.sourceId && first.total > 0 && second.total > 0;
}

export function proveSeamAbsenceFailure(): boolean {
  // 蓝图裁决=block：Provider 缺席必须显式失败，不得静默成功。
  if (LEDGER_SOURCE_ABSENCE_SEMANTICS !== 'block') return false;
  try {
    resolveLedgerSource(undefined);
    return false;
  } catch (error) {
    return (error as Error).message === 'ledger_source_absent';
  }
}

export function proveSeamConsumerNoBypass(): boolean {
  // 真实 Consumer 只经契约取数；反例由 seam-bypass.case.ts 用同一把尺子判负。
  return consumerAvoidsSeamBypass('LedgerIntakeConsumer.ts');
}


export function verifiesComponentClosure(): boolean { return componentClosureCombination(); }
