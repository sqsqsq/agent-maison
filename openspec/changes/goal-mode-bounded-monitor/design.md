## Context

Goal-runner already writes an append-only `events.jsonl`, derived `progress.json`, and final `goal-report.{md,json}` under each run directory. The missing piece is host-facing delivery: the active main agent does not have a bounded, agent-oriented reader that waits for phase-level milestones and returns one notification payload.

Existing `goal-status --watch` is human-facing terminal refresh. It is not suitable as the main agent contract because it is long-running, screen-oriented, and does not define edge-triggered notification semantics.

## Goals / Non-Goals

**Goals:**

- Provide `goal-monitor` as a pure read-only bounded monitor over existing run evidence.
- Notify on `phase_verdict`, `run_end`, hard liveness failures, and low-frequency ACTIVE heartbeat summaries.
- Keep the notification source adapter-independent: `events.jsonl` plus live progress projection, not child agent stdout.
- Fix completed phase duration projection by recording `ended_at`.
- Tighten goal-mode skill/runbook guidance so active-turn monitoring is the default.

**Non-Goals:**

- Do not implement cross-turn chat wakeup in framework scripts.
- Do not replace goal-runner verdict logic or duplicate `classifyPhaseVerdict`.
- Do not require consumer migration or change existing goal-runner run directory shape.
- Do not make `GOAL_PHASE` stdout the source of truth; keep it as an optional host acceleration signal.

## Decisions

1. **Add `goal-monitor.ts` instead of expanding `goal-status --watch`.**
   - Rationale: `goal-status` renders current state; `goal-monitor` waits for a notification-worthy edge and exits once.
   - Alternative considered: add `goal-status --until-event-change`. Rejected because it would overload a human status tool with agent notification semantics.

2. **Use event index as the cursor.**
   - `event_index` is the zero-based line index in `events.jsonl`.
   - `--since-event N` means only events with index greater than N can produce edge notifications.
   - Cross-turn recovery does not require a persisted marker in v1; the agent can rebuild current state and recent verdicts from the run directory.

3. **Keep monitor read-only and timeout-safe.**
   - `goal-monitor` MUST NOT start, resume, kill, or mutate a goal run.
   - Default `--max-seconds` is 240s and examples require host shell/tool timeout to exceed it, typically 300s.
   - If a host kills the monitor, it is harmless and can be retried.

4. **Heartbeat notifications use event time, not invocation time.**
   - Low-frequency ACTIVE summaries use a fixed `SOFT_STALL_MS = 10min` threshold derived from run events/live snapshot timestamps.
   - A single 240s monitor call must not itself trigger a heartbeat notification.
   - Same-phase heartbeat summaries are deduplicated unless the threshold boundary or status summary changes materially.

5. **Completed phase durations stop at `ended_at`.**
   - Normal `ended_at` is the phase `phase_verdict.ts`.
   - For legacy/recovery gaps, fallback to the next phase `phase_start.ts` or `run_end.ts`.

## Risks / Trade-offs

- **Risk:** Users may read "active monitoring" as guaranteed background push.  
  **Mitigation:** Skill/runbook explicitly state bounded monitor works only while the main agent turn remains alive; cross-turn wakeup belongs to host/adapter enhancements.

- **Risk:** Host shell default timeout kills a monitor before `--max-seconds`.  
  **Mitigation:** Docs require agents to set host tool timeout greater than `--max-seconds`; examples use 240s monitor with at least 300s tool timeout.

- **Risk:** Heartbeat summaries become noisy.  
  **Mitigation:** Use 10-minute event-time threshold plus same-phase dedupe.

- **Risk:** Cursor reconstruction after interrupted turns may duplicate historical summaries.  
  **Mitigation:** v1 favors no missed updates over perfect de-duplication; output should identify recent verdicts and current status without claiming what the user has already seen.
