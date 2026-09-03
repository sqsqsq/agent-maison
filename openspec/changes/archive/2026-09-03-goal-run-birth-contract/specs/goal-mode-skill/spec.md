## MODIFIED Requirements

### Requirement: In-session execution writes canonical goal evidence

The attended entry SHALL create every fresh run through the shared fresh-only `createGoalRun` operation and the in-session driver SHALL attach only to a manifest with exactly one valid `run_created` event. It SHALL use the same manifest, events, progress, phase outcome, receipt, and run ID schemas as `harness/scripts/goal-runner.ts`, fenced by `run-control@1`. Before owner CAS, attach SHALL reject `CREATION_INCOMPLETE`, reject a caller adapter that differs from `manifest.adapter`, and route only from the persisted manifest; it MUST NOT fill a missing birth event, reparse workflow/chain, or resolve HEAD. Every emitted `phase_execute_request` SHALL include the authoritative `{run_id, phase, attempt_id, owner_id, owner_epoch}` captured from the current fence. The host SHALL pass that context unchanged to the spec initializer, phase harness, and `harness-runner --sync-closure`; the session driver SHALL create the attempt-bound receipt skeleton before yielding the request. Normal non-orphan session/process conversion SHALL use mailbox handoff; an orphaned session MAY be taken over only through explicit user-authorized `--force-resume` epoch takeover.

Enforcement: `harness/scripts/goal-mode-entry.ts`, `harness/scripts/goal-in-session-driver.ts`, `harness/scripts/utils/goal-run-creation.ts`, `skills/project/goal-mode/SKILL.md`, `skills/reference/goal-mode-operations.md`

#### Scenario: In-session run hands off to detached runner

- **WHEN** the handoff completes
- **THEN** the detached runner SHALL resume the same run ID, `run_created` birth facts and authoritative event sequence without ledger conversion or baseline refresh

#### Scenario: Bridge request carries a fenced closure identity

- **WHEN** the attended driver requests execution of any phase
- **THEN** its `phase_execute_request` SHALL include the current run, attempt, owner ID, and owner epoch; the host MUST NOT discover a run by scanning the feature directory or inherit context from a sibling shell process

#### Scenario: Wrong attach adapter fails before ownership

- **WHEN** the caller adapter differs from the persisted manifest adapter
- **THEN** attach SHALL fail before owner CAS with no owner mutation or event, and the session driver SHALL never observe the caller copy

#### Scenario: Incomplete creation cannot be repaired by attach

- **WHEN** attended attach finds a manifest without its one valid `run_created`
- **THEN** it MUST fail `CREATION_INCOMPLETE` before owner CAS and MUST NOT append a replacement event
