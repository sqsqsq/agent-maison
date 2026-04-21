# 架构 DSL 预设策略

在写入 `framework.config.json` 的 `architecture` 段前，AI 按以下顺序向用户提供选项。

## 选项 A：参考实例 — 五层外层 + 子层（钱包回归同款）

- **何时用**：扫描到 `01-Product`～`05-SystemBase` 式目录，或用户明确要「与 harness LEGACY 默认一致」。
- **怎样做**：将 [templates/preset-wallet-5-layer.sample.json](../templates/preset-wallet-5-layer.sample.json) 合并进完整 config（补全 `project_name`、`paths`、`agent_adapter` 等）。
- **说明**：`05-SystemBase` 使用 `intra_layer_deps: sublayer` + `CommUI` / `CommFunc` 子层仅为**示例**；若用户工程不同，必须在问卷里改 `members_pattern_or_list`。

## 选项 B：极简三外层（小型 App）

- **何时用**：新工程、目录简单、希望少层级。
- **怎样做**：使用 [templates/preset-minimal-3-layer.sample.json](../templates/preset-minimal-3-layer.sample.json)。
- **说明**：外层 id 为示例名 `AppShell` / `Feature` / `Foundation`，可按项目重命名；**重命名后同步修正** `can_depend_on` 与整图 DAG。

## 选项 C：完全自定义

- **何时用**：选项 A/B 均不符合。
- **怎样做**：严格按 [templates/custom-architecture-questionnaire.md](../templates/custom-architecture-questionnaire.md) 收集字段，再手工拼装 JSON。

## 通用约束（复述）

- `validateArchitectureDsl`（见 `framework/harness/config.ts`）必须通过。
- `inner_dependency_direction` 当前仅支持 `"upward"`。
- `module_inner_layers` 数组顺序即依赖方向（索引大者可依赖索引小者）。
