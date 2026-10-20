export class OpenCardResult {
  success: boolean;
  fullCardNumber: string;
  failureReason?: string;

  constructor(success: boolean, fullCardNumber: string, failureReason?: string) {
    this.success = success;
    this.fullCardNumber = fullCardNumber;
    this.failureReason = failureReason;
  }
}
