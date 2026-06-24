---
description: 目标模式 goal-runner 薄入口
argument-hint: <feature-name> [requirement]
---

# /goal-mode

**用户输入**：$ARGUMENTS

> **运行身份（RESOLVED_ADAPTER）**：claude

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — Personal setup**：跑 harness 前先 Tier_1 就绪（见 [host-harness-readiness](../../framework/skills/reference/host-harness-readiness.md)），再按 [goal-mode Skill](../../framework/skills/project/goal-mode/SKILL.md) 执行 personal setup 与 goal-runner；**agent 自跑**，勿让用户手动执行 harness 命令。

完整 Skill：**[framework/skills/project/goal-mode/SKILL.md](../../framework/skills/project/goal-mode/SKILL.md)**
