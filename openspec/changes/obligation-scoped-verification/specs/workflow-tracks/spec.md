## ADDED Requirements

### Requirement: Verification layers govern performance and zero-device reconciliation

Performance SHALL use the existing unit/device/both classification and explicit proof focus. Missing or invalid classification MUST remain unknown. A valid frozen scope with no testing obligation SHALL permit reconcile-only without trace, reports or device actions. UT device infrastructure MUST NOT itself introduce a testing obligation. Existing R8 pure-unit plan rejection SHALL remain before device execution.

Enforcement: `harness/scripts/utils/acceptance-layering.ts`, `harness/scripts/utils/check-acceptance.ts`, `harness/scripts/utils/execution-scope.ts`, `harness/harness-runner.ts`, `harness/scripts/check-testing.ts`.

#### Scenario: Unit-only acceptance and benchmark
- **WHEN** valid acceptance and impact evidence establish only unit obligations, including a unit performance proof
- **THEN** the scope SHALL omit testing and reconcile-only SHALL not request trace or write placeholder reports

#### Scenario: Unknown or device performance
- **WHEN** a performance proof requires a device or its verification layer is not known
- **THEN** testing SHALL remain required or unresolved respectively
