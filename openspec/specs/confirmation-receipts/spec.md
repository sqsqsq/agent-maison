# confirmation-receipts Specification

## Purpose
TBD - created by archiving change goal-fakepass-hardening. Update Purpose after archive.
## Requirements
### Requirement: Legacy quality confirmation receipts are readable but inert

Readers MAY parse historical confirmation receipt files and action names for diagnostics and migration, but no receipt, signer identity, user name, chat answer, CLI confirmation, or manual resume SHALL change a deterministic quality verdict, close a required axis, authorize a source mutation, release a repair fuse, advance a phase, or produce `FEATURE_COMPLETED`. New writers MUST NOT issue the retired quality actions. A genuine external permission that cannot be represented by existing preconfigured credentials or external-prerequisite state MUST use a narrowly named `external_authorization` contract and MUST NOT lower any quality gate.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/adjudication.ts`, `harness/scripts/goal-runner.ts`, production zero-consumer scan

#### Scenario: a valid historical waiver cannot release a current FAIL

- **WHEN** a legacy signed receipt matches the current feature and object hash but a deterministic gate is FAIL
- **THEN** the receipt SHALL be reported as deprecated/ignored and the FAIL SHALL continue to repair or terminal handling
