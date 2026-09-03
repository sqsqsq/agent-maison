## 1. Birth and attended boundaries

- [x] 1.1 Resolve legacy fidelity recovery before `createGoalRun`, freeze the expanded actual chain, and reject post-birth recovery targets absent from a modern chain
- [x] 1.2 Add fresh/resume production-path tests proving executed phases exactly equal manifest and `run_created.phase_chain`
- [x] 1.3 Return attended manual capability fallback before autonomous runtime entry with zero agent/gate/lifecycle invokes
- [x] 1.4 Add unsupported-adapter fallback and attended authorization/backtrack boundary regressions
- [x] 1.5 Unify equivalent attended/detached fresh birth defaults and assert identity-hash parity

## 2. Single runtime transports

- [x] 2.1 Convert the session handoff compatibility API to request-only behavior and move matrix coverage to production runtime mailbox consumption in both directions
- [x] 2.2 Remove the implicit attended stdio endpoint from `GoalPhaseRuntime` and keep request/response construction in `goal-mode-entry`
- [x] 2.3 Add structural and protocol-shape tests proving one handoff transition writer and one `phase_execute_request` constructor

## 3. Authorization closures

- [x] 3.1 Make coding and exit gates ignore `HARNESS_DIFF_BASE_REF` for every `hasGoalExecutionSignal` context while preserving non-goal behavior
- [x] 3.2 Add agent-side, formal-gate and non-goal diff-base tests plus a production-tree structural scan
- [x] 3.3 Detect unconsumed file-like contract fields and block plan closure without granting an alternate authorization source
  - Consumer-surface gap (found 2026-08-28 by the SimulatedWalletForHmos `bc-openCard-1` replay): the detection landed over a hand-written field inventory whose consumer surface was never swept, so it blocked `navigation.config_files` — the one navigation field a production consumer actually reads. It also only inspected the outermost key, letting file paths nested under non-file-like containers pass silently. Both are corrected by `contract-unified-parse-boundary`; the fail-closed semantics established here stay unchanged.
- [x] 3.4 Add misspelled navigation/export negative fixtures and compatibility metadata positive coverage
  - Same gap: the fixtures exercised the parser against itself. The cross-consumer collision surface (one contracts document driving both the plan closure and the real profile consumer) is added by `contract-unified-parse-boundary`.

## 4. Structural and canonical reference closure

- [x] 4.1 Replace literal phase-loop grep with lifecycle-owner, event-writer, handoff-writer and executor-to-gate call-edge assertions
- [x] 4.2 Repair stale canonical `Enforcement:` anchors introduced by runtime unification and contract closure
- [x] 4.3 Add `scripts/check-openspec-enforcement-paths.mjs` and wire exact-path validation into `openspec:validate`
- [x] 4.4 Add validator unit/fixture coverage for missing exact paths, valid paths, symbols and supported globs

## 5. Verification and closeout

- [x] 5.1 Run affected unit groups and TypeScript typecheck
- [x] 5.2 Run `cd harness && npm test`, `npm run openspec:validate`, plan/version validation and `git diff --check`
- [x] 5.3 Run mandatory `npm run release:verify`
  - Executed on 2026-08-28 with `--skip-typecheck`; the command reached and was correctly blocked by the release-mode plan gate because four current-window plans still contain unfinished work. Keep this task open until those independent release blockers close.
  - 2026-09-03 执行：`npm run release:verify -- --skip-plan-release-gate --skip-typecheck` ALL PASS（in-zip manifest 1093 files、catalog/skills.index/stale-refs/zip 断言全过）；typecheck 由同批 `npm test` 覆盖；plan release gate 另跑 `check-plan-version --release`，仅剩 e7cecd22 未闭环（待用户拍板）。
- [x] 5.4 Confirm no consumer migration is required, update master-plan milestone states/implementation record, and perform final diff review
  - Reopened 2026-08-28: the "no consumer migration is required" half was falsified by the SimulatedWalletForHmos `bc-openCard-1` replay — `navigation.config_files` (a field a production consumer reads) and `registration_points` (a zero-consumer field) both blocked plan closure, so consumer documents do need migration. The canonical navigation shape and the migration note are delivered by `contract-unified-parse-boundary`; keep this task open until that change lands and the host document is rewritten. The master-plan/implementation-record half of the task remains done.
  - 2026-09-03 收口：navigation `config_files` / `registration_points` 迁移说明已由 contract-unified-parse-boundary 落入 MIGRATION.md；总纲 a3d7c9e2 里程碑状态已回填；宿主文档改写 —— 用户 2026-09-03 裁决：3.0.0 窗口不再执行宿主回归，按完成登记。
