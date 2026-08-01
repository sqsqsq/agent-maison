## Why

Goal mode currently duplicates cross-phase decisions inside a large external runner while the interactive skill cannot safely provide the same autonomous loop or hand execution to/from a detached process. Once `skill-contracts-assess` freezes deterministic qualification and recommendation, goal orchestration can converge on that single brain without losing the runner's evidence, safety, and unattended-survival guarantees.

## What Changes

- Make the goal-mode skill a thin in-session driver over `assess@1`, with user-facing “有人在场 / 无人值守” mode selection and stable per-round status.
- Preserve transition authorization in the driver while removing independent next-phase decisions from the skill and goal runner.
- Extract the current goal-runner decision/event boundary behind versioned `ReconcileObservation@1` before rewiring orchestration.
- Rewire headless orchestration to `while (assess → invoke recommended phase)` while retaining process safety guards, budgets, backoff, trust ledgers, device gates, monitor, usage capture, and detached survival.
- Add `run-control@1`, common fencing epochs, session leases, and an atomic handoff mailbox so in-session and detached drivers can transfer one run without split-brain.
- Add capability routing so unsupported adapters degrade to manual harness+assess, unattended execution requires existing preflight, and handoff requires declared support.
- **BREAKING** Update goal-mode skill semantics and adapter `goal_capability` declarations to describe reconcile-loop, in-session evidence, resume, and handoff behavior.

## Capabilities

### New Capabilities

- `goal-driver-handoff`: Persistent driver epochs, process/session ownership, fencing, mailbox requests, safe phase-boundary quiescence, and explicit takeover.

### Modified Capabilities

- `goal-mode-skill`: Goal mode becomes an assess-driven loop with simple user modes, authorization context, evidence continuity, and capability fallback.
- `goal-runner`: The headless runner consumes `assess@1` through `ReconcileObservation@1` while preserving existing safety and evidence semantics.
- `agent-adapters`: Goal capabilities declare in-session, unattended, resume, and handoff support used by deterministic routing.

## Impact

- Depends on the frozen `assess@1`, contract schema, and summary 1.2 behavior delivered by `skill-contracts-assess`; implementation is strictly serial.
- Affects `skills/goal/`, `harness/scripts/goal-runner.ts`, goal-run utilities, goal events/progress/manifest handling, lock files, adapter schemas/YAML, and operations documentation.
- Adds in-repo run-control and mailbox state under the existing goal-run directory; no new off-repository trust state is introduced.
- Existing detach launch/survival, evidence formats, monitor semantics, and usage capture remain compatible; orchestration and user interaction change and are documented in `MIGRATION.md`.
