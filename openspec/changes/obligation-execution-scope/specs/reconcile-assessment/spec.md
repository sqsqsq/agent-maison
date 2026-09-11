## ADDED Requirements

### Requirement: Assess observes the frozen execution scope

For a scoped Goal, assess SHALL observe executed/reused phases and unresolved duties from its validated birth scope. Current track/default goal end SHALL NOT expand or truncate it. Existing recommendations SHALL retain driver authorization and budget boundaries; sourced scope revision SHALL use revise_scope, distinguishable from successful completion or unknown blocking. next.json remains a disposable projection bound to the frozen scope.

Enforcement: `harness/scripts/utils/assess.ts`, `harness/schemas/assess.schema.json`, `harness/scripts/utils/goal-assess-driver.ts`, `harness/scripts/goal-phase-runtime.ts`.

#### Scenario: Current workflow changes after birth
- **WHEN** a run resumes after candidate/track/default order changes
- **THEN** assess SHALL retain the frozen phase range and reasons instead of demanding new out-of-scope summaries

#### Scenario: Unknown work is not successful completion
- **WHEN** existing phases are closed but a required later responsibility remains unresolved
- **THEN** assess SHALL return the remaining gap or a valid scope revision, not Feature completion
