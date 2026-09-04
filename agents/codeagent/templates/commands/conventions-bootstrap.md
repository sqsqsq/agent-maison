---
description: 策展工程惯例知识资产（逐条确认）
---

# /conventions-bootstrap

**用户输入**：$ARGUMENTS

> 运行身份：codeagent（薄入口，逻辑以 framework SKILL 为准；勿被同名 `.claude/commands/conventions-bootstrap.md` 误导）

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/project/conventions-bootstrap/SKILL.md](../../framework/skills/project/conventions-bootstrap/SKILL.md)**
