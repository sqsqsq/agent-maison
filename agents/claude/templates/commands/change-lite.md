---
description: 进入 lite 轨单文档链（change → coding → exit）
argument-hint: <feature-name-or-description>
---

# /change-lite — lite 轨（L1）

**用户输入**：$ARGUMENTS

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 判档与中途升档走 `feature.track`；闭环停等 `phase.next_step`。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — Personal setup**：跑 harness 前先 `cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>`；仅解析 JSON（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/feature/change-lite/SKILL.md](../../framework/skills/feature/change-lite/SKILL.md)**
