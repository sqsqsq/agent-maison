import { BankCardCandidate, BankCardType } from '../../../../main/ets/data/model/BankCardCandidate';
import { StoredCard } from '../../../../main/ets/data/model/StoredCard';
import {
  BankCardRepository,
  BankCardStore
} from '../../../../main/ets/data/repository/BankCardRepository';
import { BankRepository } from '../../../../main/ets/data/repository/BankRepository';
import { OtpService } from '../../../../main/ets/domain/service/OtpService';

export class SpyOpeningBankRepository extends BankRepository {
  callLog: string[] = [];
  cards: BankCardCandidate[] = [];

  async getCards(bankCode: string, cardType: BankCardType): Promise<BankCardCandidate[]> {
    this.callLog.push(`getCards:${bankCode}:${cardType}`);
    return this.cards;
  }
}

export class SpyOtpService extends OtpService {
  callLog: string[] = [];
  shouldFail: boolean = false;

  async sendMockCode(mobile: string): Promise<void> {
    this.callLog.push(`sendMockCode:${mobile}`);
    if (this.shouldFail) {
      throw new Error('mock send failed');
    }
  }
}

export class SpyBankCardRepository extends BankCardRepository {
  callLog: string[] = [];
  savedCards: StoredCard[] = [];
  shouldFail: boolean = false;

  constructor() {
    super(null, new SpyBankCardStore());
  }

  async save(card: StoredCard): Promise<StoredCard> {
    this.callLog.push('save');
    if (this.shouldFail) {
      throw new Error('mock save failed');
    }
    this.savedCards.push(card);
    return card;
  }

  async list(): Promise<StoredCard[]> {
    this.callLog.push('list');
    return this.savedCards;
  }
}

export class SpyBankCardStore implements BankCardStore {
  callLog: string[] = [];
  existing: StoredCard | undefined = undefined;
  inserted: StoredCard | undefined = undefined;
  failInsert: boolean = false;
  existingAfterRollback: StoredCard | undefined = undefined;
  private rolledBack: boolean = false;

  async beginTransaction(): Promise<void> {
    this.callLog.push('beginTransaction');
  }

  async commit(): Promise<void> {
    this.callLog.push('commit');
  }

  async rollBack(): Promise<void> {
    this.callLog.push('rollBack');
    this.rolledBack = true;
  }

  async findByCardNumber(_cardNumber: string): Promise<StoredCard | undefined> {
    this.callLog.push('findByCardNumber');
    if (this.rolledBack && this.existingAfterRollback !== undefined) {
      return this.existingAfterRollback;
    }
    return this.existing;
  }

  async insert(card: StoredCard): Promise<void> {
    this.callLog.push('insert');
    if (this.failInsert) {
      throw new Error('mock insert failed');
    }
    this.inserted = card;
  }

  async list(): Promise<StoredCard[]> {
    this.callLog.push('list');
    if (this.existing === undefined) {
      return [];
    }
    return [this.existing];
  }
}
