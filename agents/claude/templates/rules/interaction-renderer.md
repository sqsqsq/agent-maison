# 用户交互渲染器（Claude Code · BLOCKER）

> 与 [framework/skills/reference/user-confirmation-ux.md](../../framework/skills/reference/user-confirmation-ux.md) 配套；**Claude adapter 会话级 BLOCKER**。
> 选项文案 SSOT：[confirmation-registry.yaml](../../framework/skills/reference/confirmation-registry.yaml)。

## 全局规则（BLOCKER）

任何需要用户做选择的场合——无论是 registry 已登记的确认点还是 ad-hoc 临时交互——**必须先调 `AskUserQuestion`**，禁止仅展示 Markdown 表或文本编号作为唯一交互。

## 已登记确认点

- 读取 `framework/skills/reference/confirmation-registry.yaml`
- 用 entry 的 `options[].label` **逐字**构造 AskUserQuestion 选项
- `dynamic_label.lookup` 存在时，按当前 phase 替换 label 中的占位符（如 `{next_skill_label}`）
- `requires_preamble` 非空时，须先展示完整正文再调 AskUserQuestion
- 选项含 `side_effect` 时，选择后须执行声明的副作用（写回 artifact、记录用户原话等）
- `matrix_options` 用于 gate=2 后的逐行/逐层子菜单

## 未登记 ad-hoc 交互（fallback · BLOCKER）

临时需要用户选择时，也必须构造 AskUserQuestion，选项至少 2 个有意义的选择；同轮仍附 portable 编号。

## 同轮 portable 编号（向后兼容）

调 AskUserQuestion 的**同轮消息末尾**仍须附 `1=` / `2=` / `3=` … 编号菜单（见 registry `options[].portable` 或 entry `portable_menu`）。

## 决策复述

写入磁盘或进入下一步前须 **决策复述**（user-confirmation-ux §3.6）。

## Registry 覆盖（Skills 0–6 · 33 点）

所有确认点见 [confirmation-registry.yaml](../../framework/skills/reference/confirmation-registry.yaml)；init/setup 系列（`init.materialized_adapters`、`setup.adapter` 等）options 亦在该文件。

## 纪律

- 裸「好 / 继续 / ok」不构成 BLOCKER 确认（init/setup 编排决策须 registry enum）
- spec 术语等 **artifact `[x]`** 仍须写回文件；对话 widget 不能替代
- **不替代** v2.9+ Research Sub-Phase / `context-exploration` harness

## Init / Setup 编排特例（BLOCKER）

项目级 **framework-init** 与个人级 **setup**（内联过程）的编排决策**禁止自由输入**（无 Q1=y、无自定义路径字符串）：

- **S1 探测**：只读运行 `init-orchestrate.ts`（或 planner）产出 `InitTaskPlan` JSON；AI **仅渲染**任务表，不得写盘。
- **S2 计划批准**：`init.task_plan`（gate + 决策模式）+ 项目级 `init.materialized_adapters`（多选 checkbox）；当两 registry 无前后依赖时，推荐**一次** AskUserQuestion 同时发出，但**两 answer 仍须独立记录**；手动模式下漂移任务用 `init.task_decision`（覆盖/保留 enum）。
- **S3 执行**：将用户选择序列化为 **枚举 decision JSON**，交 `init-orchestrate.ts executeInitPlan`；违反 `allowed_actions` 或依赖闭包时 harness 拒绝。
- **S2→S3**：registry 回答即批准记录；决策复述后直接进入 S3，禁止再追加「确认后进入 S3？」等二次 yes/no 确认。
- **S4 摘要**：使用 harness `buildRunSummary(run-log)` 输出，AI 不得自行拼接任务结果表；`/framework-init` 摘要字段以 Skill/CLI 输出为准（含 `run_log` / `summary`）。
- **S4 已闭环**：`buildRunSummary` 汇报完成后 **禁止**再附 portable 编号菜单脚注（含 `init.task_plan` / `init.materialized_adapters` 速查）；`portable_required` 仅适用于 S2 等同轮提问，不适用于 init 收尾摘要。
- **个人 setup**：`setup.adapter` 只能从 `materialized_adapters` 已物化项选；`setup.deveco_path` 仅探测候选或跳过；写入 `framework.local.json` 且**不写**项目产物。

## 与 slash 的关系

- `/framework-init` 走项目级 S1–S4；个人 setup 由各阶段入口 `--json --ensure` 内联（不在 init 里选 active adapter）
- 各 Skill slash 正文含本 Skill registry 确认点 BLOCKER 段；与本 rules 文件 **同优先级**

## BLOCKER 反模式

- widget 可用却仅给 Markdown 表 + 文本编号，未调 AskUserQuestion
- option label 自造路径（含 `.claude/commands/skills/`）或 `(Recommended)` 标签
- 跳过 Research Sub-Phase 直接写 spec 正文大块（Step 2.5 仍 BLOCKER）
- 阶段四件套 PASS 后在同一执行流自动 Read 下一 Skill（须 `phase.next_step` 停等，见 user-confirmation-ux §8）
- framework-init **S4 `buildRunSummary` 后**再附 `init.task_plan` / `init.materialized_adapters` 等 portable 脚注
