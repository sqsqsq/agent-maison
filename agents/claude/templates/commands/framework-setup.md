---
description: 个人 Framework 设置（agent_adapter + DevEco 路径 → framework.local.json）
argument-hint: <optional-notes>
---

# /framework-setup — Framework 个人 Setup

**用户输入（自由文本）**：$ARGUMENTS

> **BLOCKER — 用户交互**：任何选择须先调 **AskUserQuestion**（registry `setup.adapter` / `setup.deveco_path`）。
> 完整协议：[interaction-renderer](../rules/interaction-renderer.md)。

> **BLOCKER — 不写项目产物**：本命令**仅**写 `framework.local.json`；物化 adapter 须走 `/framework-init`。

# 跳板文件

完整 Skill 定义请阅读：**[framework/skills/00b-framework-setup/SKILL.md](../../framework/skills/00b-framework-setup/SKILL.md)**
