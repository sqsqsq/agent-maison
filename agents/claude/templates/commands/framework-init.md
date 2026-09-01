---
description: 首次接入 Maison 发布件、创建或迁移 framework.config、集成新发布件后刷新 adapters，或显式选择/调用 framework-init；Git/SCM status、diff、add、stage、commit、push 保持 L0 direct
argument-hint: <optional-notes>
---

# /framework-init — Framework 项目级初始化

**用户输入（自由文本）**：$ARGUMENTS

<!-- framework-init-applicability-gate -->
> **第一执行动作（BLOCKER）**：完整读取 [canonical framework-init Skill](../../framework/skills/project/framework-init/SKILL.md)，先执行其中“适用性与最新意图门”。无否定或竞争主动作的显式 `/framework-init` 直接进入 canonical Tier_1 readiness→S1，S3 仍须 S2 批准；若门要求退出 init，只停止 init 子流程而不结束本轮用户任务：存在 Git/其它主动作时立即继续并完成最新获授权主动作，纯取消才等待。不得输出 init 规则解释、不得询问是否执行 init、不得运行 readiness/S1/planner/harness；明确有序多动作必须按 canonical 顺序全部完成。

<!-- adapter-candidates:start -->
**S2 `init.materialized_adapters` 菜单口径（BLOCKER）**：选项 = S1 `InitTaskPlan.adapter_catalog[]` 原样渲染（`value` / `label` / `portable`；禁止写死成员名）。当 `adapter_catalog.length` > `CURSOR_ASKQUESTION_MULTISELECT_MAX` 时 portable 编号多选为主；widget 须分页（每页 ≤`CURSOR_ASKQUESTION_MULTISELECT_MAX`）或省略。
<!-- adapter-candidates:end -->

> **BLOCKER — 用户交互**：编排决策须先调 **AskUserQuestion**（registry `init.task_plan` / `init.materialized_adapters` / `init.task_decision`）；**禁止** Q1=y 自由文本。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — 职责分离**：项目 init 写 `framework.config.json` 与 **materialized_adapters** 物化产物；**个人** active adapter 与 DevEco 由阶段入口 `check-personal-setup.ts --json --ensure` 内联写入 `framework.local.json`（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/project/framework-init/SKILL.md](../../framework/skills/project/framework-init/SKILL.md)**
