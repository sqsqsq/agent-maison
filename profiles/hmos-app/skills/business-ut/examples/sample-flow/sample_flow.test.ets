// ============================================================================
// 示例 UT：TaskSubmitFlow 业务级端到端测试（v2.1）
// 实际路径示意：02-Feature/TaskDemo/src/ohosTest/ets/test/sample_flow.test.ets
// ============================================================================

import { describe, it, expect, beforeEach } from '@ohos/hypium';
import { TaskSubmitFlow, Phase } from '../../../main/ets/domain/flow/TaskSubmitFlow';
import { SpyRemoteTaskGateway } from './spy/SpyRemoteTaskGateway';
import { SpyLocalTaskLedger } from './spy/SpyLocalTaskLedger';

export default function taskSubmitFlowTest(): void {
  describe('TaskSubmitFlow', () => {
    let gateway: SpyRemoteTaskGateway;
    let ledger: SpyLocalTaskLedger;
    let flow: TaskSubmitFlow;

    beforeEach((): void => {
      gateway = new SpyRemoteTaskGateway();
      ledger = new SpyLocalTaskLedger();
      flow = new TaskSubmitFlow(gateway, ledger);
    });

    it('[BRANCH-happy_path][AC-1] 端到端成功：校验→配额→持久化→二次校验→激活', 0, async () => {
      gateway.whenValidateRequest.returns({ ok: true, token: 't' });
      gateway.whenAllocateResource.returns({ taskId: 't1', owner: 'u1' });
      gateway.whenVerifyOtpCode.returns({ ok: true });

      await flow.submitTask({ sku: 'SKU1', actorId: 'u1' });

      expect(flow.state.phase).assertEqual(Phase.WaitingOtp);
      expect(ledger.callLog).assertDeepEquals(['save']);
      expect(ledger.saved[0].taskId).assertEqual('t1');
      expect(ledger.saved[0].status).assertEqual('Pending');

      await flow.confirmOtp('654321');

      expect(flow.state.phase).assertEqual(Phase.Success);
      expect(flow.state.resultTaskId).assertEqual('t1');
      expect(flow.state.errorCode).assertNull();
      expect(gateway.callLog).assertDeepEquals(['validateRequest', 'allocateResource', 'verifyOtpCode']);
      expect(ledger.callLog).assertDeepEquals(['save', 'update']);
      expect(ledger.currentTasks[0].status).assertEqual('Active');
    });

    it('[BRANCH-validate_fail][AC-2] 校验失败：不触发后续网关/本地写入', 0, async () => {
      gateway.whenValidateRequest.returns({ ok: false, code: 'VAL_ERR' });

      await flow.submitTask({ sku: 'SKU1', actorId: 'u1' });

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('VAL_ERR');
      expect(gateway.callLog).assertDeepEquals(['validateRequest']);
      expect(ledger.callLog).assertDeepEquals([]);
    });

    it('[BRANCH-apply_fail][AC-7] 配额申请失败：不写本地', 0, async () => {
      gateway.whenValidateRequest.returns({ ok: true, token: 't' });
      gateway.whenAllocateResource.throws(new Error('timeout'));

      await flow.submitTask({ sku: 'SKU1', actorId: 'u1' });

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('APPLY_ERR');
      expect(gateway.callLog).assertDeepEquals(['validateRequest', 'allocateResource']);
      expect(ledger.callLog).assertDeepEquals([]);
    });

    it('[BRANCH-persist_fail][AC-4] 本地持久化失败', 0, async () => {
      gateway.whenValidateRequest.returns({ ok: true, token: 't' });
      gateway.whenAllocateResource.returns({ taskId: 't1', owner: 'u1' });
      ledger.whenSave.throws(new Error('disk-full'));

      await flow.submitTask({ sku: 'SKU1', actorId: 'u1' });

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('PERSIST_ERR');
      expect(gateway.callLog).assertDeepEquals(['validateRequest', 'allocateResource']);
      expect(ledger.callLog).assertDeepEquals(['save']);
      expect(ledger.currentTasks.length).assertEqual(0);
    });

    it('[BRANCH-otp_fail_rollback][AC-3] 二次校验失败：已写入任务被回滚', 0, async () => {
      gateway.whenValidateRequest.returns({ ok: true, token: 't' });
      gateway.whenAllocateResource.returns({ taskId: 't1', owner: 'u1' });
      gateway.whenVerifyOtpCode.returns({ ok: false, code: 'OTP_ERR' });

      await flow.submitTask({ sku: 'SKU1', actorId: 'u1' });
      await flow.confirmOtp('000000');

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('OTP_ERR');
      expect(gateway.callLog).assertDeepEquals(['validateRequest', 'allocateResource', 'verifyOtpCode']);
      expect(ledger.callLog).assertDeepEquals(['save', 'rollback']);
      expect(ledger.currentTasks.length).assertEqual(0);
    });

    it('[BRANCH-user_cancel_in_waiting_otp][AC-6] 等待校验阶段取消：回滚已写入记录', 0, async () => {
      gateway.whenValidateRequest.returns({ ok: true, token: 't' });
      gateway.whenAllocateResource.returns({ taskId: 't1', owner: 'u1' });

      await flow.submitTask({ sku: 'SKU1', actorId: 'u1' });
      expect(flow.state.phase).assertEqual(Phase.WaitingOtp);

      await flow.cancel();

      expect(flow.state.phase).assertEqual(Phase.Failed);
      expect(flow.state.errorCode).assertEqual('USER_CANCELLED');
      expect(gateway.callLog).assertDeepEquals(['validateRequest', 'allocateResource']);
      expect(ledger.callLog).assertDeepEquals(['save', 'rollback']);
      expect(ledger.currentTasks.length).assertEqual(0);
    });
  });
}
