## ADDED Requirements

### Requirement: CU-bound Feature contracts use ID-only construction mappings

For a Feature deterministically derived from a Change Unit, `contracts.yaml` SHALL bind the exact `change_unit_ref` and map canonical CU identifiers to construction evidence without copying or redefining CU content. `predicate_mappings[]`, `provide_mappings[]`, and `design_ref_mappings[]` MUST reference IDs/refs present in the bound canonical CU and map them to real implementation, symbol, test, or verification refs. Every required CU identifier MUST be mapped, and unknown identifiers or copied predicate/provide definitions MUST fail the Feature construction mapping gate.

The existing `contracts.state_management` section SHALL remain the sole Feature-construction authority for runtime facts. CU artifacts SHALL contain only stable blueprint runtime/design refs; no `runtime_flow_slices` or second runtime-detail section may duplicate trigger, owner, mutation, publication, subscription, consumer, freshness, or recovery facts. Features without `change_unit_ref` SHALL retain their existing artifact behavior.

#### Scenario: Canonical CU definitions are mapped, not copied

- **WHEN** a CU-bound Feature maps each canonical predicate/provide/design ref to actual files, symbols, and tests
- **THEN** the construction mapping gate passes without requiring copied CU descriptions in `contracts.yaml`

#### Scenario: Runtime facts remain in state management

- **WHEN** a CU references a P1 runtime flow and the Feature plans its implementation
- **THEN** concrete runtime facts are authored once in `contracts.state_management` and linked to the stable design ref; a parallel `runtime_flow_slices` definition is rejected

#### Scenario: Standalone Feature remains compatible

- **WHEN** an existing Feature has no `change_unit_ref`
- **THEN** its current contracts loading and validation behavior remains unchanged

> **Enforced by (P2 implementation):** `specs/artifact-schemas/contracts.schema.yaml`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-review.ts`
