# Tasks

## 1. One ohosTest package per UT gate (plan 5e1c7a93 D1 / S0)

- [x] 1.1 `runHvigorTest` takes an optional `prebuild` and uses it instead of its internal `runHvigorBuild`; drop the unverified "hvigor cache hits take milliseconds" comment
- [x] 1.2 `checkUtHvigorBuild` / `checkUtHvigorTest` take an optional per-call `builds` collector keyed by `utBuildCollectorKey` (`computeHvigorInvocationFingerprint` over module/ohosTest/genOnDeviceTestHap/product/test); only `isHvigorBuildSuccessful` results enter it
- [x] 1.3 `UtHostImpl` carries the same optional parameter on both signatures
- [x] 1.4 `check-ut.ts` creates the collector per invocation and passes it to both stages
- [x] 1.5 V2: a temp project with the spawn boundary counted — no `prebuild` spawns hvigor and stops at the build stage; a successful `prebuild` spawns hvigor zero times and advances to the install stage

## 2. UT execution-key reuse (plan 5e1c7a93 D2 / S1)

- [x] 2.1 `execution-key.ts`: `FrozenArtifactSpec.group` (`execution` / `derived`), `utFrozenRunArtifacts(modules)`, `leg` parameter on `listExecutionKeyRuns`, artifact-set parameters on freeze/restore
- [x] 2.2 `decideReuse` takes `{leg, artifacts, excludeRunDir}`; execution-fact group missing refuses reuse with an explicit reason; derived group missing or incomplete derived evidence returns the run with `evidenceRebuildRequired`; an empty `trace_path` (UT leg) is not "trace missing"
- [x] 2.3 `hdc-runner.ts`: `finalize` writes `hdc-test.<module>.log`; the diagnostic sentence follows; `resolveExecutionDeviceIdentity` moves down from `check-testing.ts` and both legs share it
- [x] 2.4 `ut-host-impl.ts`: whole-round key aggregation per module, reuse eligibility pre-gate, pre-dispatch non-success record, per-module freeze/restore, record overwrite with the round's real outcome, reuse reason in the check details
- [x] 2.5 `harness-runner.ts` `--force-device` help covers testing and ut
- [x] 2.6 V8 and the UT-leg cases in the `execution-key` suite: group split, leg-scoped directories, per-module frozen names, pre-dispatch record excluded from its own decision but blocking the next round

## 3. Report-only layering (plan 5e1c7a93 D3 / S2)

- [x] 3.1 `check-testing.ts`: derived gaps move to a second bucket, including the four stale projections; source metadata gaps stay hard
- [x] 3.2 Rebuild first — timing via the existing collector/writer, report body via the existing generator — then evaluate
- [x] 3.3 Result: hard present → FAIL; derived only → WARN at BLOCKER severity with `derived_statistic_unavailable` and UNKNOWN wording; no new check id or status member
- [x] 3.4 Performance TCs recognised before the rebuild (`acceptance.performance[].id` ∩ `extractTcNfrRefs`) keep their duration gaps hard
- [x] 3.5 `device-test-timings.ts`: `duration_ms` becomes nullable; the legacy cost-allocation branch records `null` for a case with no cost line; the v1 branch is untouched
- [x] 3.6 `test-report-writer.ts`: an absent timing row or a null duration writes the empty-value placeholder; a measured zero still writes `0ms`
- [x] 3.7 `testing-trace-gates.ts`: one null-aware duration predicate shared by the pipeline rows and the case rows (codex round 2)
- [x] 3.8 `execution-channel-evidence.ts`: `extractTcNfrRefs` as a sibling of `extractTcAcceptanceRefs`; `extractAcceptanceIdRefs` untouched
- [x] 3.9 The reuse consumer rebuilds after restoring and falls back to a real run fail-closed
- [x] 3.10 V7⑤ / V7b / V9 in the `testing-trace-gates` suite, plus the reclassification of the existing mismatch table

## 4. Attended prompt shape (plan 5e1c7a93 D4 / S3)

- [x] 4.1 `buildUnattendedExecutionBlock` splits into a mode segment and a red-line segment; text unchanged
- [x] 4.2 The retired ledger veto sentence becomes an audit-trail statement
- [x] 4.3 `buildPhasePrompt` takes an optional `attended` flag; the production call site passes `executorMode === 'attended'`
- [x] 4.4 V10 in the `goal-headless-guard` suite: attended lacks the mode segment and keeps the red lines; detached keeps both

## 5. Specs and docs (plan 5e1c7a93 D5 / S4)

- [x] 5.1 This change's `harness-gates` delta (execution key MODIFIED, report-only MODIFIED, one-build ADDED)
- [x] 5.2 This change's `goal-runner` delta (unattended prompt injection and ledger wording)
- [x] 5.3 `MIGRATION.md` section: the UT run directory, `timing_complete` per leg, `--force-device` scope, the report-only WARN/UNKNOWN shape, `hdc-test.<module>.log`
- [ ] 5.4 Host regression is registered under B06 and is deliberately not done here
