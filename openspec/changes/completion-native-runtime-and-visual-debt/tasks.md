# Tasks

## 1. asset axis (plan a3f7c1d9 D1)

- [x] 1.1 `resolveAssetAxisInheritance`: `detectRepoLayout(projectRoot)` → `inferRepoLayout(projectRoot)`; function exported for direct tests
- [x] 1.2 Remove the unconditional 7.2b "build fingerprint chain not wired" issue; comment names `device_test_install` as the build-chain owner
- [x] 1.3 `deriveQualityAxes`: zero-mapped visual/asset axis → `NOT_APPLICABLE`, asset in testing excepted
- [x] 1.4 V1 (`harness-runner-asset-inheritance`), V2 (`quality-axes`), V3 existing suites green

## 2. completion consumes native runtime evidence (plan a3f7c1d9 D2)

- [x] 2.1 `phaseManifestBindsRuntimeArtifacts(projectRoot, feature, doc)` extracted from `validateRuntimeFidelityEvidenceDocument`; the legacy validator calls it, other bytes unchanged
- [x] 2.2 `runtimeFidelityEvidenceIssue`: identity check on the doc, then `dispatchHylyreResult` three-way dispatch (v1 / legacy_unsupported / unsupported); unsupported never falls back
- [x] 2.3 V4 (first clean P0 completion positive case), V5, V6 (structurally complete `runtime_fidelity` + unsupported trace, still `needs_fix`; fixed in implementation review R1), V7 in `verify-feature-completion`

## 3. visual debt ledger (plan a3f7c1d9 D3)

- [x] 3.1 `deriveVisualDebt`: `visual_diff` hits grouped by `structured.kind`; four-state settlement (FAIL or non-MINOR SKIP opens, PASS/WARN closes, MINOR SKIP/absent keeps); B08 `visual_reference_viewport` special branch removed, source registration kept
- [x] 3.2 `applyVisualDebtPipeline`: visual axis suppressed only when `report.phase === 'testing'`
- [x] 3.4 D3(e) defects FAIL, disclosures WARN: `render_visibility_calibrate`, `asset_placeholder_present`, `asset_materialization_sanity` (non-critical branch), `visual_parity_unverified_crop` (non-hard-pixel branch) report `MAJOR` `FAIL` (severity unchanged); V13 in `visual-debt` + `harness-runner-asset-inheritance`; `asset-placeholder` profile assertion aligned
- [x] 3.3 V8–V10 in `visual-debt`, V11 and the blind-tier mixed regression (`runtime_mount_conformance` PASS + `visual_diff` BLOCKER SKIP → BLOCKED) in `harness-runner-asset-inheritance`; `visual-fidelity` B08-V8 and `visual-provider` t5 assertions aligned with the four-state rule

## 4. Specs and docs (plan a3f7c1d9 D5)

- [x] 4.1 This change's `runtime-step-evidence`, `visual-diff` (ADDED + MODIFIED viewport requirement), `feature-artifact-layout` (MODIFIED ledger requirement), `verdict-lattice`, `harness-gates` (MODIFIED render-visibility requirement: MAJOR FAIL, debt-gated) deltas
- [x] 4.2 `MIGRATION.md` 3.0.x entry (no forced full-chain rerun)
- [ ] 4.3 `cd harness && npm test` full pass (run once by the dispatcher after review)
- [ ] 4.4 Host re-acceptance per plan §5 (user-triggered, scope decided after the local fix)
