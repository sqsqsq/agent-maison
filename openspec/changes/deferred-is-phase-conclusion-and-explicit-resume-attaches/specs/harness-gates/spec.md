## MODIFIED Requirements

### Requirement: Blocked capabilities project deterministically into the diagnostic and decision exits

A blocked capability SHALL remain a pre-check fact that produces no `CheckResult` (the consumption bijection stays unchanged). The harness SHALL project it into the exits agents and humans already read, without inventing new statuses or parallel protocols:

- `readiness_signals` SHALL include `capability_input_unresolved` (status `incomplete`) naming the capability, input, attempt source, and bound dependency paths when present; wider claim text SHALL NOT be hardcoded into the generic projection (repair language, e.g. requirement-specific advice, lives only in the provider's own attempt detail).
- `next_action` SHALL return `resolve_capability_inputs_then_rerun` only when `blockers.length === 0`, `blockingSkips.length === 0`, no run status claims-done `false`, and at least one capability is blocked; real blockers/SKIPs/run-statuses take precedence.
- The assess `failed` gap for a locally-blocked phase (unresolved attempts without an `upstream_producer`) SHALL carry capability/input/attempt detail and keep recommendation `rerun_phase`; an `INCOMPLETE` summary with explicit external/device blockers, or any summary with `completion_status: deferred`, SHALL keep `deferred`/`resolve_deferred`. A `FAIL` summary without `completion_status: deferred` SHALL NOT become deferred because of its blockers.
- When a blocked input attempt names an `upstream_producer` that is present in the active workflow chain, assess SHALL target that producer rather than retrying the downstream consumer. An absent/invalid attempt without a chain-resolvable producer SHALL remain a diagnostic input gap and SHALL NOT be promoted to `framework_bug` merely because it is absent.
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

- **WHEN** an `INCOMPLETE` summary carries an explicit external/device blocker, or a summary carries `completion_status: deferred`, alongside a locally-blocked capability
- **THEN** the phase SHALL stay `deferred` and the recommendation SHALL remain `resolve_deferred` (local blocked reclassification must not swallow explicit external deferral)

#### Scenario: a FAIL summary with an external blocker is not deferred

- **WHEN** a `FAIL` summary without `completion_status: deferred` carries an `externalBlocked` blocker alongside other failures
- **THEN** the phase SHALL be a `failed` gap and SHALL NOT be reported as `deferred`

#### Scenario: downstream missing input returns to its producer

- **WHEN** a failed downstream capability carries an unresolved `SourceAttempt.upstream_producer` that names an earlier phase in the active chain
- **THEN** assess SHALL recommend `backtrack_to_phase` for that producer and preserve the capability/input/source diagnostic
