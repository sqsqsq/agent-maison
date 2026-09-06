# Tasks

## 1. Evidence profile resolution (plan 7b3e9a15 D1 / S0)

- [x] 1.1 Delete the `ctx.mode !== 'interactive'` early return in `resolveEvidencePolicy` and the same-shaped line in `resolveProfileLabel`; the existing "config is not balanced → STRICT" branch carries every default case, so the default-equivalence invariant holds with no other edit
- [x] 1.2 Rewrite the resolver JSDoc to state the two different scopes: `verifier` off outside the retained `{spec, coding}` set, `trace` optional for all six feature phases unconditionally
- [x] 1.3 Fix the `evidence_profile` field comment in `harness/config.ts`, which still says the field only participates in the interactive branch

## 2. Policy off is not "ignored" (plan 7b3e9a15 D1 / S0b)

- [x] 2.1 Add `resolveCarriedVerifierSubject` to `harness-runner.ts`: on `disabled`, read the previous summary's `verifier_subject_id` and carry it only when the material view stored at issuance still matches this round's policy-independent material face (manifest file hashes + `gate_fingerprint` + script-report projection, recomputed through the production `buildVerifierMaterialView`) and `loadVerifierEvidenceForSubject` validates a non-PASS verdict. Never key on `source_commit_sha` / `worktree_digest`: they are not subject inputs, and `worktree_digest` covers `framework.config.json`, so a mere `evidence_profile` switch would drop a valid FAIL
- [x] 2.2 Return `'fail'` from `resolveVerifierEvidenceState` when a carried subject is present, and anchor the repair-candidate body (`loadVerifierReportTextOrNull`) to that same subject
- [x] 2.3 Resolve the `'fail'` branch in `decideNextAction` **before** the `disabled` early return, so the carried veto cannot be replaced by a "go fill the receipt" instruction
- [x] 2.4 Keep `verifier_subject_id` + `verifier_report` in the written summary when carrying (never `verifier_request` — this round issued nothing)
- [x] 2.5 In `check-receipt.ts`'s disabled branch, load the evidence for the recorded subject and keep the existing `verifier_not_pass` BLOCKER when the verdict is not PASS; absence stays zero-requirement
- [x] 2.6 Key `resolveGitHeadSha`'s cache by `projectRoot` — the exported writer can legitimately serve two projects in one process, and a single global value writes a `source_commit_sha` that disagrees with the project's own HEAD

## 3. Trace is read from disk, not from the receipt (plan 7b3e9a15 D1 / S0b)

- [x] 3.1 Resolve the legacy branch's `trace.json` from the canonical reports path first, falling back to the declared `trace_json.path` only when the canonical file is absent; keep every existing issue id and severity
- [x] 3.2 Always parse a canonical file that is present — a `schema_valid: false` self-report must not skip the corruption check

## 4. Plan applicability exit (plan 7b3e9a15 D2 / S1)

- [x] 4.1 Add the shared pure function `resolveSectionApplicability` to `check-plan.ts` (name deliberately avoids `exemption`, which the structural 10/13 source scan rejects); preconditions are contracts mounted, parse succeeded, and no `shape_issues` for that collection
- [x] 4.2 Call it from `checkDataModelTyped` / `checkInterfaceSignaturesComplete` / `checkComponentTreePerPage` after `getSectionContent` succeeds and before the code-block / subsection judgement; each keeps its own severity
- [x] 4.3 Export the three checks so the unit suite drives the real functions instead of re-implementing the judgement
- [x] 4.4 Mark the genuine-n/a SKIP with `structured.applicability = 'not_applicable'` (shared `CHECK_NOT_APPLICABLE_MARKER` / `isCheckNotApplicable` in `types.ts`) and exclude marked checks from the writer's `blocking_skips`. A BLOCKER SKIP otherwise means "the gate did not run": it lands in `blocking_skips` and makes `decideNextAction` return `review_blocking_skips_then_verifier`, which both mislabels a confirmed non-applicable chapter as an outstanding task and bypasses the disabled / verifier-FAIL branches. Status and severity stay untouched, so the display, blocker-aggregation and quality-axis semantics are unchanged

## 5. Count is a clue, not a criterion (plan 7b3e9a15 D3 / S2)

- [x] 5.1 Rewrite `verify-ut.md` check 4B item 5 around "would this `it` fail if the code were wrong" plus boundary/exception coverage; keep the "tested the wrong object" branch
- [x] 5.2 Add the pure-function / single-rule applicability scope to check 4 item 1 and 4B item 2; flow cases keep all three requirements verbatim, and shape is decided from the code under test
- [x] 5.3 Reword the two `it_drives_flow` suggestions in `check-ut.ts` so they stop pointing at a number; severity, status and the predicate are untouched

## 6. Stale descriptions aligned with code (plan 7b3e9a15 D4 / S3)

- [x] 6.1 `business-ut-workflow-detail.md` items 3 and 4 — the same exit path's two adjacent sentences: graded MAJOR WARN under the attestation baseline, and the graded review list instead of "the only two ways out"
- [x] 6.2 `device-testing-workflow-detail.md`: `review_closure_attestation` lists the one review it needs and records it honestly when not done; the `*_FAST_PATH` red line is untouched
- [x] 6.3 `check-testing.ts` `checkReviewClosureAttestationGate` JSDoc closing sentence, so the function's head agrees with its own body
- [x] 6.4 `goal-mode-runbook.md`: drop the "the agent has already written test-report.md" precondition from `--report-reconcile-only`

## 7. Specs and local acceptance (plan 7b3e9a15 D6 / S4)

- [x] 7.1 `runtime-policy` delta: requirement text plus both of its scenarios, and the `headless 强制 strict` scenario under the pure-resolver requirement
- [x] 7.2 `harness-gates` delta: three scenarios for the applicability exit, including the "source not trustworthy → never accept the claim" one
- [x] 7.3 `MIGRATION.md` section, inserted alongside the B03/B04 entries
- [x] 7.4 V1–V8 through the production wiring, each new defect assertion shown red before the change and green after; the guards green both ways
