## MODIFIED Requirements

### Requirement: Visual-diff screens enumerate positive render defects

Each screen entry in `visual-diff.json` MAY carry a `defects[]` array enumerating「实现有但渲染错」defects, each `{class, bbox?, severity, note}` where `class ∈ {clipping, overlap, shape_mismatch, missing_render, unexpected_render, other}` and `severity ∈ {blocker, major, minor}`. `unexpected_render` is the reverse direction — the implementation renders content the goal does not want: it SHALL carry at least one of `element` (the rendered element's id) or `bbox`, and MAY carry `requirement_quote`, which, when present, SHALL be a string (the goal sentence saying the content is not wanted, copied verbatim). Existing classes and their fields are unchanged, so payloads without the new class remain valid. A `verdict=pass` screen carrying a blocker/major defect SHALL be treated like a low-score pass (pixel_1to1 → FAIL via fidelity ratchet, else WARN). The device-testing rubric SHALL require per-screen enumeration and `pass` requires `defects` empty.

Outside the hard pixel contract (`effective=pixel_1to1 ∧ acceptance_strictness=hard`, predicate `isHardPixelContract`), a screen is a **tier-downgraded residual** (`isTierDowngradedResidual`, the only decision point) when all of the following hold: its verdict is `pass` or `warn`; it carries no `blocker` defect and no `major` defect whose `source` is a T8 producer; every `must_fix[i]` is referenced by at least one defect's `must_fix_refs`; and it carries at least one self-reported `major` defect. The gate SHALL materialize these screens as `structured.downgraded_screens` (same channel as `placement_verified_screens`, not written back to `visual-diff.json`), drop them from the must_fix / pass-with-defect hit lines, disclose them in one extra `visual_diff` MAJOR/WARN line marked 「按档位降级」, and exclude them from the product-truth veto of `channel_evidence_usable`. `verdict=fail`, blocker defects, T8-sourced majors, unanchored must_fix text, placement `fail_signals` and every other deterministic signal SHALL keep vetoing evidence and driving repair. Because the report may repeat a `screen_id`, the set SHALL be aggregated conservatively per id: if any record of an id fails the conditions, that id is not downgraded. A minor-only screen is not downgraded and follows the minor rule. Under the hard pixel contract nothing is downgraded.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/execution-channel-evidence.ts`, `harness/scripts/utils/visual-debt.ts`

#### Scenario: pass with blocking defect is rejected

- **WHEN** a screen has verdict=pass and a defect with severity blocker or major
- **THEN** the gate SHALL FAIL under the hard pixel contract (`pixel_1to1 ∧ hard`) or WARN otherwise, and SHALL refuse channel evidence unless the screen is a tier-downgraded residual (outside the hard pixel contract, self-reported major only; see the next scenario)

#### Scenario: a self-reported major outside the hard pixel contract becomes visual debt

- **WHEN** under `pixel_1to1 ∧ best_effort` two warn screens each carry one must_fix anchored by a self-reported `major` `shape_mismatch` defect (host run f829b8 testing i11)
- **THEN** the gate SHALL stay WARN with both screens in `downgraded_screens`, `channel_evidence_usable=true`, a 「按档位降级」 detail line, both warn screens usable as per-screen evidence, and one open `debt:visual_diff:<screen>` entry per screen
- **AND** the same screens under the hard pixel contract, or with a T8-sourced major, a blocker defect, an unanchored must_fix or `verdict=fail`, SHALL NOT be downgraded and SHALL still refuse channel evidence

#### Scenario: defect schema is validated

- **WHEN** a defect has an illegal class/severity, missing note, or a bbox that is not 4 numbers in [0,1]
- **THEN** validateVisualDiffJson SHALL record a schema error

#### Scenario: an existing clipping payload stays valid

- **WHEN** a screen carries `{class: clipping, element, bbox, severity: major, note}` as before
- **THEN** validateVisualDiffJson SHALL record no defect schema error

#### Scenario: a bbox-only unexpected_render payload is valid

- **WHEN** a defect is `{class: unexpected_render, bbox, severity, note}` without `element`, optionally with a string `requirement_quote`
- **THEN** validateVisualDiffJson SHALL record no defect schema error

#### Scenario: an unanchored unexpected_render or a non-string quote is rejected

- **WHEN** an `unexpected_render` defect carries neither `element` nor `bbox`, or its `requirement_quote` is not a string
- **THEN** validateVisualDiffJson SHALL record a schema error
