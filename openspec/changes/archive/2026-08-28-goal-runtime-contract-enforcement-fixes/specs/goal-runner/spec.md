## ADDED Requirements

### Requirement: Goal birth freezes the normalized actual phase chain

Every modern fresh goal run SHALL persist its normalized actual phase chain in the existing manifest and bind the same ordered chain in its single `run_created` event. Modern resume and attach MUST validate those two birth facts and execute only that frozen chain; they MUST NOT re-resolve workflow configuration, track defaults or phase order. An explicitly era-isolated legacy run MAY use the existing guarded compatibility resolver.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/goal-mode-entry.ts`

#### Scenario: Workflow changes while a run is halted

- **WHEN** a modern run halts and workflow configuration is changed before resume
- **THEN** resume executes the exact ordered chain recorded at birth and does not add, remove or reorder phases

#### Scenario: Resume cannot introduce a baseline-requiring phase

- **WHEN** a modern run was born with a spec/plan-only chain and workflow configuration later adds coding
- **THEN** resume retains the birth chain and MUST NOT introduce coding or synthesize a baseline

### Requirement: Shared baseline resolution enforces birth presence and value

For a modern run, the creation validator and every shared baseline resolution path MUST compare both the presence and value of `run_base_sha` between the manifest and the single `run_created` birth fact. Missing-to-present, present-to-missing and present-to-different transitions MUST fail closed before any manifest baseline is returned to a gate. Startup drift authorization MUST NOT substitute for this shared validation.

Enforcement: `harness/scripts/utils/goal-run-creation.ts`, `harness/scripts/utils/goal-run-baseline.ts`, `harness/scripts/utils/goal-manifest.ts`

#### Scenario: Baseline is injected after a baseline-free birth

- **WHEN** a modern run's `run_created` omitted `run_base_sha` and the stopped manifest is later edited to add one
- **THEN** the shared baseline resolver rejects the run and MUST NOT return the injected SHA as trusted baseline

#### Scenario: Birth baseline is deleted or changed

- **WHEN** a modern run's birth fact contains a baseline and the manifest deletes it or changes its value
- **THEN** the shared creation/baseline validation rejects the run for birth-contract inconsistency
