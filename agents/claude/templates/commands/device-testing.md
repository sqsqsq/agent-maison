---
description: 进入真机测试阶段（含即席跑机与设备解锁 / 就绪）
argument-hint: [feature-name]
---

# /device-testing — 真机测试计划与报告

**用户输入**：$ARGUMENTS

> 只要解锁 / 确认设备、或即席跑机（无 feature 名也可进）：先看 SKILL 的「请求分流」节。

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — Personal setup**：跑 harness 前先 `cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>`；仅解析 JSON（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/feature/device-testing/SKILL.md](../../framework/skills/feature/device-testing/SKILL.md)**
