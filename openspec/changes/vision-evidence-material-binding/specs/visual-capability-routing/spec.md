# visual-capability-routing Spec Delta

## MODIFIED Requirements

### Requirement: Visual capability depends only on the current execution

The framework SHALL derive visual capability only from the current adapter image-input probe and an admissible canary produced by this run's preflight probe. Existing feature artifacts, artifact verification status, historical failures, and historical policy files MUST NOT lower that capability or change prompt routing.

No per-invocation capability receipt exists. Capability is a run-level fact: the canary written by the preflight probe, admitted by the unchanged freshness and execution-identity predicates.

Enforcement: `harness/scripts/utils/effective-vision-context.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: An unfinished ui-spec cannot blind the next attempt

- **WHEN** a visual-capable invocation writes `ui-spec.yaml` but the harness exits before completing product validation
- **THEN** the next attempt still reports visual capability from its current probe/canary, and no additional per-invocation capability question is issued

### Requirement: Multimodal verification uses current invocation evidence

`verified_method: vl_multimodal` SHALL be accepted only when this run measured its visual capability and the authoritative reference images are covered by a material-addressed read receipt with no current counterevidence contradiction. Historical artifact attestation and policy downgrade records SHALL NOT be required or consumed.

The capability condition SHALL require the resolved capability axis to be `run_probed` **and probe-sourced** — the axis SHALL carry the canary probe timestamp that only the canary branch writes. A `vision.image_input_override` SHALL NOT satisfy it: the override branch returns `run_probed` without reading any canary, and preflight skips probing while it is set, so the run holds no measurement. Refusal text for that state SHALL NOT claim anything was measured.

The evidence condition SHALL be addressed by material rather than by invocation: a reference image read earlier in **this run** SHALL remain acceptable while its content hash is unchanged, and a changed image SHALL invalidate the record and require a re-read. Cross-run reuse SHALL remain forbidden (`goal_run_id` exact equality), and the expected denominator SHALL remain the frozen-manifest discovery set.

Enforcement: `harness/scripts/utils/critic-receipt-producer.ts`, `harness/scripts/check-spec.ts`, `profiles/hmos-app/harness/spec-ui-spec-check.ts`

#### Scenario: Current complete evidence signs without a historical ledger

- **WHEN** this run's probe canary reports `tool_read`, every authoritative reference image is recorded as read with a matching content hash, and the ui-spec has no contradiction
- **THEN** the fidelity gate accepts `vl_multimodal` even when no artifact attestation or policy downgrade file exists

#### Scenario: A declared override is not a measurement

- **WHEN** `vision.image_input_override` is set — with or without a valid probe canary on disk for this run
- **THEN** the sign-off SHALL be refused as "not measured", and neither `details` nor `suggestion` SHALL describe the capability as measured

#### Scenario: A closure round that re-reads nothing still signs

- **WHEN** an earlier invocation of this run read every authoritative reference image and none of those images has changed
- **THEN** the receipt produced by a later invocation SHALL carry those reads forward, the sign-off SHALL hold, and the carried-over count SHALL be disclosed
