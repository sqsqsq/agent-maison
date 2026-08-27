## Why

Attended session driver 与 detached goal-runner 各自推进 phase，导致 owner 之外的生命周期、runtime-owned 前置事实、gate、verdict、backtrack、resume 与 close 语义持续分叉。新增执行模式时复制 loop 会再次漏接安全前置条件，因此 3.0.0 必须收敛为一个事件驱动的 phase runtime。

## What Changes

- 引入唯一 `GoalPhaseRuntime`，统一 owner/epoch/CAS、assess、`phase_start`、runtime-owned facts、receipt scaffold、gate、verdict、backtrack、resume replay、close/closure 与 handoff 生命周期。
- 引入薄 `GoalPhaseExecutor`：attended executor 只封装现有 `phase_execute_request` 回调；detached executor 只封装现有 adapter spawn、timeout 与输出捕获。executor 不直接调用 phase gate或裁决状态。
- 按 detached executor → shared boundary → coding parity → 全 phase → resume/retry → 双向 handoff 的迁移梯接线；parity 全绿后物理删除 goal-runner 私有 phase loop 和 attended 独立推进逻辑。
- 新增生产纯函数 `projectCanonicalLifecycle(events)`，完整投影 run/phase/backtrack/handoff/end 语义并规范化 executor 私有噪声，用于 attended/detached 等价验收。
- 保留既有 run-control/mailbox、events.jsonl、adjudication、testing device provider 边界；Hylyre vendor/build/provider 内部状态不进入 `PhaseExecutionContext` 或 canonical lifecycle。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`: phase 生命周期改由唯一 runtime 推进，detached runner 退化为 executor 与进程壳。
- `goal-mode-skill`: attended driver 退化为同一 runtime 的 host callback executor，fresh/retry/resume/close 语义与 detached 对齐。
- `goal-driver-handoff`: handoff 成为同一 runtime 内 fenced owner 转移，并以规范化 `owner_handoff` 进入 canonical lifecycle。
- `agent-adapters`: adapter 只声明/实现 agent invocation 能力，不拥有 gate 或 phase 生命周期。
- `harness-gates`: gate 只消费 runtime 已冻结的 `PhaseExecutionContext`，不得由 executor 私下调用或补造前置事实。

## Impact

- 影响 `harness/scripts/goal-runner.ts`、`goal-in-session-driver.ts`、`goal-supervisor.ts`、`goal-mode-entry.ts`、run-control/handoff/phase helpers 与目标测试。
- 默认 workflow、full/lite/custom chain 与 gate PASS/FAIL/SKIP 语义不变；不修改 device provider 内部安装/Hylyre 数据模型。
- 这是内部运行时重构，不要求消费者迁移，`MIGRATION.md` 无新增动作。
