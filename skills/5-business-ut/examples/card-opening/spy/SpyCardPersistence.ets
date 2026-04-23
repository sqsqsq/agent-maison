// ============================================================================
// 示例 SpyPort：本地端口 CardPersistence 的测试替身
// 实际位置：02-Feature/CardOpen/src/ohosTest/ets/test/spy/SpyCardPersistence.ets
// ============================================================================

import { CardPersistence } from '../../../../main/ets/data/storage/CardPersistence';
import { CardInfo } from '../../../../main/ets/data/model/CardOpening';

class Slot {
  private _error: Error | undefined;
  returns(): void { this._error = undefined; }     // 成功：本地端口多为 void
  throws(err: Error): void { this._error = err; }
  check(): void { if (this._error) throw this._error; }
}

export class SpyCardPersistence implements CardPersistence {
  readonly whenSave = new Slot();
  readonly whenUpdate = new Slot();
  readonly whenRollback = new Slot();

  readonly callLog: string[] = [];
  readonly saved: CardInfo[] = [];
  readonly currentCards: CardInfo[] = [];

  async save(info: CardInfo): Promise<void> {
    this.callLog.push('save');
    this.saved.push({ ...info });
    this.whenSave.check();
    this.currentCards.push({ ...info });
  }

  async update(info: CardInfo): Promise<void> {
    this.callLog.push('update');
    this.whenUpdate.check();
    const idx = this.currentCards.findIndex(c => c.cardId === info.cardId);
    if (idx >= 0) this.currentCards[idx] = { ...info };
  }

  async rollback(cardId: string): Promise<void> {
    this.callLog.push('rollback');
    this.whenRollback.check();
    const idx = this.currentCards.findIndex(c => c.cardId === cardId);
    if (idx >= 0) this.currentCards.splice(idx, 1);
  }
}
