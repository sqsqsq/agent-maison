# Tasks

## 1. Candidate collection routes by defect severity (plan 6e4a2c8b D1)

- [x] 1.1 `collectActionableDefects` §A: `severity: minor` structured defects produce no actionable item; per-screen count logged once; `major` / `blocker`, the plain-text fallback and the unverified route are untouched
- [x] 1.2 V1 / V2 in the `device-test-backtrack` suite (host i13 shape: 12 minor → 0 candidates; one T8 promoted to major → exactly one candidate with an unchanged fingerprint and `category: coding`)
- [x] 1.3 V6 in the `goal-runner-repair-convergence` suite: assess on the i13 observation with empty candidates no longer returns `rerun_phase` / `backtrack_to_phase` (no run end-state is asserted)

## 2. Hard findings cannot be transcribed as minor (plan 6e4a2c8b D2)

- [x] 2.1 Transcription reconciliation keeps the matched defect; hard tier + `minor` → `visual_diff_finding_transcription` "hard finding downgraded" with the unlogged-hard ratchet and `transcriptionDirty` on FAIL
- [x] 2.2 V3 in the `visual-fidelity` suite: hard contract FAIL + `fingerprintable=false`; best_effort WARN; same finding as `major` → hit gone and round fingerprintable again

## 3. Reuse does not bypass golden capture (plan 6e4a2c8b D3)

- [x] 3.1 Capture block hoisted into a local closure `captureIfUiChanged(logPath)` (body verbatim); reuse branch calls it when the golden env resolves to targets, with `logPath` under the top-level reports dir so nav options come from the restored `device-test-run.meta.json`
- [x] 3.2 Both branches append `golden_contract=<sha16>|none` to `visual_diff_capture` details; golden identity is not part of the execution key
- [x] 3.3 V4 / V5 in the `golden-nav-capture-wiring` suite through the real `checkDeviceTestRunGate` (mock device transport only): golden → no reuse PASS line, capture entry runs, nav `omitBundle=true`, `reused_by_execution_key=true`; no golden → verbatim PASS line + `golden_contract=none`, zero device events

## 4. Specs and docs (plan 6e4a2c8b D6)

- [x] 4.1 This change's `goal-runner` and `visual-diff` deltas
- [x] 4.2 `MIGRATION.md` 3.0.x entry (behaviour change + accepted accuracy loss)
- [x] 4.3 `cd harness && npm test` full pass (root AGENTS requirement; run once by the dispatcher after review)
- [x] 4.4 Host re-acceptance is registered under B06 `b06-host-b07-reacceptance` and is deliberately not done here

## 2026-09-08 closeout evidence

Full test evidence is recorded by subsequent B08/a3f7c1d9 local acceptance. B06 b06-host-b07-reacceptance was already completed from run 20260907T063800Z-26c3b0: minor signals produced no repair candidates/backtracks. Its HALTED terminal and non-applicable golden sample remain recorded; 73fc05 additionally completes with disclosed minor differences. This is not golden release acceptance.
