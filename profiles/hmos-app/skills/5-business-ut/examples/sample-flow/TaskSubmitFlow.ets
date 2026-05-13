// ============================================================================
// 示例：TaskSubmitFlow（v2.1 · ArkTS 协调类，非 UI）
// 实际位置示意：02-Feature/TaskDemo/src/main/ets/domain/flow/TaskSubmitFlow.ets
// ============================================================================

import { TaskPayload, TaskRecord, AllocationResult, GateValidateResult, OtpVerifyResult } from '../../data/model/TaskSample';
import { RemoteTaskGateway } from '../../data/api/RemoteTaskGateway';
import { LocalTaskLedger } from '../../data/storage/LocalTaskLedger';

export enum Phase {
  Idle = 'Idle',
  Preparing = 'Preparing',
  Applying = 'Applying',
  Persisting = 'Persisting',
  WaitingOtp = 'WaitingOtp',
  Verifying = 'Verifying',
  Success = 'Success',
  Failed = 'Failed',
}

@Observed
export class TaskSubmitState {
  phase: Phase = Phase.Idle;
  errorCode: string | null = null;
  resultTaskId: string | null = null;
}

export class TaskSubmitFlow {
  readonly state: TaskSubmitState = new TaskSubmitState();

  private pendingGate: GateValidateResult | null = null;
  private pendingTask: TaskRecord | null = null;

  constructor(
    private readonly gateway: RemoteTaskGateway,
    private readonly ledger: LocalTaskLedger,
  ) {}

  async submitTask(payload: TaskPayload): Promise<void> {
    this.state.phase = Phase.Preparing;
    this.state.errorCode = null;
    this.state.resultTaskId = null;

    let gv: GateValidateResult;
    try {
      gv = await this.gateway.validateRequest(payload);
    } catch (_e) {
      return this.fail('VAL_ERR');
    }
    if (!gv.ok) {
      return this.fail(gv.code ?? 'VAL_ERR');
    }
    this.pendingGate = gv;

    this.state.phase = Phase.Applying;
    let alloc: AllocationResult;
    try {
      alloc = await this.gateway.allocateResource(gv);
    } catch (_e) {
      return this.fail('APPLY_ERR');
    }
    if (!alloc.taskId) {
      return this.fail('APPLY_ERR');
    }

    this.state.phase = Phase.Persisting;
    const record: TaskRecord = {
      taskId: alloc.taskId,
      owner: alloc.owner,
      status: 'Pending',
    };
    try {
      await this.ledger.save(record);
    } catch (_e) {
      return this.fail('PERSIST_ERR');
    }
    this.pendingTask = record;

    this.state.phase = Phase.WaitingOtp;
  }

  async confirmOtp(code: string): Promise<void> {
    if (this.state.phase !== Phase.WaitingOtp || !this.pendingTask) {
      return;
    }
    this.state.phase = Phase.Verifying;

    let ov: OtpVerifyResult;
    try {
      ov = await this.gateway.verifyOtpCode(this.pendingTask.taskId, code);
    } catch (_e) {
      await this.rollbackAndFail('OTP_ERR');
      return;
    }
    if (!ov.ok) {
      await this.rollbackAndFail(ov.code ?? 'OTP_ERR');
      return;
    }

    try {
      await this.ledger.update({ ...this.pendingTask, status: 'Active' });
    } catch (_e) {
      await this.rollbackAndFail('PERSIST_ERR');
      return;
    }
    this.state.resultTaskId = this.pendingTask.taskId;
    this.state.phase = Phase.Success;
  }

  async cancel(): Promise<void> {
    if (this.pendingTask) {
      try {
        await this.ledger.rollback(this.pendingTask.taskId);
      } catch (_e) {
        // 回滚异常由真机/上层处理
      }
    }
    this.state.errorCode = 'USER_CANCELLED';
    this.state.phase = Phase.Failed;
  }

  private fail(code: string): void {
    this.state.errorCode = code;
    this.state.phase = Phase.Failed;
  }

  private async rollbackAndFail(code: string): Promise<void> {
    if (this.pendingTask) {
      try {
        await this.ledger.rollback(this.pendingTask.taskId);
      } catch (_e) {
        // 忽略
      }
    }
    this.fail(code);
  }
}
