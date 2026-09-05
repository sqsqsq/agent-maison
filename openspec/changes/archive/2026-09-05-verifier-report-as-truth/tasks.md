# Tasks

## 1. Caller writes the report (plan d2f7a9c4 T1)

- [ ] 1.1 Add `verifier_report` to the run summary at request issue time (`<reports>/verifier.report.<subject>.md`, project-root relative) in `harness-runner.ts`, `harness/scripts/utils/types.ts` and `harness/schemas/summary.schema.json`
- [ ] 1.2 Rewrite the two verifier next-action lines (`run_verifier_then_receipt`, `rerun_verifier_with_current_request`) into three steps: deliver the request JSON in full, write the reply verbatim to `summary.verifier_report`, then run check-receipt
- [ ] 1.3 Sweep the dispatcher guidance surface to one sentence: `framework-agent-execution.mdc` §3 and its error table, `skills/reference/agents-entry-detail.md` §4.1, the six feature SKILL.md verifier sections, `agents/claude/templates/agents/phase-executor.md`
- [ ] 1.4 Leave the verifier subagent read-only: no Write grant, no `report_path` in the request, no fallback second writer

## 2. Loader reads markdown; report hash gates deleted (plan d2f7a9c4 T2)

- [ ] 2.1 Rewrite `harness/scripts/utils/verifier-evidence.ts` around `parseResultBlock`: four error codes (`report_missing`, `block_unparseable`, `subject_mismatch`, `verdict_inconsistent`), one recovery action, no transcript, no fingerprint, no conflict
- [ ] 2.2 Delete `verifierReportJsonFilename` and `computeVerifierResultSha256` from `verifier-subject.ts`
- [ ] 2.3 Delete the generation dispatch from `check-receipt.ts` (`readSummarySchemaVersion`, `readSummaryClosureStatus`, the grandfather branch) and the hand-filled receipt drift projection
- [ ] 2.4 Stop registering the verifier report in `phase-evidence-manifest.ts`
- [ ] 2.5 Drop `verifier_report_sha256` / `verifier_result_sha256` from `closure-attestation.ts`, advance its `schema_version` to `1.2`, keep `verifier_subject_id`
- [ ] 2.6 Point `goal-phase-snapshot.ts` at the markdown and drop the subagent identity fields

## 3. Hook and capability matrix deleted (plan d2f7a9c4 T3)

- [ ] 3.1 Delete `agents/claude/templates/hooks/record-verifier-report.mjs` and the `SubagentStop` block from `agents/claude/templates/settings.json` and `agents/codeagent/templates/settings.json`
- [ ] 3.2 Replace `verifier_capability` with `verifier_subagent: true` in the claude, codeagent and codex adapters; leave cursor / opencode / chrys / generic undeclared
- [ ] 3.3 Replace the `verifier_capability` field in `agents/adapter-schema.yaml` with the boolean, documenting that it records an observed host run and says nothing about runtime mode
- [ ] 3.4 Reduce `adapter-catalog.ts` to `resolveVerifierSubagentDeclared`
- [ ] 3.5 Reduce `verifier-plan.ts` to two states with `adapter_has_no_reviewer` as a disabled reason; delete the capability types, the `blocked` state and `verifier_provider_unavailable`
- [ ] 3.6 Delete the `blocked` ladder, its next action and its console guidance from `harness-runner.ts` and `check-receipt.ts`; record `not_reviewed` as a non-blocking warning

## 4. Tests (plan d2f7a9c4 T4)

- [ ] 4.1 Delete `record-verifier-report-hook.unit.test.ts`, `verifier-evidence-identity.unit.test.ts` and `tests/utils/verifier-identity-fixture.ts`; drop both suites from `run-unit.ts`
- [ ] 4.2 Convert `tests/utils/verifier-evidence-fixture.ts` into "the dispatcher writes the reply", keeping its signature
- [ ] 4.3 Add `verifier-evidence.unit.test.ts`: hit, missing, subject mismatch, zero/multiple terminal blocks, verdict inconsistency, prior-PASS reuse, and post-closure edit staling nothing
- [ ] 4.4 Update `verifier-plan.unit.test.ts` for the two-state resolver and the `verifier_subagent` boolean
- [ ] 4.5 Add the goal end-to-end case: `MAISON_GOAL_HEADLESS=1`, script PASS, `summary.verifier_report` matches the NEXT line, write a reply there, check-receipt closes
- [ ] 4.6 Add the undeclared-adapter case: script PASS, no request issued, check-receipt passes carrying `not_reviewed`

## 5. Docs and migration (plan d2f7a9c4 T5)

- [ ] 5.1 MIGRATION.md: breaking entry plus the upgrade actions (re-materialize `settings.json`, delete the instance hook, `verifier_subagent`)
- [ ] 5.2 `agents/README.md`, `docs/operations/harness-runbook.md`, `RELEASE-NOTES-v3.0.0.md`, `docs/skills/phase6-keyword-allowlist.md`
- [ ] 5.3 Strip the stale publication-chain sentences from `agents/claude/templates/agents/verifier.md`, leaving its review content, tool grant and output format untouched
- [ ] 5.4 Clean the hook wording out of the `verifier-request.ts` / `verifier-subject.ts` / `verifier-material.ts` headers

## 6. Verification (plan d2f7a9c4 T6)

- [ ] 6.1 `cd harness && npm test`
- [ ] 6.2 typecheck
- [ ] 6.3 `npm run openspec:validate`
- [ ] 6.4 `npm run release:check-plans`
- [ ] 6.5 LF scan and `git diff --check`
- [ ] 6.6 Host verification by the user: unattended goal run on the original halting scenario, plus one attended, one interactive and one codex phase
