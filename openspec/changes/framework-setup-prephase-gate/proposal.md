# Proposal: Framework Setup 收敛为前置环境检查

## Why

独立 `/framework-setup` slash 命令与 `personal-setup-gate` 技能跳板易让普通用户误解职责边界；个人 setup 应作为各阶段入口的前置环境检查内联完成，而非单独命令。

## What Changes

- 移除 Claude `/framework-setup` slash 与 `skills-bridge/personal-setup-gate` 对外跳板（保留 `skills/reference/personal-setup-gate.mdSKILL.md` 内部过程文档）
- `check-personal-setup.ts --ensure --json` 确定性门控：单一物化 adapter 自动写 `framework.local.json`；多 adapter 返回 `needs_adapter_choice`；零 adapter 返回 `no_materialized_adapter`
- `harness-runner` personal gate 覆盖 catalog/glossary，仅豁免 init/docs；`run-global-phases` 内部自验可通过 `HARNESS_INIT_INTERNAL_GLOBAL_RUN=1` 豁免（不得用于普通阶段入口）
- 阶段 SKILL/命令/bridge 统一引用 `personal-setup-gate.md` 与 `--ensure`，不再引导 `/framework-setup`

## Impact

- Affected specs: harness-gates, agent-adapters, framework-local-config
- Affected code: `harness/scripts/check-personal-setup.ts`, `harness/scripts/utils/personal-setup-gate.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/init-task-executor.ts`, `agents/`, `skills/`
