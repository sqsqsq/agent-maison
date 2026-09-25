import { describe, it, expect } from '@ohos/hypium';
import { BankRepository } from '../../../main/ets/BankRepository';
import { BankService } from '../../../main/ets/BankService';

describe('AllBanksPage', () => {
  it('[AC-1] 开卡入口', 0, async () => {
    const service: BankService = new BankService();
    const opened: boolean = await service.openCard('cmb');
    expect(opened).assertTrue();
    const rejected: boolean = await service.openCard('');
    expect(rejected).assertFalse();
  });
  it('[AC-2] 银行列表展示', 0, () => {
    const repo: BankRepository = new BankRepository();
    const banks: string[] = repo.list();
    expect(banks).not().assertNull();
    expect(banks.length).assertEqual(0);
  });
});
