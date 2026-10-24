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

/** 钱包银行卡本地 RDB；完整卡号是唯一业务键。 */
export class BankCardRepository {
  private storePromise: Promise<relationalStore.RdbStore> | null = null;
  private readonly context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  private async getStore(): Promise<relationalStore.RdbStore> {
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

  async save(card: StoredCard): Promise<StoredCard> {
    const store: relationalStore.RdbStore = await this.getStore();
    store.beginTransaction();
    try {
      const existing: StoredCard | undefined = await this.findByCardNumber(store, card.cardNumber);
      if (existing !== undefined) {
        store.commit();
        return existing;
      }
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
      store.commit();
      return card;
    } catch {
      store.rollBack();
      const existing: StoredCard | undefined = await this.findByCardNumber(store, card.cardNumber);
      if (existing !== undefined) {
        return existing;
      }
      throw new Error('bank card save failed');
    }
  }

  async list(): Promise<StoredCard[]> {
    const store: relationalStore.RdbStore = await this.getStore();
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

  private async findByCardNumber(
    store: relationalStore.RdbStore,
    cardNumber: string
  ): Promise<StoredCard | undefined> {
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
