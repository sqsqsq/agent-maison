# Delta: Agent Adapters — 入口分流路由与修正三问

## ADDED Requirements

### Requirement: Entry routing table with conservative default

实例根入口模板 MUST 含 L0/L1/L2 分流路由表：L0 direct（不进管线，但仍须遵守用户显式要求与项目原生 test/lint/build）、L1 lite、L2 full；判档拿不准时 MUST 写死保守缺省"进 lite"。track 建议 MUST 经 `feature.track` 确认 gate（登记 confirmation-registry）后生效。

#### Scenario: 模糊小需求默认进 lite
- **WHEN** 用户请求无法明确判 L0 或 L1
- **THEN** 入口路由指示按 lite 处理并走 feature.track 确认

> **Enforced by:** `templates/AGENTS.md.template`, `skills/reference/confirmation-registry.yaml`

### Requirement: Correction triage questions reside at entry

入口模板 MUST 常驻「修正三问」（≤15 行）：Q1 需求/验收变→spec；Q2 契约/设计变→plan；Q3 都不变→改代码 coding / 纯验证 ut·testing。对进行中 feature 的修正请求 MUST 先分层再动产物；模糊请求先诊断根因再分类。

#### Scenario: NL 修正回合规则在场
- **WHEN** 用户以自然语言对进行中 feature 提出修正（未触发任何 skill）
- **THEN** 会话上下文中已含修正三问与"禁止未分层直接动产物"约束（入口常驻）

> **Enforced by:** `templates/AGENTS.md.template`

### Requirement: change-lite skill is indexed and bridged

`feature/change-lite` skill MUST 登记于 `skills.index.yaml` 并按各 adapter 约定物化跳板；正文 MUST 遵守 C3 主干预算（≤150 行）。

#### Scenario: lite 入口可被 adapter 触发
- **WHEN** 消费者在任一物化 adapter 中请求 lite 流程
- **THEN** resolveSkillPath 能解析 change-lite 且跳板存在

> **Enforced by:** `skills/skills.index.yaml`, `agents/`（bundle 模板）
