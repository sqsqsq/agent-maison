## ADDED Requirements

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

Under pixel_1to1, a finalized verdict (pass/warn/fail) with `defects === undefined` SHALL trigger a ratchet WARN requiring per-screen enumeration (may be `[]`), symmetric with `reverse_missing`. Non-pixel_1to1 consumer json without the field SHALL be unaffected.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: omitting defects cannot bypass the empty-pass contract

- **WHEN** a pixel_1to1 finalized screen omits the `defects` field
- **THEN** the gate SHALL WARN (screensMissingDefectsEnum), so the agent cannot dodge「pass 须 defects 为空」by leaving the field out

### Requirement: Capture-layer edge sentinel cross-checks unenumerated structural divergence

The capture layer SHALL compute a structural edge-divergence (stretch-aligned per-tile z-MAD) of authoritative-ref vs device-shot and persist `edge_tile_divergence` + `edge_over_threshold_tiles` (tile `[row,col]`) into `visual-diff.json`. The check layer SHALL convert tiles to normalized rects via the shared EDGE_TILE grid and, for over-threshold tiles not covered by any `defect.bbox`, WARN only when the uncovered count ≥ a floor (absorbing the empirical ~3-tile stretch FP). It SHALL be WARN-only and never gate.

Enforcement: `profiles/hmos-app/harness/{visual-diff-capture,image-toolkit,image-jimp-worker,visual-diff-check}.ts`

#### Scenario: defect.bbox covering an over-threshold tile silences it

- **WHEN** an over-threshold tile is geometrically covered by an enumerated `defect.bbox`
- **THEN** that tile SHALL NOT count toward the sentinel WARN

#### Scenario: faithful render below floor stays quiet

- **WHEN** a faithful screen yields fewer uncovered over-threshold tiles than the floor (≈ the stretch FP floor)
- **THEN** the sentinel SHALL NOT WARN
