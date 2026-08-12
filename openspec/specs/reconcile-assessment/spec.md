# reconcile-assessment Specification

## Purpose
TBD - created by archiving change skill-contracts-assess. Update Purpose after archive.
## Requirements
### Requirement: Assessment deterministically observes and reconciles feature state
`harness/scripts/assess.ts` SHALL deterministically observe feature artifacts and phase summaries, diff them against the active workflow/track/goal, and emit `assess@1` with observed facts, gaps, one recommendation, alternatives, and stop state.

#### Scenario: Identical authoritative inputs are assessed twice
- **WHEN** assess runs twice without workflow, artifact, summary, evidence, goal, or injected observation changes
- **THEN** both results SHALL have the same observed fingerprint, gaps, recommendation, and fuse state

### Requirement: Closure is required before downstream recommendation
For full-track phases, assess SHALL qualify `closed` only when summary schema is 1.2, `closure_commit@1` exists, and the referenced phase evidence manifest verifies. Enforcement SHALL use `harness/schemas/summary.schema.json`, `harness/scripts/utils/phase-evidence-manifest.ts`, and `harness/scripts/assess.ts`.

#### Scenario: Harness passes but receipt closure is open
- **WHEN** a full-track phase summary has verdict PASS and closure is open
- **THEN** assess SHALL recommend completing that phase's closure and MUST NOT recommend a downstream phase

#### Scenario: Legacy summary claims closed
- **WHEN** a 1.0 or 1.1 summary says closed
- **THEN** assess SHALL report `legacy_unverified` and MUST NOT qualify downstream work

### Requirement: Required assurance is phase-specific
Assess SHALL read actual `assurance` from summary 1.2 capability-resolution data and
compare it to optional sparse `minimum_assurance` entries in the goal manifest using
`blocked < degraded < full`. A missing phase key SHALL add no goal-level floor. A
phase below an explicit floor SHALL emit `insufficient_assurance`; legacy or invalid
assurance data SHALL remain non-qualifying until the harness reruns.

Assess SHALL NOT use `minimum_assurance` to override quality-axis, phase-advance,
closure, or release readiness decisions.

#### Scenario: Degraded PASS is below a full requirement
- **WHEN** a phase is mechanically degraded and its goal requires full assurance
- **THEN** assess SHALL emit an `insufficient_assurance` gap and recommend restoring the necessary capability inputs

#### Scenario: Goal has no phase assurance key
- **WHEN** a goal manifest omits `minimum_assurance` for a phase
- **THEN** assess SHALL not reject the manifest or add an assurance gap solely for that omission

### Requirement: Assessment does not grant transition authorization
Assess SHALL determine qualification and recommendation only. The invoking driver MUST enforce `manual`, `batch_authorized`, or `goal_mode` authorization and any `through_phase` boundary through `harness/scripts/utils/phase-transition-policy.ts`.

#### Scenario: Batch authorization ends before recommendation
- **WHEN** assess recommends UT but the batch is authorized only through review
- **THEN** the driver MUST stop for authorization instead of executing UT

### Requirement: Reconciled state does not bypass feature validation
When no gaps remain, assess SHALL return `run_status_candidate=CHAIN_SLICE_COMPLETED` and `feature_completion=REQUIRES_VALIDATION`. It MUST NOT emit naked `COMPLETED` or replace `verify-feature-completion`.

#### Scenario: Goal slice has no remaining gaps
- **WHEN** every required phase satisfies verdict, closure, provenance, and depth
- **THEN** assess SHALL emit a chain-slice completion candidate and require feature validation

### Requirement: Next-step projection is fingerprint-bound and disposable
Assess SHALL write `<features_dir>/<feature>/next.json` as a non-authoritative projection bound to workflow, track, goal, run-attempt, summary, and evidence fingerprints. The continue path SHALL recompute on absence, corruption, or mismatch.

#### Scenario: Feature state changes after next.json is written
- **WHEN** a user or agent requests continue and the stored fingerprint differs from authoritative state
- **THEN** the driver MUST rerun assess and MUST NOT execute the stale recommendation

### Requirement: Next-step rendering occurs once per outer invocation
The harness and closure-finalizer exits SHALL render a concise next-step block outside `HARNESS_SUMMARY`. Nested finalizer calls SHALL return structured assessment without rendering a second block. Enforcement SHALL be shared by `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, and the closure-finalization utility.

#### Scenario: Sync closure invokes the shared finalizer
- **WHEN** `--sync-closure` completes closure and returns to its outer CLI
- **THEN** that command SHALL render at most one next-step block

### Requirement: Assessment reports authorized degradations and blocked capability effects
Assess SHALL consume persisted capability resolutions rather than re-resolving inputs.
A pruned capability satisfying any explicit floor SHALL be represented in
`observed.degradations` and SHALL not create an additional assess gap. If an upstream
pruned capability prevents a downstream core capability from resolving, assess SHALL
emit the existing `pruned` propagation gap with producer guidance.

A blocked capability SHALL be observed through the summary's existing non-PASS and
closure facts; assess MUST NOT create a parallel blocked gap type.

> **Enforced by:** `harness/scripts/utils/assess.ts`, goal-manifest handling, summary
> readers, and assess unit tests.

#### Scenario: Authorized degradation is otherwise qualified
- **WHEN** a pruned capability satisfies the goal floor and all independent quality and closure conditions qualify
- **THEN** assess SHALL include the degradation in observations without adding an extra gap

#### Scenario: Blocked visual capability is persisted
- **WHEN** a blocked visual capability clamps the projected summary verdict to INCOMPLETE
- **THEN** assess SHALL use the existing non-PASS path and MUST NOT recommend downstream completion

### Requirement: Assessment freshness includes capability-resolution provenance
Assess SHALL treat capability-resolution contract and source-attempt fingerprints as
part of summary/evidence freshness. A stale manifest caused by a changed selected or
prior attempted source SHALL prevent downstream qualification.

#### Scenario: Fallback-preferred artifact appears after closure
- **WHEN** a previously absent higher-priority source becomes present after a derive fallback closure
- **THEN** assess SHALL observe stale evidence and refuse downstream qualification
