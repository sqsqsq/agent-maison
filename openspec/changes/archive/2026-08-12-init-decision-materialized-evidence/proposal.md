# Proposal: Init decision 物化 adapter 机器证据与 staging 加固

## Why

宿主工程 `/framework-init` 日志显示：agent 可跳过 `init.materialized_adapters` 多选，仅靠 config 回落执行；`--emit-staging-template --context-file` 在文件不存在时 ENOENT；context 中 `projectRoot` 可覆盖 CLI root；显式 skip satisfied 依赖触发误报闭包违反。

## What Changes

- decision.json schema 1.0 增 `materialized_adapters`；project 作用域 preflight 必填（blocked run-log）；personal 豁免
- S3 执行链以 `decision.materialized_adapters` 为 SSOT，再同步进 context/plan
- context staging 禁止 `projectRoot`/`harnessRoot`/`plan`；execute 时 CLI root 不被 context 覆盖
- `--emit-staging-template` 在 context 文件不存在时按空 context 生成待补全模板
- 依赖闭包：显式 skip 的 `status=satisfied` 依赖不阻断下游
- framework-init：Tier_1 readiness 前置、emit 用法、staging 示例、UPDATE adapter 专段

## Impact

- Affected specs: init-orchestration
- Affected code: `harness/scripts/init-orchestrate.ts`, `skills/project/framework-init/`, `agents/claude/templates/commands/framework-init.md`
- Tests: `harness/tests/unit/init-orchestrate.unit.test.ts`
