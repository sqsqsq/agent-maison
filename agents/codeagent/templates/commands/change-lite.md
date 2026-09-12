---
description: 恢复已有旧 lite run；新任务按请求职责进入
argument-hint: <feature-name-or-description>
---

# /change-lite — lite 轨（L1）

**用户输入**：$ARGUMENTS

> 运行身份：codeagent（薄入口，逻辑以 framework SKILL 为准；勿被同名 `.claude/commands/change-lite.md` 误导）

> **BLOCKER — 用户交互**：任何用户选择必须先调 **AskUserQuestion**（选项文案从
> `framework/skills/reference/confirmation-registry.yaml` 的 `options` 逐字引用）。
> 仅旧 run 的兼容恢复读取 `feature.track`；新任务交主 Agent，不展示判档菜单。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — Personal setup**：跑 harness 前先 `cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --project-root <repo-root>`；仅解析 JSON（见 [personal-setup-gate](../../framework/skills/reference/personal-setup-gate.md)）。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/feature/change-lite/SKILL.md](../../framework/skills/feature/change-lite/SKILL.md)**
