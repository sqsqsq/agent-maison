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

Enforcement: `profiles/hmos-app/harness/visual-feedback.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/visual-rounds-ledger.ts`

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

### Requirement: A reference image incompatible with the device viewport is rejected before content comparison

A screen's reference image SHALL be dimension-checked against the device viewport before any pixel or OCR content comparison consumes it. The check reuses the existing image dimension reader and reference resolution: the reference is the screen's `ref_id` image, the viewport is the fidelity lock `viewport` during spec and the actual captured screenshot during testing, and the two are compared by height/width ratio with the same ×1.15 threshold the OCR text-placement gate already uses for full-page detection, held as one shared constant. A reference whose aspect exceeds the viewport's by that margin is incompatible: under `pixel_1to1` the screen SHALL FAIL (`visual_reference_viewport`, responsibility: spec reference asset) and SHALL be excluded from every pixel/OCR content comparison of that round, so no content verdict is derived from the original full-page image; under lower fidelity tiers the existing ratchet decides WARN/SKIP and the pixel caliber SHALL NOT be silently upgraded to a pass. When the lock declares no viewport, spec SHALL WARN that the check is deferred to testing rather than pass by silence. The remedy is authored, not machine-derived: a long page is modeled as several screens, each with its own viewport-sized `ref_id` image and a nav config ending in `scroll_to` an anchor element. This pixel path presupposes that every segment's nav starts from a known state and that its scroll landing has been shown to repeat (host verification: consistent mid/tail checkpoint positions across at least two cold-start rounds); a segment that cannot show this stays FAIL and Maison does not claim support for it. Segments outside the pixel acceptance scope are excluded from `pixel_1to1` screens and covered by functional or structural acceptance criteria — there is no per-screen or per-segment fidelity tier. Once each screen's reference is compatible, the existing pipeline runs unchanged. Maison SHALL NOT add per-screen crop regions, an automatic crop resolver, derived crop files or hash semantics, segmentation, scroll stitching, or a second reference source; the existing full-page `uncertain` downgrade in the OCR gate remains as defensive diagnostics.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/fidelity-snapshot-check.ts`, `profiles/hmos-app/harness/visual-diff-ocr-gates.ts`, `profiles/hmos-app/harness/image-toolkit.ts`

#### Scenario: A full-page reference fails under pixel_1to1

- **WHEN** a P0 screen's reference image is 1320×4350 or 1320×8312 and the device viewport is 1320×2120 under `pixel_1to1`
- **THEN** `visual_reference_viewport` SHALL FAIL naming the screen and both sizes, and that screen SHALL produce no pixel or OCR content hit in the round

#### Scenario: A compatible reference changes nothing

- **WHEN** the reference image and the viewport are both 1320×2120, or the author has modeled the long page as several screens each carrying a viewport-sized `ref_id` image
- **THEN** the existing visual pipeline SHALL run with byte-identical checks and results

#### Scenario: Lower tiers follow the ratchet

- **WHEN** the same incompatible reference is evaluated under a fidelity tier below `pixel_1to1`
- **THEN** the check SHALL emit WARN or SKIP per the existing ratchet and SHALL NOT report a pixel-caliber pass

#### Scenario: An undeclared spec viewport defers rather than passes

- **WHEN** the fidelity lock declares no `viewport` during the spec phase
- **THEN** spec SHALL WARN that the dimension check is deferred to testing, and testing SHALL perform it against the captured screenshot size

### Requirement: Self-reported scores carry zero gate weight

`visual-diff.json` schema 1.1 SHALL rename VL self-reported scores to `reported_fidelity_score` / `reported_geometric_iou` (legacy 1.0 `fidelity_score` / `geometric_iou` are mapped on read). Reported values SHALL NOT be consumed by any gate: the pass minimum-score gate and the finalized catastrophic floors SHALL only run on independently measured values; when no measured value is available they SHALL be skipped with an explicit reference note instead of consuming reported values.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: legacy 1.0 file maps reported fields

- **WHEN** a schema 1.0 visual-diff.json carries `fidelity_score`/`geometric_iou`
- **THEN** validation SHALL map them to `reported_*` and no gate SHALL consume them

#### Scenario: floors do not fire on reported values

- **WHEN** a pass screen reports `reported_fidelity_score: 0.2` and no measured value exists
- **THEN** the low-score-pass gate SHALL NOT fire on the reported number and a reference note SHALL state the floor is not armed

### Requirement: Degenerate self-report patterns are intercepted (M1)

The gate `visual_diff_selfreport_integrity` SHALL intercept degenerate self-report patterns: (a) ≥4 finalized screens with bitwise-identical reported iou or fidelity → pixel_1to1 BLOCKER (ratchet); (b) ≥2 screens whose reported fidelity equals `score_floor` bitwise → same level; (c) a pass screen with `|reported_fidelity_score − score_floor| < ε` and empty defects → WARN. M1 is an anomaly detector, not an honesty proof; remediation is independent re-evaluation per screen (fresh `reported_*` + `region_attest`), marked via `evaluation_invalidated`.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: constant iou across screens is blocked

- **WHEN** 8 finalized screens all report geometric_iou 0.95
- **THEN** the gate SHALL FAIL (BLOCKER under pixel_1to1) demanding per-screen independent re-evaluation

#### Scenario: copied floor is blocked

- **WHEN** ≥2 screens report fidelity bitwise-equal to their script-computed score_floor
- **THEN** the gate SHALL FAIL at the same level

### Requirement: Evaluation freshness is decoupled from capture freshness

A screen entry MAY carry `evaluation_invalidated: true`, meaning its evaluation artifacts (reported scores, region attestations, and provider-derived verdict inputs) require independent machine re-evaluation. This flag SHALL NOT trigger device recapture. While present, the gate SHALL FAIL until a fresh current-identity evaluation clears it. Legacy `confirmed_by` state SHALL provide no exemption and SHALL not affect clearing.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: invalidated evaluation blocks without recapture

- **WHEN** a previously passing screen carries evaluation_invalidated: true
- **THEN** the gate SHALL require current machine re-evaluation while capture skip semantics remain unaffected

### Requirement: Empty defects on a pixel_1to1 P0 pass screen require region attestation

Under pixel_1to1, a P0 pass screen with `defects: []` SHALL carry machine-produced `region_attest[]` — one entry per must-have element or zone, using a supported content/hash-bound comparison method. Human/signature methods and free-text `by` values MUST NOT satisfy coverage. Missing attestation SHALL be a BLOCKER. Attestation SHALL cover every declared `must_have_elements` id, and `diff_logged` entries SHALL correlate to a defect or must_fix item; otherwise the gate SHALL FAIL. Pass burden of proof is per-region current machine evidence, not "no problem seen".

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: bare empty defects cannot pass

- **WHEN** a pixel_1to1 P0 screen has verdict=pass, defects=[] and no region_attest
- **THEN** the gate SHALL FAIL demanding per-region attestation

### Requirement: Paired-crop evidence and critic receipt are validated, provenance stated honestly

`region_attest` entries with `method: paired_crop_compare` SHALL reference an evidence crop inside the feature's `device-screenshots/_attest/` directory, fresh for the evaluated screenshot, and SHALL carry recomputable evidence, screenshot, reference, and bbox bindings. File existence alone is insufficient. Whenever region attestations exist, the current critic machine-evidence record SHALL be structurally valid, identify the actual provider/invocation, cover every attested screenshot and paired crop, and carry recomputable hashes. Missing, invalid, uncovered, stale, or hash-mismatched evidence SHALL block pixel completion. `input_provenance: unverified` MAY disclose unavailable read-event telemetry and MAY still support repair when payload identity/content validates, but it MUST NOT be described as verified machine closure or handed to a human signature path.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: attest claim without evidence file fails

- **WHEN** region_attest claims paired_crop_compare but the referenced crop file does not exist
- **THEN** the gate SHALL FAIL (pixel_1to1 BLOCKER)

#### Scenario: unverified provenance is recorded, not inflated

- **WHEN** an interactive-agent receipt carries input_provenance: unverified with valid structure and crop coverage
- **THEN** validation MAY use it for repair while any release-required machine-evidence obligation remains UNVERIFIED or capability-deferred according to current policy

#### Scenario: handwritten verified claims are downgraded until an issuer exists

- **WHEN** a receipt claims input_provenance: verified while no runner-issued signing section exists (rev10 — tool_read adapters cannot prove injection and the runner issuance chain has not landed, so any verified receipt today is agent-handwritten)
- **THEN** the gate SHALL apply the stricter verified-claim validations, downgrade the effective tier to unverified with an explicit WARN, and SHALL NOT produce candidate-pass(verified) until receipts carry a validated runner signing section

### Requirement: Runtime layout tree is captured per screen and geometry invariants are asserted (T8)

The capture layer SHALL dump the runtime layout tree per captured screen to `device-screenshots/layout-<screen_id>.json`, bound to the same screenshot/build identity as verdict persistence. The calibrated A/B/C geometry ladder remains: explicit hard invariants can BLOCK, lower-confidence structure/spacing signals remain WARN/advisory. Deterministic A-class FAIL SHALL NOT be overridden by a provider verdict or signer. Findings SHALL carry stable signal identity, normalized bbox, and actionable evidence and SHALL feed machine-produced defects/repair candidates through the existing transcription contract. A claimed captured dump that is missing or unparsable SHALL be flagged.

Enforcement: `profiles/hmos-app/harness/{visual-diff-capture,layout-oracle-check,visual-diff-check}.ts`

#### Scenario: declared forbidden overlap blocks

- **WHEN** ui-spec declares `forbidden_overlap: [close, bank_surface]` and the runtime bounds of the located nodes intersect
- **THEN** the gate SHALL FAIL (pixel_1to1 BLOCKER) with an overlap defect carrying bbox and actionable note

#### Scenario: unmatched locator degrades honestly

- **WHEN** fewer than the coverage threshold of declared elements can be located in the layout tree
- **THEN** B-class assertions for that screen SHALL be skipped with a WARN note, never guessed

### Requirement: Critic loop replaces single-round-then-human, with fingerprinted no-progress fuse

The device-testing SSOT SHALL run an automatic independent-critic loop: critic produces machine evidence and `must_fix` → coding repairs → recapture/rejudge, iterating until machine-verified pass or the existing fingerprint/budget fuse. Pass requires no open BLOCKER/major, empty must_fix, valid required region evidence/critic provenance, and no unresolved hard T8/M1 signal. Capability degradation SHALL project advisory or capability-missing according to whether the axis is optional/required; it SHALL not be released by human batch review. No-progress SHALL use stable defect fingerprints rather than prose equality, and ineligible/unstructured rounds SHALL not contaminate the baseline. Same-run manual resume SHALL not reset the fuse.

Enforcement: `skills/reference/device-testing-workflow-detail.md`, `skills/feature/device-testing/SKILL.md`

#### Scenario: paraphrased must_fix does not escape the fuse

- **WHEN** two consecutive rounds yield the same defect fingerprints with reworded must_fix text
- **THEN** the loop SHALL fuse as no-progress and halt with the residue list

#### Scenario: deterministic FAIL never enters human review

- **WHEN** screens still carry unresolved deterministic FAIL signals
- **THEN** the loop SHALL continue repair/fuse handling and SHALL NOT initiate a human confirmation path

### Requirement: Layout dump files have one canonical address

Layout dump files SHALL be addressed through a single resolution path. New writes SHALL use the
canonical sanitized slug (`layout-<sanitizeVisualDiffScreenSlug(screen_id)>.json`,
`__overlay__` 等归一为单下划线); a legacy raw `screen_id` filename SHALL be accepted as a
read-only compatibility fallback. When both a canonical-slug file and a legacy-raw file exist for
the same screen, or when two distinct `screen_id` values normalize to the same slug, resolution
SHALL fail closed rather than pick either candidate; capture SHALL detect slug collisions on the
target set before crawling and skip **both** conflicting screens (owner and collider) with a P0
capture failure — record `layout_dump_status` readers (`visual-diff-check`, calibrate,
runtime-mount-conformance) SHALL all use the same shared resolver.

#### Scenario: canonical slug wins for new writes

- **WHEN** capture writes a layout dump for an overlay screen whose `screen_id` contains `__overlay__`
- **THEN** the file SHALL be written under the canonical sanitized slug, and the checker SHALL
  resolve it through the same shared helper

#### Scenario: legacy raw name still readable

- **WHEN** only a legacy `layout-<raw screen_id>.json` exists for a screen
- **THEN** resolution SHALL accept it and the report SHALL note the legacy address

#### Scenario: canonical/legacy coexistence fails closed

- **WHEN** both canonical-slug and legacy-raw dumps exist for one screen, or two `screen_id`
  values collide after normalization
- **THEN** resolution SHALL fail closed with an explicit ambiguity diagnostic, and SHALL NOT
  silently prefer one file; capture SHALL skip both colliding screens (owner and collider) with
  zero writes

#### Scenario: naming mismatch is not reported as corruption

- **WHEN** `layout_dump_status` claims `captured` but no dump resolves at either address
- **THEN** the diagnostic SHALL distinguish "address/naming mismatch" from "file deleted or
  corrupted", instead of asserting corruption

### Requirement: Golden contract targets share one canonical target set across nav, identity, and capture

When `MAISON_GOLDEN_CONTRACT` is set, the check-testing device visual_diff entry SHALL parse the golden contract exactly once (single JSON.parse via the shared env loader) and derive one canonical capture-target set `P0 targets ∪ golden positive capture targets ∪ golden forbidden nav targets`, where golden positive capture targets SHALL be the resolved canonical IDs (`resolveGoldenCaptureTargets` extraScreens/extraOverlays, e.g. `bank_card_list_sheet__overlay__0`) and forbidden nav targets SHALL be the forbidden entry ids (e.g. `HomeTab`) — raw contract names SHALL NOT be concatenated into the set. The same set SHALL be consumed by nav validation (`validateNavConfigV2`), identity resolution (`resolveIdentityForTargets`), and capture (`goldenTargets`/`goldenForbidden` passed explicitly so capture does not re-read the env). Golden-positive P1 screens and golden forbidden screens SHALL therefore be legal nav keys (no "unmatched/extra screen name" failure), SHALL be navigable, and SHALL enter capture/evidence production. When the golden contract resolves with failures (declared screen missing from ui-spec, shape drift, capture-id mismatch), the entry SHALL fail closed at the nav gate naming the failing declared ids — skipping the nav validation to work around contract failures is prohibited.

Enforcement: `harness/scripts/check-testing.ts`（`runDeviceVisualDiffCapture` 入口）、`profiles/hmos-app/harness/visual-diff-capture.ts`、`profiles/hmos-app/harness/visual-diff-targets.ts`

#### Scenario: golden P1 screen declared in nav config passes validation and is captured

- **WHEN** the golden contract names a P1 overlay-root screen (`bank_card_list_sheet` → `bank_card_list_sheet__overlay__0`) and the nav config declares navigation steps for that canonical overlay id
- **THEN** nav validation SHALL pass (no "extra/misspelled screen name" failure) and capture SHALL produce the `bank_card_list_sheet__overlay__0` entry

#### Scenario: golden forbidden screen participates in nav and identity sets

- **WHEN** the golden contract declares a forbidden target (HomeTab) and the nav config declares steps (and, under pixel_1to1 hard contract, a confirmed identity) for it
- **THEN** the nav validation SHALL accept the HomeTab key, the capture SHALL navigate it and produce the run/build-bound forbidden evidence wrapper, and (pixel hard) a missing confirmed identity for HomeTab SHALL fail validation like any other target — proving forbidden targets are inside the shared identity set

#### Scenario: golden contract resolution failure fails closed at the nav gate

- **WHEN** a golden declared screen is absent from ui-spec or its expected capture id does not match the screen's shape
- **THEN** the entry SHALL return a BLOCKER/FAIL `visual_diff_capture` whose details name the `golden_contract:<declared>` failure and capture SHALL NOT run

#### Scenario: no golden contract keeps P0-only behavior

- **WHEN** `MAISON_GOLDEN_CONTRACT` is unset
- **THEN** the target set SHALL remain P0-only: ordinary P1 screens written into the nav config SHALL still be rejected as extra/misspelled keys, capture SHALL NOT expand to P1, and no golden evidence production SHALL occur

### Requirement: Golden contract env load carries targets and forbidden in a single parse

The golden contract env SHALL be loaded through one combined loader (`loadGoldenContractFromEnv`) that performs a single file read + JSON.parse, returning both `positive_screens` targets and `forbidden` entries together (env unset → `{targets: null, forbidden: []}`; set-but-unreadable/invalid shape → throw, fail-closed, identical to prior loader semantics). The existing loaders `loadGoldenContractTargetsFromEnv` and `loadGoldenContractForbiddenFromEnv` SHALL delegate to it (no second parser). Callers needing both fields — including `captureVisualDiff`'s own env fallback and the check-testing entry — SHALL load once and consume both fields from that single load; loading targets and forbidden through two separate loader calls (two file reads) is prohibited, because the file content could drift between reads.

Enforcement: `profiles/hmos-app/harness/visual-diff-capture.ts`（含 `captureVisualDiff` env 回退单次装载）、`harness/scripts/check-testing.ts`

#### Scenario: direct capture env path parses the contract file exactly once

- **WHEN** a caller invokes `captureVisualDiff` without explicit `goldenTargets`/`goldenForbidden` while `MAISON_GOLDEN_CONTRACT` names a contract with both positive screens and forbidden entries, and capture consumes both (evidence production enabled)
- **THEN** the contract file SHALL be read and parsed exactly once, and the two legacy loader entry points SHALL return the same values as the combined loader
