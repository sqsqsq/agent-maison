## ADDED Requirements

### Requirement: Capability applicability and source resolution are deterministic
The framework SHALL resolve declared phase capabilities before checkers execute. A
capability SHALL declare its mapped quality axis, referenced input IDs, applicable
tracks, optional named pure `applicability_provider_id`, and `on_missing` policy.
Applicability SHALL be decided before any input source is attempted; the framework
MUST NOT implement a generic condition or `when` DSL for this purpose.

For an applicable capability, input source chains SHALL attempt structured artifact or
derive sources in declaration order. `absent` SHALL continue, `resolved` SHALL stop,
and `invalid` SHALL stop and block the capability. A `not_applicable` result after an
applicable capability preflight SHALL be a contract error that blocks the capability.

> **Enforced by:** `specs/skill-contract-schema.yaml`,
> `harness/scripts/utils/skill-contract.ts`, capability-resolution utilities, and
> contract regression tests.

#### Scenario: Non-applicable capability skips all inputs
- **WHEN** a capability's tracks and named applicability provider determine it is not applicable
- **THEN** the capability SHALL be `not_applicable` and none of its input source chains SHALL run

#### Scenario: Applicable multi-input capability receives N/A and invalid results
- **WHEN** an applicable capability has one input report `not_applicable` and another report `invalid`
- **THEN** the capability SHALL be `blocked` independently of input traversal order

#### Scenario: Missing high-priority artifact falls back to derive
- **WHEN** an applicable input's first artifact source is absent and its next derive source resolves
- **THEN** the derive source SHALL be selected and the artifact absence SHALL remain recorded as an attempt

#### Scenario: Invalid authoritative source is not hidden by fallback
- **WHEN** a source returns `invalid` before a lower-priority source
- **THEN** resolution SHALL stop and the capability SHALL be `blocked`

### Requirement: Capability resolution has one immutable pre-check report
The framework SHALL generate exactly one `CapabilityResolutionReport` after
applicability preflight and before phase checker execution. The report SHALL contain
input attempts, selected source/provider, controlled reasons, upstream producer data,
contract fingerprint, and normalized derive-input fingerprints. It SHALL be the only
input-resolution data source for checkers, quality axes, script reports, summaries,
and assess.

The report SHALL describe only pre-check artifact/derive availability. Runtime command
outcomes including build, install, run, trace, and external blocking SHALL remain
`CheckResult` and checker-holder facts and MUST NOT mutate the report.

> **Enforced by:** phase runner integration, `harness/scripts/utils/report-generator.ts`,
> `harness/scripts/utils/quality-axes.ts`, `harness/harness-runner.ts`, and unit tests.

#### Scenario: Runtime device install succeeds after preflight
- **WHEN** device install succeeds inside the testing checker
- **THEN** the report SHALL remain byte-equivalent and install success SHALL be represented only by runtime checks/holder state

#### Scenario: Two report consumers run in one phase
- **WHEN** checker and script-report processing consume capability resolution data
- **THEN** both SHALL receive the same phase report without resolving sources again

### Requirement: Fallback selection freshness binds all actual attempts
The framework SHALL bind every dependency that could have affected a capability's
source selection into evidence freshness: applicability-provider inputs and all source
attempt dependencies from the first attempt through the `resolved` or `invalid`
terminating attempt. This SHALL include absent artifact paths, absent/invalid derive
inputs, and the selected source, but SHALL exclude lower-priority sources never
attempted.

Absent artifact paths SHALL be recorded through the existing evidence representation
with `exists:false` and `sha256:null`. Only project-local attempt dependencies SHALL
enter phase evidence inputs. The contract fingerprint SHALL remain summary/closure
provenance rather than a framework contract file path, so framework upgrades do not stale
historical consumer closures.

> **Enforced by:** `harness/scripts/utils/phase-evidence-manifest.ts`,
> `harness/scripts/utils/gate-fingerprint.ts`, closure finalization, and fixtures.

#### Scenario: Higher-priority artifact appears after derive fallback closure
- **WHEN** a closed phase selected derive because its higher-priority artifact was absent
- **AND** that artifact path later becomes present
- **THEN** evidence freshness SHALL become stale before the old closure qualifies downstream work

#### Scenario: Unattempted lower-priority source changes
- **WHEN** resolution stopped at an earlier resolved or invalid source
- **AND** a never-attempted lower-priority source changes
- **THEN** that change SHALL NOT by itself invalidate the closure

### Requirement: Capability outcomes preserve the existing quality and closure lattice
The framework SHALL mechanically derive `blocked < degraded < full` from applicable
capability states. An optional sparse `minimum_assurance` mapping SHALL add only an
`insufficient_assurance` assess condition and MUST NOT waive quality-axis, phase
advance, closure, or release rules.

A pruned capability SHALL remain explicit in assurance, capability-resolution provenance,
and assess observed degradations, but SHALL NOT alter a quality axis, axis resolution,
phase advance, closure, or release readiness. An explicit `minimum_assurance` floor is
the goal-level gate for an otherwise authorized pruned degradation. A blocked capability
SHALL force release readiness to `BLOCKED` and the top-level projected verdict to at
least `INCOMPLETE` regardless of axis advance exemptions. Its mapped axis SHALL become
`UNVERIFIED` **unless** the axis already carries a deterministic `FAIL`, which SHALL be
preserved (a deterministic FAIL must not be washed into "unverified"); the top-level
projected verdict SHALL NOT downgrade an existing `FAIL` to `INCOMPLETE`.

> **Enforced by:** `harness/scripts/utils/quality-axes.ts`, summary projection,
> `harness/scripts/utils/phase-closure-finalizer.ts`, and `harness/scripts/utils/assess.ts`.

#### Scenario: Floor-satisfying pruned visual capability
- **WHEN** a pruned visual capability satisfies the explicit or absent goal-level floor
- **THEN** assess SHALL record an observed degradation without adding an extra assess gap
- **AND** its quality axes, projected verdict, release readiness, and completion status
  SHALL equal the same check set with no pruned capability report

#### Scenario: Core visual capability is blocked
- **WHEN** an applicable visual capability is blocked because a fail-policy input is absent or invalid
- **THEN** release readiness SHALL be `BLOCKED`, projected verdict SHALL be at least `INCOMPLETE`, and PASS closure SHALL be impossible

### Requirement: Capability declarations are consumed by static and runtime gates
The static contract consistency gate SHALL validate capability input IDs, track
subsets, axis and policy values, named applicability/derive providers, registered
artifact sources, reachable workflow producers, and active-track capability ID
uniqueness.

At phase finalization, a pure consumption assertion SHALL enforce an exact mapping:
every active resolved capability has exactly one same-ID `CheckResult`; pruned,
blocked, and not-applicable capabilities have none; duplicate IDs fail; and every
capability-backed check maps to an active resolved capability and its contract axis.

> **Enforced by:** `harness/scripts/check-contract-consistency.ts`, phase
> runner/checker finalization, and capability-degradation CORE_SUITE tests.

#### Scenario: Resolved capability is missing its check result
- **WHEN** checker execution completes without a same-ID check for an active resolved capability
- **THEN** the runtime consumption assertion SHALL fail the phase

#### Scenario: Pruned capability emits a PASS check
- **WHEN** a pruned capability emits a same-ID PASS or SKIP check
- **THEN** the runtime consumption assertion SHALL fail the phase
