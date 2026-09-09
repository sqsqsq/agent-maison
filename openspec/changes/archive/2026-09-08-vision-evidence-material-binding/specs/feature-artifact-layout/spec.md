# feature-artifact-layout Spec Delta

## MODIFIED Requirements

### Requirement: Visual execution artifacts are current receipts only

The feature vision directory SHALL use `spec-refs-receipt.json` as short-lived current execution evidence. `capability-receipt.json` SHALL NOT be produced or read: visual capability is a run-level fact resolved from the preflight probe canary, not a per-invocation artifact. The framework SHALL NOT require or maintain feature-scoped artifact-attestation or policy-downgrade ledgers.

A stale `capability-receipt.json` left by an earlier version SHALL be inert — no consumer reads it, and its presence or contents SHALL NOT change any gate result. No migration step SHALL be required.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/utils/effective-vision-context.ts`

#### Scenario: Upgraded consumer keeps old ledgers without migration

- **WHEN** an upgraded consumer still holds `artifact-attestations.jsonl`, `policy-downgrades.jsonl` and a `capability-receipt.json` from an earlier version
- **THEN** every gate result SHALL be identical to a project with none of those files, and no migration step SHALL be required

#### Scenario: A stale schema 1.0 reference receipt is recomputed, not inherited

- **WHEN** a `spec-refs-receipt.json` at schema `1.0` remains on disk — including on a same-run resume, where its `goal_run_id` equals the current run
- **THEN** the loader SHALL return no receipt, the consumer SHALL report "not yet produced", the producer SHALL recompute from zero, and the stale `read` flags SHALL NOT be inherited
