import { BankCardType } from './BankCardType';

export interface BankCardInfo {
  cardId: string;
  fullCardNumber: string;
  bankCode: string;
  bankName: string;
  bankCardType: BankCardType;
  huaweiPayEnabled: boolean;
  unionPayQuickPassEnabled: boolean;
}
