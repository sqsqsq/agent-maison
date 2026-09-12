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
