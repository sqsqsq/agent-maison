## MODIFIED Requirements

### Requirement: In-session execution writes canonical goal evidence

The in-session driver SHALL use the same manifest, events, progress, phase outcome, receipt, and run ID schemas as `harness/scripts/goal-runner.ts`, fenced by `run-control@1`. Before owner CAS, attach SHALL reject a caller adapter that differs from `manifest.adapter`, and all downstream routing SHALL use the manifest value. Every emitted `phase_execute_request` SHALL include the authoritative `{run_id, phase, attempt_id, owner_id, owner_epoch}` captured from the current fence. The host SHALL pass that context unchanged to the spec initializer, phase harness, and `harness-runner --sync-closure`; the session driver SHALL create the attempt-bound receipt skeleton before yielding the request. Normal non-orphan session/process conversion SHALL use mailbox handoff; an orphaned session MAY be taken over only through explicit user-authorized `--force-resume` epoch takeover.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-in-session-driver.ts`, `skills/project/goal-mode/SKILL.md`, `skills/reference/goal-mode-operations.md`

#### Scenario: In-session run hands off to detached runner

- **WHEN** the handoff completes
- **THEN** the detached runner SHALL resume the same run ID and authoritative event sequence without ledger conversion

#### Scenario: Bridge request carries a fenced closure identity

- **WHEN** the attended driver requests execution of any phase
- **THEN** its `phase_execute_request` SHALL include the current run, attempt, owner ID, and owner epoch; the host MUST NOT discover a run by scanning the feature directory or inherit context from a sibling shell process

#### Scenario: Wrong attach adapter fails before ownership

- **WHEN** the caller adapter differs from the persisted manifest adapter
- **THEN** attach SHALL fail before owner CAS with no owner mutation or event, and the session driver SHALL never observe the caller copy
