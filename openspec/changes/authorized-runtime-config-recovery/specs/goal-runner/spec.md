## MODIFIED Requirements

### Requirement: Facts admission and within-attempt source changes use one entry

Before authorizing a phase executor, the runtime SHALL use `resolveCapabilityResolutionEntryInput` to recover the original obligation, readable current sources and the unrevoked admitted context. Inheritance SHALL preserve historical establishing phase, provenance, dependencies and fingerprints. The writer SHALL keep those historical values intact. The current checker and finalizer SHALL assess the actual requirement, authority, source content and decisions using the same input selection.

The existing `agent_invoke_start` SHALL retain its admitted context. An invocation, its continuation or a caller without a run SHALL receive current write permission only from existing authority and scope resolvers. The runtime MAY consume a current source for the original obligation even when no `owned` pre/post chain, per-file read, or new phase-delta row is available. It SHALL assess the change against the obligation's actual input and keep unrelated evidence reusable. A new finding or changed relevant source SHALL go to the responsibility that can recheck that conclusion. Changes to acceptance, contracts or blueprints SHALL be checked against the original request before the existing owner re-signs them.

Existing process identity, actual settlement, cancellation and deadline guarantees SHALL remain effective. Windows startup reconciliation SHALL close an absent guardian by emitting the existing `orphan_reclaimed` event with the actual run, invoke, pid and method. A live or unverifiable binding SHALL retain the existing recovery constraints. Window-only observations SHALL NOT decide the current source owner, reopen unrelated completion, or require restoration to historical bytes.

Automatically collected runtime manifest dependencies SHALL enter freshness only where a conclusion actually consumes their semantic fields. An authorized provider-only control change SHALL preserve unaffected business evidence. Historical original integrity and explicit current authority remain required.

Enforcement: `harness/scripts/utils/capability-resolution-entry-input.ts`, `harness/scripts/utils/context-facts.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/harness-runner.ts`

#### Scenario: A normal open phase continues without rebuilding its valid Research

- **WHEN** an invoke has ended after legitimate source edits and the next same-phase invoke completes review evidence or continues authorized work
- **THEN** the new start SHALL retain the original baseline and assess the current inputs used by each conclusion
- **AND** unrelated between-invoke changes SHALL leave the conclusion eligible, while affected or invalid evidence SHALL require the specific check and the original budget remains effective

#### Scenario: Same-phase successor inherits valid facts

- **WHEN** coding starts in a successor with unchanged valid source/scope/environment evidence
- **THEN** it SHALL preserve the old canonical facts and original provenance, appending only current delta

#### Scenario: A legacy validation-only window cannot establish facts by implication

- **WHEN** `resumePostAgent` reuses a settled invocation whose original current conclusion lacks an applicable result after a genuine business-input change
- **THEN** its gate SHALL require the responsible party to recheck the affected conclusion
- **AND** it SHALL NOT emit another start or recount the settled invocation; a later necessary real executor call SHALL consume the original remaining budget normally

#### Scenario: Real input staleness gets a responsible execution window

- **WHEN** a downstream invocation cannot enter because its facts input is genuinely stale and an earlier responsible phase is available in the current chain
- **THEN** the existing recovery transaction SHALL invalidate the necessary window and give that responsible phase a real reconstruction or validation opportunity before retrying the blocked downstream phase
- **AND** old settled evidence SHALL NOT suppress that required execution, while ordinary validation-only recovery of unchanged valid inputs SHALL remain available


## ADDED Requirements

### Requirement: Authorized runtime changes preserve unaffected business evidence

Runtime configuration changes SHALL continue to use the existing paired visual provider input, override authorization and manifest identity rebase. A provider-only authorized change with unchanged requirement, effective scope and business inputs SHALL preserve unaffected phase evidence and continue the unfinished visual obligation through the same run when the existing continuation decision permits it. Unauthorized provider, budget or requirement changes MUST remain rejected by their existing authority checks. Budgets MUST remain cumulative across recovery and SHALL NOT be enlarged or reset to make recovery succeed.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-run-creation.ts`

#### Scenario: An authorized provider switch continues the original delivery

- **WHEN** testing stopped on capability absence and the user authorizes changing its frozen visual provider through the formal override path
- **THEN** the runtime SHALL record the existing identity rebase, reuse unaffected business evidence, reach the new provider evaluation and keep accumulated budget consumption without requiring a provider-only coding/review/ut redo

#### Scenario: No authorization or no budget remains

- **WHEN** the caller changes protected configuration without the required authorization or lacks the remaining hard budget for the next operation
- **THEN** the existing authorization or budget stop SHALL remain effective despite content-evidence dependency retirement

### Requirement: Input-owner recovery precedes an unproductive content retry

When the current phase fails at facts admission and the observed disk state has a definite earlier responsible gap in the same chain, assess SHALL use the existing owner/gap recovery before classifying the current failure as an ordinary same-phase content retry. This branch SHALL use the existing facts-admission blocker id from the fresh current summary or same-round reconcile facts plus existing chain gaps; stale historical summaries and prose suggestions SHALL NOT establish this branch. Runtime SHALL form the same assess recommendation before applying content no-progress to a window that gave no executor a repair opportunity, and SHALL give way only to an executable earlier recovery permitted by the existing invalidation surface. The single existing decideAndEmit boundary SHALL commit the action. The existing backtrack action, invalidation transaction, scope revocation and resume/validation-only interpretation SHALL be reused. Invalidation SHALL cover completed work from previous sessions and remove affected in-process resumePostAgent phase/attempt caches; restart SHALL derive from the same revoked window. Hard budget, authorization, ownership, write-boundary and backtrack-repeat guards MUST remain effective. Genuine content failure and genuine no-progress protection SHALL retain their existing behavior; an unknown or non-executable recovery target SHALL use its existing accurate stop rather than repeat an identical gate. No phase-routing table, new halt reason, durable state, summary field or prose-parsed owner SHALL be added. Skip-executor diagnostics SHALL identify the actual phase and whether completion or blocked admission caused the skip.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/harness-runner.ts`

#### Scenario: A known upstream facts gap is not retried in testing

- **WHEN** testing cannot admit its facts, an earlier responsible phase is identified by current evidence, and testing has no repair executor window
- **THEN** the first decision SHALL execute the existing responsible recovery rather than repeat testing until no_progress_guard
- **AND** previous-session settled evidence and in-process resume caches SHALL NOT suppress the responsible phase's real execution after invalidation

#### Scenario: Valid settled work still skips an unnecessary executor

- **WHEN** an agent already completed and its business inputs remain valid while only gate or closure work remains
- **THEN** validation-only recovery SHALL remain in use without adding another content invocation
