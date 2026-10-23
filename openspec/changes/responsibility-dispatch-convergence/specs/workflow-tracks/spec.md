## ADDED Requirements

### Requirement: Lite execution is retired with an explicit migration boundary

`harness/scripts/utils/runtime-policy.ts`, `harness/workflow-loader.ts` and `harness/scripts/goal-phase-runtime.ts` SHALL no longer dispatch lite/change/exit execution. Modern requests/runs with a residual `track: lite` SHALL emit a retirement diagnostic and continue from their existing effective scope or current requested obligations without converting to a full chain. A frozen birth/history chain containing change/exit MUST be diagnosed before removed-stage registration checks and SHALL not resume under the new release. `MIGRATION.md` SHALL instruct using the matching old release to finish or starting a new authorized run while preserving existing delivery budgets. Non-lite spec-driven definitions SHALL remain supported.

#### Scenario: Modern run retains an obsolete key
- **WHEN** a modern run has a valid obligation scope and residual track lite
- **THEN** its scope remains authoritative and the obsolete key does not cause rejection or six-stage expansion

#### Scenario: Historical lite run is resumed
- **WHEN** its frozen actual chain contains change or exit
- **THEN** the entry reports the explicit migration route and does not rewrite the old chain

## REMOVED Requirements

### Requirement: Feature phase track membership is explicit for lite

**Reason**: c2f7a91e retires lite execution and its dedicated artifacts/entry points.

**Migration**: Ignore residual track keys on modern runs; finish historical change/coding/exit runs with their matching old release or start a newly authorized run, preserving delivery budgets. Non-lite behavior remains supported.

### Requirement: Per-track requires and auto_chain are explicit

**Reason**: c2f7a91e retires lite execution and its dedicated artifacts/entry points.

**Migration**: Ignore residual track keys on modern runs; finish historical change/coding/exit runs with their matching old release or start a newly authorized run, preserving delivery budgets. Non-lite behavior remains supported.

