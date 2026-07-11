## ADDED Requirements

### Requirement: Screens may declare forbidden-overlap pairs and protected regions

`ui-spec.yaml` screens[] MAY declare `forbidden_overlap: [[elem_a, elem_b], ...]` (pairs of element ids whose runtime bounds must not intersect) and `protected_region: [elem, ...]` (elements no interactive sibling may overlap). These declarations SHALL be schema-validated and consumed by the T8 layout-invariants gate as its hard-gate input.

Enforcement: `harness/schemas/ui-spec.schema.json`, `profiles/hmos-app/harness/ui-spec-schema-validate.ts`

#### Scenario: malformed declaration is rejected

- **WHEN** forbidden_overlap contains a pair that is not exactly two non-empty element id strings
- **THEN** schema validation SHALL record an error

### Requirement: Overlay geometry contract is enforced for pixel_1to1 P0 screens

The structure lint SHALL lower the flat-list threshold from 3 to 2 consecutive ungrouped `list_selection` siblings (existing escapes remain: per-row distinct `layout_group`, or a `bg_color` parent container — the lint message SHALL state them). Additionally, for a pixel_1to1 P0 screen whose root is `overlay_panel`, direct `list_selection`/`action_button` children lacking both `bbox` and `layout_group` SHALL be flagged, and ≥2 surface-like (bg_color) sibling containers SHALL yield an advisory review hint (single-white-card reference structures must be declared as one grouping container).

Enforcement: `profiles/hmos-app/harness/capture-completeness-check.ts`

#### Scenario: two ungrouped list rows no longer slip through

- **WHEN** an overlay P0 screen has exactly 2 consecutive list_selection children with no layout_group and no bg_color parent
- **THEN** the structure lint SHALL flag it (bc-openCard card_type_sheet regression target)

### Requirement: Overlay screens run their own OCR completeness denominator

Under pixel_1to1 with a resolvable overlay reference image, capture completeness SHALL compare the overlay screen's reference-image OCR texts against that screen's own declared elements (must_have_elements/node texts), so an element visible in the overlay reference (e.g. a bank row) cannot be silently satisfied by main-screen declarations. Decorative text false positives SHALL use the existing defer + human-signed escape of `capture_completeness_external`, not a new whitelist mechanism.

Enforcement: `profiles/hmos-app/harness/capture-completeness-check.ts`

#### Scenario: bank row missing from overlay model is caught

- **WHEN** the overlay reference image contains a ≥2-char text with no matching element declared on that overlay screen
- **THEN** the check SHALL flag it (ratchet under pixel_1to1) unless deferred with human signature

### Requirement: Unverified ui-spec escalates to BLOCKER when true vision is available

When fidelity_target is pixel_1to1 and the host has proven true vision (fresh vision-canary verdict `tool_read`; `ocr_capable` does NOT qualify — its semantics are text-question-only, vision remains none), `verified: unverified` SHALL be a BLOCKER regardless of soft enforcement tiers. Hosts without proven vision keep the d4a8f3c6 degradation ladder unchanged.

Enforcement: `profiles/hmos-app/harness/spec-ui-spec-check.ts`

#### Scenario: sighted host cannot ship unverified spec at pixel_1to1

- **WHEN** fidelity_target=pixel_1to1, canary verdict=tool_read (fresh), and ui-spec verified=unverified
- **THEN** the fidelity gate SHALL FAIL as BLOCKER even under warn/reachable enforcement

#### Scenario: blind host is not newly blocked

- **WHEN** the canary verdict is ocr_capable or none
- **THEN** the gate severity SHALL follow the existing enforcement tiers unchanged
