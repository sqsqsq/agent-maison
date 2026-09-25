import { describe, it, expect } from '@ohos/hypium';
import { LedgerFeature } from '../../../../LedgerFeature';

describe('ledger-refresh', () => {
  it('[BRANCH-success][AC-1] LedgerFeature.add 刷新余额并可恢复', 0, () => {
    const ledger: LedgerFeature = new LedgerFeature();
    expect(ledger.add(120)).assertEqual(120);
    expect(ledger.restore([45, 55])).assertEqual(100);
  });
});
