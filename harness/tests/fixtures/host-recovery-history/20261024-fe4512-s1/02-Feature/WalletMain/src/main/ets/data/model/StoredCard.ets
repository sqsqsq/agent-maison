export interface StoredCardParams {
  cardNumber: string;
  category: string;
  bankName: string;
  bankCardType: string;
  addedAt: number;
  huaweiPayEnabled: boolean;
  unionPayQuickPassEnabled: boolean;
  transactionRecords: string;
}

/** 钱包银行卡 RDB 的领域记录。 */
export class StoredCard {
  cardNumber: string;
  category: string;
  bankName: string;
  bankCardType: string;
  addedAt: number;
  huaweiPayEnabled: boolean;
  unionPayQuickPassEnabled: boolean;
  transactionRecords: string;

  constructor(params: StoredCardParams) {
    this.cardNumber = params.cardNumber;
    this.category = params.category;
    this.bankName = params.bankName;
    this.bankCardType = params.bankCardType;
    this.addedAt = params.addedAt;
    this.huaweiPayEnabled = params.huaweiPayEnabled;
    this.unionPayQuickPassEnabled = params.unionPayQuickPassEnabled;
    this.transactionRecords = params.transactionRecords;
  }
}
