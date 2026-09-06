# goal-runner Spec Delta

## MODIFIED Requirements

### Requirement: Retry prompts carry continuation context decoupled from the content-retry budget

The runner SHALL derive continuation from the current phase's most recent attempt window independently of the retries counter. Whenever continuation is non-null, the prompt SHALL include prior-failure evidence matched to the cause. If the harness did not produce a readable summary, the runner SHALL include a bounded excerpt of the current attempt's harness error output and SHALL classify a parser/schema/artifact load failure as an artifact/gate failure rather than defaulting to `code_regression`. `harness_start`/`harness_end`/`phase_verdict` events SHALL carry `invoke_id`; legacy logs without it SHALL be windowed by event order.

An attempt that produced no failure fact SHALL NOT be given a failure attribution. The presence of a summary SHALL NOT by itself count as a failure fact: the summary SHALL additionally state a failure, meaning `verdict` is not `PASS` or `blockers` is non-empty; a summary without a `verdict` SHALL be treated as stating a failure (fail-closed). Independent runtime failure facts — timeout, API error, empty agent output, operator interrupt, agent failure, a non-zero harness exit, a closure finalization error, or actionable defects or unverified items — SHALL each remain sufficient on their own. When neither holds, the runner SHALL NOT emit `failure_kind_classified` on the `phase_verdict` event, SHALL NOT emit `phase_outcome.failure_kind`, and SHALL NOT synthesize a blocker signature. This SHALL apply to a round blocked from advancing, including a `PASS` round whose advance is blocked by an open closure and whose action is therefore `retry`; the round's `verdict`, `advance_blocked` and `action` SHALL be unchanged, and `advance_block_reason`, `assess_recommendation.reason` and the blocker list SHALL continue to be recorded.

A missing-evidence failure of the ui-spec fidelity gate SHALL be attributed to the existing `spec_capture_gap` and MUST NOT be attributed to `code_regression`. Every FAIL exit of that gate reports that read-back evidence was not established rather than a product-source defect, so the retry guidance for a source regression MUST NOT be given for it. This attribution MUST NOT introduce a new failure kind, MUST NOT add the kind to the signature-halt, cumulative-halt or external-retry-responsibility sets, and MUST NOT change the blocker's actionability, so fuse behaviour, cumulative halt and retry responsibility are unchanged and the blocker remains agent-fixable. The gate's own four state words SHALL remain human-readable wording in the blocker's `details` and `suggestion` and SHALL NOT be promoted into the failure-kind vocabulary.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-runner-phase.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: YAML parse failure reaches the next attempt

- **WHEN** a spec harness exits before summary generation with `BLOCK_AS_IMPLICIT_KEY`
- **THEN** the next prompt includes that error and affected artifact context instead of generic source-code rollback guidance

#### Scenario: Resume into a fresh phase injects nothing

- **WHEN** the runner restarts with --resume and the current phase has no historical agent_invoke_start
- **THEN** continuation SHALL be null and the prompt SHALL contain no continuation blocks

#### Scenario: A closure-blocked PASS round carries no failure kind

- **WHEN** a phase attempt ends with `verdict=PASS`, an empty blocker list, a zero harness exit, no agent-level failure signal, and is held back with `advance_blocked=true` / `advance_block_reason=closure_open` so its action is `retry`
- **THEN** the `phase_verdict` event SHALL NOT carry `failure_kind_classified` and its `reconcile_observation.phase_outcome` SHALL NOT carry `failure_kind`
- **AND** the same event's `verdict`, `advance_blocked` and `action` SHALL be unchanged

#### Scenario: A PASS round with a runtime failure fact keeps its attribution

- **WHEN** a phase attempt reports `verdict=PASS` with no blockers but the agent timed out, failed, produced no output, or the harness exited non-zero
- **THEN** the attempt SHALL still be attributed and `failure_kind_classified` SHALL still be emitted

#### Scenario: A ui-spec fidelity gate failure is a capture gap, not a regression

- **WHEN** the ui-spec fidelity gate fails because the read-back evidence was never established, leaving `ui_spec_fidelity_gate` as the round's blocker
- **THEN** the attempt SHALL be classified `spec_capture_gap` and SHALL NOT be classified `code_regression`
- **AND** the retry prompt SHALL NOT instruct the agent to revert source changes made since the goal-run start commit
