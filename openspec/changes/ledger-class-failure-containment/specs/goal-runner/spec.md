# goal-runner Spec Delta

## ADDED Requirements

### Requirement: Ledger-class failures preserve current responsibility without phase backtracks

Ledger, shape, binding or stale-subject failures SHALL retain their original owner, files and diagnosis in the common current disposition. They MUST NOT create a cold phase-author queue or widen product write authority. Concrete product-truth defects SHALL remain actionable beside evidence gaps. Required unknown SHALL identify the actual producer/object and recovery condition without claiming either completion or no progress. Completed, comparable acceptance assessments SHALL use the existing shared progress evaluation; repeated signatures, missing targets, timestamps or invocation counts alone MUST NOT terminate work. Historical reasons remain readable but new runs MUST NOT emit phase retry-budget exits.

Enforcement: repair-candidates.ts, verify-feature-completion.ts, check-disposition.ts and GoalPhaseRuntime.

#### Scenario: A ledger gap coexists with a product defect
- **WHEN** a current check reports an input/binding gap and a verified native assertion defect
- **THEN** the common view retains both, delivers actionable product work to its authorized unit author and preserves the actual producer verification condition without invalidating a phase queue

#### Scenario: The relevant target remains unknown
- **WHEN** no completed comparable evidence establishes a resolvable repair object
- **THEN** the coordinator naturally waits with the concrete missing condition, does not invent no-progress, and unchanged re-entry performs no new calls

### Requirement: Attended-only context arguments in a non-session run report a mode mismatch

`validateAttendedGoalContext` SHALL keep its identity criteria unchanged — a non-session owner is still refused and no context is returned — but SHALL report the refusal as a mode mismatch naming the current mode and the attended-only arguments that must not be passed, rather than as an expired or invalid session lease. A genuine session whose lease expired SHALL keep the existing lease wording. The published goal-mode guidance SHALL state, for each mode, the harness call that can be executed directly: attended appends the issued context arguments, detached inherits context from the manifest/events and injected environment and passes none of them.

Enforcement: `harness/scripts/utils/attended-goal-context.ts`

#### Scenario: a detached run is handed attended arguments

- **WHEN** a phase harness invoked under a detached (process-owned) run passes the attended-only `--goal-*` context arguments
- **THEN** the call SHALL be refused with a mode-mismatch message naming the current mode and those arguments, and SHALL NOT be explained as a lease timing problem
