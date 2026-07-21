# harness-gates Spec Delta

## ADDED Requirements

### Requirement: Integration scope consistency is machine-checked from contracts, not prose

contracts.yaml SHALL support a stable machine block `integration_points[]` with `consumer_module / provider_module / requires_modification / entry_symbol`. A plan-phase check `integration_scope_consistency` SHALL FAIL when an entry has `requires_modification: true` and the consumer module is not in scope; for `requires_modification: false` it SHALL verify the actual consumer binding exists (source-level consumption reference or route registration), not merely that an export/route name exists. In goal headless mode, a conservative `plan.scope_expansion` rejection that contradicts integration_points SHALL halt for a human decision instead of writing a self-contradictory plan.

Enforcement: `harness/scripts/check-coding.ts`/plan 阶段接线, `harness/scripts/utils/spec-loader.ts`（integration_points 归一）

#### Scenario: the WalletMain/Phone contradiction is caught at plan time

- **WHEN** integration_points declares WalletMain with `requires_modification: true` while plan scope excludes WalletMain
- **THEN** `integration_scope_consistency` SHALL FAIL the plan phase naming the contradiction, and coding SHALL NOT start on an island module

### Requirement: Host entry reachability is verified before review

A coding-phase check `host_entry_reachability` SHALL statically walk from host entries (route registries / declared integration entry points, with integration_points as the source of truth) to the feature's pages; an unregistered entry or missing route SHALL FAIL, so page isolation is caught before device testing.

Enforcement: `profiles/hmos-app/harness` coding 检查（新增）

#### Scenario: island pages fail before testing

- **WHEN** FinancialCard pages exist but no host route/entry references them
- **THEN** `host_entry_reachability` SHALL FAIL the coding phase naming the missing binding, instead of TC-001 discovering it on device

### Requirement: Test-case flow is a structured DAG consistent with the human-readable plan

test-plan.md SHALL carry a top-level `test_case_flow` YAML machine block keyed by tc_id with `precondition: { kind: fresh_app|after, tc|tcs, reset: restart|clear_data|fixture_reset }`; a gate SHALL verify the block and the Markdown TC table are exactly consistent (missing/extra/drifting ids → FAIL). `after` SHALL support multiple prerequisites and transitive blocking with reference validation (unknown TC, cycles, broken chains → derivation-time FAIL). When a prerequisite fails, dependent cases SHALL be recorded `BLOCKED_BY <tc>`; a failing reset command SHALL classify as environment failure (`BLOCKED_BY_ENV`), not a product root failure. BLOCKED_BY SHALL NOT count as PASS: blocked cases remain in the P0 denominator, still block feature completion, and `device_test_run` still FAILs; the only change is root-cause triage (root-fail / blocked-by / independent-fail).

Enforcement: `harness/scripts/utils/derived-hylyre-plan.ts`, `harness/scripts/check-testing.ts`（device_test_run 统计）

#### Scenario: one root failure no longer reads as seven independent defects

- **WHEN** TC-003 fails at its first step and TC-004…TC-008 declare `after: TC-003` directly or transitively
- **THEN** the report SHALL show TC-003 as root-fail and the rest as BLOCKED_BY TC-003, while the P0 pass rate and device_test_run verdict remain unchanged (still failing)

### Requirement: Structural fidelity splits static conformance from runtime mount conformance

Structural fidelity SHALL be computed as two axes and aggregated into the visual axis: `static_structure_conformance` (coding phase, current declaration-based scoring retained) and `runtime_mount_conformance` (testing/device phase, evidence = the runtime uitree mount tree; declared-but-unmounted structures score zero). Environments without devices (or generic profiles) SHALL surface runtime conformance as NOT_APPLICABLE rather than blocking or feigning coverage.

Enforcement: `profiles/hmos-app/harness/coding-visual-parity-check.ts`, testing 侧新检查（tasks 7.1）

#### Scenario: declared-but-unmounted structs stop scoring

- **WHEN** source declares the spec's struct set but the device uitree shows none of them mounted under the target page
- **THEN** `runtime_mount_conformance` SHALL score those structures zero and the visual axis SHALL reflect the mount failure, even though `static_structure_conformance` passed

### Requirement: The asset axis inherits upstream verdicts only with matching provenance

When a phase (e.g. testing) runs no asset checks of its own, the asset quality axis SHALL inherit the nearest upstream axis conclusion only as an evidence reference bound to: source summary hash, source fingerprint, build fingerprint, gate fingerprint, asset inventory hash, and debt-ledger revision. Any mismatch SHALL yield STALE/UNVERIFIED (needs_human) instead of copying the upstream PASS.

Enforcement: `harness/scripts/utils/quality-axes.ts`

#### Scenario: post-review source changes invalidate inherited asset PASS

- **WHEN** coding's asset axis passed, then testing-phase source/resource changes alter the build fingerprint
- **THEN** testing's asset axis SHALL be STALE/UNVERIFIED with the mismatch named, not an inherited PASS

### Requirement: Asset instance binding is verified end-to-end without business-specific fields

An asset-binding check SHALL verify the generic four-segment chain `ui-spec node.asset_ref → manifest asset key/resource path → source binding ($r consumption) → runtime node locator` for consistency, so distinct list instances reusing one asset are detectable. Business-domain fields (e.g. bank logo keys) SHALL NOT enter the framework contract; the bc-openCard multi-bank-same-logo shape is a fixture only.

Enforcement: `profiles/hmos-app/harness`（tasks 7.3）

#### Scenario: two list rows sharing one logo asset are flagged

- **WHEN** two distinct declared instances resolve to the same asset file while the spec declares distinct asset_refs
- **THEN** the binding check SHALL flag the collision naming both instances and the shared file
