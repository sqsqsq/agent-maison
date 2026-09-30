## ADDED Requirements

### Requirement: The provider reports content that should not exist and receives the goal brief

The review prompt SHALL carry the same rendered goal brief that every other participant receives (requirement text when available, explicit exclusions, resolved conflicts and the judging rule), alongside the existing reference-element list. The defect vocabulary SHALL include the reverse direction `unexpected_render` — the implementation renders content the goal does not want. Such a defect SHALL carry `element` (the rendered element's id when it has one) or `bbox`, MAY carry `requirement_quote` (the goal sentence saying it is not wanted, copied verbatim), and carries `note` and `severity` like every other class. The prompt SHALL tell the provider that an element marked `excluded` that is already rendered is reported as `unexpected_render`.

Payload validation, payload parsing and transcription into the gate artifact SHALL carry the new class and `requirement_quote` through unchanged: validation SHALL refuse an `unexpected_render` defect with neither `element` nor `bbox` and a non-string `requirement_quote`; parsing rebuilds defects field by field and SHALL keep `requirement_quote`; transcription SHALL keep it. Whether the defect may enter repair is decided by the gate's single authority function, not by the provider.

Enforcement: `profiles/hmos-app/harness/visual-provider-review.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/goal-brief.ts`

#### Scenario: a rendered exclusion is reported and survives transcription

- **WHEN** the provider reports `{class: unexpected_render, element: promo_banner, requirement_quote: "..."}` in an otherwise valid payload
- **THEN** the payload SHALL be accepted and the transcribed defect in `visual-diff.json` SHALL still carry the class and the quote

#### Scenario: an unanchored reverse defect is refused

- **WHEN** an `unexpected_render` defect carries neither `element` nor `bbox`
- **THEN** the whole payload SHALL be refused as invalid
