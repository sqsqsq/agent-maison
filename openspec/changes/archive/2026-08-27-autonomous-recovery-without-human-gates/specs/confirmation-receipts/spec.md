## ADDED Requirements

### Requirement: Legacy quality confirmation receipts are readable but inert

Readers MAY parse historical confirmation receipt files and action names for diagnostics and migration, but no receipt, signer identity, user name, chat answer, CLI confirmation, or manual resume SHALL change a deterministic quality verdict, close a required axis, authorize a source mutation, release a repair fuse, advance a phase, or produce `FEATURE_COMPLETED`. New writers MUST NOT issue the retired quality actions. A genuine external permission that cannot be represented by existing preconfigured credentials or external-prerequisite state MUST use a narrowly named `external_authorization` contract and MUST NOT lower any quality gate.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/adjudication.ts`, `harness/scripts/goal-runner.ts`, production zero-consumer scan

#### Scenario: a valid historical waiver cannot release a current FAIL

- **WHEN** a legacy signed receipt matches the current feature and object hash but a deterministic gate is FAIL
- **THEN** the receipt SHALL be reported as deprecated/ignored and the FAIL SHALL continue to repair or terminal handling

## REMOVED Requirements

### Requirement: All hard-gate-lowering authorizations consume one receipt mechanism

**Reason**: Quality gates and recovery may no longer be lowered by human authorization; each former action now routes to repair, requirement correction, machine evidence, capability defer, or a genuine external prerequisite.

**Migration**: Existing receipt files remain readable for audit only. New runs stop issuing `fidelity_downgrade`, `p0_skip_waiver`, `conditional_review_authorization`, `behavior_switch_waiver`, `flow_contract`, `human_visual_acceptance`, `source_mutation_authorization`, crop-signing, and runtime-fidelity quality actions.

### Requirement: Receipt validation enforces a pre-provisioned trust anchor

**Reason**: The generic trust anchor existed only to let confirmation receipts change development quality outcomes. Removing that authority is simpler and avoids building a signing system for facts the harness can verify.

**Migration**: Remove the generic confirmation trust registry after production consumers reach zero. Any separately proven external authorization must define its own narrow existing credential/prerequisite interface and may not reuse the retired quality receipt API.

### Requirement: Missing receipts fail closed to a capped status, never to a clean pass

**Reason**: Missing machine evidence must produce repair, FAIL/UNVERIFIED, or capability defer; it must not create a human-signature waiting state.

**Migration**: Legacy missing/stale receipt diagnostics are reprojected using current machine evidence and quality axes. No consumer waits for a replacement receipt.

### Requirement: Human visual acceptance is a structured receipt with frozen thresholds and bounded remit

**Reason**: Visual quality authority belongs to deterministic checks and current, hash-bound native/delegated machine evidence. A person's name cannot turn a known or unverified defect into PASS.

**Migration**: Existing visual acceptance receipts and `confirmed_by` fields remain historical provenance only. User-reported UX problems after delivery create a correction/successor run.
