// ============================================================================
// 示例替身（v2.1）：云侧数据边界 CardOpenApi 的 Spy 子类
// 实际位置：02-Feature/CardOpen/src/ohosTest/ets/test/spy/SpyCardOpenApi.ets
// ----------------------------------------------------------------------------
// 统一能力：
//   1. 预设每个方法的返回值 / 异常（returns / throws）
//   2. 记录方法调用序列（callLog），用于断言端到端链路
// ----------------------------------------------------------------------------
// v2.1：extends 既有 data 层类 CardOpenApi（不是 implements XxxPort）
// 不要在 Spy 里写业务逻辑——Spy 只做"可预设的打桩 + 调用日志"
// ============================================================================

import { CardOpenApi } from '../../../../main/ets/data/api/CardOpenApi';
import { BankInfo, CardResource, ValidateResult, VerifyResult } from '../../../../main/ets/data/model/CardOpening';

/** Spy 方法槽：返回固定值或抛异常 */
class Slot<T> {
  private _value: T | undefined;
  private _error: Error | undefined;
  returns(value: T): void { this._value = value; this._error = undefined; }
  throws(err: Error): void { this._error = err; this._value = undefined; }
  resolve(): T {
    if (this._error) throw this._error;
    if (this._value === undefined) {
      throw new Error(`SpyCardOpenApi: slot not configured`);
    }
    return this._value;
  }
}

export class SpyCardOpenApi extends CardOpenApi {
  readonly whenValidateOpen = new Slot<ValidateResult>();
  readonly whenApplyCardResource = new Slot<CardResource>();
  readonly whenVerifySmsCode = new Slot<VerifyResult>();

  readonly callLog: string[] = [];

  override async validateOpen(_info: BankInfo): Promise<ValidateResult> {
    this.callLog.push('validateOpen');
    return this.whenValidateOpen.resolve();
  }

  override async applyCardResource(_vr: ValidateResult): Promise<CardResource> {
    this.callLog.push('applyCardResource');
    return this.whenApplyCardResource.resolve();
  }

  override async verifySmsCode(_cardId: string, _sms: string): Promise<VerifyResult> {
    this.callLog.push('verifySmsCode');
    return this.whenVerifySmsCode.resolve();
  }
}
