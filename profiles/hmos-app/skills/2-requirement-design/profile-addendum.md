# `hmos-app` · Skill `2-requirement-design` profile addendum

宿主默认技术栈：**ArkTS / ArkUI、模块分层 outer_layers + shared→presentation、跨模块导出入口文件名由 DSL `cross_module_exports_file` 定义**。

## hmos-app 设计约定

- 常见模块格式为 `HAP` / `HAR`，模块配置通常涉及 `build-profile.json5`、`oh-package.json5`、`module.json5`。
- 实现文件通常为 `.ets`，数据模型与接口签名必须使用 ArkTS 合法类型。
- 模块内部常见目录为 `shared/`、`data/`、`domain/`、`presentation/`，跨模块导出入口文件名以 `framework.config.json > architecture.cross_module_exports_file` 为准。
- UI 设计可使用 ArkUI 组件术语（如 `Column`、`Row`、`List`、`Tabs`、`Navigation`），但 design 的 scope、contracts 与 architecture 仍以实例 SSOT 为准。

## 权威 overlay

| 用途 | 路径 |
|------|------|
| design 规则 overlay | `framework/profiles/hmos-app/phase-rules-overlays/design-rules.overlay.yaml`（由 harness 与中立 `design-rules.yaml` 合并消费） |
| design Skill 模板/提示 | `framework/skills/2-requirement-design/`；鸿蒙专用参考已逐步迁入本 profile / `skills/3-coding` 跳板 |

设计中 **architecture_impact、dsl_change、contracts.yaml** 的写法须同时满足：`doc/architecture.md`、中立阶段规则与被合并 overlay 条目。
