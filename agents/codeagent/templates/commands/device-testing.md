---
description: 设计测试用例、验证修复、即席跑机，以及解锁手机 / 唤醒设备；无需 Feature，只设计时不跑机。
argument-hint: '[用例目标 | bundle 与步骤 | 解锁手机 | feature-name]'
---

# /device-testing — 真机测试计划与报告

**用户输入**：$ARGUMENTS

> 运行身份：codeagent（薄入口，逻辑以 framework SKILL 为准；勿被同名 `.claude/commands/device-testing.md` 误导）

> 只要解锁 / 确认设备、或即席跑机（无 feature 名也可进）：先看 SKILL 的「请求分流」节。

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/feature/device-testing/SKILL.md](../../framework/skills/feature/device-testing/SKILL.md)**
