## ADDED Requirements

### Requirement: Verification consumes scoped inputs and native request targets

UT and testing SHALL consume resolved acceptance/contracts and explicit targets through the existing checker and profile boundary. Request runs MUST use their explicit report directory without Feature identity. Required coverage, real toolchain results, mock/testability rules and native evidence MUST remain enforced.

Enforcement: `skills/feature/business-ut/contract.yaml`, `skills/feature/device-testing/contract.yaml`, `harness/scripts/check-ut.ts`, `harness/scripts/check-testing.ts`, `profiles/hmos-app/harness/providers/ut-run.ts`, `profiles/hmos-app/harness/providers/device-test-run.ts`.

#### Scenario: Standalone existing unit tests
- **WHEN** an authorized request selects existing unit tests
- **THEN** the native provider SHALL execute the selected tests and report only request completion without inventing acceptance or mock plans

#### Scenario: Missing execution evidence
- **WHEN** the environment is unavailable or a case is manual, failed or lacks valid machine evidence
- **THEN** the request MUST NOT claim PASS or change its obligation to not applicable

#### Scenario: Declared expected result requires its own verification
- **WHEN** native action assertions pass but the case declares an additional expected result
- **THEN** the request MUST verify that expected result through the existing native assertion path before claiming case success

#### Scenario: Pure dependencies do not require a mock plan
- **WHEN** a valid audit establishes that no test double is needed
- **THEN** mock-plan presence, parsing, typing and contract checks SHALL share that applicability in the final summary, while invalid existing files still fail validation
