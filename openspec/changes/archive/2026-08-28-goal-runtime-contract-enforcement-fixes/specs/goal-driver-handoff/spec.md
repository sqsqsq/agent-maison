## ADDED Requirements

### Requirement: Rejected handoffs retain canonical direction

Every production `handoff_rejected` event SHALL carry the requested `target_owner_kind` together with the existing request and owner facts needed to derive direction. Canonical lifecycle projection MUST emit exactly one failed `owner_handoff {from,to,outcome=failed}` record for that production event rather than dropping it. No second handoff state or correlation table SHALL be introduced.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-canonical-lifecycle.ts`, `harness/scripts/utils/goal-handoff.ts`

#### Scenario: Stale or invalid handoff is rejected

- **WHEN** the current owner rejects a mailbox handoff request to the other owner kind
- **THEN** the authoritative event records that target and canonical projection retains the failed handoff direction
