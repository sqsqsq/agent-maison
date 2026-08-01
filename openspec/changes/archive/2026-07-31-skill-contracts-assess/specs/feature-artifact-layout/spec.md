## ADDED Requirements

### Requirement: Feature root may contain a disposable next-step projection
The canonical feature root resolved by `harness/config.ts` MAY contain `next.json`. The file SHALL be treated as a recomputable projection rather than a feature artifact, receipt, or completion authority.

#### Scenario: next.json is removed
- **WHEN** a valid projection is deleted before continue
- **THEN** the framework SHALL reconstruct it from artifacts, summaries, workflow, goal, and evidence without losing authoritative state

### Requirement: Artifact compatibility is identified by schema name and version
Skill-authored artifacts SHALL be referenced from contracts by their registered artifact schema identifier and version under `specs/artifact-schemas/`. Existing canonical consumer paths defined by `harness/spec-loader.ts` SHALL remain unchanged unless separately migrated.

#### Scenario: Skill implementation changes without schema break
- **WHEN** a skill changes internal prose or implementation while preserving all produced and consumed schema versions
- **THEN** downstream skills SHALL remain compatible without a path migration
