## Why

现行 `goal-runner` 的终态完成契约已允许按终态完成事实判定调用完成，但超时棘轮要求仍把样本限定为 `exit_code === 0 && timed_out !== true`。完成后清理返回非零会因此漏计，waiting/exit0 则会被误计。本变更只收敛该冲突。

## What Changes

- 棘轮完成样本复用既有终态完成契约的共享判据，保留失败优先、waiting/跳过和旧事件兼容。
- 保留原始退出码、阶段样本归属、倍率、高水位、显式上限及剩余墙钟钳制。
- 以完成后非零清理、waiting/exit0、真实失败及 resume 回放验证该定义。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`: 仅「Timeout budget ratchets on granted high-water and observed completions」及其直接场景。

## Impact

实施真源为 `.cursor/plans/调用完成事实同源与链外进度补修_a7b615ff.plan.md`。执行位置为 `harness/scripts/utils/invocation-completion.ts` 与 `goal-timeout.ts`；不重写已有终态完成 Requirement，不为四个代码消费点分别新增规范。MIGRATION 说明自动兼容，无需消费者手改历史记录、重跑完成任务或调整配置。本次不打包、不改宿主或手机。
