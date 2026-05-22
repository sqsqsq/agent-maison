---
description: 进入 PRD 撰写阶段（Skill 1）
argument-hint: <feature-name-or-description>
---

# /prd-design — PRD 撰写

**用户输入**：$ARGUMENTS

> **BLOCKER — 本 Skill registry 确认点（Claude Code）**：
> 凡 `prd.feature_path` / `prd.terminology` / `prd.freeze` 等 gate/enum/术语 gate，须**先**调 **AskUserQuestion**，
> options 逐字引用 [../rules/widget-options/skill1-prd-options.md](../rules/widget-options/skill1-prd-options.md)；
> **同轮仍附** portable 编号；禁止仅用 Markdown 作为唯一交互。
> `prd.terminology` 对话 widget 后须写回 PRD `[x]`；不替代 Step 2.5 Research Sub-Phase（v2.9+）。
> 会话级 SSOT：[../rules/confirmation-ux.md](../rules/confirmation-ux.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/1-prd-design/SKILL.md](../../framework/skills/1-prd-design/SKILL.md)**
