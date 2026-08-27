## ADDED Requirements

### Requirement: Goal phase gates consume a frozen runtime context

Every goal phase gate SHALL be invoked by `GoalPhaseRuntime` only after the applicable `PhaseExecutionContext` has been prepared and frozen. Attended and detached execution SHALL provide the same gate inputs for equivalent run/phase/attempt facts. A gate or executor MUST NOT discover the active run by scanning, reconstruct missing runtime facts from current HEAD/env/provider state, or write a competing phase decision.

Enforcement: `harness/scripts/utils/goal-phase-runtime.ts`, `harness/harness-runner.ts`, `harness/scripts/goal-in-session-driver.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: Equivalent executor results enter identical gates

- **WHEN** attended and detached executors return equivalent results for the same frozen phase context
- **THEN** the runtime SHALL invoke the same gate path with equivalent inputs and derive the same verdict/backtrack/close semantics

#### Scenario: Executor cannot call a gate directly

- **WHEN** production structure is inspected
- **THEN** no `GoalPhaseExecutor` implementation SHALL import or invoke a phase check/harness entry directly
