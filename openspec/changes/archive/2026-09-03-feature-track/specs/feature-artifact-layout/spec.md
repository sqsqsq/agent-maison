# Delta: Feature Artifact Layout — feature.yaml 与 change.md

## ADDED Requirements

### Requirement: feature.yaml declares track

feature 级档位声明 MUST 落盘于 `<features_dir>/<feature>/feature.yaml`，含 `track`、判档评分快照、确认记录与升档 history；文件缺失 MUST 解释为 `track: full`。所有读写 MUST 经 `paths.features_dir` 解析，MUST NOT 硬编码 `doc/features/`。

#### Scenario: 无 feature.yaml 的存量 feature
- **WHEN** 既有 feature 目录无 feature.yaml
- **THEN** 全部运行时按 full track 处理，行为与升级前一致

> **Enforced by:** `harness/config.ts`（loadFeatureTrack）, `harness/scripts/utils/runtime-policy.ts`

### Requirement: change.md is the single lite narrative artifact

lite track 的叙述产物 MUST 为单文档 `change.md`（意图 / scope in-out 模块 / 术语快查 / 验收 checkbox / 关键契约 / 任务 checkbox）；lite MUST NOT 要求 spec.md / plan.md / contracts.yaml / per-phase receipt。升档 full 时 change.md MUST 作为 spec/plan 的种子输入而非作废。

#### Scenario: lite feature 全链产物
- **WHEN** 单模块 feature 走 lite（change → coding → exit）完成
- **THEN** feature 目录内叙述产物仅 change.md（+ exit 报告），无 spec/plan/contracts/receipt

> **Enforced by:** `harness/scripts/check-change-lite.ts`, `workflows/spec-driven.workflow.yaml`
