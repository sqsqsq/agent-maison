# Design: goal-mode adapter preflight + Cursor CLI

## Preflight provenance

`argv_adapter` | `manifest_adapter` | `config_local` | `config_legacy` | `fallback`

仅 `fallback` 触发 personal-setup BLOCKER；显式 `--adapter` 或 manifest/resume 来源的已物化 adapter 放行。

## Cursor headless

- Runtime SSOT：`cursorHeadlessPlan` in `agent-invoke.ts`
- Binary：`cursor-agent` → `agent` 回落
- Prompt：stdin（避免 Windows .cmd + 长 argv）
- `-p` 已含 write/shell；`approval_mode=never` 时 `--force`

## Windows

禁止 `shell:true`（prompt 注入 + 与 PROMPT_ARGV_SENTINEL 冲突）。`.cmd` 不可 spawn → preflight BLOCKER，引导安装 `.exe`。
