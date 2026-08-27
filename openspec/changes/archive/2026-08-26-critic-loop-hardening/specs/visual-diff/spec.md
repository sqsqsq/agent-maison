## ADDED Requirements

### Requirement: Layout findings are structured with stable identity

Every T8 layout finding SHALL carry a stable `finding_id` computed at emit time from `hash(screen_id|signal|sorted(elements)|bbox_bucket)` (elements finalized before emit — no backfill; bbox bucketed on a 0.1 grid so pixel jitter within a bucket keeps the id stable across rounds) and a structured `elements[]` list (declared element ids, replacing prose-embedded references). B-class findings SHALL carry a bbox where the involved nodes are locatable. Defects SHALL support optional `source: {producer: 'T8', finding_id, signal}` (transcription provenance) and `must_fix_refs: number[]` (indexes into the screen's must_fix array — per-item structured anchors). The check SHALL expose a structured in-process payload (fingerprints, T8 findings, base fail hit ids, round evaluation) to the runner; the payload SHALL NOT be injected into summary.json's blocker schema (additionalProperties: false) — persistence goes through the rounds ledger sidecar and the explicit `visual_round` summary field.

Enforcement: `profiles/hmos-app/harness/{layout-oracle-check,visual-diff-check}.ts`

#### Scenario: finding id stable across rounds

- **WHEN** the same forbidden-overlap violation is found in two consecutive rounds with sub-bucket bbox jitter
- **THEN** both rounds SHALL emit the same finding_id (element order and jitter immaterial)

### Requirement: Findings and must_fix items must be transcribed with structured anchors

Gate `visual_diff_finding_transcription`: a T8 hard finding with no matching defect — matched primarily by `defect.source.finding_id`, secondarily by elements intersection with signal-class consistency, and only as legacy fallback by bbox IoU ≥ 0.5 (plain intersection is too permissive — one big bbox must not clear every finding) — SHALL be a pixel_1to1 BLOCKER carrying a copy-paste defect template (including source). Unmatched warn-tier findings SHALL WARN (T8 warn hits already block candidate-pass; the WARN is a transcription reminder, not extra blocking). Under pixel_1to1, every must_fix item on a P0 finalized screen SHALL be referenced by at least one defect's `must_fix_refs`; unanchored items SHALL be a BLOCKER (closes the "equal counts but mismatched filler defects" gap left by the rev10 count gate, which stays as the fuse-eligibility necessary condition). Unstable-screen findings (capability degradation id) SHALL be exempt from transcription.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: filler defects do not satisfy anchoring

- **WHEN** a P0 screen has two must_fix items and two defects none of which reference the items via must_fix_refs
- **THEN** the gate SHALL FAIL listing the unanchored items

#### Scenario: hard finding transcribed via finding_id passes

- **WHEN** a defect carries source.finding_id equal to the T8 hard finding's id
- **THEN** the transcription gate SHALL NOT fire for that finding

### Requirement: Candidate-pass requires a receipt regardless of attestation presence

When the candidate path is active under pixel_1to1 (all P0 screens finalized pass with zero must_fix), a structurally valid critic receipt SHALL be required even when no `region_attest` exists (closes the minor-defect dodge: planting a minor defect per screen to skip attestation and thereby the receipt). Receipt screenshot-coverage validation SHALL extend from attested screens to all candidate P0 finalized screens — the same minimum input set the goal-side producer certifies.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: minor-defect dodge is closed

- **WHEN** all P0 screens are finalized pass with only minor defects, no region_attest, and no receipt exists
- **THEN** the gate SHALL FAIL requiring a structurally valid receipt

### Requirement: Visual rounds ledger with fingerprint-level no-progress fuse

A telemetry sidecar `device-testing/reports/visual-rounds.ledger.jsonl` SHALL record evaluation rounds: the check reads and decides, the harness runner appends after checks. Round identity SHALL separate state from attempt with a stable base-state hash and `(loop_id, attempt_id, base_state_hash)` key. Replayed keys SHALL reuse their persisted decision. A new eligible round SHALL compare only with the last eligible fingerprintable round for the same loop. Equal non-empty actionable defect/finding fingerprints SHALL fuse; capability degradation, evidence-repair, aggregate hits, and non-actionable/uncertain observations SHALL not pollute the comparison. The decisive actionable residual and unresolved finding identities SHALL enter the state hash. Defect fingerprints SHALL retain producer/finding identity when present. Different build fingerprint attributes `ineffective_fix`; the same build attributes `no_fix_attempt`. Ledger corruption SHALL warn and skip per-line, never become empty history. Empty/ineligible rounds SHALL not compare. Same-run manual resume or signer state SHALL not reset or release a fused identity.

Enforcement: `harness/scripts/utils/visual-rounds-ledger.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/harness-runner.ts`

#### Scenario: duplicate replays a fused decision

- **WHEN** the agent's in-session harness run detects the fuse and appends the row, and the outer gate then evaluates the identical round_key
- **THEN** the evaluation SHALL be disposition=duplicate with decision.fused=true so the gate halts as no_progress_fuse

#### Scenario: cross-attempt unchanged state fuses as no_fix_attempt

- **WHEN** attempt N+1 re-runs with build, screens and fingerprints identical to attempt N's appended row
- **THEN** a new row SHALL be appended and the fuse SHALL fire with attribution no_fix_attempt

#### Scenario: capability degradation is not stolen by the fuse

- **WHEN** all actionable defects are resolved and the only open item is a machine-proven missing visual capability
- **THEN** the fuse SHALL NOT fire and the result SHALL use the existing capability-missing projection

### Requirement: Verified receipts require a runner attestation

`input_provenance: verified` SHALL be honored only when the receipt carries a valid `runner_attestation {goal_run_id, evidence_log_path, evidence_log_hash}` whose evidence log exists on disk and whose recomputed hash matches (integrity binding, not a cryptographic signature — both files live in the agent-writable workspace and the defense is runtime consistency). Additionally (review-fix, two rounds): the evidence file SHALL be named agent-events.jsonl and its resolved path SHALL be exactly equal to the canonical location `<featureDir>/goal-runs/<run_id>/phases/testing/agent-events.jsonl` (component-exact resolution, not substring containment — a run_id fragment in a parent directory or sibling name proves nothing; receipts are only produced in the testing phase so the expected path is uniquely derivable); verified SHALL only be honored in the goal gate context (both MAISON_GOAL_RUN_ID and MAISON_GOAL_ATTEMPT present — honoring a historical goal receipt interactively would produce candidate-pass(verified) outside this change's scope), with the attestation goal_run_id equal to the current run and critic_run_id exactly equal to `<run>-<attempt>`; and the checker SHALL **re-parse the evidence log with the adapter's registered structured parser and verify every image_inputs entry has a matching read event** — "some file's hash is unchanged" is not "this critic read these images". Adapters without a registered parser cannot be re-audited and SHALL NOT be honored as verified. Boundary: output_hash is producer-side evidence and is not recomputed by the checker outside the gate context. A verified claim without a valid attestation SHALL be downgraded to unverified with a WARN (hand-written verified is impersonation); the stricter verified-tier validations still run. The candidate-pass tier SHALL be `candidate-pass(verified)` only when the attestation validates.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: forged verified receipt downgraded

- **WHEN** a receipt claims verified without runner_attestation, or its evidence log hash mismatches
- **THEN** the gate SHALL treat it as unverified and WARN, never producing candidate-pass(verified)

### Requirement: Quiescence sampling replaces single-shot capture under pixel_1to1

A shared quiescence sampler SHALL implement `shot₁ → dump₁ → dump₂ → shot₂` with app-cropped image-hash and normalized-layout-signature stability. Unstable groups SHALL be retried within the existing bound and then recorded with `unstable_reason` and per-attempt hashes in `_quiescence/`. The official pixel execution chain SHALL use the sampler; lower tiers retain their existing capture policy. Sampler execution failure is a capture failure, while retry exhaustion records unstable evidence. T8 findings on unstable screens SHALL use the existing capability-degradation signal outside the candidate-blocking set and SHALL project advisory or capability-missing according to axis policy, without a human batch-confirmation path.

Enforcement: `profiles/hmos-app/harness/{quiescence-sampling,visual-diff-capture,visual-diff-check}.ts`, `harness/scripts/check-testing.ts`

#### Scenario: persistent instability is recorded not guessed

- **WHEN** every sampling group differs in the app-cropped image hash (carousel screen)
- **THEN** capture SHALL mark the screen unstable with image_drift, keep the final artifacts, and NOT count it as a capture failure

#### Scenario: unstable screen downgrades hard findings

- **WHEN** a screen marked unstable has a forbidden-overlap violation in its dump
- **THEN** the gate SHALL emit visual_diff_layout_invariants_unstable as WARN instead of a hard BLOCKER and the transcription audit SHALL not require it

### Requirement: Calibration feedback is machine evidence and never a visual verdict

Calibration inputs SHALL be produced from versioned machine fixtures and device measurements bound to screenshot/build/oracle identities. They MAY inform a later evidence-backed gate-tier change but SHALL NOT mutate `visual-diff.json`, close a quality axis, or act as a per-run verdict. Human feedback belongs to a correction/successor run and MUST NOT be persisted through `visual-confirm` as gate state.

Enforcement: `profiles/hmos-app/harness/layout-oracle-calibrate.ts`, `harness/scripts/layout-oracle-calibrate.ts`

#### Scenario: calibration data cannot overrule a current finding

- **WHEN** calibration records a historical false positive for a detector family
- **THEN** the current deterministic finding SHALL remain governed by the frozen current policy until a separate policy change is validated

### Requirement: Layout oracle calibration is a one-command dual-artifact report

`layout-oracle-calibrate` SHALL be an explicitly-invoked CLI producing `calibration.json` plus a markdown projection from machine-measured overlay, locator, bounds, appRoot, crop-material, ambiguity, and device double-sample facts. Unmeasured items SHALL be labeled unavailable rather than `needs_human`. The CLI SHALL NOT change gate tiers or write phase judgment artifacts.

Enforcement: `profiles/hmos-app/harness/layout-oracle-calibrate.ts`, `harness/scripts/layout-oracle-calibrate.ts`

#### Scenario: offline mode is honest about unmeasured items

- **WHEN** the CLI runs without --device
- **THEN** the double-sample stability item SHALL be empty with a note that device measurement is required before enabling quiescence downgrade
