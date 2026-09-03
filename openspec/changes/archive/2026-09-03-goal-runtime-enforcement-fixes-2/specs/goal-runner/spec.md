## ADDED Requirements

### Requirement: Compatibility recovery is part of the frozen actual chain

Any compatibility condition that requires an earlier owner phase SHALL be resolved before modern fresh creation and included in the ordered chain passed to `createGoalRun`. After `run_created`, the runtime MUST execute only its recorded `phase_chain`; a recovery target absent from that chain MUST halt as framework corruption and MUST NOT be inserted locally.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-run-creation.ts`

#### Scenario: Legacy fidelity state exists before a downstream fresh start
- **WHEN** a fresh modern run requests coding or review as its start while an inert legacy fidelity decision requires spec recovery
- **THEN** spec is included in both manifest and `run_created.phase_chain` before any phase executes

#### Scenario: Resume discovers an unrecorded recovery target
- **WHEN** a modern run resumes with a pending recovery target that is absent from its frozen birth chain
- **THEN** the runtime halts without executing, inserting or reordering that phase

### Requirement: Structural phase-runtime verification follows lifecycle authority

Release structural verification SHALL identify lifecycle advancement definitions, lifecycle-event writers, handoff transition writers and executor-to-gate call edges across production TypeScript. It MUST fail when a second production owner exists regardless of loop syntax.

Enforcement: `harness/tests/unit/goal-runtime-structural-acceptance.unit.test.ts`

#### Scenario: A second loop uses different syntax
- **WHEN** a compatibility driver regains phase advancement through recursion, array iteration or a differently named loop
- **THEN** structural verification fails from the competing authority/call edge rather than relying on a `while (!phaseDone)` literal

### Requirement: Goal scope gates ignore live diff-base overrides

Coding and exit scope gates SHALL ignore `HARNESS_DIFF_BASE_REF` whenever `hasGoalExecutionSignal` is true. The live variable MAY retain its legacy non-goal diagnostic behavior, but it MUST NOT select the baseline of either an agent-side or formal goal gate.

Enforcement: `harness/scripts/check-coding.ts`, `harness/scripts/check-exit.ts`, `harness/scripts/utils/phase-state.ts`

#### Scenario: Goal agent resets the scrubbed variable
- **WHEN** a goal agent sets `HARNESS_DIFF_BASE_REF` before self-invoking the harness
- **THEN** the scope gate ignores the value and uses the frozen goal baseline path

#### Scenario: Non-goal diagnostic run supplies a base
- **WHEN** a direct non-goal harness invocation supplies `HARNESS_DIFF_BASE_REF`
- **THEN** the existing explicit-base diagnostic behavior remains available
