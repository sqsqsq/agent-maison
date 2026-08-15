## ADDED Requirements

### Requirement: Receipt identity fields are runner-owned

The phase-completion receipt scaffold SHALL be generated with `feature`, `phase` and — under goal orchestration — `claimed_attempt_id` pre-filled from the runner/harness attempt identity (`i<totalTurns>`); agents MUST NOT be required to copy machine-known identity values from the environment or derive them from progress files. Before each closure-only invocation the runner SHALL regenerate an unfilled scaffold carrying the upcoming attempt identity, invalidating the previous attempt's receipt so a stale complete receipt cannot satisfy completion observation for the new attempt. The strict goal-mode equality between `claimed_attempt_id` and the runner attempt identity SHALL remain unchanged (no `"3"`/`"i3"` aliasing); non-goal manual flows keep the empty-field and timestamp-freshness behavior.

Enforcement: `harness/scripts/utils/receipt-scaffold.ts`, `harness/harness-runner.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: a closure attempt no longer dies on a copied identity

- **WHEN** closure-only attempt `i3` starts after attempt `i2` failed receipt validation
- **THEN** the scaffold on disk already carries `claimed_attempt_id: "i3"` and the agent only fills self-attestation fields; the run reaches normal closure without `closure_wall_repeated`

#### Scenario: a stale complete receipt does not complete a new attempt

- **WHEN** a further closure attempt `i4` begins while a filled receipt claiming `i3` exists
- **THEN** the runner regenerates the unfilled scaffold with `claimed_attempt_id: "i4"` and completion observation does not treat the `i3` receipt as current
