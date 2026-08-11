# feature-artifact-layout Specification

## Purpose
TBD - created by archiving change feature-artifact-archival. Update Purpose after archive.
## Requirements
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

### Requirement: fidelity-intent.json is the single SSOT for the three routing axes

`<feature>/spec/reports/fidelity-intent.json` (schema 2.0) SHALL be the sole first-production record of the routing decision: `inferred_fidelity`/`selected_fidelity`/`effective_fidelity`, `acceptance_strictness`, `asset_acquisition_mode`, clamp state, `decision{source, rationale, decision_id}`, `execution_identity` and `requirement_sha256`. `decision_id = hash(execution_identity + requirement_sha + routing_input_digest)` where the digest covers manifest fidelity/receipt validity and the capability snapshot — capability or manifest changes never reuse an id. `decision.source=human_confirmed` is reserved for trusted interactive confirmation or receipts; CLI/manifest inputs cap at explicit_cli/manifest_declared. `<feature>/spec/reports/capability-snapshot.json` SHALL record the probe verdicts/sources and execution identity produced by the same initializer; harness context, prompts, check-spec and reports consume these artifacts instead of re-assembling capability booleans or re-deriving axes. spec.md/ui-spec declarations of `fidelity_target`/`asset_acquisition_mode` are projections of this SSOT, produced after it, never the first decision source. Report/summary tier lines derive from the SSOT; the headless-assumptions ledger is not claimed as an anti-rewrite defense.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/fidelity-intent-init.ts`, `harness/harness-runner.ts`

#### Scenario: the first spec working context sees the asset axis before spec.md exists

- **WHEN** the initializer runs for a feature whose requirement says assets come from screenshot cropping
- **THEN** fidelity-intent.json exists with asset_acquisition_mode=auto_crop before any spec.md is generated, and the subsequent harness CheckContext loads assetAcquisitionMode=auto_crop from the same SSOT

