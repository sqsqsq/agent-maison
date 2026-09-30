## ADDED Requirements

### Requirement: The second classification registers four ledger exploration checks

The disposition table SHALL register as `ledger_shape` (disclosed): `context_exploration_files_inspected_min`, `context_exploration_decisions_unlocked`, `context_exploration_facts_phase_delta_missing` and `context_exploration_facts_phase_delta_empty`. Each check SHALL keep producing its raw failure; the failure SHALL be listed in `disclosed_failures` and counted as a completion gap instead of failing the phase. The checks that verify readable sources, Code Facts rows, identity, baseline freshness and target coverage SHALL stay blocking. `context_exploration_mode_allowed`, `context_exploration_mode_required`, `context_exploration_subagent_required` and `context_exploration_inputs_coverage` SHALL stay unregistered and blocking. The request entry SHALL still fail on any failure, and the violation hook SHALL still receive the raw failure.

Enforcement: `harness/scripts/utils/check-disposition.ts`

#### Scenario: A low self-reported file count no longer stops a review

- **WHEN** a review is the first actual establishing phase and its only failure is `context_exploration_files_inspected_min`
- **THEN** the review SHALL exit zero with `verdict=PASS`, keep the raw failure in the script report, and list it in `disclosed_failures`

#### Scenario: A missing phase delta no longer stops a non-establishing phase

- **WHEN** a plan run on a chain whose facts were established by spec has every material in place except its `## phase_delta: plan` section
- **THEN** the plan SHALL pass with `context_exploration_facts_phase_delta_missing` in `disclosed_failures`, and the chain SHALL advance past plan
