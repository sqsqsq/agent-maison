## ADDED Requirements

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
