## MODIFIED Requirements

### Requirement: Repair candidates carry signal-level identity and converge by cumulative one-shot accounting

Actionable defects SHALL retain signal-level `item_fingerprint` and existing event-sourced cumulative attempted accounting. A requested candidate becomes attempted only after the target phase actually executes, except that the backtrack round carrying the candidate's first source-verified decline (defined below) SHALL NOT count it as attempted. Eligible current identities backtrack once through the existing route. If all still-open identities were attempted, the runner SHALL retain `repair_not_converging` as a bounded convergence terminal/fuse and list machine evidence; same-run manual resume MUST NOT clear attempted identities, reset the fingerprint, change the quality conclusion, or create eligibility. Only new machine evidence producing a new identity, or a successor run with new identity/budget, can continue. A no-op owner repair SHALL not reuse downstream closures. A zero-change owner round in which every candidate issued to that owner has a source-verified decline is not an ineffective repair: the backtrack SHALL complete with result `declined`, the run SHALL continue and downstream phases SHALL re-run as usual; a zero-change round with no decline, with a decline whose quote is not verbatim, or with a decline covering only some of the issued candidates SHALL keep `repair_not_converging`.

A source-verified decline is one row of the owner phase's existing `headless-assumptions.jsonl` ledger (schema unchanged) with `gate_id=repair_candidate:<item_fingerprint>` and a `decision` starting with `declined:` whose every 「」 quotation appears verbatim in the current requirement text (the same quote check used by `ref_elements_excluded`), written in the same run inside the backtrack round's window — from its `phase_backtrack_requested` event to the next such event of that run, or to the run's effective `run_end` when there is none. The candidate SHALL still materialize; the decline only changes attempted accounting. A candidate that reappears after the round carrying its first source-verified decline is a rebuttal: whole-round fingerprint repetition SHALL exclude it once (an empty remainder skips the repetition check, and an inherited ancestor fingerprint is compared under the same exclusion). From the second decline on, the candidate SHALL be counted as attempted and SHALL no longer be excluded, so the existing `repair_not_converging`, `backtrack_fingerprint_repeat` or `backtrack_limit` terminals apply, and their halt text SHALL quote both the executor's decline basis and the judge's defect description. The backtrack budget SHALL NOT change and no halt reason SHALL be added. Decline and rebuttal state SHALL be replayed only from the delivery cycle's events (folded with the same lineage as the backtrack budget, ancestor runs included) and the owner ledgers; in-memory pending state and the decline list on a completion event SHALL NOT be sources, and an old decline row that does not fall into a newer round's window SHALL NOT count as a new decline.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/assess.ts`, `harness/scripts/utils/adjudication.ts`, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: manual resume cannot retry an attempted identity

- **WHEN** identity A remains open after its owner executed and the same run is manually resumed
- **THEN** A SHALL remain attempted and the convergence terminal SHALL remain unless new machine evidence changes the candidate set


#### Scenario: a first source-verified decline is not an ineffective repair

- **WHEN** every signal-level candidate issued to coding is declined with a verbatim goal quote and coding changes nothing
- **THEN** the backtrack SHALL complete with result `declined`, no halt SHALL occur and review, ut and testing SHALL re-run

#### Scenario: the judge raises a declined candidate again

- **WHEN** a candidate with one source-verified decline reappears in the next round
- **THEN** it SHALL be issued again as a rebuttal round carrying the earlier decline basis, without `backtrack_fingerprint_repeat`, and a fix in that round SHALL let the run continue

#### Scenario: a second decline stops with both sides quoted

- **WHEN** the executor declines the same candidate again in the rebuttal round and the judge still raises it
- **THEN** the candidate SHALL count as attempted, the run SHALL stop with an existing halt reason, SHALL NOT claim completion, and the halt text SHALL quote the decline basis and the defect description

#### Scenario: decline state survives restart and supersede

- **WHEN** the runner restarts after the completion event, is interrupted between `agent_process_settled` and the completion event, or a successor run supersedes the run after one decline
- **THEN** the replayed state SHALL be identical in each case, and an unchanged old ledger row SHALL NOT count as a second decline

### Requirement: Visual signals are adjudicated before candidate materialization

Visual signals SHALL be classified and validated before candidate materialization. A deterministic producer signal whose applicability/evidence contract passes SHALL materialize directly as a trusted machine repair candidate even when the primary agent disputes or omits it. A current delegated-provider payload that passes identity/hash/schema validation SHALL materialize through its existing provider path, except that outside the hard pixel contract a provider-reported `major` that places its screen in the gate's `downgraded_screens` SHALL NOT materialize (a provider `blocker` still does). Producer uncertainty or invalid/unreliable provider evidence SHALL not create a candidate: required quality stays FAIL/UNVERIFIED or capability-deferred and optional quality may remain advisory. The runner MUST NOT write `repair_adjudication_pending`, await `visual-confirm`, consume `confirmed_by`, or use human judgment as a third authority. Visual-round integrity and convergence events SHALL still be recorded before disposition.

Structured visual defects SHALL additionally be routed by their machine `severity` before materialization. A structured defect with `severity: minor` — whether attributed to a T8 producer, to a delegated visual provider, or to no producer — SHALL NOT produce a coding repair candidate; it SHALL remain in the report WARN; WARN-only disclosure SHALL NOT open blocking debt under the later completion-native-runtime-and-visual-debt policy, and the runner SHALL log one per-screen count of minor signals withheld. Defects with `severity: major` or `blocker` SHALL materialize exactly as before, with unchanged signal identity, fingerprint and instruction assembly, under the hard pixel contract or when the major is T8-sourced or the defect is a blocker. Outside the hard pixel contract, a screen listed in the gate's `structured.downgraded_screens` (read by the runtime only from the `script-report.json` beside the fresh phase summary, and only when that report was produced by the current gate: its mtime is not earlier than this attempt's gate start and the payload's existing `goal_run_id` / `attempt_id` equal the current run and attempt — a summary rewritten by `--sync-closure` or by a failure exit before the report is regenerated SHALL NOT revive an older list; any mismatch, a stale summary, a missing report or a missing field means an empty set) SHALL produce zero repair candidates and the collector SHALL log one line for it; the runtime MUST NOT derive the tier itself. The collector MUST NOT parse defect notes or must_fix prose (including an `[owner=…]` prefix) to derive ownership, and MUST NOT add a defect field for it; the optional `requirement_quote` of an `unexpected_render` defect is a verbatim requirement quotation checked against the current requirement text, not an ownership field. A defect with class `unexpected_render` (the implementation renders what the goal does not want) SHALL be authorized by direction inside the single authority function `defectRepairAuthority`: an anchor element registered `excluded` SHALL authorize it, a `requirement_quote` that appears verbatim in the current requirement text SHALL authorize it, and any other case — including an anchor declared for implementation — SHALL be `scope_unclear` and disclosed only; every other class SHALL keep the existing table, including `excluded` for a defect anchored on an excluded element. Authorization only lets the defect enter repair; it does not prove the content must be removed, and the executor may still decline it. Plain-text must_fix items with no structured defect SHALL keep the legacy whole-screen fallback, and screens whose screenshot or build identity cannot be verified SHALL keep the unverified route.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/repair-candidates.ts`, `profiles/hmos-app/harness/visual-diff-check.ts`, `profiles/hmos-app/harness/visual-provider-review.ts`, `harness/scripts/utils/adjudication.ts`

#### Scenario: deterministic signal survives agent dispute

- **WHEN** a current deterministic layout invariant produces an applicable FAIL and the agent disputes it without independent machine counterevidence
- **THEN** the signal SHALL materialize a repair candidate and no human adjudication halt SHALL occur

#### Scenario: uncertain required evidence remains unclosed

- **WHEN** a producer cannot reliably compare a required signal
- **THEN** the required axis SHALL remain unclosed or capability-deferred without finalizing PASS or entering WAITING(human)

#### Scenario: minor visual signals do not spend the backtrack budget

- **WHEN** every structured defect on the warn screens of a fresh, identity-bound `visual-diff.json` is `severity: minor` (host testing-i13: 12 such defects, must_fix prefixed `[owner=spec]`)
- **THEN** `collectActionableDefects` SHALL produce zero visual actionable items and zero unverified items, the phase summary SHALL carry no visual repair candidate, and assess SHALL NOT recommend `rerun_phase` / `backtrack_to_phase` for them
- **AND** the `visual_diff` WARN disclosure SHALL remain; its settled WARN SHALL NOT retain blocking debt under the later completion-native-runtime-and-visual-debt policy

#### Scenario: a major defect still materializes unchanged

- **WHEN** one of those T8-sourced defects is recorded with `severity: major`
- **THEN** exactly that defect SHALL become an actionable item with `signal_identity=true`, a fingerprint byte-identical to `computeDefectFingerprint(screen, defect)`, and a `coding` candidate

#### Scenario: a self-reported major outside the hard pixel contract does not backtrack

- **WHEN** under `pixel_1to1 ∧ best_effort` the fresh testing `script-report.json` lists both i11 warn screens (anchored must_fix + self-reported `major`) in `downgraded_screens`
- **THEN** `collectActionableDefects` SHALL produce zero visual candidates for them, no `phase_backtrack_requested` with `reason=repair_candidates` SHALL be emitted, and the testing summary SHALL keep the visual axis `UNVERIFIED`, `release_readiness=BLOCKED` and `completion_status=FUNCTIONALLY_COMPLETE_VISUAL_PENDING`
- **AND** the same run with hard wording in the requirement SHALL freeze `acceptance_strictness=hard`, downgrade nothing and backtrack through `repair_candidates`

#### Scenario: rendered excluded content enters repair

- **WHEN** a fresh, identity-bound `visual-diff.json` carries a `major` `unexpected_render` defect anchored on an element registered `excluded`
- **THEN** `collectActionableDefects` SHALL produce one `coding` candidate from the same effective view the gate uses, while a `clipping` defect on that element SHALL still be excluded

#### Scenario: a source-verified decline does not suppress materialization

- **WHEN** the owner declined a materialized signal with a verbatim goal quote in the previous round and the signal is still current
- **THEN** the signal SHALL materialize again as a candidate; only attempted accounting and whole-round repetition treat it as a rebuttal
