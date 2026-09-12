## Why

P4 将 coding/review 接到已交付的 P1–P3 输入与范围，以及 P6 专项 CLI。已有合法施工契约不能因缺少叙述计划而阻塞，独立审查也不能要求本次先 coding。

## What Changes

- 按真实职责组合 coding/review 输入，保留契约、写集、编译与基线检查。
- checker、Skill 与 verifier 消费解析后的设计和验收，蓝图来源不降级。
- 专项 review 使用已交付 request 上下文；Feature 保留原 attestation、回退与完成边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-contracts`: coding/review 输入与专业消费职责。
- `workflow-tracks`: 审查对象与真实控制前提、独立完成边界。

## Impact

涉及 coding/review contracts、Skills、phase rules、checker、相关 verifier 与已有写集/基线消费方。不修改 P2 义务算法或 P3 投影 writer，不提前实施 P5/P7。默认 workflow 迁移及 MIGRATION.md 汇总仍归 P7；本批不发布。
