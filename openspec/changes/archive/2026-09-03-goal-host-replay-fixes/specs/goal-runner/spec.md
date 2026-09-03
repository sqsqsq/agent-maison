# goal-runner Spec Delta

## ADDED Requirements

### Requirement: Truncated-chain preflight derives requirement lineage from the in-memory manifest

When a run starts at a non-head phase (truncated chain), the runner SHALL compute the current requirement lineage hash from the in-memory `manifest.requirement` through the same content-assembly function used by the on-disk recompute path (byte-identical output for identical inputs), instead of reading the run's own `goal-runs/<run_id>/manifest.json` from disk (which is written only after preflight). A missing or blank `manifest.requirement` SHALL remain a fail-closed BLOCKER. If the authoritative enumeration reports any corrupt run (started-but-manifest-less), the preflight SHALL fail closed and name the corrupt directories.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/fidelity-shared.ts`

#### Scenario: a fresh truncated chain starts without a pre-seeded manifest

- **WHEN** a new `ut→testing` run starts and no `manifest.json` exists on disk for its run_id (the be1c48 incident shape)
- **THEN** the preflight SHALL compute the requirement lineage from the in-memory manifest and proceed to upstream-closure verification without the "manifest 缺失/不可读" rejection

#### Scenario: dry-run pre-seeding is no longer required and no longer co-writes

- **WHEN** the host starts the truncated chain directly (no prior dry-run with the same run_id)
- **THEN** the real run directory SHALL contain no dry-run events and agent turn numbering SHALL start at 1

### Requirement: Dry-run executes under the reserved .dry subtree with zero external trust mutation

A dry-run SHALL use `goal-runs/.dry/<run_id>/` as its report_dir (same run_id, no derived identity, no ledger), keeping manifest/events/progress/phases/per-run lock fully separate from real runs (run-level files zero co-write; the feature serialization lock remains shared). All dry-run events SHALL carry `dry_run:true`. A dry-run SHALL perform zero external trust mutation: vision checkpoint drift comparison, reseal recovery, feature head/run checkpoint/HWM writes, legacy ledger migration, and the per-invoke/post-harness vision-ledger snapshots with their anchor events are all skipped (the dry invoke window neither reads the vision ledgers nor emits `vision_ledger_anchor` rows); `framework.local.json` adapter write-back and canary cache writes are forbidden (capability/config reads remain allowed). `--resume` SHALL never resolve into the `.dry` subtree, and run_id values starting with `.` or containing path separators SHALL be rejected. The detach parent and the main entry SHALL share one raw-input resolver (feature/run_id/manifest consistency: feature only in the manifest file is accepted; CLI-vs-manifest conflicts fail closed; parent and child derive the same `.dry` path).

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-manifest.ts`

#### Scenario: dry-run leaves the trust surface byte-identical

- **WHEN** a dry-run executes for a feature with existing vision trust anchors and `--override-adapter` is passed
- **THEN** the goal-checkpoints namespace, feature vision trust files and `framework.local.json` SHALL be byte-identical before and after the dry-run

#### Scenario: a dry-run and a real run share a run_id without co-writing

- **WHEN** a dry-run with run_id R completes and a real run with run_id R starts
- **THEN** the real run's `events.jsonl` SHALL contain no dry-run rows and its budget turn count SHALL not include dry invokes

### Requirement: Authoritative state derives from non-dry sessions and classified run directories

Every consumer deriving authoritative state from run events (budget/turn counting, timeout ratchet, transient-retry and advance-blocked counters, continuation cause, backtrack counts, resume rebuild, ledger reconciliation expectation sets, and the progress projection/status panel including its recent-events tail) SHALL read through the authoritative view that drops dry-run sessions (session partition by `run_start`; legacy mixed files filtered). The progress projection for a `.dry` report_dir keeps its own raw dry events (the dry run's panel stays observable); for a normal report_dir its budget axis SHALL report authoritative turns and active-time elapsed (Σ historical session durations + live-session `now − sessionStart`), never the calendar span since the first raw `run_start`. Goal-run directory enumeration for requirement lineage, completion freshness and latest-phase-evidence selection SHALL use one shared enumerator that structurally skips the `.dry` subtree, silently excludes bootstrap-only residue (directories with only detach/lock bootstrap files — handled by the existing orphan flow, never an error), and surfaces started-but-manifest-less directories as `corruptRuns` without throwing; requirement-hash, closure, completion and phase-lineage gates — including the check-spec requirement-intent surface and the check-receipt closure-lineage generation — SHALL fail closed while any corrupt run is present, naming the damaged directories.

Enforcement: `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-progress.ts`, `harness/scripts/check-spec.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: a later dry-run cannot become authoritative phase evidence

- **WHEN** a dry-run newer than the last real run exists under `.dry/`
- **THEN** requirement intent hash, phase lineage, completion freshness and per-phase latest-run selection SHALL be unchanged

#### Scenario: a legacy mixed events file does not surface dry verdicts on the panel

- **WHEN** a real run's `events.jsonl` contains an older dry session with `ut`/`testing` PASS and a terminal `run_end`, followed by a live real session that just started `ut`
- **THEN** the progress snapshot SHALL report current phase `ut` (not PASSED/COMPLETED), turn count 1, and an active-time `wall_elapsed_ms` measured from the real session start

#### Scenario: a damaged started run blocks instead of silently re-selecting authority

- **WHEN** a run directory contains `events.jsonl` but its `manifest.json` was deleted
- **THEN** completion verification SHALL be INVALID, the truncated-chain preflight SHALL refuse to start, the check-spec gate SHALL FAIL with `goal_run_identity_intact` and the check-receipt closure generation SHALL exit BLOCKER — all naming the damaged run

### Requirement: Same-host lock owners that are alive are never preempted on heartbeat timeout

A same-host lock whose recorded pid is still alive SHALL never be classified stale regardless of heartbeat age; acquisition SHALL return busy with an operator hint. Only a vanished pid (or the existing cross-host TTL semantics) allows takeover. Lock records SHALL carry `run_mode` (`authoritative`/`dry`) and the canonical `report_dir`; orphan recovery SHALL locate events via them — a stale dry owner SHALL never produce a `--resume` suggestion (the real run takes over through the normal stale-lock flow), and a legacy record (no `run_mode`) SHALL be classified by its events sessions: only-dry → treated as a stale dry orphan; any authoritative session → the existing resume guidance; indeterminate → manual disposition without guessing.

Enforcement: `harness/scripts/utils/goal-run-lock.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-progress.ts`

#### Scenario: a paused-but-alive runner is not stolen

- **WHEN** a same-host feature lock's owner pid is alive but its heartbeat is hours old
- **THEN** a new run SHALL be refused with a busy message naming the live owner, and no takeover occurs

#### Scenario: a crashed dry-run does not poison the next real run

- **WHEN** a dry-run child hard-crashes leaving a stale feature lock with `run_mode: dry`
- **THEN** a new real run SHALL start by taking over the stale lock without any `--resume` suggestion

### Requirement: Wall-clock budget accumulates active runtime across resume sessions

The run budget SHALL measure active execution time, not calendar span: prior activity is the sum of per-session durations partitioned by `run_start` events, where a session without `run_end` (crash/hard-kill) is conservatively credited up to one heartbeat cadence beyond its last event (capped by the next session start or the current process start — cumulative undercount SHALL be zero and per-session overcount SHALL not exceed one cadence), and dry sessions are excluded. The hard-deadline semantics (agent/harness/backoff pre-checks minus the finalize reserve) are unchanged; only the baseline becomes `sessionStart + max(0, wall − priorActive)`. Artifact-since consumers (partial-resume feed) SHALL keep the true first authoritative session start, never a synthetic time. Budget halts SHALL carry `halt_reason` and `halt_guidance` on the outcome, the `phase_halt` event and the console banner (and thus `run_end`), and the guidance SHALL name only real routes: a new run with an updated-budget manifest, or `--override-manifest`-authorized resume — never a bare restart.

Enforcement: `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/await-confirm-guidance.ts`

#### Scenario: an overnight resume of a 74-minute run does not instantly halt

- **WHEN** a run consumed ~74 minutes of active time, halted, and is resumed 13 hours later with a 480-minute wall budget
- **THEN** the budget check SHALL pass and the run SHALL continue with the remaining active budget

#### Scenario: genuine exhaustion halts with visible reason and real routes

- **WHEN** accumulated active time reaches the wall budget at resume
- **THEN** the run SHALL halt with `budget_wall_clock` present on outcome/phase_halt/run_end and guidance offering a new-manifest run or `--override-manifest` resume

### Requirement: Source drift is invalidated and revalidated by its responsible phase

The mutation scope and current drift fingerprint SHALL remain normalized machine facts, and `pre_authorized_mutations` or agent gap-notes MAY be retained as intent provenance only. No receipt, signer, or preauthorization SHALL classify drift as accepted. When a controlled invocation changes protected source outside its phase write boundary, the runner SHALL record the exact drift, invalidate the invocation plus owner/downstream closure trust, preserve the bytes as untrusted, and use the existing `backtrack_to_phase` transaction to the responsible owner when present in the resolved chain. A truncated chain without the owner SHALL use `backtrack_target_absent` and guide a full/successor run; it SHALL NOT create an adjudication request or human release route.

Enforcement: `harness/scripts/utils/mutation-authorization.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-assess-driver.ts`

#### Scenario: preauthorization does not pass drift

- **WHEN** a frozen `pre_authorized_mutations` entry covers a post-review drift
- **THEN** the entry SHALL remain audit provenance while the drift invalidates trust and routes to its responsible phase

#### Scenario: a truncated chain cannot reach the owner

- **WHEN** the chain is `ut→testing` and the current protected-source drift belongs to coding
- **THEN** the runner SHALL report `backtrack_target_absent` with a coding-rooted successor/full-chain route and SHALL NOT request a human mutation receipt

### Requirement: phase_halt overrides provisional verdicts in projection and rebuild

The progress projection SHALL consume `phase_halt` events: the halted phase becomes the current phase with status HALTED, overriding a same-phase provisional PASS (no "ut PASSED · current testing · run HALTED" split). Events-only outcome rebuilding SHALL let the latest `phase_halt` of a phase override its earlier terminal `phase_verdict` (carrying `halt_reason`/`halt_guidance`), so a halted phase is re-entered on resume even when `goal-report.json` is absent; a later terminal verdict (post-backtrack re-run) clears the stale halt.

Enforcement: `harness/scripts/utils/goal-progress.ts`, `harness/scripts/utils/goal-runner-phase.ts`

#### Scenario: a harness-PASS phase halted by the mutation gate is not rebuilt as advanced

- **WHEN** `phase_verdict{ut, advance, PASS}` is followed by `phase_halt{ut, unauthorized_source_mutation}` and `goal-report.json` is missing
- **THEN** the rebuilt outcome for ut SHALL be halted (guidance preserved) and resume SHALL re-enter ut
