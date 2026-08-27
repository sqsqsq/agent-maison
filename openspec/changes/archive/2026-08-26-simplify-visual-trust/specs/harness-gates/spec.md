## MODIFIED Requirements

### Requirement: The fidelity pregate re-verifies the routing SSOT instead of first-producing decisions

`fidelity_capability_pregate` SHALL load `fidelity-intent.json` and re-verify internal routing consistency, selected-fidelity projection consistency, stable requirement-source identity, and the genuine hard-pixel/current-capability conflict. It MUST NOT recompute requirement identity from files generated during the phase, and it MUST NOT consume artifact attestation or policy downgrade state. For UI-relevant features a missing SSOT is BLOCKER pointing at the initializer; non-UI features proceed without one. The pregate SHALL NOT produce the decision.

Enforcement: `harness/scripts/check-spec.ts`, `harness/scripts/utils/fidelity-shared.ts`

#### Scenario: Generated output does not invalidate the pregate

- **WHEN** spec creates an output file named in the requirement after routing initialization
- **THEN** pregate continues using the frozen source identity and does not report requirement SHA drift

### Requirement: Ruling-class escalation reads the hard-pixel contract; execution keeps the pixel target

Severity ratcheting, human-confirmation requirements and completion capping SHALL key on `isHardPixelContract`; high-fidelity execution machinery keeps keying on the pixel execution target. Under best_effort, quality gaps keep their default severities and are recorded as visual debt. Deterministic content integrity failures remain unconditional BLOCKERs. Historical visual ledger corruption or tamper SHALL NOT be a gate input because those ledgers are retired.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/check-spec.ts`, `harness/harness-runner.ts`

#### Scenario: Evidence gap does not become a future routing state

- **WHEN** a best-effort visual check reports an evidence gap
- **THEN** the current report records the gap at its default severity and later attempts are unaffected except through the current artifact contents

## ADDED Requirements

### Requirement: Agent-authored feature YAML cannot crash the harness

The feature spec loader SHALL catch YAML syntax failures in `contracts.yaml`, `acceptance.yaml`, and `use-cases.yaml`, preserve the file name, parser code and available line/column in `shape_issues`, and continue the current harness run. The existing `feature_spec_shape` check SHALL emit a structured BLOCKER in the same run; a malformed file MUST NOT terminate the harness before summary generation.

Enforcement: `harness/scripts/utils/spec-loader.ts`, `harness/harness-runner.ts`

#### Scenario: Plain scalar containing colon-space is reported in the same run

- **WHEN** an acceptance `device_focus` plain scalar contains an unquoted `subtitle_position: below` and YAML reports `BLOCK_AS_IMPLICIT_KEY`
- **THEN** the current harness report contains an actionable `feature_spec_shape` failure naming `acceptance.yaml` and its line/column, while unrelated checks still execute
