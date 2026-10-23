## MODIFIED Requirements

### Requirement: facts.md is the single exploration artifact per feature

Feature facts SHALL remain at `<features_dir>/<feature>/context/facts.md`. A validated predecessor/current baseline retains its actual establishing phase and fingerprint; reordering the remaining queue MUST NOT redefine its owner. Downstream active phases SHALL append only their own phase_delta (including an explicit none when appropriate), without rewriting the baseline or creating a parallel per-phase facts source. Enforcement: `harness/scripts/utils/context-facts.ts`, `harness/scripts/utils/capability-resolution-entry-input.ts`.

#### Scenario: coding 阶段复用 spec 的探索
- **WHEN** full track 的 coding phase 开始且 facts.md 已由 spec 建立
- **THEN** coding 只追加 `phase_delta: coding` 节，探索校验通过，不要求新建 context-exploration.md

#### Scenario: review/ut/testing 不留断层
- **WHEN** full track 的 review phase 校验探索凭证
- **THEN** 校验对象为 facts.md 的 `phase_delta: review` 节（receipt 凭证同源）

> **Enforced by:** `specs/phase-rules/*-rules.yaml`, `harness/scripts/check-receipt.ts`

## REMOVED Requirements

### Requirement: change.md is the single lite narrative artifact

**Reason**: c2f7a91e retires lite execution and its dedicated artifacts/entry points. Canonical source clauses are explicitly marked retired until archive removes them; deleted implementations are no longer claimed as current enforcement.

**Migration**: Ignore residual track keys on modern runs; finish historical change/coding/exit runs with their matching old release or start a newly authorized run, preserving delivery budgets. Non-lite behavior remains supported.

