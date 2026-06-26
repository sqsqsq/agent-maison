## Why

A goal run launched via a host's background mode (Cursor `is_background`) died the instant its launching agent turn ended, then sat dead for ~11h while `goal-status` kept projecting `RUNNING`. Two root causes: (1) the orchestrator was a session-bound child, not OS-detached, so the host reaped it; (2) an interrupted run wrote no terminal event and, with its locks cleaned on graceful exit, the liveness projection had no signal that could escalate past a soft `RUNNING` — a dead run was painted as running. Empirically (2026-06), a true `--detach` process survives Cursor fully closing and reopening, while `is_background` does not.

## What Changes

- Honest liveness: a dangling `harness_start` with no `harness_end`/`phase_verdict` past the phase timeout, and any silence beyond an absolute dead-man threshold, are detected as hard stalls so a killed-and-lock-cleaned run can never project as `RUNNING`.
- Terminal events: any abnormal exit (catchable signal / crash / process exit) writes `run_end{status:INTERRUPTED}` synchronously and idempotently; projection treats `INTERRUPTED` as terminal and skips freshness degradation.
- Survival-first launch contract: unattended runs use real `--detach` (verified to survive Cursor session close) rather than relying on `is_background`, with a post-launch survival self-verify; the "control returned" ≠ "process survives my session" conceptual error is corrected. Survival is documented as an environment property. The runner enforces this at the code level: a foreground unattended start (`approval_mode=never`) without `--detach` is a BLOCKER, overridable with `--foreground-ok`.
- No breaking consumer migration: existing goal-runner artifacts and CLIs are unchanged; this adds detection signals, an `INTERRUPTED` status, terminal-event hooks, and tightened launch guidance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-runner`: absolute dead-man and dangling-harness stall detection; `INTERRUPTED` terminal status; terminal-event hooks on all abnormal exit paths (incl. Windows `SIGBREAK`).
- `goal-mode-skill`: survival-first launch using `--detach` for unattended survival, post-launch self-verify, and the environment-property caveat.

## Impact

- Affected runtime scripts: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-progress.ts`.
- Affected docs/skills: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`.
- Affected tests: goal progress unit coverage under `harness/tests/unit/goal-progress.unit.test.ts` (incident replay, dead-man, dangling harness, terminal INTERRUPTED).
- Deferred (not in this change): liveness beacon (`proc_identity` anti-pid-reuse, anti-SIGKILL probe), supervisor auto-resume (L3), declarative wakeup capability (L4) — detection is already layered via terminal event + existing lock/pid orphan probe + dead-man.
- MIGRATION.md: no consumer migration entry required.
