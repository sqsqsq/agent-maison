## Why

Goal runs already persist phase progress in `events.jsonl` and `progress.json`, but the host-facing conversation only reports that progress when the user asks or when the entire background run completes. This leaves successful phase closures silent for minutes or hours, even though the runner has already produced `phase_verdict` events.

## What Changes

- Add a bounded `goal-monitor` CLI for agent-facing progress notifications from the existing goal run evidence layer.
- Fix progress projection so completed phase durations stop at phase completion instead of growing until the current time.
- Update the goal-mode skill/runbook so the main agent enters bounded monitoring after starting goal-runner during the current active turn.
- Document that bounded monitoring is not cross-turn chat wakeup; true push/wakeup remains an adapter or host enhancement.
- No breaking consumer migration is required.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-runner`: add bounded monitor behavior, notification-worthy event semantics, stable event index handling, heartbeat throttling, and completed phase duration projection.
- `goal-mode-skill`: require the host-facing goal-mode entry to use bounded monitoring during the active turn and document fire-and-forget / cross-turn boundaries.

## Impact

- Affected runtime scripts: `harness/scripts/goal-monitor.ts`, `harness/scripts/goal-status.ts`, `harness/scripts/utils/goal-progress.ts`.
- Affected docs/skills: `skills/project/goal-mode/SKILL.md`, `docs/operations/goal-mode-runbook.md`.
- Affected tests: goal progress/monitor unit coverage and CLI smoke tests under `harness/tests/unit/`.
- MIGRATION.md: no consumer migration entry required because this adds an optional CLI and tightens agent guidance without changing existing goal-runner artifacts.
