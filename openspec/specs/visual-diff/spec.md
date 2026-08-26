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

Under `vision_mode: delegated`, the provider review SHALL run inside the existing testing checker,
after screen capture completes and **before** the strict device visual-diff dispatch. When the mode is
not `delegated`, the whole step SHALL be skipped. Because the existing check wrapper is synchronous,
the provider call site SHALL make its asynchrony explicit rather than smuggling a promise through it.
In interactive use the provider identity is read from the personal local configuration; in a goal run
it is injected as a frozen value through the existing environment-variable identity channel.

The provider SHALL receive, per screen: the reference image, the device screenshot, the `screen_id`,
the ui-spec target-node digest, both images' sha256, and the round identity. Its output contract is:
complete coverage of every target screen, and per screen `{screen_id, defects[], must_fix[], echoed
image hashes}` where each defect carries class/severity/optional element/note and anchors into
`must_fix` through the existing `must_fix_refs` mechanism. Under `pixel_1to1` the payload additionally
carries `region_attest[]` entries with `method: 'vl_screening'` — this is the **existing**
candidate-pass requirement, not a new mechanism.

Prior provider results SHALL be cleared **before the provider is invoked**, not merely before a
write, and the cleared state SHALL be persisted. Clearing before the write alone would let a failed
round leave the previous attempt's provider defects, attestations and harness-derived verdict alive
on disk, where the candidate collector would re-materialize them as if they were this round's
findings — exactly the cross-attempt reuse this change forbids. Clearing SHALL remove only
provider-attributable state (its defects, the `must_fix` entries anchored solely to them, and its own
`region_attest` entries), SHALL reset the screen's `verdict` to pending and drop its evaluated
screenshot hash, and SHALL NOT touch `confirmed_by` or any other producer's entries.

Because clearing identifies provider `must_fix` entries through their defects' anchors, every
provider `must_fix` entry SHALL be referenced by at least one provider defect; an unanchored entry
SHALL invalidate the payload. The payload SHALL also echo the frozen review `schema_version`
verbatim; a mismatch SHALL invalidate it.

A screen explicitly marked as having an invalidated evaluation SHALL keep that marker across the
pre-invocation clearing, and SHALL additionally have the evaluation products that marker distrusts
discarded — its legacy and reported fidelity/geometry scores and **all** of its region attestations,
including any labelled as human-authored. A region attestation's author field is optional free text
that is neither checked by the human-verified predicate nor bound to a screenshot, so it is not a
verified human signature; keeping such entries would also let stale attestations combine with fresh
ones to satisfy region coverage, defeating the re-evaluation. Human authority is carried solely by
`confirmed_by` together with the evaluated screenshot hash, and neither is touched.
The marker SHALL be removed **only** by the harness, and only after a payload has passed every
validation above and been successfully applied to that screen; the provider SHALL NOT carry any field
that requests or signals clearing. An unavailable, invalid, mis-identified, hash-mismatched, screen-
missing or workspace-dirtying round SHALL leave the marker standing — there is no fake clear. Because
the marker asks whether the *previous evaluation* is trustworthy rather than whether the UI passes,
it SHALL be cleared whether the fresh review maps to pass or to fail; a fresh review that finds
defects keeps blocking through its own `must_fix`/`defects`. The receipt's evidence grade
(`input_provenance`) SHALL NOT decide whether a payload is trusted; successful receipt persistence IS
however a precondition for committing the round's review result, per the commit ordering below.

Without this clearing the delegated loop has a permanent stall: the human-sign exemption correctly
refuses to protect a marked screen, the provider re-reviews it every round, and the marker never
clears, so the tier-independent invalidated-evaluation gate fails forever.

A screen that carries a valid human confirmation for **the screenshot currently on disk** SHALL be
neither reviewed nor cleared. That exemption SHALL NOT extend to a screen whose evaluation is
explicitly marked invalidated: a screen named as needing re-evaluation must never be shielded from it.
For that marked-but-signed case the pre-invocation clearing SHALL still preserve the screen's verdict,
`confirmed_by` and evaluated screenshot hash — the un-cleared marker already blocks the round, and a
single provider outage must not additionally destroy a human decision that is still about this exact
screenshot.

The obligations the strict gate will impose on an accepted clean pass SHALL be checked **before** the
payload is accepted, not only afterwards: under the pixel contract a P0 clean-pass screen's
attestations SHALL cover every screen-level required element, and a "difference logged" attestation
SHALL have a defect or fix to anchor to. Checking these only downstream is unsafe precisely because
acceptance clears the invalidation marker: a screen carrying `confirmed_by` would then hit the human
sign exemption on the following round, the provider would never be consulted again, and a failure that
only a fresh review could repair would become permanent.

For the same reason the critic receipt SHALL be persisted **before** the reviewed `visual-diff.json`
is committed. A receipt that cannot be written SHALL make the round `unusable`, leaving disk at the
pre-invocation cleared state with the marker intact. The receipt's evidence grade still does not decide
whether a payload is trusted — its content remains disclosure only — what this adds is commit ordering, so
that an accepted round never leaves behind a state the strict gate rejects and no later round can fix.

The human sign is the highest authority in this system and the provider
is a subordinate reviewer; the frozen closure ends with a person signing and the gate being re-run.
Resetting a signed screen to pending and dropping its evaluated hash and provider attestations before
each review would make that final re-run depend on the provider being available a second time — a
subordinate reviewer's availability would then veto a human decision, and the closure could never
complete. The predicate SHALL use only existing facts: the existing human-verified predicate over
`confirmed_by`, plus the screen's evaluated screenshot hash equalling the current file's hash. No new
freshness state is introduced. Excluding such a screen suppresses only the provider call; the screen
still passes through the strict visual-diff gate unchanged, so no existing check is bypassed.

A validated payload SHALL then be written into `visual-diff.json` per-screen `must_fix`/`defects` by
**atomic replace** (temp file plus rename). `VisualDiffDefectSource` SHALL be extended with
the frozen shape `{producer: 'visual_provider', invoke_id}`, with schema and validation updated in
step so that the self-report integrity detector does not misclassify provider-written entries.

Review targets SHALL be resolved from the artifacts capture actually writes. The capture skeleton
records a reference **id**, not a reference path, so target assembly SHALL resolve that id through
the existing authoritative-reference chain. Requiring an explicit reference path would yield zero
targets on every real round, silently disabling the provider.

The harness SHALL map per-screen verdicts deterministically from the written payload (empty
`must_fix` → pass candidate, non-empty → fail). **The provider SHALL NOT produce a verdict**, and the
question of whether the phase may advance SHALL remain solely with the gate. The provider SHALL NEVER
write `confirmed_by`; the existing human-confirmation predicate and the `pixel_1to1` final human sign
are unchanged.

Enforcement: `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`,
`harness/scripts/utils/visual-provider-invoke.ts`

#### Scenario: a new attempt cannot inherit the previous attempt's provider defects

- **WHEN** attempt N wrote provider defects and attempt N+1's provider call is invalid
- **THEN** attempt N's provider-written entries SHALL have been cleared **before** the call, the screen
  SHALL stand at pending with no evaluated screenshot hash, and nothing from attempt N SHALL be
  presented as attempt N+1's review result

#### Scenario: a previous clean pass cannot survive a failed round

- **WHEN** attempt N's provider reported no defects, so the harness wrote a pass with provider
  attestations, and attempt N+1's provider is unavailable
- **THEN** that pass and its attestations SHALL have been cleared before the call, leaving no
  provider-derived clean state on disk

#### Scenario: an invalidated evaluation is cleared only by an accepted fresh review

- **WHEN** a screen marked as having an invalidated evaluation gets a payload that passes every
  validation and is applied
- **THEN** the harness SHALL remove the marker, the distrusted scores SHALL be gone, **every** prior
  region attestation SHALL be gone so that the only attestations left come from this payload, and
  `confirmed_by`, the evaluated screenshot hash and the capture identity fields SHALL be untouched

#### Scenario: incomplete region coverage is refused at acceptance, not after

- **WHEN** a pixel-contract P0 screen's payload reports a clean pass but attests only one generic
  region while the screen declares several required elements
- **THEN** the payload SHALL be refused as `invalid`, the invalidation marker SHALL remain set, and the
  screen SHALL be reviewed again on the next round

#### Scenario: a receipt that cannot be written blocks the commit, not the next round

- **WHEN** a validated payload is applied in memory but the critic receipt cannot be persisted
- **THEN** the round SHALL be `unusable`, the reviewed `visual-diff.json` SHALL NOT be committed, and
  the invalidation marker SHALL remain set so the next round re-reviews

#### Scenario: a signed screen keeps its verdict through a failed re-review

- **WHEN** a screen that is human-confirmed for the current screenshot is marked invalidated and the
  round's provider is unavailable
- **THEN** its verdict, `confirmed_by` and evaluated screenshot hash SHALL survive, and the round SHALL
  remain blocked solely by the still-set marker

#### Scenario: a failed round cannot clear an invalidated evaluation

- **WHEN** a screen marked as having an invalidated evaluation is reviewed in a round whose provider is
  unavailable or whose payload fails validation
- **THEN** the marker SHALL still be set afterwards, no round result SHALL be written, and the round
  SHALL continue through the existing fail-open exit

#### Scenario: a signed screen survives a later provider outage

- **WHEN** a person has confirmed a screen for the screenshot currently on disk and the gate is re-run
  while the provider is unavailable
- **THEN** the provider SHALL NOT be invoked for that screen, its verdict, confirmed signature,
  evaluated hash and attestations SHALL remain untouched, and the strict gate SHALL decide the round

#### Scenario: a changed screenshot re-enters review despite an old signature

- **WHEN** a screen carries a human confirmation but its screenshot file no longer matches the
  evaluated hash
- **THEN** the screen SHALL be reviewed and cleared like any other pending screen, and the stale pass
  SHALL NOT survive

#### Scenario: real capture output resolves to review targets

- **WHEN** the capture skeleton records screens carrying a reference id and no reference path
- **THEN** target assembly SHALL resolve the reference image through the authoritative-reference chain
  and SHALL produce one target per captured screen

#### Scenario: provider provenance does not read as self-report

- **WHEN** defects carry `source.producer = 'visual_provider'`
- **THEN** the self-report integrity detector SHALL NOT flag them as agent self-reporting, and the
  transcription audit SHALL keep its existing behavior for producer-sourced defects

### Requirement: An unusable provider yields a skipped visual-diff, not a blocking failure

When the provider round is `unavailable` or `invalid`, the harness SHALL NOT run the strict device
visual-diff dispatch over the still-pending screens. Running it would make P0-screen-pending or
all-screens-pending under `ui_change = new_or_changed` a BLOCKER **FAIL**, wedging the phase — the
exact opposite of the fail-open loop contract.

Instead the harness SHALL emit the existing `visual_diff` check result with
`{severity: 'BLOCKER', status: 'SKIP'}`, while deterministic capture/navigation/device results for the
round are preserved as-is.

Only the branches that **depend on the provider's judgement** — the pending-screen and
candidate-pass paths — are suppressed. Deterministic red lines that have nothing to do with the
provider SHALL still run in this round, specifically the verdict-rewriting artifact scan and the
`visual-diff.json` structural validation, reported under their existing check ids. A provider that
happens to be unavailable is not a reason to stop looking for evidence tampering.

That SKIP is the honest exit through machinery that already exists: a
non-MINOR SKIP becomes a `needs_human` visual-debt entry, open blocking debt projects the visual
quality axis to `UNVERIFIED` and blocks release, and a SKIP is not a FAIL so the phase still advances.
The three states therefore hold simultaneously: **development loop PASS / visual UNVERIFIED / release
VISUAL_PENDING**.

No new check id, verdict state, quality axis, or halt class SHALL be introduced for this path, and the
run SHALL NOT stop or wait.

Enforcement: `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`,
`harness/scripts/utils/visual-debt.ts`, `harness/harness-runner.ts`

#### Scenario: a failed provider does not wedge the phase

- **WHEN** the provider is unavailable in a `delegated` round whose screens are still pending and
  `ui_change = new_or_changed`
- **THEN** `visual_diff` SHALL be `{BLOCKER, SKIP}`, the phase SHALL advance, and release SHALL be
  blocked through the existing visual-debt projection rather than by a phase failure

#### Scenario: tampering is still caught in a failed provider round

- **WHEN** a verdict-rewriting artifact is present and the provider round is unavailable
- **THEN** the existing tamper check SHALL still report BLOCKER/FAIL under its own check id alongside
  the skipped `visual_diff`

### Requirement: A delegated critic receipt discloses provider evidence truthfully without becoming a threshold

Under `delegated`, the critic receipt SHALL record the provider's real `adapter` and `model`, with
`input_provenance: 'verified'` only when a structured read-event parser exists for that adapter and
the invocation's event stream actually evidences the reads, and `unverified` otherwise. The evidence
path for a delegated receipt SHALL be the provider invocation's own event stream; the existing
receipt path validation SHALL gain a narrow branch keyed on the receipt's adapter differing from the
primary, leaving the native path's exact-path binding unchanged. The existing `CapabilityReceipt`
provider field, whose meaning is canary collection, SHALL NOT be repurposed.

**Acceptance and disclosure are separate.** Whether a provider result is used for repair depends only
on same-invocation payload validation. A payload from an adapter with no read-event parser is
therefore `input_provenance: 'unverified'` **and still usable for repair** when its structure,
identity and current image hashes are valid — only the evidence grade is disclosed as lower. "Invalid"
means payload validation failed (missing, malformed JSON, missing screens, identity mismatch, hash
mismatch, stale attempt) — never merely "unverified".

A receipt SHALL NOT in any circumstance cause a halt or an adjudication-pending stop. Because
`delegated` admits `pixel_1to1`, whose candidate-pass path already demands a structurally valid
receipt, the delegated receipt SHALL also be written in ordinary interactive use, where no run or
attempt identity exists — using the invocation id as its critic run id and disclosing
`input_provenance: 'unverified'`, which is the only grade that path can corroborate anyway.
Omitting it there would manufacture a structurally unsatisfiable blocker, contradicting
"disclosure, never a threshold".

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`,
`harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: an unverified receipt does not discard a valid payload

- **WHEN** the provider adapter has no structured read-event parser and its payload passes validation
- **THEN** the defects SHALL still drive repair, and the receipt SHALL disclose `unverified` evidence

#### Scenario: interactive delegated still produces a usable receipt

- **WHEN** an interactive `delegated` round under `pixel_1to1` applies a valid provider payload with
  no run or attempt identity present
- **THEN** a structurally valid receipt SHALL be written disclosing `unverified` provenance, and the
  candidate-pass path SHALL NOT fail for a missing receipt

#### Scenario: the native receipt path is unchanged

- **WHEN** a run is `native` and the critic receipt names the primary adapter
- **THEN** the receipt path validation SHALL behave exactly as before this change

