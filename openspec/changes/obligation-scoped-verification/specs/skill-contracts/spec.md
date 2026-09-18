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

### Requirement: Request preparation surfaces landing and capability gaps

The standalone request preparation stage SHALL surface landing and capability gaps before any test is written, using the same predicates the executor uses. The preparation stage SHALL report when the active profile disables the phase, when the required capability is declared SKIP, when a target does not belong to exactly one configured `src/ohosTest/` module, and when the owning module has no test carrier (`src/ohosTest/module.json5`). Carrier judgement SHALL use those existing facts and MUST NOT use the root build profile target list. Preparation SHALL share only module ownership and carrier presence with the executor; source content and declaration-count validation remain at execution time, because an authorized test file may not exist yet. A provider that does not export the read-only probe SHALL keep its current behaviour and produce no such gap.

Enforcement: `harness/scripts/utils/request-phase.ts`, `harness/capability-registry.ts`, `profiles/hmos-app/harness/providers/ut-run.ts`, `harness/tests/unit/request-entry.unit.test.ts`, `harness/tests/unit/obligation-scoped-verification.unit.test.ts`.

#### Scenario: Target lands outside the executable directory
- **WHEN** a UT request names a test file outside any configured module's `src/ohosTest/`
- **THEN** preparation SHALL report that landing gap with the legal landing point, instead of failing only once execution starts

#### Scenario: Module has no test carrier
- **WHEN** the owning module has no `src/ohosTest/module.json5`
- **THEN** preparation SHALL report a profile capability gap and the agent SHALL stop there, without redirecting to another directory or substituting another module's passing tests

#### Scenario: Phase or capability disabled by the profile
- **WHEN** the active profile disables the phase or declares the required capability SKIP
- **THEN** preparation SHALL report both sources truthfully as not enabled, preserving today's execution behaviour

#### Scenario: Creating a test carrier is out of scope for a test-only request
- **WHEN** running the requested tests would require adding `src/ohosTest/` or changing the module build configuration
- **THEN** the skill guidance SHALL require the agent to explain that change and obtain the user's agreement before making it, using the existing out-of-scope-change convention rather than a new confirmation gate

### Requirement: New assertions register their expected-result provenance

A standalone UT request SHALL report, per assertion, whether it carries a registered expected-result source or is explicitly marked as characterization, and SHALL present those classes separately instead of folding recorded behaviour into a correctness conclusion. Registration SHALL live on each assertion itself — a traceability tag in its name, or a line comment immediately above its declaration — and MUST NOT be inherited from a suite header or file header. The machine SHALL only verify that a registration exists and that a referenced source is a readable file inside the project; judging whether that entry authorizes the expectation remains the agent's documented obligation. An explicitly marked characterization assertion is a legitimate request and MUST NOT fail the check; only an authorized new assertion with neither a source nor a characterization mark is blocking. Because providers return aggregate results only, the check SHALL report registration counts and MUST NOT attribute passes per class.

Enforcement: `harness/scripts/utils/ut-it-blocks.ts`, `harness/scripts/utils/request-phase.ts`, `skills/feature/business-ut/SKILL.md`, `harness/tests/unit/request-entry.unit.test.ts`.

#### Scenario: Recorded behaviour is presented as such
- **WHEN** every authorized new assertion is explicitly marked as characterization
- **THEN** the request SHALL pass and the result SHALL present those assertions as recorded behaviour rather than as verified expectations

#### Scenario: Unregistered new assertion is blocking
- **WHEN** an assertion written under this request's write authorization carries neither an expected-result source nor a characterization mark
- **THEN** the check SHALL fail, name the assertion, and offer only two ways out: register a source or mark it as characterization

#### Scenario: Registration is per assertion
- **WHEN** a suite header or file header carries the only annotation
- **THEN** assertions below it SHALL remain unregistered, because registration is never inherited

#### Scenario: Declaration counts are reconciled with the executor
- **WHEN** the recognized declaration count differs from the executor's own extractor, or the recognized total differs from the provider's executed total
- **THEN** the authorized side SHALL fail with the difference stated, while a read-only historical target SHALL only warn

#### Scenario: Registration counts are not pass counts
- **WHEN** execution failed, did not happen, or covered a different number of cases
- **THEN** the check SHALL still report registration counts, SHALL state that they are not pass counts, and the execution verdict SHALL remain with the existing execution check

#### Scenario: An ambiguous comment boundary is never silently classified
- **WHEN** a line closes a block comment before the point where its declaration begins
- **THEN** that line SHALL be reported as unclassifiable rather than parsed, so a faked declaration and a missed real one cannot cancel each other out in the counts; a block comment that appears only inside the declaration's own callback SHALL NOT make the declaration unclassifiable

#### Scenario: A block comment neither annotates nor hides a declaration
- **WHEN** a block comment holds a declaration-shaped line or a characterization marker directly above a real declaration, or a real declaration's name is not on its declaration line
- **THEN** the commented content SHALL register and hide nothing, a declaration whose name cannot be read SHALL be reported as unclassifiable instead of being dropped, and the reconciliation SHALL still surface the difference

#### Scenario: An unverifiable source reference follows write authorization
- **WHEN** a registered source path does not resolve to a readable file inside the project
- **THEN** it SHALL be blocking for a file this request authorized for writing, and SHALL only be presented as a warning for a read-only historical target
