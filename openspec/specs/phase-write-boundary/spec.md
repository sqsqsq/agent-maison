# phase-write-boundary Specification

## Purpose
TBD - created by archiving change autonomous-recovery-without-human-gates. Update Purpose after archive.
## Requirements
### Requirement: Phase write ownership is derived from existing workflow contracts and scope resolvers

For every controlled phase invocation, the harness SHALL derive the writable artifact and source domains from the resolved workflow chain, `loadFeatureContracts`/`phaseContractIndex`, contract `produces`, the artifact registry and phase-evidence resolver, coding plan/module scope, the active profile's UT test-root resolver, and the existing testing protected-source resolver. The workflow SHALL provide phase membership/order only and MUST NOT be treated as a path-owner table. A new path SHALL be writable only when it uniquely matches the current phase's existing producer/resolver; no match or multiple owners SHALL fail closed. Custom phases without a registered artifact producer and, for source output, an existing profile/scope resolver SHALL be read-only.

Enforcement: `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/check-coding.ts`, `profiles/*/harness/*ut-host*.ts`, `harness/scripts/utils/testing-write-boundary.ts`

#### Scenario: a custom phase cannot claim the whole source tree

- **WHEN** a custom workflow phase declares a source-like output but no existing profile or scope resolver can identify its source paths
- **THEN** the phase SHALL receive no source write permission and contract validation SHALL fail closed without creating an owner manifest

#### Scenario: a new coding file is owned by the coding scope

- **WHEN** coding creates a new file under an `in_scope_modules` module package path and no other producer matches it
- **THEN** the resolver SHALL classify the file as coding-owned and SHALL NOT report a write violation

### Requirement: Invocation attribution excludes pre-existing and runner-owned writes

The runner SHALL snapshot normalized paths and content hashes immediately before and after the agent process boundary and attribute only the delta introduced by that invocation. Pre-existing dirty files SHALL not be blamed on the phase. Runner-authored events, summaries, manifests, pointers, phase state, and evidence refreshes SHALL occur outside the agent boundary and SHALL be tagged/handled as runner-owned facts. Paths with multiple roles SHALL be deduplicated by normalized path while preserving the role set in diagnostics. No persistent pass snapshot or off-repository attribution state SHALL be introduced.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/diff-scope.ts`, `harness/scripts/utils/testing-write-boundary.ts`

#### Scenario: a dirty acceptance file is unchanged by plan

- **WHEN** `acceptance.yaml` is dirty before the plan invocation and its content hash is unchanged afterwards
- **THEN** the plan invocation SHALL NOT be attributed that change and SHALL NOT emit a phase write violation for it

#### Scenario: runner finalization does not implicate the agent

- **WHEN** the runner publishes a summary, evidence manifest, pointer, and phase state after the agent exits
- **THEN** those mutations SHALL be excluded from the invocation delta and attributed to the runner

### Requirement: A downstream write invalidates trust and backtracks to the owner

When an invocation changes a path owned by an earlier phase or a protected source domain, the runner SHALL record `phase_write_violation` with current phase, normalized path, pre/post hashes, and resolved owner; invalidate the current invocation evidence plus the owner closure and all downstream closures; preserve the workspace bytes as untrusted; and execute the existing `backtrack_to_phase` transaction to the owner for complete machine re-verification and any necessary rewrite. The first stable violation MUST NOT permanently halt, accept/rebind the bytes, request a human waiver, or destructively restore them. Repeated identical violations, continuing content changes, unreadable bytes, absent owner targets, or exhausted existing budgets SHALL use the existing integrity/external/fuse terminal semantics.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/adjudication.ts`, `harness/scripts/utils/goal-assess-driver.ts`

#### Scenario: plan writes spec acceptance

- **WHEN** a plan invocation changes the spec-owned `acceptance.yaml`
- **THEN** the runner SHALL invalidate the plan invocation and prior spec/downstream closure trust, retain the bytes, and automatically backtrack to spec for full revalidation without a first-touch HALT

#### Scenario: repeated unstable writes trip the existing fuse

- **WHEN** the same owner/path violation recurs with the same recovery fingerprint or the bytes continue changing during recovery
- **THEN** the existing convergence/integrity budget SHALL terminate the loop with a precise reason instead of retrying forever
