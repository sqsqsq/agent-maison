---
description: 进入业务级 UT 阶段（Skill 5）
argument-hint: <feature-name>
---

# /business-ut — 业务级 UT / DAG

**用户输入**：$ARGUMENTS

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — Personal setup**：跑 harness 前先 `cd framework/harness && npx ts-node scripts/check-personal-setup.ts --project-root <repo-root>`；exit 1 → 引导 `/framework-setup`（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/5-business-ut/SKILL.md](../../framework/skills/5-business-ut/SKILL.md)**
