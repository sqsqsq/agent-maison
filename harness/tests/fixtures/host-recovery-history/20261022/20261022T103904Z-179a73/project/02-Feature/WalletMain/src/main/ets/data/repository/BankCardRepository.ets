import { Context } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { BankCardRecord } from '../model/BankCardRecord';
import { BankCardType } from '../model/BankCardType';
import { SaveBankCardResult } from '../model/SaveBankCardResult';

export class BankCardRepository {
  private static instance: BankCardRepository = new BankCardRepository();
  private context: Context | null = null;
  private ready: Promise<relationalStore.RdbStore> | null = null;

  static getInstance(context?: Context): BankCardRepository {
    if (context !== undefined) {
      BankCardRepository.instance.context = context;
    }
    return BankCardRepository.instance;
  }

  private async getStore(): Promise<relationalStore.RdbStore> {
    if (this.ready === null) {
      this.ready = this.openStore();
    }
    try {
      return await this.ready;
    } catch {
      this.ready = null;
      throw new Error('CARD_STORE_UNAVAILABLE');
    }
  }

  private async openStore(): Promise<relationalStore.RdbStore> {
    if (this.context === null) {
      throw new Error('CARD_STORE_CONTEXT_REQUIRED');
    }
    const config: relationalStore.StoreConfig = { name: 'bank_card.db', securityLevel: relationalStore.SecurityLevel.S2 };
    const store: relationalStore.RdbStore = await relationalStore.getRdbStore(this.context, config);
    try {
      await store.executeSql("CREATE TABLE IF NOT EXISTS bank_card (id INTEGER PRIMARY KEY AUTOINCREMENT, card_number TEXT NOT NULL UNIQUE, card_kind TEXT NOT NULL DEFAULT 'BANK_CARD', bank_name TEXT NOT NULL, bank_card_type TEXT NOT NULL, added_at INTEGER NOT NULL, huawei_pay_enabled INTEGER NOT NULL DEFAULT 0, unionpay_quickpass_enabled INTEGER NOT NULL DEFAULT 0, transactions_json TEXT NOT NULL DEFAULT '[]')");
      if (store.version === 0) {
        store.version = 1;
      }
      return store;
    } catch {
      store.close();
      throw new Error('CARD_STORE_INITIALIZATION_FAILED');
    }
  }

  async save(record: BankCardRecord): Promise<SaveBankCardResult> {
    let success: boolean = false;
    try {
      const store: relationalStore.RdbStore = await this.getStore();
      const values: relationalStore.ValuesBucket = {
        card_number: record.cardNumber, card_kind: record.cardKind,
        bank_name: record.bankName, bank_card_type: record.bankCardType,
        added_at: record.addedAt, huawei_pay_enabled: record.huaweiPayEnabled ? 1 : 0,
        unionpay_quickpass_enabled: record.unionPayQuickPassEnabled ? 1 : 0,
        transactions_json: record.transactionsJson
      };
      const rowId: number = await store.insert('bank_card', values, relationalStore.ConflictResolution.ON_CONFLICT_IGNORE);
      if (rowId > 0) {
        success = true;
      } else {
        success = await this.contains(store, record.cardNumber);
      }
    } catch {
      // Only a positive reread recovers an actual duplicate; no raw database error escapes.
      try {
        success = await this.contains(await this.getStore(), record.cardNumber);
      } catch {
        success = false;
      }
    }
    return { success: success, cardNumber: record.cardNumber, errorMessage: success ? '' : 'CARD_SAVE_FAILED' };
  }

  private async contains(store: relationalStore.RdbStore, cardNumber: string): Promise<boolean> {
    const predicates: relationalStore.RdbPredicates = new relationalStore.RdbPredicates('bank_card');
    predicates.equalTo('card_number', cardNumber);
    const result: relationalStore.ResultSet = await store.query(predicates, ['card_number']);
    try {
      return result.goToFirstRow();
    } finally {
      result.close();
    }
  }

  async list(): Promise<BankCardRecord[]> {
    const store: relationalStore.RdbStore = await this.getStore();
    const predicates: relationalStore.RdbPredicates = new relationalStore.RdbPredicates('bank_card');
    predicates.orderByDesc('added_at');
    const result: relationalStore.ResultSet = await store.query(predicates);
    const records: BankCardRecord[] = [];
    try {
      while (result.goToNextRow()) {
        records.push({
          cardNumber: result.getString(result.getColumnIndex('card_number')),
          cardKind: result.getString(result.getColumnIndex('card_kind')),
          bankName: result.getString(result.getColumnIndex('bank_name')),
          bankCardType: result.getString(result.getColumnIndex('bank_card_type')) as BankCardType,
          addedAt: result.getLong(result.getColumnIndex('added_at')),
          huaweiPayEnabled: result.getLong(result.getColumnIndex('huawei_pay_enabled')) === 1,
          unionPayQuickPassEnabled: result.getLong(result.getColumnIndex('unionpay_quickpass_enabled')) === 1,
          transactionsJson: result.getString(result.getColumnIndex('transactions_json'))
        });
      }
      return records;
    } finally {
      result.close();
    }
  }
}

