---
description: 实现或修复代码，或只编译当前工程。只编译无需需求号，按请求终点停止。
argument-hint: '[实现目标 | 只编译工程 | feature-name]'
---

# /coding — 编码落地

**用户输入**：$ARGUMENTS

> 运行身份：codeagent（薄入口，逻辑以 framework SKILL 为准；勿被同名 `.claude/commands/coding.md` 误导）

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/feature/coding/SKILL.md](../../framework/skills/feature/coding/SKILL.md)**
