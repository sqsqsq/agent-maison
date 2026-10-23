import { BankCardType } from './BankCardType';

export interface BankCardRecord {
  cardNumber: string;
  cardKind: string;
  bankName: string;
  bankCardType: BankCardType;
  addedAt: number;
  huaweiPayEnabled: boolean;
  unionPayQuickPassEnabled: boolean;
  transactionsJson: string;
}

