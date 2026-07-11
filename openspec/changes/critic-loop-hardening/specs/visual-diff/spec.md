## ADDED Requirements

### Requirement: Layout findings are structured with stable identity

Every T8 layout finding SHALL carry a stable `finding_id` computed at emit time from `hash(screen_id|signal|sorted(elements)|bbox_bucket)` (elements finalized before emit — no backfill; bbox bucketed on a 0.1 grid so pixel jitter within a bucket keeps the id stable across rounds) and a structured `elements[]` list (declared element ids, replacing prose-embedded references). B-class findings SHALL carry a bbox where the involved nodes are locatable. Defects SHALL support optional `source: {producer: 'T8', finding_id, signal}` (transcription provenance) and `must_fix_refs: number[]` (indexes into the screen's must_fix array — per-item structured anchors). The check SHALL expose a structured in-process payload (fingerprints, T8 findings, base fail hit ids, round evaluation) to the runner; the payload SHALL NOT be injected into summary.json's blocker schema (additionalProperties: false) — persistence goes through the rounds ledger sidecar and the explicit `visual_round` summary field.

Enforcement: `profiles/hmos-app/harness/{layout-oracle-check,visual-diff-check}.ts`

#### Scenario: finding id stable across rounds

- **WHEN** the same forbidden-overlap violation is found in two consecutive rounds with sub-bucket bbox jitter
- **THEN** both rounds SHALL emit the same finding_id (element order and jitter immaterial)

### Requirement: Findings and must_fix items must be transcribed with structured anchors

Gate `visual_diff_finding_transcription`: a T8 hard finding with no matching defect — matched primarily by `defect.source.finding_id`, secondarily by elements intersection with signal-class consistency, and only as legacy fallback by bbox IoU ≥ 0.5 (plain intersection is too permissive — one big bbox must not clear every finding) — SHALL be a pixel_1to1 BLOCKER carrying a copy-paste defect template (including source). Unmatched warn-tier findings SHALL WARN (T8 warn hits already block candidate-pass; the WARN is a transcription reminder, not extra blocking). Under pixel_1to1, every must_fix item on a P0 finalized screen SHALL be referenced by at least one defect's `must_fix_refs`; unanchored items SHALL be a BLOCKER (closes the "equal counts but mismatched filler defects" gap left by the rev10 count gate, which stays as the fuse-eligibility necessary condition). Unstable-screen findings (capability degradation id) SHALL be exempt from transcription.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: filler defects do not satisfy anchoring

- **WHEN** a P0 screen has two must_fix items and two defects none of which reference the items via must_fix_refs
- **THEN** the gate SHALL FAIL listing the unanchored items

#### Scenario: hard finding transcribed via finding_id passes

- **WHEN** a defect carries source.finding_id equal to the T8 hard finding's id
- **THEN** the transcription gate SHALL NOT fire for that finding

### Requirement: Candidate-pass requires a receipt regardless of attestation presence

When the candidate path is active under pixel_1to1 (all P0 screens finalized pass with zero must_fix), a structurally valid critic receipt SHALL be required even when no `region_attest` exists (closes the minor-defect dodge: planting a minor defect per screen to skip attestation and thereby the receipt). Receipt screenshot-coverage validation SHALL extend from attested screens to all candidate P0 finalized screens — the same minimum input set the goal-side producer certifies.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: minor-defect dodge is closed

- **WHEN** all P0 screens are finalized pass with only minor defects, no region_attest, and no receipt exists
- **THEN** the gate SHALL FAIL requiring a structurally valid receipt

### Requirement: Visual rounds ledger with fingerprint-level no-progress fuse

A telemetry sidecar `device-testing/reports/visual-rounds.ledger.jsonl` SHALL record evaluation rounds: the check reads and decides, the harness runner appends after checks (judgment/telemetry red-line split). Round identity SHALL separate state from attempt: `base_state_hash = hash(build_fingerprint, screens_hash, defect_fingerprints, source_fail_hit_ids, fingerprintable)` where source_fail_hit_ids is the pre-fuse base FAIL hit set (the fuse's own id and derived aggregate hits excluded — feedback-loop guard); `round_key = (loop_id, attempt_id, base_state_hash)`. A row matching an existing round_key SHALL NOT be appended and SHALL replay the persisted decision (fused true or false — the fuse verdict is a property of the round, not of one execution; the outer goal gate must still see a fuse first detected during the agent's in-session harness run). A new round SHALL be compared against the last fingerprintable row of the same loop_id only: fuse fires iff both fingerprint sets are non-empty and equal, awaitHumanOnly is false (candidate-pass/human paths take precedence), and an actionable visual residual exists per the structured predicate; fingerprint eligibility SHALL additionally require the transcription audit to be clean (count-gate alone lets filler-defect rounds pollute the baseline), the comparison baseline SHALL itself be an eligible round (fingerprintable, actionable, not await-human), the decisive inputs (actionable_residual, await_human_only) SHALL enter both the persisted row and the state hash, unresolved actionable WARN identities (candidate-blocking WARN hit ids plus untranscribed warn finding ids) SHALL enter the row and the state hash as source_warn_ids (a WARN changing from A to B is not the same state), and untranscribed candidate-blocking WARNs SHALL make the round fingerprint-ineligible (must_fix / fail or fix-required warn screens / unresolved T8 hard or M1 blocking hits; excludes human-confirm, unstable, capability degradation, evidence-repair and aggregate hits — no id-prefix guessing). Defect fingerprints SHALL append the transcription source identity (`producer#finding_id`) when `defect.source` is present — the class/element/0.1-bucket triple alone is too coarse (multiple T8 signals map to one class, e.g. all B-class to shape_mismatch), and dropping the transcribed finding's identity would fuse "fixed A, new B in the same bucket" as no progress; this covers transcribed FAIL and WARN findings uniformly, while legacy defects without source keep the coarse quadruple (cross-format sets never compare equal — fuse deferred one round, erring safe, no ledger migration). Attribution: different build fingerprint → `ineffective_fix`; same build → `no_fix_attempt`. Rows carry `row_hash = sha256(canonicalJson(row without row_hash))` with a fixed canonical serialization. Interactive mode has no reliable attempt identity and SHALL be narrowed honestly: identical states are deduplicated (no automatic no_fix_attempt fuse), only changed-state-same-fingerprints fuses. Ledger corruption SHALL be skipped per-line with a WARN note and SHALL NOT be interpreted as empty history. Empty or fingerprint-ineligible rounds SHALL never be compared. The fuse SHALL only produce a BLOCKER under pixel_1to1 (lower tiers observe rows with decision always unfused — lightweight conservation).

Enforcement: `harness/scripts/utils/visual-rounds-ledger.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/harness-runner.ts`

#### Scenario: duplicate replays a fused decision

- **WHEN** the agent's in-session harness run detects the fuse and appends the row, and the outer gate then evaluates the identical round_key
- **THEN** the evaluation SHALL be disposition=duplicate with decision.fused=true so the gate halts as no_progress_fuse

#### Scenario: cross-attempt unchanged state fuses as no_fix_attempt

- **WHEN** attempt N+1 re-runs with build, screens and fingerprints identical to attempt N's appended row
- **THEN** a new row SHALL be appended and the fuse SHALL fire with attribution no_fix_attempt

#### Scenario: await-human candidate is not stolen by the fuse

- **WHEN** all P0 screens are candidate-pass with minor defects and the only FAIL is human confirmation, with fingerprints equal to the prior round
- **THEN** the fuse SHALL NOT fire and the result SHALL classify await_human_confirm

### Requirement: Verified receipts require a runner attestation

`input_provenance: verified` SHALL be honored only when the receipt carries a valid `runner_attestation {goal_run_id, evidence_log_path, evidence_log_hash}` whose evidence log exists on disk and whose recomputed hash matches (integrity binding, not a cryptographic signature — both files live in the agent-writable workspace and the defense is runtime consistency). Additionally (review-fix, two rounds): the evidence file SHALL be named agent-events.jsonl and its resolved path SHALL be exactly equal to the canonical location `<featureDir>/goal-runs/<run_id>/phases/testing/agent-events.jsonl` (component-exact resolution, not substring containment — a run_id fragment in a parent directory or sibling name proves nothing; receipts are only produced in the testing phase so the expected path is uniquely derivable); verified SHALL only be honored in the goal gate context (both MAISON_GOAL_RUN_ID and MAISON_GOAL_ATTEMPT present — honoring a historical goal receipt interactively would produce candidate-pass(verified) outside this change's scope), with the attestation goal_run_id equal to the current run and critic_run_id exactly equal to `<run>-<attempt>`; and the checker SHALL **re-parse the evidence log with the adapter's registered structured parser and verify every image_inputs entry has a matching read event** — "some file's hash is unchanged" is not "this critic read these images". Adapters without a registered parser cannot be re-audited and SHALL NOT be honored as verified. Boundary: output_hash is producer-side evidence and is not recomputed by the checker outside the gate context. A verified claim without a valid attestation SHALL be downgraded to unverified with a WARN (hand-written verified is impersonation); the stricter verified-tier validations still run. The candidate-pass tier SHALL be `candidate-pass(verified)` only when the attestation validates.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: forged verified receipt downgraded

- **WHEN** a receipt claims verified without runner_attestation, or its evidence log hash mismatches
- **THEN** the gate SHALL treat it as unverified and WARN, never producing candidate-pass(verified)

### Requirement: Quiescence sampling replaces single-shot capture under pixel_1to1

A shared quiescence sampler SHALL implement `shot₁ → dump₁ → dump₂ → shot₂` with a dual stability criterion: app-window-cropped image hash equal across the two shots (full-frame byte equality is rejected — status-bar clock/battery/signal drift makes it near-always false on device; confirmed 2026-07-11 on-device: 5/8 screens drifted full-frame while 8/8 were stable app-cropped), and normalized layout signature (type/id/bounds structure; text excluded) equal across the two dumps with matching appRoot identity. Unstable groups SHALL be retried (default 2 — on-device the animated SMS sheet converged within 3 groups) and then recorded with `unstable_reason` (image_drift | layout_drift | approot_drift | both) and per-attempt hashes in a `_quiescence/` sidecar. The official testing capture chain SHALL use the sampler **only under pixel_1to1** (same guard as layout dumping; lower tiers keep single-shot single-dump behavior — lightweight conservation); this enablement was gated on and is justified by the real-device double-sample measurement (calibration CLI item ⑨). Sampler execution failure is a capture failure; retry exhaustion is NOT — the screen SHALL be marked `layout_dump_status: 'unstable'` with its reason and keep final artifacts. T8 findings on unstable screens SHALL be emitted under the separate id `visual_diff_layout_invariants_unstable` as capability-degradation WARN (all tiers downgraded — A-class is not exempt on transitional frames), outside the candidate-blocking set and exempt from transcription, surfaced for human review in batch confirmation.

Enforcement: `profiles/hmos-app/harness/{quiescence-sampling,visual-diff-capture,visual-diff-check}.ts`, `harness/scripts/check-testing.ts`

#### Scenario: persistent instability is recorded not guessed

- **WHEN** every sampling group differs in the app-cropped image hash (carousel screen)
- **THEN** capture SHALL mark the screen unstable with image_drift, keep the final artifacts, and NOT count it as a capture failure

#### Scenario: unstable screen downgrades hard findings

- **WHEN** a screen marked unstable has a forbidden-overlap violation in its dump
- **THEN** the gate SHALL emit visual_diff_layout_invariants_unstable as WARN instead of a hard BLOCKER and the transcription audit SHALL not require it

### Requirement: Human review feedback is ledgered by the confirm CLI transactionally

The visual-confirm CLI SHALL own review feedback persistence: y/f/overrule decisions append to the append-only `review-feedback.ledger.jsonl` through a crash-recoverable transaction (stable feedback_id → pending journal → atomic visual-diff.json replace → ledger append → journal clear; startup reconciliation resumes interrupted transactions idempotently by feedback_id). The machine-signals snapshot SHALL be validated against the screen being confirmed (screenshot hash binding, current build fingerprint, current oracle version) — a stale report refuses the entry rather than fabricating FP/FN samples. FP samples come from `--overrule <screen> --signal <signal>` (attributed per signal); FN samples come from rejects with an all-green snapshot and default to unattributed — per-family FN is derived only through the fixed human_issue_kind → detector-family mapping (humans describe the problem category; the program attributes). Snapshots SHALL separate per-screen attributable hits (T8 stable/unstable findings by screen_id) from report-level hits (OCR/placement/M1 — recorded separately, never attributed to a screen); the FN "all-green" condition requires both sets empty, and overruling a report-level signal is allowed but attributed to the signal, not the screen. A ledger append failure SHALL also fail the interactive harness run (non-zero exit), not only the goal gate. Aggregated FP/FN tables feed the calibration report as data material for gate-tier review; tier upgrades are NOT mechanized by this change. Agents SHALL NOT be responsible for transcribing human feedback.

Enforcement: `harness/scripts/visual-confirm.ts`, `harness/scripts/utils/review-feedback-ledger.ts`

#### Scenario: interrupted transaction recovers

- **WHEN** the CLI crashes after writing visual-diff.json but before the ledger append
- **THEN** the next CLI start SHALL reconcile the pending journal and append the entry exactly once

### Requirement: Layout oracle calibration is a one-command dual-artifact report

`layout-oracle-calibrate` SHALL be an explicitly-invoked CLI (never attached to a phase chain) producing `calibration.json` (SSOT) plus a markdown projection, with each item labeled automated_conclusion vs needs_human: overlay-in-tree, locator coverage/confidence distribution, bounds hygiene, close-rule dry run, C1 gap distribution, appRoot selection stability, bounds-semantics crop material (needs_human), locator ambiguity counts, device-mode double-sample stability rates (the t4b precondition), and the feedback-ledger FP/FN tables. The CLI SHALL NOT change gate tiers.

Enforcement: `profiles/hmos-app/harness/layout-oracle-calibrate.ts`, `harness/scripts/layout-oracle-calibrate.ts`

#### Scenario: offline mode is honest about unmeasured items

- **WHEN** the CLI runs without --device
- **THEN** the double-sample stability item SHALL be empty with a note that device measurement is required before enabling quiescence downgrade
