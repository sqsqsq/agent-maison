## ADDED Requirements

### Requirement: Trusted repair candidates are a single shared fact in the phase summary

The harness SHALL project trusted, actionable defects into an optional `summary.repair_candidates[]` field (machine-derived, never agent-reported, declared in `summary.schema.json`) as the **single source of truth** consumed by goal, batch, and manual drivers alike: assess reads it directly from each phase summary, and the fact SHALL NOT be copied into the reconcile observation (a second copy is exactly what left the in-session/batch chain blind). The review report SHALL be read through the existing feature-artifact resolver so the canonical `<feature>/review/review-report.md` (and legacy locations) are found — a hand-assembled path yields a null report and silently produces no candidates. Check-derived ownership SHALL read the check's machine `failure_kind` before falling back to parsing its details text. The testing evidence-chain verifier (`collectActionableDefects`, retained with its screenshot/build-identity/time-window binding) SHALL have its output merged back into the same `repair_candidates[]` field; when that merge fails the run SHALL halt `repair_candidates_unwritable` rather than advancing. Production sites and trust conjunctions: review — report structurally valid (`report_validity=PASS`) AND the verifier has verified each open BLOCKER/MAJOR **individually** via the `issue-verification` fenced block (a sampled global PASS SHALL NOT qualify items; unverified/refuted/unclear items produce no candidate) AND no valid `conditional_review_authorization` receipt (a valid receipt means a human explicitly accepted the risk and SHALL suppress auto-backtrack) — covering both negative conclusions（有条件通过 and 不通过）; plan — `scope_consistency_with_spec` FAIL → spec-owned candidate; ut — verifier `device_ac_delegation` FAIL → spec-owned candidate; coding — `ui_scope_violation` classification → plan-owned candidate. Ownership SHALL reuse the existing `CorrectionCategory` values with machine check-id ownership taking precedence over affected-files path-domain fallback (`ui_scope_violation` stays plan-owned even when affected files are product source); mixed-domain or underivable ownership SHALL produce no candidate. Each candidate carries `item_fingerprint` (hash of id + normalized files + normalized summary — defect identity); the round fingerprint SHALL be the hash of the sorted item-fingerprint set (anti-oscillation; a re-occurring identical round trips the existing fuse, a new set permits another backtrack). Verifier evidence SHALL be bound to the current issue content: each `issue-verification` entry carries an `evidence` line formatted `<affected file> | <verbatim fix suggestion of that row>`, and an entry qualifies its issue only when the evidence names the row's file **and contains the row's normalized summary in full** — substring/fragment matching is insufficient because two distinct defects can share a generic phrase (e.g. 「修复下拉菜单状态机错误」vs「修复短信验证状态机错误」). An absent, paraphrased, or truncated evidence line SHALL NOT qualify the issue; the phase stays in review for re-verification (deliberately conservative — a stale or vague artifact must never drive a code change). UT product-assertion candidates SHALL require the full conjunction of existing artifacts: `ut_hvigor_test` FAIL classified `code_regression`, no other BLOCKER FAIL in the UT structure gates, and the UT verifier confirming `end_to_end_driving` and `business_assertion_value` — no new root-cause classifier. testing→spec SHALL remain unrouted this change (no trusted machine production site; documentation may describe manual return to spec but MUST NOT present it as automatic).

Enforcement: `harness/scripts/utils/repair-candidates.ts`, `harness/harness-runner.ts`, `harness/prompts/verify-review.md`, `harness/scripts/utils/quality-axes.ts`

#### Scenario: three verified review MAJORs become coding-owned candidates

- **WHEN** a review report concludes 有条件通过 with open MAJORs CR-001/002/003 over product source files, and the verifier's issue-verification block confirms each one
- **THEN** the review summary carries three coding-owned repair candidates with distinct item fingerprints, and the round fingerprint differs from any prior round's set

#### Scenario: a hallucinated finding cannot drive a code change

- **WHEN** an open MAJOR is absent from the verifier's issue-verification block, marked refuted/unclear, or the report itself fails validity
- **THEN** no candidate is produced for it and the phase falls back to the existing in-phase retry/halt behavior

### Requirement: Assess routes repair candidates to the responsible phase via strict workflow mapping

Assess SHALL derive backtrack targets from repair-candidate ownership categories mapped through the **current resolved workflow/track** (`mapCategoryToChainPhase`): a category that maps to no real node of the current chain SHALL yield null — never a silent fallback to the chain head, never a phantom spec/plan on lite/custom workflows; an all-null mapping SHALL surface the existing `backtrack_target_absent` semantics. With multiple ownership categories present assess SHALL target the most-upstream responsible phase while the full grouped fact set is carried by the `phase_backtrack_requested` event; when the chain re-walks each responsible phase, only that phase's own candidates are injected into its prompt (mixed-owner candidates are not lost). The driver SHALL permit any assess-selected earlier phase (no longer only coding) when assess carries a backtrack intent and the invalidation surface covers the target; the goal runner executes via a **single** `backtrack_to_phase` branch reusing the existing backtrack transaction, shared budget pool, and round-fingerprint fuse. The former phase-specific branches SHALL be physically removed — no `backtrack_to_coding` execution branch and no dedicated `ui_scope_violation` replan call site may coexist with the generic route (the shared `tryScopeReplan` helper remains for its other triggers). The backtrack event SHALL carry the full grouped candidate set so a crash/resume restores the handoff context, and every backtrack event SHALL unconditionally overwrite it (a non-repair backtrack clears stale candidates instead of leaking them into later prompts). Batch authorization SHALL bound backtrack targets to the explicit interval `[manifest.start_phase, through_phase]` on the resolved chain (outside → manual confirmation; a missing lower bound is fail-closed); manual mode SHALL render a confirmation menu (`REPAIR_CANDIDATES` block naming the responsible phase) and MUST NOT modify files across phases without user confirmation.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/scripts/utils/correction-routing.ts`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-in-session-driver.ts`, `harness/scripts/utils/assess-renderer.ts`

#### Scenario: review candidates backtrack to coding instead of retrying review

- **WHEN** review fails with three coding-owned candidates and the goal chain includes coding
- **THEN** assess recommends `rerun_phase:coding` with `backtrack_to_phase`, the driver authorizes it, and the runner backtracks with the candidate list injected into the next coding prompt — no `rerun_phase:review` retry burn

#### Scenario: a lite-track spec candidate maps to change, not a phantom phase

- **WHEN** a spec-owned candidate arises on a lite-track chain `change/coding/exit`
- **THEN** assess targets `change`; on a custom chain lacking any mapped node the recommendation carries a null phase and the runner halts `backtrack_target_absent`

#### Scenario: batch authorization has a lower bound

- **WHEN** the user authorized `coding→testing` and review produces coding-owned candidates
- **THEN** the backtrack to coding executes automatically, while a plan- or spec-targeted backtrack under the same authorization is not auto-executed and defers to manual confirmation

#### Scenario: a stale verifier artifact cannot qualify a reused issue id

- **WHEN** the previous round's `verifier.report.md` confirms `CR-001`, but the current report's `CR-001` describes a different defect — whether an unrelated one, or one sharing a generic phrase with the old evidence (both mention 「状态机错误」)
- **THEN** the evidence binding fails in both cases, no candidate is produced, and the phase stays in review for re-verification

#### Scenario: a crash between backtrack and re-execution keeps the handoff

- **WHEN** the runner emits `phase_backtrack_requested` with candidates and then crashes before the target phase runs
- **THEN** resume replays the event and the target phase's prompt still carries its own candidates; a later non-repair backtrack clears them instead of leaking them forward
