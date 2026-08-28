## ADDED Requirements

### Requirement: Unconsumed file-like contract fields fail closure

The plan contract loader SHALL retain an explicit inventory of supported file-reference fields. Any structured contracts field outside that inventory whose key and value identify a materialized project file MUST produce an invalid-reference BLOCKER; it MUST NOT be silently ignored merely because the artifact schema permits compatibility properties.

Enforcement: `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/contract-reference-closure.ts`, `harness/scripts/check-plan.ts`

#### Scenario: Navigation route-map key is misspelled
- **WHEN** `contracts.yaml` contains `navigation.route_map: src/routes.ts` instead of the registered `route_map_file`
- **THEN** plan closure reports the source field as unconsumed/invalid and does not return an empty reference set

#### Scenario: Extension metadata contains no file path
- **WHEN** a compatibility extension contains scalar metadata that is not file-like
- **THEN** the extension remains accepted and does not gain file authorization
