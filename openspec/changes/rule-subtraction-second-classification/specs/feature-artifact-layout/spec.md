## MODIFIED Requirements

### Requirement: facts.md is the single exploration artifact per feature

feature 级探索事实 MUST 落盘于 `<features_dir>/<feature>/context/facts.md`，由该 track 的首个 feature phase 建立（full=spec、lite=change）；后续每个 active feature phase MUST 以 `phase_delta` 增量节追加（无新事实须显式写 "none"），MUST NOT 重做全量探索或另建 per-phase 探索文件。路径 MUST 经 `paths.features_dir` 解析。缺少本阶段 `phase_delta` 节或节内为空时，harness 仍产出原始失败，但该失败 SHALL 被披露并计入完成缺口，不单独让阶段失败。

#### Scenario: coding 阶段复用 spec 的探索
- **WHEN** full track 的 coding phase 开始且 facts.md 已由 spec 建立
- **THEN** coding 只追加 `phase_delta: coding` 节，探索校验通过，不要求新建 context-exploration.md

#### Scenario: 后续阶段补充输入与建立阶段模式
- **WHEN** 后续阶段在自己的路径/事实/影响增量表追加必读输入
- **THEN** 必读覆盖 SHALL 共同读取基线和本阶段增量，不要求改基线头部、不使用其它阶段的增量
- **AND** 探索模式 SHALL 仅在建立事实时检查，后续阶段不得按自己的模式要求重判已核基线

#### Scenario: review/ut/testing 不留断层
- **WHEN** full track 的 review phase 校验探索凭证
- **THEN** 校验对象为 facts.md 的 `phase_delta: review` 节（receipt 凭证同源）

> **Enforced by:** `specs/phase-rules/*-rules.yaml`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/check-disposition.ts`
