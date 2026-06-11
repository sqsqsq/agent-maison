## MODIFIED Requirements

### Requirement: Phase check scripts enforce phase-rules

The system SHALL enforce each harness phase using a dedicated check script paired
with a phase-rules YAML file under `specs/phase-rules/`.

#### Scenario: Spec phase has check and rule pair
- **WHEN** harness-runner executes the `spec` phase
- **THEN** it MUST invoke `harness/scripts/check-spec.ts` against `specs/phase-rules/spec-rules.yaml`

#### Scenario: Plan phase has check and rule pair
- **WHEN** harness-runner executes the `plan` phase
- **THEN** it MUST invoke `harness/scripts/check-plan.ts` against `specs/phase-rules/plan-rules.yaml`

#### Scenario: Workflow DAG defines phase dependencies
- **WHEN** harness resolves the active workflow
- **THEN** it MUST load `workflows/spec-driven.workflow.yaml` (or the configured `active_workflow`) and honor each artifact's `requires` dependencies

## ADDED Requirements

### Requirement: Legacy phase id alias with warning

The harness SHALL accept legacy phase ids `prd` and `design` as aliases for
`spec` and `plan` respectively, normalizing them before check execution and
emitting a WARN on first use per run.

#### Scenario: Legacy prd phase id runs spec checks
- **WHEN** harness-runner is invoked with `--phase prd`
- **THEN** it MUST execute spec-phase checks and emit a deprecation WARN

#### Scenario: In-flight current-phase resumes with legacy id
- **WHEN** `.current-phase.json` contains `"phase": "plan"` after framework upgrade
- **THEN** goal-runner or harness MUST normalize to `plan` and continue without manual edit

### Requirement: Spec to plan traceability gate

The harness SHALL verify that structured non-functional, security, performance,
and DFX constraints declared in spec (`acceptance.yaml` or spec.md structured
blocks) have corresponding implementation entries in `plan.md` or
`contracts.yaml`.

#### Scenario: Missing plan mapping fails trace check
- **WHEN** spec declares a BLOCKER security constraint without a plan/contracts mapping
- **THEN** the spec→plan traceability check SHALL FAIL with severity BLOCKER

### Requirement: Check id alias for renamed gates

The harness SHALL resolve legacy check ids (`prd_p0_coverage`,
`scope_consistency_with_prd`, etc.) to renamed counterparts (`spec_p0_coverage`,
`scope_consistency_with_spec`) when reading `phase_rules_overlays` and
`compat.yaml` exempt patterns.

#### Scenario: Overlay references legacy prd check id
- **WHEN** an instance overlay keys `prd_p0_coverage` after rename
- **THEN** harness MUST apply the overlay to `spec_p0_coverage` and emit a WARN
