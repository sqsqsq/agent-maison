## 1. Honest Liveness Detection

- [x] 1.1 Add `findUnclosedHarness` so a `harness_start` with no `harness_end`/`phase_verdict` past the phase timeout is a hard stall.
- [x] 1.2 Add an absolute dead-man (`DEAD_MAN_FACTOR × phase_timeout`, lock-independent) so silence beyond the threshold is a hard stall.
- [x] 1.3 Unit coverage: 2026-06-25 incident replay (dangling harness + lock cleaned + 11h → STALLED not RUNNING), dangling-harness isolated, dead-man isolated, and no regression on the long-harness-window-with-heartbeat case.

## 2. Terminal Events

- [x] 2.1 `writeTerminalEvent(reason)` writes `run_end{status:INTERRUPTED}` synchronously (`appendFileSync`), idempotently, never throwing; a normal `run_end` suppresses it.
- [x] 2.2 Wire it first (before async tree-kills) in the signal handler, register Windows `SIGBREAK`, and add `process.on('exit')` + `.catch` backstops.
- [x] 2.3 Add `INTERRUPTED` to `ProgressRunStatus` and `TERMINAL_RUN_STATUSES`; unit coverage that `run_end{INTERRUPTED}` projects terminal `INTERRUPTED`, liveness `DONE`, and is not freshness-degraded.

## 3. Survival-First Launch Contract

- [x] 3.1 Rewrite the goal-mode SKILL launch section: correct `is_background` ≠ session survival; mandate `--detach` for unattended survival; add post-launch survival self-verify; document survival as an environment property.
- [x] 3.2 Mirror the survival-first principle into `docs/operations/goal-mode-runbook.md` above the chrys/opencode blocking-host section.
- [x] 3.3 Enforce at the code level: `evaluateForegroundSurvival` + `goal-runner` blocks a foreground unattended (`approval_mode=never`) start without `--detach`, with a `--foreground-ok` override; unit coverage for the matrix.

## 4. Validation

- [x] 4.1 `cd harness && npm test` (typecheck + unit + fixtures).
- [x] 4.2 `npm run openspec:validate`.

## 5. Deferred (tracked in plan, not this change)

- [ ] 5.1 Liveness beacon (`liveness.json`, `proc_identity` anti-pid-reuse, anti-`/F` probe).
- [ ] 5.2 Supervisor auto-resume + OS scheduled task (L3).
- [ ] 5.3 Declarative `launch`/`liveness`/`wakeup` capability + `framework.local.json` survival resolution (L1 infra) and cross-turn wakeup (L4).
