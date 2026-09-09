# Tasks

## 1. Request eligibility (plan 3a7f9c12 D1)

- [x] 1.1 Add the pure predicate `canProduceVerifierRequest` to `harness/scripts/utils/verifier-plan.ts`: plan mode, phase, script verdict/checks, `report_validity` and `has_blocked` in; `{allowed, kind, reason, diagnosticCheckIds}` out. No model read, no provider execution, no new module or config
- [x] 1.2 Resolve it once in `harness-runner.ts` (`resolveVerifierRequestEligibility`) reusing `deriveSummaryVerdictLattice` for `report_validity` / `has_blocked`; call it from both the Step 4 gate and `writeRunSummaryBase`
- [x] 1.3 Fill `failure_kind: 'code_regression'` at `checkUtHvigorTest`'s final failure return in `profiles/hmos-app/harness/ut-host-impl.ts`, only when every selected module produced a real result and every failing module ran, produced cases, failed some, and shows no toolMissing / timedOut / non-clear installBlocking / structured on-device failure evidence; keep the formatter's attribution otherwise and leave `details` untouched

## 2. Production order and next step (plan 3a7f9c12 D2)

- [x] 2.1 Append the "product-failure diagnosis" section to `assembleAIPrompt` as an in-memory option (`repairDiagnosis`); no new request field, no persisted mode
- [x] 2.2 Add the `run_verifier_for_repair` action; decide it first in `decideNextAction` so `can_claim_done=NO` cannot swallow it, and only while the current subject has no usable report text
- [x] 2.3 Render it first in `buildNextLine` with the request path, the report path and the follow-up command; branch the follow-up on whether the goal outer runner will re-run the gate harness (`outerGoalHarnessWillRerun`, run-control on disk required — a stale env var is not enough)
- [x] 2.4 Extend the goal failure feedback (`extractPriorFailureContext`) so a diagnosis round says: deliver the request, write the report, return — do not edit product code, do not re-run the harness, do not wait for candidates or closure
- [x] 2.5 Amend `phase-executor.md` step 3/4/6 and the Stop hook's non-closure branch for the same three points

## 3. Result parsing and candidates (plan 3a7f9c12 D3/D4)

- [x] 3.1 Rewrite `parseVerifierCheckStatus` to read the §7.1 summary table via `extractTables` (exact `id` / `status` headers) plus the legacy YAML shape; dedupe consistent duplicates, refuse conflicts and malformed statuses
- [x] 3.2 State the terminal-state counting rule in `verify-review.md` §八 and `verify-ut.md` precondition 6; amend `verifier.md`'s description and step 3 to permit the diagnosis request

## 4. Stale instruction removal (plan 3a7f9c12 D6)

- [x] 4.1 plan/coding `SKILL.md` step 3 and `agent-behavioral-principles.md`: quantitative thresholds and subagent forcing apply to the establishing phase and the legacy `context-exploration.md` path; delta phases require a non-empty `phase_delta` section
- [x] 4.2 `goal-phase-runtime.ts` unattended prompt: graded drift WARN plus owner responsibility instead of "attestation-locked BLOCKER"; keep the test-shortcut red line
- [x] 4.3 `device-testing-workflow-detail.md`: scope `region_attest` / critic receipts to the with-provider branch
- [x] 4.4 `verify-ut.md` precondition 4: align `ut_no_src_mutation` with the shipped MAJOR WARN grading, keep the discipline
- [x] 4.5 The six feature `SKILL.md` "no request was issued" notes: add the narrow exception and point at `next_action`

## 5. Adapter reconciliation only (plan 3a7f9c12 D5)

- [x] 5.1 Confirm `verifier_subagent: true` for claude / codeagent / codex; confirm codeagent shares `../claude/templates/agents`; confirm the shared bundle's skill bridges are jump-off files that inherit the amended framework SKILLs. No transport abstraction, no capability declaration change

## 6. Tests and verification

- [x] 6.1 `verifier-plan`: the D1 eligibility matrix, both allowed shapes and every refused one, with the fallback attribution parser injected from production
- [x] 6.2 `verifier-production-routing`: drive `writeRunSummaryBase` for review-negative and UT-`code_regression`; assert request issued, verdict FAIL / closure open, `next_action`, both `buildNextLine` branches, then publish the report and assert the owner candidate appears; assert the prompt notice is present only on the diagnosis branch
- [x] 6.3 `repair-candidates`: table ≡ legacy YAML equivalence through `buildSummaryRepairCandidates`, conflict/duplicate/malformed handling, and the V2 chain from the real `buildUtHvigorTestFailDetails` output (reproduce the missing-attribution break first)
- [x] 6.4 `goal-phase-runtime`: the diagnosis feedback text; `context-facts`: the D6 instruction alignment
- [x] 6.5 `node scripts/check-plan-version.mjs`, `npm --prefix harness run typecheck`, the five `test:unit --filter` runs, `npm run openspec:validate`
- [x] 6.6 Candidate build completed after the initial consumer smoke blocker was resolved; The current candidate manifest records complete=true, built_at=2026-09-08T11:26:37.817Z, smoke_checked_at=2026-09-08T11:28:48.454Z, source_commit bb4aed67. Its in-zip manifest SHA matches the installed host manifest; ZIP SHA=7e1472c011b46b77eb1131b8cac892ca63c5b11d4c42e6ca57b12f9de6814656.
- [x] 6.7 Host acceptance: user-triggered `C-U` goal run over the affected bc-openCard-1 window — diagnosis → candidate → owner repair → window closure (not run here; the user triggers it)

## 2026-09-08 closeout evidence

The original 6.6 note described an earlier goal/#5 smoke failure, not a current failure. Existing candidate complete=true supersedes that build status. Host deb77f shows review FAIL → repair candidates → coding rerun → review PASS; successor 73fc05 closes all six phases and verifies VALID. The old PARTIAL run is not relabelled successful. See B01 latest implementation record and B06 §10.
