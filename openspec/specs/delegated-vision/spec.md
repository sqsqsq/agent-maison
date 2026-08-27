# delegated-vision Specification

## Purpose
TBD - created by archiving change delegated-vision-provider. Update Purpose after archive.
## Requirements
### Requirement: Visual routing resolves to one of three modes, derived once and frozen for the run

The framework SHALL derive a `vision_mode` for each run from static facts only:

- `native` — the primary execution identity has image input (the existing three-layer
  `resolveContextAdapterImageInput` chain). The existing native path, including the primary
  capability canary, SHALL be unchanged.
- `delegated` — the primary is blind **and** a visual provider is configured **and** that provider's
  adapter carries a complete `visual_provider` declaration.
- `blind` — every other case, i.e. the existing blind floor.

`vision_mode` SHALL be derived once at preflight and SHALL be immutable for the remainder of the run.
There SHALL be no provider canary and no provider capability probe: the real review/observation call
is itself the probe. The outcome of any provider call SHALL decide only whether **this round's**
visual feedback is trusted; it SHALL NOT rewrite `vision_mode`, model capability truth, the capability
snapshot, or the manifest.

`CapabilitySnapshot` SHALL carry the mode as optional keys `vision_mode` and
`visual_provider {adapter, model}`, written by the same preflight writer that already shares a
`decision_id` with the fidelity-intent SSOT. A snapshot without those keys SHALL keep its current
meaning exactly.

Enforcement: `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/utils/fidelity-shared.ts`,
`harness/scripts/utils/effective-vision-context.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: a failing provider call does not blind the run

- **WHEN** a run resolved `vision_mode: delegated` at preflight and the provider invocation later times out
- **THEN** `vision_mode`, the capability snapshot, and the manifest SHALL be byte-identical to before the
  call, and the next attempt SHALL still be `delegated`

#### Scenario: provider configured but its adapter has no declaration

- **WHEN** the primary is blind and a visual provider is configured for an adapter without a complete
  `visual_provider` declaration
- **THEN** `vision_mode` SHALL be `blind`; a non-UI or explicitly authorized run SHALL proceed on the
  existing blind path, while a UI-related unauthorized run SHALL be refused by the pre-phase blind
  launch prerequisite

### Requirement: Fidelity clamping reads a narrow optional review axis

`FidelityCapability.hasVision` SHALL keep its field name and its meaning (**the primary's** image
input). A new optional field `reviewVision?: boolean` SHALL be added, and
`clampFidelityByCapability` SHALL clamp on `capability.reviewVision ?? capability.hasVision`.

Callers that do not pass `reviewVision` SHALL observe byte-identical behavior. Only the delegated
decision points SHALL pass `reviewVision: true`. The effect is that `native` and `delegated` do not
clamp (`pixel_1to1` is admissible under `delegated`), while the `blind` clamp table is unchanged
verbatim.

Admitting `pixel_1to1` under `delegated` SHALL be defended by current provider/profile capability,
same-invocation payload validation, and the existing visual-axis projection. Unsupported required
capability SHALL defer; declared support with missing, invalid, or stale evidence SHALL fail the
checker and retry/fuse. No human confirmation may substitute for either fact.

Enforcement: `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/goal-runner.ts`,
`harness/harness-runner.ts`, `harness/scripts/check-spec.ts`

#### Scenario: legacy callers are untouched

- **WHEN** any existing caller invokes `clampFidelityByCapability` without `reviewVision`
- **THEN** the clamp result SHALL be identical to the pre-change result for every input combination

#### Scenario: delegated admits the pixel contract

- **WHEN** the run is `delegated` with a `pixel_1to1` selected contract
- **THEN** the effective fidelity SHALL remain `pixel_1to1` and current hash-bound machine evidence
  SHALL remain required for phase/release closure

### Requirement: The capability prompt block states the delegation honestly

Under `delegated`, the phase capability block SHALL keep the blind working method as its base and
additionally state: the agent itself has no vision; a **read-only** visual reviewer identified by
`(adapter, model)` will review each captured screen and return structured defects for the agent to
fix; `.visual.json` observation sidecars may sit beside the reference images; and the agent remains
the **only** writer of project artifacts.

The unattended execution block SHALL decide its pixel-reachability wording from the review axis, so
the two blocks cannot contradict each other.

Enforcement: `harness/scripts/goal-runner.ts`

#### Scenario: the delegated prompt does not claim the agent can see

- **WHEN** a `delegated` phase prompt is built
- **THEN** it SHALL contain the blind-agent instruction and the read-only-reviewer description, and
  SHALL NOT instruct the agent to inspect reference images itself

### Requirement: Provider invocation is physically read-only and reuses the shared invoke lifecycle

A dedicated module SHALL build the provider's `HeadlessInvokePlan` from the adapter's
`visual_provider` declaration. It SHALL NOT reuse the ordinary full-permission argv builders, whose
contract is unconditional full access.

Every real provider call SHALL then be executed through the existing shared headless invoke entry
point. The provider path SHALL NOT re-implement or bypass child spawn, timeout, process-tree kill,
terminal-failure-over-completion arbitration, stdout/stderr collection, or usage backfill. The
provider timeout SHALL be injected through the existing invoke options; usage SHALL be consumed from
the invoke result only, never derived a second time.

The declared model SHALL be replayed into the CLI's own model flag. Images SHALL be passed by their
real in-project paths — there SHALL be no staging copy, so receipt image paths are naturally
identical to the project paths.

Each adapter SHALL project the message text from the shared invoke result according to its own
declared `stdout_envelope`, and SHALL then go through one shared payload validator. For an adapter
whose declared envelope is a terminal-event stream, the projection SHALL run only when the invoke
result reports completion observed and does **not** report a terminal failure; a null projection is
itself an invalid outcome.

An adapter is eligible only with a complete declaration proven by a real smoke run. An incomplete
declaration, or a locked CLI version that does not actually provide the declared read-only isolation,
SHALL disqualify the adapter — the provider SHALL NOT silently fall back to a permissive launch.

Enforcement: `harness/scripts/utils/visual-provider-invoke.ts`,
`harness/scripts/utils/agent-invoke.ts`, `agents/adapter-schema.yaml`

#### Scenario: the provider cannot reach the full-permission argv

- **WHEN** a provider invoke plan is built for any supported adapter
- **THEN** the argv SHALL NOT contain that adapter's full-permission flags, and SHALL contain its
  declared read-only flags plus the model flag carrying the pinned model

#### Scenario: no second process lifecycle

- **WHEN** the provider path executes a plan
- **THEN** the call SHALL go through the shared headless invoke entry point, and the provider module
  SHALL NOT spawn a child, arm a timer, kill a process tree, parse terminal events for settlement, or
  derive usage on its own

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

Provider budget SHALL NOT consume `max_total_turns` or `max_retries_per_phase`. It consumes wall
clock and counts into the invoke result's usage.

Observation production SHALL be bounded by the reference-image count and by a per-run cap. Review
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

### Requirement: Provider failure degrades the round, never the development loop

Provider failure SHALL degrade or defer the affected machine-evidence obligation and SHALL never
create a human quality-signature path.

When a provider/profile does not support required visual evidence, or bounded probing proves it
unavailable before execution, the framework SHALL use the existing capability-missing defer without
content retries. Optional evidence MAY use the existing advisory degradation policy. When a provider
declared support but the current round is missing, invalid, stale, replayed, or identity/hash
mismatched, the owning checker SHALL FAIL and retry/fuse as evidence production failure. Neither path
waits for a human, enters an adjudication stop, or synthesizes PASS. False positives remain bounded by
current machine evidence, the no-progress fuse, and correction/successor runs.

Enforcement: `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`,
`harness/scripts/utils/visual-debt.ts`, `harness/harness-runner.ts`

#### Scenario: unsupported required provider defers

- **WHEN** required delegated visual capability is unsupported after bounded probe
- **THEN** the run SHALL project capability-missing without invoking content repair

#### Scenario: supported provider invalid output fails

- **WHEN** the selected provider declared support but returns a stale or hash-mismatched payload
- **THEN** the visual checker SHALL FAIL and retry/fuse rather than treating the output as unsupported

### Requirement: Spec-phase visual observations are best-effort sidecars, never gates

Under `delegated`, spec-phase visual observations SHALL be produced as one best-effort sidecar per
reference image at `<spec reports>/visual-observations/<slug>.visual.json`, using the same slug
sanitization as the OCR pre-scan. The sidecar SHALL carry `{schema_version, protocol_version,
source_image, image_hash, provider {adapter, model}, observations[{region, fact}]}`.

Its status SHALL be identical to the existing OCR pre-scan artifact: best-effort context, not a gate
artifact, producing no check; a single image's failure SHALL NOT block the others, and a total
production failure SHALL NOT block the spec phase — the affected image simply has no sidecar.

A sidecar SHALL be reused only when `image_hash`, `provider.adapter`, `provider.model` and
`protocol_version` all match; otherwise it SHALL be regenerated. Production happens in the spec phase
only; plan and coding phases SHALL only list existing sidecars, mirroring the OCR pre-scan dispatch.

Read-evidence for the sidecar SHALL be recorded truthfully when a structured read-event parser exists
for the provider's adapter and reported as unverified otherwise, and SHALL NOT constitute any
threshold.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/visual-provider-invoke.ts`

#### Scenario: a changed endpoint invalidates reuse

- **WHEN** a sidecar exists for an image but the configured provider model differs from the recorded one
- **THEN** the sidecar SHALL be regenerated rather than reused

#### Scenario: sidecar production failure does not fail the phase

- **WHEN** every observation call fails for a spec phase
- **THEN** the spec phase SHALL proceed exactly as it does today with no sidecars listed and no check emitted
