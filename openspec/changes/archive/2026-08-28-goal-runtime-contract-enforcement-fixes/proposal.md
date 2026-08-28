## Why

Goal run birth and the shared phase runtime still leave four public contracts unenforced: the actual phase chain can be re-resolved on resume, a baseline can be added after a baseline-free birth, attended authorization limits are not applied at runtime boundaries, and production-shaped rejected handoffs disappear from canonical lifecycle projection. These are deterministic correctness defects hidden by the current green test suite and must be corrected before the runtime-unification master plan can close.

## What Changes

- Persist the normalized actual phase chain in the existing manifest and `run_created` birth facts, and require modern resume/attach to replay that frozen chain without workflow re-resolution.
- Make birth validation and the shared baseline resolver reject every `run_base_sha` presence or value mismatch against `run_created`.
- Make the shared `GoalPhaseRuntime` enforce attended manual, batch-through-phase, lease, and per-call round limits at phase boundaries while keeping executors policy-free.
- Include the requested owner direction in production `handoff_rejected` events so canonical lifecycle projection retains failed transfers.
- Add production-path regression tests for workflow drift during resume, baseline injection, manual zero-invoke, batch boundary, single-round boundary, and rejected-handoff projection.
- Reopen the affected master-plan milestones during correction; do not edit archived OpenSpec history.
- No consumer migration is required: this restores the already documented public contracts and rejects states that were never valid.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `goal-runner`: Freeze the normalized actual phase chain at birth and validate baseline presence as well as value through the shared birth/baseline path.
- `goal-mode-skill`: Enforce attended authorization and round limits at shared runtime phase boundaries.
- `goal-driver-handoff`: Preserve failed handoff direction in production events and canonical lifecycle projection.

## Impact

- Runtime and birth code: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-mode-entry.ts`, `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-run-baseline.ts`, manifest validation/types, and canonical lifecycle projection.
- Tests: goal birth, phase runtime, in-session driver/entry, baseline consumers, and structural acceptance suites.
- Documentation/specification: OpenSpec deltas and the current 3.0.0 master-plan task statuses. `MIGRATION.md` does not need a consumer migration entry because no supported behavior is removed.
