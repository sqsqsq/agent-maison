## MODIFIED Requirements

### Requirement: UT feature rules only govern the feature-owned target set

The UT harness SHALL resolve a target responsibility set from explicit user targets (`MAISON_UT_TARGETS`) plus one trusted pre-agent baseline. For a goal run, the baseline MUST come only from the validated `manifest.run_base_sha` birth contract shared with the UI scope gate; `HARNESS_DIFF_BASE_REF`, `trace.start_commit`, bare `HEAD` and a legacy coding-base file MUST NOT override or replace a new-schema goal baseline. For a non-goal manual harness, `HARNESS_DIFF_BASE_REF` remains a supported explicit baseline. Feature-scoped rules (MockKit policy, traceability tags, import whitelist, coverage gates) MUST consume only this target set. Legacy content that existed at the baseline MUST NOT be forced into the active feature's mock-plan, contracts, or AC tags. Without a trusted required baseline the harness SHALL fail closed to full scoped accountability.

#### Scenario: Untouched legacy MockKit test no longer blocks the feature
- **WHEN** a legacy test file that exists at the trusted baseline imports MockKit and is swept into scope by module discovery or context mention
- **THEN** `ut_hypium_mockkit_policy` MUST NOT require the active feature's mock-plan or contracts to register it
- **AND** the exemption MUST be disclosed with the baseline anchor in the check details

#### Scenario: New cases added inside a legacy file are still governed
- **WHEN** the active feature adds new `it()` cases or new mock usages (counted as a multiset, so re-mocking an already-mocked method counts) inside a baseline-existing file
- **THEN** those additions MUST be governed by tag and MockKit rules at case level
- **AND** baseline-existing cases and mock usages in the same file MUST remain exempt

#### Scenario: Committed new tests are not laundered into legacy
- **WHEN** new UT files are committed after goal-run birth
- **THEN** the goal harness MUST compare them against the persisted `manifest.run_base_sha` rather than current HEAD, `trace.start_commit` or `HARNESS_DIFF_BASE_REF`
- **AND** it MUST include them in the target responsibility set

#### Scenario: Non-goal manual harness keeps its explicit env baseline
- **WHEN** UT is run manually outside goal orchestration with a valid `HARNESS_DIFF_BASE_REF`
- **THEN** the harness SHALL retain the existing env-baseline behavior

> **Enforced by:** `harness/scripts/utils/ut-target-resolver.ts`, `harness/scripts/utils/goal-run-baseline.ts`, `harness/scripts/check-ut.ts`, `harness/scripts/utils/ut-artifact-parse.ts`

## ADDED Requirements

### Requirement: Goal UI and UT gates share one baseline resolver

UI scope and UT target gates in a goal run SHALL consume the same `resolveGoalRunBaseline` result from `manifest.run_base_sha`. A new-schema run is identified by `run_created`; when that event exists, a missing or invalid manifest baseline required by the chain MUST fail and MUST NOT fall back to `coding-base.json`. Only a run without `run_created` and with both a valid authoritative legacy `run_start` and valid legacy anchor MAY use the legacy reader. Goal env construction SHALL remove inherited `HARNESS_DIFF_BASE_REF` and warn once; non-goal harness behavior remains unchanged.

Enforcement: `harness/scripts/utils/goal-run-baseline.ts`, `harness/scripts/utils/ui-scope-gate.ts`, `harness/scripts/utils/ut-target-resolver.ts`, `harness/scripts/utils/phase-env.ts`

#### Scenario: New run cannot fall back after base deletion

- **WHEN** a run has `run_created`, its required `manifest.run_base_sha` is deleted, and a valid-looking `coding-base.json` is present
- **THEN** both goal gates MUST fail the runtime-owned baseline contract and MUST NOT consult the legacy file

#### Scenario: Goal env baseline is ignored and scrubbed

- **WHEN** a goal run inherits `HARNESS_DIFF_BASE_REF`
- **THEN** baseline resolution SHALL still use the manifest, child gate env SHALL omit the variable, and startup SHALL emit at most one warning

### Requirement: Runtime-owned baseline failures are not agent repair work

Missing or corrupt `run_created`, invalid required `run_base_sha`, legacy-era ambiguity and goal diff unavailability caused by baseline resolution SHALL use the existing goal failure classifier and MUST be classified non-`agent_fixable`. They MUST NOT be returned to the content agent as a retry task or registered in a parallel taxonomy.

Enforcement: `harness/scripts/utils/goal-failure-classifier.ts`, `harness/scripts/utils/goal-run-baseline.ts`, `harness/scripts/goal-runner.ts`

#### Scenario: Missing birth fact halts outside the content loop

- **WHEN** a goal gate cannot obtain its required baseline because `run_created` or `run_base_sha` is missing/corrupt
- **THEN** the blocker SHALL be runtime-owned and non-`agent_fixable`, with no content retry consuming an agent attempt
