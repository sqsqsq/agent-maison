# goal-runner Spec Delta

## ADDED Requirements

### Requirement: A blocked PASS freezes phase deliverables under a runner-owned snapshot epoch

When a phase verdict is `PASS` with `advance_blocked` (any closure reason), the runner SHALL classify phase artifacts through a single artifact-class resolver — `frozen_deliverable` (all three phase-output tables of the phase evidence manifest, including `spec/asset-manifest.yaml`), `mutable_closure` (`phase-completion-receipt.md`, `headless-assumptions.jsonl/.md`), `mutable_control_plane` (individually registered control-plane files such as `spec/fidelity-downgrade.receipt.json`, `spec/crop-provenance/*.receipt.json`, `vision/capability-receipt.json`, `vision/spec-refs-receipt.json`, and the vision append-only ledgers; wildcard `*.receipt.*` registration SHALL NOT be used), and `derived` (reports, caches) — and snapshot the frozen set into a runner-owned trust-state namespace `goal-checkpoints/<project>/<feature>/<run>/pass-snapshots/<phase>/<epoch>/`. The next attempt SHALL be closure-only: its prompt declares the frozen list read-only; after it ends the runner SHALL diff the watched namespace (baseline inventory minus mutable minus derived) across modified/added/deleted/link entry classes. Any frozen-class difference SHALL emit a `pass_snapshot_violation` event, restore per the trust tiers, and count toward the existing advance-blocked halt threshold; legitimate additions of `mutable_closure`/`mutable_control_plane` files SHALL NOT be flagged or reverted.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/pass-snapshot.ts`（新增）, `harness/scripts/utils/phase-evidence-manifest.ts`

#### Scenario: the incident's i3 rewrite is reverted and the i2 PASS advances

- **WHEN** a spec attempt reaches PASS with `agent_timeout_unclosed`, the snapshot is taken, and the closure-only attempt rewrites `spec/ui-spec.yaml` with a broken key
- **THEN** the runner SHALL record `pass_snapshot_violation`, restore the frozen file bytes, and after re-running harness and closing the receipt the phase SHALL advance with the PASS-epoch artifacts

#### Scenario: a legitimate control-plane receipt written during closure is not treated as tampering

- **WHEN** the closure-only attempt writes `vision/capability-receipt.json` while frozen deliverables stay untouched
- **THEN** no violation SHALL be recorded and the file SHALL NOT be deleted by restore

### Requirement: Snapshot trust is two-tier and restore is path- and TOCTOU-safe

Within the same runner process the snapshot manifest/digest held in memory SHALL be the trust anchor: restore is permitted after per-file hash verification regardless of HMAC deployment. Across `--resume`/process restart, automatic restore SHALL require HMAC verification; without a deployed HMAC key the runner SHALL only detect violations and halt for a human (never overwrite user files from a weak-trust snapshot). Snapshot creation and restore SHALL lstat the target and every parent directory (any symlink/junction/reparse point is fail-closed), keep realpath inside the project/feature roots, and install bytes via read-once-buffer → verify hash on that buffer → write same-dir temp file → atomic rename (no separate hash-then-copy window, no link following).

Enforcement: `harness/scripts/utils/pass-snapshot.ts`（新增）, `harness/scripts/goal-runner.ts`

#### Scenario: default host without HMAC still recovers in-process

- **WHEN** no HMAC key is deployed and the closure-only attempt corrupts a frozen file within the same runner process
- **THEN** the runner SHALL restore from the snapshot after verifying bytes against the in-memory digest and continue the closure flow

#### Scenario: resume without HMAC refuses automatic restore

- **WHEN** the runner restarts with `--resume`, no HMAC key is deployed, and a frozen-file difference is detected
- **THEN** the runner SHALL halt for human disposition without restoring

### Requirement: Pass-snapshot protocol domains separate immutable manifest from mutable head

The snapshot store SHALL use two kinds signed in distinct protocol domains reusing only the existing HMAC envelope/key model: `pass_snapshot_manifest` (immutable — kind, schema_version, canonical stable-stringified body, project identity hash, feature, run_id, phase, pass_epoch, file list with per-file hashes; historical manifests are never rewritten) and `pass_snapshot_head` (mutable, HMAC-protected — current manifest SHA, state limited to `active`/`superseded`, generation; the only place state changes). Cross-protocol substitution (vision checkpoint/head/HWM/reseal documents placed at snapshot paths or vice versa, including the invalidation journal kind) SHALL validate as invalid.

Manifest validation SHALL enforce, beyond field shape (canonical unique rels, exact `watched_roots` set equality with the phase registry, unconditional non-negative-integer `bytes`), a completeness reconciliation against the registry-derived required frozen deliverables of the phase: every required output artifact (over its disk-independent canonical+legacy rel candidates) SHALL be present in `files`, at both snapshot creation (refuse to create an incomplete manifest) and trusted load (fail closed). Root-level contracts (`acceptance.yaml`, `contracts.yaml`) live outside the watched-roots directory domain, so their `files` entry is their only drift-detection channel; a weak-trust forgery that drops such an entry while keeping roots exact SHALL therefore fail closed instead of washing the diff.

Completeness SHALL cover all three phase-output tables, not only the required one. At snapshot creation the provided file list SHALL additionally be reconciled against the resolver's full current set (required + optional files + optional relpaths) and refuse to create a manifest that omits any currently resolvable frozen deliverable (e.g. a root-level `use-cases.yaml` present at PASS). The drift (`added`) detection domain SHALL include the registry-derived root-level candidate rels outside the watched roots: a disk-present candidate absent from `files` SHALL surface as `added` (restored — i.e. removed — under authenticated trust; detect-and-halt under weak trust). On trusted load with an unauthenticated manifest (no valid MAC and no in-process anchor), a disk-present root-level candidate missing its `files` entry SHALL fail closed before any agent is spawned; under authenticated trust the same condition is post-PASS drift and SHALL be handled by the diff/restore path rather than a trust failure. Honest boundary: without HMAC, if an optional deliverable and its manifest entry are deleted together before resume, its historical existence cannot be proven — strong tamper resistance still requires the HMAC key.

Enforcement: `harness/scripts/utils/pass-snapshot.ts`（新增）

#### Scenario: a superseded epoch with a valid MAC cannot be replayed

- **WHEN** an old snapshot manifest and its files are intact with valid MACs but the head marks the epoch superseded
- **THEN** restore eligibility SHALL be denied

#### Scenario: dropping a root-level required deliverable from a consistently forged manifest fails closed

- **WHEN** an unauthenticated manifest+head pair is rewritten consistently with `watched_roots` kept exactly equal but the root-level `acceptance.yaml` entry removed from `files`
- **THEN** trusted snapshot load SHALL fail closed on completeness reconciliation instead of returning an active context whose diff can no longer see that deliverable

#### Scenario: dropping a root-level optional deliverable's entry cannot wash the diff either

- **WHEN** a root-level optional deliverable (e.g. `use-cases.yaml`) existed at PASS and an unauthenticated manifest+head pair is consistently rewritten with only that `files` entry removed
- **THEN** trusted load SHALL fail closed (disk-present root-level candidate without an entry), and independently the diff SHALL report the file as `added` rather than yielding zero drift

### Requirement: Invalidation is a recoverable run-level journal transaction

Snapshot invalidation (phase invalidation/backtrack) SHALL be driven by a run-level journal at the fixed path `pass-snapshots/invalidation.json` (own kind `pass_snapshot_invalidation`, HMAC same key distinct domain) with at least `tx_id`, `state: pending|committed`, `cause_phase`, `invalidated_phases`, `old_head_hashes`, `target_generations`. Transaction order SHALL be: write journal pending → update every affected phase head/tombstone → append idempotent `phase_invalidated` events carrying the same `invalidation_tx_id` (deduplicated by `(tx_id, phase)`) → commit the journal. On startup and resume the runner SHALL recover the journal before reading any phase head (a pending journal is completed first; no snapshot restore may happen under an uncommitted transaction). The fail-closed rule for an unverifiable journal (missing HMAC where the store is authenticated, bad MAC, unparseable) applies to the resume/restart path — the runner SHALL halt without mutating any head; in-process operation continues to rely on the in-memory digest tier.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/pass-snapshot.ts`（新增）

#### Scenario: crash between journal pending and events is recovered without restoring stale snapshots

- **WHEN** the journal is pending, some heads are updated, and the process crashes before `phase_invalidated` events are appended
- **THEN** on resume the runner SHALL complete head updates and events from the journal, commit it, and refuse to restore any snapshot of the invalidated phases

#### Scenario: one backtrack invalidates multiple phases atomically

- **WHEN** a backtrack invalidates several completed phases in one transaction
- **THEN** all their heads SHALL be superseded under a single `tx_id` and events SHALL appear exactly once per `(tx_id, phase)` even across repeated recovery

### Requirement: Closure-only attempts are classified by a receipt-probe total function and budgeted by closure kind

The closure path taken after a blocked PASS SHALL be chosen by a deterministic function over the full `ReceiptValidation` status set obtained from the read-only receipt probe (never mapped from `advance_block_reason`, which stays telemetry-only): `passed` → `deterministic_recheck` (runner performs receipt state sync/closure without invoking an agent); `missing`/`failed` → `receipt_repair_with_verifier` (agent attempt using the phase's full current effective timeout — no invented shorter verifier budget); `error` → immediate HALT classified `closure_probe_error`/framework-bug semantics without invoking an agent; `not_applicable` while still advance-blocked → immediate HALT `closure_state_invariant`. Fresh attempts SHALL reuse the receipt validation already obtained in the control flow; resume re-probes with the subprocess timeout bounded by remaining wall clock and the finalize reserve. Closure-only timeout SHALL surface as closure timeout for human disposition, never re-entering content retries.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-timeout.ts`

#### Scenario: probe error is a framework fault, not an agent repair job

- **WHEN** the receipt probe itself fails to execute (script missing, spawn failure)
- **THEN** the run SHALL halt with `closure_probe_error` and no agent SHALL be invoked to "repair" the receipt

### Requirement: Timeout budget ratchets on granted high-water and observed completions

The per-attempt agent timeout SHALL be `max(base, granted_highwater, ceil(1.2 × max_completed_duration))`, where `granted_highwater` is the highest effective timeout ever granted to the phase and a completed duration is an invocation with `exit_code === 0 && timed_out !== true`; both SHALL be rebuilt from events on resume. Explicit host-configured phase timeouts remain a hard cap the ratchet cannot exceed, but when observed completions approach or exceed the explicit value the report SHALL state that the configured budget appears too small. `timeout_escalated` events SHALL record their source (`consecutive_timeouts` | `granted_highwater` | `observed_ratchet`). All budgets remain clamped by wall clock and the finalize reserve.

Enforcement: `harness/scripts/utils/goal-timeout.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: the incident's i4 no longer falls back to the base budget

- **WHEN** attempts time out twice, escalation grants 67.5 minutes, and the third attempt completes at 49.6 minutes with exit 0 but fails content gates
- **THEN** the next attempt's budget SHALL be 67.5 minutes (granted high-water), not the 45-minute base

### Requirement: Blocker actionability joins the decision ladder at a single position and splits timeouts in four steps

Aggregated blocker actionability (from the shared registry) SHALL enter the attempt decision ladder at exactly one position: after safety terminal states (operator interrupt, interaction/no-output, integrity, framework-bug) and transient-API backoff, before content retry/no-progress and closure routing. At that position: any `toolchain_blocked` blocker → halt `await_operator_toolchain` (an environment task, never phrased as a signature request); otherwise blockers non-empty and all `human_only` → halt `await_human_gate_deferral` reusing the awaiting-human-review semantics with per-item signature guidance; otherwise retry with the failure feedback restricted to `agent_fixable` items, `human_only` items marked as parked, and `human_only` ids excluded from the no-progress signature. For timed-out attempts with fresh blockers the classification SHALL follow four steps: integrity/framework-bug → safety terminal; ∃ toolchain_blocked → `await_operator_toolchain`; blockers non-empty and all human_only → the headless-interaction family (human outlet); otherwise `agent_timeout`. Peripheral state machines (vision trust/reseal startup terminals and fidelity transition preflight before the attempt; unauthorized-source-mutation and backtrack-limit reconciliation after the verdict) SHALL keep their existing positions and semantics — the aggregation layer only consumes blockers not claimed by them. The agent-written headless ledger SHALL never trigger these outcomes by itself (record-not-authorization); it is surfaced as guidance only.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: timeout plus toolchain-only blockers goes to the operator, not another blind retry

- **WHEN** an attempt times out and the fresh summary's only BLOCKER is the OCR-toolchain-unavailable gate
- **THEN** the run SHALL halt `await_operator_toolchain` instead of classifying `agent_timeout` and burning another content retry

#### Scenario: remaining human-only signature items stop consuming attempts

- **WHEN** all agent-fixable capture items are resolved and the only failing BLOCKER is the unsigned fidelity-deferrals gate in a headless run
- **THEN** one failing attempt SHALL move the run to `await_human_gate_deferral` listing the items to sign, without further content retries

### Requirement: Attempt reporting uses four orthogonal axes

Halt reporting for no-progress-family reasons SHALL be synthesized from per-attempt records on four orthogonal axes — agent termination (timeout/exit0/error) × harness verdict (PASS/FAIL/unavailable) × transition (advanced/advance_blocked/halted/retried) × artifact delta (changed/unchanged/restored) — rendered as a per-attempt timeline; summaries SHALL NOT present overlapping axes as mutually exclusive counts.

Enforcement: `harness/scripts/utils/goal-report-generator.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: the incident's i2 is reported on both axes instead of miscounted

- **WHEN** an attempt both timed out and produced a harness PASS blocked from advancing
- **THEN** the timeline SHALL show `timeout × PASS × advance_blocked` for that attempt and totals SHALL reconcile with the number of attempts

### Requirement: Observed adapter model is append-only telemetry

After each invocation the runner MAY parse the structured events file's init record through the shared envelope parser and append an `adapter_model_observed` event (`phase`, `invoke_id`, `adapter`, `model`, `source`); it SHALL NOT rewrite the frozen manifest or the pre-run `adapter_probe` event, SHALL NOT mint capability receipts for telemetry, and the observed model SHALL NOT feed vision-capability truth or any policy branch. Reports project the latest observation.

Enforcement: `harness/scripts/goal-runner.ts`

#### Scenario: the incident's MiniMax identity becomes visible without touching trust surfaces

- **WHEN** the events file's init record reports `"model":"MiniMax-M2.7"`
- **THEN** an `adapter_model_observed` event SHALL carry it while the manifest bytes and capability routing stay unchanged
