# component-assets Specification

## Purpose
定义可选共享组件库存、逐条确认的策展台账、蓝图到 Feature 的选型投影及有限静态能力证据，保证源码事实与设计权威可追溯。

## Requirements
### Requirement: Optional source-derived inventory has one reproducible form

Maison SHALL resolve component_index and component_catalog through shared config helpers with defaults `doc/component-index.yaml` and `doc/component-catalog.yaml`, without UPDATE backfill. Index file existence SHALL be the Feature activation signal. Index MUST contain only schema_version and sorted components with id, module, file, symbol, kind, props parameter names, deprecated, source_fingerprint and static_checks. ID MUST be `<module>/<module-relative-file>#<symbol>`; file MUST be project-relative. No timestamp, absolute path, reference count or call-site sample is allowed. Source remains SSOT. The profile scanner MUST scan only catalog HAR/HSP legal exports, reuse the existing export-entry resolver, follow one named re-export hop, and warn without expanding star exports.

#### Scenario: Index is absent
- **WHEN** a Feature has no index file, including when a default path resolves
- **THEN** component catalog and Feature selection checks SHALL skip without requiring selection or creating files

#### Scenario: Repeated scan and re-export
- **WHEN** a library exports an annotated component through one named re-export
- **THEN** repeated scans of unchanged sources SHALL produce identical bytes, include that component, exclude private/HAP exports and warn on export star

#### Scenario: Snapshot drift
- **WHEN** a present index has an invalid shape, unknown module, invalid ID or differs from a fresh scan
- **THEN** the existing catalog phase SHALL report failure (drift at MAJOR) with a rerun command

> **Enforced by:** `harness/config.ts`, `harness/scripts/bootstrap-component-index.ts`, `harness/scripts/utils/component-assets.ts`, `harness/scripts/utils/component-catalog-check.ts`, `profiles/hmos-app/harness/component-extractor.ts`, `specs/phase-rules/catalog-rules.yaml`

### Requirement: Human curation is thin and incrementally confirmed

Catalog entries MUST reference index IDs and contain only intent tags, one_liner, use_when, not_for, easily_confused_with, status (recommended|legacy|deprecated), notes and optional golden file/symbol pointers. The bootstrap MUST follow catalog-bootstrap staging and individual y confirmation; no unconfirmed entry or status change may be merged. Merge SHALL reject nonexistent IDs before writing. Daily dangling IDs, missing golden pointers and uncurated index entries SHALL warn without mutation; mutual confusion references SHALL be checked. Feature candidate discovery MAY trigger incremental curation without requiring a complete inventory review.

#### Scenario: Invalid or unconfirmed staging
- **WHEN** staging contains an unconfirmed card or an ID absent from the index
- **THEN** merge SHALL refuse the write and leave the catalog unchanged

#### Scenario: Source rename leaves old curation
- **WHEN** a rescan replaces an ID due to a file or symbol rename
- **THEN** daily checks SHALL warn about dangling curation and let humans migrate or delete it without automatically changing status

> **Enforced by:** `skills/project/component-catalog-bootstrap/SKILL.md`, `skills/reference/component-catalog-bootstrap-workflow.md`, `harness/scripts/bootstrap-component-index.ts`, `harness/scripts/utils/component-assets.ts`, `harness/scripts/utils/component-catalog-check.ts`

### Requirement: Selection extends the existing Feature component contract

With an index present, page/component/builder entries (including existing navigation/decorator UI signals) MUST carry a single asset_selection object; utility kinds are exempt. It SHALL contain resolution reuse|configure|adapt|evolve|custom, optional bindings, component_ref required except custom, and rationale required for adapt/evolve/custom. Invalid shape MUST flow through SpecLoader shape_issues to feature_spec_shape. Existing component fields and consumer results MUST remain unchanged. Multiple selected assets use existing children-linked entries. A nonempty component_ref MUST resolve to the index. Consumer module SHALL be the containing components[].module, provider the index module; module/file are the usage site, not provider location. Architecture DSL permission SHALL be calculated live; illegal dependencies SHALL fail with candidate swap, declared downshift/refactor, and human-authorized new-edge alternatives. Evolve MUST include the provider in existing in_scope_modules.

#### Scenario: Matrix and activation
- **WHEN** an activated UI component omits selection, uses an invalid resolution, misses required ref/rationale or references a nonexistent component
- **THEN** the phase SHALL fail while absent-index legacy contracts and utility entries remain accepted

#### Scenario: Illegal dependency
- **WHEN** the consumer/provider layers or same-layer policy prohibit the dependency
- **THEN** preflight SHALL fail without changing DSL; goal uses existing await-confirm for a new edge and resumes only after human authority

#### Scenario: Existing consumer regression
- **WHEN** a valid asset_selection is added to a component
- **THEN** SpecLoader normalization, navigation registration, visual-parity name mapping and exit defaults SHALL retain their original results

#### Scenario: Mandatory failures affect the final phase verdict
- **WHEN** selection is invalid, the dependency is illegal, a shared export is unregistered, or a new shared asset has an applicable fail/unknown static check
- **THEN** the corresponding Feature checks SHALL emit BLOCKER/FAIL and the existing report SHALL derive final verdict FAIL with nonzero blockers; index drift remains a MAJOR diagnostic and uncurated/dangling WARN remain non-blocking without changing global severity rules

> **Enforced by:** `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/component-selection-check.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-coding.ts`, `harness/scripts/check-review.ts`, `specs/artifact-schemas/contracts.schema.yaml`

### Requirement: Feature selection is a projection of blueprint authority

When an index and a blueprint apply, selection MUST use canonical CU design_refs of kind decision and existing contracts.change_unit.design_ref_mappings. The mapped component's resolution/component_ref/rationale SHALL equal the referenced component_asset_selection decision; bindings alone are local. Feature plan MUST NOT independently choose assets or invent a decision_ref protocol. Review SHALL compare declaration with implementation and receive index/catalog plus live candidate call-site context. Semantic duplication and two or more wrappers of one component are review advisories, not text gates.

#### Scenario: Complete mechanical chain
- **WHEN** a scanned asset is chosen by a changed development view, the CU references that decision, and a Feature maps it to the matching selection
- **THEN** blueprint validation, Feature projection and review SHALL accept it and review publication SHALL retain the selection fields

#### Scenario: Projection changes or bypasses authority
- **WHEN** blueprint reuse becomes Feature custom or an activated blueprint-bound Feature selects without a mapped decision ref
- **THEN** the existing projection consumer SHALL reject the mismatch or missing reference

#### Scenario: Components share a name across files
- **WHEN** two component entries have the same name in different files
- **THEN** coverage SHALL track each file#name entry independently: both correct mappings pass, either missing or inconsistent mapping fails, and the first entry MUST NOT confer coverage on the second

> **Enforced by:** `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/component-selection-check.ts`, `harness/harness-runner.ts`, `skills/feature/plan/SKILL.md`, `skills/feature/code-review/SKILL.md`, `harness/prompts/verify-review.md`

### Requirement: Static checks report limited facts and reject new unknown debt

Index static_checks SHALL contain scalable_font_unit, no_hardcoded_hex_color and declared_touch_target, each pass|fail|unknown|not_applicable. These report fontSize fp syntax, absence of literal hex colors, and declared interactive dimensions at least 44vp. They MUST NOT claim rendering, truncation, token usage, contrast or device accessibility proof. not_applicable MUST mean no such surface; unresolved applicable surfaces MUST be unknown. Newly registered shared exports introduced by this Feature MUST have no applicable fail/unknown; existing unknown debt does not block. Custom library exports MUST appear in the refreshed index; custom private components require no registration. Newness uses existing source baseline/git history, never a new persistent state store.

#### Scenario: Negative probes
- **WHEN** source changes from fp to vp, gains a hardcoded hex color, or shrinks an interactive dimension below 44vp
- **THEN** the respective check SHALL become fail

#### Scenario: Unknown touch dimensions on a new component
- **WHEN** a new shared interactive export has dynamic or missing dimensions
- **THEN** declared_touch_target SHALL be unknown and the new-code check SHALL fail rather than using not_applicable

#### Scenario: Private and legacy components
- **WHEN** custom remains private or a pre-existing shared export has unknown checks
- **THEN** no new-component quality failure SHALL be raised; a fresh shared export missing from index SHALL fail registration and absent curation SHALL only warn

#### Scenario: Only the export entry changes
- **WHEN** a Feature changes a legal export entry to expose an unchanged formerly private component
- **THEN** current/baseline export comparison SHALL attribute that newly shared asset to the Feature and enforce registration and static checks, while existing shared and still-private components retain their behavior; export-entry attribution stays in memory, not in the index schema

#### Scenario: An unexpanded global Builder hides the UI surface
- **WHEN** a shared component calls a lower-case global Builder that the syntax probe cannot expand
- **THEN** relevant static checks SHALL be unknown rather than not_applicable and SHALL block new shared registration; a genuinely absent surface may remain not_applicable

#### Scenario: Windows fallback spelling differs from the Git tree
- **WHEN** Windows resolves an unchanged Index.ets through fallback spelling index.ets
- **THEN** historical reading SHALL use the existing Git file list to read the matching actual path, preserving legacy identity while still detecting genuinely new exports, without a new baseline store

> **Enforced by:** `profiles/hmos-app/harness/component-extractor.ts`, `harness/scripts/utils/component-selection-check.ts`, `harness/scripts/utils/component-catalog-check.ts`, `harness/tests/unit/component-assets.unit.test.ts`
