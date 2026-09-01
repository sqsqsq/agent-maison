## MODIFIED Requirements

### Requirement: Anti-cheat red lines are outside the matrix

The framework control-plane write boundary, build-fingerprint binding, asset-crop reproduction, process-input sanitization, and `diff_within_scope` SHALL remain outside runtime policy's evidence-tier matrix. The framework boundary SHALL be enforced by an out-of-model read-only principal where available, or represented honestly by the cooperative editing-tool guard where it is not.

Runtime policy SHALL NOT introduce or lower a framework Git dirty check, HEAD/commit identity, per-file manifest hashing, sidecar self-check, foreign-file scan, trust baseline, allowlist, or bypass. The guard's shell/script/external-process blind spots SHALL remain explicit at every tier. Legacy signer/confirmation fields SHALL not lower actual machine checks.

The runtime-artifact policy consumed by this boundary SHALL describe only Maison output and guard paths. It SHALL NOT derive host source-control configuration, and no tier SHALL gain a compensating detector that reads or writes the host `.gitignore`.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `agents/shared/guard-framework-write-core.mjs`, `harness/tests/unit/runtime-policy.unit.test.ts`

#### Scenario: Framework boundary does not depend on evidence tier

- **WHEN** a lite track or relaxed evidence profile is active
- **THEN** the environment read-only boundary or cooperative editing-tool guard SHALL remain unchanged, and no Git/hash detector SHALL be added as a tier-independent fallback

#### Scenario: Legacy signer does not bypass crop reproduction

- **WHEN** a crop artifact has a legacy signer field but current source/bbox reproduction fails
- **THEN** the crop gate SHALL fail independently of runtime tier and signer identity
