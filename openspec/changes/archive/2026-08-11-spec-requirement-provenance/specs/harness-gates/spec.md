# harness-gates Spec Delta

## ADDED Requirements

### Requirement: The phase initializer records explicit requirement provenance; derive.requirement accepts it as the phase-driven source

The phase-driven `/spec` path (no goal run identity) SHALL obtain its authoritative requirement from a `fidelity-intent.json` SSOT whose `requirement_provenance` is `explicit_cli` and whose `execution_identity` matches the current `phase:<feature>:spec`. The shared `FidelityRoutingInitInput` SHALL require `requirementProvenance` at every call site: goal mode passes `goal_manifest`, the phase CLI passes `explicit_cli` (explicit non-empty requirement) or `intent_fallback` (broad-intent fallback only) and SHALL NOT emit `goal_manifest`. The `fidelity-intent-init` CLI SHALL accept `--requirement-file` through the same shared resolver, and SHALL fail fast on an explicitly empty `--requirement` rather than silently falling back to broad intent text. Broad intent text (README/notes/`spec.md`) or a missing/`intent_fallback`/legacy SSOT SHALL NOT satisfy `on_missing: fail`; `change.md` remains the legacy fallback.

Enforcement: `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/goal-preflight.ts`, `harness/scripts/fidelity-intent-init.ts`

#### Scenario: manual spec links to an explicit requirement

- **WHEN** a fresh feature is produced by `fidelity-intent-init --feature <f> --requirement "<text>"` (or `--requirement-file <path>`)
- **THEN** the SSOT records `requirement_provenance: explicit_cli` with `execution_identity: phase:<f>:spec`, and `derive.requirement` resolves, binding `fidelity-intent.json` (path + sha256) as the closure dependency

#### Scenario: no explicit requirement stays blocked

- **WHEN** Step 1 runs without a requirement (falling back to broad intent text) and no `change.md` exists
- **THEN** `derive.requirement` stays absent, the requirement capability stays blocked (INCOMPLETE), and the failure detail lists the attempted sources plus the two repair paths (goal manifest / re-run Step 1 with `--requirement(-file)`); a legacy SSOT without `requirement_provenance` is NOT treated as corrupt

### Requirement: Blocked capabilities project deterministically into the diagnostic and decision exits

A blocked capability SHALL remain a pre-check fact that produces no `CheckResult` (the consumption bijection stays unchanged). The harness SHALL project it into the exits agents and humans already read, without inventing new statuses or parallel protocols:

- `readiness_signals` SHALL include `capability_input_unresolved` (status `incomplete`) naming the capability, input, attempt source, and bound dependency paths when present; wider claim text SHALL NOT be hardcoded into the generic projection (repair language, e.g. requirement-specific advice, lives only in the provider's own attempt detail).
- `next_action` SHALL return `resolve_capability_inputs_then_rerun` only when `blockers.length === 0`, `blockingSkips.length === 0`, no run status claims-done `false`, and at least one capability is blocked; real blockers/SKIPs/run-statuses take precedence.
- The assess `failed` gap for a locally-blocked phase (unresolved attempts without an `upstream_producer`) SHALL carry capability/input/attempt detail and keep recommendation `rerun_phase`; explicit external/device/deferred blockers SHALL keep `deferred`/`resolve_deferred`.
- `merged-report.md` SHALL include a blocked-capability section (human-facing, non-gating) and SHALL NOT claim PASS while a capability is blocked.
- A capability-projection difference where `pre === legacy` and `post !== legacy` SHALL NOT be reported as `quality_axes_projection_mismatch`; an independent real mismatch (`pre !== legacy`) SHALL still be reported. Projection SHALL preserve an existing deterministic axis `FAIL` (never downgrade to `INCOMPLETE`).

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/utils/report-generator.ts`

#### Scenario: blocked requirement surfaces a diagnostic trio

- **WHEN** a fresh manual `/spec` run has no explicit requirement and no `change.md`
- **THEN** `readiness_signals` contains `capability_input_unresolved`, `next_action` is `resolve_capability_inputs_then_rerun`, and the assess `failed` gap detail names the capability/input/attempt; `merged-report.md` lists the blocked capability and does not claim PASS

#### Scenario: hard FAIL alongside a blocked capability stays FAIL

- **WHEN** a deterministic BLOCKER FAIL already drives the mapped axis to FAIL and a blocked capability targets the same axis
- **THEN** the axis and the projected verdict SHALL both remain FAIL (projection preserves deterministic FAIL and never downgrades to INCOMPLETE); release readiness remains BLOCKED

#### Scenario: external blocker takes precedence over local blocked reclassification

- **WHEN** a summary carries an explicit external/device blocker or `completion_status: deferred` alongside a locally-blocked capability
- **THEN** the phase SHALL stay `deferred` and the recommendation SHALL remain `resolve_deferred` (local blocked reclassification must not swallow explicit external deferral)
