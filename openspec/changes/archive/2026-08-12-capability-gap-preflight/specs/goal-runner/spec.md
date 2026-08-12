# Delta: Goal Runner — invoke 前能力缺口 preflight

## ADDED Requirements

### Requirement: Preflight before agent_invoke_start

goal-runner MUST 在每 phase 每 attempt 的 agent_invoke_start 事件之前执行共享工具链 preflight（初跑与 --resume 均重检）；探测到显式前置能力缺口（deveco_toolchain_missing / deveco_toolchain_capability_failed 类 prerequisite code）时 MUST NOT 产生 agent_invoke_start，MUST 直接写 run_end=HALTED 与 halt_reason=await_human_capability_gap 并以非零退出。该 halt MUST NOT 计入 CUMULATIVE_HALT_FAMILY（agent 未开跑，无累计语义）。

#### Scenario: 缺口不烧 agent 轮次
- **WHEN** phase 前置能力缺口存在且 goal-runner 启动该 phase attempt
- **THEN** events.jsonl 无本 attempt 的 agent_invoke_start；run_end=HALTED，halt_reason=await_human_capability_gap

#### Scenario: resume 重检
- **WHEN** 用户修好环境后 --resume
- **THEN** preflight 重检通过，attempt 正常产生 agent_invoke_start；仍缺口则再次首触 halt

#### Scenario: 运行后失败不入本通道
- **WHEN** ut/testing 运行后产生 ohos_test_sign_gap 等 failure_kind
- **THEN** 走既有 toolchain 失败分类语义，不触发 await_human_capability_gap

> **Enforced by:** `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`
