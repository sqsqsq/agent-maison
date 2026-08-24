## MODIFIED Requirements

### Requirement: Supervisor respects run-control owner responsibility

The feature supervisor SHALL load and validate the selected run's `run-control@1` before entering the existing beacon × `run_disposition` decision core. Missing or corrupt control MUST fail closed. A handoff mailbox is conclusively complete only when the exported canonical handoff validator accepts its full shape, its run identity matches the selected run, and its status is `accepted` or `rejected`; valid pending/consumed, malformed, unknown, or mismatched mailboxes MUST be no-ops. Every session-owner state (`active`, `quiescing`, `released`, `orphaned_session`) MUST return without spawning and without appending run events. Only a process owner SHALL enter the existing decision core, and run terminality MUST remain derived solely from `run_disposition`, never from owner state or open-invocation counts.

Enforcement: `harness/scripts/goal-supervise.ts`, `harness/scripts/utils/goal-supervisor.ts`, `harness/scripts/utils/goal-run-control.ts`

#### Scenario: Released attended run remains attachable

- **WHEN** a run has `owner.kind=session`, `owner.state=released`, and its latest disposition is not terminal
- **THEN** a supervisor one-shot SHALL neither spawn a process nor append an event, and the attended bridge MAY reattach through normal owner CAS

#### Scenario: Orphaned session requires an operator

- **WHEN** a run has `owner.kind=session` and `owner.state=orphaned_session`
- **THEN** the supervisor MUST NOT add `--force-resume`, spawn, or write an event; only a user-authorized takeover MAY proceed

#### Scenario: Released process wakes through the existing core

- **WHEN** a process-owned released run projects external `WAITING` and its same-source condition probe becomes ready
- **THEN** the supervisor SHALL reach the existing decision core and resume according to that core without deriving terminality from `released`

#### Scenario: Malformed complete-looking mailbox fails closed

- **WHEN** a process-owned run contains a mailbox such as `{"status":"accepted"}` or a canonical-looking record bound to another run
- **THEN** the supervisor SHALL neither enter the recovery core nor spawn or append an event
