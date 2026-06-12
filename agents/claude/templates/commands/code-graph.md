---
description: 进入 Code Graph 建图与维护（code-graph）
argument-hint: <ModuleName>
---

# /code-graph — 模块功能图谱

**用户输入**：$ARGUMENTS

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — Personal setup**：跑 harness 前先 `cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>`；仅解析 JSON（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/project/code-graph/SKILL.md](../../framework/skills/project/code-graph/SKILL.md)**
