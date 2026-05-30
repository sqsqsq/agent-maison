# 架构 DSL 预设策略

在写入 `framework.config.json` 的 `architecture` 段前，通过 registry **`init.architecture_preset`** + **`init.intra_layer_deps`** 确认；**禁止**对话问卷收集 DSL 字段。

## 选项 A：参考实例 — 5 外层 + 子层（`preset_5_layer`）

- **何时用**：扫描到 `01-Product`～`05-SystemBase` 式目录，或用户明确要「与 harness LEGACY 默认一致」。
- **怎样做**：S2 选 `init.architecture_preset=preset_5_layer`；将 `` `profile-skill-asset:00-framework-init/preset_5_layer_sample` `` 解析得到的 `architecture` 合并进 `configWritePayload`（并补全 `project_name`、`paths` 等模板字段）。
- **同层策略（BLOCKER）**：合并前须 `init.intra_layer_deps` gate；gate=1 等价每层「按默认」。见 [intra-layer-deps-confirm.template.md](../templates/intra-layer-deps-confirm.template.md)。
- **说明**：`05-SystemBase` 的 sublayer 示例若与工程不符 → **STOP**，改走选项 D 手动编辑 JSON，**不得**在对话改 `members_pattern_or_list`。

## 选项 B：极简三外层（`preset_minimal_3`）

- **何时用**：新工程、目录简单、希望少层级。
- **怎样做**：S2 选 `init.architecture_preset=preset_minimal_3`；使用 [preset-minimal-3-layer.sample.json](../templates/preset-minimal-3-layer.sample.json) 的 `architecture` 段。
- **同层策略（BLOCKER）**：须 `init.intra_layer_deps` 逐层确认（registry matrix），不得静默代入。
- **说明**：外层 id 为示例名；若需重命名 → 选项 D 手动编辑 `can_depend_on` 与整图 DAG。

## 选项 C：沿用磁盘已有 architecture（`keep_existing` · UPDATE）

- **何时用**：`framework.config.json` 已存在且 `architecture` 可解析；或 S1 recovered 快照。
- **怎样做**：S2 选 `keep_existing`；仅经 `init.intra_layer_deps` 确认是否调整同层策略；**不**在对话改外层结构。

## 选项 D：手动编辑后重跑（`manual_edit_stop`）

- **何时用**：A/B/C 均不适用，或需 sublayer / 外层结构超出 preset。
- **怎样做**：**STOP** 本轮 S3 config 写入；指引 [architecture-manual-edit 指引](../templates/custom-architecture-questionnaire.md)（手工改 `framework.config.json`）；`validateArchitectureDsl` 通过后重跑 UPDATE init。

## 通用约束

- `validateArchitectureDsl`（`framework/harness/config.ts`）必须通过。
- `inner_dependency_direction` 当前仅支持 `"upward"`。
- `outer_layers[*].intra_layer_deps` 须来自 `init.intra_layer_deps` gate/matrix 的显式选择（`按默认` / `dag` / `forbid` / `sublayer`）；选 `sublayer` 时 **preset 须已含完整 `sublayers[]`**，否则走选项 D。
