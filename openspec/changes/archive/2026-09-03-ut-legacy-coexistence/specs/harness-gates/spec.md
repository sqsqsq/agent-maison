## ADDED Requirements

### Requirement: UT feature rules only govern the feature-owned target set

The UT harness SHALL resolve a target responsibility set from a trusted pre-agent baseline anchor (`HARNESS_DIFF_BASE_REF`, or the goal run's `coding_base_sha`) plus explicit user targets (`MAISON_UT_TARGETS`). Feature-scoped rules (MockKit policy, traceability tags, import whitelist, coverage gates) MUST consume only this target set. Legacy content that existed at the baseline MUST NOT be forced into the active feature's mock-plan, contracts, or AC tags. `trace.start_commit` and bare `HEAD` MUST NOT be used as baseline anchors because they are recorded after the agent may have acted; without a trusted anchor the harness SHALL fail closed to full scoped accountability.

#### Scenario: Untouched legacy MockKit test no longer blocks the feature
- **WHEN** a legacy test file that exists at the trusted baseline imports MockKit and is swept into scope by module discovery or context mention
- **THEN** `ut_hypium_mockkit_policy` MUST NOT require the active feature's mock-plan or contracts to register it
- **AND** the exemption MUST be disclosed with the baseline anchor in the check details

#### Scenario: New cases added inside a legacy file are still governed
- **WHEN** the active feature adds new `it()` cases or new mock usages (counted as a multiset, so re-mocking an already-mocked method counts) inside a baseline-existing file
- **THEN** those additions MUST be governed by tag and MockKit rules at case level
- **AND** baseline-existing cases and mock usages in the same file MUST remain exempt

#### Scenario: Committed new tests are not laundered into legacy
- **WHEN** new UT files are committed before the first ut harness run and no trusted pre-agent anchor is available
- **THEN** the harness MUST NOT treat the commit-time HEAD or trace.start_commit as a baseline
- **AND** it MUST fall back to full scoped accountability with a diagnostic explaining how to provide an anchor

> **Enforced by:** `harness/scripts/utils/ut-target-resolver.ts`, `harness/scripts/check-ut.ts`, `harness/scripts/utils/ut-artifact-parse.ts`

### Requirement: Simulated diagnostics never outrank the real toolchain

When the profile provides a real compile capability, the simulated TypeScript check (`ut_tsc_compiles`) SHALL report errors as WARN-level diagnostics and the only compile BLOCKER SHALL be the real toolchain compile gate. Statically unresolvable mock usages SHALL be reported as WARN, never as proven violations. Only when the profile declares the real compile capability as SKIP may the simulated check remain a FAIL-level gate.

#### Scenario: Legacy file fails simulated tsc but compiles for real
- **WHEN** a baseline-existing test file produces a TypeScript error under the simulated check while the real toolchain compiles the same module successfully
- **THEN** `ut_tsc_compiles` MUST be WARN with guidance not to modify legacy code for it
- **AND** the UT run MUST NOT be blocked by the simulated result

> **Enforced by:** `profiles/hmos-app/harness/ut-host-impl.ts`, `harness/scripts/check-ut.ts`

### Requirement: Suite failure ratchet uses an authorized baseline only

The UT execution gate SHALL exempt only non-target failures listed in an authorized suite failure baseline (placed by the user or sampled by orchestration before the agent acts). The current run MUST NOT create or grow the baseline; it MAY only shrink it when listed failures no longer occur. Target-case failures MUST never be exempted. Case-level failures MUST NOT short-circuit remaining selected modules, exemption MUST be decided before interpreting a non-zero test exit code, and a PASS verdict REQUIRES real execution results from every selected module. Feature verdict and suite health SHALL be reported as separate conclusions.

#### Scenario: No baseline means no exemption
- **WHEN** real execution reports failures and no authorized baseline file exists
- **THEN** all failures MUST be counted against the run (suite_health=UNKNOWN)
- **AND** the details MUST explain the two legitimate ways to establish a baseline

#### Scenario: Historic failure exempted, new regression still fails
- **WHEN** an authorized baseline lists a legacy failure and the current run reproduces it alongside one new non-target failure
- **THEN** the listed failure MUST be exempted and reported as suite_health=DEGRADED
- **AND** the new failure MUST fail the gate

> **Enforced by:** `harness/scripts/utils/ut-suite-baseline.ts`, `profiles/hmos-app/harness/ut-host-impl.ts`

### Requirement: Destructive device remediation requires user confirmation

When installation is rejected due to a version downgrade, the UT gate SHALL classify it as needing user confirmation, with a data-loss warning, and MUST NOT advise raising `app.versionCode`, uninstalling automatically, or setting uninstall environment variables from the UT chain (which has no uninstall executor). The shared low-level install diagnosis MUST stay scenario-neutral because the testing chain owns a controlled uninstall-retry channel.

#### Scenario: Runtime downgrade maps to confirmation, not toolchain
- **WHEN** preflight misses the downgrade and the real `hdc install` fails with a downgrade error
- **THEN** the failure MUST be classified `install_needs_confirmation`/`needsConfirmation` rather than a generic install/toolchain failure
- **AND** the suggestion MUST hand the decision to the user while preserving the fact that compilation passed

> **Enforced by:** `profiles/hmos-app/harness/device-install-diag.ts`, `profiles/hmos-app/harness/ut-hvigor-test-failure.ts`, `profiles/hmos-app/harness/hdc-runner.ts`
