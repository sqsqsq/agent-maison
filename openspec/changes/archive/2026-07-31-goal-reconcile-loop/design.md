## Context

`skill-contracts-assess` introduces the deterministic `assess@1` qualification/recommendation contract. Today, however, interactive goal mode and `harness/scripts/goal-runner.ts` do not share one orchestration brain:

- the goal-mode skill delegates most behavior to the external runner;
- the runner's large `main()` interleaves event emission, process guards, retry budgets, backtracking, and about two dozen cross-phase action overrides;
- interactive sessions have no canonical run ledger or persistent ownership primitive;
- existing feature/run locks are owned by a live PID and cannot be held across independent in-session tool calls;
- no safe control channel asks a detached owner to quiesce at a phase boundary.

This change is strictly dependent on the frozen `assess@1`, contract schema, summary 1.2, and closure semantics from `skill-contracts-assess`.

## Goals / Non-Goals

**Goals:**

- Use one assess-driven reconciliation loop for interactive and detached goal execution.
- Keep transition authorization, process safety, evidence trust, and execution guards in drivers.
- Preserve existing headless events, manifests, progress, trust ledgers, detach survival, monitor, and usage semantics.
- Give users only two simple run modes while routing internally by adapter capability.
- Transfer one run between in-session and detached drivers without concurrent writers or resettable fencing epochs.
- Refactor the runner in two reversible steps: boundary extraction, then orchestration rewiring.

**Non-Goals:**

- No Stop-hook loop or host-specific lifecycle hooks.
- No automatic takeover of an expired session lease.
- No new off-repository run/trust state.
- No migration of monitor polling budgets into assess.
- No LLM inside assess and no second cross-phase decision engine.
- No supervisor auto-resume; the 3.1.0 liveness change builds on this control model.

## Decisions

### 1. The loop is shared; authorization remains driver-owned

All drivers implement:

```text
assess → stop/fuse/report
       → authorize recommendation
       → execute one phase skill and harness closure
       → assess again
```

Assess determines whether an action is qualified and recommended. The driver enforces `manual`, `batch_authorized`, or `goal_mode`, including `through_phase` and human/device confirmations.

Alternative rejected: moving authorization into assess. A recommendation is derived from state and must not silently become permission.

### 2. User modes are simple and capability-routed

The user sees:

- **有人在场**: continue automatically while work is authorized; ask immediately when human input is required.
- **无人值守**: execute authorized automatic work; park human-only work and survive session closure.

Explicit natural-language intent is reflected without another prompt. Ambiguous intent uses `confirmation-registry.yaml > goal.run_mode`. CLI `--detach` is inherently unattended.

Internally:

- adapters without in-session reconciliation use manual harness+assess;
- unattended mode requires the existing external-runner/unattended preflight;
- handoff requires explicit resume and handoff capabilities;
- phase-isolated in-session execution requires a phase-context isolation capability.

Internal tier/headless terminology does not appear in user menus.

### 3. In-session phases use isolated execution context

The interactive goal driver retains only the run checkpoint, authorization, current assessment, and waiting items. Each recommended feature phase executes in a phase-scoped fresh context/subagent when the adapter declares that capability. Only structured outcomes and harness artifacts return to the driver.

Adapters without phase isolation do not run the autonomous in-session loop; they fall back to manual harness+assess. This preserves the fresh-context-per-phase safety property rather than relying on unbounded conversation compression.

### 4. In-session and headless use the same run evidence

Both drivers use the same goal manifest, `events.jsonl`, progress projection, phase outcomes, and run ID. In-session execution is a new writer of the existing schemas, not a parallel ledger.

Only the current fenced owner writes authoritative events. A non-owner requests handoff through the mailbox and never appends `handoff_requested` directly.

### 5. `run-control@1` is the persistent fencing SSOT

Each authoritative goal run contains a persistent `run-control.json`:

```json
{
  "schema": "run-control@1",
  "run_id": "...",
  "current_epoch": 7,
  "owner": {
    "kind": "process",
    "owner_id": "...",
    "epoch": 7,
    "pid": 1234,
    "hostname": "...",
    "state": "active"
  }
}
```

`current_epoch` never resets or disappears when an owner releases feature/run lock projections. Both process and session owners carry the common epoch:

- process liveness retains the existing same-host PID rule and heartbeat behavior;
- session liveness uses a lease deadline and session owner ID.

Epoch changes use a short-lived, exclusive control mutex plus compare-and-swap against the expected epoch, followed by atomic rename of `run-control.json`. Concurrent takeover attempts cannot both commit.

Feature/run lock files remain current-owner projections. They do not own the epoch.

### 6. Every driver boundary is fenced

Before assess, recommended-phase invocation, harness/finalizer execution, event append, progress write, and terminal publication, the driver verifies `(run_id, owner_id, epoch)` against `run-control@1`.

An expired session becomes `orphaned_session`. Expiry does not increase the epoch or authorize another owner. Only:

- a cooperative handoff accepted by the current owner; or
- an explicit user takeover/force-resume

can CAS-increment the epoch.

A resumed old session must revalidate before any new phase action and is permanently rejected after a later epoch commits.

### 7. Handoff uses an atomic mailbox and owner-authored events

Requests are written atomically under the run directory and bind:

- `request_id`
- `run_id`
- `from_epoch`
- `target_owner_kind`
- request timestamp/expiry

The current owner polls only at safe phase boundaries. If the request matches its epoch, it:

1. appends `handoff_requested`;
2. moves to quiescing and publishes progress;
3. releases lock/lease projections without deleting `run-control@1`;
4. allows the new owner to CAS-increment the epoch and acquire projections;
5. the new owner appends `handoff_accepted` before work continues.

Stale, duplicate, wrong-run, and wrong-epoch requests are ignored/rejected and remain auditable. If the transfer crashes between release and acceptance, the run remains quiescent and resumable; it never starts both owners.

### 8. Extract `ReconcileObservation@1` before rewiring

Step one creates a versioned pure input boundary containing:

- phase outcome and failure kind;
- blocker actionability and deterministic P0 defects;
- used retry/backtrack budgets;
- repeated-round fingerprint;
- invalidatable phases;
- timeout, operator-interrupt, and API-disconnect signals.

The existing runner derives these facts from authoritative events and process state. Fixtures lock the current event/verdict/action sequence, so boundary extraction is a zero-semantic-change step.

### 9. Rewire only cross-phase decisions

Step two changes orchestration to `while (assess → headless invoke)`. Assess becomes the only cross-phase recommendation/loop-fuse brain.

The driver retains:

- process timeout enforcement and child-tree cleanup;
- budgets, backoff, and retry execution;
- trust/checkpoint/pass-snapshot mechanics;
- device gates and source-write protections;
- event persistence, monitor, usage capture, and detached survival.

These mechanisms provide facts or enforce execution; they do not independently select a next phase.

### 10. Fuse boundaries remain distinct

- monitor fuse: polling/notification budget only, never kills the detached run;
- assess fuse: phase-boundary no-progress/active-time reconciliation stop;
- driver guard: process safety, timeout, budget, trust, device, and write enforcement.

## Risks / Trade-offs

- [Old owner resumes after takeover] → durable common epoch and mandatory boundary checks reject it.
- [Epoch resets when lock is released] → epoch lives only in persistent `run-control@1`; locks are projections.
- [Two takeovers race] → exclusive control mutex plus expected-epoch CAS allows one winner.
- [Requester corrupts events] → requester writes mailbox only; current owner authors authoritative handoff events.
- [Session lease expires while user is idle] → mark orphaned and require explicit takeover; never auto-start another writer.
- [In-session context accumulates] → require phase-isolated execution or degrade to manual mode.
- [Runner rewrite changes existing decisions] → extract and fixture-lock the observation/action boundary before rewiring.
- [Assess and driver become two decision brains] → assess selects phases; driver only authorizes and enforces execution.
- [Capability differences leak into user UX] → keep two user modes and explain only the effective fallback behavior.

## Migration Plan

1. Complete and validate `skill-contracts-assess`.
2. Extend adapter capability schema and add conservative defaults/fallback behavior.
3. Extract `ReconcileObservation@1` and lock existing event/verdict/action fixtures.
4. Add `run-control@1`, fencing validation, mailbox, and handoff tests without changing default goal execution.
5. Add the in-session driver and evidence writer behind capability routing.
6. Rewire headless cross-phase orchestration to assess while preserving process guards.
7. Update goal-mode skill, operations docs, and `MIGRATION.md`.
8. Rollback by routing all goal execution through the existing external runner while retaining readable control/evidence state; never ignore a committed newer epoch.

## Open Questions

None. The dependent `assess@1` and contract schema versions are inputs to implementation and must not be redefined in this change.
