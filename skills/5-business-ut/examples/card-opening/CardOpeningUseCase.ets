// ============================================================================
// 示例：CardOpeningUseCase
// 实际位置：02-Feature/CardOpen/src/main/ets/domain/usecase/CardOpeningUseCase.ets
// ----------------------------------------------------------------------------
// 规则强约束（ut-rules.yaml : usecase_class_pure BLOCKER）
//   - 本文件不得 import 任何 UI / 导航 / Toast 符号
//   - 禁止的 import 示例：
//       import { NavPathStack } from '@kit.ArkUI';
//       import { showToast } from '@aspect/CommUI';
//       import { $r, Component } from '...';
//   - 构造器注入所有 ports；禁止在 UseCase 内 new XxxRepository()
//   - UI 副作用（Toast / 导航 / 弹框显示）只通过 state 字段传递
// ============================================================================

// 下面这些 import 都是业务/数据层类型，不含 UI 符号
import { BankInfo, CardInfo, CardResource, ValidateResult, VerifyResult } from '../../data/model/CardOpening';
import { CardOpenApi } from '../../data/api/CardOpenApi';
import { CardPersistence } from '../../data/storage/CardPersistence';

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
export class CardOpeningState {
  phase: Phase = Phase.Idle;
  errorCode: string | null = null;
  resultCardId: string | null = null;
}

export class CardOpeningUseCase {
  readonly state: CardOpeningState = new CardOpeningState();

  // in-flight 上下文：分阶段保存中间结果
  private pendingValidate: ValidateResult | null = null;
  private pendingCard: CardInfo | null = null;

  constructor(
    private readonly api: CardOpenApi,
    private readonly storage: CardPersistence,
  ) {}

  // -----------------------------------------------------------------
  // trigger: 用户点击"开卡"
  // -----------------------------------------------------------------
  async startOpening(bankInfo: BankInfo): Promise<void> {
    this.state.phase = Phase.Validating;
    this.state.errorCode = null;
    this.state.resultCardId = null;

    // 步骤 2：云侧校验
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

    // 步骤 3：云侧申请卡资源
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

    // 步骤 4：本地持久化
    this.state.phase = Phase.Persisting;
    const cardInfo: CardInfo = {
      cardId: resource.cardId,
      holder: resource.holder,
      status: 'Pending',
    };
    try {
      await this.storage.save(cardInfo);
    } catch (e) {
      return this.fail('PERSIST_ERR');
    }
    this.pendingCard = cardInfo;

    // 等待短验
    this.state.phase = Phase.WaitingSms;
  }

  // -----------------------------------------------------------------
  // trigger: 用户输入短验
  // -----------------------------------------------------------------
  async submitSmsCode(smsCode: string): Promise<void> {
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

    // 步骤 7 成功：更新本地为激活态
    try {
      await this.storage.update({ ...this.pendingCard, status: 'Active' });
    } catch (e) {
      await this.rollbackAndFail('PERSIST_ERR');
      return;
    }
    this.state.resultCardId = this.pendingCard.cardId;
    this.state.phase = Phase.Success;
  }

  // -----------------------------------------------------------------
  // trigger: 用户主动取消（如退出页面）
  // -----------------------------------------------------------------
  async cancel(): Promise<void> {
    if (this.pendingCard) {
      try {
        await this.storage.rollback(this.pendingCard.cardId);
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
        await this.storage.rollback(this.pendingCard.cardId);
      } catch (_e) {
        // rollback 的异常由 Skill 6 独立覆盖；UT 不要求此分支
      }
    }
    this.fail(code);
  }
}
