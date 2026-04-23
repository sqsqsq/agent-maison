// ============================================================================
// 示例 UT：CardOpeningUseCase 端到端业务级测试
// 实际位置：02-Feature/CardOpen/src/ohosTest/ets/test/card_opening.test.ets
// ----------------------------------------------------------------------------
// 关键特征（符合 ut-rules.yaml）：
//   - 无任何 UI/Nav/Toast import（no_ui_dep_in_ut BLOCKER）
//   - 通过构造器注入 SpyPort（ports_all_stubbed BLOCKER）
//   - 每个 it() 端到端串联多个 port 调用 + 多个 state 断言（end_to_end_driving MAJOR）
//   - 用例名含 [AC-X] 和 [BRANCH-id] 双标签（it_name_has_ac_or_branch_tag BLOCKER）
// ============================================================================

import { describe, it, expect, beforeEach } from '@ohos/hypium';
import { CardOpeningUseCase, Phase } from '../../../main/ets/domain/usecase/CardOpeningUseCase';
import { SpyCardOpenApi } from './spy/SpyCardOpenApi';
import { SpyCardPersistence } from './spy/SpyCardPersistence';

export default function cardOpeningUseCaseTest(): void {
  describe('CardOpeningUseCase', () => {
    let api: SpyCardOpenApi;
    let storage: SpyCardPersistence;
    let useCase: CardOpeningUseCase;

    beforeEach((): void => {
      api = new SpyCardOpenApi();
      storage = new SpyCardPersistence();
      useCase = new CardOpeningUseCase(api, storage);
    });

    // ------------------------------------------------------------------ BRANCH-happy_path
    it('[BRANCH-happy_path][AC-1] 开卡全链路成功：校验→申请→持久化→短验→激活', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' });
      api.whenVerifySmsCode.returns({ ok: true });

      await useCase.startOpening({ bankCode: 'BOC', userId: 'u1' });

      expect(useCase.state.phase).assertEqual(Phase.WaitingSms);
      expect(storage.callLog).assertDeepEquals(['save']);
      expect(storage.saved[0].cardId).assertEqual('c1');
      expect(storage.saved[0].status).assertEqual('Pending');

      await useCase.submitSmsCode('123456');

      expect(useCase.state.phase).assertEqual(Phase.Success);
      expect(useCase.state.resultCardId).assertEqual('c1');
      expect(useCase.state.errorCode).assertNull();
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource', 'verifySmsCode']);
      expect(storage.callLog).assertDeepEquals(['save', 'update']);
      expect(storage.currentCards[0].status).assertEqual('Active');
    });

    // ------------------------------------------------------------------ BRANCH-validate_fail
    it('[BRANCH-validate_fail][AC-2] 云侧校验失败：不触发任何后续调用', 0, async () => {
      api.whenValidateOpen.returns({ ok: false, code: 'VAL_ERR' });

      await useCase.startOpening({ bankCode: 'BOC', userId: 'u1' });

      expect(useCase.state.phase).assertEqual(Phase.Failed);
      expect(useCase.state.errorCode).assertEqual('VAL_ERR');
      expect(api.callLog).assertDeepEquals(['validateOpen']);
      expect(storage.callLog).assertDeepEquals([]);
    });

    // ------------------------------------------------------------------ BRANCH-apply_fail
    it('[BRANCH-apply_fail][AC-7] 云侧申请卡资源失败：不写本地、不发短验', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.throws(new Error('apply-timeout'));

      await useCase.startOpening({ bankCode: 'BOC', userId: 'u1' });

      expect(useCase.state.phase).assertEqual(Phase.Failed);
      expect(useCase.state.errorCode).assertEqual('APPLY_ERR');
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource']);
      expect(storage.callLog).assertDeepEquals([]);
    });

    // ------------------------------------------------------------------ BRANCH-persist_fail
    it('[BRANCH-persist_fail][AC-4] 本地持久化失败：流程终止于 Persisting', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' });
      storage.whenSave.throws(new Error('disk-full'));

      await useCase.startOpening({ bankCode: 'BOC', userId: 'u1' });

      expect(useCase.state.phase).assertEqual(Phase.Failed);
      expect(useCase.state.errorCode).assertEqual('PERSIST_ERR');
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource']);
      expect(storage.callLog).assertDeepEquals(['save']);
      expect(storage.currentCards.length).assertEqual(0);
    });

    // ------------------------------------------------------------------ BRANCH-sms_fail_rollback
    it('[BRANCH-sms_fail_rollback][AC-3] 短验失败：已持久化卡被回滚', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' });
      api.whenVerifySmsCode.returns({ ok: false, code: 'SMS_ERR' });

      await useCase.startOpening({ bankCode: 'BOC', userId: 'u1' });
      await useCase.submitSmsCode('999999');

      expect(useCase.state.phase).assertEqual(Phase.Failed);
      expect(useCase.state.errorCode).assertEqual('SMS_ERR');
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource', 'verifySmsCode']);
      expect(storage.callLog).assertDeepEquals(['save', 'rollback']);
      expect(storage.currentCards.length).assertEqual(0);
    });

    // ------------------------------------------------------------------ BRANCH-user_cancel_in_waiting_sms
    it('[BRANCH-user_cancel_in_waiting_sms][AC-6] 用户在等待短验阶段取消：已持久化卡被回滚', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' });

      await useCase.startOpening({ bankCode: 'BOC', userId: 'u1' });
      expect(useCase.state.phase).assertEqual(Phase.WaitingSms);

      await useCase.cancel();

      expect(useCase.state.phase).assertEqual(Phase.Failed);
      expect(useCase.state.errorCode).assertEqual('USER_CANCELLED');
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource']);
      expect(storage.callLog).assertDeepEquals(['save', 'rollback']);
      expect(storage.currentCards.length).assertEqual(0);
    });
  });
}
