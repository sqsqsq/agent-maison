# app-component-blueprint Specification

## Purpose
定义工程惯例与组件资产在部件蓝图中的输入、来源、选型裁决和评审投影契约，保持既有 provider/provenance 协议与下游 CU 消费边界。

## Requirements
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

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-provider-boundary.ts`, `harness/scripts/utils/blueprint-discovery.ts`, `harness/scripts/check-component-blueprint.ts`, `skills/project/component-design/SKILL.md`, `skills/reference/app-component-blueprint-workflow.md`

### Requirement: Review projection publishes adopted convention refs without new facts

The existing deterministic blueprint review renderer SHALL emit the convention id and source ref for every convention fact actually adopted by the canonical blueprint. Projection validation MUST continue to prove that all emitted entries derive from the selected canonical revision; the projection MUST NOT introduce a convention, applicability decision or design fact absent from canonical facts/provenance.

#### Scenario: Canonical blueprint adopts one convention

- **WHEN** one canonical discovery fact has `source_kind: convention` and a valid source ref
- **THEN** the review projection SHALL list that id and source ref and pass the existing `--projection` validation

#### Scenario: Projection invents a convention

- **WHEN** a review projection lists a convention source ref absent from canonical facts
- **THEN** the existing projection consistency check SHALL fail closed

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-review-projection.ts`, `harness/scripts/check-component-blueprint.ts`, `docs/operations/samples/blueprint-review-projection.valid.md`

### Requirement: App lens owns component asset decisions through the existing protocol

The App lens MUST read index/catalog and live candidate usage when development or UI-related logical/scenarios views are changed. Each page/UI development target SHALL have one flat existing decision subtype kind=component_asset_selection, target_ref=view:development/node:<id>, asset_resolution reuse|configure|adapt|evolve|custom, component_ref required for non-custom and rationale required for adapt/evolve/custom, with existing owner/provenance/verification_refs/status. provenance.source_ref denotes index/catalog evidence, not the selected ID. The existing decision validator SHALL enforce conditional fields. A verified_unchanged development view MUST NOT emit asset selection decisions. New dependency edges require authorized disposition or controlled open_decision/blocker before current CU admission.

#### Scenario: Incomplete decision or unchanged mask
- **WHEN** a selection decision misses a required field or targets a verified_unchanged development view
- **THEN** blueprint validation SHALL reject it, using unchanged_masks_change for the latter

#### Scenario: Referenced asset evidence is unreadable
- **WHEN** a selection decision cites the configured index or catalog but that particular file cannot be read
- **THEN** blueprint validation SHALL reject the decision; an unreferenced optional catalog may remain missing, with no added fragment resolver or hash-binding protocol

> **Enforced by:** `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/utils/blueprint-evolution-decisions.ts`, `skills/reference/app-component-blueprint-workflow.md`, `skills/project/component-design/SKILL.md`

### Requirement: Static optional component-assets seam reports honest availability

Every blueprint MUST have one static optional component-assets Seam Card in the existing provider rules table. Frozen authority_rule is `Source is component fact authority; curation is human selection guidance.` and source_rule is `Selection evidence cites the configured component index or catalog; component_ref identifies the asset.` Index absence MUST NOT claim available=true or emit selections. No UI dimension permits not_applicable; UI dimension requires unknown|degraded and an unknown gap with owner/needed_by/unlock_condition. Future slices may use open_decision; current-slice dependency MUST use blocker through existing admission rules. No registry or additional state is permitted.

#### Scenario: UI asset unavailable
- **WHEN** UI targets exist and no index is readable
- **THEN** provider validation SHALL reject available=true or not_applicable, require a controlled gap, and existing admission SHALL reject a current-slice open_decision

#### Scenario: Optional seam omitted
- **WHEN** the component-assets card is missing
- **THEN** the same provider validator SHALL reject the blueprint

#### Scenario: A correctly labeled current asset blocker still forbids construction
- **WHEN** an unresolved component-assets gap has needed_by equal to the current slice and status blocker
- **THEN** the existing admission validator SHALL derive an actual BLOCKER issue and the existing CU design gate SHALL reject construction even when the admission status is also blocker; a controlled future open_decision remains constructable

> **Enforced by:** `harness/scripts/utils/blueprint-provider-boundary.ts`, `harness/scripts/utils/blueprint-admission.ts`, `skills/reference/app-component-blueprint-workflow.md`

### Requirement: Review publication retains the canonical asset choice

The same review renderer SHALL emit target_ref, asset_resolution, component_ref and rationale for component_asset_selection decisions. Existing --projection validation SHALL reject any changed or invented selection and MUST NOT create a second publication schema.

#### Scenario: Published selection changes
- **WHEN** the review projection alters reuse into custom
- **THEN** canonical projection validation SHALL fail

> **Enforced by:** `harness/scripts/utils/blueprint-review-projection.ts`, `harness/scripts/check-component-blueprint.ts`
