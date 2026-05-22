---
description: 进入真机测试阶段（Skill 6）
argument-hint: <feature-name>
---

# /device-testing — 真机测试计划与报告

**用户输入**：$ARGUMENTS

> **BLOCKER — 本 Skill registry 确认点（Claude Code）**：
> 凡 `testing.module_name` / `testing.packaging` / `testing.plan_confirm`，须**先**调 **AskUserQuestion**，
> options 逐字引用 [../rules/widget-options/skill6-testing-options.md](../rules/widget-options/skill6-testing-options.md)；
> **同轮仍附** portable 编号；禁止仅用 Markdown 作为唯一交互。
> 会话级 SSOT：[../rules/confirmation-ux.md](../rules/confirmation-ux.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/6-device-testing/SKILL.md](../../framework/skills/6-device-testing/SKILL.md)**
