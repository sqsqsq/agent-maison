---
description: 项目级 Framework 接入/升级（config、架构、多 adapter 物化）
argument-hint: <optional-notes>
---

# /framework-init — Framework 项目级初始化

**用户输入（自由文本）**：$ARGUMENTS

> **BLOCKER — 用户交互**：编排决策须先调 **AskUserQuestion**（registry `init.task_plan` / `init.materialized_adapters` / `init.task_decision`）；**禁止** Q1=y 自由文本。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — 职责分离**：项目 init 写 `framework.config.json` 与 **materialized_adapters** 物化产物；**个人** active adapter 与 DevEco 由阶段入口 `check-personal-setup.ts --json --ensure` 内联写入 `framework.local.json`（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

## 执行流（4 大步，无小数子步）

| 步 | 动作 |
|----|------|
| **S1 探测** | `cd framework/harness && npx ts-node scripts/init-orchestrate.ts --scope project --project-root <repo-root>` → 只读 `InitTaskPlan` JSON |
| **S2 计划批准** | 渲染任务表 + `init.task_plan`（智能/手动）+ `init.materialized_adapters` 多选 |
| **S3 执行** | 枚举 decision JSON → `executeInitPlan` |
| **S4 摘要** | `buildRunSummary(run-log)` → 用户确认 |

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/00-framework-init/SKILL.md](../../framework/skills/00-framework-init/SKILL.md)**
