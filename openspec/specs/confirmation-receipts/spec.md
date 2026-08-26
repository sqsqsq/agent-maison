# confirmation-receipts Specification

## Purpose
TBD - created by archiving change goal-fakepass-hardening. Update Purpose after archive.
## Requirements
### Requirement: All hard-gate-lowering authorizations consume one receipt mechanism

Any decision that lowers a hard gate — fidelity downgrade (t6), P0 skip/unreachable waiver upgrade (t5), conditional-review authorization (t2 consumption), behavior-switch waiver (t3), and acceptance.flow_contract confirmation (t4) — SHALL be honored only when accompanied by a valid confirmation receipt validated through the single shared util. Ledger entries, chat answers recorded by the agent, CLI flags, manifest fields, and `signed_by` strings SHALL NOT individually or jointly constitute authorization. This applies identically in headless and interactive modes: user presence does not lower the verification standard.

Enforcement: `harness/scripts/utils/confirmation-receipt.ts`（新增，唯一校验入口）, 五消费点接线于 `harness/scripts/check-{spec,review,testing,coding}.ts`、`harness/scripts/goal-runner.ts`

#### Scenario: agent-recorded "user agreed" does not downgrade fidelity

- **WHEN** an interactive session's ledger records "用户同意降为 semantic_layout" but no valid receipt exists
- **THEN** the effective downgrade SHALL NOT occur and the run outcome SHALL cap at AWAITING_HUMAN_REVIEW

### Requirement: Receipt validation enforces a pre-provisioned trust anchor

A receipt SHALL carry `receipt_id`, `issuer_id`, `key_id`, `alg`, `payload_schema_version` and bind `run_id`, `feature`, `action`, `object_hash`, `expiry`. The signature SHALL cover the canonicalized payload in full. Verification keys SHALL be resolved exclusively from a pre-provisioned trusted registry / runtime policy configuration; keys embedded in the receipt or supplied ad hoc SHALL be rejected. **The trusted registry SHALL NOT be resolved from the project root (an agent-writable location)**: it is read from `MAISON_TRUST_REGISTRY` (env) or the user home directory, and a project-root registry file SHALL NOT be consumed even if present — otherwise an agent self-builds a registry and self-signs. When `expected.run_id` is provided the payload SHALL carry a matching `run_id` (a missing payload `run_id` SHALL fail — no optional cross-run replay). Unknown issuer, key, or algorithm SHALL yield INVALID. MAC is permitted only where the verification key is unreadable by the agent; the HMAC key env name SHALL use the `MAISON_HMAC_` prefix so the invocation layer strips it (along with `MAISON_TRUST_REGISTRY`) from the agent subprocess environment; otherwise asymmetric signatures are required. Key rotation and revocation SHALL be supported such that revoking a key invalidates its receipts. Issuance is out of scope for this change (a follow-up `confirmation-credential-issuance` change owns it; no local/TTY issuer exists).

Enforcement: `harness/scripts/utils/confirmation-receipt.ts`, receipt schema（与 runtime-policy-core 共评审冻结）

#### Scenario: self-signed receipt with embedded public key is rejected

- **WHEN** an agent generates a keypair, signs a receipt, and embeds the public key in the receipt file
- **THEN** validation SHALL return INVALID because the key is not resolvable from the pre-provisioned trust registry

### Requirement: Missing receipts fail closed to a capped status, never to a clean pass

When a required receipt is absent, expired, unbound (hash mismatch), or stale (any bound artifact changed), work MAY continue but the goal/feature outcome SHALL cap at AWAITING_HUMAN_REVIEW and SHALL NOT reach FEATURE_COMPLETED. No gate consuming receipts SHALL degrade a missing receipt to WARN.

Enforcement: `harness/scripts/utils/confirmation-receipt.ts`, `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: flow_contract receipt goes stale after acceptance edit

- **WHEN** acceptance.yaml flows are edited after a flow_contract receipt was issued
- **THEN** the receipt SHALL be treated as stale by hash mismatch and the feature SHALL cap at AWAITING_HUMAN_REVIEW until re-confirmed

### Requirement: Human visual acceptance is a structured receipt with frozen thresholds and bounded remit

A new consumption action `human_visual_acceptance` SHALL validate receipts binding: feature; build_fingerprint; rubric_version; policy_hash; gate_fingerprint; a structured screens mapping `[{screen_id, variant, reference_sha256, actual_sha256}]` (hash-array reordering cannot pass); rubric scores `{container, hierarchy, density, state_color}`; verdict; accepted_debt_ids[]; signed_by/signed_at. Thresholds are frozen before acceptance and SHALL NOT be recalibrated after seeing results: each dimension ≥4/5 by default; any dimension at 3 requires an explicit accepted_debt_id; any dimension at 1–2 SHALL NOT pass. A valid receipt clears subjective visual debt only (visual UNVERIFIED→PASS, debt entries → `accepted` with accepted_by + receipt reference — never rewritten to `closed`); it SHALL NOT clear deterministic FAILs (blank assets, missing/stale evidence, hash mismatches — needs_fix items clear only by fix + re-run). Any bound hash or policy_hash mismatch SHALL stale the receipt. Trust-anchor validation reuses the existing confirmation-receipt consumption contract; issuance remains out of scope.

Enforcement: `harness/scripts/utils/confirmation-receipt.ts`, `harness/scripts/utils/visual-debt.ts`（新增）, `harness/scripts/check-receipt.ts`

#### Scenario: a receipt attempts to clear a blank-asset FAIL

- **WHEN** a valid human_visual_acceptance receipt lists a debt id whose source check is the blank-materialization BLOCKER
- **THEN** validation SHALL reject clearing that entry, leaving the deterministic FAIL and its release block intact

#### Scenario: reordered hashes fail closed

- **WHEN** a receipt's screens mapping pairs screen A's reference hash with screen B's actual hash
- **THEN** binding validation SHALL fail the receipt as stale/invalid rather than accepting set-equality

