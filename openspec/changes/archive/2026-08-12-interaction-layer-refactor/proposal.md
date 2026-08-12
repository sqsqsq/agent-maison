# Proposal: 交互层架构大重构

## Why

Claude Code + 弱模型（如 MiniMax 2.7）场景下，framework 用户确认交互大量退化为文本输入，而非键盘选择。根因是平台工具名（AskUserQuestion / AskQuestion）散落在 skills、commands、widget-options 多层，弱模型无法追踪完整指令链。

## What Changes

- **BREAKING**: `confirmation-registry.yaml` 升级 schema 2.0，合入全部 widget 选项文案；删除 `widget_options_ref` / `widget_hint`
- **BREAKING**: 删除 `agents/claude/templates/rules/widget-options/` 与 `confirmation-ux.md`
- 新增各 adapter 专属 `interaction-renderer` 规则（Claude / Cursor / generic 三份独立）
- Skills / profiles / agents/shared 共享层零平台工具名
- Claude commands 保留一句 AskUserQuestion 强约束，不再复制 options 表
- `check-init` 支持 `interaction_renderer_rule` 增量下发与 `deprecated_artifacts` 自动 backup_delete
- harness lint 扩展：共享层禁工具名 + registry options 完整性 + smoke test

## Impact

- Affected specs: user-confirmation-ux, adapter-schema, check-init, check-skills-confirmation-ux
- Affected code: `skills/reference/`, `agents/`, `harness/scripts/`, `docs/`
- Migration: 消费者工程 `/framework-init` UPDATE 后自动清理旧 `.claude/rules/widget-options/` 与 `confirmation-ux.md`
