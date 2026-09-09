# Tasks

## 1. Reuse rounds write and are trusted by execution-key identity (plan 9b2d5e7c D1)

- [x] 1.1 `writeDeviceTestEvidenceIfEligible`: gate = install fact known (real install, or install reused with the provider's full digest) ∧ device execution fact present; optional doc fields `install_reused` / `reused_by_execution_key` / `execution_key` / `reused_run_dir`; holder carries `installReused` / `deviceRunReused` / `executionKey` / `reusedRunDir` from the install and run gates
- [x] 1.2 `execution-key.ts`: `isExecutionRecordReusable(record, runDir, { executionKey, artifacts?, label? })` extracted from `decideReuse`; `decideReuse` calls it (reason strings verbatim)
- [x] 1.3 `validateDeviceTestEvidenceBinding`: `install_reused` → compare `hap_sha256_full` with `ctx.currentHapSha256Full` (no real-install requirement); `reused_by_execution_key` → read `reused_run_dir/execution-key.json`, require the doc's key and the shared predicate, skip the run-meta window; `trace_path` and `written_at` checks kept; non-reuse docs verbatim
- [x] 1.4 `resolveCurrentHapSha256Full(projectRoot, reportsDir)`: install meta `hapPath` / `hapMtimeMs` / `hapSizeBytes` / 12-hex prefix + on-disk bytes → full digest or null; injected into `DeviceTestCollectContext` (with `projectRoot`) when the runtime collects testing defects
- [x] 1.5 V1 (install reuse + real run; both reused via a real `decideReuse` hit with rebuild; replaced HAP) and V2 (three identity mismatches; non-reuse doc reasons verbatim) in `device-test-backtrack`; holder wiring through the real `checkDeviceTestRunGate` in `golden-nav-capture-wiring`

## 2. Install reuse returns the full HAP digest (plan 9b2d5e7c D2)

- [x] 2.1 `device-test-install.ts` reuse branch computes `computeHapSha256Full(opts.hapPath)` (same source as the real-install branch) and returns it as `hapSha256Full`; no short-fingerprint fallback; `decideReuse` does not skip `hap=null` records
- [x] 2.2 V3 in `testing-trace-gates` (one real install, one reuse → identical 64-hex digest and equal execution keys; mock hdc transport only) and V4 (newest-record rule verbatim; predicate shared with `decideReuse`)

## 3. Top-slice derivation for same-width taller references (plan 9b2d5e7c D3)

- [x] 3.1 `image-toolkit.ts`: `classifyCompareReference` (existing ×1.15 rule ∧ same width), `resolveCompareReference` (re-crop every call into `_derived-ref/<ref_id>.top<shotH>.png`, derive failure → incompatible with a note), `splitMustHaveByTopSlice` (declared bbox only); `image-jimp-worker.cjs` `crop-top` (exact pixel crop, no trim)
- [x] 3.2 Capture: invalidation only on `incompatible`; `top_slice` screens skip/keep like ordinary screens and produce score/edge from the derived slice (main and overlay loops)
- [x] 3.3 Provider: targets use the derived slice (hashes, prompt, image inputs); prompt states the top-slice premise and lists out-of-scope/undetermined elements as "do not judge missing"; coverage pre-check expects the in-scope subset
- [x] 3.4 Check: pre-gate FAIL/WARN only for `incompatible`; `top_slice` screens emit a MINOR WARN line (`N out of scope / M undetermined`) under `visual_reference_viewport`; comparison index (OCR text placement) reads the derived slice; `visual_diff_region_attest` expects the in-scope subset; reference notes say "compared by the top slice; the rest is unverified"; attestation crops keep the original
- [x] 3.5 Spec pre-gate: same judgement against `lock.viewport`; derivable → PASS row noting the derivation; suggestion wording synced in both files; `visual-debt.ts` adds `visual_reference_viewport` as a debt source
- [x] 3.6 V5–V9 in `visual-fidelity` (existing b3d7e5a1 fixtures moved to a different width for the incompatible path); spec pre-gate case in `fidelity-snapshot`

## 4. Unverified is not a failure fact (plan 9b2d5e7c D4)

- [x] 4.1 `hasRuntimeFailureEvidence` drops the `unverified.length > 0` term; the narrower "trusted device root failures exist" term (`trustedDeviceRootClassifications` non-empty) is kept so `test_contract` attribution still persists (existing requirement, f4 t1)
- [x] 4.2 V10 in `goal-runner-testing-integrity`: only-unverified PASS+retry carries no attribution; harness FAIL + unverified, trusted visual defect + unverified, and trusted `test_contract` root failure keep it

## 5. Specs and docs (plan 9b2d5e7c D6)

- [x] 5.1 This change's `goal-runner` and `visual-diff` deltas; the `harness-gates` install-reuse paragraph stacked into the in-flight `execution-reuse-and-report-layering` delta
- [x] 5.2 `MIGRATION.md` 3.0.x entry (three behaviour changes with accepted accuracy loss)
- [x] 5.3 `cd harness && npm test` full pass (root AGENTS requirement; run once by the dispatcher after review)
- [x] 5.4 Host re-acceptance is registered under B06 `b06-host-b08-reacceptance` and is deliberately not done here

## 2026-09-08 closeout evidence

Plan B08 local full test: unit 3937/0, fixtures 46/0. B06 §10 records host runs deb77f and 73fc05: native execution-key reuse writes evidence, HAP key no longer alternates for the same inputs, top slices are used, and 73fc05 completes VALID without retry/backtrack. Top-slice disclosure semantics are superseded by completion-native-runtime-and-visual-debt.
