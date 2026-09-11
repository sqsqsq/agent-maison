## Why

P1 承接动态工作流总纲 g1：现有 capability 只证明文件存在，checker 再读物理文件，facts 又固定由 spec/change 建立，无法承接合法独立调用。

## What Changes

- 增加 contract 1.1 的义务绑定和明确基础/增强输入归属，保留 1.0 reader。
- 解析实际内容和来源绑定，向 SpecLoader/CheckContext 与 evidence 提供同一次结果。
- facts 1.1 支持真实首阶段和 request subject，保留旧事实来源与增量语义。
- 静态门检查每个来源与返回内容类型，区分 producer 存在和本次执行祖先。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `skill-contracts`: 1.1 输入、内容绑定、同源消费者和静态来源校验。
- `harness-gates`: 以实际 subject 与调用资格建立/承接 facts。

## Impact

覆盖全部 Feature 共享输入入口、facts/checker/证据路径及文档。无新依赖、状态目录或动态 provider。
保持当前默认 contracts/旧 run 行为；P2/P6 注入范围与专项请求，P3 实现蓝图投影，P4/P5 完成各自 phase 门，P7 公开切换及 MIGRATION.md。P1 不提前更改消费者默认路径。
