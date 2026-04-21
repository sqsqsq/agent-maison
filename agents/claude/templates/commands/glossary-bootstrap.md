---
description: 进入业务术语表自举阶段（Skill 0 · Phase B）
argument-hint: [optional-single-term]
---

# /glossary-bootstrap — 业务术语表自举

**用户输入**：$ARGUMENTS

## 唯一指令

完整读一遍 [framework/skills/0-catalog-bootstrap/SKILL.md](../../framework/skills/0-catalog-bootstrap/SKILL.md)，按其中的 **Phase B** Step 1 → Step 4 严格执行。种子清单来自 `doc/glossary-seed.txt`（用户提供），**禁止 AI 自造**。草稿先落到 `doc/glossary-staging/<term>.yaml` 作审计留档，然后**在对话里 1 条 1 条展示**（含易混项），由用户回 `y / e <改指令> / s / q` 决定去向——**AI 负责翻转 `confirmed_by_user` 并逐条合并**，用户不需要手动改 staging 文件里的 flag。

> - 全局约束在 `CLAUDE.md`（Claude Code 启动时已自动加载），不要假装没看见。
> - **本文件不复述任何规则 / BLOCKER / harness 命令 / 完成标准**——如发生冲突，以 SKILL.md 和 CLAUDE.md 原文为准。
> - 推断映射时对照 [prompts/infer-glossary-term.md](../../framework/skills/0-catalog-bootstrap/prompts/infer-glossary-term.md) 的匹配优先级和 `easily_confused_with` 强制补全规则。
> - 前置门禁：若 `doc/module-catalog.yaml` 覆盖率不足（< 80% 工程模块），先跳转 `/catalog-bootstrap`，**禁止先跑 glossary**。
