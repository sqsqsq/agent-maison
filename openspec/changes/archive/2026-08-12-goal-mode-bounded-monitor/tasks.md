## 1. Progress Projection

- [x] 1.1 Add ended_at tracking to goal progress phase spans and freeze completed phase duration at ended_at - started_at.
- [x] 1.2 Add unit coverage for completed phase duration stability and running phase duration growth.

## 2. Goal Monitor CLI

- [x] 2.1 Implement read-only `harness/scripts/goal-monitor.ts` with `--feature`, `--run-id`, `--since-event`, `--max-seconds`, `--markdown`, and `--json`.
- [x] 2.2 Implement notification classification for phase verdict, run end, liveness failure, no-op timeout, and low-frequency heartbeat with event-time threshold and dedupe.
- [x] 2.3 Add unit/CLI smoke coverage for edge notification, no-op timeout, heartbeat threshold, stale projection, latest run, and Windows-safe paths.
- [x] 2.4 Edge-trigger hard liveness anomalies (`STALLED`/`ORPHAN_SUSPECTED`) on `latestIndex > sinceEvent` so a frozen event stream no-ops instead of busy-spinning, with CLI coverage for notify-once-then-dedupe.

## 3. Goal Mode Contract

- [x] 3.1 Update `skills/project/goal-mode/SKILL.md` to require active-turn bounded monitoring, host tool timeout coupling, fire-and-forget, and cross-turn recovery boundaries.
- [x] 3.2 Update `docs/operations/goal-mode-runbook.md` with the same operational contract and clarify `GOAL_PHASE` as an accelerator only.

## 4. Validation and Plan Tracking

- [x] 4.1 Run `npm run openspec:validate`.
- [x] 4.2 Run `cd harness && npm test`.
- [x] 4.3 Run `npm run release:verify`.
- [x] 4.4 Update `.cursor/plans/goal-mode-bounded-monitor.plan.md` todo statuses for completed work.
