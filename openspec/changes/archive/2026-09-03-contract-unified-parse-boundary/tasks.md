## 1. Canonical shaped by real consumers (plan c7e2a9d4 T1)

- [x] 1.1 Collapse `ContractNavigationSpec` to `config_files?: string[]` and reduce the navigation reference-kind union to `navigation.config_files`
- [x] 1.2 Replace the fourteen navigation entries in the resolver field inventory with `navigation.config_files[]`, drop the `pages[]`/`routes[]` traversal, and narrow the navigation allowed set to `config_files`
- [x] 1.3 Sync the `x-file-reference-fields` metadata in `specs/artifact-schemas/contracts.schema.yaml` (no new schema execution mechanism — the file carries no real navigation schema section)
- [x] 1.4 Close the nested escape: when an unknown field name misses the file-like pattern and its value is an object/array, descend into the unknown subtree for rejection detection only (full source path, no reference resolution)
- [x] 1.4a (review P1) Remove the nesting depth budget — a limit that silently returns is itself a fail-open (a path buried 12 containers deep produced neither a reference nor an issue). Traverse with an explicit work stack and terminate on visited-container cycle detection instead of truncation
- [x] 1.4b (review round 2 P1) Apply the same iterative + visited-set treatment to the value-side `containsFileLikeValue`: after the outer scan became a work stack it was the remaining unguarded recursion, so a self-referential YAML anchor inside a file-like value raised `RangeError` during spec loading and aborted the load before any structured issue could be produced
- [x] 1.5 Table-driven negatives for every retired shape (`main_pages_file`, `route_map_file`, `page_registration_file`, `route_registration_file`, `page_files`, `route_files`, `pages[].file|page_file|route_file|registration_file`, `routes[]` siblings) plus a deeper nested-container case, a 12-level burial, and two cycle shapes (anchor under a plain container, and an anchor inside a file-like value), each asserting `unconsumed_file_field` and zero resolved references
- [x] 1.6 Keep `registration_points` rejected (zero consumers, no alias normalization) and pin both placements: the host incident shape `navigation.registration_points` and the top-level one
- [x] 1.7 Sync the fbdf0ad5-authored `bc-openCard/declared|undeclared` corpora to the canonical navigation shape

## 2. Bare-read collection (plan c7e2a9d4 T2)

- [x] 2.1 Add the pure selector `selectContractReferencePaths(closure, kind)` filtering the existing `references[]` — no new state, no second path projection inside the closure
- [x] 2.2 Rewrite `checkPageRegistration` to consume `featureSpec.referenceClosure` (with the `check-plan.ts`-style `??` fallback) through the selector and delete the `as Record` raw read
- [x] 2.3 Pin the status table: no NavDestination → SKIP; NavDestination with empty `config_files` → FAIL; declared-but-unreadable file → FAIL naming the path; readable → content verdict
- [x] 2.3a (review P1) Classify unreadability locally instead of trusting `existsSync`: a declared path that is a directory passes `existsSync` and `file_completeness`, and the resulting `EISDIR` escaping to `check-coding`'s `safeRun` becomes a non-blocking MINOR SKIP that can still claim done. Require a regular file and swallow read errors into the `unreadable` set → BLOCKER FAIL
- [x] 2.4 Keep phase ownership unchanged: plan adjudicates normalization + `contracts.files` authorization, existence stays with coding `file_completeness`

## 3. Bare-read prohibition guard (plan c7e2a9d4 T3)

- [x] 3.1 Add `harness/tests/unit/contracts-parse-boundary-guard.unit.test.ts` scanning root `harness/scripts` and each profile `harness` tree for raw `contracts.navigation` reads outside the parse-boundary module, with an inline exemption table carrying a reason per entry
- [x] 3.2 Add the guard self-test: injected violations (including the unquoted `contracts.navigation.config_files` chain and bracket access) must be caught, while selector consumption, `navigation_frame`, comments and the exemption table must not trip it
- [x] 3.3 Register the suite in `run-unit` CORE_SUITES and assert the scan surface cannot silently shrink to nothing

## 4. Cross-consumer integration test (plan c7e2a9d4 T4)

- [x] 4.1 Add `harness/tests/unit/contracts-cross-consumer-closure.unit.test.ts`: one SpecLoader load of a host-shaped INPUT drives both the production plan closure and the profile coding host structure checks, without extending the single-CMD/single-phase fixture-runner protocol
- [x] 4.2 Positive: authorized `config_files` → plan closure PASS and `page_registration` PASS through the real verification path (not SKIP)
- [x] 4.3 Negatives sharing one helper: path outside `contracts.files` → plan FAIL; authorized-but-unmaterialized file → plan PASS with `page_registration` FAIL (this suite deliberately does not assert `file_completeness`, which lives in root `check-coding.ts` outside the profile wiring); a declared path that is a directory → `page_registration` FAIL without throwing; NavDestination with empty `config_files` → `page_registration` FAIL; `navigation.registration_points` in the host's own nesting → `unconsumed_file_field` BLOCKER
- [x] 4.4 Register the suite in `run-unit` CORE_SUITES
- [x] 4.5 (review P2) Reproduce the host's actual nesting in the cross-consumer negative: `registration_points` sits under `navigation`, not at the top level, so the suite asserts `navigation.registration_points`

## 5. Spec and documentation (plan c7e2a9d4 T5)

- [x] 5.1 Publish this change against the already-merged canonical specs (`harness-gates`, `feature-artifact-layout`); reference the original mechanism change at its archived path `openspec/changes/archive/2026-08-27-plan-contract-reference-closure/`
- [x] 5.2 Correct the consumer-surface gap in active `goal-runtime-enforcement-fixes-2`: annotate 3.3/3.4 as the landing surface of this mechanism and reopen its 5.4 "no consumer migration is required" conclusion, which the host `config_files` incident falsified
- [x] 5.3 Sync the plan contracts template and the plan skill/reference wording to the canonical `navigation.config_files` shape
- [x] 5.4 `MIGRATION.md`: document exactly two consumer actions — rewrite navigation to `config_files`, and delete the zero-consumer `registration_points`
- [x] 5.5 (review P2) State the consumer relation one-directionally in the spec: a canonical field must have an identified consumer, but a consumer reading a non-canonical raw field does NOT make that field legal — otherwise any stray raw read would force the schema to legalize it and re-invert the authority model

## 6. Verification

- [x] 6.1 Run `npm test` at the repository root (harness typecheck + unit suites + fixtures)
- [x] 6.2 Run `npm run openspec:validate`
- [x] 6.3 Run `node scripts/check-plan-version.mjs`
- [x] 6.4 Run mandatory `npm run release:verify`
  - Deferred: the release gate is a branch-integration step for `Br_release_3.0.0`, and this change is delivered to the working tree for human review before any commit.
  - 2026-09-03 收口登记：宿主回归/回灌/跨夜 run 验证不在 3.0.0 窗口执行（用户裁决，同 4bcee33d）；本轮 npm test 3795/3795 + fixtures 46/46、openspec:validate 44/44 strict、release:verify ALL PASS（--skip-plan-release-gate --skip-typecheck）。
- [x] 6.5 Host replay on SimulatedWalletForHmos (`bc-openCard-1`): delete `registration_points`, rewrite navigation to `config_files`, rerun plan→coding→review→ut
  - Deferred: driven by the user separately; the host project is out of scope for this change.
  - 2026-09-03 收口登记：宿主回归/回灌/跨夜 run 验证不在 3.0.0 窗口执行（用户裁决，同 4bcee33d）；本轮 npm test 3795/3795 + fixtures 46/46、openspec:validate 44/44 strict、release:verify ALL PASS（--skip-plan-release-gate --skip-typecheck）。
