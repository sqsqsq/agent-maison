# verdict-lattice Spec Delta

## MODIFIED Requirements

### Requirement: summary 1.1 separates report validity from product quality axes

`summary.json` SHALL carry `report_validity` and harness-derived `quality_axes` with `{applicable, required_for_release, verdict, blocking_class, source_checks[], resolution}`. Applicability and PASS/NOT_APPLICABLE invariants remain machine-validated. Current writers SHALL resolve non-passing applicable axes through `needs_fix` or `external_dependency` with owners `agent|toolchain|external`; quality-derived `needs_human`/owner `human` is legacy-read only and MUST NOT be produced as a way to await a signature. Capability-missing SHALL remain an external/capability projection distinct from evidence FAIL. Axes SHALL never be agent-reported, and non-UI features SHALL mark visual/asset axes not applicable.

A visual or asset axis that is applicable by ui-spec but has **no check mapped to it** in the current phase (zero-mapped: `source_checks` would be empty — ut has no visual check, plan/review/ut have no asset check) SHALL be `NOT_APPLICABLE` for that phase rather than `UNVERIFIED`; the criterion is zero mapping, not zero execution, so a mapped check that only SKIPs (blind tier) still yields `UNVERIFIED`. The asset axis in the testing phase is excepted: its zero-check state is the entry condition of `applyAssetAxisInheritance` and SHALL stay applicable `UNVERIFIED` so the coding-phase asset verdict can be inherited as evidence references (PASS with intact provenance, STALE on drift, unchanged when no coding summary exists). Phase advance is unaffected (`projectPhaseAdvanceVerdict` skips `NOT_APPLICABLE` axes).

Enforcement: `harness/schemas/summary.schema.json`, `harness/scripts/utils/quality-axes.ts`, `harness/harness-runner.ts`

#### Scenario: a legacy needs_human axis is reprojected

- **WHEN** a legacy summary carries visual `UNVERIFIED` with resolution `needs_human`
- **THEN** the current reader SHALL preserve it for diagnostics but current completion SHALL recompute from machine evidence as repair, capability-missing, or optional advisory rather than wait for a signer

#### Scenario: zero-mapped visual/asset axes are not applicable outside testing

- **WHEN** the ui-spec declares assets and the ut phase closes with no visual or asset check mapped
- **THEN** both axes SHALL be `NOT_APPLICABLE` and `validateSummaryV11` SHALL accept the summary
- **AND** a single `asset_*` check that SKIPs SHALL still yield an applicable `UNVERIFIED` asset axis

#### Scenario: testing keeps the asset inheritance entry

- **WHEN** the testing phase closes with visual checks but no asset check
- **THEN** the asset axis SHALL stay applicable `UNVERIFIED` with empty `source_checks`, and `applyAssetAxisInheritance` SHALL decide PASS/STALE from the coding summary provenance
