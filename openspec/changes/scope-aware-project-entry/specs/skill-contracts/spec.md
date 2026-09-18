## ADDED Requirements

### Requirement: Explicit requests use the existing input and checker boundaries

The harness SHALL accept paired request-file/report-dir for review, ut and testing before Feature validation. Preparation SHALL resolve targets and baseline refs and return request_sha256, inputs, gaps and report paths without executing checkers or writing state. Request CheckContext MUST contain an explicit request subject and MUST NOT fabricate feature or FeatureSpec. Professional checks and providers SHALL remain at existing phase/profile boundaries.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/capability-resolution-entry-input.ts`, `harness/scripts/utils/types.ts`, `harness/scripts/check-review.ts`, `harness/scripts/check-ut.ts`, `harness/scripts/check-testing.ts`.

#### Scenario: Review request has no Feature
- **WHEN** a caller prepares and runs a review request with real source targets and a report
- **THEN** the same review checker SHALL validate its content while no Feature identity or completion is created

#### Scenario: Tests lack a suitable provider
- **WHEN** the installed provider cannot execute the request subject
- **THEN** the existing checker SHALL report a blocking capability gap rather than inventing a passing execution

### Requirement: Project actions reuse scoped native inputs

Project Skills and global phases SHALL consume the selected module, term, document or existing design context through their existing parsers and validators. A module Graph MAY use an explicit source package without optional catalog; an unreadable configured source MUST remain a gap. Generation and checking SHALL use the same module path and preserve existing curation. Native non-phase actions MUST NOT require a fabricated Feature or universal executor.

#### Scenario: Independent knowledge update
- **WHEN** a caller selects one module, term or document
- **THEN** checks SHALL apply to that selection, preserve unrelated knowledge and retain cross-reference validation involving the selected entries

#### Scenario: Graph without optional catalog
- **WHEN** a real module source directory is explicitly selected without catalog
- **THEN** generation and checking SHALL work with that directory without creating catalog or starting testing

### Requirement: Entry routing answers scope and acceptance semantics

The root entry SHALL route a request by answering two questions in order: what this round changes (scope) and by which standard it is judged correct (acceptance semantics). "Implementation unchanged" answers only the first and MUST NOT excuse the second. Before classifying, the agent SHALL consult existing basis (acceptance, blueprint, module catalog, constraint knowledge) and reuse what it finds; only a new or changed expectation SHALL enter design responsibility. The agent SHALL ask the user only about a semantic gap that survives that lookup, and SHALL NOT create a blueprint merely because tests are being added.

Enforcement: `templates/AGENTS.md.template`, `docs/operations/project-entry.md`, `harness/tests/unit/framework-init-entry-contract.unit.test.ts`.

#### Scenario: Test-only request still needs an acceptance basis
- **WHEN** a user asks only to add tests and explicitly keeps the implementation unchanged
- **THEN** the entry SHALL still require the acceptance-semantics question to be answered from existing basis before assertions are written, instead of treating the request as informal maintenance that needs no judgement

#### Scenario: Existing basis is reused rather than rebuilt
- **WHEN** the requested expectation is already recorded in existing acceptance, blueprint or constraint knowledge
- **THEN** the entry SHALL reuse that basis with an explicit reference and SHALL NOT require a new blueprint
