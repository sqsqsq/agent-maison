# Proposal: Init 渲染管线与 UPDATE context 派生统一

## Why

宿主工程 `/framework-init` 日志暴露两类根因缺陷：(1) `AGENTS.md.template` 在
`check-init` 与 `render-agents-md` 两套渲染路径不同步，导致 `{{EXTENSION_SKILL_SECTION}}`
残留与架构摘要内联字面值；(2) UPDATE 模式 S3 执行时 preflight 与 executor 使用不同
context 对象，且 `--emit-staging-template` 不预填 `configWritePayload`，迫使 agent 手写
整份 config。

## What Changes

- 新增 `harness/scripts/utils/template-renderer.ts`：共享 vars 构建、`renderAgentsTemplate`、
  `assertNoUnreplacedPlaceholders`；`buildArchitectureSummary` 改为 DSL 引用风格
- `render-agents-md.ts`：`--summary` 改为 optional
- `init-orchestrate.ts`：两阶段 context（`deriveBaseContextForPlanning` /
  `deriveContextForExecution`）；UPDATE emit 预填最小 `configWritePayload`；
  preflight 与 executor 共用 `finalContext`；可选 `--smart-auto` 语法糖
- 导出 `readExistingConfigFromDisk` 供 derive 复用

## Impact

- Affected specs: init-orchestration
- Affected code: `template-renderer.ts`, `check-init.ts`, `render-agents-md.ts`,
  `init-orchestrate.ts`, `config-builder.ts`, framework-init 文档
- Tests: `template-renderer.unit.test.ts`, `init-orchestrate.unit.test.ts` 增补
