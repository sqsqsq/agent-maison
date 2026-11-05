## ADDED Requirements

### Requirement: Investigable HMOS build gaps use existing current disposition

Unexplained build/missing-pair/signing-validation failures SHALL be fed to the existing readCurrentDispositionInput / resolveCurrentDisposition and responsibility handling with logs, chosen dimensions, command/environment facts, candidate/pair paths and attempted recovery. A bounded existing no-daemon transaction retry or deterministic dependency recovery MAY precede that handoff. A repeated environment-inconsistent classification alone SHALL NOT automatically set externalBlocked or prohibit a legal author from investigating. The current author MAY repair build configuration/scripts/implementation only within the actual write authority; confirmed missing credentials, permissions, external service or necessary scope expansion SHALL use existing wait/authority handling. Checker/runtime failure SHALL remain framework-owned verification work. Interactive/headless mode SHALL NOT change permissions; no new recovery state, quota, author queue or signature identity SHALL be introduced.

#### Scenario: Locally retried path contradiction remains unexplained
- **WHEN** the configuration's referenced path exists but the real build still fails after the existing transaction retry
- **THEN** the current legal author SHALL receive the investigation with original evidence rather than an automatic external wait

#### Scenario: Signing pairing is unknown
- **WHEN** a signed/unsigned pair cannot be validated and no credential/permission/service cause is confirmed
- **THEN** completion SHALL remain unverified and existing disposition SHALL permit legal investigation without an interaction-mode HARD STOP

#### Scenario: Real external or framework condition is confirmed
- **WHEN** the evidence confirms a missing credential/permission/service, necessary scope expansion, or checker/runtime fault
- **THEN** existing wait/authority or framework verification handling SHALL remain effective and unrelated legal work MAY continue

> **Enforced by:** `profiles/hmos-app/harness/coding-host-rules.ts`, `profiles/hmos-app/harness/ut-hvigor-test-failure.ts`, `harness/scripts/utils/check-disposition.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `skills/reference/business-ut-workflow-detail.md`
