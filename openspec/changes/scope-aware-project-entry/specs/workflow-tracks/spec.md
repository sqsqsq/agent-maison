## ADDED Requirements

### Requirement: Request completion is isolated from Feature completion

Request runs SHALL use the active workflow checker and an explicit report directory inside the host. They MUST reject Feature/Goal CLI identities, ignore ambient Feature/Goal identities, protect framework/.git/features paths and refuse other requests' machine output directories. Reports SHALL bind normalized request, resolved refs and input content; source changes SHALL invalidate old facts. Failure or unresolved applicable checks MUST NOT return success.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/report-generator.ts`, `harness/scripts/utils/capability-resolution-entry-input.ts`.

#### Scenario: Active Feature state exists
- **WHEN** a request runs while Feature/Goal environment variables and existing Feature evidence are present
- **THEN** it SHALL use only the request report directory and leave Feature evidence unchanged

#### Scenario: Target changed after preparation
- **WHEN** a bound source or resolved baseline changes before execution
- **THEN** existing facts SHALL no longer satisfy the request binding and the caller SHALL prepare again

### Requirement: User entry preserves the authorized endpoint

The main agent SHALL interpret natural language and explicit Skill requests using existing formality and authorization rules. Global phases SHALL use request obligations through the existing scope resolver and native reports. Independent actions MUST stop at their requested result. Full design SHALL stop at CU readiness; an outer coordinator MAY continue already authorized full implementation through a real attended Goal. Continue SHALL restore the existing run and frozen scope. New tasks MUST NOT ask for feature.track or lite/full selection; existing run compatibility remains until migration.

#### Scenario: Design versus full implementation
- **WHEN** the same design reaches readiness under a design-only request or an authorized full implementation request
- **THEN** the design Skill SHALL return its result in both cases; only the outer coordinator of the full implementation request SHALL continue construction

#### Scenario: Adapter entry and initialization
- **WHEN** any supported adapter renders the shared entry or init completes an UPDATE
- **THEN** it SHALL preserve request boundaries and SHALL NOT treat optional next steps as authorization for additional work
