## MODIFIED Requirements

### Requirement: Facts admission and within-attempt source changes use one entry

Before authorizing a phase executor, the runtime SHALL strictly validate existing facts through `resolveCapabilityResolutionEntryInput`, without pending-owner exemptions or replacing recorded source hashes with current bytes. A valid predecessor MAY have the same establishing phase and a different run identity; inheritance SHALL preserve its actual `established_by`, original facts provenance and baseline fingerprint/dependencies. Original closed-owner evidence must be valid before it is used. Missing source registration remains the existing automatic registration/WARN diagnosis; it SHALL NOT weaken an already recorded stale source or become a new provenance-only hard gate.

The existing `agent_invoke_start` SHALL retain the admitted `FactsInvocationContext`; `source_owners` for the current phase SHALL also satisfy its existing source write boundary. Executors receive that context through `PhaseExecutionContext`. CLI and finalizer consumers SHALL recover the exact run/phase/attempt event and the same scope revocation window, excluding out-of-chain labels and invalidated contexts. Granted source content changes SHALL require readable current targets and verified entry provenance. Registering an exact source row in the current phase delta SHOULD improve traceability; missing rows, including newly created or modified owned targets missing from the original declarations, SHALL disclose MAJOR/WARN with the existing check id rather than block the phase. An existing untouched target absent from Research SHALL retain the original coverage failure. Registration recognition SHALL normalize equivalent project-relative/absolute, slash and ./ paths and merge same-phase sections without changing existing manifest facts fingerprint semantics. Unrelated/unauthorized sources and non-source requirement/contracts/config dependencies SHALL retain strict original hash/exists checks. The original baseline SHALL NOT be rewritten to current hashes.

Current first-phase Research may exist before its first manifest. A stale/malformed baseline SHALL lead to actual source reconstruction at the first responsible phase; diagnostics SHALL identify facts and changed sources, rather than direct the actor to edit a capability contract. New establishing facts require schema 1.1; schema 1.0 inheritance requires an explicitly valid baseline. The finalizer SHALL re-enter the same admitted invocation to include newly established and gate-checked Research sources, while preserving its original baseline dependencies.

A new invoke in the same run and phase MAY re-admit its original validated baseline using completed `agent_invoke_start` contexts and real `phase_write_observed.owned` pre/post chains. Each completed authorized source transition SHALL connect from the original recorded hash through intervening observed writes to current bytes; original baseline hashes, fingerprint and provenance SHALL remain unchanged. An interrupted start without end/owned MAY instead carry its already validated, unrevoked facts context until the phase formally advances, when every changed dependency remains a readable current owned source within the existing write boundary and original evidence/environment/requirement integrity remains valid. A subsequent normal invocation end without new writes SHALL preserve this basis for remaining verifier work. A later real owned observation MAY bridge the interrupted write gap; once a source has an observed post hash, unobserved between-invoke drift SHALL again be rejected. Freshness recomputation MAY carry only those current-phase source paths already explained by this validated window, including through closed predecessors that consumed the pending source; it SHALL NOT apply a global owner exemption. A start label and current owner alone SHALL NOT establish admission. Current write authority SHALL be resolved again. Normal invocation end plus absence of an unclosed existing guardian binding establishes completion across platforms; product PASS/closed SHALL NOT be a prerequisite. Windows startup reconciliation SHALL close a bound guardian confirmed absent by emitting the existing `orphan_reclaimed` event with the actual run/invoke/pid and `guardian_gone` method; unverifiable or still-live bindings SHALL remain strict. Missing contexts, broken completed-write chains, revoked/backtracked windows, unrelated source drift, and any original environment/requirement/manifest-integrity failure SHALL retain the strict path. Current in-invoke self-checks SHALL still use the exact current start, without requiring a future post event. Independent entries without a run SHALL preserve their existing in-progress source behavior using entry-provided source owners and the existing write boundary in both admission and the final facts check, without synthesizing admission events or replacing recorded SHA values.

New coding source-only owned rows SHALL retain their original classification roles. `readRecordedRelatedHashes` SHALL exclude only those new coding rows with valid source/no-artifact roles, preserving the existing fresh continuation and legacy backtrack baseline semantics. Old rows without roles, coding artifact/mixed roles, UT source rows and observations SHALL keep their original consumers.

Automatically collected same-feature runtime manifest input dependencies that are retired by the shared content-evidence interpretation SHALL be excluded consistently from facts admission, inheritance and verification after original evidence integrity and current semantic checks. Old baseline entries SHALL match path/exists/hash against the original establishing evidence's retired input-only entries; an unrelated dependency SHALL retain its original check. Recorded baseline arrays, fingerprint, text, identity and hashes SHALL remain unchanged, including exact-start and completed-write-chain comparisons; new consumed baseline/writer views SHALL omit retired entries. The preserved dependencies above refer to the remaining business inputs; retirement SHALL NOT weaken current requirement/scope authority or explicit business-source checks. A provider-only authorized control change SHALL NOT by itself require canonical Research reconstruction. Missing semantic authority or genuine business-source drift SHALL still require actual responsible recovery through existing stale/unbound/facts checks and the first responsible phase's real factsRebuildReason path.

Enforcement: `harness/scripts/utils/capability-resolution-entry-input.ts`, `harness/scripts/utils/context-facts.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/harness-runner.ts`

#### Scenario: A normal open phase continues without rebuilding its valid Research

- **WHEN** an invoke has ended after legitimate source edits and the next same-phase invoke completes review evidence or continues authorized work
- **THEN** the new exact start SHALL retain the original baseline after complete pre/post verification, including three or more writes
- **AND** unrelated between-invoke drift and missing/broken/invalidated evidence SHALL remain rejected, while budgets and current product checks remain effective

#### Scenario: Same-phase successor inherits valid facts

- **WHEN** coding starts in a successor with unchanged valid source/scope/environment evidence
- **THEN** it SHALL preserve the old canonical facts and original provenance, appending only current delta

#### Scenario: A legacy validation-only window cannot establish facts by implication

- **WHEN** `resumePostAgent` reuses a settled invocation whose start lacks a verifiable facts context and strict admission finds a baseline stale due to a genuine business-input change
- **THEN** its gate SHALL retain the existing facts-stale failure and require actual responsible reconstruction
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
