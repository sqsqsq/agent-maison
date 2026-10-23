import { BankCardType } from './BankCardType';

export interface MockBankCard {
  cardNumber: string;
  bankCode: string;
  bankName: string;
  cardType: BankCardType;
}

export function maskCardNumber(cardNumber: string): string {
  return cardNumber.length >= 8 ? `${cardNumber.slice(0, 4)} **** **** ${cardNumber.slice(-4)}` : '****';
}

