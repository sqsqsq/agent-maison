# Proposal: goal-mode adapter 门禁与 Cursor 无头命令修复

## Why

宿主在 Cursor 下跑 goal 模式时 `goal-runner` 因错误的 `cursor agent --print` 命令 HALTED；且 goal-mode 入口未接入 personal-setup-gate，无 `framework.local.json` 时静默回落 generic，门禁延迟到 harness 阶段。

## What Changes

- Cursor headless：运行时 SSOT 改为 `cursor-agent`（回落 `agent`）`-p` + stdin 传 prompt；`agents/cursor/adapter.yaml` 同步声明
- goal-runner preflight：adapter-aware + provenance-aware（显式/manifest/resume 已物化放行；仅 `fallback` 拦 personal setup）
- goal-mode SKILL：personal setup BLOCKER 前置 + 可选用户 `adapter` 输入
- Windows：`.cmd` 垫片不可安全带参 spawn；优先 `.exe` 解析

## Impact

- Affected specs: goal-runner, goal-mode-skill, agent-adapters
- Affected code: `agent-invoke.ts`, `goal-preflight.ts`, `goal-runner.ts`, `skills/project/goal-mode/SKILL.md`
