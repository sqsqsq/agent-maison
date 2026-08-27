## ADDED Requirements

### Requirement: Handoff is a canonical transition inside the shared runtime

Every session→process or process→session handoff SHALL occur through the existing run-bound mailbox and owner/epoch CAS at a safe `GoalPhaseRuntime` boundary. The releasing owner SHALL stop lifecycle mutation before release; the acquiring owner SHALL replay the same run through the shared runtime before continuing. The runtime SHALL project exactly one `owner_handoff {from,to,outcome}` semantic record for the transfer without creating a second owner, ledger or run state.

Enforcement: `harness/scripts/utils/goal-phase-runtime.ts`, `harness/scripts/utils/goal-driver-handoff.ts`, `harness/scripts/utils/goal-run-control.ts`

#### Scenario: Session hands off to process

- **WHEN** an attended owner requests detached continuation at a phase boundary
- **THEN** the process owner SHALL acquire a higher epoch, replay the same run and continue through `GoalPhaseRuntime`, and canonical projection SHALL contain `owner_handoff {from: session, to: process, outcome: success}`

#### Scenario: Process hands off to session

- **WHEN** a detached owner accepts a valid return-to-session mailbox request at a phase boundary
- **THEN** the session owner SHALL acquire the fenced epoch and continue the same runtime, with the reverse canonical handoff direction preserved

#### Scenario: Failed transfer does not create dual progression

- **WHEN** acquisition fails or the mailbox epoch is stale after release
- **THEN** the handoff outcome SHALL be recorded without either owner independently advancing a phase
