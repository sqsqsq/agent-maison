# visual-diff Specification

## Purpose
TBD - created by archiving change visual-diff-defect-enumeration. Update Purpose after archive.
## Requirements
### Requirement: Visual-diff screens enumerate positive render defects

Each screen entry in `visual-diff.json` MAY carry a `defects[]` array enumerating「实现有但渲染错」defects, each `{class, bbox?, severity, note}` where `class ∈ {clipping, overlap, shape_mismatch, missing_render, other}` and `severity ∈ {blocker, major, minor}`. A `verdict=pass` screen carrying a blocker/major defect SHALL be treated like a low-score pass (pixel_1to1 → FAIL via fidelity ratchet, else WARN). The device-testing rubric SHALL require per-screen enumeration and `pass` requires `defects` empty.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: pass with blocking defect is rejected

- **WHEN** a screen has verdict=pass and a defect with severity blocker or major
- **THEN** the gate SHALL FAIL (pixel_1to1) or WARN with must_fix

#### Scenario: defect schema is validated

- **WHEN** a defect has an illegal class/severity, missing note, or a bbox that is not 4 numbers in [0,1]
- **THEN** validateVisualDiffJson SHALL record a schema error

### Requirement: defects enumeration is mandatory under pixel_1to1 (backward-compatible)

Under pixel_1to1, a finalized verdict (pass/warn/fail) with `defects === undefined` SHALL be a **BLOCKER/FAIL** (ratchet) requiring per-screen enumeration (add `defects[]`, may be `[]`, to clear), symmetric with `reverse_missing`. Non-pixel_1to1 consumer json without the field SHALL be unaffected.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: omitting defects cannot bypass the empty-pass contract

- **WHEN** a pixel_1to1 finalized screen omits the `defects` field
- **THEN** the gate SHALL FAIL (BLOCKER, screensMissingDefectsEnum) under pixel_1to1, so the agent cannot dodge「pass 须 defects 为空」by leaving the field out

### Requirement: Capture-layer edge sentinel cross-checks unenumerated structural divergence

The capture layer SHALL compute a structural edge-divergence (stretch-aligned per-tile z-MAD) of authoritative-ref vs device-shot and persist `edge_tile_divergence` + `edge_over_threshold_tiles` (tile `[row,col]`) into `visual-diff.json`. The check layer SHALL convert tiles to normalized rects via the shared EDGE_TILE grid and, for over-threshold tiles not covered by any `defect.bbox`, WARN only when the uncovered count ≥ a floor (absorbing the empirical ~3-tile stretch FP). It SHALL be WARN-only and never gate.

Enforcement: `profiles/hmos-app/harness/{visual-diff-capture,image-toolkit,image-jimp-worker,visual-diff-check}.ts`

#### Scenario: defect.bbox covering an over-threshold tile silences it

- **WHEN** an over-threshold tile is geometrically covered by an enumerated `defect.bbox`
- **THEN** that tile SHALL NOT count toward the sentinel WARN

#### Scenario: faithful render below floor stays quiet

- **WHEN** a faithful screen yields fewer uncovered over-threshold tiles than the floor (≈ the stretch FP floor)
- **THEN** the sentinel SHALL NOT WARN

### Requirement: Deterministic visual feedback is a machine-truth JSON with a human projection

After device capture, the harness SHALL emit `device-testing/visual-feedback.json` (SSOT) plus `visual-feedback.md` (projection). The JSON SHALL bind: reference/actual file hashes; identity `{framework_version, framework_package_digest, gate_fingerprint, framework_commit_sha: null|string}` (package digest sourced from the release manifest; at least one of digest/commit non-null); build/device/viewport; per screen_id+variant: OCR text diffs, region-anchored bbox/spacing/color diffs (OCR-anchored dominant-color comparison, line-rhythm sequence comparison), confidence, delta vs previous round, and convergence state. Findings are single decidable facts plus structured findings: hard invariants (required node missing, wrong copy, blank asset, inverted state) MAY block directly as visual FAIL (needs_fix); continuous metrics (color distance, spacing, bbox offset) default to advisory and only escalate on sustained high-confidence regression beyond frozen thresholds; a single global similarity score SHALL NOT judge overall quality.

Enforcement: `profiles/hmos-app/harness/visual-feedback.ts`（新增）, `harness/scripts/check-testing.ts`, `harness/schemas/visual-feedback.schema.json`（新增）

#### Scenario: a color delta creeping from 8 to 9 does not fail the axis

- **WHEN** round N+1 reports a button-region color distance of 9 (was 8), below the frozen escalation threshold
- **THEN** the finding stays advisory and visual_verdict is unchanged by it

### Requirement: Convergence tracking extends the visual rounds ledger

Round-over-round convergence (converging | stalled | regressing) SHALL be computed by extending `visual-rounds-ledger` inputs with feedback deltas — no parallel convergence state machine. Stalled rounds feed the existing no-progress fuse; regressing findings surface as visual regression findings (needs_fix); evidence axes reflect only existence/freshness/trust (hash mismatch or missing files → evidence STALE/MISSING), never convergence.

Enforcement: `harness/scripts/utils/visual-rounds-ledger.ts`, `profiles/hmos-app/harness/visual-feedback.ts`

#### Scenario: three rounds with identical defect fingerprints

- **WHEN** three consecutive rounds produce identical actionable defect fingerprints
- **THEN** the existing no-progress fuse fires through the extended ledger inputs, not a new mechanism

### Requirement: Blind-tier deterministic capture does not degrade with fidelity tier

A `deterministic_feedback` policy SHALL be machine-derived from `effective_image_input=none ∧ ui_change=new_or_changed` (not a user/agent-configurable switch). When derived true, the harness SHALL capture screenshot + layout dump + OCR + screen/state binding for all P0 screens regardless of fidelity tier — pixel-only early-returns in completeness/geometry checks SHALL NOT suppress blind-tier capture. The existing tier-independent nav-config completeness BLOCKER (goal-fakepass t7) SHALL be covered by regression tests, not re-implemented.

Enforcement: `profiles/hmos-app/harness/{capture-completeness-check,visual-diff-capture,quiescence-sampling}.ts`, `harness/scripts/check-testing.ts`

#### Scenario: semantic_layout blind run still yields geometry data

- **WHEN** a blind-tier run executes at effective semantic_layout for a UI feature
- **THEN** all P0 screens still produce screenshot + layout dump + OCR artifacts for feedback generation, and missing nav config still fails tier-independently

### Requirement: Provider review results are written atomically with provider provenance and never produce a verdict

Under `vision_mode: delegated`, the provider review SHALL run inside the testing checker after capture and before strict visual-diff dispatch. It SHALL receive the current reference/device images, screen and round identity, target-node digest, and image hashes, and SHALL return complete per-screen defects, `must_fix`, hash echoes, and any required `region_attest` entries. The provider MUST NOT produce the phase/release verdict. The harness SHALL validate schema, complete target coverage, frozen provider identity, invocation/run/attempt identity, current image hashes, defect-to-`must_fix_refs` anchors, and required region coverage before applying the payload.

Before invocation, the harness SHALL atomically clear only prior provider-owned verdict inputs for the target screens so a failed new attempt cannot inherit old defects, fixes, attestations, pass state, or evaluated hashes. A current deterministic/provider review that validates SHALL be committed by atomic replace with source `{producer:'visual_provider', invoke_id}` and a critic evidence record written before the visual-diff commit. An unavailable/invalid/misidentified/hash-mismatched/workspace-dirtying round SHALL leave no prior provider-derived PASS and SHALL NOT clear an invalidation marker. Only the harness may clear that marker after accepting a fresh review.

`confirmed_by`, human signer predicates, and human visual receipts SHALL NOT exempt a screen from review, survive as authority, close a strict axis, or alter the provider route. Legacy fields MAY remain byte-preserved until the owning writer next rewrites the artifact, but the provider and gate SHALL ignore them. The provider MUST NOT write `confirmed_by`. Deterministic machine FAILs and valid same-invocation provider defects SHALL materialize existing repair candidates without primary-agent or human concurrence.

Enforcement: `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/visual-provider-invoke.ts`, `harness/scripts/utils/critic-receipt-producer.ts`

#### Scenario: a new attempt cannot inherit a provider pass

- **WHEN** attempt N wrote a clean provider result and attempt N+1's provider call is unavailable or invalid
- **THEN** attempt N's provider-derived verdict inputs SHALL already be cleared, and no clean result from N SHALL be consumed as N+1 evidence

#### Scenario: legacy human signature grants no exemption

- **WHEN** a target screen carries `confirmed_by` for its current screenshot
- **THEN** required machine review/gates SHALL run normally and the signer value SHALL not change repair, advance, or release decisions

#### Scenario: valid provider defects drive repair directly

- **WHEN** a same-invocation provider payload passes identity/hash/schema validation and contains an actionable defect
- **THEN** the harness SHALL commit the provider evidence and materialize a repair candidate without `repair_adjudication_pending`

### Requirement: An unusable provider yields a skipped visual-diff, not a blocking failure

An unusable delegated provider SHALL preserve deterministic capture/navigation/tamper checks and SHALL classify the provider-dependent visual evidence separately from product failure. If visual evidence is optional for the current phase and release, the provider-dependent `visual_diff` MAY remain SKIP/UNVERIFIED advisory under the existing policy. If a strict or release-required visual axis cannot be evidenced because the provider/profile capability is unsupported or remains unavailable after bounded retry, the run SHALL project `DEFERRED_CAPABILITY_MISSING`; it MUST NOT advance to `FEATURE_COMPLETED`, fail as a product defect, or wait for a human signature. If the provider declared the required capability but emitted invalid/missing/stale evidence, the visual checker SHALL FAIL and retry/fuse as an evidence-production failure rather than capability-missing.

Enforcement: `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/visual-debt.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/harness-runner.ts`

#### Scenario: optional visual evidence remains advisory

- **WHEN** a non-strict feature has no release-required visual axis and its provider is unavailable
- **THEN** the provider-dependent check MAY be SKIP/UNVERIFIED advisory while deterministic checks still run

#### Scenario: strict provider capability is missing

- **WHEN** a pixel-1-to-1 release-required visual axis has no native or delegated provider capability after bounded retry
- **THEN** the run SHALL defer as capability-missing and SHALL NOT request `confirmed_by`

#### Scenario: capable provider emits invalid payload

- **WHEN** the selected provider declared support but returns a hash-mismatched or incomplete payload
- **THEN** the visual checker SHALL FAIL the round and retry/fuse without labeling it capability-missing

### Requirement: A delegated critic receipt discloses provider evidence truthfully without becoming a threshold

Under `delegated`, critic evidence SHALL record the provider's real adapter/model, invocation identity, current image inputs and hashes, and available structured read-event provenance. The evidence record is machine provenance, not a signing authority: it SHALL NOT by itself create PASS, halt for adjudication, or require a human counterpart. A structurally and identity-valid payload MAY drive repair even when read-event provenance is unavailable and disclosed as `unverified`; however an applicable release-required visual axis SHALL close only when its existing evidence policy accepts the available machine provenance. Invalid means malformed, incomplete, stale, replayed, identity-mismatched, or hash-mismatched — never merely the absence of a human name.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/quality-axes.ts`

#### Scenario: unverified provider evidence can still identify a repair

- **WHEN** a provider has no structured read-event parser but its payload is current, complete, identity-bound, and reports a defect
- **THEN** the defect MAY drive repair while strict release readiness remains governed by the existing machine-evidence policy

#### Scenario: critic evidence never substitutes for a verdict

- **WHEN** a critic evidence record is present but the visual axis has a deterministic FAIL
- **THEN** the FAIL SHALL remain and the record SHALL not act as a receipt or signature

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

### Requirement: Visual signal adjudication has no human third authority

A deterministic producer signal whose applicability and evidence contract pass SHALL be treated as machine evidence and materialized as an existing repair candidate when actionable. A valid current delegated-provider signal SHALL follow its provider candidate path. Producer uncertainty, unsupported comparison geometry, or invalid provider output SHALL mean evidence insufficiency: a required axis SHALL remain FAIL/UNVERIFIED or defer for a real capability gap, while an optional axis may remain advisory. The runner MUST NOT create `repair_adjudication_pending`, `await_human_confirm`, or a `confirmed_by` release path for those cases.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/visual-provider-review.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: deterministic signal disputed by the primary agent

- **WHEN** a deterministic producer emits an applicable FAIL-grade signal and the primary agent disputes it without independent machine evidence
- **THEN** the signal SHALL remain actionable and drive the responsible-phase repair path rather than waiting for human judgment

#### Scenario: genuinely uncertain required signal

- **WHEN** the producer cannot establish applicability or reliable evidence for a required visual obligation
- **THEN** the axis SHALL remain unclosed through FAIL/UNVERIFIED or capability defer and SHALL NOT enter a human-sign queue
