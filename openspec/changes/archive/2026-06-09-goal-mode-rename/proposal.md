# Proposal: goal-mode 重命名与证据目录收窄

## Why

宿主入口 `goal-orchestration` 与策略名 `goal_mode` 不一致；运行证据落在工程根 `goal-runs/` 与 feature 文档树脱节。Review 收窄为 MVP：重命名 + feature 绑定证据目录 + NL 分流（goal 优先 batch）。

## What Changes

- 宿主 Skill/slash/跳板：`goal-orchestration` → `goal-mode`（`/goal-mode`）；全 agent（claude/cursor/codex/generic）
- 证据目录：`doc/features/<feature>/goal-runs/<run-id>/`（`paths.features_dir` 默认 `doc/features`）
- `--resume <run-id>` **必须**配 `--feature` 或 `--manifest`；不跨 feature 扫描
- `parseGoalModeAuthorization` + `resolveTransitionPolicy`（goal_mode 优先于 batch_authorized）
- canonical gitignore 仅增 `doc/features/*/goal-runs/`
- 活跃 spec：`goal-orchestration-skill` → `goal-mode-skill`

## Impact

- Affected specs: goal-runner, goal-mode-skill (replaces goal-orchestration-skill), harness-gates
- Affected code: `skills/`, `agents/`, `harness/scripts/utils/goal-manifest.ts`, `goal-runner.ts`, `phase-transition-policy.ts`, `canonical-gitignore.ts`, docs
