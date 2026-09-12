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
