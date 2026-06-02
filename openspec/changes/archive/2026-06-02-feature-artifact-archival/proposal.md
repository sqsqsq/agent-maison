# Proposal: Feature 产物按阶段归档

## Why

`doc/features/<feature>/` 在演进中形成两种布局并存：阶段主产物（PRD.md、design.md 等）扁平在 feature 根，而 context-exploration、phase-completion-receipt、reports 已在 `<phase>/` 子目录；`ut/` 主产物已嵌套。路径散落在各 check-*.ts 硬编码，无 SSOT，导致布局不一致与迁移后入口校验/catalog 反扫漏报。

## What Changes

- 在 `harness/config.ts` 引入 `PHASE_SCOPED_ARTIFACTS` + artifact resolver（canonical 写路径、dual-read 读路径、legacyDuplicate WARN）
- 阶段主产物 canonical 迁入 `<phase>/`：prd/PRD.md、design/design.md、review/review-report.md、testing/test-plan.md|test-report.md
- 全局契约保持 feature 根：acceptance.yaml、contracts.yaml、use-cases.yaml 等
- 全部读点、入口校验、catalog 反扫、backfill、profile harness、verify prompts 改用 resolver
- Skills/docs 同步新路径表述；fixtures 迁移 + 保留旧扁平 dual-read 用例

## Impact

- Affected specs: feature-artifact-layout (new)
- Affected code: harness/config.ts, spec-loader.ts, check-*.ts, harness-runner.ts, backfill-context-exploration.ts, derive-hylyre-plan-hint.ts, profiles/hmos-app/harness/prd-visual-handoff-check.ts, harness/prompts/verify-*.md, skills 0-6
- Tests: harness/tests/unit/feature-artifact-resolver.unit.test.ts, fixtures
