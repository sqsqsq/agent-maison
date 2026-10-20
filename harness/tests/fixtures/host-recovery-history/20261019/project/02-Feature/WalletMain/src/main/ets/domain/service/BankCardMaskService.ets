export class BankCardMaskService {
  static maskCardNumber(fullCardNumber: string): string {
    if (fullCardNumber.length <= 8) {
      return '****';
    }
    return `${fullCardNumber.slice(0, 4)} **** **** ${fullCardNumber.slice(-4)}`;
  }
}
