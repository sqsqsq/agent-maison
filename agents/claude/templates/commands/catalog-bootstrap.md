---
description: 进入模块画像自举阶段（Skill 0 · Phase A）
argument-hint: <ModuleName>
---

# /catalog-bootstrap — 模块画像自举

**用户输入**：$ARGUMENTS

## 唯一指令

完整读一遍 [framework/skills/0-catalog-bootstrap/SKILL.md](../../framework/skills/0-catalog-bootstrap/SKILL.md)，按其中的 **Phase A** Step 0 → Step 7 严格执行。一次处理 1 个模块。草稿先落到 `doc/catalog-staging/<ModuleName>.yaml` 作审计留档，然后**在对话里把人友好汇总摆给用户**，由用户回 `y / e <改指令> / s / q` 决定去向——**AI 负责翻转 `confirmed_by_user` 并执行合并**，用户不需要手动编辑 staging 文件。

> - 全局约束在 `CLAUDE.md`（Claude Code 启动时已自动加载），不要假装没看见。
> - **本文件不复述任何规则 / BLOCKER / harness 命令 / 完成标准**——如发生冲突，以 SKILL.md 和 CLAUDE.md 原文为准。
> - 推断字段时对照 `framework/profiles/<project_profile.name>/skills/0-catalog-bootstrap/prompts/infer-module-card.md`（`<project_profile.name>` 取自实例根 `framework.config.json`），禁止跳步。
> - 遇到"SKILL.md 没写但我觉得应该做"的念头 → 先停下来问用户，不要自行扩展。
