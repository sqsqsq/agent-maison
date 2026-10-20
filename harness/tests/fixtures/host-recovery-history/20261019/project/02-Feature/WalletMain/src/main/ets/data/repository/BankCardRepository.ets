import { Context } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { Logger } from '@aspect/CommFunc';
import { BankCardInfo } from '../model/BankCardInfo';
import { CardRecord } from '../model/CardRecord';
import { OpenCardResult } from '../model/OpenCardResult';
import { BankCardType } from '../model/BankCardType';

export class BankCardRepository {
  private static readonly TABLE: string = 'wallet_cards';

  protected async openStore(context: Context): Promise<relationalStore.RdbStore> {
    const config: relationalStore.StoreConfig = {
      name: 'wallet.db', securityLevel: relationalStore.SecurityLevel.S1
    };
    const store: relationalStore.RdbStore = await relationalStore.getRdbStore(context, config);
    await store.executeSql(`CREATE TABLE IF NOT EXISTS wallet_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_card_number TEXT NOT NULL UNIQUE,
      generic_card_type TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      bank_code TEXT NOT NULL,
      bank_card_type TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      huawei_pay_enabled INTEGER NOT NULL,
      unionpay_quickpass_enabled INTEGER NOT NULL,
      transaction_records TEXT NOT NULL)`);
    if (store.version === 0) {
      store.version = 1;
    }
    return store;
  }

  async saveCard(context: Context, card: BankCardInfo): Promise<OpenCardResult> {
    let store: relationalStore.RdbStore | null = null;
    let transactionStarted: boolean = false;
    try {
      if (!/^\d{12,19}$/.test(card.fullCardNumber) || card.bankCode.length === 0 ||
        card.bankName.length === 0 || (card.bankCardType !== BankCardType.DEBIT &&
        card.bankCardType !== BankCardType.CREDIT)) {
        return new OpenCardResult(false, card.fullCardNumber, 'invalid_card');
      }
      store = await this.openStore(context);
      const values: relationalStore.ValuesBucket = {
        full_card_number: card.fullCardNumber,
        generic_card_type: 'bank_card',
        bank_name: card.bankName,
        bank_code: card.bankCode,
        bank_card_type: card.bankCardType,
        added_at: Date.now(),
        huawei_pay_enabled: card.huaweiPayEnabled ? 1 : 0,
        unionpay_quickpass_enabled: card.unionPayQuickPassEnabled ? 1 : 0,
        transaction_records: '[]'
      };
      store.beginTransaction();
      transactionStarted = true;
      await store.insert(BankCardRepository.TABLE, values, relationalStore.ConflictResolution.ON_CONFLICT_ABORT);
      store.commit();
      transactionStarted = false;
      return new OpenCardResult(true, card.fullCardNumber);
    } catch {
      if (store !== null && transactionStarted) {
        try {
          store.rollBack();
        } catch {
          Logger.error('BankCardRepository', 'rollback failed');
        }
      }
      Logger.error('BankCardRepository', 'save card failed');
      return new OpenCardResult(false, card.fullCardNumber, 'save_failed');
    }
  }

  async listCards(context: Context): Promise<CardRecord[]> {
    const predicates = new relationalStore.RdbPredicates(BankCardRepository.TABLE);
    predicates.orderByDesc('added_at');
    return this.queryCards(context, predicates);
  }

  async findByFullCardNumber(context: Context, fullCardNumber: string): Promise<CardRecord | null> {
    const predicates = new relationalStore.RdbPredicates(BankCardRepository.TABLE);
    predicates.equalTo('full_card_number', fullCardNumber);
    const cards: CardRecord[] = await this.queryCards(context, predicates);
    return cards.length === 0 ? null : cards[0];
  }

  private async queryCards(context: Context, predicates: relationalStore.RdbPredicates): Promise<CardRecord[]> {
    let resultSet: relationalStore.ResultSet | null = null;
    try {
      const store: relationalStore.RdbStore = await this.openStore(context);
      resultSet = await store.query(predicates);
      const cards: CardRecord[] = [];
      while (resultSet.goToNextRow()) {
        const card: CardRecord = new CardRecord();
        card.id = resultSet.getLong(resultSet.getColumnIndex('id'));
        card.fullCardNumber = resultSet.getString(resultSet.getColumnIndex('full_card_number'));
        card.genericCardType = resultSet.getString(resultSet.getColumnIndex('generic_card_type'));
        card.bankName = resultSet.getString(resultSet.getColumnIndex('bank_name'));
        card.bankCode = resultSet.getString(resultSet.getColumnIndex('bank_code'));
        card.bankCardType = resultSet.getString(resultSet.getColumnIndex('bank_card_type'));
        card.addedAt = resultSet.getLong(resultSet.getColumnIndex('added_at'));
        card.huaweiPayEnabled = resultSet.getLong(resultSet.getColumnIndex('huawei_pay_enabled')) === 1;
        card.unionPayQuickPassEnabled = resultSet.getLong(resultSet.getColumnIndex('unionpay_quickpass_enabled')) === 1;
        card.transactionRecords = resultSet.getString(resultSet.getColumnIndex('transaction_records'));
        cards.push(card);
      }
      return cards;
    } catch {
      Logger.error('BankCardRepository', 'query cards failed');
      throw new Error('card_query_failed');
    } finally {
      resultSet?.close();
    }
  }
}
