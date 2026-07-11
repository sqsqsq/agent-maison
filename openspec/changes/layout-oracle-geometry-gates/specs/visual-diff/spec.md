## ADDED Requirements

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

A screen entry MAY carry `evaluation_invalidated: true`, meaning its evaluation artifacts (reported scores, region_attest) require independent re-evaluation. This flag SHALL NOT trigger device recapture, SHALL NOT reset a human-confirmed verdict, and SHALL NOT invalidate `confirmed_by`. While present, the gate SHALL FAIL until a fresh evaluation clears the flag. Screens carrying the flag SHALL NOT be eligible for `await_human_confirm`.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: invalidated evaluation blocks without recapture

- **WHEN** a human-confirmed pass screen carries evaluation_invalidated: true
- **THEN** the gate SHALL FAIL demanding critic re-evaluation, the verdict/confirmed_by SHALL be preserved, and capture skip semantics (P0-9a) SHALL be unaffected

### Requirement: Empty defects on a pixel_1to1 P0 pass screen require region attestation

Under pixel_1to1, a P0 pass screen with `defects: []` SHALL carry `region_attest[]` — one entry per must-have element or zone: `{region, verdict: no_diff|diff_logged, method: paired_crop_compare|vl_screening|human, evidence?, by?}`. Missing attestation SHALL be a BLOCKER (ratchet), symmetric with the defects-enumeration contract (D11). Attestation SHALL cover every declared `must_have_elements` id of the screen (a single generic region cannot substitute per-region attestation), and `diff_logged` entries SHALL correlate to a defect or must_fix item — otherwise the gate SHALL FAIL. Pass burden of proof is per-region attestation, not "no problem seen".

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: bare empty defects cannot pass

- **WHEN** a pixel_1to1 P0 screen has verdict=pass, defects=[] and no region_attest
- **THEN** the gate SHALL FAIL demanding per-region attestation

### Requirement: Paired-crop evidence and critic receipt are validated, provenance stated honestly

`region_attest` entries with `method: paired_crop_compare` SHALL reference an evidence crop that exists on disk **inside the feature's `device-screenshots/_attest/` directory** and whose mtime is not earlier than the evaluated screenshot (stale/external files do not count), and SHALL carry content-binding fields (rev8): `evidence_hash` (re-computed against the crop file), `source_screenshot_hash` (must equal the screen's `evaluated_screenshot_hash`), `source_ref_hash` (re-computed against the resolved reference image when resolvable — an arbitrary string does not pass; rev9), and `source_bbox` (4 numbers in [0,1]; declarative locator metadata — pixel-level "crop truly equals this region" re-verification stays with the critic/human, deterministic gates do not do image re-cropping) — file-exists-and-fresh alone does not prove the crop corresponds to this reference image and this device shot. Whenever **any** `region_attest` entries exist (vl_screening-only included — a critic invocation without a receipt is an invocation without records), a critic receipt (`device-testing/reports/critic-receipt.json`) SHALL exist and be structurally valid: `critic_run_id`, `adapter`, `prompt_hash`, `input_provenance: verified|unverified` all required; `image_inputs[]` SHALL be non-empty with a valid path on every entry (an empty-input "visual review" is rejected in any tier); **every referenced input file SHALL exist on disk and image_inputs SHALL cover every attested screen's evaluated screenshot — in both tiers** (`unverified` means injection into the model cannot be proven, not that the inputs may be nonexistent or unrelated to this round); declared `image_inputs[].hash` values SHALL be re-computed and verified; `input_provenance: verified` SHALL additionally require a hash on every image input and an `output_hash`. image_inputs SHALL cover all referenced paired crops. Missing/invalid/uncovered/hash-mismatch → pixel_1to1 BLOCKER. Both candidate-pass tiers require a structurally valid receipt; `unverified` describes unprovable image injection, not receipt absence. Harness evidence proves materialization and invocation records, not model cognition: interactive adapters that cannot prove image injection SHALL state `input_provenance: unverified` and MUST NOT be presented as "visual review proven"; the behavioral defense is the SSOT rule that the critic MUST Read each crop before writing a verdict.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: attest claim without evidence file fails

- **WHEN** region_attest claims paired_crop_compare but the referenced crop file does not exist
- **THEN** the gate SHALL FAIL (pixel_1to1 BLOCKER)

#### Scenario: unverified provenance is recorded, not inflated

- **WHEN** an interactive-agent receipt carries input_provenance: unverified with valid structure and crop coverage
- **THEN** validation SHALL accept it and downstream candidate-pass SHALL classify it as candidate-pass(unverified), proceeding to human batch review without claiming automated visual proof

#### Scenario: handwritten verified claims are downgraded until an issuer exists

- **WHEN** a receipt claims input_provenance: verified while no runner-issued signing section exists (rev10 — tool_read adapters cannot prove injection and the runner issuance chain has not landed, so any verified receipt today is agent-handwritten)
- **THEN** the gate SHALL apply the stricter verified-claim validations, downgrade the effective tier to unverified with an explicit WARN, and SHALL NOT produce candidate-pass(verified) until receipts carry a validated runner signing section

### Requirement: Runtime layout tree is captured per screen and geometry invariants are asserted (T8)

The capture layer SHALL dump the runtime layout tree per captured screen to `device-screenshots/layout-<screen_id>.json` (hylyre dump-ui chain, hypium-ui-dump-v1) bound to the same screenshot_hash/build fingerprint keys as verdict persistence; skip-recaptured screens SHALL NOT re-dump. Failure to dump SHALL set `layout_dump_status` (pixel_1to1 P0 screen missing dump → WARN). The gate `visual_diff_layout_invariants` SHALL assert, per the calibration ladder in `docs/operations/layout-oracle-calibration.md`: A-class — explicit `forbidden_overlap`/`protected_region` violations and out-of-screen bounds → pixel_1to1 BLOCKER (ratchet); the default close-button overlap rule → advisory until device calibration D5 proves zero false positives; B-class spec-derived structure (layout_group co-container, declared group common ancestor, order monotonicity) → WARN; C-class sibling-gap ratio vs ref bbox → permanent advisory. Deterministic A-class FAIL SHALL NOT be overridden by a VL pass verdict. Findings SHALL be reported as check hits carrying signal id, normalized bbox and an actionable note; the critic/VL SHALL transcribe them into `defects[]`/`must_fix` when finalizing verdicts — harness checks stay read-only over judgment artifacts (tamper-scan red line: judgments are produced only by capture machinery and humans, D3). A screen whose `layout_dump_status` claims `captured` but whose dump file is missing or unparsable SHALL be flagged (never silently skipped).

Enforcement: `profiles/hmos-app/harness/{visual-diff-capture,layout-oracle-check,visual-diff-check}.ts`

#### Scenario: declared forbidden overlap blocks

- **WHEN** ui-spec declares `forbidden_overlap: [close, bank_surface]` and the runtime bounds of the located nodes intersect
- **THEN** the gate SHALL FAIL (pixel_1to1 BLOCKER) with an overlap defect carrying bbox and actionable note

#### Scenario: unmatched locator degrades honestly

- **WHEN** fewer than the coverage threshold of declared elements can be located in the layout tree
- **THEN** B-class assertions for that screen SHALL be skipped with a WARN note, never guessed

### Requirement: Critic loop replaces single-round-then-human, with fingerprinted no-progress fuse

The device-testing SSOT SHALL replace "MVP 单轮+人工决定是否再迭代" with an automatic loop: independent critic (separate context from the implementer) produces must_fix → coding fixes → recapture/re-judge, iterating until candidate-pass or fuse. candidate-pass SHALL be defined as: no BLOCKER/major defect + must_fix empty + required region_attest and critic receipt valid + no unresolved T8/M1 hit **at any status（FAIL or WARN — the await_human_confirm narrowing SHALL exclude unresolved T8 invariant and M1 self-report WARNs, not only extra FAILs）** + advisory/minor enumerated. Capability-degradation WARNs (layout dump unavailable, OCR degraded) are surfaced in the batch-review message but SHALL NOT deadlock candidate-pass — they are not unresolved findings, and hosts without the capability must still be able to close via human review; in two tiers — candidate-pass(verified) requires receipt input_provenance=verified; candidate-pass(unverified) accepts structurally-valid unverified receipts and proceeds to T2 human batch review with honest labeling. No-progress SHALL be judged on stable defect fingerprints (`screen_id+defect_class+element/region+bbox_bucket`), not natural-language string equality; a round where any screen carries more must_fix entries than structured defects SHALL be **ineligible** for fingerprint comparison (rev9/rev10 — count-based approximations misjudge same-count-different-problems as no-progress, and partial transcription leaves unstructured residue out of the fingerprint; this per-screen `must_fix ≤ defects` rule is a necessary-condition approximation erring toward ineligible — complete per-item accounting requires the transcription audit or must_fix↔defect linkage ids), and the per-round fingerprint note SHALL state this ineligibility; fuse = fingerprint set unchanged for two eligible rounds or retry budget exhausted → halt with residue list. T2 semantics are unchanged; initiating T2 batch confirmation before candidate-pass SHALL be prohibited.

Enforcement: `skills/reference/device-testing-workflow-detail.md`, `skills/feature/device-testing/SKILL.md`

#### Scenario: paraphrased must_fix does not escape the fuse

- **WHEN** two consecutive rounds yield the same defect fingerprints with reworded must_fix text
- **THEN** the loop SHALL fuse as no-progress and halt with the residue list

#### Scenario: human batch review only after candidate-pass

- **WHEN** screens still carry unresolved deterministic FAIL signals
- **THEN** the agent SHALL NOT initiate T2 batch confirmation
