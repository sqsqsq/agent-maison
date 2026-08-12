# Delta: Harness Gates — 结构化 preflight 出口与双出口话术

## ADDED Requirements

### Requirement: Machine-readable personal-setup preflight exit

harness-runner 的 personal-setup 前置校验失败时 MUST 在退出前输出并持久化机读 HARNESS_PREFLIGHT 结果（含 code/capability/prerequisite/双出口指引），退出码非零语义不变；机器行为恒 MUST 为"输出结构化缺口 + 非零退出"——MUST NOT 读 stdin、MUST NOT 生成任何确认 receipt、MUST NOT 放行或绕过 phase。

#### Scenario: goal 侧可分类
- **WHEN** goal 链（或交互态）遭遇 deveco_toolchain_missing 类前置缺口
- **THEN** 存在机读 HARNESS_PREFLIGHT 产物供 goal-runner 分类为 await_human_capability_gap，而非裸 console.error

#### Scenario: 交互态双出口
- **WHEN** 交互态 agent 收到该 preflight 失败
- **THEN** 文案含双出口（引导安装默认 | 用户确认后诚实停止并 resume 恢复），且注明用户确认仅为知情记录、不构成任何授权

> **Enforced by:** `harness/harness-runner.ts`, `harness/scripts/utils/personal-setup-gate.ts`
