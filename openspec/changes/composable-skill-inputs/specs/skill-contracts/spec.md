## ADDED Requirements

### Requirement: Contract 1.1 resolves consumable inputs once per invocation

Contract schema/parser SHALL accept 1.0 legacy tracks and 1.1 obligation_kinds or explicit base/enhancement input roles, rejecting mixed fields. Required obligations SHALL block on absent inputs even with prune policy; unknown SHALL block and not_applicable SHALL avoid source reads. All source branches SHALL be registered and have compatible static return types; registered producers need not be invocation ancestors under 1.1.

ResolvedPhaseInputs SHALL contain validated typed content and InputBinding with source, actual dependencies, source_refs and normalized content fingerprint. Each input SHALL resolve once; absent continues, invalid terminates. Explicit invalidation or expected binding mismatch SHALL block with stale/correction diagnostics. Reports SHALL persist bindings/attempts without duplicating content.

Enforcement: `specs/skill-contract-schema.yaml`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/scripts/check-contract-consistency.ts`, `harness/schemas/summary.schema.json`.

#### Scenario: Required input cannot be pruned
- **WHEN** a 1.1 required obligation has an absent input and on_missing is prune
- **THEN** the capability SHALL be blocked, never pruned or PASS

#### Scenario: Existing content reaches a checker without a producer run
- **WHEN** a registered artifact resolves valid content outside a fixed upstream document path
- **THEN** the same content SHALL reach an existing checker through SpecLoader without rereading the old path or creating an upstream summary

#### Scenario: Invalid input cannot use a fallback
- **WHEN** an earlier source is invalid or explicitly superseded
- **THEN** resolution SHALL terminate with invalid and preserve the actual attempted sources

### Requirement: Resolved inputs define the shared read surface

SpecLoader, CheckContext, verifier context/material and phase evidence SHALL consume the same invocation resolution. New input dependencies SHALL come from attempted sources and required outputs from the invocation; fixed REQUIRED/OPTIONAL phase file tables SHALL remain legacy-only. Changed source bytes before evidence publication SHALL report stale, not silently bind different content. Framework contract files SHALL use their existing fingerprint instead of becoming consumer evidence paths.

Enforcement: `harness/scripts/utils/spec-loader.ts`, `harness/scripts/utils/types.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/verifier-material.ts`.

#### Scenario: Unconsumed legacy file does not enter the new surface
- **WHEN** review consumes a valid acceptance binding without plan input or output obligations
- **THEN** its evidence and candidate paths SHALL exclude the old fixed plan path

#### Scenario: Request evidence cannot become Feature completion
- **WHEN** a request-only invocation is passed to the Feature evidence writer
- **THEN** it SHALL reject the subject before accessing Feature artifact paths
