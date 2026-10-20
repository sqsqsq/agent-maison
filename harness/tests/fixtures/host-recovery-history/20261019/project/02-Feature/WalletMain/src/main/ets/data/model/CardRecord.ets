export class CardRecord {
  id: number = 0;
  fullCardNumber: string = '';
  genericCardType: string = 'bank_card';
  bankName: string = '';
  bankCode: string = '';
  bankCardType: string = '';
  addedAt: number = 0;
  huaweiPayEnabled: boolean = false;
  unionPayQuickPassEnabled: boolean = false;
  transactionRecords: string = '[]';
}
