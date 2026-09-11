## Why

P1 已交付真实输入承接，现有运行链仍按 full/lite 推进。P2 将请求终点、义务和有效事实统一到冻结范围，使执行、恢复、建议与完成使用同一依据。

## What Changes

- workflow 1.2 静态义务 provider 与纯 ExecutionScope 计算。
- 既有 manifest/run_created 冻结范围，Feature 声明只作出生候选。
- assess、完成验证及成功切片后继交接消费同一范围。
- 复用 owner、锁、预算、successor 和现有报告，不新增运行状态目录。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `runtime-policy`: 义务与执行范围的唯一解析。
- `workflow-tracks`: workflow 1.2 与旧协议隔离。
- `goal-runner`: 范围冻结、完成与后继交接。
- `reconcile-assessment`: 按冻结范围观察并推荐。

## Impact

影响全部 Feature 的共享运行层；项目职责语义由 P6 接线。默认 spec-driven 不切换，旧协议保持历史语义；公开切换和 MIGRATION.md 由 P7 负责。新增协议的 schema、reader 与机械验收同批交付。
