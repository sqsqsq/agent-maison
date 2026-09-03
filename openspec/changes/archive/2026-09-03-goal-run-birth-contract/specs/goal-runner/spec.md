## ADDED Requirements

### Requirement: Fresh goal runs have one immutable birth contract

Every attended or detached fresh goal run SHALL be created by the same fresh-only `createGoalRun` operation after workflow, track and actual phase chain resolution. A chain containing coding or UT MUST resolve a 40-hex Git HEAD before publishing the run and store it as `manifest.run_base_sha`; a chain containing only spec/plan MAY omit it. Creation SHALL write `manifest.json` before appending exactly one `run_created` event binding `manifest_identity_fields`, `manifest_identity_hash`, the run-base digest and any rebaseline source. Resume and attach SHALL only load these facts and MUST NOT re-resolve workflow, chain or HEAD or synthesize a missing event.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/goal-mode-entry.ts`

#### Scenario: Both fresh entries freeze the same HEAD

- **WHEN** attended and detached coding runs are created at the same repository HEAD from the same resolved input
- **THEN** both SHALL use `createGoalRun`, persist that exact `run_base_sha`, and emit one equivalent `run_created` birth record before any agent invocation

#### Scenario: A non-Git execution chain fails before dispatch

- **WHEN** a resolved fresh chain contains coding or UT and Git HEAD cannot be resolved
- **THEN** creation MUST fail closed without publishing an attachable run or dispatching an agent

#### Scenario: A documentation-only chain needs no Git baseline

- **WHEN** the resolved chain contains only spec and/or plan
- **THEN** creation MAY omit `run_base_sha` while still writing its one `run_created` identity record

### Requirement: Incomplete creation is isolated from runnable lifecycle state

A run directory whose manifest is present but whose valid one-time `run_created` event is absent, duplicated or inconsistent SHALL be classified `CREATION_INCOMPLETE`. It MUST NOT be attached, resumed or taken over by the supervisor; MUST NOT count as a HALTED/PARTIAL occupant or prevent a replacement fresh run; and MUST NOT enter normal progress projection. Diagnostics and cleanup SHALL reuse existing attach/resume errors and per-run trust GC rather than create a transaction state file.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/goal-supervisor.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: Manifest-only residue does not occupy the feature

- **WHEN** creation crashes after writing `manifest.json` and before `run_created`
- **THEN** resume and supervisor attach SHALL reject that run as `CREATION_INCOMPLETE`, while a new fresh run for the feature remains eligible

### Requirement: Goal run base identity is write-once

`run_base_sha` SHALL participate in manifest identity when present and SHALL be write-once for the life of a run. `diffManifestIdentityFields` MUST report its addition, deletion or modification normally. Before any `authAll`, `--override-manifest` or field-level authorization is evaluated, `resolveManifestDriftDecision` MUST fail a change containing `run_base_sha` as `run_base_sha_write_once_violation`. While replaying `manifest_identity_rebase`, `resolveManifestIdentityBaseline` MUST prove every `to_fields` preserves the `run_created` birth digest; disappearance or mismatch is event-stream corruption and MUST stop replay without advancing the baseline.

Enforcement: `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: Override cannot change or remove the base

- **WHEN** a stopped run changes base A to B or removes `run_base_sha` and resumes with `--override-manifest`
- **THEN** drift SHALL remain visible and the run MUST fail `run_base_sha_write_once_violation`

#### Scenario: Historical rebase corruption is rejected

- **WHEN** a replayed `manifest_identity_rebase.to_fields` changes or removes the birth base digest
- **THEN** replay MUST fail as corrupt state and MUST NOT use any later rebase as a trustworthy baseline

#### Scenario: Other identity fields retain normal authorization

- **WHEN** an authorized non-base identity field changes while `run_base_sha` is preserved
- **THEN** the existing field/manifest override behavior SHALL remain available

### Requirement: Successors preserve lineage and rebaseline only at the management boundary

An automatic successor SHALL inherit the earliest trustworthy `run_base_sha` reachable through its audited lineage and MUST NOT re-read current HEAD. If no ancestor has a trustworthy baseline, automatic successor creation MUST fail closed. A deliberate baseline cut SHALL require paired `--supersede <old-run-id> --rebaseline-to <exact-40hex-sha>` outside goal execution, current HEAD equality, and absence of every `hasGoalExecutionSignal()` input even when the formal gate marker is set. Supervisor and executors MUST NOT construct `--rebaseline-to`. Audit SHALL write only the new run events: `run_created.rebaseline_from_run_id` and one `supersede` event binding target, superseding run, exact SHA and the run-created index/hash; old run events MUST remain unchanged.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/phase-state.ts`, `harness/scripts/goal-supervisor.ts`, `harness/scripts/utils/goal-adapter-spawn.ts`

#### Scenario: Automatic successor does not launder ancestor commits

- **WHEN** repository HEAD advances after the original run and an automatic successor is created
- **THEN** the successor SHALL retain the earliest trustworthy lineage baseline rather than the new HEAD

#### Scenario: Formal gate marker does not authorize rebaseline

- **WHEN** a goal execution signal and `MAISON_GOAL_GATE_HARNESS=1` are both present with the paired management flags
- **THEN** creation MUST reject rebaseline because `hasGoalExecutionSignal()` remains true

#### Scenario: Manual rebaseline is single-writer audited

- **WHEN** the paired management command is run outside goal execution and HEAD equals the exact supplied SHA
- **THEN** the new run SHALL be created and contain both forward audit bindings while the target run's `events.jsonl` remains byte-for-byte unchanged

## MODIFIED Requirements

### Requirement: Truncated-chain runs machine-verify upstream closures before starting

A run whose start_phase is not the first phase of the resolved workflow chain SHALL verify, for every upstream phase, the existence and freshness of its closure (receipt closure state, gate fingerprint, phase_closure_fingerprint staleness recomputation, and — for review — the closure attestation). Textual assertions in `manifest.requirement` SHALL NOT substitute for verification. Verification failure SHALL refuse the run and name the missing/stale phase. HALTED/PARTIAL prior runs SHALL be resumed or explicitly superseded via `--supersede <run_id>` (audited event); they SHALL NOT be silently displaced. A `CREATION_INCOMPLETE` residue is not a HALTED/PARTIAL occupant and SHALL NOT block a replacement creation. When supersede also changes the accountability baseline, it MUST use the paired runtime-external `--rebaseline-to <exact-40hex-sha>` management command; a supervisor MUST never infer or initiate rebaseline.

Enforcement: `harness/scripts/goal-runner.ts`（preflight）, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/utils/goal-run-creation.ts`

#### Scenario: requirement text asserting upstream PASS is ignored

- **WHEN** a new run declares start_phase=ut and its manifest text claims "上游已 PASS" but spec closure inputs have since changed
- **THEN** preflight SHALL recompute staleness, judge the spec closure STALE, and refuse to start

#### Scenario: incomplete residue does not require supersede

- **WHEN** the only previous directory for the feature is a manifest-only `CREATION_INCOMPLETE` residue
- **THEN** a valid fresh run SHALL be allowed without silently classifying or superseding that residue as HALTED/PARTIAL

### Requirement: The pass-snapshot mechanism is retired; PASS artifacts are protected by full re-verification

The per-run PASS frozen-snapshot mechanism (take/diff/restore/discard, trusted-context loading, epoch/head/journal, memory anchors, the `pass_snapshot_unavailable` / snapshot-flavored `pre_invoke_snapshot_failed` halt family, and the responsibility-rerun pending state) SHALL be removed and MUST NOT be reintroduced as workflow state, authorization, or start eligibility. PASS-artifact tamper protection SHALL rest on the facts that already exist: a closure attempt that breaks an artifact fails the next full harness re-verification; an edit that still passes re-earns every gate on the current bytes; and the phase closure manifest always binds the current bytes — the closure-only prompt keeps its "do not rewrite artifacts" instruction as guidance. Invalidation (backtrack/replan) SHALL be complete with the atomic `phase_backtrack_requested` event alone — no cache demotion side effects. The retained resident of the trust-state namespace is per-run trust-state GC (`deleteRunTrustState`, which also sweeps legacy snapshot and coding-base directories from older runs); new goal runs store their baseline only in `manifest.run_base_sha` and MUST NOT produce `coding-base.json`. Read-side incident mappings and strictly era-isolated legacy coding-base readers MAY remain for historical runs. Independent mechanisms that share similar names SHALL NOT be removed: review closure source attestation, UT product-source immutability, testing invoke-boundary source write-protection (`product-source-snapshot`), and the device readiness gate.

Enforcement: `harness/scripts/utils/pass-snapshot.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/scope-replan.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/phase-completion-probe.ts`

#### Scenario: a legitimate UT PASS with no optional artifacts no longer trips an invariant

- **WHEN** a `repair_existing_ut` run reaches UT PASS with closure open and none of the optional UT artifacts on disk
- **THEN** the closure retry proceeds normally — there is no frozen-surface resolution, no "non-empty registry but zero deliverables" invariant halt

#### Scenario: a closure attempt that edits a PASS artifact is caught by re-verification, not by a snapshot

- **WHEN** a closure-only attempt modifies a previously passing artifact in a way that breaks a gate
- **THEN** the phase's next full harness run fails on the current bytes and the run takes the normal content-retry path — no snapshot diff, no restore, no cache-discard halt

#### Scenario: a new run never produces an off-repository coding base

- **WHEN** a new-schema goal run reaches coding
- **THEN** no `coding-base.json` or coding-base event SHALL be written because the immutable manifest birth baseline already exists
