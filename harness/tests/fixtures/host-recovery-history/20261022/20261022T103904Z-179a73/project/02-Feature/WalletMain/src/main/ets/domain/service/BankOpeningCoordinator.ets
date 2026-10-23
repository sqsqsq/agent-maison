import { BankInfo } from '../../data/model/BankInfo';
import { BankCardType } from '../../data/model/BankCardType';
import { MockBankCard } from '../../data/model/MockBankCard';
import { BankCardRecord } from '../../data/model/BankCardRecord';
import { SaveBankCardResult } from '../../data/model/SaveBankCardResult';
import { BankRepository } from '../../data/repository/BankRepository';
import { BankCardRepository } from '../../data/repository/BankCardRepository';
import { OtpController, OtpSession } from '../model/OtpSession';
import { BankOpeningResultPayload } from '../model/BankOpeningResultPayload';
import { BankOpeningCompletionBridge } from '../../shared/BankOpeningCompletionBridge';
import { BankOpeningNavigator } from './BankOpeningNavigator';

export class BankOpeningCoordinator {
  static readonly completion: BankOpeningCompletionBridge<BankOpeningResultPayload> =
    new BankOpeningCompletionBridge<BankOpeningResultPayload>();
  private static instance: BankOpeningCoordinator = new BankOpeningCoordinator();

  phase: string = 'Idle';
  bank: BankInfo | null = null;
  cardType: BankCardType | null = null;
  cards: MockBankCard[] = [];
  selectedCard: MockBankCard | null = null;
  saveResult: SaveBankCardResult | null = null;
  payload: BankOpeningResultPayload | null = null;
  readonly otp: OtpController = new OtpController();
  private generation: number = 0;
  private inFlight: Promise<BankOpeningResultPayload> | null = null;
  private navigator: BankOpeningNavigator = new BankOpeningNavigator(BankOpeningCoordinator.completion);

  private readonly bankRepo: BankRepository;
  private readonly cardRepo: BankCardRepository;

  constructor(bankRepo: BankRepository = new BankRepository(),
    cardRepo: BankCardRepository = BankCardRepository.getInstance()) {
    this.bankRepo = bankRepo;
    this.cardRepo = cardRepo;
  }

  static getInstance(): BankOpeningCoordinator {
    return BankOpeningCoordinator.instance;
  }

  start(bank: BankInfo): void {
    if (this.phase === 'SAVING') {
      return;
    }
    this.reset();
    this.bank = bank;
    this.phase = 'TYPE_SELECTED';
  }

  async selectCardType(cardType: BankCardType): Promise<MockBankCard[]> {
    if (this.bank === null || this.phase !== 'TYPE_SELECTED' ||
      this.bank.supportedCardTypes.indexOf(cardType) < 0) {
      throw new Error('INVALID_CARD_TYPE');
    }
    const generation: number = ++this.generation;
    const bank: BankInfo = this.bank;
    const cards: MockBankCard[] = await this.bankRepo.getMockCards(bank.code, cardType);
    if (generation !== this.generation || this.bank !== bank) {
      return [];
    }
    this.cardType = cardType;
    this.cards = cards.filter((card: MockBankCard) => card.bankCode === bank.code && card.cardType === cardType);
    this.selectedCard = null;
    this.phase = 'CARD_SELECTED';
    return this.cards;
  }

  selectCard(card: MockBankCard): void {
    if (this.phase !== 'CARD_SELECTED') {
      return;
    }
    const candidate: MockBankCard | undefined = this.cards.find((item: MockBankCard) => item.cardNumber === card.cardNumber);
    if (candidate === undefined) {
      throw new Error('INVALID_CARD');
    }
    this.selectedCard = candidate;
  }

  openOtp(phone: string, onTick: (session: OtpSession) => void): void {
    if (this.selectedCard === null || this.phase !== 'CARD_SELECTED') {
      return;
    }
    this.phase = 'OTP_READY';
    this.otp.open(phone, onTick);
  }

  closeOtp(): void {
    if (this.phase === 'SAVING') {
      return;
    }
    this.otp.stop();
    if (this.phase === 'OTP_READY') {
      this.phase = 'CARD_SELECTED';
    }
  }

  resendOtp(): void {
    if (this.phase === 'OTP_READY') {
      this.otp.send();
    }
  }

  confirmOtp(code: string): Promise<BankOpeningResultPayload> {
    if (this.inFlight !== null) {
      return this.inFlight;
    }
    if (this.phase !== 'OTP_READY' || this.selectedCard === null || !OtpController.isValidCode(code)) {
      return Promise.reject(new Error('INVALID_OTP'));
    }
    this.phase = 'SAVING';
    this.otp.stop();
    this.inFlight = this.saveSelectedCard(this.selectedCard);
    return this.inFlight;
  }

  private async saveSelectedCard(card: MockBankCard): Promise<BankOpeningResultPayload> {
    const record: BankCardRecord = {
      cardNumber: card.cardNumber, cardKind: 'BANK_CARD', bankName: card.bankName,
      bankCardType: card.cardType, addedAt: Date.now(),
      huaweiPayEnabled: false, unionPayQuickPassEnabled: false, transactionsJson: '[]'
    };
    let result: SaveBankCardResult;
    try {
      result = await this.cardRepo.save(record);
    } catch {
      result = { success: false, cardNumber: card.cardNumber, errorMessage: 'CARD_SAVE_FAILED' };
    }
    this.saveResult = result;
    this.payload = { fullCardNumber: card.cardNumber, result: result };
    this.phase = 'RESULT';
    return this.payload;
  }

  finish(): void {
    if (this.phase !== 'RESULT' || this.payload === null) {
      return;
    }
    const payload: BankOpeningResultPayload = this.payload;
    this.reset();
    this.phase = 'FINISHED';
    this.navigator.finish(payload);
  }

  cancel(): void {
    if (this.phase !== 'SAVING' && this.phase !== 'RESULT') {
      this.reset();
    }
  }

  private reset(): void {
    this.generation++;
    this.otp.stop();
    this.bank = null;
    this.cardType = null;
    this.cards = [];
    this.selectedCard = null;
    this.saveResult = null;
    this.payload = null;
    this.inFlight = null;
    this.phase = 'Idle';
  }
}
