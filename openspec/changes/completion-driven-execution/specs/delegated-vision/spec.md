## MODIFIED Requirements

### Requirement: A provider payload is trusted only on same-invocation validation

Provider output SHALL be accepted only when, in the same invocation, all of the following hold: the
stdout envelope projects a non-empty body; the body parses as JSON matching the frozen output schema;
the payload covers every target screen exactly once; and the echoed identity
`{run_id?, attempt_id?, image_hashes[]}` matches the current round's values and the current image
hashes verbatim.

Any of the following SHALL make the round's outcome `unavailable` or `invalid`: missing CLI, spawn
failure, timeout, observed terminal failure, a model that refuses the image, an empty or malformed
envelope, non-JSON or schema-invalid body, a missing/duplicated/extra screen, or an identity or hash
mismatch. **An empty output is never equivalent to "no defects."** Anything the provider may have
written to disk SHALL NOT be trusted in these cases.

The project working tree SHALL be compared before and after the invocation. If it became dirty, this
round's provider result SHALL be discarded and the fact recorded as an event; the framework SHALL NOT
auto-revert and SHALL NOT halt.

Actual provider duration and usage SHALL remain observable. A concrete provider call retains its
real tool timeout and any explicit user deadline; default total-turn, content-retry and wall quotas
SHALL NOT stop observation production.

Observation production SHALL visit the actual reference-image set without a per-run image cap.
Every uncached readable image SHALL receive its best-effort observation attempt. Review
SHALL be bounded by shape rather than by a counter: **one checker execution issues at most one review
invocation, and that invocation SHALL cover every pending target screen in one batch** — per-screen
fan-out is forbidden. No invocation ledger, per-attempt counter, or budget state is introduced.

Every provider call SHALL emit one structured event carrying
`{provider, purpose, image_hashes, outcome, duration_ms, invoke_id}`, and whatever structured event
stream the invocation produced SHALL be persisted under the run's report directory for disclosure.

Enforcement: `harness/scripts/utils/visual-provider-invoke.ts`, `harness/scripts/goal-runner.ts`,
`harness/scripts/check-testing.ts`

#### Scenario: an empty review payload is not a clean bill of health

- **WHEN** the provider returns a syntactically valid payload that covers no screens
- **THEN** the outcome SHALL be `invalid`, no screen SHALL be marked reviewed, and the round SHALL
  continue with blind semantics

#### Scenario: a stale attempt's payload is refused

- **WHEN** a payload echoes an `attempt_id` or an image hash that is not the current round's
- **THEN** the payload SHALL be refused as `invalid` and SHALL NOT be written to any gate artifact

#### Scenario: one batched invocation per checker execution

- **WHEN** a `delegated` checker execution has several pending target screens
- **THEN** exactly one review invocation SHALL be issued, carrying all of those screens

### Requirement: Spec-phase visual observations are best-effort sidecars, never gates

Under `delegated`, spec-phase visual observations SHALL be produced as one best-effort sidecar per
reference image at `<spec reports>/visual-observations/<slug>.visual.json`, using the same slug
sanitization as the OCR pre-scan. The sidecar SHALL carry `{schema_version, protocol_version,
source_image, image_hash, provider {adapter, model}, observations[{region, fact}]}`.

Its status SHALL be identical to the existing OCR pre-scan artifact: best-effort context, not a gate
artifact, producing no check; a single image's failure SHALL NOT block the others, and a total
production failure SHALL NOT block the spec phase — the affected image simply has no sidecar.

A sidecar SHALL be reused only when `image_hash`, `provider.adapter`, `provider.model` and
`protocol_version` all match; otherwise it SHALL be regenerated. The spec method produces observations; other methods SHALL only list existing sidecars,
mirroring the OCR pre-scan. This method selection SHALL NOT create phase author dispatch.

Read-evidence for the sidecar SHALL be recorded truthfully when a structured read-event parser exists
for the provider's adapter and reported as unverified otherwise, and SHALL NOT constitute any
threshold.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/visual-provider-invoke.ts`, `harness/scripts/utils/visual-observation-sidecar.ts`

#### Scenario: a changed endpoint invalidates reuse

- **WHEN** a sidecar exists for an image but the configured provider model differs from the recorded one
- **THEN** the sidecar SHALL be regenerated rather than reused

#### Scenario: sidecar production failure does not fail the phase

- **WHEN** every observation call fails for a spec phase
- **THEN** the spec phase SHALL proceed exactly as it does today with no sidecars listed and no check emitted

#### Scenario: More than twelve actual images need observations
- **WHEN** fifteen readable reference images have no valid sidecars
- **THEN** all fifteen receive best-effort attempts; a failed or missing image does not suppress the others and no default image-count cap truncates the set

#### Scenario: Only affected image identity is regenerated
- **WHEN** current image hash, provider adapter/model and protocol match for every sidecar except one changed image
- **THEN** only that image is regenerated and unaffected current sidecars are reused without another provider call
