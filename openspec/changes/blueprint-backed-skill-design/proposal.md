## Why

P1/P2 已接通输入和冻结范围，但 spec/plan 仍绑定整套叙述文档，无法直接消费获准蓝图/CU 的精确验收与施工设计。P3 复用现有寻址、类型和检查链，区分确定性投影与尚需责任方裁决的缺口。

## What Changes

- 注册蓝图验收、施工契约派生输入，绑定 canonical CU 和蓝图来源。
- 复用验收语义、施工写集、CU sidecar、runtime 与用例检查；唯一物化入口先验证再写，不覆盖人工决策。
- spec/plan contract、Skill、checker 和 verifier 按本次输入与输出职责执行。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-contracts`: 有内容、有来源的蓝图派生输入与设计阶段消费。
- `app-component-blueprint`: 验收与施工内容投影、缺口归属及 CU 机器映射。

## Impact

影响 spec/plan 与 component-design 的输入、检查、提示和机械验收；不实现 P4–P7 业务接线，不切默认 workflow。无新增运行状态或外部依赖；MIGRATION.md 与公开切换仍由 P7 统一处理。
