# goal-driver-handoff Specification

## Purpose
TBD - created by archiving change goal-reconcile-loop. Update Purpose after archive.
## Requirements
### Requirement: Goal runs persist a monotonic driver epoch
Each authoritative goal run SHALL persist `run-control@1` under its existing run directory. `current_epoch` MUST increase by atomic compare-and-swap and MUST NOT reset when feature/run lock projections are released. Enforcement SHALL live in `harness/scripts/utils/goal-run-control.ts` and integrate with `harness/scripts/utils/goal-run-lock.ts`.

#### Scenario: Owner releases its lock projection
- **WHEN** a driver quiesces or terminates and releases feature/run locks
- **THEN** `run-control@1.current_epoch` SHALL remain unchanged and persistent

#### Scenario: Two takeovers race
- **WHEN** two requesters attempt takeover from the same expected epoch
- **THEN** exactly one CAS SHALL succeed and the loser MUST remain non-owner

### Requirement: Process and session owners share fencing but retain distinct liveness
Every process or session owner SHALL carry the current run epoch. Process ownership SHALL retain PID/hostname liveness from `goal-run-lock.ts`; session ownership SHALL use a session lease. Lease expiry SHALL produce `orphaned_session` and MUST NOT automatically grant ownership.

#### Scenario: Session lease expires
- **WHEN** a session owner stops renewing its lease
- **THEN** the run SHALL become orphaned and no new driver SHALL execute until explicit handoff or user-authorized takeover

### Requirement: Mutating driver boundaries reject stale owners
Assess invocation, phase execution, harness/finalizer calls, event append, progress writes, and terminal publication MUST verify `(run_id, owner_id, epoch)` against `run-control@1`.

#### Scenario: Old session resumes after takeover
- **WHEN** a previous owner attempts a write after a newer epoch committed
- **THEN** the write MUST be rejected before new phase work or authoritative state mutation

### Requirement: Handoff requests use an atomic run-bound mailbox
The handoff mailbox SHALL atomically store requests bound to `request_id`, `run_id`, `from_epoch`, and `target_owner_kind`. Only the current owner SHALL convert a valid request into authoritative handoff events. Enforcement SHALL live under `harness/scripts/utils/goal-handoff.ts`.

#### Scenario: Request has a stale epoch
- **WHEN** the current owner polls a request whose `from_epoch` differs from its epoch
- **THEN** the request MUST NOT quiesce the owner or transfer execution

#### Scenario: Request is duplicated
- **WHEN** the same request ID is delivered more than once
- **THEN** handoff processing SHALL be idempotent and MUST NOT increment the epoch twice

### Requirement: Ownership transfers only at a safe phase boundary
The current owner SHALL append `handoff_requested`, quiesce after active phase work, and release projections before a new owner CAS-increments the epoch. The new owner MUST append `handoff_accepted` before executing another phase.

#### Scenario: Transfer crashes after release
- **WHEN** the old owner releases but the new owner does not accept
- **THEN** the run SHALL remain quiescent and resumable with no concurrent executor

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

### Requirement: Rejected handoffs retain canonical direction

Every production `handoff_rejected` event SHALL carry the requested `target_owner_kind` together with the existing request and owner facts needed to derive direction. Canonical lifecycle projection MUST emit exactly one failed `owner_handoff {from,to,outcome=failed}` record for that production event rather than dropping it. No second handoff state or correlation table SHALL be introduced.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-canonical-lifecycle.ts`, `harness/scripts/utils/goal-handoff.ts`

#### Scenario: Stale or invalid handoff is rejected

- **WHEN** the current owner rejects a mailbox handoff request to the other owner kind
- **THEN** the authoritative event records that target and canonical projection retains the failed handoff direction
