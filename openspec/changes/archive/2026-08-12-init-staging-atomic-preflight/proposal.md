# Proposal: Init staging 原子 preflight 与 decision/context 生命周期

## Why

S2→S3 的 `decision.json` / `context.json` 缺乏落点与生命周期规范；坏 decision 在 reconcile 阶段抛 TypeError；缺 payload 时 S3 会部分写盘（如 `ensure-gitignore` 无 deps 仍会执行）后才 failed，违背原子 init 预期。

## What Changes

- **BREAKING (S3 语义)**：`--execute` 增加无副作用 preflight；payload/决策非法时**除 harness 审计 run-log 外**不修改项目业务/机制产物，写 blocked run-log 后 `exit 1`
- 新增 `assertDecisionStructure`（结构 + 枚举守卫）与 CLI JSON 语法友好错误（decision/context 分文案）
- 新增 `preflightExecute`：校验 decision、config/doc payload 存在性与 `validateFrameworkConfigWriteCandidate`/`sanitizeProjectConfigForInitWrite`
- framework-init：staging 落 OS 临时目录；S4 成功/失败均清理
- 不改 canonical gitignore（放弃 `.framework-init/` 方案）

## Impact

- Affected specs: init-orchestration
- Affected code: `harness/scripts/init-orchestrate.ts`, `skills/project/framework-init/SKILL.md`, `agents/`, `MIGRATION.md`
- Tests: `harness/tests/unit/init-orchestrate.unit.test.ts`
