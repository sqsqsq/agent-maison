## ADDED Requirements

### Requirement: Goal phases advance through one shared runtime

All attended and detached goal phase execution SHALL advance through one `GoalPhaseRuntime`. The runtime SHALL own owner/epoch validation, assessment, attempt and `phase_start`, runtime-owned fact preparation, receipt scaffold, agent invocation boundary, harness gates, verdict, retry/backtrack, resume replay, close/closure, handoff and `run_end`. No runner, driver, supervisor or executor MAY maintain an independent phase loop, call a phase gate directly or publish a competing lifecycle state.

Enforcement: `harness/scripts/utils/goal-phase-runtime.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/goal-in-session-driver.ts`, `harness/scripts/goal-supervisor.ts`

#### Scenario: Coding uses the same lifecycle in both modes

- **WHEN** equivalent attended and detached runs execute one coding attempt
- **THEN** both SHALL pass through the same runtime preparation, gate, verdict and close code; only their executor implementation MAY differ

#### Scenario: Stale executor result cannot mutate lifecycle

- **WHEN** owner epoch changes while an executor is running
- **THEN** the runtime MUST reject the returned result before gate, verdict, closure or backtrack mutation

### Requirement: Canonical lifecycle has one production projection

`projectCanonicalLifecycle(events)` SHALL be a pure production projection that preserves, in order, every canonical `run_created`, `phase_start`, `phase_verdict`, `phase_halt`, `phase_backtrack_requested`, semantic `owner_handoff {from,to,outcome}`, and `run_end`. It SHALL normalize timestamp, PID, owner ID, invoke ID and epoch numeric differences and SHALL exclude executor-private `agent_invoke_*`, stdio request/response, adapter output and lease telemetry. Tests MUST consume this function rather than maintain a separate canonical-event list.

Enforcement: `harness/scripts/utils/goal-canonical-lifecycle.ts`, `harness/scripts/utils/goal-progress.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: Equivalent modes have equal complete projections

- **WHEN** attended and detached runs receive equivalent executor outcomes across the same resolved chain
- **THEN** their canonical lifecycle projections SHALL be item-for-item equal after normalization

#### Scenario: Handoff remains canonical while transport stays private

- **WHEN** a run hands off between session and process owners
- **THEN** the projection SHALL preserve direction and outcome exactly once while excluding mailbox polling and lease telemetry

### Requirement: Runtime-owned facts precede every agent and gate

Before invoking an agent or a phase gate, `GoalPhaseRuntime` SHALL prepare and freeze every applicable runtime-owned fact, including goal/baseline context, fidelity and visual pins, goal/gate env scrub, receipt identity, testing device session/frozen configuration, and invocation write-boundary attribution. Missing or corrupt runtime-owned facts MUST fail as framework/runtime corruption and MUST NOT be delegated to the content agent for repair.

Enforcement: `harness/scripts/utils/goal-phase-runtime.ts`, `harness/scripts/utils/phase-state.ts`, `harness/scripts/utils/goal-failure-classifier.ts`, `harness/harness-runner.ts`

#### Scenario: Missing runtime evidence does not burn a content attempt

- **WHEN** an applicable runtime-owned precondition cannot be prepared before executor invocation
- **THEN** the runtime SHALL halt with non-agent actionability and SHALL NOT call the executor

### Requirement: Legacy private phase loops are absent at completion

After runtime migration, production SHALL contain exactly one phase advancement implementation. The previous `goal-runner` detached loop and attended driver's assess/advance/gate loop MUST be physically removed; compatibility wrappers MAY only delegate to `GoalPhaseRuntime`. A release or archive MUST fail structural verification while a second loop or executor-direct gate call remains.

Enforcement: `harness/tests/unit/goal-runtime-structure.unit.test.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/goal-in-session-driver.ts`

#### Scenario: Structure scan finds one loop

- **WHEN** the completed source tree is checked
- **THEN** it SHALL find the shared runtime as the sole phase loop, zero private driver loops and zero executor-to-gate call edges
