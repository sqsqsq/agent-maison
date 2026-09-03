# Proposal: Feature Track — L0/L1/L2 分档工作流

## Why

framework 对小工程过重：单模块几千行的需求也被迫走 6 阶段全链 + 每阶段 4 重凭证。业界共识（Fowler：有效的 SDD 工具必须为不同规模变更提供不同核心工作流）与用户实测反馈一致——重量必须跟着变更风险走，而不是跟着阶段走。

## What Changes

- workflow schema 升 **1.1**（loader 兼容 1.0=full 单轨）：`artifacts[].tracks`（feature phase 缺省 `["full"]`，lite 成员须显式）、`artifacts[].requires_by_track`（同 phase 分轨依赖）、`auto_chain_by_track`（存在 lite-only phase 时必须显式声明 lite 链，C0 只做一致性校验不推导）
- spec-driven workflow 增 lite 链：`change`（产 change.md）→ `coding`（`requires_by_track.lite: [change]`）→ `exit`（一次出口门禁）
- feature 级声明 `doc/features/<feature>/feature.yaml`：track、判档评分快照、确认记录（路径一律经 `paths.features_dir` 解析，禁止硬编码）
- 判档：复用 `exploration_strategy` 评分维度上抬，增 pixel_1to1 / 跨模块 / goal 一票升 full；`feature.track` 确认 gate 登记 confirmation-registry
- L1 产物 `change.md`（意图/scope/术语快查/验收 checkbox/关键契约）+ `check-change-lite.ts` + exit 门禁（编译+lint+diff_within_scope+checkbox+条件 UT）
- L0 direct：入口路由文本（不进管线但仍守项目原生 test/lint/build；拿不准默认进 lite）
- 入口路由表同时落「修正三问」文本 + correction gate 登记（C5 的 Phase 0 文本先行部分）
- skills 索引增 `feature/change-lite` 入口 skill

## Impact

- Affected specs: workflow-tracks（新增）、feature-artifact-layout、harness-gates、agent-adapters
- Affected code: `specs/workflow-schema.json`、`harness/workflow-loader.ts`、`workflows/spec-driven.workflow.yaml`、`harness/config.ts`（loadFeatureTrack）、`harness/scripts/check-change-lite.ts`（新增）、`harness/harness-runner.ts`、`skills/skills.index.yaml`、`skills/feature/change-lite/`（新增）、`skills/reference/confirmation-registry.yaml`、`templates/AGENTS.md.template`
- 兼容不变式：未声明 track = full、schema 1.0 workflow 视作 full 单轨 → hmos-app 现有行为与夹具零回归
