## ADDED Requirements

### Requirement: Attended goal mode is a thin executor over the shared runtime

Attended goal mode SHALL use `GoalPhaseRuntime` for all lifecycle decisions and SHALL implement only the existing host `phase_execute_request`/response transport as an `AttendedGoalPhaseExecutor`. The request SHALL carry the immutable fenced `PhaseExecutionContext`; the host callback MUST return only invocation output and MUST NOT assess, invoke harness gates, advance phases, close receipts or emit canonical verdict/backtrack events independently.

Enforcement: `harness/scripts/goal-in-session-driver.ts`, `harness/scripts/utils/goal-phase-executor.ts`, `skills/project/goal-mode/SKILL.md`, `skills/reference/goal-mode-operations.md`

#### Scenario: Attended retry is runtime-owned

- **WHEN** an attended executor returns an agent result whose gate verdict requires retry
- **THEN** `GoalPhaseRuntime` SHALL decide and record the retry; the in-session host SHALL only receive the next fenced execution request

#### Scenario: Attended close uses the common finalizer

- **WHEN** an attended phase is ready to close
- **THEN** the shared runtime SHALL run the same harness and closure finalizer used by detached execution
