## ADDED Requirements

### Requirement: Exclusion registrations authorize only with a verifiable requirement quote

The repair-authority judgement SHALL treat a `ref-elements.yaml` entry with `disposition: excluded` as an exclusion only when its `requirement_quote` passes the same verbatim check the spec gate `ref_elements_excluded` uses (`checkRequirementQuote`, the only reused function) against the current requirement text. An exclusion that cannot be verified — quote missing, not verbatim, or the current requirement text unavailable — SHALL NOT itself grant or withhold anything: the element SHALL fall back to the existing branches, registered when the ui-spec declares it (its defects enter repair as usual) and unregistered otherwise (its defects are disclosed as `scope_unclear` and not repaired). The judgement SHALL then still follow the defect's direction: an `unexpected_render` whose own `requirement_quote` passes the same verbatim check against the current requirement text SHALL remain authorized for removal, and SHALL be `scope_unclear` otherwise. A verified exclusion SHALL keep the existing direction split: an `unexpected_render` anchored on it may be repaired, every other defect class on it is excluded. The judgement SHALL still be produced only by `defectRepairAuthority`, and the effective-screen view SHALL list only verified exclusions in its disclosure. The ui-spec coverage conflict SHALL remain the spec gate's responsibility.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: A forged exclusion does not hide a declared element's defect

- **WHEN** the current requirement text is unavailable and `ref-elements.yaml` registers a ui-spec-declared element as excluded with a quote
- **THEN** a real defect on that element SHALL be authorized and enter repair

#### Scenario: An unverifiable exclusion of an undeclared element is only disclosed

- **WHEN** the current requirement text is unavailable, so neither the exclusion's quote nor any defect's own quote can be verified, and the same unverifiable exclusion names an element the ui-spec does not declare
- **THEN** its defects SHALL be `scope_unclear`, and an `unexpected_render` on it SHALL NOT be authorized for removal

#### Scenario: A defect's own verbatim quote still authorizes removal

- **WHEN** the current requirement text is available, the exclusion's quote is not verbatim in it, the element is not declared by the ui-spec, and an `unexpected_render` on the element carries its own `requirement_quote` that appears verbatim in the current requirement text
- **THEN** that `unexpected_render` SHALL be authorized

#### Scenario: A verbatim exclusion keeps the direction split

- **WHEN** the quote appears verbatim in the current requirement text
- **THEN** a missing-render defect on the element SHALL be excluded while an `unexpected_render` on it SHALL be authorized
