## Why

Goal run 的出生事实目前分散在 detached loop 的 `run_start`、首次 coding 时写入的场外 `coding-base.json` 与各入口自行构造 manifest 的行为中；attended、UT-start、resume 和 successor 因而可能缺锚、换锚或走不同身份语义。3.0.0 需要在任何 agent invocation 前把 run 身份和问责基线冻结为一次性、可回放、不可原地改写的出生契约。

## What Changes

- **BREAKING**：所有 fresh attended/detached goal run 统一经 fresh-only `createGoalRun` 创建，先写 `manifest.json`，再恰好写一条 `run_created`；resume 只加载既有出生事实。
- **BREAKING**：goal 基线字段统一为 `manifest.run_base_sha`。包含 coding/UT 的链在创建时必须取得 Git HEAD；纯 spec/plan 链可无基线。goal run 不再读取 `HARNESS_DIFF_BASE_REF`，旧 `coding-base.json` 仅在严格 legacy 时代判据下只读兼容。
- 将 `run_base_sha` 纳入 manifest identity，并以漂移可见、授权前无条件拒绝、identity-rebase 回放校验三层防线实现 write-once。
- 创建中断残留统一判为 `CREATION_INCOMPLETE`：不可 attach/resume/supervisor takeover，不占用 HALTED/PARTIAL successor 槽位，也不进入正常 progress 投影。
- 自动 successor 继承最早可信 lineage baseline；新增运行时外管理命令 `--supersede <old-run-id> --rebaseline-to <exact-40hex-sha>`，要求 HEAD 精确匹配、goal execution signal 全无，并只向新 run 写审计事件。
- runtime-owned 基线缺失、损坏和出生事件缺失复用既有 failure classifier，统一为非 `agent_fixable`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `goal-runner`: fresh 创建、一次性出生事件、manifest identity、successor/rebaseline、legacy 隔离、occupancy 与 supervisor/resume 语义。
- `goal-mode-skill`: attended 入口和 attach 必须消费同一出生契约，不得自行创建或补造事实。
- `harness-gates`: UI/UT goal 基线只消费 `manifest.run_base_sha`；非 goal 手工 harness 继续允许 env 基线。

## Impact

- 影响 `harness/scripts/goal-runner.ts`、`goal-mode-entry.ts`、`goal-in-session-driver.ts`、`goal-supervisor.ts` 及 `utils/{goal-manifest,goal-runner-phase,ui-scope-gate,ut-target-resolver,phase-state,goal-failure-classifier}.ts`。
- 影响 manifest schema、goal events、goal-mode runbook 与相关 unit/fixture；不新增状态文件、ledger、事务状态机或 AuthorityFacts。
- 新 schema run 不兼容“缺 `run_created` 仍继续”的旧行为；legacy run 保持严格只读兼容，因此不要求消费者批量迁移已有 run，`MIGRATION.md` 仅在现有 CLI/字段面需要消费者动作时更新。
