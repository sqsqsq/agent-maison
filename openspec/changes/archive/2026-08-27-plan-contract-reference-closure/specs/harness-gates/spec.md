## ADDED Requirements

### Requirement: Plan closure proves contract file-reference authorization

Before plan closure can pass, the harness SHALL parse `contracts.yaml` through the production contracts loader, resolve every schema-defined file reference into a normalized in-memory view, and require `references ⊆ contracts.files`. File references SHALL include at least `resource_keys[*].path`, media paths, page/route registration files, HAR index/builder/export files and every other contracts-schema field that identifies a materialized file. A missing membership MUST produce a plan-phase BLOCKER naming the path and source field.

Enforcement: `harness/scripts/check-plan.ts`, `harness/scripts/utils/contracts-loader.ts`, `harness/scripts/utils/contract-reference-closure.ts`, `specs/phase-rules/plan-rules.yaml`

#### Scenario: Undeclared resource media blocks closure

- **WHEN** `resource_keys` references twenty logo media paths and none is present in top-level `contracts.files`
- **THEN** plan closure MUST fail and list the undeclared media references before coding starts

#### Scenario: Adding every referenced path closes the contract

- **WHEN** the same contract is regenerated with all twenty media paths in `contracts.files`
- **THEN** the reference-closure gate SHALL pass without changing any later UI-scope rule

#### Scenario: Legal contract remains unaffected

- **WHEN** every normalized schema-defined file reference is already a member of normalized `contracts.files`
- **THEN** the new gate SHALL not add a warning or failure

### Requirement: Contract reference expansion has one recovery path

The harness MUST NOT authorize a missing reference because the file exists, matches bytes under spec/assets, is generated, is named by another field, or appears in a test-only fact table. The only persistent authorization input SHALL be `contracts.files`; recovery SHALL instruct the plan owner to add the path there and rerun plan closure. The derived reference view MUST remain in memory and MUST NOT be written as a graph, manifest or sidecar.

Enforcement: `harness/scripts/utils/contract-reference-closure.ts`, `harness/scripts/check-plan.ts`, `skills/feature/plan/SKILL.md`

#### Scenario: Matching asset bytes do not grant scope

- **WHEN** an undeclared media file is byte-identical to a referenced spec asset
- **THEN** plan closure MUST still fail until the path is added to `contracts.files`

#### Scenario: Closure writes no derived authorization artifact

- **WHEN** reference closure passes
- **THEN** the feature tree SHALL contain no persisted reference graph, authorization manifest or additional allowlist
