# Delta: Eval Protocol — 受控 A/B 收益验证

## ADDED Requirements

### Requirement: Trace usage section with confidence

trace.schema MUST 支持可选 `usage` 段（input/output/tool tokens、requests、cost_estimate、capture_method、confidence）；`capture_method: none` 或采集失败时 confidence MUST 为 `proxy`，此时 token 字段 MAY 为 null/缺省，代理指标 MUST 复用 trace 顶层 `tool_calls` 与 `started_at`/`ended_at` 推导（不另设 proxy 字段）；任何报告 MUST NOT 基于 proxy 数据声称 token 结论。

#### Scenario: 采不到 usage 的降级表述
- **WHEN** 某臂 adapter usage_capture=none
- **THEN** trace 记 proxy 指标（wall-time/tool_calls），报告对应格标注"代理口径"

> **Enforced by:** `harness/trace/trace.schema.json`, A/B 报告模板

### Requirement: Model identity is machine-captured

A/B 对照 MUST 机器固化每臂 resolved provider/model（来自调用配置/响应元数据），MUST NOT 采信 agent 文本自报；拿不到 usage 或 model 身份时 MUST NOT 声称"同模型 token 对照"。

#### Scenario: 身份缺失时的报告
- **WHEN** 某臂无法固化 model identity
- **THEN** 该样本对照降级为代理指标表述，不进入 token 结论

> **Enforced by:** `harness/scripts/utils/agent-invoke.ts`, `harness/scripts/goal-runner.ts`

### Requirement: Controlled independent arms

A/B 各臂 MUST 独立冷启动运行（headless goal-runner），臂间 MUST NOT 共享缓存/工作区状态，MUST NOT 以全量顺序跑的逐项计时替代受控对照；样本集 MUST 覆盖 4 类（简单 bugfix / 单模块 feature / 跨文件中等 / 进行中 feature NL 修正，第 4 类对照臂为 old flow vs C5 flow）；某类样本确不可复现时报告 MUST 显式标注缺失，且 gate 结论 MUST NOT 声称覆盖该类收益（修正路由类缺失时不得下修正路由结论）。

#### Scenario: 顺序跑计时被拒
- **WHEN** 有人提议在同一会话顺序跑两臂并比较耗时
- **THEN** 协议判定无效（缓存/warm 假象），要求独立冷启动重跑

#### Scenario: 修正类样本缺失的报告
- **WHEN** 第 4 类样本无法复现而缺失
- **THEN** 报告标注缺失，gate 结论不含修正路由收益判断

> **Enforced by:** A/B 跑批脚本, 报告模板口径声明

### Requirement: Gate report is directional

A/B 报告 MUST 定位为 Phase 0 gate 的方向性信号（继续/收窄），MUST 显式声明 n≤4 样本不承担"最终阈值证明"；C2 verifier 保留集与 C3 主干预算的最终值 MUST 由用户在 gate 处拍板。

#### Scenario: 报告不越权定阈值
- **WHEN** A/B 报告产出
- **THEN** 结论区只给"继续/收窄"建议与数据，阈值决定权标注归用户

> **Enforced by:** A/B 报告模板, plan d4a7c1e8 Phase 0 gate 流程
