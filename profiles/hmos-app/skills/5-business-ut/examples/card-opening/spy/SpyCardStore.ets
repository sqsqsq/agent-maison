// ============================================================================
// 示例替身（v2.1）：本地数据边界 CardStore 的 Spy 子类
// 实际位置：02-Feature/CardOpen/src/ohosTest/ets/test/spy/SpyCardStore.ets
// ----------------------------------------------------------------------------
// v2.1 规则：
//   - 直接 **extends** 既有 data 层类 CardStore，override 其方法（不是 implements XxxPort）
//   - 暴露 callLog / saved / currentCards 等可断言的内部状态
//   - 每个方法一份 whenXxx.{returns, throws} preset
//   - 禁止在 Spy 内写业务判断
// ============================================================================

import { CardStore } from '../../../../main/ets/data/storage/CardStore';
import { CardInfo } from '../../../../main/ets/data/model/CardOpening';

class Slot {
  private _error: Error | undefined;
  returns(): void { this._error = undefined; }     // 成功：本地 store 多为 void
  throws(err: Error): void { this._error = err; }
  check(): void { if (this._error) throw this._error; }
}

export class SpyCardStore extends CardStore {
  readonly whenSave = new Slot();
  readonly whenUpdate = new Slot();
  readonly whenRollback = new Slot();

  readonly callLog: string[] = [];
  readonly saved: CardInfo[] = [];
  readonly currentCards: CardInfo[] = [];

  override async save(info: CardInfo): Promise<void> {
    this.callLog.push('save');
    this.saved.push({ ...info });
    this.whenSave.check();
    this.currentCards.push({ ...info });
  }

  override async update(info: CardInfo): Promise<void> {
    this.callLog.push('update');
    this.whenUpdate.check();
    const idx = this.currentCards.findIndex(c => c.cardId === info.cardId);
    if (idx >= 0) this.currentCards[idx] = { ...info };
  }

  override async rollback(cardId: string): Promise<void> {
    this.callLog.push('rollback');
    this.whenRollback.check();
    const idx = this.currentCards.findIndex(c => c.cardId === cardId);
    if (idx >= 0) this.currentCards.splice(idx, 1);
  }
}
