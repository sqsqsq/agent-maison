# Tasks

## 1. A round with no failure fact carries no attribution (plan 2f8a6d40 D1 / S0)

- [x] 1.1 `buildCurrentAttemptFailureProjection` requires the summary to state a failure (`verdict !== 'PASS'` or non-empty `blockers`); a summary without `verdict` is fail-closed
- [x] 1.2 `hasRuntimeFailureEvidence` is unchanged and remains sufficient on its own; the local `baseFailureKind` fed to `resolveAssessHaltIncident` is not narrowed
- [x] 1.3 V2 in the `goal-headless-guard` suite: four input groups plus the missing-`verdict` fail-closed case; the existing source guard on `failure_kind_classified: currentFailureProjection.failureKindForEvent` still holds

## 2. The ui-spec fidelity gate lands on `spec_capture_gap` (plan 2f8a6d40 D2 / S1)

- [x] 2.1 `isSpecCaptureGapBlockerId` becomes "prefix ∪ exact id" with `ui_spec_fidelity_gate`, matching the capture and toolchain predicates
- [x] 2.2 No halt-set member, actionability registration, blocker schema field or failure kind is added
- [x] 2.3 V4 in the `blocker-actionability` suite: the classification, the three halt sets, the unchanged actionability, and the untouched neighbouring classifications

## 3. The snapshot archives the reused report (plan 2f8a6d40 D3 / S2)

- [x] 3.1 `PhaseSnapshotVerifierEvidence` gains an optional `reused_from_prior_review`
- [x] 3.2 `snapshotPhaseHarness` falls back to `summary.verifier_closure.reviewed_subject_id` through `loadVerifierEvidenceForSubject`, reading the subject from the `summary.json` copy it just wrote; the report name and `PHASE_SNAPSHOT_FILES` are unchanged
- [x] 3.3 V5 / V6 in the `verifier-evidence` suite: the reuse path through the real closure derivation and the real finalizer, plus the two counter-cases

## 4. Acceptance wiring (plan 2f8a6d40 §6)

- [x] 4.1 V1 runs on the real production wiring: the fake harness's PASS exit writes through the real `writeRunSummaryBase` so the round's `decisionSummary` is writer-derived before the real classifier sees it
- [x] 4.2 V3 asserts the end-to-end attribution on the existing real-gate FAIL round
- [x] 4.3 V7: the B02 four-state regression guards stay green before and after

## 5. Specs and docs (plan 2f8a6d40 D5 / S3)

- [x] 5.1 This change's `goal-runner` delta
- [x] 5.2 This change's `harness-gates` delta
- [x] 5.3 `MIGRATION.md` section: the narrowed attribution condition, the ui-spec gate's new kind, and the archived reused report
- [ ] 5.4 Host regression is registered under B06 and is deliberately not done here
