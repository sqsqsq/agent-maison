## ADDED Requirements

### Requirement: Check tools and completion share current facts

Public checks SHALL use the existing check/compile CLI, applicable obligations, current authorization and normalized input bindings. A phase selects a check family, not author eligibility. Missing phase closure MUST NOT prevent a check whose real inputs are available. The same current results SHALL feed readCurrentDispositionInput and resolveCurrentDisposition for feedback, completion and release readiness. Required unknown or failed facts MUST remain unsatisfied.

#### Scenario: Check during unfinished work
- **WHEN** real inputs for an applicable check exist without an upstream closed phase
- **THEN** the tool executes the applicable check and returns all independently decidable findings without manufacturing upstream PASS

### Requirement: Reused results do not advance convergence history

Valid results SHALL be reused using existing input, execution and material bindings. Repeating the same check without relevant author changes MUST reuse the same result and MUST NOT form another comparable assessment or advance the existing comparison window. Changed inputs followed by completed affected verification may be compared against unmet obligations and confirmed findings. New independent evidence may demonstrate progress even if counts or file bytes do not decrease. No counters, fingerprint ledger or second runtime is introduced.

#### Scenario: The author repeats the same failed check
- **WHEN** relevant inputs, authorization, acceptance and effective evidence are unchanged
- **THEN** the original FAIL is reused without another expensive execution or new no-progress interruption, and completion remains ineligible

#### Scenario: Files change but acceptance does not improve
- **WHEN** feedback was delivered and the author had an opportunity to repair, then completed affected verification establishes the same unmet obligations
- **THEN** the existing coordinator interrupts the owner-bound running execution through P1, confirms stopping and preserves recoverable work

#### Scenario: An author returns the same unsatisfied work for acceptance
- **WHEN** required feedback reached the author, a real completed invocation returns the work, and its first formal assessment has completed the relevant checks without resolving the same required findings
- **THEN** the same convergence decision may preserve the no-progress pause even when the underlying tool result is reusable
- **AND** reading an old invocation end again, duplicate reporting or verification-only recovery does not create another author opportunity

#### Scenario: Required verification is unfinished
- **WHEN** no completed comparable result exists or the effective evidence is unknown
- **THEN** the coordinator preserves the validation gap and does not invent either progress or no-progress

### Requirement: Completion consumers project one current disposition

Assess, NEXT, report, status, progress, Feature, CU, component and release SHALL use the existing shared reader/resolver/evaluation, without another completion state, collector or dispatcher. Same-call currentResults/dispositions SHALL be propagated. A source read error SHALL retain its original verification gap and independently determined repairs. Event-only liveness and elapsed time MAY remain readable, but missing originals MUST NOT sign completion. Component completion SHALL require formal writer artifacts and applicable assembly/independent evidence, not all completed CUs or an eligible evaluation. Release retains its distinct conditions within the same disposition.

#### Scenario: A read fails beside a product failure
- **WHEN** one source is unreadable while a real current check establishes a defect
- **THEN** the view retains both the read error and actionable defect without claiming completion

### Requirement: Late refusal arguments reach the independent request

Eligibility SHALL depend on actual reviewable objects, reports and current work, not a phase whitelist or blanket script-FAIL exemption. A late refusal SHALL preserve full original ledger bytes and separately attribute matching request/window/fingerprint rows. The original writer SHALL bind changed arguments into a new current request before independent execution, retaining old originals without rerunning unaffected tools/authors. Repeated arguments with different timestamps or IDs MUST NOT create progress or comparison opportunities.

#### Scenario: Refusal arrives after request issuance
- **WHEN** an author writes a real refusal after prompt/material issuance
- **THEN** the independent call receives a new bound request containing the original argument and attribution while unaffected checks are reused

#### Scenario: Unavailable execution coexists with reviewable product work
- **WHEN** current evidence includes missing required execution and a concrete independently reviewable object
- **THEN** missing execution remains unknown while eligible independent work proceeds without signing missing evidence

## MODIFIED Requirements

### Requirement: Full-track closure is published by staged summary commit

The existing formal finalizer SHALL validate actual evidence and construct the final summary bytes, generate the evidence manifest using the staged summary hash at the canonical path, publish the receipt pointer and strict state, then atomically publish the canonical summary last. It SHALL recognize only a provable same-finalization partial transaction and finish its missing steps idempotently. Missing request/requirement binding, changed executed inputs, stale owner/fence or a closed-summary hash mismatch SHALL remain untrusted; current bytes MUST NOT be rebound as if they were executed. This producer transaction SHALL NOT create a closure author loop, default quota or synthetic native completion. No new journal or sidecar is introduced.

Enforcement: `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-state.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`

#### Scenario: Crash after manifest publication
- **WHEN** manifest publication succeeds but pointer, state or canonical summary publication is interrupted
- **THEN** the formal producer completes only the proven transaction's missing steps once, or leaves the result untrusted with the real current gap

#### Scenario: Closed summary bytes drift
- **WHEN** closed canonical summary bytes no longer match their manifest and no runner-owned equivalence proof exists
- **THEN** the producer refuses re-signing current bytes and returns the actual verification/repair gap
