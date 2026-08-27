## MODIFIED Requirements

### Requirement: summary 1.1 separates report validity from product quality axes

`summary.json` SHALL carry `report_validity` and harness-derived `quality_axes` with `{applicable, required_for_release, verdict, blocking_class, source_checks[], resolution}`. Applicability and PASS/NOT_APPLICABLE invariants remain machine-validated. Current writers SHALL resolve non-passing applicable axes through `needs_fix` or `external_dependency` with owners `agent|toolchain|external`; quality-derived `needs_human`/owner `human` is legacy-read only and MUST NOT be produced as a way to await a signature. Capability-missing SHALL remain an external/capability projection distinct from evidence FAIL. Axes SHALL never be agent-reported, and non-UI features SHALL mark visual/asset axes not applicable.

Enforcement: `harness/schemas/summary.schema.json`, `harness/scripts/utils/quality-axes.ts`, `harness/harness-runner.ts`

#### Scenario: a legacy needs_human axis is reprojected

- **WHEN** a legacy summary carries visual `UNVERIFIED` with resolution `needs_human`
- **THEN** the current reader SHALL preserve it for diagnostics but current completion SHALL recompute from machine evidence as repair, capability-missing, or optional advisory rather than wait for a signer

### Requirement: Dual projections keep phase advance and release readiness distinct

The top-level phase verdict SHALL be produced only by the active phase matrix and `projectPhaseAdvanceVerdict`; `QualityAxis` MUST NOT gain a persisted `required_for_phase_advance` field or a second required-axis source. Feature completion and `release_readiness` SHALL project only from applicable axes marked `required_for_release` through `projectReleaseReadiness` and `verify-feature-completion`. A required FAIL or UNVERIFIED blocks the corresponding projection; capability-missing projects `DEFERRED_CAPABILITY_MISSING`; optional UNVERIFIED remains advisory only where the current release policy permits it. No human confirmation, receipt, manual resume, or accepted-debt state SHALL lift a deterministic FAIL or required evidence gap.

Enforcement: `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/phase-transition-policy.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: phase matrix and release axis differ without duplicate fields

- **WHEN** a visual axis is optional for the current phase advance but required for release and remains UNVERIFIED
- **THEN** the phase MAY advance under the phase matrix while release remains blocked, with no `required_for_phase_advance` field written to the axis

#### Scenario: deterministic FAIL ignores a signer

- **WHEN** an applicable required axis is FAIL and a legacy human receipt or `confirmed_by` value is present
- **THEN** both current phase/release projections SHALL retain the machine FAIL according to their existing matrices
