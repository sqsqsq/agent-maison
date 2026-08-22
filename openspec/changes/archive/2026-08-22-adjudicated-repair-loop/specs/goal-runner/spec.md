## ADDED Requirements

### Requirement: Repair candidates carry signal-level identity and converge by cumulative one-shot accounting

Visual actionable defects SHALL be projected into repair candidates at **signal granularity** — one candidate per defect/finding — with identity `sha256(computeDefectFingerprint(screen, defect))`, reusing the existing stable per-defect fingerprint (`screen|class|element|bbox_bucket[|producer#finding_id]`) and the existing `defect.must_fix_refs` association to resolve text-only `must_fix` entries; no per-screen aggregate identity (it drifts whenever the defect set or the build changes, making recurrence undetectable) and no new parallel identity or association structure. "Identity" is a concept name only: the sole stored field remains `item_fingerprint`. Each signal-level candidate SHALL carry `identity_schema: 'signal@1'`; candidates without the marker are legacy check-domain candidates — usable for diagnostics and existing routing, but **excluded from the convergence accounting and the no-op rule below**, which apply to `signal@1` candidates only.

Convergence SHALL follow the **cumulative one-shot rule**, derived entirely from existing authoritative events with no new ledger file. Candidate identities are read from `phase_backtrack_requested.candidates[]`, but a requested batch joins `attempted` **only once the target phase has actually executed in that backtrack window** — evidenced by a subsequent `agent_process_settled` or `phase_verdict` event for the target phase; a request with no such evidence (crash before the target phase ran) SHALL NOT count as attempted, preserving the existing crash/resume contract that request-only candidates are restored and executed. `eligible` = current open identities minus `attempted`. When `eligible` is non-empty the runner SHALL backtrack for the eligible identities only (prompt injection filtered to them); when `eligible` is empty the runner SHALL NOT backtrack and SHALL halt `repair_not_converging` (operator class, WAITING(human)) with guidance listing each still-open attempted identity's cross-round evidence and the existing human-recovery channel. Because `attempted` is cumulative, an identity whose executed repair failed SHALL NOT regain eligibility when a different identity triggers a later backtrack (no A/C alternation). The whole-round fingerprint-equality fuse remains only as a backstop, and the runner SHALL feed `repeated_round{fingerprint,count}` into the reconcile observation for assess to consume in its stop reasoning.

Backtrack events SHALL keep the existing vocabulary — `phase_backtrack_requested`, `phase_backtrack_started`, `phase_backtrack_completed` — with no new event types or transaction state machine: whether the target phase actually executed is read from the existing `agent_process_settled`/`phase_verdict` events; `phase_backtrack_completed` SHALL be emitted only after the backtrack actually completes (never before the target phase runs) and SHALL be emitted on all backtrack paths.

After the backtrack target phase's agent settles, the runner SHALL compare the invocation pre/post product-source snapshots (the existing filesystem-hash snapshot that explicitly tolerates pre-existing dirty worktrees; git-diff emptiness is forbidden as a criterion). Equal snapshots mean the repair was a no-op: the runner SHALL NOT re-run downstream phases, SHALL fold the driving identities into `attempted` (the target phase did execute), and SHALL halt via the empty-eligible rule, recording `phase_backtrack_completed` with `result: 'noop'` — a zero-change repair proves the fix ineffective, not the candidates resolved, so existing downstream closures SHALL NOT be reused to continue the chain. An unverifiable snapshot is fail-closed: fall back to the current full cascade, never guess.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/adjudication.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: a crash after request but before the target phase keeps candidates eligible

- **WHEN** a backtrack for identity A is requested and the run crashes before the target phase produced any `agent_process_settled`/`phase_verdict` event in that window
- **THEN** on resume A is not in `attempted`, remains eligible, and the restored backtrack carries A's candidate into the target phase per the existing crash/resume contract

#### Scenario: a crash after the target phase settled still counts as attempted

- **WHEN** the backtrack target phase settled (its `agent_process_settled`/`phase_verdict` is on the event log) and the run crashes before `phase_backtrack_completed`
- **THEN** on resume the driving identities are in `attempted` and SHALL NOT drive another automatic repair; if they are still open and nothing else is eligible the run halts `repair_not_converging`

#### Scenario: an attempted identity cannot regain eligibility through alternation

- **WHEN** identity A drove an executed backtrack whose repair failed to eliminate it, a later round's new identity C drives another backtrack, and the round after that has A open again
- **THEN** A remains in `attempted` and only identities outside `attempted` are eligible; with none, the run halts `repair_not_converging` naming A's cross-round evidence

#### Scenario: zero-change repair stops the loop without new event types

- **WHEN** a backtrack re-runs coding and the pre/post product-source snapshots are identical
- **THEN** downstream phases are not re-run, the driving identities join `attempted`, and the run emits `phase_backtrack_completed` with `result: 'noop'` before halting `repair_not_converging`

### Requirement: Visual signals are adjudicated before candidate materialization

Perception-sourced signals SHALL be adjudicated **before** any repair candidate is materialized, preserving the existing contract that `summary.repair_candidates[]` carries only trusted, actionable defects. The pipeline runs at the goal-runner collection site as a single source of truth (the harness-runner's check-domain assembly SHALL NOT process visual signals): producer emits each signal classified **actionable** or **uncertain** → signal-level identity → parse of the testing agent's fenced `defect-review` block (per-signal confirmed/disputed with rationale) → materialization decision.

Materialization has exactly two outcomes. An **actionable signal the agent's review confirms** is materialized as a regular repair candidate (`identity_schema: 'signal@1'`) and may drive a backtrack; a `PASS` verdict with such a candidate still backtracks (the existing guarantee preserved — "trusted" means this harness-synthesized concurrence, never agent self-report alone). **Every other perception signal — actionable but disputed by the agent, actionable but unreviewed, or producer-classified uncertain — SHALL stop the run before merge**: no candidate is written, and the runner halts `repair_adjudication_pending` (operator class, WAITING(human)) presenting the producer evidence and the agent's dispute rationale (when present) verbatim for human judgment. A WARN-level annotation is not a substitute for stopping — unresolved perception signals SHALL NOT be silently downgraded past the gate. There is **no automatic refuted verdict, no adjudication-layer verification algorithm, and no new summary schema for adjudication** (evidence lives in the producer output and the defect-review block; the only `summary.json` schema addition of this change is the optional `identity_schema` field, which is backward-compatible). Mechanical detection (OCR confusion, viewport/reference compatibility, geometry) lives only in the producer — a conflict between two sources proves disagreement, not which source is wrong, so it SHALL be classified uncertain at the producer or escalated to a human, never auto-resolved. Skipping the review block gives the agent no benefit (fail-closed to the stop path).

The producer SHALL classify uncertainty at the source: an OCR reading within edit distance 1 of a known candidate string SHALL be emitted as uncertain rather than a FAIL-grade text-placement signal, and vertical-order comparisons between a full-page stitched reference and a single-viewport screenshot SHALL be downgraded to uncertain with the calibre gap noted. The uncertain production wiring and stop ordering are frozen to existing carriers and control flow: the producer SHALL emit uncertain signals in an **optional `uncertain_signals[]` list on the existing producer-owned `VisualDiffStructuredPayload`**, each entry carrying the signal's `item_fingerprint`, the uncertainty reason, and the evidence reference; the list persists through the existing `checks[].structured` field of `script-report.json` (no new file or IPC). The goal runner SHALL read it when it reads the fresh summary and the round's script-report, forming a pending flag **before any PASS-path closure work**: with a non-empty list the runner SHALL NOT run receipt validation or closure finalization for the phase, SHALL still complete the existing `visual_round` event projection and integrity handling, and SHALL then halt `repair_adjudication_pending` without entering normal verdict processing or candidate merge — stopping only before merge is insufficient, since a lone uncertain signal alongside all-PASS screens would otherwise finalize the phase closure and then stop, leaving a success state and a WAITING halt coexisting. The producer SHALL NOT write uncertainty back into `visual-diff.json`, and no new file, ledger, receipt, or state machine is introduced for this wiring.

Human recovery SHALL reuse the existing visual-confirm human-sign channel — `visual-diff.json` screen `confirmed_by` with a human signer per the `isHumanVerified` predicate — as the single authoritative source: a human `--resume` after a convergence halt is itself one explicit release (the attempted invariant is re-established after execution, so each release requires a fresh human action). No manual-driver or confirmation-receipt path is introduced by this change as a recovery input, and no new receipt family or ledger is created. Halt guidance for `repair_not_converging` and `repair_adjudication_pending` SHALL name the concrete channel entry point and resume command — a WAITING state must accept future input. The review-phase FAIL retry prompt SHALL NOT contain fix-it-yourself inducements (e.g. "apply a minimal fix"); it SHALL instruct registering candidates with review evidence for adjudicated routing.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/repair-candidates.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: the OCR misread that burned run 60bcd1 is neutralized at the source

- **WHEN** OCR reads 「中国银行」 where the known candidate list contains 「中信银行」 at edit distance 1
- **THEN** the producer emits the signal as uncertain, no candidate is materialized, and the run stops `repair_adjudication_pending` for human judgment instead of backtracking

#### Scenario: a lone uncertain signal stops the run before closure, not after

- **WHEN** every screen passes except one signal the producer classified uncertain
- **THEN** the run halts `repair_adjudication_pending` **without invoking or completing receipt validation / closure finalization for the phase** — the uncertain signal is neither silently reduced to a WARN annotation nor left coexisting with a finalized PASS closure

#### Scenario: uncertain travels the real carrier from producer to runner

- **WHEN** the visual-diff check emits an `uncertain_signals[]` entry on its structured payload during a gate-harness run
- **THEN** the goal runner reads that entry from `checks[].structured` of the round's script-report and stops before verdict processing and candidate merge — with nothing written back into `visual-diff.json`

#### Scenario: the early stop does not drop visual-round bookkeeping

- **WHEN** the round carries a visual_round receipt and the runner stops early on uncertain signals
- **THEN** the existing `visual_round` event projection and integrity handling still complete before the halt

#### Scenario: an agent dispute stops the loop for human judgment instead of auto-refuting

- **WHEN** a mechanically actionable signal is disputed by the testing agent's defect-review entry
- **THEN** no candidate is materialized, the run halts `repair_adjudication_pending` with the dispute rationale presented verbatim, and no automatic backtrack or automatic refutation occurs

#### Scenario: an unreviewed signal cannot slip into a backtrack

- **WHEN** an actionable visual signal has no matching entry in the testing agent's defect-review block
- **THEN** no candidate is materialized and the halt guidance names the existing human channel that resumes the run
