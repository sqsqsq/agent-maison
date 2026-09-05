## 1. Contract freeze

- [x] 1.1 Create the proposal and delta specs for `write-boundary-attribution-only` and strict-validate before any production edit.

## 2. Attribution without verdict

- [x] 2.1 Split `classifyPhaseInvocationChanges` into `allowed` / `violations` / `observed`, keeping only artifact-domain cross-phase writes in `violations` and routing no-owner, multi-owner and source/workspace-only cross-phase writes to `observed` with an explicit disposition.
- [x] 2.2 Emit `phase_write_observed` at the runtime call site without halting, backtracking, invalidating the invocation, or entering a human-wait state; leave the artifact-domain `phase_write_violation` path and its recovery unchanged.
- [x] 2.3 Remove the `phase_write_owner_unresolved` halt branch while preserving the repeat-fingerprint, absent-target and budget fuses.

## 3. Attribution-chain gaps are diagnostics

- [x] 3.1 Degrade boundary resolution failure and unresolved source phases to a diagnostic that skips attribution for the invocation.
- [x] 3.2 Degrade pre-invocation and post-invocation snapshot failure to diagnostics; the phase still produces its verdict.

## 4. Single adjudication for source drift

- [x] 4.1 Remove the goal runtime's `reconcileMutablePhaseSourceDrift` call, its forced backtrack, and its baseline-unavailable halt.
- [x] 4.2 Project the current testing `review_closure_attestation` WARN into a readiness signal computed from the in-memory `ScriptReport`, so the disclosure does not read a previous run's report.

## 5. Registry and contract sync

- [x] 5.1 Retire the incidents whose producers this change removes; keep `testing_write_violation` as legacy-only for historical resume compatibility.
- [x] 5.2 Update the phase write boundary guidance text so it no longer asserts that every other path is read-only.
- [x] 5.3 Record the semantic change in `MIGRATION.md` and the 3.0.0 release notes.

## 6. Verification

- [x] 6.1 Add write-boundary classification tests for no owner, multiple owners, artifact-domain and source-domain cross-phase writes, and harness-written visual debt.
- [x] 6.2 Add goal-runner tests proving degraded attribution and source-domain drift do not halt or move the phase index, and that artifact-domain violations still backtrack.
- [x] 6.3 Add a readiness-signal test for the current-run unreviewed-drift disclosure and a negative case proving real compile/test/acceptance failures still fail.
- [x] 6.4 Run typecheck, the full harness test suite, `npm run openspec:validate` strict, and `git diff --check`.
