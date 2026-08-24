## Context

Attended goal execution is split across two processes: `goal-mode-entry` owns the session-fenced run and emits a phase request, while the host executes the phase Skill and harness commands. Today the request omits `run_id`; the spec Skill therefore invokes `fidelity-intent-init` before any goal environment exists, producing a phase identity that later goal gates reject. Separately, the feature-level supervisor evaluates every latest run through a process beacon even when `run-control@1` says the owner is a live or recoverable session.

The fix crosses goal ownership, harness entry, fidelity initialization, skill guidance, and adapter bridge materialization. Persisted manifest and run-control schemas already contain the required facts, so no new run-mode field, ledger, or state machine is warranted.

## Goals / Non-Goals

**Goals:**

- Preserve one explicit attended run identity from the bridge request through the spec initializer and harness process.
- Keep fidelity routing single-writer, with downstream and same-run reattach paths read-only.
- Prevent the unattended supervisor from spawning or writing events for any session owner state.
- Preserve mailbox handoff as the normal owner conversion and the existing user-authorized orphan takeover as the sole exception.
- Make adapter bridge content and adapter provenance match their real SSOTs.
- Keep detached launch independent of the consumer working directory.

**Non-Goals:**

- No `manifest.run_mode`, identity-hash change, new owner state, active-run scan, or parallel event/ledger.
- No automatic scheduled-task lifecycle management.
- No rewrite of fidelity/capability SSOTs by plan, coding, review, UT, or testing.
- No expansion into host-versus-adapter capability identity, phase-context isolation design, monitor policy, OCR, or unrelated gate behavior.

## Decisions

### 1. Bind and validate the full attended phase context

Use one request context `{runId, phase, attemptId, ownerId, ownerEpoch}` derived by the fenced session driver. The attempt ID includes the owner epoch so a bridge crash before round persistence cannot reuse an attempt identity. One shared framework helper resolves the exact manifest/run directory, calls the existing run-control fence, and validates the feature, current `session/active` owner, and unexpired lease. The spec initializer, phase harness, and closure sync command all receive the context explicitly and validate it before side effects.

The alternative—scanning a feature for an active run—cannot distinguish a manual phase invocation from a bridge phase and is ambiguous with multiple active runs. Passing only environment variables from the host also makes the host responsible for reconstructing framework state and misses the initializer call that happens first. The session driver reuses the existing receipt scaffold writer immediately before yielding the phase request. The attended Skill performs final receipt submission through the same `harness-runner --sync-closure` entry; it does not rely on a detached goal-runner replay or sibling shell environment inheritance.

### 2. Extend the existing fidelity initializer instead of adding a bridge writer

When `--goal-run-id` is present, the initializer uses the validated manifest as the only source of requirement text, adapter, and requirement source files, then writes `execution_identity=run_id` and `requirement_provenance=goal_manifest`. An existing valid same-run SSOT is reused byte-for-byte. Manual phase initialization retains `phase:<feature>:spec` plus `explicit_cli|intent_fallback` behavior.

This preserves the existing flow owner (`skills/feature/spec` Step 1) and implementation owner (`fidelity-intent-init`) while fixing the actual first write. Downstream phases remain consumers only.

### 3. Gate supervision by owner responsibility before the existing decision core

`goal-supervise` reads `run-control@1` before calling the beacon × `run_disposition` core. Missing or corrupt control fails closed. Any quiescing owner or incomplete handoff is a no-op. Every session state (`active`, `quiescing`, `released`, `orphaned_session`) returns without spawning and without writing an event. Only process owners reach the existing decision core; terminality remains solely derived from `run_disposition`.

Normal non-orphan session→process conversion uses the mailbox. A user may explicitly resume an `orphaned_session` with the existing `--force-resume` / `forceTakeoverRunOwner` epoch takeover; the supervisor never invokes this exception.

### 4. Treat run mode as an entry assertion, not persisted authorization

Attended prepare/attach examples pass `--run-mode attended`. The attach path independently rejects a missing or non-attended value before owner CAS. The flag is caller-declared routing input only: no manifest field, identity component, or `run_mode_declared` event is added. Ambiguous user intent remains the `goal.run_mode` registry's responsibility, while actual state remains `run-control.owner.kind`.

### 5. Make bridge and setup resolution follow their existing SSOTs

Generated skills-bridge stubs contain no adapter identity line. Shared roots can then materialize generic and Chrys in either order without a last-writer identity conflict, and exclusive roots do not compete with local setup. The goal-mode setup flow first runs `check-personal-setup --ensure` without selecting an adapter; a valid local adapter wins, one materialized candidate can be auto-selected, and the registry is used only for multiple unresolved candidates. `goal-mode-entry --adapter-source` records the returned provenance such as `local_config`; unavailable provenance is omitted or blocked, never invented.

### 6. Resolve detached preload modules before changing cwd

The detach launcher resolves the `ts-node/register/transpile-only` preload to an absolute module path in the framework process, then starts the child with the consumer project as cwd. This retains current dependency boundaries and does not require runtime packages at the host root.

### 7. Keep attach adapter and mailbox parsing on their existing SSOTs

After loading the manifest and before touching run-control, the attended bridge requires the caller adapter to equal `manifest.adapter`; all downstream calls use the manifest value. Adapter provenance parsing imports the manifest-owned type and value list rather than duplicating them.

The supervisor remains read-only for mailbox state. It parses JSON locally but delegates shape validation to the exported canonical handoff predicate, then verifies the mailbox run identity. Missing mailboxes do not block; valid pending/consumed and every malformed or mismatched mailbox do block; only canonical accepted/rejected records are conclusively complete.

## Risks / Trade-offs

- [A session lease expires between initializer and harness validation] → Both entry points validate independently and fail before their respective side effects; the bridge can reattach and retry under a new valid epoch.
- [A delayed phase process runs after reattach] → Its captured owner ID/epoch no longer matches run-control, so initializer, harness, and sync closure all fail before writing under the new owner.
- [A valid same-run SSOT is accidentally rewritten] → Reuse is decided before initialization and regression tests bind the full file hash plus `decision_id` across re-entry, reattach, and downstream phases.
- [Released process owners are confused with terminal runs] → Process owners still reach the unchanged `run_disposition` core; a WAITING same-source probe can wake regardless of owner state.
- [Shared bridge roots retain stale identity text] → Materialization tests exercise generic→Chrys and Chrys→generic order against the identity-sensitive goal-mode stub.
- [Older callers omit `--run-mode`] → Attended attach fails fast before CAS with actionable guidance; no persisted data is mutated, and unattended callers keep using `goal-runner --detach`.

## Migration Plan

No persisted schema migration is needed. Release the runtime, skills, and adapter templates together; existing manifests and run-control files remain readable. Rollback consists of reverting the code/templates before starting a new attended run; no data conversion is required.

## Open Questions

None. Host smoke remains the final archive gate because the originating failures crossed process and consumer-workspace boundaries not covered by the prior unit suite.
