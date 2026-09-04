## ADDED Requirements

### Requirement: Feature contracts normalize convention application declarations

Feature contracts MAY declare `conventions_applied` as an array of entries with required unique `id` and non-empty `planned_locations`. Every planned location MUST be a canonical project-relative POSIX file path or directory prefix; absolute paths, parent traversal, glob syntax and backslashes MUST fail shape validation. The existing `SpecLoader` SHALL normalize this field once and report invalid shapes through the existing `shape_issues → feature_spec_shape` BLOCKER path; downstream review MUST consume only this normalized object and MUST NOT reparse contracts YAML.

#### Scenario: Valid declaration is loaded

- **WHEN** contracts declare one id with `planned_locations: [src/data, test/data/repository.test.ts]`
- **THEN** `SpecLoader` SHALL preserve canonical values for review consumption

#### Scenario: Invalid path is declared

- **WHEN** a planned location is absolute, contains `..`, a backslash or glob syntax
- **THEN** `SpecLoader` SHALL remove the invalid entry and record a structured `feature_spec_shape` BLOCKER

#### Scenario: Convention id is duplicated

- **WHEN** two entries use the same convention id
- **THEN** the declaration SHALL fail shape validation rather than being collapsed by a Set or last-write-wins behavior

> **Enforced by:** `specs/artifact-schemas/contracts.schema.yaml`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/check-review.ts`
