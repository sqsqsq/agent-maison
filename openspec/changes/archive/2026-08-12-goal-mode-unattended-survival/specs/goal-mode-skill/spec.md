## ADDED Requirements

### Requirement: Unattended launch survives the host session via real detach

The goal-mode launch contract SHALL require unattended runs to use real `--detach` (OS-level `detached` + `unref` + file-redirected stdio) for session survival, rather than relying on a host background mode (`is_background` / `run_in_background`). The contract SHALL state explicitly that "control returned to the agent" is not "the process survives my session": a host background child is session-bound and is reaped when the agent turn or session ends.

Enforcement: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`

#### Scenario: Unattended run uses detach for survival

- **WHEN** the main agent starts a goal run for unattended completion
- **THEN** the launch SHALL use `--detach`; a host background mode MAY additionally wrap the launcher for non-blocking control, but survival SHALL be attributed to `--detach`, not the host background mode

#### Scenario: Post-launch survival self-verify

- **WHEN** the launcher returns `{run_id, report_dir, log, pid}`
- **THEN** the agent SHALL confirm the run actually started (detach.log growing and `goal-status` liveness healthy) before reporting it as running, and SHALL report "startup did not survive" otherwise rather than claiming a background run is in progress

#### Scenario: Survival is an environment property

- **WHEN** the host reaps process trees/groups on teardown (e.g., `taskkill /T` or a kill-on-close Job Object, since Node `detached:true` does not set `CREATE_BREAKAWAY_FROM_JOB`)
- **THEN** the contract SHALL document that `--detach` alone is insufficient there and the run must be hosted by an OS scheduled task (cron / Windows Task Scheduler)

#### Scenario: Foreground unattended start is blocked at the code level

- **WHEN** a real (non-dry-run) unattended run (`approval_mode=never`) is started in the foreground without `--detach` and is not the OS-detached child
- **THEN** `goal-runner` SHALL exit with a BLOCKER directing the operator to `--detach`, unless `--foreground-ok` is passed (which downgrades it to a warning); dry-runs and the OS-detached child are never blocked
