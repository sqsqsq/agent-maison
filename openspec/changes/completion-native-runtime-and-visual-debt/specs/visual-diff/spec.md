# visual-diff Spec Delta

## ADDED Requirements

### Requirement: Visual debt settles by structured kind with four-state entry and testing-only axis suppression

The harness-derived visual debt ledger (`deriveVisualDebt`) SHALL collect the `visual_diff` source's hits by `structured.kind === 'visual_diff'` in addition to the check id, because a WARN-only visual-diff round is written under the `visual_diff_layout_invariants` id while its `structured.kind` stays `visual_diff`; a `debt:visual_diff` entry left by an earlier FAIL round SHALL therefore close when the current round's kind-matched result is PASS or WARN.

Settlement SHALL be four-state for every debt source: a `FAIL` hit, or a `SKIP` hit whose severity is not `MINOR` (a blind-tier source skipped as a whole — no capability projection is assumed to block release in its place), opens or continues the entry (worst = FAIL when present, else that SKIP; scope expansion unchanged); a `PASS` or `WARN` hit with no such FAIL/SKIP closes every historical entry of that source; a round whose hits are all `MINOR` `SKIP`, or that has no hit for the source, keeps the historical entries unchanged. WARN results remain disclosed through the check result, the phase summary and `visual_debt_disclosure`; they are not debt and MUST NOT block release. The B08 special settlement branch for `visual_reference_viewport` (closing only on a kind-matched `visual_diff` PASS) is withdrawn: that source follows the generic rule, and its registration in the debt source table SHALL remain so an existing open entry stays reachable and closes on the next `visual_reference_viewport` WARN.

Producers SHALL express a **defect** as `FAIL` and a **disclosure** as `WARN` (plan a3f7c1d9 D3(e)). The four defect-class debt sources — `render_visibility_calibrate` (node present, pixels invisible), `asset_placeholder_present` (visible placeholder ≠ real asset supplied), `asset_materialization_sanity` (non-critical sanity violation), `visual_parity_unverified_crop` (crop not verified, non-hard-pixel contract) — SHALL report a hit as `MAJOR` `FAIL`, never raised to `BLOCKER`: the phase verdict and summary blockers count only `BLOCKER` FAIL, so verdict and blockers are unchanged for these checks (the `on_violation` lifecycle hook receives them under its BLOCKER/MAJOR contract (`specs/lifecycle-hooks-schema.yaml`) — no such hook is registered in this repo or the hmos-app profile, so there is no behavioural difference today, and a future extension hook returning BLOCKER adjudicates them exactly as any other MAJOR FAIL), while the ledger opens the entry and blocks release at testing. Disclosure sources (`static_fidelity_score` heuristic score, `capture_completeness_external` uncaptured OCR lines, `visual_reference_viewport` top-slice remainder, `visual_multimodal_parity` degraded evidence, `visual_parity` under a configured soft enforcement, and `visual_diff` rounds with only minor hits) keep `WARN` and do not enter the ledger.

`applyVisualDebtPipeline` SHALL write the ledger in every phase but SHALL suppress a PASS visual axis to `UNVERIFIED`/`needs_fix` only when the phase is `testing` (the release point); an upstream phase's visual axis reflects that phase's own checks, so a coding rerun after backtrack is not contaminated by testing-side leftovers.

Enforcement: `harness/scripts/utils/visual-debt.ts`, `harness/harness-runner.ts`

#### Scenario: A renamed WARN round closes a BLOCKER visual_diff debt

- **WHEN** the ledger holds an open `debt:visual_diff` entry and the current round contains `{ id: 'visual_diff_layout_invariants', status: WARN, structured: { kind: 'visual_diff' } }`
- **THEN** the entry SHALL be `closed`; a kind-matched FAIL SHALL open `debt:visual_diff`; a plain `visual_diff` PASS SHALL close it

#### Scenario: Only MINOR SKIP or absence keeps history; WARN closes; FAIL or a non-MINOR SKIP opens

- **WHEN** the ledger holds an open entry for a source and the current round has only `MINOR` SKIP hits for it, or none
- **THEN** the entry SHALL stay `open` and no new entry SHALL be opened
- **AND** a WARN hit SHALL close it, a FAIL hit SHALL keep it open, and a `BLOCKER` SKIP hit SHALL open or continue it (`needs_fix`) even when WARN hits are present in the same round

#### Scenario: A blind-tier mixed round still blocks release

- **WHEN** a testing round contains `runtime_mount_conformance` PASS and `visual_diff` SKIP with severity `BLOCKER`, so the visual axis alone projects PASS
- **THEN** the ledger SHALL hold at least one open entry, the testing visual axis SHALL be `UNVERIFIED`/`needs_fix`, and release SHALL be `BLOCKED`

#### Scenario: reference_viewport follows the generic rule

- **WHEN** the ledger holds an open `visual_reference_viewport` entry and the current round emits a `visual_reference_viewport` WARN
- **THEN** the entry SHALL be `closed`; a kind-matched `visual_diff` PASS with the source absent SHALL keep it open; a `visual_reference_viewport` FAIL SHALL still open an entry (source registration kept)

#### Scenario: A defect-class source is a MAJOR FAIL that the ledger blocks and the phase verdict ignores

- **WHEN** `render_visibility_calibrate`, `asset_placeholder_present`, `asset_materialization_sanity` (no brand-critical hit) or `visual_parity_unverified_crop` (no hard-pixel contract) observes its defect
- **THEN** the result SHALL be `MAJOR` / `FAIL`, `resolveVerdictFromChecks` SHALL still return `PASS` and `buildSummaryBlockers` SHALL be empty for it, the ledger SHALL open an entry for the source, and the testing visual axis SHALL be `UNVERIFIED` with release `BLOCKED`

#### Scenario: Debt suppresses the visual axis only in testing

- **WHEN** the ledger holds an open entry and a coding phase closes with a PASS visual axis
- **THEN** the coding visual axis SHALL remain PASS while the ledger is still written
- **AND** the same open entry in testing SHALL suppress the visual axis to `UNVERIFIED` with `needs_fix` / `retry_phase: testing`

## MODIFIED Requirements

### Requirement: A reference image incompatible with the device viewport is rejected before content comparison

A screen's reference image SHALL be dimension-checked against the device viewport before any pixel or OCR content comparison consumes it. The check reuses the existing image dimension reader and reference resolution: the reference is the screen's `ref_id` image, the viewport is the fidelity lock `viewport` during spec and the actual captured screenshot during testing, and the two are compared by height/width ratio with the same ×1.15 threshold the OCR text-placement gate already uses for full-page detection, held as one shared constant.

The judgement SHALL have exactly three outcomes, produced by one shared function (`classifyCompareReference`) and one shared entry point (`resolveCompareReference`) that every consumer calls — capture invalidation and pixel metrics, the delegated provider's target assembly, the check's pre-gate and comparison index, and the spec-phase pre-gate:

- **direct** — aspect within the tolerance: the original image is the comparison input; the existing pipeline runs unchanged, with no `visual_reference_viewport` result.
- **top_slice** — aspect exceeds the tolerance **and** `ref.w === shot.w`: the comparison input is the reference's top `shot.h` pixels, re-cropped by machine on every call into `device-testing/device-screenshots/_derived-ref/<ref_id>.top<shotH>.png` (overwritten; no existence or size caching), so that the derived slice and the screenshot share size and origin and no reference-side coordinate is rescaled. The screen SHALL stay in the comparison domain and be treated as an ordinary screen by capture (same build + same hash may skip recapture; the prior verdict is not dropped). A derivation failure SHALL fall back to `incompatible` with a note.
- **incompatible** — aspect exceeds the tolerance and the widths differ: under `pixel_1to1` the screen SHALL FAIL (`visual_reference_viewport`, responsibility: spec reference asset) and SHALL be excluded from every pixel/OCR content comparison of that round; under lower fidelity tiers the existing ratchet decides WARN/SKIP and the pixel caliber SHALL NOT be silently upgraded to a pass.

For a `top_slice` screen the comparison scope SHALL be decided by the ui-spec **declared** normalized bboxes only (`splitMustHaveByTopSlice`, `ratio = shot.h / ref.h`): a must_have element with `y + h ≤ ratio` is in scope, `y ≥ ratio` is out of scope, crossing the line or undeclared is undetermined. Layout dumps and locator results SHALL NOT participate in the scope decision, so a top element the product failed to render stays in scope and is reported missing as before. The delegated provider's coverage pre-check and the `visual_diff_region_attest` gate SHALL both take the in-scope subset as the expected set from that one function, and the OCR anchor-missing gate (`visual_diff_text_missing`) SHALL build its expected text set from the declared nodes whose bbox is in scope by the same rule — out-of-scope and undetermined texts are neither expected nor counted missing; the provider prompt SHALL state that the reference is the top viewport slice of a taller page (entry state) and list out-of-scope/undetermined elements as "do not judge missing". Out-of-scope and undetermined must_have elements SHALL be neither missing nor passed: they are **unverified**, disclosed by a `visual_reference_viewport` MINOR WARN line naming the screen, both sizes, and `N out of scope / M undetermined`, and by `visual_diff` details / reference notes saying the screen was compared by its top slice and the rest is unverified. The WARN is disclosure, not debt (plan a3f7c1d9 D3(b), superseding B08): it SHALL NOT open a `visual_reference_viewport` visual-debt entry, and the B08 special settlement condition (closing only on a kind-matched `visual_diff` PASS) is withdrawn — the source keeps its registration in the debt source table so an existing open entry stays reachable and closes on the next `visual_reference_viewport` WARN by the generic ledger rule; a `visual_reference_viewport` FAIL still opens an entry. `capture_completeness_external`'s denominator SHALL NOT change. A derived slice that does not match the entry-state screenshot SHALL take the existing pixel/OCR ratchet to WARN/FAIL — never a PASS.

Attestation crops (`region_attest.source_bbox`, `source_ref_hash`) and reference receipts SHALL keep binding the original image; the verifier does not see the derived slice. When the lock declares no viewport, spec SHALL WARN that the check is deferred to testing rather than pass by silence. The authored remedy for `incompatible` and for unverified regions stays: model a long page as several screens, each with its own viewport-sized `ref_id` image and a nav config ending in `scroll_to` an anchor element, under the same repeatable-scroll precondition as before. Maison SHALL derive only the top slice: no per-screen crop regions, no segmentation, no scroll stitching, no rewriting of the viewport from the reference, no second reference source; the existing full-page `uncertain` downgrade in the OCR gate remains as defensive diagnostics.

Enforcement: `profiles/hmos-app/harness/image-toolkit.ts`, `profiles/hmos-app/harness/image-jimp-worker.cjs`, `profiles/hmos-app/harness/visual-diff-capture.ts`, `profiles/hmos-app/harness/visual-provider-review.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/fidelity-snapshot-check.ts`, `profiles/hmos-app/harness/visual-diff-ocr-gates.ts`, `harness/scripts/utils/visual-debt.ts`

#### Scenario: A full-page reference of a different width fails under pixel_1to1

- **WHEN** a P0 screen's reference image is 1080×4350 or 1080×8312 and the device viewport is 1320×2120 under `pixel_1to1`
- **THEN** `visual_reference_viewport` SHALL FAIL naming the screen and both sizes, and that screen SHALL produce no pixel or OCR content hit in the round

#### Scenario: A same-width taller reference is compared by its top slice

- **WHEN** a P0 screen's reference image is 1320×4350 and the device viewport is 1320×2120
- **THEN** the comparison input for capture metrics, the delegated provider and the OCR text-placement gate SHALL be `_derived-ref/<ref_id>.top2120.png` (1320×2120), the screen SHALL stay in the comparison domain, `visual_reference_viewport` SHALL be a MINOR WARN naming the top-slice comparison, and `visual_diff` details SHALL say the rest is unverified
- **AND** with the same build and screenshot hash a second capture SHALL keep the entry (no drop, no recapture, verdict not reset to pending) with score/edge values present

#### Scenario: Scope is decided by declared bboxes and disclosed as unverified, not as debt

- **WHEN** the screen declares must_have elements A (bbox entirely above `ratio`), B (bbox entirely below) and C (no bbox), and the screenshot shows A
- **THEN** the provider coverage pre-check and `visual_diff_region_attest` SHALL require attestation for A only, the WARN line SHALL read `1 out of scope / 1 undetermined`, no `visual_reference_viewport` debt entry SHALL be opened, an existing open `visual_reference_viewport` entry SHALL be `closed` by that WARN, and `capture_completeness_external` SHALL be unchanged
- **AND** when A is absent from the screenshot it SHALL still be reported missing by both gates

#### Scenario: A changed reference refreshes the slice and a mismatching slice is not washed green

- **WHEN** the reference file's content changes with unchanged dimensions, or the derived slice's text structure differs from the screenshot
- **THEN** the next call SHALL rewrite the derived slice (different hash), and the mismatch SHALL surface through the existing OCR text-placement ratchet as WARN/FAIL

#### Scenario: A compatible reference changes nothing

- **WHEN** the reference image and the viewport are both 1320×2120, or the author has modeled the long page as several screens each carrying a viewport-sized `ref_id` image
- **THEN** the existing visual pipeline SHALL run with byte-identical checks and results

#### Scenario: Lower tiers follow the ratchet

- **WHEN** the same incompatible (different-width) reference is evaluated under a fidelity tier below `pixel_1to1`
- **THEN** the check SHALL emit WARN or SKIP per the existing ratchet and SHALL NOT report a pixel-caliber pass

#### Scenario: An undeclared spec viewport defers rather than passes

- **WHEN** the fidelity lock declares no `viewport` during the spec phase
- **THEN** spec SHALL WARN that the dimension check is deferred to testing, and testing SHALL perform it against the captured screenshot size

#### Scenario: The spec pre-gate names derivable references

- **WHEN** the fidelity lock declares `viewport` 1320×2120 and a screen's reference is 1320×4350
- **THEN** the spec pre-gate SHALL emit a PASS row stating that testing will compare the top slice and the rest is unverified, and a 1080×4350 reference SHALL still FAIL under `pixel_1to1`
