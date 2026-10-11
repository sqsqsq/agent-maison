## ADDED Requirements

### Requirement: Blueprint construction preparation preserves authority

Blueprint projection SHALL use canonical CU design references and existing revision/hash, provenance, admission and current-slice checks. Design owners SHALL author the existing acceptance/contracts/use_cases structures on referenced targets during design; references, prose and verification_refs alone SHALL NOT become executable content. Acceptance SHALL use the existing semantic checks. Contracts SHALL preserve design facts, models, interfaces, the explicit files authorization set, runtime lifecycle and required use cases. The entire contracts.change_unit SHALL be authored by plan in Feature contracts.yaml, using the current canonical CU identity and real implementation/test mappings; design projection SHALL omit it, including legacy blueprint mappings. Missing future mappings SHALL not block design readiness, while complete mapping checks SHALL remain at plan and later consumers. A design projection alone SHALL not satisfy pending plan work.

Projection and the review document SHALL share one target selection and content merge function. Selecting a target SHALL inherit its whole typed content. Arrays SHALL merge by the existing projection row identity, deduplicating identical content and rejecting conflicting content with authority_content_conflict. Object-valued keys SHALL only accept identical complete declarations and SHALL NOT merge per key. Shared targets SHALL contain only content all referencing units should inherit; exclusive acceptance, files and use cases SHALL belong to targets referenced only by their unit. Stable design nodes SHALL NOT be copied or versioned to carry a revised or replacement CU mapping. Predicates and touches SHALL NOT filter inherited content or expand authorization. Legitimate sequential writes to the same file SHALL NOT introduce a new overlap gate.

Design readiness SHALL reuse the default read-only projection checks for all non-retired constructable units, including completed units, without materializing artifacts or skipping handwritten use-cases conflicts through pure mode. Each declared content kind SHALL be checked even when another is absent. Absent content SHALL identify the existing spec/plan responsibility without a new missing-field gate; declared invalid structure, authority, design write sets or conflicts SHALL reuse existing reasons and return not-ready. The review document SHALL only show canonical declarations and merge conflicts, with the statement that handoff validation is reported by readiness.

Normal handoff SHALL NOT materialize Feature acceptance/contracts/use-cases files; spec and plan SHALL consume derived inputs and write their own outputs. Explicit materialization remains a compatibility path. Source-stamped files SHALL permit non-conflicting stage supplementation under the same authoritative alignment used by handwritten content. Refresh SHALL only update source/reference identity when unchanged design and CU contract content is provable, preserving business and supplementary bytes; real content changes or unavailable equivalence SHALL return to the responsible stage without merging or overwriting. Materialization MUST validate the complete candidate and sources before writing through existing artifact paths and MUST reject conflicts with existing decisions. Equivalent files SHALL not be rewritten; valid handwritten files SHALL not be silently migrated or overwritten. Source stamps, normalized content and canonical CU bindings SHALL remain verifiable through the same existing path.

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

#### Scenario: Legacy mappings do not redefine replacement construction
- **WHEN** shared or exclusive blueprint targets contain legacy change_unit mappings for another CU
- **THEN** common design extraction SHALL omit those mappings without altering canonical history or hiding inherited acceptance/files
- **AND** plan SHALL generate current Feature mappings; missing/unknown/stale IDs and unauthorized files SHALL still fail the existing construction checks

#### Scenario: Declared bad use cases coexist with absent acceptance
- **WHEN** a selected target omits acceptance but declares malformed use_cases
- **THEN** readiness SHALL report the existing invalid-content reason without materializing files, rather than returning early at absent acceptance
