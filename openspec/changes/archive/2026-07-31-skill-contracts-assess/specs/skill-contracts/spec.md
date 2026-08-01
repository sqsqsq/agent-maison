## ADDED Requirements

### Requirement: Feature skills publish versioned machine-readable contracts
The framework SHALL provide `skills/feature/<skill>/contract.yaml` for all seven feature skills, with phase sections declaring required and optional inputs, absent-input effects, produced artifacts, verifier providers, and quality tiers. Enforcement SHALL be implemented by `specs/skill-contract-schema.yaml` and the contract loader under `harness/scripts/utils/`.

#### Scenario: All feature skills have valid contracts
- **WHEN** framework regression loads every feature skill
- **THEN** exactly seven contract files SHALL validate and change/exit SHALL resolve through the change-lite contract

### Requirement: Skill-authored artifacts use versioned compatibility schemas
The framework SHALL maintain versioned schemas under `specs/artifact-schemas/` for the complete inventory of skill-authored artifacts discovered from `harness/spec-loader.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, and feature-skill output declarations.

#### Scenario: A produced artifact lacks a registered schema
- **WHEN** a feature contract produces an artifact that is absent from the generated inventory
- **THEN** `check-contract-consistency` MUST fail framework regression

### Requirement: Contract dependencies form a valid producer-consumer graph
The framework SHALL derive phase-to-artifact producer edges from contract outputs and validate every artifact input against the producer phases reachable through `effectiveRequires(track)`. Workflow-only ordering edges SHALL be explicitly classified as control dependencies. Enforcement SHALL live in `harness/scripts/check-contract-consistency.ts` and reuse `harness/scripts/utils/runtime-policy.ts`.

#### Scenario: Hidden artifact dependency is declared by prose only
- **WHEN** a skill consumes a versioned artifact with no reachable producer in its active workflow closure
- **THEN** the consistency gate MUST fail and identify the consumer and missing producer

#### Scenario: Workflow edge transfers no artifact
- **WHEN** a required workflow edge exists only for sequencing or source-state control
- **THEN** the edge SHALL be marked as a control dependency rather than inventing an artifact

### Requirement: Tier selection is deterministic
Contract `when` predicates SHALL use only `present`, `alternative`, `all`, `any`, `not`, and one `otherwise`. The consistency gate SHALL enumerate declared input combinations and MUST reject zero-match or multi-match outcomes. V1 SHALL NOT support priority-based overlapping tiers.

#### Scenario: Two tiers match the same inputs
- **WHEN** contract predicates produce more than one selected tier for an enumerated input combination
- **THEN** contract validation MUST fail

#### Scenario: No tier matches
- **WHEN** contract predicates leave an enumerated input combination unmatched
- **THEN** contract validation MUST fail

### Requirement: Tier satisfaction is contract-local
Each tier SHALL declare an explicit `satisfies` set, and depth comparison SHALL occur only inside the same skill contract. Enforcement SHALL be shared by the contract loader and `harness/scripts/assess.ts`.

#### Scenario: Adhoc and basic labels belong to different contracts
- **WHEN** assess evaluates the required depth for a phase
- **THEN** it MUST NOT compare tier names globally or infer an ordering not declared by that phase's contract
