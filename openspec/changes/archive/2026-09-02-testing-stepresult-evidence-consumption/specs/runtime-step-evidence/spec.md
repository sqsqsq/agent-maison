## MODIFIED Requirements

### Requirement: Runtime step telemetry capability is resolved before P0 device execution

When the vendor manifest declares native Hylyre `0.5.0+` and `tools.hylyre.auto_install=true`, the default or `HYLYRE_HOME` venv is an installation target: a missing or stale installed version SHALL proceed to `ensureHylyreReady` rather than permanently defer. An explicit `HYLYRE_PYTHON` or `auto_install=false` may defer based on the installed environment before content execution.

For a testing phase with applicable P0 device/both checkpoints, the runner SHALL resolve the selected Hylyre provider and its evidence contract before execution. A provider that can emit native `CaseResult.steps[]` SHALL be accepted as the runtime evidence source even when the legacy `runtime_step_telemetry` capability is absent; ordinary interactive testing MUST NOT be skipped solely because that legacy capability is missing. Goal mode SHALL retain its existing run/attempt/HAP/device identity binding. The released native contract is Hylyre `0.5.0+` with trace schema `0.4-p0` and result protocol `hylyre.step-outcome/1` (Step Outcome v1); `0.3-p0` and older are read-only historical compatibility, are not new-run producers, and MUST NOT close any required gate. If native support is unavailable, the existing capability-missing carrier SHALL defer before content execution. The pre-check capability report MUST NOT consume evidence that can only be produced by the current testing invocation.

Enforcement: `harness/capability-registry.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`

#### Scenario: Native StepResult support keeps interactive testing evidence-enabled

- **WHEN** an ordinary interactive provider emits the frozen native StepResult shape but does not declare the legacy telemetry capability
- **THEN** testing SHALL consume the native evidence and SHALL NOT SKIP runtime evidence

#### Scenario: No native or supported legacy evidence defers

- **WHEN** a P0 device flow is applicable and the selected provider can emit neither native StepResults nor a complete supported legacy checkpoint bridge
- **THEN** the run SHALL defer as capability-missing before content execution

### Requirement: P0 checkpoint execution produces hash-bound runner-owned observations

Native trace consumption SHALL bind `trace.artifacts.plan` and the existing run/identity receipt to the top plan, actual derived plan, and trace paths/SHA values. StepResult count/index/kind SHALL match the actual derived plan, with only one trailing `expected_check` row permitted.

When native StepResult evidence is available, the device runner/provider SHALL write the frozen `CaseResult.steps[]` observations into the authoritative Hylyre trace, including ordered `index`, `role`, the `outcome` variant (`passed` with `observation`, `failed` with `failure{domain,code}`, `blocked` with `cause`, `skipped` with `reason`), `duration_ms`, `device_session`, `selector` request/resolution, `artifacts`, `diagnostic`, and `extensions`. Attribution SHALL live inside `outcome`; flat `status`/`failure_kind`/`failure_code` fields are retired and MUST NOT be written or read. The existing run/attempt/device/provider bindings SHALL remain intact for goal testing. During the legacy transition only, the existing telemetry bridge MAY provide its actual pre/post dump, action hit, required/forbidden observations, and identity-bound checkpoint facts; it MUST NOT manufacture a generic StepResult ledger. Agent-authored prose, trace notes, self-reported PASS, and legacy runtime-fidelity receipts MUST NOT satisfy evidence that was not actually observed.

Enforcement: `profiles/hmos-app/harness/providers/device-test-run.ts`, `harness/scripts/check-testing.ts`, `harness/scripts/utils/runtime-step-evidence.ts`

#### Scenario: Native steps are published as the authoritative observations

- **WHEN** a P0 flow executes with native StepResults containing ordered target and assertion outcomes
- **THEN** the existing testing/release projections SHALL consume those steps directly

#### Scenario: Legacy telemetry remains checkpoint-bounded

- **WHEN** only the old schema is available and telemetry proves one checkpoint's actual hit, required/forbidden observations, and identity
- **THEN** only that checkpoint MAY be reused as legacy evidence and no generic ledger SHALL be produced


### Requirement: Declared support with missing or invalid evidence is a testing failure

After a provider declares native support, the verifier SHALL validate the three-part version/schema/field gate and recompute acceptance coverage from the current CaseResult axes and from `StepResult` `index` / `outcome` / `selector` (never a flat step `status` or `evidence` field, which the v1 shape does not have). Missing fields, malformed or forged payloads, stale/replayed identity evidence, misordered steps, wrong selectors, or provider execution that produces no native payload SHALL be ordinary testing BLOCKER failures with no external/capability-missing classification. They SHALL retry testing and then use the existing retry/convergence fuse. `device-testing/contract.yaml` MUST NOT add a current-run evidence input with `on_missing=fail` to represent the preflight capability fact.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/runtime-step-evidence.ts`, `harness/scripts/utils/p0-semantic-gates.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/assess.ts`

#### Scenario: supported provider omits a native step

- **WHEN** the provider declared native support but the current trace omits one required StepResult
- **THEN** testing SHALL FAIL and retry as a content/evidence failure, and SHALL NOT report `DEFERRED_CAPABILITY_MISSING`

#### Scenario: replay from another attempt is rejected

- **WHEN** otherwise valid observations bind a different run, attempt, or device session
- **THEN** the verifier SHALL reject them as stale/replayed testing evidence and keep completion blocked

## ADDED Requirements

### Requirement: Native StepResult evidence has priority over transition telemetry

When native `CaseResult.steps[]` and legacy telemetry are both present for a run, the native trace SHALL be the sole verdict source. Maison MAY compare the two sources for diagnostics, but it MUST emit a consistency warning rather than select, merge, or synthesize evidence from the telemetry source. New runs SHALL invoke Hylyre directly; the private Hylyre `_execute_one_step` monkey-patch and old collector allowlist SHALL be deleted once the native contract is available. Historical telemetry remains readable only for bounded checkpoint compatibility.

Enforcement: `harness/scripts/check-testing.ts`, `harness/scripts/utils/runtime-step-evidence.ts`, `harness/scripts/utils/hylyre-failure-routing-v1.ts`

#### Scenario: A telemetry mismatch does not override native evidence

- **WHEN** native StepResult and legacy telemetry disagree for a checkpoint
- **THEN** the native StepResult SHALL determine the Maison verdict and the mismatch SHALL be visible only as a consistency warning
