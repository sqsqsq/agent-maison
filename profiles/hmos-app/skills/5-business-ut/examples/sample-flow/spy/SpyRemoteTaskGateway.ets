// ============================================================================
// 示例替身：RemoteTaskGateway（v2.1）
// ============================================================================

import { RemoteTaskGateway } from '../../../../main/ets/data/api/RemoteTaskGateway';
import { TaskPayload, AllocationResult, GateValidateResult, OtpVerifyResult } from '../../../../main/ets/data/model/TaskSample';

class Slot<T> {
  private _value: T | undefined;
  private _error: Error | undefined;
  returns(value: T): void {
    this._value = value;
    this._error = undefined;
  }
  throws(err: Error): void {
    this._error = err;
    this._value = undefined;
  }
  resolve(): T {
    if (this._error) {
      throw this._error;
    }
    if (this._value === undefined) {
      throw new Error('SpyRemoteTaskGateway: slot not configured');
    }
    return this._value;
  }
}

export class SpyRemoteTaskGateway extends RemoteTaskGateway {
  readonly whenValidateRequest = new Slot<GateValidateResult>();
  readonly whenAllocateResource = new Slot<AllocationResult>();
  readonly whenVerifyOtpCode = new Slot<OtpVerifyResult>();

  readonly callLog: string[] = [];

  override async validateRequest(_p: TaskPayload): Promise<GateValidateResult> {
    this.callLog.push('validateRequest');
    return this.whenValidateRequest.resolve();
  }

  override async allocateResource(_g: GateValidateResult): Promise<AllocationResult> {
    this.callLog.push('allocateResource');
    return this.whenAllocateResource.resolve();
  }

  override async verifyOtpCode(_taskId: string, _code: string): Promise<OtpVerifyResult> {
    this.callLog.push('verifyOtpCode');
    return this.whenVerifyOtpCode.resolve();
  }
}
