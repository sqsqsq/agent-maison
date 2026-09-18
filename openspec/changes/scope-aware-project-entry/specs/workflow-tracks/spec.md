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

### Requirement: Compilation and test verification run through the framework executor

Any verification that needs to compile or run tests SHALL be executed through the framework executor (a standalone request CLI or a phase entry) and MUST NOT invoke hvigor or host-owned scripts directly, because the executor derives the toolchain environment from `framework.local.json`. Failure diagnosis SHALL read the resolved toolchain values recorded by the same build and its build log before attributing the failure; values re-resolved afterwards SHALL be labelled as current values. When an external blocker is real, the report SHALL state precisely which steps were not executed.

Enforcement: `templates/AGENTS.md.template`, `skills/feature/coding/SKILL.md`, `skills/feature/business-ut/SKILL.md`, `docs/operations/request-harness.md`, `profiles/hmos-app/harness/hvigor-runner.ts`.

#### Scenario: Toolchain environment is derived, not required from the shell
- **WHEN** the project registers only the DevEco install path and the shell has no `DEVECO_SDK_HOME`
- **THEN** the executor SHALL derive that variable for its child process, and an agent MUST NOT attribute a direct-invocation failure to the machine environment

#### Scenario: Informal code maintenance without a Feature has no compile-only entry
- **WHEN** informal maintenance changes product code with no Feature contract available and no test carrier in the target module
- **THEN** the agent SHALL report that the framework currently offers no immediate compile-only verification and SHALL NOT redirect the user to host-owned scripts

#### Scenario: A Feature coding phase keeps its existing compile exit
- **WHEN** the change runs inside a Feature coding phase with resolvable contract modules
- **THEN** the existing compile capability SHALL still be executed to a real result, and the missing compile-only entry MUST NOT be reported as a blocker for that phase

### Requirement: Single-duty phases stop at the request endpoint

A spec, plan or coding request that names one phase SHALL resolve to a single-phase chain with `completion_target: request` through the existing scope resolver, SHALL stop at that request endpoint, and MUST NOT claim Feature completion or append later phases. The spec and plan skills SHALL state that boundary alongside the coding skill. No Feature-less request CLI is added for these phases.

Enforcement: `skills/feature/spec/SKILL.md`, `skills/feature/plan/SKILL.md`, `skills/feature/coding/SKILL.md`, `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/utils/feature-track.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/tests/unit/execution-scope.unit.test.ts`.

#### Scenario: Single-phase request through the production candidate entry
- **WHEN** a candidate is generated with `--prepare-scope --completion-target request` naming exactly one phase
- **THEN** the frozen scope SHALL contain that phase alone, only that phase SHALL be dispatched, and no out-of-scope phase report SHALL be created

#### Scenario: Request endpoint does not become Feature completion
- **WHEN** such a request finishes its phase
- **THEN** no Feature completion artifact SHALL be produced, and an unresolved definition gap SHALL keep the run waiting instead of being reported as success

#### Scenario: A single-duty phase closes its own definition gap and reaches the existing slice terminal
- **WHEN** the requested phase produces validated design content (acceptance for spec, a construction contract naming a verifiable write set for plan) and its phase checks pass
- **THEN** the existing design-fact revision SHALL apply to a `request` target as well, the effective scope SHALL carry no unresolved entry, and the run SHALL end at the existing chain-slice terminal without producing Feature completion

#### Scenario: A request revision cannot widen the request
- **WHEN** a revision proposal for a `request` target names any phase outside the chain that was frozen at birth
- **THEN** the revision SHALL be rejected; a proposal naming only the requested phase SHALL still be accepted after the effective chain has already shrunk, because the authorization boundary is the frozen chain and not the current effective one

#### Scenario: An interrupted single-duty request keeps its completed phase on resume
- **WHEN** the revision has been recorded but the run is interrupted before its terminal event, and the run is resumed while the effective chain is empty
- **THEN** recovery SHALL still recognize the completed phase from the authoritative events, SHALL NOT dispatch it again, and SHALL reach the same chain-slice terminal without producing Feature completion
