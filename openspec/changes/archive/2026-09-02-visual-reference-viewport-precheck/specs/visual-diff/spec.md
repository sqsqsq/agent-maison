## ADDED Requirements

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
