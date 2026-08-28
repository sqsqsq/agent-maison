## Context

The 3.0.0 runtime unification established a single lifecycle runtime and a fresh-only birth operation, but four enforcement gaps remain at their boundaries. `createGoalRun` receives the resolved chain without persisting it, modern runtime entry re-resolves workflow state, the baseline resolver trusts a post-birth manifest value when the birth event omitted it, attended entry accepts authorization limits without passing them into the runtime, and rejected handoff events omit the target direction required by canonical projection.

The correction must preserve the existing single sources of truth: `manifest.json` plus `run_created` for birth, `GoalPhaseRuntime` for lifecycle policy, and the current handoff event stream for ownership transitions. Existing archived OpenSpec material is immutable; this change is the follow-up correction record.

## Goals / Non-Goals

**Goals:**

- Freeze and replay the normalized actual phase chain as part of the existing run birth contract.
- Make the shared birth/baseline path reject all baseline presence and value drift.
- Enforce attended authorization, through-phase and round limits inside `GoalPhaseRuntime` at safe phase boundaries.
- Preserve production failed-handoff direction in canonical lifecycle output.
- Cover each defect through a production-path negative or parity test.

**Non-Goals:**

- No new manifest, ledger, state machine, authorization layer, handoff table or executor policy.
- No rewrite of archived OpenSpec history.
- No removal of era-isolated legacy baseline readers; that remains deferred to 3.1.0.
- No adapter- or profile-specific behavior change and no consumer migration.

## Decisions

1. **Store the normalized chain in both existing birth surfaces.** `GoalManifest` gains the resolved chain field and `run_created` binds the same value. Fresh creation normalizes once. Modern load validates equality and returns the frozen chain; only explicitly legacy-era runs may use the guarded workflow-resolution fallback. This keeps manifest plus its birth event as the existing paired truth rather than adding a chain ledger.

2. **Validate baseline as an optional field with exact presence semantics.** Creation validation compares whether `run_base_sha` exists in both manifest and birth event before comparing its value. `resolveGoalRunBaseline` consumes that validator so direct gate callers cannot trust an injected manifest value. Values remain validated as exact 40-hex SHAs by existing schema logic.

3. **Represent attended limits as runtime boundary policy.** The runtime receives the already public authorization mode, optional through-phase, lease deadline and round budget. It checks these before each phase starts; executors continue to receive only immutable execution context and invocation output remains their sole responsibility. A single-round call consumes at most one phase boundary, including a retry loop owned by that phase.

4. **Make rejection events self-describing.** `handoff_rejected` writes the request's `target_owner_kind` (and therefore the existing projector can derive `from/to`). Tests project the actual event written by production code rather than fabricating the missing field.

5. **Compatibility is era-bounded.** Modern runs missing a frozen chain are creation-invalid. Historical runs predating the birth contract retain only the existing explicit legacy fallback. This avoids silently blessing partially created modern state.

## Risks / Trade-offs

- **[Risk] Old fixtures that were accidentally classified as modern but lack the new chain field will fail closed.** → Update only fixtures representing modern births; retain an explicit legacy-era branch and negative test.
- **[Risk] Round limiting inside the phase loop could split retries incorrectly.** → Count completed/attempted phase boundaries, not executor invocations, and assert a retry remains owned by the same selected phase.
- **[Risk] Batch boundary comparison could depend on unnormalized aliases.** → Resolve and normalize the authorized through-phase against the already frozen chain before runtime execution.
- **[Risk] Direct baseline consumers bypass startup drift checks.** → Put the presence/value check in the shared creation validator called by `resolveGoalRunBaseline`.

## Migration Plan

Ship as a 3.0.0 correctness fix. Existing valid modern runs continue unchanged. Invalid modern manifests fail closed with actionable creation/baseline diagnostics; legacy-era runs continue through the isolated compatibility path. Rollback is the single correction commit plus its OpenSpec archive if required before release.

## Open Questions

None. The review fixes and ownership boundaries are fully specified.
