# Proposal: Init run-log 审计与 readiness / S2·S4 体验收紧

> 属 **2.2.0** 在研窗口（版本门禁由 `.cursor/plans/init_runlog_readiness_ux_47fe0a7e.plan.md` frontmatter `version` 承担）。

## Why

真实宿主工程 `/framework-init` 回执显示：S0 在 harness 依赖未装时裸跑 `npx ts-node` 导致失败；S2 智能模式文案误导「全部 overwrite」；run-log 跳过原因不可区分；顶层缺少 mode/project_root/adapters 审计字段；S4 诱导进入下游 Skill。

## What Changes

- 新增 `harness/scripts/init-readiness.mjs`（Node-only，不自动 `npm install`）
- `init-orchestrate.ts`：run-log `reason` + 顶层审计字段；`normalizeStagingContext`；`resolveTaskAction` smart fallback 与 `allowed_actions` 对齐
- `confirmation-registry.yaml` / Skill 00 / command 模板：S2 文案与 S0/S4 话术
- 不改 task DAG、preflight 规则、adapter decision SSOT

## Impact

- Affected specs: init-orchestration
- Affected code: `harness/scripts/init-readiness.mjs`, `harness/scripts/init-orchestrate.ts`, `skills/00-framework-init/`, `skills/reference/confirmation-registry.yaml`, `agents/claude/templates/commands/framework-init.md`
- Tests: `harness/tests/unit/init-readiness.unit.test.ts`, `init-orchestrate.unit.test.ts`
