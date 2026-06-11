## ADDED Requirements

### Requirement: Phase-scoped feature artifacts use canonical nested paths

The framework SHALL resolve phase-scoped feature artifacts under
`doc/features/<feature>/<phase>/<basename>` as the canonical write path, where
`<phase>` is determined by `PHASE_SCOPED_ARTIFACTS` in `harness/config.ts`.

Global cross-phase contracts (`acceptance.yaml`, `contracts.yaml`,
`use-cases.yaml`, `boundaries.yaml`, `compat.yaml`) SHALL remain at the feature
root directory.

#### Scenario: PRD written under prd subdirectory
- **WHEN** an agent writes `spec.md` for feature `demo`
- **THEN** the canonical path SHALL be `doc/features/demo/spec/spec.md`

#### Scenario: Global contract stays at feature root
- **WHEN** harness loads `contracts.yaml` for feature `demo`
- **THEN** the canonical path SHALL be `doc/features/demo/contracts.yaml`

### Requirement: Dual-read legacy flat paths on read

On read, the framework SHALL prefer the canonical nested path when it exists.
When only a legacy flat path at the feature root exists, the framework SHALL
return that path as `actualPath` with `usedLegacy=true`.

#### Scenario: Legacy flat PRD still readable
- **WHEN** `doc/features/demo/spec.md` exists and `doc/features/demo/spec/spec.md` does not
- **THEN** `resolveFeatureArtifact` SHALL set `exists=true`, `usedLegacy=true`, and `actualPath` to the legacy file

### Requirement: Legacy duplicate warning

The framework SHALL set `legacyDuplicate=true` when both canonical and legacy
paths exist for the same artifact, and harness checks SHALL emit a WARN
suggesting removal of the legacy copy.

#### Scenario: Both paths present triggers duplicate flag
- **WHEN** both `doc/features/demo/spec/spec.md` and `doc/features/demo/spec.md` exist
- **THEN** `legacyDuplicate` SHALL be true and `actualPath` SHALL be the canonical path

### Requirement: Artifact input normalization

The framework SHALL normalize artifact keys that already include a phase prefix
(e.g. `ut/mock-plan.yaml`) to the same canonical path as the basename alone
(`mock-plan.yaml`), without producing double-nested paths such as `ut/ut/`.

#### Scenario: Prefixed ut mock-plan resolves correctly
- **WHEN** resolving `ut/mock-plan.yaml` or `mock-plan.yaml` for feature `demo`
- **THEN** canonical path SHALL be `doc/features/demo/ut/mock-plan.yaml`
