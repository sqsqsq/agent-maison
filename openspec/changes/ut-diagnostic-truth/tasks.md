## 1. UT Scope Truth

- [x] 1.1 Extract the shared `it()` block parser and keep existing check-ut parsing behavior covered.
- [x] 1.2 Add scope diagnostics and initial ignored/non-Git regression coverage; the initial tag-as-ownership experiment is superseded by 1.3.
- [x] 1.3 Remove feature-local AC/BD/branch tags as scope ownership keys; use explicit context/Git paths plus fallback and add a same-ID cross-feature regression.

## 2. Artifact Observation

- [x] 2.1 Replace silent DAG skipping with one-pass candidate/probed-directory/parse diagnostics and a path-specific BLOCKER.
- [x] 2.2 Add missing/invalid/loaded coverage-evidence observation and reuse it across coverage gates.
- [x] 2.3 Surface malformed testability-audit and mock-plan inputs, including partial fenced-YAML failures and invalid root shapes.

## 3. Coverage Evidence Truth

- [x] 3.1 Make coverage gate details and suggestions identify their real evidence sources and inspected UT/DAG/evidence paths.
- [x] 3.2 Enforce exact AC-vs-BD tag matching and archived-vs-ephemeral DAG source matching with unit tests.
- [x] 3.3 Align the hmos-app UT phase-rule descriptions with the implemented evidence contracts.
- [x] 3.4 Accept direct `[BD-<id>]` test-name prefixes and teach the exact AC/BD/BRANCH forms in runtime suggestions, phase rules, skill, and docs.
- [x] 3.5 Add this consumer-visible gate tightening to the generated 3.0.0 maintainer changelog through a completed versioned plan (do not hand-edit generated output).

## 4. Verification

- [x] 4.1 Run targeted unit tests and TypeScript typecheck after review fixes.
- [x] 4.2 Run `cd harness && npm test` with all unit and fixture checks passing after review fixes.
  - 2026-08-07 review rerun: this change's targeted suites and all 44 fixtures pass, but the full unit chain is externally blocked by a stale `device-readiness-gate.ts` physical-acceptance SHA in the concurrent lockscreen batch (3078/3079).
  - 2026-09-03 收口登记：宿主回归/回灌/跨夜 run 验证不在 3.0.0 窗口执行（用户裁决，同 4bcee33d）；本轮 npm test 3795/3795 + fixtures 46/46、openspec:validate 44/44 strict、release:verify ALL PASS（--skip-plan-release-gate --skip-typecheck）。
- [x] 4.3 Run `npm run openspec:validate` and `npm run release:verify`; confirm no `MIGRATION.md` update is required because canonical paths and schemas are unchanged.
  - 2026-08-07 review rerun: OpenSpec strict validation and release typecheck pass, and no migration note is needed. The unskipped release check is externally blocked only by nine unfinished 3.0.0 plans; all remaining release checks, including the 760-file zip assertions, pass with the plan release gate explicitly skipped.
  - 2026-09-03 收口登记：宿主回归/回灌/跨夜 run 验证不在 3.0.0 窗口执行（用户裁决，同 4bcee33d）；本轮 npm test 3795/3795 + fixtures 46/46、openspec:validate 44/44 strict、release:verify ALL PASS（--skip-plan-release-gate --skip-typecheck）。
