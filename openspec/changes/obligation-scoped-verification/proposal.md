## Why

实施已定稿 P5：UT/testing 仍有固定历史文档与 Feature 路径依赖，性能项尚未表达验证层级，专项原生 provider 尚未接收真实 request。按现有 P1/P2/P3 输入与范围执行，才能避免纯单元任务额外启动 testing。

## What Changes

- 复用 acceptance 分层，为 performance 增加可选 ut_layer 和证明焦点，保留旧缺层级为 unknown。
- UT/testing contract 与 checker 消费绑定输入和冻结范围；零设备义务对账不要求 trace 或生成报告。
- 既有原生 UT/即席设备执行器接收 request 目标和独立报告目录，保留真实执行、R8、失败与证据边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-contracts`: UT/testing 独立与组合输入、原生 provider 接线。
- `workflow-tracks`: unit/device/性能义务与零设备对账边界。

## Impact

涉及测试 Skill/contract/checker、acceptance 类型与 schema、分层/引用解析和既有 hmos provider。P7 负责默认切换、MIGRATION.md 汇总及真实宿主验收；本批不发版、不新增状态或设备权限机制。
