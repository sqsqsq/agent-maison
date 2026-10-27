/** 本地短信模拟服务；不发送网络请求，也不记录手机号。 */
export class OtpService {
  async sendMockCode(mobile: string): Promise<void> {
    if (mobile.length === 0) {
      return Promise.resolve();
    }
    return Promise.resolve();
  }
}

/** 可由页面时钟或 UT 显式驱动的 OTP 状态对象。 */
export class OtpVerificationState {
  otp: string = '';
  countdownSeconds: number = 0;
  sending: boolean = false;
  active: boolean = false;
  private mobile: string = '';
  private readonly otpService: OtpService;
  private readonly countdownStart: number;

  constructor(otpService: OtpService, countdownStart: number) {
    this.otpService = otpService;
    this.countdownStart = countdownStart;
  }

  async start(mobile: string): Promise<boolean> {
    this.reset();
    this.active = true;
    this.mobile = mobile;
    return this.send();
  }

  async resend(): Promise<boolean> {
    if (!this.active || this.countdownSeconds > 0) {
      return false;
    }
    return this.send();
  }

  tick(): number {
    if (!this.active || this.countdownSeconds === 0) {
      return this.countdownSeconds;
    }
    this.countdownSeconds -= 1;
    return this.countdownSeconds;
  }

  updateOtp(value: string, maxLength: number): string {
    this.otp = value.replace(/[^0-9]/g, '').substring(0, maxLength);
    return this.otp;
  }

  canSubmit(expectedLength: number): boolean {
    return this.active && this.otp.length === expectedLength && /^\d+$/.test(this.otp);
  }

  cancel(): void {
    this.active = false;
    this.reset();
  }

  reset(): void {
    this.otp = '';
    this.countdownSeconds = 0;
    this.sending = false;
    this.mobile = '';
  }

  private async send(): Promise<boolean> {
    if (!this.active || this.sending || this.mobile.length === 0) {
      return false;
    }
    this.sending = true;
    try {
      await this.otpService.sendMockCode(this.mobile);
      if (!this.active) {
        return false;
      }
      this.countdownSeconds = this.countdownStart;
      return true;
    } finally {
      this.sending = false;
    }
  }
}
