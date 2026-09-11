## Why

动态工作流总纲（91c4e7a2）及七份分解计划已定稿，但现行行为规范仍把 track、固定阶段和上游文件等同于本次义务。g1 先消除规范冲突，为 P1–P7 提供一致的实施边界，不宣称运行能力已交付。

## What Changes

- 将阶段预设与实际执行范围分开，保留旧出生协议的窄兼容。
- 区分信息、格式与真实控制依赖，允许有效内容承接，保留来源、授权与必要机器契约。
- 对齐父 goal §8/§9 的适用义务、施工投影和分层完成表述，保留正式需求蓝图准入。
- 对齐运行范围、assess 与完成的权威关系；具体协议与消费者接线由各子 plan 的 change 维护。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `complex-capability-meta-model`: 正式入口、施工投影、独立调用及分层完成边界。
- `workflow-tracks`: 固定 track 限定于旧协议，新请求按义务组合。
- `skill-contracts`: 输入承接与 producer/control 依赖分离。
- `runtime-policy`: 同源执行范围、证据策略与兼容边界。
- `reconcile-assessment`: 按有效范围派生缺口与建议，不重建固定链。
- `change-unit-continuous-progression`: 完整施工映射与独立验证的 CU expected completion。

## Impact

本 change 只修改开发仓 OpenSpec 行为说明、父 goal 与总纲 todo；不改发布件、生产代码、schema 或 adapter。
涉及全部 Feature 阶段与项目级 Skill 的共同语义。**BREAKING（后续 P7 切换）**：新请求不再以 lite/full 固定链决定义务；旧 run 依出生协议恢复。
`MIGRATION.md`、用户入口、profile/adapter 和真实宿主迁移由 P1–P7 各自接线，P7 统一公开切换，本次不提前修改。
