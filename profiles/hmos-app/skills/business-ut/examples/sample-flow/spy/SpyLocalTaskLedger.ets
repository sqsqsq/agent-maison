// ============================================================================
// 示例替身：LocalTaskLedger（v2.1）
// ============================================================================

import { LocalTaskLedger } from '../../../../main/ets/data/storage/LocalTaskLedger';
import { TaskRecord } from '../../../../main/ets/data/model/TaskSample';

class SlotLedger {
  private _error: Error | undefined;
  returns(): void {
    this._error = undefined;
  }
  throws(err: Error): void {
    this._error = err;
  }
  check(): void {
    if (this._error) {
      throw this._error;
    }
  }
}

export class SpyLocalTaskLedger extends LocalTaskLedger {
  readonly whenSave = new SlotLedger();
  readonly whenUpdate = new SlotLedger();
  readonly whenRollback = new SlotLedger();

  readonly callLog: string[] = [];
  readonly saved: TaskRecord[] = [];
  readonly currentTasks: TaskRecord[] = [];

  override async save(info: TaskRecord): Promise<void> {
    this.callLog.push('save');
    this.saved.push({ ...info });
    this.whenSave.check();
    this.currentTasks.push({ ...info });
  }

  override async update(info: TaskRecord): Promise<void> {
    this.callLog.push('update');
    this.whenUpdate.check();
    const idx = this.currentTasks.findIndex(c => c.taskId === info.taskId);
    if (idx >= 0) {
      this.currentTasks[idx] = { ...info };
    }
  }

  override async rollback(taskId: string): Promise<void> {
    this.callLog.push('rollback');
    this.whenRollback.check();
    const idx = this.currentTasks.findIndex(c => c.taskId === taskId);
    if (idx >= 0) {
      this.currentTasks.splice(idx, 1);
    }
  }
}
