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