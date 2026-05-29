## ADDED Requirements

### Requirement: UT phase detects host artifacts under harness root

The system SHALL detect when host project artifacts (especially UT-related trees
derived from `contracts.modules[].package_path`) are written under `ctx.harnessRoot`
instead of under `ctx.projectRoot`, and MUST report `harness_host_artifact_pollution`
as BLOCKER when any violation is found.

#### Scenario: Misplaced package_path under consumer harness
- **WHEN** `framework/harness/{package_path}/` exists on disk for a module declared in `contracts.yaml`
- **AND** harness-runner executes the `ut` phase for that feature
- **THEN** `check-ut.ts` MUST emit `harness_host_artifact_pollution` with status FAIL and severity BLOCKER
- **AND** details MUST include layout-resilient display paths and migration guidance

#### Scenario: Profile may extend pollution patterns
- **WHEN** the active project profile implements optional `collectHarnessPollutionExtras`
- **THEN** violations from profile extras MUST be merged with core contract-path violations
- **AND** any non-empty merged set MUST trigger BLOCKER (parallel merge, not sequential gates)

> **Enforced by:** `harness/scripts/check-ut.ts`, `harness/scripts/utils/harness-path-guard.ts`, `specs/phase-rules/ut-rules.yaml`
