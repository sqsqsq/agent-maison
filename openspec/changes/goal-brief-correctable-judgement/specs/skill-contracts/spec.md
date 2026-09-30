## ADDED Requirements

### Requirement: Participants share one goal brief and judgements stay correctable

One assembly function SHALL build the goal brief from existing truth sources only — the run's frozen requirement (or the existing runless branch), the effective execution scope, `excluded` reference elements with their quotes and spec out-of-scope modules, the permissions granted by the run, the source-verified repair declines of the delivery cycle, and a pointer to the behavioural principle on authoritative judgement — and one render function SHALL produce its text. Every phase executor, the repair-candidate section, the delegated visual provider, every verifier prompt and the attended console SHALL consume that same text. The brief SHALL be computed on each use and SHALL NOT be persisted, added to evidence manifests, or become an input binding; its rendered text SHALL enter the verifier material digest as one text component, so a change of requirement, exclusions or declines changes the verifier subject while the existing prior-PASS reuse rule stays unchanged.

A phase executor MAY decline an issued repair candidate by appending one row per candidate to its phase's existing `headless-assumptions.jsonl` ledger, without schema change: `gate_id=repair_candidate:<item_fingerprint>`, `class=goal_conflict`, `decision` = `declined: ` plus a basis quoting one goal sentence verbatim in 「」, `must_review=true`, `source=agent`; a repeated decline SHALL append a new row. The quote check SHALL be the same function that validates `ref_elements_excluded` quotes. Judges receive recorded declines through the brief and are asked only to compare them with the goal and the measured evidence: accept and stop raising the item, or raise it again with evidence. A declined review candidate SHALL be confirmed by verifier evidence of the current subject; a reused prior review cannot confirm it.

The review verifier template SHALL check over-implementation: content the goal explicitly excludes that was implemented anyway SHALL be recorded as a MAJOR issue in the existing category 「其他」 with the implementing product source as the affected file, so the existing file-based routing sends it to coding. No review category value SHALL be added.

Enforcement: `harness/scripts/utils/goal-brief.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/harness-runner.ts`, `harness/scripts/utils/verifier-material.ts`, `harness/scripts/utils/repair-candidates.ts`, `harness/scripts/utils/fidelity-shared.ts`, `harness/prompts/verify-review.md`, `skills/reference/agent-behavioral-principles.md`

#### Scenario: the same exclusions reach every participant

- **WHEN** one project has an `excluded` reference element and one source-verified decline
- **THEN** the executor prompt, the provider prompt, the verifier prompt and the console SHALL contain byte-identical "explicit exclusions" and "resolved conflicts" sections

#### Scenario: an unverifiable decline is ignored

- **WHEN** a decline row quotes text that does not appear verbatim in the current requirement
- **THEN** it SHALL be treated as no decline, and the brief SHALL NOT list it

#### Scenario: over-implementation is a review finding without a new category

- **WHEN** review finds that an explicitly excluded feature was implemented
- **THEN** the issue SHALL be MAJOR in category 「其他」 naming the product source file, and its confirmed repair candidate SHALL route to coding
