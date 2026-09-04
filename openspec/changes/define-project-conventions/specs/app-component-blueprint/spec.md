## ADDED Requirements

### Requirement: P1 exposes conventions through the existing provider and provenance protocol

Every P1 blueprint MUST contain exactly one static optional `conventions-knowledge` Seam Card in the existing `providers[]` protocol with frozen authority and source rules. If the default path is not explicitly configured and its file is absent, the card MUST state `available: false` and `missing_disposition: not_applicable`. If `paths.conventions` is explicitly configured but the file is missing or unreadable, the card MUST state `available: false` and `missing_disposition: unknown|degraded`; it MUST NOT state `not_applicable` or claim conventions were consumed. A readable file MUST be read in full, while only applicable ids are represented as existing `discovery.facts` with `provenance.source_kind: convention`, `<configured-path>#<id>` source refs and authoritative evidence strength. Nodes and decisions MUST reuse existing provenance or verification refs; no conventions-specific blueprint field is permitted.

The static Seam Card freezes `authority_rule` as `Project conventions are stable knowledge input, not current-code authority.` and `source_rule` as `Applicable facts cite the configured conventions file and exact heading id.` Its definition is applicable project conventions; consumers are the blueprint builder, App lens and independent questioning; provider is the static conventions reader; requirement is optional. Replacement preserves the existing fact/provenance protocol and stales affected P1 results; exit drops temporary reads but retains canonical provenance; conflicts retain both refs and do not override current code authority.

#### Scenario: Project has not enabled conventions

- **WHEN** the default conventions path is absent and was not explicitly configured
- **THEN** provider validation SHALL require the `conventions-knowledge` card and accept only an honest unavailable `not_applicable` result

#### Scenario: Default conventions file exists but cannot be read

- **WHEN** reading the default conventions file fails with EACCES or another non-absence error, without explicit path configuration
- **THEN** the provider SHALL remain unavailable with `unknown|degraded`; `not_applicable` SHALL be rejected because a read failure is not evidence of disabled conventions

#### Scenario: Convention fact cites the wrong file or an unknown id

- **WHEN** a convention fact's source ref does not match the configured conventions file and one of its existing level-two heading ids
- **THEN** P1 SHALL reject the fact at the first consumption point using the existing heading parser

#### Scenario: Node or decision convention reference has no corresponding fact

- **WHEN** a node or decision cites a convention through provenance or a configured-conventions verification ref without the same source ref in a convention discovery fact
- **THEN** P1 SHALL reject that orphan reference, including when the conventions file is absent; downstream projections and CU review SHALL continue consuming the validated fact set, not a second reference protocol

#### Scenario: Explicit path cannot be read

- **WHEN** `paths.conventions` is explicitly configured but the file cannot be read
- **THEN** provider validation SHALL reject `available: true` and `missing_disposition: not_applicable`, accepting only `unknown|degraded`

#### Scenario: Convention informs a design decision

- **WHEN** an applicable card constrains the component design
- **THEN** the blueprint MUST cite the same configured-path/id source ref through existing fact and decision provenance without adding another schema field

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-provider-boundary.ts`, `harness/scripts/utils/blueprint-discovery.ts`, `harness/scripts/check-component-blueprint.ts`, `skills/project/component-design/SKILL.md`, `skills/project/app-component-blueprint/SKILL.md`

### Requirement: Review projection publishes adopted convention refs without new facts

The existing deterministic blueprint review renderer SHALL emit the convention id and source ref for every convention fact actually adopted by the canonical blueprint. Projection validation MUST continue to prove that all emitted entries derive from the selected canonical revision; the projection MUST NOT introduce a convention, applicability decision or design fact absent from canonical facts/provenance.

#### Scenario: Canonical blueprint adopts one convention

- **WHEN** one canonical discovery fact has `source_kind: convention` and a valid source ref
- **THEN** the review projection SHALL list that id and source ref and pass the existing `--projection` validation

#### Scenario: Projection invents a convention

- **WHEN** a review projection lists a convention source ref absent from canonical facts
- **THEN** the existing projection consistency check SHALL fail closed

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-review-projection.ts`, `harness/scripts/check-component-blueprint.ts`, `docs/operations/samples/blueprint-review-projection.valid.md`
