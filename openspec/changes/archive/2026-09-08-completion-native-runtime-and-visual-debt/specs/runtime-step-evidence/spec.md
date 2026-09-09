# runtime-step-evidence Spec Delta

## ADDED Requirements

### Requirement: Completion consumes native runtime evidence

For a feature with an applicable P0 device flow, feature completion (`collectCleanPassIssues` ⑧) SHALL judge the P0 runtime fidelity obligation from the native Hylyre trace referenced by `device-test-evidence.json`, not from the legacy `runtime_fidelity` block alone. The consumer SHALL read the evidence doc, SHALL require the doc's `goal_run_id` / `attempt_id` to equal the run/attempt recomputed from the run events when those are known, SHALL read `doc.trace_path`, and SHALL dispatch on `dispatchHylyreResult(raw).kind`:

- `v1` — the doc MUST carry `artifact_binding`, and the testing `phase-evidence-manifest` MUST bind both `device-test-evidence.json` and the trace at `doc.trace_path` with matching hashes (`phaseManifestBindsRuntimeArtifacts`). Nothing else is recomputed at completion time: schema, artifact binding, HAP and device identity were adjudicated once by the testing gate, frozen by the manifest, and kept fresh by the existing lineage condition (`lineage_fresh`); a second verdict source at completion is forbidden.
- `legacy_unsupported` — only when the doc carries `runtime_fidelity` SHALL the existing legacy validation run unchanged (transition only); without it the issue reads "既无 native v1 trace 也无 legacy runtime_fidelity".
- `unsupported` (missing `schema_version`, a legacy version that also declares the v1 protocol, an unknown version, a non-object trace) — the issue is `needs_fix` naming the dispatch detail, and the consumer MUST NOT fall back to legacy validation even when `runtime_fidelity` is present.

An unreadable evidence doc or trace is `needs_fix` with the existing wording. Completion MUST NOT read the testing summary's `p0_runtime_step_evidence` PASS as a substitute, MUST NOT write `runtime_fidelity`, and MUST NOT add fields to the evidence doc.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/runtime-step-evidence.ts`, `harness/scripts/utils/hylyre-result-protocol.ts`

#### Scenario: A native v1 trace bound by the testing manifest completes a P0 feature

- **WHEN** acceptance has a P0 device flow, `device-test-evidence.json` has no `runtime_fidelity`, carries `artifact_binding`, its run/attempt equal the recomputed testing identity, `trace_path` points to a trace whose envelope dispatches as `v1`, and the testing phase manifest binds both files
- **THEN** `collectCleanPassIssues` SHALL raise no `runtime_step_evidence` issue, `generateFeatureCompletion` SHALL succeed and `verifyFeatureCompletion` SHALL return `VALID`

#### Scenario: Identity, binding and manifest gaps stay needs_fix

- **WHEN** the doc's `attempt_id` differs from the recomputed attempt, or the trace is not bound by the testing manifest, or the doc lacks `artifact_binding`, or the trace is `legacy_unsupported` and the doc has no `runtime_fidelity`
- **THEN** the `runtime_step_evidence` issue SHALL be `needs_fix` naming the gap ("attempt_id 不匹配", "未绑定 runtime 产物", "缺 artifact_binding", "既无 native v1 trace 也无 legacy runtime_fidelity")

#### Scenario: Unsupported traces never fall back to legacy

- **WHEN** the trace lacks `schema_version`, or declares a legacy `schema_version` together with `result_protocol`, and the doc carries a `runtime_fidelity` block
- **THEN** the issue SHALL be `needs_fix` reading "trace 协议不可判别/混装" and the legacy validation SHALL NOT run

#### Scenario: Native evidence takes priority over a present legacy block

- **WHEN** the trace dispatches as `v1` and the doc also carries `runtime_fidelity`
- **THEN** only the native branch decides; the legacy block is neither validated nor compared
