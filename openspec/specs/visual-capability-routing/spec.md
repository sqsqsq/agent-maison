# visual-capability-routing Specification

## Purpose
TBD - created by archiving change simplify-visual-trust. Update Purpose after archive.
## Requirements
### Requirement: Visual capability depends only on the current execution

The framework SHALL derive visual capability only from the current adapter image-input probe and an admissible current-run/current-invocation capability receipt. Existing feature artifacts, artifact verification status, historical failures, and historical policy files MUST NOT lower that capability or change prompt routing.

Enforcement: `harness/scripts/utils/effective-vision-context.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: An unfinished ui-spec cannot blind the next attempt

- **WHEN** a visual-capable invocation writes `ui-spec.yaml` but the harness exits before completing product validation
- **THEN** the next attempt still reports visual capability from its current probe/canary and MAY issue a new inline canary

### Requirement: Visual artifact quality is evaluated without persistent policy state

`vision_output_counterevidence` SHALL return its result for the current artifact directly: contradiction MUST fail the current gate, evidence gap SHALL warn, and a clean result SHALL proceed. The check MUST NOT write an artifact-attestation ledger, a policy-downgrade ledger, or any state that changes later capability routing.

Enforcement: `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/spec-ui-spec-check.ts`

#### Scenario: Missing source mapping remains actionable but recoverable

- **WHEN** two UI texts lack valid `source_ref` mappings
- **THEN** the current gate reports those two evidence gaps and the next attempt remains visual-capable so it can inspect the references and fix them

### Requirement: Multimodal verification uses current invocation evidence

`verified_method: vl_multimodal` SHALL be accepted only when the current invocation has a valid capability receipt, a complete current-invocation reference-read receipt for the authoritative reference set, and no current counterevidence contradiction. Historical artifact attestation and policy downgrade records SHALL NOT be required or consumed.

Enforcement: `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/spec-ui-spec-check.ts`

#### Scenario: Current complete evidence signs without a historical ledger

- **WHEN** the current invocation passes its canary, reads every authoritative reference, and its ui-spec has no contradiction
- **THEN** the fidelity gate accepts `vl_multimodal` even when no artifact attestation or policy downgrade file exists

### Requirement: Legacy visual ledgers are inert

The framework SHALL neither read nor write `artifact-attestations.jsonl` or `policy-downgrades.jsonl` for routing, gating, retry, resume, or completion. It SHALL NOT require migration, acknowledgement, supersede, checkpoint, head, HWM, or tamper handling for those files.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/effective-vision-context.ts`

#### Scenario: A stale blind-safe ledger cannot affect a new run

- **WHEN** a consumer feature contains old policy-downgrade and unverified-attestation rows
- **THEN** a new run ignores them and derives behavior only from current execution evidence
