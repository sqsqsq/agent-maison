## MODIFIED Requirements

### Requirement: Provider review results are written atomically with provider provenance and never produce a verdict

Under `vision_mode: delegated`, the provider review SHALL run inside the testing checker after capture and before strict visual-diff dispatch. It SHALL receive the current reference/device images, screen and round identity, target-node digest, and image hashes, and SHALL return complete per-screen defects, `must_fix`, hash echoes, and any required `region_attest` entries. The provider MUST NOT produce the phase/release verdict. The harness SHALL validate schema, complete target coverage, frozen provider identity, invocation/run/attempt identity, current image hashes, defect-to-`must_fix_refs` anchors, and required region coverage before applying the payload.

Before invocation, the harness SHALL atomically clear only prior provider-owned verdict inputs for the target screens so a failed new attempt cannot inherit old defects, fixes, attestations, pass state, or evaluated hashes. A current deterministic/provider review that validates SHALL be committed by atomic replace with source `{producer:'visual_provider', invoke_id}` and a critic evidence record written before the visual-diff commit. An unavailable/invalid/misidentified/hash-mismatched/workspace-dirtying round SHALL leave no prior provider-derived PASS and SHALL NOT clear an invalidation marker. Only the harness may clear that marker after accepting a fresh review.

`confirmed_by`, human signer predicates, and human visual receipts SHALL NOT exempt a screen from review, survive as authority, close a strict axis, or alter the provider route. Legacy fields MAY remain byte-preserved until the owning writer next rewrites the artifact, but the provider and gate SHALL ignore them. The provider MUST NOT write `confirmed_by`. Deterministic machine FAILs and valid same-invocation provider defects SHALL materialize existing repair candidates without primary-agent or human concurrence.

Enforcement: `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/visual-provider-invoke.ts`, `harness/scripts/utils/critic-receipt-producer.ts`

#### Scenario: a new attempt cannot inherit a provider pass

- **WHEN** attempt N wrote a clean provider result and attempt N+1's provider call is unavailable or invalid
- **THEN** attempt N's provider-derived verdict inputs SHALL already be cleared, and no clean result from N SHALL be consumed as N+1 evidence

#### Scenario: legacy human signature grants no exemption

- **WHEN** a target screen carries `confirmed_by` for its current screenshot
- **THEN** required machine review/gates SHALL run normally and the signer value SHALL not change repair, advance, or release decisions

#### Scenario: valid provider defects drive repair directly

- **WHEN** a same-invocation provider payload passes identity/hash/schema validation and contains an actionable defect
- **THEN** the harness SHALL commit the provider evidence and materialize a repair candidate without `repair_adjudication_pending`

### Requirement: An unusable provider yields a skipped visual-diff, not a blocking failure

An unusable delegated provider SHALL preserve deterministic capture/navigation/tamper checks and SHALL classify the provider-dependent visual evidence separately from product failure. If visual evidence is optional for the current phase and release, the provider-dependent `visual_diff` MAY remain SKIP/UNVERIFIED advisory under the existing policy. If a strict or release-required visual axis cannot be evidenced because the provider/profile capability is unsupported or remains unavailable after bounded retry, the run SHALL project `DEFERRED_CAPABILITY_MISSING`; it MUST NOT advance to `FEATURE_COMPLETED`, fail as a product defect, or wait for a human signature. If the provider declared the required capability but emitted invalid/missing/stale evidence, the visual checker SHALL FAIL and retry/fuse as an evidence-production failure rather than capability-missing.

Enforcement: `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/visual-debt.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/harness-runner.ts`

#### Scenario: optional visual evidence remains advisory

- **WHEN** a non-strict feature has no release-required visual axis and its provider is unavailable
- **THEN** the provider-dependent check MAY be SKIP/UNVERIFIED advisory while deterministic checks still run

#### Scenario: strict provider capability is missing

- **WHEN** a pixel-1-to-1 release-required visual axis has no native or delegated provider capability after bounded retry
- **THEN** the run SHALL defer as capability-missing and SHALL NOT request `confirmed_by`

#### Scenario: capable provider emits invalid payload

- **WHEN** the selected provider declared support but returns a hash-mismatched or incomplete payload
- **THEN** the visual checker SHALL FAIL the round and retry/fuse without labeling it capability-missing

### Requirement: A delegated critic receipt discloses provider evidence truthfully without becoming a threshold

Under `delegated`, critic evidence SHALL record the provider's real adapter/model, invocation identity, current image inputs and hashes, and available structured read-event provenance. The evidence record is machine provenance, not a signing authority: it SHALL NOT by itself create PASS, halt for adjudication, or require a human counterpart. A structurally and identity-valid payload MAY drive repair even when read-event provenance is unavailable and disclosed as `unverified`; however an applicable release-required visual axis SHALL close only when its existing evidence policy accepts the available machine provenance. Invalid means malformed, incomplete, stale, replayed, identity-mismatched, or hash-mismatched — never merely the absence of a human name.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/quality-axes.ts`

#### Scenario: unverified provider evidence can still identify a repair

- **WHEN** a provider has no structured read-event parser but its payload is current, complete, identity-bound, and reports a defect
- **THEN** the defect MAY drive repair while strict release readiness remains governed by the existing machine-evidence policy

#### Scenario: critic evidence never substitutes for a verdict

- **WHEN** a critic evidence record is present but the visual axis has a deterministic FAIL
- **THEN** the FAIL SHALL remain and the record SHALL not act as a receipt or signature

## ADDED Requirements

### Requirement: Visual signal adjudication has no human third authority

A deterministic producer signal whose applicability and evidence contract pass SHALL be treated as machine evidence and materialized as an existing repair candidate when actionable. A valid current delegated-provider signal SHALL follow its provider candidate path. Producer uncertainty, unsupported comparison geometry, or invalid provider output SHALL mean evidence insufficiency: a required axis SHALL remain FAIL/UNVERIFIED or defer for a real capability gap, while an optional axis may remain advisory. The runner MUST NOT create `repair_adjudication_pending`, `await_human_confirm`, or a `confirmed_by` release path for those cases.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/visual-provider-review.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: deterministic signal disputed by the primary agent

- **WHEN** a deterministic producer emits an applicable FAIL-grade signal and the primary agent disputes it without independent machine evidence
- **THEN** the signal SHALL remain actionable and drive the responsible-phase repair path rather than waiting for human judgment

#### Scenario: genuinely uncertain required signal

- **WHEN** the producer cannot establish applicability or reliable evidence for a required visual obligation
- **THEN** the axis SHALL remain unclosed through FAIL/UNVERIFIED or capability defer and SHALL NOT enter a human-sign queue
