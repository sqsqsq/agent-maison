## ADDED Requirements

### Requirement: Visual round identity is injected and monotonic across resume

The goal runner SHALL inject `MAISON_GOAL_RUN_ID` and `MAISON_GOAL_ATTEMPT` into both the agent invocation environment and the harness gate environment so the agent's in-session harness run and the outer gate share one round identity. The attempt id SHALL be the run-scoped invocation ordinal restored from events.jsonl (totalTurns mechanism) — never the per-phase retry counter (`retries + 1` resets on --resume, colliding with old round keys and replaying an unfused decision over what should be a no_fix_attempt second round). Hard constraints: same invocation → same id everywhere; any next invocation (retry, detach recovery, --resume) → different id; crash recovery never reuses an id (the ordinal counts already-persisted invoke-start events). The invoke_id SHALL derive from this ordinal, not from the wall clock alone.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/{agent-invoke,goal-runner-phase}.ts`

#### Scenario: resume produces a fresh attempt id

- **WHEN** a run is interrupted after attempt i3 and resumed with unchanged evaluation state
- **THEN** the next invocation SHALL carry an id greater than i3 and the unchanged state SHALL fuse as no_fix_attempt instead of being deduplicated

### Requirement: no_progress_fuse halts on first touch without burning retries

`no_progress_fuse` SHALL be a first-class failure kind: classified from the blocker classification channel before the visual_diff id-prefix bucketing (the fuse blocker id starts with visual_diff and would otherwise be absorbed into visual_gap), mutually exclusive with await_human_confirm by check-side construction, halting on first touch with halt reason `no_progress_fuse` and never entering the signature-halt retry accounting. The pre-existing coarse visual_gap signature halt SHALL remain as a backstop with its distinct halt reason.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: fuse classification wins over prefix bucketing

- **WHEN** the testing summary carries a blocker with classification no_progress_fuse among other visual_diff blockers
- **THEN** classifyFailureKind SHALL return no_progress_fuse and the runner SHALL halt immediately

### Requirement: Ledger receipts round-trip through summary and events with integrity reconciliation

The harness runner SHALL append the evaluated round to the ledger after checks and return a receipt through the explicitly declared `summary.visual_round {loop_id, attempt?, row_hash?, disposition, decision?}` schema field (summary.json is additionalProperties:false — no bare injection); duplicate dispositions SHALL still carry the replayed decision. The goal runner SHALL persist the receipt as a `visual_round` event and, at each testing gate and on resume, reconcile events-expected row hashes against the ledger **unconditionally** (an empty expected set is precisely the main-path failure shape and never skips the check). The expected set SHALL include row hashes from **duplicate** dispositions (the dominant path is agent-side append followed by a gate duplicate — the duplicate's row_hash is that ledger row). Missing rows, modified rows (decision edits included — row hash recomputation), stale orphan rows, corrupt lines inside the goal loop, and duplicated row hashes SHALL halt as `visual_ledger_integrity`; pending adoption is limited to the **single most recent testing-phase invocation** that has started but not yet committed a visual_round event (non-testing invocations never qualify — they would stay pending forever and lend their attempt ids to orphan rows), and every adopted row SHALL immediately be committed back as a recovery visual_round event so the attempt stops being pending and the row enters the next expected set. A ledger append failure SHALL surface as `disposition: append_failed` (no row_hash) and halt immediately — the runner SHALL NOT proceed on a receipt that claims persistence that did not happen. Ledger corruption or deletion SHALL NOT be read as empty history. This is runtime consistency protection over agent-writable files, not cryptographic tamper-proofing — stated as such.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/visual-rounds-ledger.ts`, `harness/schemas/summary.schema.json`

#### Scenario: deleting a ledger row halts the run

- **WHEN** events.jsonl expects a row hash that is absent from the ledger at the next gate
- **THEN** the runner SHALL halt with visual_ledger_integrity instead of re-evaluating from an empty ledger

### Requirement: Runner-attested receipts are produced only from declared structured events

Adapters SHALL declare `tool_event_provenance: none | structured_events | session_transcript` (default none =永远 unverified). With structured_events the invocation layer SHALL split three files — `agent-events.jsonl` (stdout only, clean NDJSON), `agent-stderr.log`, and the unchanged mixed human-readable `agent-output.log` (existing sentinel/heartbeat/no-output consumers untouched). After the testing invocation the goal runner SHALL audit image-read tool events from the events file using a registered structured parser only (no text-regex guessing) and produce the critic receipt: verified iff every finalized screen's evaluated screenshot and every paired attest crop has a read record; otherwise unverified with unread lists; the receipt carries the runner attestation bound to agent-events.jsonl. Adapters without a registered parser SHALL degrade honestly (no production, unverified stands). Read-event evidence proves invocation and input injection, not model cognition.

Enforcement: `harness/scripts/utils/{goal-adapter-capability,agent-invoke,critic-receipt-producer}.ts`, `harness/scripts/goal-runner.ts`, `docs/operations/adapter-tool-event-provenance.md`

#### Scenario: stderr cannot corrupt the evidence stream

- **WHEN** the CLI writes NDJSON events to stdout while stderr emits diagnostics mid-line
- **THEN** agent-events.jsonl SHALL contain only the stdout stream and the attestation SHALL bind to it, not to the mixed log
