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
