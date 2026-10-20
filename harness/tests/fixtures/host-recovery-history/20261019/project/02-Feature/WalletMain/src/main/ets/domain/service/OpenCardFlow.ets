import { Context } from '@kit.AbilityKit';
import { BankCardInfo } from '../../data/model/BankCardInfo';
import { OpenCardResult } from '../../data/model/OpenCardResult';
import { BankCardRepository } from '../../data/repository/BankCardRepository';
import { BankConstants } from '../../shared/constant/BankConstants';

export class OpenCardFlow {
  phase: string = 'Idle';
  selectedCard: BankCardInfo | null = null;
  otpSeconds: number = 0;
  result: OpenCardResult | null = null;
  onStateChanged: (() => void) | null = null;
  private timer: number = -1;
  private expiresAt: number = 0;
  private disposed: boolean = false;
  private pending: Promise<OpenCardResult> | null = null;
  private readonly cardStore: BankCardRepository;

  constructor(cardStore: BankCardRepository = new BankCardRepository()) {
    this.cardStore = cardStore;
  }

  selectCard(card: BankCardInfo): void {
    if (this.disposed || this.phase === 'Saving' || this.phase === 'Result' || this.phase === 'OtpWaiting') {
      return;
    }
    this.selectedCard = card;
    this.phase = 'CardSelected';
    this.notify();
  }

  openOtp(): void {
    if (this.disposed || this.phase !== 'CardSelected' || this.selectedCard === null) {
      return;
    }
    this.phase = 'OtpWaiting';
    this.startCountdown();
  }

  closeOtp(): void {
    if (this.phase !== 'OtpWaiting') {
      return;
    }
    this.stopTimer();
    this.otpSeconds = 0;
    this.phase = 'CardSelected';
    this.notify();
  }

  normalizeOtp(raw: string): string {
    return raw.replace(/\D/g, '').slice(0, BankConstants.OTP_LENGTH);
  }

  resendOtp(): void {
    if (!this.disposed && this.phase === 'OtpWaiting' && this.otpSeconds === 0) {
      this.startCountdown();
    }
  }

  submitOtp(context: Context, otp: string): Promise<OpenCardResult> {
    if (this.pending !== null) {
      return this.pending;
    }
    if (this.disposed || this.phase !== 'OtpWaiting' || this.selectedCard === null || !/^\d{6}$/.test(otp)) {
      return Promise.resolve(new OpenCardResult(false, this.selectedCard?.fullCardNumber ?? '', 'invalid_otp'));
    }
    const card: BankCardInfo = this.selectedCard;
    this.phase = 'Saving';
    this.stopTimer();
    this.notify();
    this.pending = this.persist(context, card);
    return this.pending;
  }

  private async persist(context: Context, card: BankCardInfo): Promise<OpenCardResult> {
    let result: OpenCardResult;
    try {
      result = await this.cardStore.saveCard(context, card);
    } catch {
      result = new OpenCardResult(false, card.fullCardNumber, 'save_failed');
    }
    this.result = result;
    this.phase = 'Result';
    this.notify();
    return result;
  }

  private startCountdown(): void {
    this.stopTimer();
    this.otpSeconds = BankConstants.OTP_RESEND_SECONDS;
    this.expiresAt = Date.now() + this.otpSeconds * 1000;
    this.timer = setInterval(() => {
      this.otpSeconds = Math.max(0, Math.ceil((this.expiresAt - Date.now()) / 1000));
      if (this.otpSeconds === 0) {
        this.stopTimer();
      }
      this.notify();
    }, 1000);
    this.notify();
  }

  private stopTimer(): void {
    if (this.timer !== -1) {
      clearInterval(this.timer);
      this.timer = -1;
    }
  }

  private notify(): void {
    if (!this.disposed) {
      this.onStateChanged?.();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.otpSeconds = 0;
    this.onStateChanged = null;
  }
}
