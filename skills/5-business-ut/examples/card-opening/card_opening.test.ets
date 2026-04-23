// ============================================================================
// 示例 UT：CardOpenFlow 端到端业务级测试（v2.1）
// 实际位置：02-Feature/CardOpen/src/ohosTest/ets/test/card_opening.test.ets
// ----------------------------------------------------------------------------
// 关键特征（符合 ut-rules.yaml · v2.1）：
//   - 无任何 UI/Nav/Toast/AppStorage import（ut_import_whitelist BLOCKER）
//   - 不 new @Component struct；直接调用 ui_bindings.user_actions.calls 指向的命名方法
//   - 通过构造器注入 Spy 子类（boundaries_all_stubbed BLOCKER）
//   - 每个 it() 端到端串联多个 boundary 调用 + 多个 state 断言（it_drives_flow）
//   - 用例名含 [AC-X] 和 [BRANCH-id] 双标签（it_name_has_ac_or_branch_tag BLOCKER）
// ============================================================================

import { describe, it, expect, beforeEach } from '@ohos/hypium';
import { CardOpenFlow, Phase } from '../../../main/ets/domain/flow/CardOpenFlow';
import { SpyCardOpenApi } from './spy/SpyCardOpenApi';
import { SpyCardStore } from './spy/SpyCardStore';

export default function cardOpenFlowTest(): void {
  describe('CardOpenFlow', () => {
    let api: SpyCardOpenApi;
    let store: SpyCardStore;
    let flow: CardOpenFlow;

    beforeEach((): void => {
      api = new SpyCardOpenApi();
      store = new SpyCardStore();
      flow = new CardOpenFlow(api, store);
    });

    // ------------------------------------------------------------------ BRANCH-happy_path
    it('[BRANCH-happy_path][AC-1] 开卡全链路成功：校验→申请→持久化→短验→激活', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' });
      api.whenVerifySmsCode.returns({ ok: true });

      // 对应 use-cases.yaml > ui_bindings[CardSelectPage].user_actions.calls = "flow.chooseCard"
      await flow.chooseCard({ bankCode: 'BOC', userId: 'u1' });

      expect(flow.state.phase).assertEqual(Phase.WaitingSms);
      expect(store.callLog).assertDeepEquals(['save']);
      expect(store.saved[0].cardId).assertEqual('c1');
      expect(store.saved[0].status).assertEqual('Pending');

      // 对应 ui_bindings[SmsDialog].user_actions.calls = "flow.confirmSms"
      await flow.confirmSms('123456');

      expect(flow.state.phase).assertEqual(Phase.Success);
      expect(flow.state.resultCardId).assertEqual('c1');
      expect(flow.state.errorCode).assertNull();
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource', 'verifySmsCode']);
      expect(store.callLog).assertDeepEquals(['save', 'update']);
      expect(store.currentCards[0].status).assertEqual('Active');
    });

    // ------------------------------------------------------------------ BRANCH-validate_fail
    it('[BRANCH-validate_fail][AC-2] 云侧校验失败：不触发任何后续调用', 0, async () => {
      api.whenValidateOpen.returns({ ok: false, code: 'VAL_ERR' });

      await flow.chooseCard({ bankCode: 'BOC', userId: 'u1' });

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('VAL_ERR');
      expect(api.callLog).assertDeepEquals(['validateOpen']);
      expect(store.callLog).assertDeepEquals([]);
    });

    // ------------------------------------------------------------------ BRANCH-apply_fail
    it('[BRANCH-apply_fail][AC-7] 云侧申请卡资源失败：不写本地、不发短验', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.throws(new Error('apply-timeout'));

      await flow.chooseCard({ bankCode: 'BOC', userId: 'u1' });

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('APPLY_ERR');
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource']);
      expect(store.callLog).assertDeepEquals([]);
    });

    // ------------------------------------------------------------------ BRANCH-persist_fail
    it('[BRANCH-persist_fail][AC-4] 本地持久化失败：流程终止于 Persisting', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' });
      store.whenSave.throws(new Error('disk-full'));

      await flow.chooseCard({ bankCode: 'BOC', userId: 'u1' });

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('PERSIST_ERR');
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource']);
      expect(store.callLog).assertDeepEquals(['save']);
      expect(store.currentCards.length).assertEqual(0);
    });

    // ------------------------------------------------------------------ BRANCH-sms_fail_rollback
    it('[BRANCH-sms_fail_rollback][AC-3] 短验失败：已持久化卡被回滚', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' });
      api.whenVerifySmsCode.returns({ ok: false, code: 'SMS_ERR' });

      await flow.chooseCard({ bankCode: 'BOC', userId: 'u1' });
      await flow.confirmSms('999999');

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('SMS_ERR');
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource', 'verifySmsCode']);
      expect(store.callLog).assertDeepEquals(['save', 'rollback']);
      expect(store.currentCards.length).assertEqual(0);
    });

    // ------------------------------------------------------------------ BRANCH-user_cancel_in_waiting_sms
    it('[BRANCH-user_cancel_in_waiting_sms][AC-6] 用户在等待短验阶段取消：已持久化卡被回滚', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' });
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' });

      await flow.chooseCard({ bankCode: 'BOC', userId: 'u1' });
      expect(flow.state.phase).assertEqual(Phase.WaitingSms);

      // 对应 ui_bindings[SmsDialog].user_actions.calls = "flow.cancel"
      await flow.cancel();

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('USER_CANCELLED');
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource']);
      expect(store.callLog).assertDeepEquals(['save', 'rollback']);
      expect(store.currentCards.length).assertEqual(0);
    });
  });
}
