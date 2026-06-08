# active_workflow 与实例扩展路径（framework-init 选型备忘）

本文供初始化 Skill 在 S2 与用户对齐配置时引用；**非强制单独执行**的阅读材料。

## `active_workflow`

- **`spec-driven`**（默认）：使用 [framework/workflows/spec-driven.workflow.yaml](../../../../workflows/spec-driven.workflow.yaml)，包含全局元阶段 `init` / `catalog` / `glossary` / `docs` / **`extensions`** 与 feature 链上各阶段。
- **自定义**：在 `framework/workflows/` 新增 `<id>.workflow.yaml`（协议见 [framework/specs/workflow-schema.json](../../../../specs/workflow-schema.json)），将实例根 `framework.config.json` 的 `active_workflow` 设为 `<id>`。

## 实例扩展目录

- `paths.extension_dir` 默认 **`doc/extensions`**（与 [instance-extension-manifest.schema.yaml](../../../../specs/instance-extension-manifest.schema.yaml) 一致）。
- 目录骨架与 `manifest.yaml` 占位见 framework-init **S3 执行**（扩展目录骨架任务）。

## 与 adapter 的关系

渲染 `AGENTS.md` / `CLAUDE.md` 时，`render-agents-md` 会读取当前 `agent_adapter` 的 `adapter.yaml → instance_skill_bridge`，为 `doc/extensions/skills/*/SKILL.md` 生成 Cursor 跳板与/或 Claude slash；详见 [framework/agents/adapter-schema.yaml](../../../../agents/adapter-schema.yaml)。
