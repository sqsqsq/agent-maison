// ============================================================================
// invalidation-tx.ts — 失效事务 + 其事件投影的**唯一实现**
// ----------------------------------------------------------------------------
// 顺序不变量（pass-snapshot.ts:1327-1331 定下，**这里是它的唯一执行点**）：
//
//     journal pending → heads → **phase_invalidated 事件** → commit
//
// commit **必须最后**。完成态 = journal 文件不存在（commitInvalidationTx 原子移除它），
// 所以「commit 后、事件补齐前」的二次崩溃**永久不可修复**：下次 resume 看不到待恢复
// 事务，phase_invalidated 事件也不在，于是把已被 supersede 的阶段当作仍然完成
// （applyInvalidationsToResume 据事件重算 resume 起点，会算错）。
//
// 抽出来的原因很实在：这条规则此前散在三个调用点手写，**其中一处写反了**
// （缺陷回退：先 commit 再落事件）。散着写就必然会有第四处写反，而且内联在 runner
// 的 phase 循环里根本没有缝可测——只能靠扫源码断言顺序，那是假绿。
// 现在顺序只有一份实现、一条注入 commit 的用例钉住。
//
// 本模块**只管失效事务本身**。各调用点自己的 `phase_backtrack_requested`
// （携带 receipts / round_fingerprint / defects 等各不相同的载荷）在本函数返回后再发——
// 它不参与 journal 恢复，不受本顺序约束。
// ============================================================================

import { beginInvalidationTx, commitInvalidationTx } from './pass-snapshot';

export interface InvalidationTxInput {
  projectRoot: string;
  feature: string;
  runId: string;
  causePhase: string;
  invalidatedPhases: readonly string[];
  txId: string;
  /** `phase_invalidated` 事件的 reason（各调用点语义不同） */
  reason: string;
  /** 附加到每条 `phase_invalidated` 的字段（如授权回退的 `files`） */
  extraEventFields?: Record<string, unknown>;
  dryRun: boolean;
  /** 合法 supersede 必须一并清同进程内存锚，否则下一轮 loader 拿旧锚判"盘上被换代" */
  passSnapshotMemory: { delete(key: string): boolean };
  emit: (event: Record<string, unknown>) => void;
  /** 测试注入；缺省走真实事务 */
  begin?: typeof beginInvalidationTx;
  commit?: typeof commitInvalidationTx;
}

export function runInvalidationTx(input: InvalidationTxInput): void {
  const phases = input.invalidatedPhases.map(String);
  if (!input.dryRun) {
    (input.begin ?? beginInvalidationTx)({
      projectRoot: input.projectRoot,
      feature: input.feature,
      runId: input.runId,
      causePhase: input.causePhase,
      invalidatedPhases: phases,
      txId: input.txId,
    });
    for (const p of phases) input.passSnapshotMemory.delete(p);
  }
  for (const p of phases) {
    input.emit({
      // 附加字段**先**展开：事务身份字段（type/phase/cause_phase/reason/tx_id）必须
      // 由本函数最终写定，调用方不得覆盖——否则"唯一实现"守住的不变量从入参就被绕开了。
      ...(input.extraEventFields ?? {}),
      type: 'phase_invalidated',
      phase: p,
      cause_phase: input.causePhase,
      reason: input.reason,
      invalidation_tx_id: input.txId,
    });
  }
  // commit **最后**——见文件头
  if (!input.dryRun) {
    (input.commit ?? commitInvalidationTx)(
      input.projectRoot, input.feature, input.runId, input.txId,
    );
  }
}
