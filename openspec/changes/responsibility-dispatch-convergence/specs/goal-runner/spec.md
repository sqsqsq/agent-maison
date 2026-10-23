## MODIFIED Requirements

### Requirement: Receipt identity fields are runner-owned

The phase-completion receipt scaffold SHALL be generated with `feature`, `phase` and — under goal orchestration — `claimed_attempt_id` pre-filled from the runner/harness attempt identity (`i<totalTurns>`); agents MUST NOT be required to copy machine-known identity values from the environment or derive them from progress files. Under goal orchestration the runner SHALL be the **single scaffold writer**: before **every** real agent invocation (content and closure attempts alike; dry-run excluded) it SHALL force-regenerate the unfilled scaffold carrying the upcoming attempt identity, invalidating the previous attempt's receipt so a stale complete receipt cannot satisfy completion observation for the new attempt — and so the agent sees the scaffold from the content attempt onward, allowing closure to complete within the same attempt (testing no longer necessarily burns a second on-device gate pass). A scaffold write failure SHALL halt before starting the agent (`receipt_scaffold_unwritable`, external/probe semantics) with the real path and I/O error — it MUST NOT be swallowed, because a surviving stale-identity receipt deterministically reproduces the `receipt_attempt_identity` closure wall. The harness-side PASS-gated skeleton generation SHALL stand down under goal orchestration (goal attempt env present → no write) and remains only for non-goal manual flows. Closure-only state SHALL be derived from the latest authoritative phase verdict (`PASS` + `advance_blocked` + `action=retry`): phases such as coding/ut with no frozen deliverable surface still get the current invocation identity and closure-only prompt. A later halt/invalidation or non-closure verdict clears that state. The strict goal-mode equality between `claimed_attempt_id` and the runner attempt identity SHALL remain unchanged (no `"3"`/`"i3"` aliasing); non-goal manual flows keep the empty-field and timestamp-freshness behavior.

Enforcement: `harness/scripts/utils/receipt-scaffold.ts`, `harness/harness-runner.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: a closure attempt no longer dies on a copied identity

- **WHEN** closure-only attempt `i3` starts after attempt `i2` failed receipt validation
- **THEN** the scaffold on disk already carries `claimed_attempt_id: "i3"` and the agent only fills self-attestation fields; the run reaches normal closure without `closure_wall_repeated`

#### Scenario: a stale complete receipt does not complete a new attempt

- **WHEN** a further closure attempt `i4` begins while a filled receipt claiming `i3` exists
- **THEN** the runner regenerates the unfilled scaffold with `claimed_attempt_id: "i4"` and completion observation does not treat the `i3` receipt as current

#### Scenario: a phase without a frozen surface still gets a closure identity

- **WHEN** coding attempt `i4` reaches PASS but closure remains open
- **THEN** attempt `i5` is still classified closure-only from the `i4` verdict, its prompt says to perform closure only, and the runner force-regenerates the scaffold with `claimed_attempt_id: "i5"`

#### Scenario: an unwritable scaffold stops the attempt instead of reviving the identity wall

- **WHEN** the runner cannot write the receipt scaffold before an invocation (read-only directory, missing template, or file lock)
- **THEN** the run halts `receipt_scaffold_unwritable` reporting the real path and error, the agent is never started, and no attempt budget is burned

### Requirement: Earlier-phase gaps have a total executable disposition

For every upstream phase in the resolved chain, the runner SHALL map `missing`, trusted `failed`, `legacy_unverified`, `unclosed`, `pruned`/assurance-insufficient, and `stale` gaps to exactly one executable disposition using existing facts. Missing/failed/legacy-unverified and stable stale bytes return to owner revalidation. A provable partial finalization is completed idempotently; otherwise fresh valid unclosed evidence may use `complete_closure`, while stale/invalid unclosed evidence returns to the owner. Pruned evidence is restored/re-signed only when current in-repository trusted artifacts prove it; otherwise it returns to owner or defers for a genuine capability gap. Runner-owned equivalent rewrites may refresh narrowly. Current downstream writes use the phase-write-violation recovery contract. Known gaps MUST NOT fall through to catch-all `framework_bug` or display-only actions.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/upstream-closure.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: every earlier owner/current pair is executable

- **WHEN** any earlier phase in a full or valid custom chain is missing, failed, legacy-unverified, unclosed, pruned, or stale
- **THEN** the disposition SHALL be backtrack, proven closure completion/refresh, capability defer, or a precise existing terminal/fuse result, never a dead recommendation

### Requirement: Goal scope gates ignore live diff-base overrides

Coding scope gates SHALL ignore `HARNESS_DIFF_BASE_REF` whenever `hasGoalExecutionSignal` is true. The live variable MAY retain its legacy non-goal diagnostic behavior, but it MUST NOT select the baseline of either an agent-side or formal goal gate.

Enforcement: `harness/scripts/check-coding.ts`, `harness/scripts/utils/phase-state.ts`

#### Scenario: Goal agent resets the scrubbed variable
- **WHEN** a goal agent sets `HARNESS_DIFF_BASE_REF` before self-invoking the harness
- **THEN** the scope gate ignores the value and uses the frozen goal baseline path

#### Scenario: Non-goal diagnostic run supplies a base
- **WHEN** a direct non-goal harness invocation supplies `HARNESS_DIFF_BASE_REF`
- **THEN** the existing explicit-base diagnostic behavior remains available
