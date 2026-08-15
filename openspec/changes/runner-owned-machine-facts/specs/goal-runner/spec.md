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

### Requirement: Spec closure-only prompts mandate read-only visual re-evidencing

For spec closure-only attempts the runner prompt SHALL state that FROZEN applies to artifacts, not to read-only evidencing, and SHALL list every authoritative reference image (derived from the spec visual handoff) with an instruction to read each one during the current invocation — because the `vl_multimodal` final sign-off is invocation-bound and MUST NOT be relaxed or satisfied by reusing a previous invocation's refs receipt. Modifying artifacts remains forbidden.

Enforcement: `harness/scripts/goal-runner.ts`（`buildClosureVisualEvidenceBlock`）, `harness/scripts/check-spec.ts`（gate 判定不变）

#### Scenario: a closure-only attempt can pass the invocation-bound visual sign-off

- **WHEN** a spec closure-only attempt starts with 10 authoritative reference images and the agent follows the prompt's read-only evidencing list
- **THEN** the refs receipt for this invocation is complete and `ui_spec_fidelity_gate` no longer fails structurally on the closure attempt

### Requirement: Run end-state classification uses the executed slice; the assumptions ledger never gates it

When a goal run reaches its configured end phase, end-state classification SHALL evaluate clean-pass issues over the **actually executed chain slice**, not the full workflow chain — downstream phases that were never part of this run MUST NOT be classified as `needs_fix` (a spec-only run with human-signature items pending SHALL end `AWAITING_HUMAN_REVIEW`, not `PARTIAL`). Feature-completion generation keeps evaluating the full chain (different question: whole-feature completion). The headless-assumptions ledger's `must_review` entries SHALL NOT feed run end-state or clean-pass gating in any branch — they remain report-only (goal-report auto-decision summary); genuine gates (visual axis, flow-contract, waivers, fidelity caps) keep their `needs_human` capping.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: a spec-only run is not misprojected as PARTIAL

- **WHEN** a `--start spec --end spec` run closes spec cleanly while plan/coding/review/ut/testing have never run
- **THEN** classification over `['spec']` yields no `needs_fix` and the run ends `AWAITING_HUMAN_REVIEW` when only human-signature items remain

#### Scenario: historical must_review entries do not cap the end state

- **WHEN** the cross-run ledger accumulates dozens of `must_review` entries from prior runs
- **THEN** they appear in the goal report only; clean-pass classification emits no `no_pending_must_review` issue and completion generation is not blocked
