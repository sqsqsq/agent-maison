# runtime-step-evidence Specification

## Purpose
TBD - created by archiving change autonomous-recovery-without-human-gates. Update Purpose after archive.
## Requirements
### Requirement: Runtime step telemetry capability is resolved before P0 device execution

For a testing phase with applicable P0 device/both checkpoints, the runner SHALL resolve `runtime_step_telemetry` support before spawning the phase/provider by using the active profile/provider capability and version handshake plus the same P0 applicability predicate used by device testing. Unsupported capability, an unavailable provider, or a bounded capability probe that remains unavailable SHALL project through the existing external/capability-missing carrier as `DEFERRED_CAPABILITY_MISSING` in goal mode and the equivalent external defer in direct harness mode, with zero content retry. The pre-check capability report MUST NOT consume evidence that can only be produced by the current testing invocation.

Enforcement: `harness/capability-registry.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`

#### Scenario: provider has no step telemetry support

- **WHEN** a P0 device flow is applicable and the selected profile/provider declares no `runtime_step_telemetry` capability
- **THEN** the run SHALL defer before testing content execution as capability-missing and SHALL NOT spend a testing content retry

### Requirement: P0 checkpoint execution produces hash-bound runner-owned observations

When runtime step telemetry is available, the device runner/provider SHALL write, for every required checkpoint step, a structured observation containing at least `case_id`, ordered `step_index`, action kind, declared `target_element_id`, actual stable node identity or verifiable hit bounds, pre/post screen signatures, required/forbidden element observations, step outcome, device session, provider/tool version, goal `run_id`, and `attempt_id`. Each step hash SHALL be SHA-256 over the exact UTF-8 bytes of the Hylyre-normalized planned-step text, not a language-specific reserialization of the parsed JSON value; this preserves decimal and exponent spellings identically across Python and TypeScript. The existing `device-test-evidence.json`, Hylyre trace, and testing phase evidence manifest SHALL bind the observations to the feature, acceptance flows, derived test plan/steps, HAP, testing product-source aggregate, trace, run, attempt, and device. Agent-authored prose, trace notes, self-reported PASS, and legacy runtime-fidelity receipts MUST NOT satisfy the requirement.

Enforcement: `harness/scripts/utils/runtime-step-evidence.ts`, `harness/scripts/utils/device-test-evidence-shared.ts`, `profiles/hmos-app/harness/device-test-evidence.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`

#### Scenario: every checkpoint is observed in order

- **WHEN** a P0 flow executes with matching target hits, ordered screen transitions, and complete required/forbidden observations under the current run/attempt/device identity
- **THEN** the runtime evidence verifier SHALL accept the checkpoint coverage and make it available to the existing testing/release projections

### Requirement: Declared support with missing or invalid evidence is a testing failure

After a provider declares runtime-step support, the verifier SHALL recompute checkpoint coverage, order, target hit, screen transition, required/forbidden observations, identity, hashes, and freshness. Missing events, malformed or forged payloads, stale/replayed evidence, cross-run/attempt/device reuse, misordered steps, wrong targets, or provider execution that produces no payload SHALL be ordinary testing BLOCKER failures with no external/capability-missing classification. They SHALL retry testing and then use the existing retry/convergence fuse. `device-testing/contract.yaml` MUST NOT add a current-run evidence input with `on_missing=fail` to represent the preflight capability fact.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/runtime-step-evidence.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/assess.ts`

#### Scenario: supported provider omits a step

- **WHEN** the provider declared telemetry support but the current evidence omits one required checkpoint step
- **THEN** testing SHALL FAIL and retry as a content/evidence failure, and SHALL NOT report `DEFERRED_CAPABILITY_MISSING`

#### Scenario: replay from another attempt is rejected

- **WHEN** otherwise valid observations bind a different run, attempt, or device session
- **THEN** the verifier SHALL reject them as stale/replayed testing evidence and keep completion blocked
