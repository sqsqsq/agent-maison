# active_workflow 与实例扩展路径（framework-init 选型备忘）

本文供初始化 Skill 在 S2 与用户对齐配置时引用；**非强制单独执行**的阅读材料。

## `active_workflow`

- **`spec-driven`**（默认）：使用 [framework/workflows/spec-driven.workflow.yaml](../../../../workflows/spec-driven.workflow.yaml)，包含全局元阶段 `init` / `catalog` / `glossary` / `docs` / **`extensions`** 与 feature 链上各阶段。
- **自定义**：在 `framework/workflows/` 新增 `<id>.workflow.yaml`（协议见 [framework/specs/workflow-schema.json](../../../../specs/workflow-schema.json)），将实例根 `framework.config.json` 的 `active_workflow` 设为 `<id>`。

## 实例扩展目录

- `paths.extension_dir` 默认 **`doc/extensions`**（与 [instance-extension-manifest.schema.yaml](../../../../specs/instance-extension-manifest.schema.yaml) 一致）。
- 目录骨架与 `manifest.yaml` 由 [`/extension init`](../../extension/SKILL.md) 补缺；此职责不属于 framework-init。

## 与 adapter 的关系

实例扩展桥接由 [`/extension`](../../extension/SKILL.md) 管理；`/extension materialize` 只读项目级 `materialized_adapters[]`，为 manifest 声明的扩展 Skill 全量刷新 adapter 入口。
