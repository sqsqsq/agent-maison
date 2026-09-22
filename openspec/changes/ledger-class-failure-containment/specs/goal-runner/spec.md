# goal-runner Spec Delta

## ADDED Requirements

### Requirement: Ledger-class failures are contained; an unresolved repair target stops instead of burning retries

A testing failure whose responsibility comes from an unconsumable-evidence block rather than a product-truth fact — the existing `repair_owner` carried from `evidence_block_owner` onto the owning check names an owner other than `coding` — SHALL NOT produce a repair candidate, and therefore SHALL NOT drive `phase_backtrack_requested` or widen a backtrack target. Ledger/shape gaps (reference-id naming, missing declared file, binding or fingerprint drift, stale report subject) have no upstream artifact to invalidate. What is removed is the testing-phase `spec`/`plan` candidate branch only; every existing classification stays as it is — a `spec` owner still classifies as `spec_capture_gap` and a `capability` owner still classifies as `toolchain`. The disclosure SHALL likewise be unchanged: the same `repair_owner` and `affected_files` stay on the check and reach the summary blockers. With no candidate, the round SHALL be adjudicated by the existing per-phase retry budget, and the verdict event SHALL record the final action. The invalidation-range algorithm (`resolveInvalidatablePhases`) SHALL remain unchanged; product-truth failures (executed assertion mismatches, visual defects) SHALL keep their existing candidates, backtrack and downstream re-verification, including when a ledger-class blocker is present in the same round; and an assess-detected upstream evidence gap (missing or stale upstream closure) SHALL remain unaffected.

When a content failure repeats with an identical blocker signature and the machine-derived relevant set is unknown or empty (`repair_candidates[].files` ∪ `blockers[].affected_files` is empty), the runner SHALL stop through the existing `no_progress_guard` with a "relevant targets unknown" explanation instead of exhausting `max_retries_per_phase` and terminating as `content_retry_exhausted`. The `relevantEvidenceKnown` criterion itself SHALL remain unchanged — an empty set only proves that no target was resolved and MUST NOT be reported as proof that no repair was attempted. Every no-progress guard halt SHALL be recorded on the existing `phase_halt` event with its existing incident disposition, emitted after the phase verdict so that events-only outcome rebuilding preserves the halt reason, guidance and disposition rather than discarding them behind a newer verdict. No new halt reason, failure kind, event type, check id, score, waiver or attempt counter SHALL be introduced.

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: a ledger-class failure never requests a phase backtrack

- **WHEN** testing fails only with an evidence-obligation blocker whose `repair_owner` is `spec` (reference ids declared in two spec-owned files do not match), with no blocker owned by `coding`
- **THEN** no repair candidate SHALL be produced and the runner SHALL NOT emit `phase_backtrack_requested`; the blocker SHALL still carry `repair_owner` and the responsible spec files, and the failure SHALL still classify as `spec_capture_gap`

#### Scenario: a ledger-class blocker alongside a product defect does not widen the target

- **WHEN** the same testing round carries both the ledger evidence-obligation blocker and an executed `StepResult` assertion mismatch owned by `coding`
- **THEN** exactly one backtrack SHALL be requested, targeting `coding`, carrying only the product-truth candidate, and its `invalidated_phases` SHALL NOT include `spec`

#### Scenario: an unchanging ledger blocker stays inside the phase retry budget

- **WHEN** every attempt of a phase reproduces the same ledger-class blocker and no product-truth candidate exists
- **THEN** agent invocations for that phase SHALL stay within the existing `max_retries_per_phase` budget and the run SHALL NOT complete successfully

#### Scenario: an unresolved relevant set stops on the second identical signature

- **WHEN** a `code_regression` round repeats an identical blocker signature and neither repair candidates nor blocker affected files resolve any relevant target
- **THEN** the runner SHALL halt through the existing `no_progress_guard`, state that the relevant targets are unknown rather than that no repair was attempted, and SHALL NOT introduce a new halt reason or continue to `content_retry_exhausted`

### Requirement: Attended-only context arguments in a non-session run report a mode mismatch

`validateAttendedGoalContext` SHALL keep its identity criteria unchanged — a non-session owner is still refused and no context is returned — but SHALL report the refusal as a mode mismatch naming the current mode and the attended-only arguments that must not be passed, rather than as an expired or invalid session lease. A genuine session whose lease expired SHALL keep the existing lease wording. The published goal-mode guidance SHALL state, for each mode, the harness call that can be executed directly: attended appends the issued context arguments, detached inherits context from the manifest/events and injected environment and passes none of them.

Enforcement: `harness/scripts/utils/attended-goal-context.ts`

#### Scenario: a detached run is handed attended arguments

- **WHEN** a phase harness invoked under a detached (process-owned) run passes the attended-only `--goal-*` context arguments
- **THEN** the call SHALL be refused with a mode-mismatch message naming the current mode and those arguments, and SHALL NOT be explained as a lease timing problem
