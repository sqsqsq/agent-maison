import { describe, it, expect } from '@ohos/hypium';
import {
  isWalletDestination,
  walletDestinationNames
} from '../../../main/ets/navigation/WalletDestinationRegistry';

export default function walletDestinationRegistryTest(): void {
  describe('wallet destination registry', () => {
    it('[AC-6] existing and bank-opening destinations remain registered together', 0, () => {
      const names: string[] = walletDestinationNames();
      expect(names.indexOf('AddCardEntryPage') >= 0).assertTrue();
      expect(names.indexOf('AddBankCardPage') >= 0).assertTrue();
      expect(names.indexOf('AllBanksPage') >= 0).assertTrue();
      expect(names.indexOf('BankCardSelectionPage') >= 0).assertTrue();
      expect(names.indexOf('BankCardOpeningResultPage') >= 0).assertTrue();
      expect(isWalletDestination('UnknownDestination')).assertFalse();
    });
  });
}
