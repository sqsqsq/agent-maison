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
