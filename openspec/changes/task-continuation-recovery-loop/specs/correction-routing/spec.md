## MODIFIED Requirements

### Requirement: Post-completion corrections run through a successor whose scope the assessment entry computes

A correction to a feature whose completion already exists SHALL be executed by a successor run of the completed run, started either with `goal-runner --supersede <completed run>` or — when no run is unfinished and the feature scope is held by that completed run — by re-issuing the request with a verifiable change (plan 4e6fb3b6 §7, a requirement increment being the usual one), which the continuation decision turns into the same supersede birth; re-issuing the unchanged request SHALL hold without creating a run and SHALL tell the user to state the new or changed requirement. The successor's birth scope SHALL be re-resolved in that supersede context through the same candidate path as any birth: obligations are derived from the current inputs, prior phase evidence from the completion record is reused as `satisfied_by` only after the same evidence check, obligations the assessment entry `assessFeature` reports as uncovered are not reused, and `phase_chain` SHALL be the owner phases of the uncovered obligations. The successor SHALL NOT inherit the source run's scope wholesale. Before any run is created the source run MUST be loadable with a complete (or legacy) birth record, and when the feature frozen record exists its current transfer MUST be the supersede source; otherwise birth SHALL be refused without creating a run, writing an audit event or changing the transfer record. After the supersede audit event is written, the feature frozen record SHALL append a transfer to the successor and keep the earlier transfers. A feature completed on the feature carrier (no run) has no run to supersede: `--supersede` SHALL be refused and the correction SHALL append a feature scope revision and start a fresh run. `--revalidate` SHALL NOT be used as the post-completion exit.

Enforcement: `harness/scripts/utils/feature-execution-scope.ts`（`resolveSuccessorExecutionScope`, `registerFeatureScopeTransfer`）, `harness/scripts/utils/feature-track.ts`（`resolveFeatureExecutionScope` reuse branch）, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: Only the uncovered owner phase runs after evidence damage

- **WHEN** a completed feature loses the UT phase evidence manifest and a successor is started with `--supersede <completed run>`
- **THEN** the successor's `phase_chain` is `[ut]`, the other phases appear in `reused_phases` with evidence refs to the source run that pass the evidence check, the old completion original is unchanged and the new completion lands in the successor run directory

#### Scenario: Lineage mismatch refuses birth

- **WHEN** the feature frozen record's current transfer points to a run other than the supersede source
- **THEN** no successor run is created, no supersede audit event is written and the transfer record is byte-identical

#### Scenario: Re-issuing with a requirement increment after completion starts the successor without flags

- **WHEN** the feature scope is held by a completed run, no run is unfinished, and the request is re-issued with a requirement increment and no flags
- **THEN** a successor of the completed run SHALL be born through the same supersede path (audit event, identity checks, appended transfer), and re-issuing the unchanged requirement SHALL create no run and write no event
