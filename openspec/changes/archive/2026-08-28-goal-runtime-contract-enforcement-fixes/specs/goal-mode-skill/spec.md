## ADDED Requirements

### Requirement: Shared runtime enforces attended authorization boundaries

`GoalPhaseRuntime` SHALL enforce the attended entry's existing `authorization`, `through_phase`, `leaseMs` and `maxRounds` inputs at safe phase boundaries before invoking an executor. Manual authorization MUST perform no agent invocation; batch authorization MUST stop before a phase beyond the authorized through-phase; and a single-round call MUST start at most one phase. These decisions MUST remain runtime-owned and MUST NOT be delegated to `AttendedGoalPhaseExecutor`.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-in-session-driver.ts`, `harness/scripts/utils/goal-phase-executor.ts`

#### Scenario: Manual attended entry does not invoke an agent

- **WHEN** an attended run is entered with `authorization=manual`
- **THEN** the runtime returns at its phase boundary with zero executor invocations

#### Scenario: Batch entry stops at its authorized phase

- **WHEN** an attended batch run is authorized through a phase in the frozen chain
- **THEN** the runtime may complete that phase but MUST NOT start the following phase

#### Scenario: Single-round entry starts at most one phase

- **WHEN** `runInSessionRound` invokes the runtime with `maxRounds=1`
- **THEN** the runtime starts at most the current phase and returns before starting the next phase
