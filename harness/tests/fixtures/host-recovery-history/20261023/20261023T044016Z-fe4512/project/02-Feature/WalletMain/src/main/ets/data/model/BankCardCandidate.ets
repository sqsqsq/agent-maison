export enum BankCardType {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT'
}

/** 银行提供的本地 mock 卡候选；完整卡号禁止直接展示或写日志。 */
export interface BankCardCandidate {
  bankCode: string;
  bankName: string;
  cardNumber: string;
  cardType: BankCardType;
}

/** 具体卡片页路由参数。 */
export interface BankCardSelectionParams {
  bankCode: string;
  cardType: BankCardType;
}
