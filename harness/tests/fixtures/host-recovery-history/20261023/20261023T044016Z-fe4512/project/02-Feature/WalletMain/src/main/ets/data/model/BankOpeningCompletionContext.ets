/** 成功开卡的一次性交接上下文；首页消费后立即清空。 */
export class BankOpeningCompletionContext {
  private static pendingCardNumber: string | undefined = undefined;

  static publish(fullCardNumber: string): void {
    BankOpeningCompletionContext.pendingCardNumber = fullCardNumber;
  }

  static consume(): string | undefined {
    const value: string | undefined = BankOpeningCompletionContext.pendingCardNumber;
    BankOpeningCompletionContext.pendingCardNumber = undefined;
    return value;
  }

  static clear(): void {
    BankOpeningCompletionContext.pendingCardNumber = undefined;
  }
}
