---
description: 进入 PRD 撰写阶段（Skill 1）
argument-hint: <feature-name-or-description>
---

# /prd-design — PRD 撰写

**用户输入**：$ARGUMENTS

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> `prd.terminology` 对话 widget 后须写回 PRD `[x]`；不替代 Step 2.5 Research Sub-Phase（v2.9+）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — Personal setup**：跑 harness 前先 `cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>`；仅解析 JSON（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/1-prd-design/SKILL.md](../../framework/skills/1-prd-design/SKILL.md)**
