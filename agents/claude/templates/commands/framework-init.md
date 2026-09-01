---
description: 显式选择或调用 framework-init、首次接入 Maison 发布件、创建/补齐/迁移 framework.config，或集成新发布件后刷新 config、adapters 与 materialized artifacts
argument-hint: <optional-notes>
---

# /framework-init — Framework 项目级初始化

**用户输入（自由文本）**：$ARGUMENTS

<!-- framework-init-applicability-gate -->
> **第一执行动作（BLOCKER）**：完整读取 [canonical framework-init Skill](../../framework/skills/project/framework-init/SKILL.md)，先执行其中“适用性”。显式 `/framework-init` 直接进入 canonical Tier_1 readiness→S1，S3 仍须 S2 批准；明确取消只终止尚未完成的 init，不产生 S3/报告。若本命令上下文被错误加载而最新消息并非正向 init 意图，则按 canonical 立即停止、零 init 副作用：不运行 readiness/S1/planner/harness，不生成或复述 init 结果，不询问是否执行 init；普通任务由主 Agent 正常处理。
> **结果只属于当前 turn**：S4 只证明产生它的那次 S3 run；本 turn 未新建 init run/报告时，不得宣称本轮 init 已完成、复述旧计数或列出旧报告路径。

<!-- adapter-candidates:start -->
**S2 `init.materialized_adapters` 菜单口径（BLOCKER）**：选项 = S1 `InitTaskPlan.adapter_catalog[]` 原样渲染（`value` / `label` / `portable`；禁止写死成员名）。当 `adapter_catalog.length` > `CURSOR_ASKQUESTION_MULTISELECT_MAX` 时 portable 编号多选为主；widget 须分页（每页 ≤`CURSOR_ASKQUESTION_MULTISELECT_MAX`）或省略。
<!-- adapter-candidates:end -->

> **BLOCKER — 用户交互**：编排决策须先调 **AskUserQuestion**（registry `init.task_plan` / `init.materialized_adapters` / `init.task_decision`）；**禁止** Q1=y 自由文本。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — 职责分离**：项目 init 写 `framework.config.json` 与 **materialized_adapters** 物化产物；**个人** active adapter 与 DevEco 由阶段入口 `check-personal-setup.ts --json --ensure` 内联写入 `framework.local.json`（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/project/framework-init/SKILL.md](../../framework/skills/project/framework-init/SKILL.md)**
