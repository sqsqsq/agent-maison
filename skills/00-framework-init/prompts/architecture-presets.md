# 架构 DSL 预设策略

在写入 `framework.config.json` 的 `architecture` 段前，AI 按以下顺序向用户提供选项。

## 选项 A：参考实例 — 五层外层 + 子层（钱包回归同款）

- **何时用**：扫描到 `01-Product`～`05-SystemBase` 式目录，或用户明确要「与 harness LEGACY 默认一致」。
- **怎样做**：将 [templates/preset-wallet-5-layer.sample.json](../templates/preset-wallet-5-layer.sample.json) 合并进完整 config（补全 `project_name`、`paths`、`agent_adapter` 等）。
- **同层策略前置确认（BLOCKER，详见 `SKILL.md` Step 3.x）**：preset 里 `01-Product / 02-Feature / 04-BusinessBase = forbid`、`03-CommonBusiness = dag`、`05-SystemBase = sublayer` 是**有意的默认**（上三层用 `forbid` 逼横向协作下沉，仅 `03-CommonBusiness` 允许同层 DAG），**不是**「同层一律禁止」这种唯一答案。合并 preset 前**必须**按 [templates/intra-layer-deps-confirm.template.md](../templates/intra-layer-deps-confirm.template.md) 展示逐层策略表，逐行获得用户显式回复，才能落盘。
- **说明**：`05-SystemBase` 使用 `intra_layer_deps: sublayer` + `CommUI` / `CommFunc` 子层仅为**示例**；若用户工程不同，必须在问卷里改 `members_pattern_or_list`。

## 选项 B：极简三外层（小型 App）

- **何时用**：新工程、目录简单、希望少层级。
- **怎样做**：使用 [templates/preset-minimal-3-layer.sample.json](../templates/preset-minimal-3-layer.sample.json)。
- **同层策略前置确认（BLOCKER，详见 `SKILL.md` Step 3.x）**：preset 里每一层的 `intra_layer_deps` 默认值同样须按 [templates/intra-layer-deps-confirm.template.md](../templates/intra-layer-deps-confirm.template.md) 向用户逐层确认；不得直接合并。
- **说明**：外层 id 为示例名 `AppShell` / `Feature` / `Foundation`，可按项目重命名；**重命名后同步修正** `can_depend_on` 与整图 DAG。

## 选项 C：完全自定义

- **何时用**：选项 A/B 均不符合。
- **怎样做**：严格按 [templates/custom-architecture-questionnaire.md](../templates/custom-architecture-questionnaire.md) 收集字段，再手工拼装 JSON。
- **同层策略（BLOCKER）**：问卷中的 `intra_layer_deps` 字段**必须**来自用户显式回答，不得由 AI 代入默认值；即便用户整体说「参考 preset」，也要逐层确认过每一行再写入。

## 通用约束（复述）

- `validateArchitectureDsl`（见 `framework/harness/config.ts`）必须通过。
- `inner_dependency_direction` 当前仅支持 `"upward"`。
- `module_inner_layers` 数组顺序即依赖方向（索引大者可依赖索引小者）。
- **`outer_layers[*].intra_layer_deps` 每一项都必须能在对话里找到用户的显式回复**（「按默认」或具体值均可，但不能缺）。
