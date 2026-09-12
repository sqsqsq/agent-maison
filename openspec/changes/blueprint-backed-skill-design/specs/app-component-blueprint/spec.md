## ADDED Requirements

### Requirement: Blueprint construction preparation preserves authority

Blueprint projection SHALL use canonical CU design references and existing revision/hash and admission checks. Acceptance SHALL use the existing semantic checks. Contracts SHALL preserve the explicit files authorization set, ID-only CU mappings, runtime lifecycle and required use cases. Materialization MUST validate the complete candidate before writing through existing artifact paths and MUST reject conflicts with existing decisions.

Enforcement: `harness/scripts/utils/component-blueprint-path.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/check-acceptance.ts`, `harness/scripts/utils/contract-reference-closure.ts`.

#### Scenario: Only reference strings exist
- **WHEN** the CU has verification_refs but no approved executable acceptance or precise construction content
- **THEN** preparation SHALL return a concrete design gap rather than generate placeholder contracts

#### Scenario: Revision or authority differs
- **WHEN** the bound blueprint revision/hash changes or an external contract conflicts with its authority
- **THEN** old projection SHALL be rejected and the gap SHALL return to its design owner

#### Scenario: Write target is absent
- **WHEN** a referenced construction file is absent from explicit contracts.files
- **THEN** projection SHALL fail without expanding authorization from CU touches
