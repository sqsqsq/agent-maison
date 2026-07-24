# harness-gates Spec Delta

## ADDED Requirements

### Requirement: Goal-env source-mutation gating shares the review-closure baseline and never trusts self-reported approvals

In the goal orchestration environment, the UT source-mutation gate SHALL judge drift against the review closure attestation baseline through the same reconciliation and classification used by the runner (shared drift resolver — one decision for both sides), never against the run-start diff: legitimate coding-phase changes are outside the adjudication domain. Agent-written gap-notes `approved_src_mutations[]` SHALL NOT constitute release: the gate passes only on zero post-review drift or on a fingerprint-matching human adjudication (classification `authorized_backtrack`). Unresolved post-review drift SHALL surface as the dedicated blocker `goal_post_review_source_mutation_unresolved`; a missing or corrupt attestation in the goal environment SHALL fail closed as `goal_review_closure_baseline_unavailable` (no run-start-diff fallback, no gap-notes authority — recovery is a fresh coding-rooted run). Both dedicated blockers SHALL be registered `human_only` (never the `agent_fixable` default) so no content retry is spawned; the generic `ut_no_src_mutation` id keeps its existing default for legacy/non-goal shapes. The non-goal interactive mode keeps the current trace.start_commit + gap-notes semantics (honest boundary: self-reported, valid only with a human in the loop). Phase prompts SHALL state explicitly that agent-written gap-notes approvals are self-reported intent, not authorization, and that protected-source changes they "approve" must not be (re-)implemented.

Enforcement: `harness/scripts/check-ut.ts`, `harness/scripts/utils/mutation-authorization.ts`, `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: legitimate coding work is not flagged by the UT gate

- **WHEN** coding legitimately changed 36 files before review closure and only 1 file drifted after review
- **THEN** the goal-env gate SHALL flag only the 1 post-review drift as `goal_post_review_source_mutation_unresolved` and the 36 coding changes SHALL not block

#### Scenario: the self-signed seam no longer whiplashes harness-PASS into runner-HALT

- **WHEN** an agent registers its own seam in gap-notes and modifies protected source after review closure in a goal run
- **THEN** the harness gate itself SHALL FAIL with `goal_post_review_source_mutation_unresolved` (human_only, zero further agent invokes) instead of passing on the self-approval, and the runner reconciliation produces the single unauthorized halt outlet

#### Scenario: a deleted attestation cannot be washed through a fallback baseline

- **WHEN** the review closure attestation is missing while a goal run reaches ut
- **THEN** the gate SHALL fail closed as `goal_review_closure_baseline_unavailable` without computing a run-start diff or consulting gap-notes
