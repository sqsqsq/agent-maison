// ============================================================================
// 示例：CardOpenFlow（v2.1 · 普通 ArkTS 业务编排类，非 UseCase）
// 实际位置：02-Feature/CardOpen/src/main/ets/domain/flow/CardOpenFlow.ets
// ----------------------------------------------------------------------------
// v2.1 的形态选择（见 Skill 3 Step 3.5.1）：
//   - 本流程跨 3 个页面 + 1 个弹框，且含回滚分支 → 选形态 B：普通 ArkTS 协调类
//   - 文件放在 domain/flow/ 下（也可放 shared/ 下，不强制 domain/usecase/）
//
// 代码级约束（由 Skill 3 harness named_business_handler / layer_compliance 校验）：
//   - chooseCard / confirmSms / cancel 都是命名 async 方法，UT 可直接调用
//     （对应 use-cases.yaml > ui_bindings[].user_actions[].calls）
//   - 构造器注入既有 data 层类（CardOpenApi / CardStore），**非新造 Port 接口**
//   - 本文件禁止 import UI/Nav/Toast 符号（ut_import_whitelist 同款禁用清单）
// ============================================================================

// 下面这些 import 都是业务/数据层类型，不含 UI 符号
import { BankInfo, CardInfo, CardResource, ValidateResult, VerifyResult } from '../../data/model/CardOpening';
import { CardOpenApi } from '../../data/api/CardOpenApi';
import { CardStore } from '../../data/storage/CardStore';

export enum Phase {
  Idle = 'Idle',
  Validating = 'Validating',
  Applying = 'Applying',
  Persisting = 'Persisting',
  WaitingSms = 'WaitingSms',
  Verifying = 'Verifying',
  Success = 'Success',
  Failed = 'Failed',
}

@Observed
export class CardOpenState {
  phase: Phase = Phase.Idle;
  errorCode: string | null = null;
  resultCardId: string | null = null;
}

export class CardOpenFlow {
  readonly state: CardOpenState = new CardOpenState();

  // in-flight 上下文：分阶段保存中间结果
  private pendingValidate: ValidateResult | null = null;
  private pendingCard: CardInfo | null = null;

  constructor(
    private readonly api: CardOpenApi,
    private readonly store: CardStore,
  ) {}

  // -----------------------------------------------------------------
  // 业务入口：用户在 CardSelectPage 点击"开卡"（ui_bindings.calls=flow.chooseCard）
  // -----------------------------------------------------------------
  async chooseCard(bankInfo: BankInfo): Promise<void> {
    this.state.phase = Phase.Validating;
    this.state.errorCode = null;
    this.state.resultCardId = null;

    let vr: ValidateResult;
    try {
      vr = await this.api.validateOpen(bankInfo);
    } catch (e) {
      return this.fail('VAL_ERR');
    }
    if (!vr.ok) {
      return this.fail(vr.code ?? 'VAL_ERR');
    }
    this.pendingValidate = vr;

    this.state.phase = Phase.Applying;
    let resource: CardResource;
    try {
      resource = await this.api.applyCardResource(vr);
    } catch (e) {
      return this.fail('APPLY_ERR');
    }
    if (!resource.cardId) {
      return this.fail('APPLY_ERR');
    }

    this.state.phase = Phase.Persisting;
    const cardInfo: CardInfo = {
      cardId: resource.cardId,
      holder: resource.holder,
      status: 'Pending',
    };
    try {
      await this.store.save(cardInfo);
    } catch (e) {
      return this.fail('PERSIST_ERR');
    }
    this.pendingCard = cardInfo;

    this.state.phase = Phase.WaitingSms;
  }

  // -----------------------------------------------------------------
  // 业务入口：用户在 SmsDialog 输入短验并确认（ui_bindings.calls=flow.confirmSms）
  // -----------------------------------------------------------------
  async confirmSms(smsCode: string): Promise<void> {
    if (this.state.phase !== Phase.WaitingSms || !this.pendingCard) {
      return;
    }
    this.state.phase = Phase.Verifying;

    let vr: VerifyResult;
    try {
      vr = await this.api.verifySmsCode(this.pendingCard.cardId, smsCode);
    } catch (e) {
      await this.rollbackAndFail('SMS_ERR');
      return;
    }
    if (!vr.ok) {
      await this.rollbackAndFail(vr.code ?? 'SMS_ERR');
      return;
    }

    try {
      await this.store.update({ ...this.pendingCard, status: 'Active' });
    } catch (e) {
      await this.rollbackAndFail('PERSIST_ERR');
      return;
    }
    this.state.resultCardId = this.pendingCard.cardId;
    this.state.phase = Phase.Success;
  }

  // -----------------------------------------------------------------
  // 业务入口：用户点击取消（ui_bindings.calls=flow.cancel）
  // -----------------------------------------------------------------
  async cancel(): Promise<void> {
    if (this.pendingCard) {
      try {
        await this.store.rollback(this.pendingCard.cardId);
      } catch (_e) {
        // 回滚失败仍按取消处理，errorCode 用 USER_CANCELLED
      }
    }
    this.state.errorCode = 'USER_CANCELLED';
    this.state.phase = Phase.Failed;
  }

  // -----------------------------------------------------------------
  // internals
  // -----------------------------------------------------------------
  private fail(code: string): void {
    this.state.errorCode = code;
    this.state.phase = Phase.Failed;
  }

  private async rollbackAndFail(code: string): Promise<void> {
    if (this.pendingCard) {
      try {
        await this.store.rollback(this.pendingCard.cardId);
      } catch (_e) {
        // rollback 的异常由 Skill 6 独立覆盖；UT 不要求此分支
      }
    }
    this.fail(code);
  }
}
