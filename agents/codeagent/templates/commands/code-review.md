---
description: 审查当前 diff、提交或指定文件的代码质量；无需 Feature，默认只审不改。
argument-hint: '[当前 diff | 提交 | 文件范围 | feature-name]'
---

# /code-review — 代码审查

**用户输入**：$ARGUMENTS

> 运行身份：codeagent（薄入口，逻辑以 framework SKILL 为准；勿被同名 `.claude/commands/code-review.md` 误导）

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/feature/code-review/SKILL.md](../../framework/skills/feature/code-review/SKILL.md)**
