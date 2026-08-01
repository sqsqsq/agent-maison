## ADDED Requirements

### Requirement: Goal runner exposes a versioned reconciliation observation
The runner SHALL derive `ReconcileObservation@1` from authoritative events and process state, including phase outcomes, blocker actionability, deterministic defects, used budgets, repeated-round fingerprints, invalidatable phases, timeouts, interrupts, and API disconnects. Enforcement SHALL be implemented in a dedicated utility extracted from `harness/scripts/goal-runner.ts`.

#### Scenario: Existing action behavior is captured before rewiring
- **WHEN** boundary extraction runs against locked runner fixtures
- **THEN** emitted event, verdict, and action sequences SHALL remain unchanged

### Requirement: Headless cross-phase progression consumes assess
After boundary extraction, `harness/scripts/goal-runner.ts` SHALL select cross-phase work only through `assess@1` and SHALL invoke the recommended phase only after driver authorization and fencing checks.

#### Scenario: Assess recommends testing backtrack to coding
- **WHEN** observation contains actionable deterministic defects and assess recommends coding
- **THEN** the runner SHALL execute the existing authorized invalidation/backtrack transaction before invoking coding

### Requirement: Process-level safety guards remain enforced by the driver
Timeout handling, budgets, backoff, child cleanup, trust ledgers, pass snapshots, device gates, source-write protection, monitor, usage capture, and detached survival SHALL remain enforced by existing goal-runner utilities and MUST NOT be weakened by assess rewiring.

#### Scenario: Phase process exceeds its timeout
- **WHEN** the active child exceeds the effective timeout
- **THEN** the runner SHALL apply the existing process timeout/cleanup policy and supply the resulting fact to reconciliation

### Requirement: Detached runner honors handoff mailbox at phase boundaries
The runner SHALL poll the run-bound handoff mailbox only at safe phase boundaries, validate the current epoch, quiesce cooperatively, and release projections without deleting `run-control@1`.

#### Scenario: Session requests return from unattended mode
- **WHEN** a valid session-target handoff request is present after a phase boundary
- **THEN** the detached runner SHALL quiesce and permit the session owner to acquire the next epoch before any further phase starts

### Requirement: Loop and process fuses remain distinct
The runner SHALL treat assess fuse as a phase-boundary reconciliation result, process guards as execution safety, and monitor budgets as read-only polling limits.

#### Scenario: Monitor polling budget ends
- **WHEN** a monitor reaches its polling fuse
- **THEN** it SHALL stop polling without terminating an otherwise active detached run
