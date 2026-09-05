## MODIFIED Requirements

### Requirement: Phase write ownership is derived from existing workflow contracts and scope resolvers

For every controlled phase invocation, the harness SHALL derive the writable artifact and source domains from the resolved workflow chain, `loadFeatureContracts`/`phaseContractIndex`, contract `produces`, the artifact registry and phase-evidence resolver, coding plan/module scope, the active profile's UT test-root resolver, and the existing testing protected-source resolver. The workflow SHALL provide phase membership/order only and MUST NOT be treated as a path-owner table. A path that uniquely matches the current phase's existing producer/resolver SHALL be writable. A path with no match or multiple owners SHALL be recorded as an observed fact with its candidate owners and matched roles, and the invocation SHALL continue; it SHALL NOT produce a write violation, halt the run, or yield a terminal incident. The resolver MUST NOT be extended with a file-name exclusion list, a parallel permission table, or a persisted owner manifest to compensate for paths the artifact registry deliberately does not describe.

Enforcement: `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/check-coding.ts`, `profiles/*/harness/*ut-host*.ts`, `harness/scripts/utils/testing-write-boundary.ts`

#### Scenario: a custom phase cannot claim the whole source tree

- **WHEN** a custom workflow phase declares a source-like output but no existing profile or scope resolver can identify its source paths
- **THEN** the phase SHALL receive no source write permission and contract validation SHALL fail closed without creating an owner manifest

#### Scenario: a new coding file is owned by the coding scope

- **WHEN** coding creates a new file under an `in_scope_modules` module package path and no other producer matches it
- **THEN** the resolver SHALL classify the file as coding-owned and SHALL NOT report a write violation

#### Scenario: a harness ledger written inside the agent process has no registered owner

- **WHEN** the phase skill runs `harness-runner.ts` inside the agent process and the harness writes the feature-root visual debt ledger, which the artifact registry does not describe
- **THEN** the change SHALL be recorded as an observed unattributed fact and the phase SHALL continue to its verdict, with no violation and no terminal incident

### Requirement: A downstream write invalidates trust and backtracks to the owner

When an invocation changes a path whose ownership resolves uniquely to an earlier phase **and** whose matched roles include an artifact domain registered in the artifact inventory, the runner SHALL record `phase_write_violation` with current phase, normalized path, pre/post hashes, and resolved owner; invalidate the current invocation evidence plus the owner closure and all downstream closures; preserve the workspace bytes as untrusted; and execute the existing `backtrack_to_phase` transaction to the owner for complete machine re-verification and any necessary rewrite. A cross-phase write whose matched roles are only product source or phase workspace SHALL NOT trigger this recovery; it SHALL be recorded as an observed fact deferred to the checkers that already judge it, so that a single graded disposition is reached instead of two. Unresolvable ownership SHALL NOT be a trigger. The first stable violation MUST NOT permanently halt, accept/rebind the bytes, request a human waiver, or destructively restore them. Repeated identical violations, continuing content changes, unreadable bytes, absent owner targets, or exhausted existing budgets SHALL use the existing integrity/external/fuse terminal semantics.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/adjudication.ts`, `harness/scripts/utils/goal-assess-driver.ts`

#### Scenario: plan writes spec acceptance

- **WHEN** a plan invocation changes the spec-owned `acceptance.yaml`, a registered artifact
- **THEN** the runner SHALL invalidate the plan invocation and prior spec/downstream closure trust, retain the bytes, and automatically backtrack to spec for full revalidation without a first-touch HALT

#### Scenario: testing edits product source

- **WHEN** a testing invocation changes a file under the coding source scope
- **THEN** the runner SHALL record the change as deferred to the checkers and continue, so that `review_closure_attestation` produces the graded review disposition instead of a pre-emptive backtrack

#### Scenario: repeated unstable writes trip the existing fuse

- **WHEN** the same owner/path violation recurs with the same recovery fingerprint or the bytes continue changing during recovery
- **THEN** the existing convergence/integrity budget SHALL terminate the loop with a precise reason instead of retrying forever

### Requirement: Invocation attribution excludes pre-existing and runner-owned writes

The runner SHALL snapshot normalized paths and content hashes immediately before and after the agent process boundary and attribute only the delta introduced by that invocation. Pre-existing dirty files SHALL not be blamed on the phase. Runner-authored events, summaries, manifests, pointers, phase state, and evidence refreshes SHALL be tagged/handled as runner-owned facts; where a phase skill runs the harness inside the agent process, harness-derived writes that fall inside the window SHALL be handled as unattributed observations rather than agent violations. Paths with multiple roles SHALL be deduplicated by normalized path while preserving the role set in diagnostics. When the boundary cannot be resolved, or either snapshot cannot be taken, the runner SHALL record the failure, skip attribution for that invocation, and continue to the phase verdict; missing attribution SHALL NOT be treated as evidence of a violation and SHALL NOT terminate the run. No persistent pass snapshot or off-repository attribution state SHALL be introduced.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/diff-scope.ts`, `harness/scripts/utils/testing-write-boundary.ts`

#### Scenario: a dirty acceptance file is unchanged by plan

- **WHEN** `acceptance.yaml` is dirty before the plan invocation and its content hash is unchanged afterwards
- **THEN** the plan invocation SHALL NOT be attributed that change and SHALL NOT emit a phase write violation for it

#### Scenario: runner finalization does not implicate the agent

- **WHEN** the runner publishes a summary, evidence manifest, pointer, and phase state after the agent exits
- **THEN** those mutations SHALL be excluded from the invocation delta and attributed to the runner

#### Scenario: a snapshot cannot be taken

- **WHEN** the pre-invocation or post-invocation snapshot fails on storage or permission grounds
- **THEN** the runner SHALL record the failure as a diagnostic, mark this invocation as unattributed, and let the phase produce its ordinary verdict
