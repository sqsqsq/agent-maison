## ADDED Requirements

### Requirement: CU-bound use-case and DAG obligations are mechanically derived

For a CU-bound Feature, the framework SHALL derive `use_cases_required` from canonical CU/blueprint refs, acceptance facts, and `contracts.state_management`; an authored boolean MUST NOT waive the obligation. `use-cases.yaml` is required when any authoritative fact shows two or more ordered user/system/external steps, a failure/retry/recovery/compensation branch, shared state with two or more consumers, or lifecycle/background/scheduled/external behavior requiring recreation, recovery, or freshness reconciliation.

The framework SHALL derive `dag_required` independently for `ut_layer ∈ {unit, both}` targets. An ephemeral flow DAG is required when such a target crosses two or more ordered implementation/boundary steps, contains a branch/recovery/compensation path, or propagates runtime state to multiple consumers. When both obligations hold, the DAG MUST link the applicable use-case and branch IDs. Required-but-missing use-case/DAG evidence MUST be a BLOCKER for CU-bound construction; a simple single-step path with no branch, shared consumers, or lifecycle recovery MAY continue to use direct UT tags or AC coverage. Neither use-cases nor DAGs may redefine runtime facts from `contracts.state_management`.

#### Scenario: Ordered recovery flow requires both artifacts

- **WHEN** a unit/both target contains ordered implementation steps and a background recovery branch
- **THEN** `use-cases.yaml` and an ephemeral DAG linked to the recovery branch are both required, regardless of any authored opt-out

#### Scenario: Shared state consumers require flow modeling

- **WHEN** `contracts.state_management` shows one state owner feeding two consumers
- **THEN** `use-cases.yaml` is required, and a unit/both propagation target also requires a DAG covering both consumers

#### Scenario: Acceptance-only ordered unit path requires a DAG

- **WHEN** a unit/both acceptance target has two or more ordered verification steps even though runtime facts alone are simple
- **THEN** `use-cases.yaml` and an ephemeral DAG are both required; runtime-only complexity calculation cannot waive the DAG

#### Scenario: Simple unit path may use direct coverage

- **WHEN** a unit/both target is one implementation step with no branch, shared consumers, or lifecycle recovery
- **THEN** the CU-bound Feature may omit use-cases and DAG and satisfy existing coverage rules through UT tags or AC coverage

> **Enforced by (P2 implementation):** `specs/artifact-schemas/use-cases.schema.yaml`, `harness/scripts/utils/types.ts`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/check-plan.ts`, `harness/scripts/check-ut.ts`, `skills/feature/business-ut/SKILL.md`
