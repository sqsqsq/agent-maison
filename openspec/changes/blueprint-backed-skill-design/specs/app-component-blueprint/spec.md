## ADDED Requirements

### Requirement: Blueprint construction preparation preserves authority

Blueprint projection SHALL use canonical CU design references and existing revision/hash, provenance, admission and current-slice checks. Design owners SHALL author the existing acceptance/contracts/use_cases structures on referenced targets during design; references, prose and verification_refs alone SHALL NOT become executable content. Acceptance SHALL use the existing semantic checks. Contracts SHALL preserve the explicit files authorization set, ID-only CU mappings, runtime lifecycle and required use cases. The canonical source SHALL omit contracts.change_unit.change_unit_ref; projection SHALL inject the current canonical identity without changing the mappings.

Projection and the review document SHALL share one target selection and content merge function. Selecting a target SHALL inherit its whole typed content. Arrays SHALL merge by the existing projection row identity, deduplicating identical content and rejecting conflicting content with authority_content_conflict. Object-valued keys SHALL only accept identical complete declarations and SHALL NOT merge per key. Shared targets SHALL contain only content all referencing units should inherit; exclusive acceptance, files, use cases and complete change_unit mappings SHALL belong to targets referenced only by their unit. Predicates and touches SHALL NOT filter inherited content or expand authorization. Legitimate sequential writes to the same file SHALL NOT introduce a new overlap gate.

Design readiness SHALL reuse the default read-only projection checks for all non-retired constructable units, including completed units, without materializing artifacts or skipping handwritten use-cases conflicts through pure mode. Each declared content kind SHALL be checked even when another is absent. Absent content SHALL identify the existing spec/plan responsibility without a new missing-field gate; declared invalid structure, authority, write sets, mappings or conflicts SHALL reuse existing reasons and return not-ready. The review document SHALL only show canonical declarations and merge conflicts, with the statement that handoff validation is reported by readiness.

Materialization MUST validate the complete candidate and sources before writing through existing artifact paths and MUST reject conflicts with existing decisions. Equivalent files SHALL not be rewritten; valid handwritten files SHALL not be silently migrated or overwritten. Source stamps, normalized content and canonical CU bindings SHALL remain verifiable through the same existing path.

Enforcement: `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/prepare-blueprint-design.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/check-acceptance.ts`, `harness/scripts/utils/contract-reference-closure.ts`.

#### Scenario: Only reference strings exist
- **WHEN** the CU has verification_refs but no approved executable acceptance or precise construction content
- **THEN** preparation SHALL return a concrete design gap rather than generate placeholder contracts; absent content alone SHALL not add a handoff gate

#### Scenario: Revision or authority differs
- **WHEN** the bound blueprint revision/hash changes or an external contract conflicts with its authority
- **THEN** old projection SHALL be rejected and the gap SHALL return to its design owner

#### Scenario: Write target is absent
- **WHEN** a referenced construction file is absent from explicit contracts.files
- **THEN** projection SHALL fail without expanding authorization from CU touches

#### Scenario: Shared targets carry exclusive mappings by mistake
- **WHEN** CU-B inherits CU-A's mapping from shared target S and also declares a different mapping
- **THEN** merge SHALL report authority_content_conflict
- **AND** if CU-B declares no own mapping, the existing complete checks SHALL report change_unit_predicate_mapping_unknown or change_unit_predicate_mapping_missing as applicable; the document SHALL not hide inherited acceptance or files

#### Scenario: Declared bad use cases coexist with absent acceptance
- **WHEN** a selected target omits acceptance but declares malformed use_cases
- **THEN** readiness SHALL report the existing invalid-content reason without materializing files, rather than returning early at absent acceptance
