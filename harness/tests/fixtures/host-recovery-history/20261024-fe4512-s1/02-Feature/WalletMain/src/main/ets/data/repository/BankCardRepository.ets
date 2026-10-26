import { Context } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { StoredCard } from '../model/StoredCard';

const DATABASE_NAME: string = 'wallet_bank_cards.rdb';
const TABLE_NAME: string = 'cards';
const CREATE_TABLE_SQL: string =
  'CREATE TABLE IF NOT EXISTS cards (' +
  'card_number TEXT PRIMARY KEY, ' +
  'category TEXT NOT NULL, ' +
  'bank_name TEXT NOT NULL, ' +
  'bank_card_type TEXT NOT NULL, ' +
  'added_at INTEGER NOT NULL, ' +
  'huawei_pay_enabled INTEGER NOT NULL, ' +
  'union_pay_quick_pass_enabled INTEGER NOT NULL, ' +
  'transaction_records TEXT NOT NULL)';
const SELECT_COLUMNS: string =
  'card_number, category, bank_name, bank_card_type, added_at, ' +
  'huawei_pay_enabled, union_pay_quick_pass_enabled, transaction_records';

/** Repository 的最小存储接缝；生产实现仍唯一落到 RDB。 */
export interface BankCardStore {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollBack(): Promise<void>;
  findByCardNumber(cardNumber: string): Promise<StoredCard | undefined>;
  insert(card: StoredCard): Promise<void>;
  list(): Promise<StoredCard[]>;
}

/** 对 Harmony RDB 的薄包装，把系统对象隔离在 data 层。 */
export class RdbBankCardStore implements BankCardStore {
  private storePromise: Promise<relationalStore.RdbStore> | null = null;
  private readonly context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  private async store(): Promise<relationalStore.RdbStore> {
    if (this.storePromise === null) {
      this.storePromise = this.openStore();
    }
    return this.storePromise;
  }

  private async openStore(): Promise<relationalStore.RdbStore> {
    const config: relationalStore.StoreConfig = {
      name: DATABASE_NAME,
      securityLevel: relationalStore.SecurityLevel.S1
    };
    const store: relationalStore.RdbStore = await relationalStore.getRdbStore(this.context, config);
    await store.executeSql(CREATE_TABLE_SQL);
    return store;
  }

  async beginTransaction(): Promise<void> {
    const store: relationalStore.RdbStore = await this.store();
    store.beginTransaction();
  }

  async commit(): Promise<void> {
    const store: relationalStore.RdbStore = await this.store();
    store.commit();
  }

  async rollBack(): Promise<void> {
    const store: relationalStore.RdbStore = await this.store();
    store.rollBack();
  }

  async findByCardNumber(cardNumber: string): Promise<StoredCard | undefined> {
    const store: relationalStore.RdbStore = await this.store();
    const resultSet: relationalStore.ResultSet = await store.querySql(
      `SELECT ${SELECT_COLUMNS} FROM ${TABLE_NAME} WHERE card_number = ?`,
      [cardNumber]
    );
    try {
      if (!resultSet.goToFirstRow()) {
        return undefined;
      }
      return this.readCard(resultSet);
    } finally {
      resultSet.close();
    }
  }

  async insert(card: StoredCard): Promise<void> {
    const store: relationalStore.RdbStore = await this.store();
    const values: relationalStore.ValuesBucket = {
      card_number: card.cardNumber,
      category: card.category,
      bank_name: card.bankName,
      bank_card_type: card.bankCardType,
      added_at: card.addedAt,
      huawei_pay_enabled: card.huaweiPayEnabled ? 1 : 0,
      union_pay_quick_pass_enabled: card.unionPayQuickPassEnabled ? 1 : 0,
      transaction_records: card.transactionRecords
    };
    await store.insert(TABLE_NAME, values);
  }

  async list(): Promise<StoredCard[]> {
    const store: relationalStore.RdbStore = await this.store();
    const resultSet: relationalStore.ResultSet = await store.querySql(
      `SELECT ${SELECT_COLUMNS} FROM ${TABLE_NAME} ORDER BY added_at DESC`
    );
    const cards: StoredCard[] = [];
    try {
      if (!resultSet.goToFirstRow()) {
        return cards;
      }
      do {
        cards.push(this.readCard(resultSet));
      } while (resultSet.goToNextRow());
      return cards;
    } finally {
      resultSet.close();
    }
  }

  private readCard(resultSet: relationalStore.ResultSet): StoredCard {
    return new StoredCard({
      cardNumber: resultSet.getString(0),
      category: resultSet.getString(1),
      bankName: resultSet.getString(2),
      bankCardType: resultSet.getString(3),
      addedAt: resultSet.getLong(4),
      huaweiPayEnabled: resultSet.getLong(5) === 1,
      unionPayQuickPassEnabled: resultSet.getLong(6) === 1,
      transactionRecords: resultSet.getString(7)
    });
  }
}

/** 钱包银行卡本地 Repository；完整卡号是唯一业务键。 */
export class BankCardRepository {
  private readonly store: BankCardStore;

  constructor(context: Context | null = null, store: BankCardStore | null = null) {
    if (store !== null) {
      this.store = store;
      return;
    }
    if (context === null) {
      throw new Error('bank card store unavailable');
    }
    this.store = new RdbBankCardStore(context);
  }

  async save(card: StoredCard): Promise<StoredCard> {
    await this.store.beginTransaction();
    try {
      const existing: StoredCard | undefined = await this.store.findByCardNumber(card.cardNumber);
      if (existing !== undefined) {
        await this.store.commit();
        return existing;
      }
      await this.store.insert(card);
      await this.store.commit();
      return card;
    } catch {
      await this.store.rollBack();
      const existing: StoredCard | undefined = await this.store.findByCardNumber(card.cardNumber);
      if (existing !== undefined) {
        return existing;
      }
      throw new Error('bank card save failed');
    }
  }

  async list(): Promise<StoredCard[]> {
    return this.store.list();
  }
}
