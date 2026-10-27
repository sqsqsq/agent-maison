## ADDED Requirements

### Requirement: Current required work consumes complete acceptance evidence

Before allocating a content-author invocation, the runner SHALL use the existing current-disposition input assembler to provide the same related current acceptance evidence that the original verifier material producer will use. If an old finding's verified material does not cover that evidence, or coverage cannot be established, the finding SHALL use the existing verification-required path. The assembler MUST remain read-only and MUST NOT issue verifier requests or decide semantic acceptance itself.

#### Scenario: Frozen acceptance evidence resolves an old planning concern

- **WHEN** a confirmed planning finding has not reviewed current frozen UT results, relevant assertions, production call relationships and unchanged bound source/test inputs
- **THEN** the runner sends that complete evidence to the original verifier before assigning an author; a test name or standalone PASS is insufficient to close the finding

#### Scenario: Real contract or evidence changes still require work

- **WHEN** related acceptance, a public contract, production behavior, assertions or execution conditions change, or frozen bindings expire
- **THEN** the existing owner and affected verification paths execute; documentation wording or an old PASS does not exempt the new obligation

### Requirement: Current task delivery and closure share one disposition

The runner, harness next steps, author prompts, diagnosis, receipt advancement and closure SHALL consume one complete current disposition. Required same-phase tasks SHALL include the problem, legal owner/object, permissions, source evidence and revalidation condition. Raw PASS, a valid old receipt or closed status MUST NOT hide current required work. Advisory MAJOR findings MUST NOT automatically become required. Verification-only work SHALL go to the original verifier and cross-owner work SHALL use existing legal handoff paths.

#### Scenario: Original total PASS still has required same-phase work

- **WHEN** a spec or plan report retains total PASS but the current independently verified disposition contains a required task owned by that phase
- **THEN** the actual author input and public next step deliver the task, and closure waits for the legal repair and original verification

#### Scenario: Closure placeholder coexists with a concrete task

- **WHEN** an unclosed placeholder and a concrete required task both exist
- **THEN** the task remains visible and executable before receipt completion; the in-progress finalization transaction does not require its own already-published proof
