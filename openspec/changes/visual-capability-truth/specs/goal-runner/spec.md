# goal-runner Spec Delta

## ADDED Requirements

### Requirement: Runner reconciles product-source drift after review closure in every mutable phase

After review closure, at the end of every source-mutable phase (ut, testing) the goal runner SHALL reconcile product-source drift (reusing the closure-attestation diff surface) into structured `changed_files` with per-file attribution, and classify before acting: in-phase authorized changes → no action; UT seam mutations matching the trusted authorization chain → automatic backtrack with an incremental re-review list injected into review; unauthorized testing-phase product changes → HALT (no automatic laundering; a human may explicitly authorize backtrack); out-of-scope module changes → HALT or scope-expansion decision; concurrent/unattributable external changes → HALT. Reconciliation SHALL NOT rely solely on the testing-phase check.

Enforcement: `harness/scripts/goal-runner.ts`

#### Scenario: testing agent's unauthorized product edit cannot trigger laundering backtrack

- **WHEN** during testing the agent modifies a product page outside any authorization receipt and the drift reconciliation detects it
- **THEN** the run SHALL HALT naming the files and attribution; no automatic backtrack to coding SHALL occur

### Requirement: Mutation authorization admits only three trusted sources frozen against runtime tampering

`approved_src_mutations` SHALL be honored only when backed by an authorization receipt whose `authority_kind` is `human` (confirmation receipt), `runner_policy` (predefined, scope-strict framework policy), or `pre_run_manifest`. Agent-written `approved_by` fields, generalized `user_requirement` sentinels, agent-authored gap-notes, and file-scope-less blanket grants SHALL be rejected. The `human` source SHALL be validated through the confirmation-receipt trust chain (workspace-external trust registry, signature over the canonical payload, action `source_mutation_authorization`, `object_hash` bound to the canonical authorization scope `{run_id, phase, allowed_files, allowed_change_kind, max_files}`, run-bound) — "an existing file whose hash matches" alone SHALL NOT constitute human authority, and `authority_ref` SHALL NOT escape the project root. Receipts SHALL bind at least `run_id / phase / allowed_files / allowed_change_kind / max_files / source_inventory_before / approved_by / authority_kind / authority_ref / receipt_hash`; for `pre_run_manifest` the runner SHALL freeze the manifest hash at `run_started` (`manifest_hash_at_run_start` + `manifest_entry_id`) and later authorization SHALL reference only that snapshot. Quota SHALL be enforced per receipt over the files it actually covers (receipts with no overlap with the diff SHALL NOT enlarge any quota); deleting product source files SHALL never be authorizable under `test_seam`/`integration_glue`. When the manifest identity chain lacks writer authenticity (no HMAC deployment / checkpoint unverified — asserted by the runner via `manifestIdentityAuthenticated: false`), the `pre_run_manifest` source SHALL NOT constitute machine-trustable authorization (the manifest file and the frozen-hash event both live in the agent-writable surface, so the whole chain is forgeable): such receipts classify as invalid with an explicit weak-trust reason, and authorization falls back to human confirmation receipts — terminal-state capping alone is NOT sufficient disposition. Until a content-level change-kind classifier for added/modified files lands, **automatic backtrack authorization SHALL be disabled**: a fully covered, quota-compliant receipt set SHALL still classify as unauthorized with an explicit "receipt matched — human adjudication required" violation (the receipts travel with the HALT as adjudication input); `authorized_backtrack` is reserved for after the classifier exists. An actual diff exceeding coverage or any per-receipt max_files SHALL likewise flip to unauthorized → HALT.

Enforcement: `harness/scripts/utils/mutation-authorization.ts`（新增）, `harness/scripts/goal-runner.ts`

#### Scenario: the incident's self-signed seam approval is rejected

- **WHEN** gap-notes carry `approved_by: headless-testability-setter-seam` written by the agent itself, with no matching receipt from the three trusted sources
- **THEN** the seam mutation SHALL be classified unauthorized and the run SHALL HALT instead of auto-backtracking

### Requirement: Fidelity transition is validated as an independent pre-step on fresh and resume alike

Applying `--fidelity`/`--fidelity-receipt` through `--manifest` SHALL trigger an independent transition validation immediately after the CLI values are applied, on **both fresh and resume paths** (the intent-based tier preflight only runs on fresh starts — resume MUST NOT become a bypass): the fidelity enum SHALL be hard-validated (`pixel_1to1|semantic_layout|reference_only`; an invalid value is a BLOCKER, never silently ignored), a downgrade relative to the detected requirement intent SHALL require a `fidelity_downgrade` confirmation receipt that validates against the trust registry (object_hash bound to the dereferenced requirement text, feature- and run-bound), and an applied `--fidelity-receipt` whose receipt fails validation SHALL be a BLOCKER (an invalid credential never lands in the manifest). Only on success SHALL the validator return the **precise** authorized identity-field set — an applied `--fidelity` authorizes only the `fidelity` field and a validated `--fidelity-receipt` only `fidelity_receipt` (no mutual piggybacking) — which is the sole source of fidelity-field authorization for the manifest identity drift gate (override flags no longer wave fidelity fields through). The "applied" predicate SHALL be computed from the same string-filtered values that `applyManifestCliOverrides` consumes (a bare valueless flag applies nothing and authorizes nothing).

Enforcement: `harness/scripts/utils/goal-preflight.ts`（evaluateFidelityTransitionAuthorization）, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-manifest.ts`

#### Scenario: resume with a downgrade and a garbage receipt is blocked before touching the checkpoint

- **WHEN** `--resume <run> --manifest <m> --fidelity semantic_layout --fidelity-receipt garbage.json` is invoked against a requirement with strong pixel intent
- **THEN** the runner SHALL exit BLOCKER at the transition validation (invalid receipt, rejected downgrade) and the downgraded fidelity SHALL NOT be written into the authenticated checkpoint

### Requirement: Phase backtrack is a persistent, budgeted, resumable state machine

Backtracking SHALL be persisted via append-only events — `phase_invalidated` (invalidated phase/attempt with receipt/snapshot references and attribution) → `phase_backtrack_requested` → `phase_backtrack_started` → `phase_backtrack_completed`. The backtrack count SHALL be computed from events (surviving process restarts), capped at 1 per run (exceeding → HALT), and SHALL consume total-turns and wall-clock budget. `--resume` SHALL rebuild backtrack state from events. Invalidated attempts SHALL be excluded from every consumer: upstream_verdict_gate, collectCleanPassIssues, feature-completion generation, upstream closure preflight, resume start-point derivation, goal report outcomes, progress.json phase states, receipt/snapshot latest-valid selection, review closure freshness, and ut/testing summary reads. Environment-layer failures (e.g. `device_locked`) SHALL be annotated `failure_layer: environment` in the resident summary, with upstream-gate guidance naming the environment fix (still blocking).

Enforcement: `harness/scripts/goal-runner.ts`, invalidation 消费面改造（tasks 4.4）

#### Scenario: invalidated PASS leaks nowhere

- **WHEN** review/ut are invalidated by a legal seam backtrack and any of the ten consumers reads phase state
- **THEN** each consumer SHALL observe only the latest valid attempt; an end-to-end assertion SHALL verify no stale PASS is consumed anywhere

## MODIFIED Requirements

### Requirement: Goal-mode visual rounds are committed by a single writer via replayed journal proposals

In goal mode, the agent-side harness SHALL NOT append to the canonical visual-rounds ledger; intermediate rounds SHALL be written to the per-run `goal-runs/<runId>/intermediate-rounds.journal.jsonl` with `schema_version / attempt_id / sequence / previous_proposal_hash / proposal_hash / gate_fingerprint` and the full structured round input (which carries `goalRunId` plus the source/build fingerprints and screens hash the runner recomputes against) — `attempt_id` is the run-scoped invocation ordinal shared by the agent's self-run harness and the outer gate of the same invocation; replay/adoption SHALL additionally filter rows by in-row `goalRunId` (defence in depth beyond path isolation). Round evaluation in goal mode SHALL use the logical history = committed ledger baseline + the current invoke's journal proposals (preserving no-progress fuse semantics across intermediate rounds). At phase-verdict time the runner SHALL replay proposals in sequence from the ledger baseline, recomputing each round's base_state_hash/decision/row_hash (journal-carried decisions are reference only); on full agreement it SHALL write canonical rows plus events, otherwise HALT. Interactive (non-goal) mode keeps direct writes. The hash chain detects non-tail deletion, insertion, reordering and modification; tail truncation is a declared non-cryptographic boundary (runner file-watcher / head checkpoint / IPC broker anchoring is out of scope here). During any transition period, orphan adoption SHALL additionally require exact invoke_id binding, matching source/build/gate fingerprints, strict sequence monotonicity, a per-invocation intermediate-round cap, an immediate per-row recovery event, and no re-adoption after resume; cross-attempt rows and history modification still fuse.

Enforcement: `harness/scripts/utils/visual-rounds-ledger.ts`, `harness/scripts/utils/intermediate-rounds-journal.ts`（新增）, `harness/scripts/goal-runner.ts`

#### Scenario: the 546beb77 orphan-row false fuse is eliminated

- **WHEN** the agent legally reruns the harness mid-attempt producing an intermediate round, then the gate runs the final round and the next reconciliation executes
- **THEN** the intermediate round SHALL exist as a journal proposal replayed and committed by the runner (no orphan ledger row), and no `visual_ledger_integrity` halt SHALL occur

#### Scenario: journal rounds still feed the no-progress fuse

- **WHEN** two consecutive intermediate rounds in the same invocation carry identical actionable residuals
- **THEN** the goal-mode evaluation over the logical history SHALL classify no-progress exactly as if both rounds were committed ledger rows
