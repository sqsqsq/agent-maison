---
description: 进入业务级 UT 阶段（Skill 5）
argument-hint: <feature-name>
---

# /business-ut — 业务级 UT / DAG

**用户输入**：$ARGUMENTS

> **BLOCKER — 本 Skill registry 确认点（Claude Code）**：
> 凡 `ut.plan_confirm` / `ut.mock_plan` / `ut.src_mutation` / `ut.dag_confirm`，须**先**调 **AskUserQuestion**，
> options 逐字引用 [../rules/widget-options/skill5-ut-options.md](../rules/widget-options/skill5-ut-options.md)；
> **同轮仍附** portable 编号；`ut.src_mutation` 须先展示完整变更描述再 widget。
> 会话级 SSOT：[../rules/confirmation-ux.md](../rules/confirmation-ux.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/5-business-ut/SKILL.md](../../framework/skills/5-business-ut/SKILL.md)**
