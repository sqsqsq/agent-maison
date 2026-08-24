## 1. Supervisor and recovery boundary

- [x] 1.1 Gate `goal-supervise` by validated run-control owner state before the existing decision core, preserving process-owner WAITING probe recovery and zero events for every session state.
- [x] 1.2 Resolve the detached TypeScript preload to a framework-owned absolute path and cover project-root detach startup.
- [x] 1.3 Align goal-mode recovery guidance so non-orphan owner conversion uses mailbox handoff and only explicit orphan takeover may use `--force-resume`.

## 2. Attended goal context and fidelity SSOT

- [x] 2.1 Add one shared exact-run attended context validator for run ID, feature, current session owner/epoch, and unexpired lease.
- [x] 2.2 Bind `phase_execute_request.run_id` to `fidelity-intent-init --goal-run-id`, write manifest-backed goal provenance at the spec entry point, and preserve same-run byte-stable reuse/downstream read-only behavior.
- [x] 2.3 Add `harness-runner --goal-run-id` validation and inject the existing goal environment before any goal-sensitive harness logic.
- [x] 2.4 Require attended `--run-mode attended` before owner CAS, accept truthful `--adapter-source`, and add focused bridge/entry/initializer/harness regressions.

## 3. Adapter-neutral entry and local-first setup

- [x] 3.1 Remove static adapter identity from every generated skill bridge, correct Chrys coexistence notes, and test generic↔Chrys materialization in both orders using `goal-mode/SKILL.md`.
- [x] 3.2 Make goal-mode personal setup local-first, keep interaction rendering adapter-owned, and correct the personal-setup running-identity reference.

## 4. Verification and host closure

- [x] 4.1 Run targeted unit tests and `npm run typecheck` for the changed runtime, bridge, setup, and entry surfaces.
- [x] 4.2 Run `cd harness && npm test`, `npm run openspec:validate`, plan/version validation, and `git diff --check`.
- [x] 4.3 Run the four host smokes: attended run, unattended run, supervisor one-shot on an active session, and detach from the consumer project root.
- [x] 4.4 Run mandatory `npm run release:verify`; only after all four host smokes pass, complete the OpenSpec change and archive it.

## 5. Post-archive attended closure review remediation

- [x] 5.1 Restore this change and rebase its delta specs against the already-synced main requirements; reopen the corresponding plan todos without creating a parallel change.
- [x] 5.2 Bind each attended phase request to run/phase/attempt/owner/epoch, validate that fence at initializer, harness, and sync-closure entry, reuse the receipt scaffold writer, and inject the existing gate/attempt environment.
- [x] 5.3 Reject attach adapter drift before owner CAS, reuse the manifest adapter downstream, reuse the manifest-owned provenance enum, and make supervisor mailbox completion consume the canonical handoff validator.
- [x] 5.4 Add focused regressions plus a real attended initializer → harness → receipt → sync-closure E2E covering formal writer routing, byte-stable fidelity, suppressed phase state, and stale-epoch rejection.
- [x] 5.5 Run proportional target tests, `cd harness && npm test`, OpenSpec/plan/diff checks, the four consumer host smokes, and mandatory release verification; archive only after all in-scope gates pass.
