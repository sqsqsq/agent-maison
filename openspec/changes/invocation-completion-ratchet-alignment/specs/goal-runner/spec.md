## MODIFIED Requirements

### Requirement: Timeout budget ratchets on granted high-water and observed completions

The per-attempt agent timeout SHALL be `max(base, granted_highwater, ceil(1.2 × max_completed_duration))`, where `granted_highwater` is the highest effective timeout ever granted to the phase and a completed duration is an invocation accepted by the shared completion predicate implementing the in-invocation terminal contract: waiting, failed, skipped and explicit failure facts take precedence; otherwise natural exit 0 or an observed completion terminal qualifies. A nonzero cleanup exit or cleanup attempt alone SHALL NOT negate observed completion. Both values SHALL be rebuilt from events on resume. Explicit host-configured phase timeouts remain a hard cap the ratchet cannot exceed, but when observed completions approach or exceed the explicit value the report SHALL state that the configured budget appears too small. `timeout_escalated` events SHALL record their source (`consecutive_timeouts` | `granted_highwater` | `observed_ratchet`). All budgets remain clamped by wall clock and the finalize reserve.

Enforcement: `harness/scripts/utils/goal-timeout.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: the incident's i4 no longer falls back to the base budget

- **WHEN** attempts time out twice, escalation grants 67.5 minutes, and the third attempt completes at 49.6 minutes with exit 0 but fails content gates
- **THEN** the next attempt's budget SHALL be 67.5 minutes (granted high-water), not the 45-minute base

#### Scenario: observed completion survives cleanup and resume

- **WHEN** a phase invocation reports observed completion without a waiting, skipped or failure fact, then cleanup exits nonzero
- **THEN** its duration SHALL qualify for the same observed ratchet as a passed session report, retaining its original exit code and producing the same value after resume

#### Scenario: exit zero does not qualify an incomplete invocation

- **WHEN** an invocation has waiting status, is skipped or has an explicit failure fact, even if its exit code is zero
- **THEN** its duration SHALL NOT become a completed sample, and phase caps and remaining wall clock SHALL remain unchanged
