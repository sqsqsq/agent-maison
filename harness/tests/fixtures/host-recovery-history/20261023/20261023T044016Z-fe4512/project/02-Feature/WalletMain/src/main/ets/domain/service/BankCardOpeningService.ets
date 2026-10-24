import { BankCardCandidate, BankCardType } from '../../data/model/BankCardCandidate';
import { OpeningResult } from '../../data/model/OpeningResult';
import { StoredCard } from '../../data/model/StoredCard';

/** 开卡纯业务规则，可脱离 ArkUI 直接验证。 */
export class BankCardOpeningService {
  maskCardNumber(cardNumber: string): string {
    if (cardNumber.length <= 8) {
      return cardNumber;
    }
    return `${cardNumber.substring(0, 4)} **** **** ${cardNumber.substring(cardNumber.length - 4)}`;
  }

  isValidOtp(otp: string): boolean {
    return /^\d{6}$/.test(otp);
  }

  toStoredCard(candidate: BankCardCandidate): StoredCard {
    return new StoredCard({
      cardNumber: candidate.cardNumber,
      category: 'BANK_CARD',
      bankName: candidate.bankName,
      bankCardType: candidate.cardType === BankCardType.DEBIT ? 'DEBIT' : 'CREDIT',
      addedAt: Date.now(),
      huaweiPayEnabled: true,
      unionPayQuickPassEnabled: true,
      transactionRecords: '[]'
    });
  }

  toOpeningResult(
    candidate: BankCardCandidate,
    success: boolean,
    errorMessage: string = ''
  ): OpeningResult {
    return new OpeningResult({
      fullCardNumber: candidate.cardNumber,
      success: success,
      errorMessage: errorMessage.length > 0 ? errorMessage : undefined
    });
  }
}
