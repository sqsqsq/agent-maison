## Context

Fresh goal creation is currently interleaved with CLI parsing, successor loading, adapter reconciliation, preflight and the detached loop's first `run_start`. The only coding baseline producer runs immediately before a detached coding invocation, so attended and UT-start paths never produce it and early commits can be laundered outside the diff. Manifest identity replay also treats authorized `manifest_identity_rebase` as a general field update, allowing `--override-manifest` to move any identity field.

The design must preserve the existing manifest/events SSOT, run-control fencing, failure taxonomy and legacy read compatibility. `ut-legacy-coexistence` still owns the old `HARNESS_DIFF_BASE_REF → coding_base_sha` requirement and must archive before this change can merge its reversed priority into canonical specs.

## Goals / Non-Goals

**Goals:**

- Make a fresh run an explicit transaction with one shared implementation and one immutable birth event.
- Freeze a trustworthy Git baseline before any coding/UT agent can act and consume it identically in all goal modes.
- Make incomplete creation, successor inheritance, manual rebaseline and legacy detection deterministic and fail-closed.
- Reuse existing manifest/events, occupancy, GC, classifier and run scanning mechanisms.

**Non-Goals:**

- No new journal, status file, transaction state machine, off-repository anchor, identity ledger or AuthorityFacts grant.
- No retrospective anchoring of existing damaged runs and no physical removal of the legacy reader in 3.0.0.
- No change to UI/UT gate PASS/FAIL/SKIP rules beyond baseline fact resolution.

## Decisions

### 1. Separate input resolution from fresh run creation

`resolveGoalRunInput` (existing parsing/reconciliation helpers) produces a resolved workflow, track, chain and manifest birth input without writing run state. `createGoalRun` is the only fresh writer. It determines whether the resolved chain contains coding or UT; when it does, it resolves `git rev-parse HEAD` once and fails before manifest/run directory publication if unavailable. Pure spec/plan chains omit `run_base_sha`.

Both `goal-runner` and `prepareGoalModeRun` call this function. Resume and attach only load the persisted manifest and events. Keeping `buildGoalManifestFromInput` as a pure builder is acceptable; it is not a second creation entry.

### 2. Commit birth with manifest then run_created

`createGoalRun` writes `manifest.json` first and appends exactly one `run_created` event second. The event contains complete `manifest_identity_fields`, `manifest_identity_hash`, a digest of the optional `run_base_sha`, and optional `rebaseline_from_run_id`. The append result supplies the event index/hash used by a same-ledger `supersede` audit event.

This is deliberately a small ordered write, not a transaction protocol. A manifest without `run_created` is observable as `CREATION_INCOMPLETE`; attach/resume and supervisor preflight reject it, normal progress and occupancy skip it, and existing per-run GC/manual cleanup remains the recovery channel. Resume never repairs or synthesizes the event.

### 3. Protect run_base_sha at all identity layers

`run_base_sha` participates in identity fields whenever present. `diffManifestIdentityFields` remains honest and reports additions, removals and modifications. `resolveManifestDriftDecision` checks for that field before `authAll` or field overrides and returns `run_base_sha_write_once_violation`. `resolveManifestIdentityBaseline` starts from `run_created` and validates every replayed rebase `to_fields` preserves the birth digest; mismatch or absence is corruption and stops replay.

Filtering the field out of diffs was rejected because it would make a real change look like no drift. Silently skipping a corrupt historical rebase was rejected because later fields would advance from an untrusted state.

### 4. Resolve goal baselines through one typed result

`resolveGoalRunBaseline` accepts manifest plus authoritative events and returns a discriminated result: valid new-schema manifest baseline, valid legacy baseline, not-required, or a precise failure. New-schema status is established solely by the presence of `run_created`; such a run never consults `coding-base.json`. Legacy is allowed only when `run_created` is absent and both the first authoritative `run_start` and legacy anchor are valid.

UI scope and UT target resolution consume this result. Goal env builders scrub `HARNESS_DIFF_BASE_REF` and emit one startup warning when inherited; non-goal manual harness paths preserve their current env behavior.

### 5. Inherit lineage automatically; cut it only at the management boundary

An automatic successor follows `successor_of`/audited supersede ancestry to the earliest trustworthy baseline and never reads current HEAD. Missing or corrupt ancestry fails closed.

Manual rebaseline extends the existing CLI management boundary: `--supersede` and `--rebaseline-to` are paired; the SHA is exact 40-hex; current HEAD must match immediately before creation; and `hasGoalExecutionSignal()` rejects the command even when `MAISON_GOAL_GATE_HARNESS=1`. The predicate is extracted from the existing goal signal union, while `isAgentSideGoalHarness` becomes that predicate plus the formal-gate exclusion. Executor and supervisor argv construction have structural tests proving they never emit the flag.

Audit remains single-writer: only the new run's events record `run_created.rebaseline_from_run_id` and `supersede {target_run_id, superseding_run_id, rebaseline_to, run_created_index, run_created_hash}`. Reverse lookup scans the existing feature run set; the old run is never mutated.

### 6. Keep failure ownership in the existing classifier

`CREATION_INCOMPLETE`, missing/corrupt `run_created`, invalid/missing required baseline and UI diff unavailability caused by runtime facts are registered as runtime/external framework blockers and `agent_fixable=false`. Existing retry/no-progress projection consumes that classification; no third taxonomy is introduced.

## Risks / Trade-offs

- [Crash between manifest and event leaves residue] → Classify it explicitly, exclude it from occupancy/progress/supervision and use existing GC; do not add a transaction journal.
- [Active `ut-legacy-coexistence` owns the requirement being modified] → Validate this change in place but archive only after that change and its 7.2 host evidence close.
- [Legacy compatibility can become a fallback bypass] → Use `run_created` presence as a hard era boundary and require both legacy `run_start` and anchor validity.
- [CLI management flags are not cryptographic human proof] → Document the honest boundary, require exact HEAD and no goal signals, structurally prevent runtime construction and retain audit.

## Migration Plan

1. Add schema/types, pure baseline/identity helpers and negative tests.
2. Introduce `createGoalRun`, wire both fresh entries and reject incomplete creation on all attach/supervisor paths.
3. Migrate UI/UT consumers and remove the coding-base producer.
4. Add successor/rebaseline management behavior and runbook guidance.
5. Retain the isolated legacy reader through 3.0.0; a deferred 3.1.0 plan removes it after compatibility expires.

Rollback restores the previous writers/readers before any 3.0.0 release; it does not rewrite existing run directories.

## Open Questions

None. Archive ordering is fixed by the master plan; missing host evidence is an external completion blocker, not a design choice.
