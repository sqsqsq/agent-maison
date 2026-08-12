# Delta: Feature Artifact Layout — per-feature facts.md

## ADDED Requirements

### Requirement: facts.md is the single exploration artifact per feature

feature 级探索事实 MUST 落盘于 `<features_dir>/<feature>/context/facts.md`，由该 track 的首个 feature phase 建立（full=spec、lite=change）；后续每个 active feature phase MUST 以 `phase_delta` 增量节追加（无新事实须显式写 "none"），MUST NOT 重做全量探索或另建 per-phase 探索文件。路径 MUST 经 `paths.features_dir` 解析。

#### Scenario: coding 阶段复用 spec 的探索
- **WHEN** full track 的 coding phase 开始且 facts.md 已由 spec 建立
- **THEN** coding 只追加 `phase_delta: coding` 节，探索校验通过，不要求新建 context-exploration.md

#### Scenario: review/ut/testing 不留断层
- **WHEN** full track 的 review phase 校验探索凭证
- **THEN** 校验对象为 facts.md 的 `phase_delta: review` 节（receipt 凭证同源）

> **Enforced by:** `specs/phase-rules/*-rules.yaml`, `harness/scripts/check-receipt.ts`

### Requirement: Legacy per-phase exploration remains readable

旧 per-phase `context-exploration.md` 布局 MUST 保持可读可校验（WARN 提示可 backfill）；`backfill-context-exploration.ts` MUST 提供幂等的旧布局→facts.md 归并。

#### Scenario: 存量 feature 零迁移
- **WHEN** 存量 feature 只有旧 per-phase 探索文件
- **THEN** 各 phase 校验按旧契约通过，仅出 WARN 建议 backfill

> **Enforced by:** `harness/scripts/backfill-context-exploration.ts`, `specs/phase-rules/*-rules.yaml`
