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
| **S0 Tier_1** | `cd framework/harness && node scripts/init-readiness.mjs`；`ok=false` 时先 `npm install`（timeout ≥5m，超时后重跑 readiness）；**禁止** npm install 后在同一 shell 再次 `cd framework/harness` |
| **S1 探测** | readiness `ok=true` 后：`npx ts-node scripts/init-orchestrate.ts --scope project --project-root <repo-root>` → 只读 `InitTaskPlan` JSON |
| **S2 计划批准** | 渲染任务表 + `init.task_plan`（智能/手动）+ `init.materialized_adapters` 多选；registry 答案即批准记录，不再二次询问“确认后进入 S3？”；仅 CREATE / 手动 / 需 doc payload 时预览 `--emit-staging-template --materialized-adapters <list>` |
| **S3 执行** | 智能 UPDATE：显式使用 `--smart-auto --materialized-adapters <list>`（不创建外部 staging；CLI 隐式改道仅作兼容容错）；通用：`--execute --decision-file ... --context-file ...` |
| **S4 摘要** | S3 stdout 即 `buildRunSummary` 摘要（含 `run_log` / `summary`）；通用 staging 路径须清理 OS 临时目录并汇报结果；仅列可选下一步 |

> **话术约束**：UPDATE 保留磁盘既有 `architecture` / `intra_layer_deps` 时，复述为“沿用已有 architecture DSL”；不要称为 profile 默认 preset，除非 S2 明确选择了某个 preset。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/00-framework-init/SKILL.md](../../framework/skills/00-framework-init/SKILL.md)**
