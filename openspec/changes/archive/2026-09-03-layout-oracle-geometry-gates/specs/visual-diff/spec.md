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
