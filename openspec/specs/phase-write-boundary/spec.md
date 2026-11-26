# phase-write-boundary Specification

## Purpose
TBD - created by archiving change autonomous-recovery-without-human-gates. Update Purpose after archive.
## Requirements
### Requirement: Phase write ownership is derived from existing workflow contracts and scope resolvers

For every controlled phase invocation, the harness SHALL derive the writable artifact and source domains from the resolved workflow chain, `loadFeatureContracts`/`phaseContractIndex`, contract `produces`, the artifact registry and phase-evidence resolver, coding plan/module scope, the active profile's UT test-root resolver, and the existing testing protected-source resolver. The workflow SHALL provide phase membership/order only and MUST NOT be treated as a path-owner table. The assigned author SHALL have the original unit's authorized write domains. An independent verifier SHALL be read-only except for its designated output. A path with no match or multiple owners SHALL be recorded as an observed fact with its candidate owners and matched roles, and the invocation SHALL continue; it SHALL NOT produce a write violation, halt the run, or yield a terminal incident. The resolver MUST NOT be extended with a file-name exclusion list, a parallel permission table, or a persisted owner manifest to compensate for paths the artifact registry deliberately does not describe.

Enforcement: `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/phase-evidence-manifest.ts`, `harness/scripts/check-coding.ts`, `profiles/*/harness/*ut-host*.ts`, `harness/scripts/utils/testing-write-boundary.ts`

#### Scenario: a custom phase cannot claim the whole source tree

- **WHEN** a custom workflow phase declares a source-like output but no existing profile or scope resolver can identify its source paths
- **THEN** the phase SHALL receive no source write permission and contract validation SHALL fail closed without creating an owner manifest

#### Scenario: a new coding file is owned by the coding scope

- **WHEN** coding creates a new file under an actual project source module within the original request and no other producer matches it
- **THEN** the resolver SHALL classify the file as coding-owned and SHALL NOT report a write violation

#### Scenario: a harness ledger written inside the agent process has no registered owner

- **WHEN** the phase skill runs `harness-runner.ts` inside the agent process and the harness writes the feature-root visual debt ledger, which the artifact registry does not describe
- **THEN** the change SHALL be recorded as an observed unattributed fact and the phase SHALL continue to its verdict, with no violation and no terminal incident

### Requirement: Invocation attribution excludes pre-existing and runner-owned writes

The runner SHALL retain signed input identity and available content observations for the original invocation. A time window establishes when bytes differ. A known write requires a bound native operation and result or another authoritative observation of that specific action. Missing snapshots or unrelated workspace changes SHALL NOT reject an otherwise valid handback. Completion consumers SHALL check freshness against the inputs and execution evidence of the specific obligation. Runtime-generated output retains its existing producer and binding.

Enforcement: `harness/scripts/goal-phase-runtime.ts`, `harness/scripts/utils/phase-write-boundary.ts`, `harness/scripts/utils/diff-scope.ts`, `harness/scripts/utils/testing-write-boundary.ts`, `harness/scripts/check-coding.ts`

#### Scenario: a dirty acceptance file is unchanged by plan

- **WHEN** `acceptance.yaml` is dirty before the plan invocation and its content hash is unchanged afterwards
- **THEN** the plan invocation SHALL NOT be attributed that change and SHALL NOT emit a phase write violation for it

#### Scenario: runner finalization does not implicate the agent

- **WHEN** the runner publishes a summary, evidence manifest, pointer, and phase state after the agent exits
- **THEN** those mutations SHALL be excluded from the invocation delta and attributed to the runner

#### Scenario: a snapshot cannot be taken

- **WHEN** the pre-invocation or post-invocation snapshot fails on storage or permission grounds
- **THEN** the runner SHALL record the failure as a diagnostic, mark this invocation as unattributed, and let the phase produce its ordinary verdict

### Requirement: Confirmed actions and changed inputs have distinct recovery

The runner SHALL enforce explicit write authorization, the independent verifier role, the published framework boundary and signed control artifacts. A confirmed unauthorized action SHALL enter existing recovery. A change to a signed input SHALL invalidate the affected conclusion and return it to the original responsibility. For acceptance, contracts or blueprints the original responsible party SHALL compare the current material against the original request, accepted corrections and frozen obligations before the original writer signs a revision. Removed or weakened obligations without user authorization SHALL remain due. The runner SHALL retain unrelated findings that still have valid original evidence. A legacy window-only violation SHALL NOT require restoring a file to its historical hash or drive a backtrack.

#### Scenario: parallel edit during independent verification

- **WHEN** an unrelated request edits or commits a file while the current independent verifier checks an unchanged signed input
- **THEN** the original invocation and its unaffected report findings SHALL remain eligible

#### Scenario: signed acceptance weakens the original behavior

- **WHEN** a changed acceptance allows an arbitrary result in place of the original requested behavior or drops a required verification layer
- **THEN** the original responsible party SHALL refuse the revision and identify the original obligation and its missing condition

#### Scenario: signed input changes during verification

- **WHEN** an actual signed verifier input changes
- **THEN** the dependent conclusions SHALL be checked on the current input by the original independent role, preserving the current bytes and other valid findings
