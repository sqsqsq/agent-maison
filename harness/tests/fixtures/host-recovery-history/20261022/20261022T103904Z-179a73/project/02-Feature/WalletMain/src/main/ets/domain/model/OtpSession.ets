export interface OtpSession {
  maskedPhone: string;
  remainingSeconds: number;
  code: string;
}

export class OtpController {
  session: OtpSession = { maskedPhone: '', remainingSeconds: 0, code: '' };
  private timerId: number = -1;
  private deadline: number = 0;
  private onTick: ((session: OtpSession) => void) | null = null;

  static isValidCode(code: string): boolean {
    return /^[0-9]{6}$/.test(code);
  }

  open(phone: string, onTick: (session: OtpSession) => void): void {
    this.stop();
    this.session = { maskedPhone: phone.slice(0, 3) + '****' + phone.slice(-4), remainingSeconds: 0, code: '' };
    this.onTick = onTick;
    this.send();
  }

  send(): void {
    if (this.timerId >= 0 && Date.now() < this.deadline) {
      return;
    }
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
    }
    this.deadline = Date.now() + 60000;
    this.session.remainingSeconds = 60;
    this.emit();
    this.timerId = setInterval(() => this.tick(), 1000);
  }

  private tick(): void {
    this.session.remainingSeconds = Math.max(0, Math.ceil((this.deadline - Date.now()) / 1000));
    if (this.session.remainingSeconds === 0) {
      clearInterval(this.timerId);
      this.timerId = -1;
    }
    this.emit();
  }

  private emit(): void {
    if (this.onTick !== null) {
      this.onTick({ maskedPhone: this.session.maskedPhone, remainingSeconds: this.session.remainingSeconds, code: this.session.code });
    }
  }

  stop(): void {
    if (this.timerId >= 0) {
      clearInterval(this.timerId);
    }
    this.timerId = -1;
    this.onTick = null;
    this.deadline = 0;
    this.session = { maskedPhone: '', remainingSeconds: 0, code: '' };
  }
}

