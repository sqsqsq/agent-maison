## ADDED Requirements

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
