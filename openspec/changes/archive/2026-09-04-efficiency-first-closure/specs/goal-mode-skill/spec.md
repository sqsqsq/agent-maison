# goal-mode-skill Spec Delta

## ADDED Requirements

### Requirement: The native goal path runs one phase executor per phase and never hand-rolls waiting

When a task is driven by the host's native goal persistence (Claude `/goal`), the main session SHALL act as a thin driver: it SHALL delegate each feature phase to exactly one `phase-executor` subagent with the minimal inputs (requirement path, acceptance / ui-spec / reference image paths, current changed files, current blockers, accepted gaps, previous phase summary path, the phase skill path), SHALL NOT pass conversation history, and SHALL NOT execute two phases consecutively in the same context. The executor SHALL run the phase harness, invoke the verifier when required and call finalize. Verifier and subagent results SHALL be awaited synchronously or left for unrelated work; `sleep`, polling loops and background waiters SHALL NOT be used, and verifier inputs SHALL NOT be modified while a verifier runs.

Enforcement: `skills/project/goal-mode/SKILL.md`, `skills/reference/agents-entry-detail.md`, `agents/claude/templates/goal-condition.md`, `agents/claude/templates/agents/phase-executor.md`

#### Scenario: Six phases, six fresh contexts

- **WHEN** a native goal spans spec through testing
- **THEN** each phase runs in its own executor and the main context only accumulates six summary paths and terminal blocks

## MODIFIED Requirements

### Requirement: Attended goal mode is a thin executor over the shared runtime

Two attended entries SHALL exist and SHALL be mutually exclusive for one task: Maison `/goal-mode`, where `GoalPhaseRuntime` owns every lifecycle decision through the `phase_execute_request` transport, and the native goal path, where the host session is the thin driver over per-phase executors. A task started on one entry SHALL NOT be advanced by the other. Under `/goal-mode` the request SHALL still carry the immutable fenced `PhaseExecutionContext` and retries, closure and owner fences remain runtime-owned.

Enforcement: `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/utils/goal-phase-executor.ts`, `skills/project/goal-mode/SKILL.md`, `skills/reference/goal-mode-operations.md`

#### Scenario: Entries do not co-drive

- **WHEN** a feature has an active `/goal-mode` run
- **THEN** the native goal path SHALL refuse to advance the same feature and point to the running run
