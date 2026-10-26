import {
  BankCardCandidate,
  BankCardSelectionParams,
  BankCardType
} from '../../data/model/BankCardCandidate';
import { OpeningResult } from '../../data/model/OpeningResult';
import { StoredCard } from '../../data/model/StoredCard';
import { BankCardRepository } from '../../data/repository/BankCardRepository';
import { BankRepository } from '../../data/repository/BankRepository';
import { OtpVerificationState } from './OtpService';

export enum BankCardOpeningPhase {
  ENTRY = 'ENTRY',
  TYPE_SELECTED = 'TYPE_SELECTED',
  CARD_SELECTED = 'CARD_SELECTED',
  OTP_ACTIVE = 'OTP_ACTIVE',
  SAVING = 'SAVING',
  RESULT = 'RESULT'
}

/** 开卡纯业务规则，可脱离 ArkUI 直接验证。 */
export class BankCardOpeningService {
  private readonly repository: BankCardRepository | null;
  private readonly bankRepository: BankRepository;
  private readonly otpState: OtpVerificationState | null;
  private readonly session: BankCardOpeningSession;
  private openingPhase: BankCardOpeningPhase = BankCardOpeningPhase.ENTRY;
  private openingResult: OpeningResult | null = null;

  constructor(
    repository: BankCardRepository | null = null,
    bankRepository: BankRepository = new BankRepository(),
    otpState: OtpVerificationState | null = null,
    session: BankCardOpeningSession = new BankCardOpeningSession()
  ) {
    this.repository = repository;
    this.bankRepository = bankRepository;
    this.otpState = otpState;
    this.session = session;
  }

  begin(bankCode: string, cardType: BankCardType): void {
    this.session.begin(bankCode);
    this.session.selectCardType(cardType);
    this.openingResult = null;
    this.openingPhase = BankCardOpeningPhase.TYPE_SELECTED;
  }

  async loadCandidates(): Promise<BankCardCandidate[]> {
    const params: BankCardSelectionParams | null = this.session.selectionParams();
    if (params === null) {
      return [];
    }
    return this.bankRepository.getCards(params.bankCode, params.cardType);
  }

  selectCandidate(candidate: BankCardCandidate): void {
    this.session.selectCandidate(candidate);
    this.openingPhase = BankCardOpeningPhase.CARD_SELECTED;
  }

  setAgreementAccepted(accepted: boolean): void {
    this.session.setAgreementAccepted(accepted);
  }

  canOpenOtp(): boolean {
    return this.session.canOpenOtp();
  }

  async startOtp(mobile: string): Promise<boolean> {
    if (!this.canOpenOtp() || this.otpState === null) {
      return false;
    }
    const sent: boolean = await this.otpState.start(mobile);
    if (sent) {
      this.openingPhase = BankCardOpeningPhase.OTP_ACTIVE;
    }
    return sent;
  }

  async resendOtp(): Promise<boolean> {
    if (this.otpState === null) {
      return false;
    }
    return this.otpState.resend();
  }

  tickOtp(): number {
    return this.otpState === null ? 0 : this.otpState.tick();
  }

  updateOtp(value: string, maxLength: number): string {
    if (this.otpState === null) {
      return '';
    }
    const otp: string = this.otpState.updateOtp(value, maxLength);
    this.session.setOtp(otp);
    return otp;
  }

  otpValue(): string {
    return this.otpState === null ? '' : this.otpState.otp;
  }

  otpCountdownSeconds(): number {
    return this.otpState === null ? 0 : this.otpState.countdownSeconds;
  }

  otpSending(): boolean {
    return this.otpState !== null && this.otpState.sending;
  }

  canSubmit(expectedOtpLength: number): boolean {
    return this.otpState !== null && this.otpState.canSubmit(expectedOtpLength) && this.session.canSubmit();
  }

  phase(): BankCardOpeningPhase {
    return this.openingPhase;
  }

  result(): OpeningResult | null {
    return this.openingResult;
  }

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

  async saveCandidate(candidate: BankCardCandidate): Promise<OpeningResult> {
    if (this.repository === null) {
      return this.toOpeningResult(candidate, false, 'RDB_STORE_UNAVAILABLE');
    }
    try {
      await this.repository.save(this.toStoredCard(candidate));
      return this.toOpeningResult(candidate, true);
    } catch {
      return this.toOpeningResult(candidate, false, 'RDB_SAVE_FAILED');
    }
  }

  async completeOpening(expectedOtpLength: number): Promise<OpeningResult | null> {
    const candidate: BankCardCandidate | null = this.session.selectedCandidate();
    if (candidate === null || !this.canSubmit(expectedOtpLength)) {
      return null;
    }
    this.openingPhase = BankCardOpeningPhase.SAVING;
    this.openingResult = await this.saveCandidate(candidate);
    this.openingPhase = BankCardOpeningPhase.RESULT;
    return this.openingResult;
  }

  cancelOtp(): void {
    if (this.openingPhase !== BankCardOpeningPhase.OTP_ACTIVE) {
      return;
    }
    if (this.otpState !== null) {
      this.otpState.cancel();
    }
    this.session.setOtp('');
    this.openingPhase = BankCardOpeningPhase.CARD_SELECTED;
  }

  cancel(): void {
    if (this.otpState !== null) {
      this.otpState.cancel();
    }
    this.session.cancel();
    this.openingResult = null;
    this.openingPhase = BankCardOpeningPhase.ENTRY;
  }
}

/** 跨 ArkUI 页面复用的开卡选择与继续门禁。 */
export class BankCardOpeningSession {
  private bankCode: string = '';
  private cardType: BankCardType | null = null;
  private candidate: BankCardCandidate | null = null;
  private agreementAccepted: boolean = false;
  private otp: string = '';

  begin(bankCode: string): void {
    this.reset();
    this.bankCode = bankCode;
  }

  selectCardType(cardType: BankCardType): void {
    this.cardType = cardType;
  }

  selectionParams(): BankCardSelectionParams | null {
    if (this.bankCode.length === 0 || this.cardType === null) {
      return null;
    }
    return { bankCode: this.bankCode, cardType: this.cardType };
  }

  selectCandidate(candidate: BankCardCandidate): void {
    this.candidate = candidate;
  }

  setAgreementAccepted(accepted: boolean): void {
    this.agreementAccepted = accepted;
  }

  setOtp(otp: string): void {
    this.otp = otp;
  }

  canOpenOtp(): boolean {
    return this.candidate !== null && this.agreementAccepted;
  }

  canSubmit(): boolean {
    return this.canOpenOtp() && /^\d{6}$/.test(this.otp);
  }

  selectedCandidate(): BankCardCandidate | null {
    return this.candidate;
  }

  cancel(): void {
    this.reset();
  }

  reset(): void {
    this.bankCode = '';
    this.cardType = null;
    this.candidate = null;
    this.agreementAccepted = false;
    this.otp = '';
  }
}
