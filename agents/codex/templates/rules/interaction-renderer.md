# 用户交互渲染器（Codex · portable only）

> 与 [framework/skills/reference/user-confirmation-ux.md](../../framework/skills/reference/user-confirmation-ux.md) 配套。
> 选项文案 SSOT：[confirmation-registry.yaml](../../framework/skills/reference/confirmation-registry.yaml)。
> **本 adapter 不支持结构化 widget**；仅使用 portable 编号菜单。

## 全局规则

任何需要用户做选择的场合，须展示 **编号菜单**（`1=` / `2=` / `3=` …），禁止仅要求用户自由打字作为唯一交互。

## 已登记确认点

- 读取 `framework/skills/reference/confirmation-registry.yaml`
- 用 entry 的 `options[].portable` 或 `portable_menu` 构造编号菜单
- `requires_preamble` 非空时，须先展示完整正文再呈现菜单
- 选项含 `side_effect` 时，选择后须执行声明的副作用

## 未登记 ad-hoc 交互（fallback）

临时交互也须构造至少 2 个编号选项。

## Init / Setup 编排特例

项目 init / 个人 setup **禁止自由输入**（无 Q1=y、无自定义路径字符串）：

- S1 只读 planner → 渲染任务计划 JSON
- S2 用 registry：`init.task_plan`、`init.materialized_adapters`、`init.task_decision`（手动）
- S2 registry 回答即批准记录；决策复述后直接进入 S3，禁止再追加「确认后进入 S3？」等二次 yes/no 确认
- S3 枚举 decision JSON 交 `executeInitPlan`
- S4 用 harness `buildRunSummary`；`/framework-init` 摘要字段以 Skill/CLI 输出为准（含 `run_log` / `summary`）
- **S4 已闭环**：`buildRunSummary` 汇报完成后 **禁止**再附 portable 编号菜单（含 `init.task_plan` / `init.materialized_adapters` 速查）
- setup 用 `setup.adapter` / `setup.deveco_path`，只写 `framework.local.json`

## 决策复述

写入或进入下一步前须结构化复述决策（user-confirmation-ux §3.6）。

## 反模式

- 仅展示 Markdown 大表让用户逐行打字，无 gate/enum
- 口头 OK 但未写回 artifact（spec `[x]`、gap-notes）
- framework-init S4 `buildRunSummary` 后再附 `init.task_plan` / `init.materialized_adapters` portable 速查
