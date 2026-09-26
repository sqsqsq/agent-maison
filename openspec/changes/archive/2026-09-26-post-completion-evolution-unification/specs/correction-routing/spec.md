## MODIFIED Requirements

### Requirement: Correction classifies to root layer with machine-computed revalidation

A correction SHALL still be classified by `classifyCorrection` into `{root_layer, touched_layers[], revalidate[]}` for routing and for the revalidation hint. Revalidation SHALL be executed by `--revalidate`, which runs only the necessary existing checks against stale inputs; it SHALL NOT re-produce unaffected artifacts, SHALL NOT require receipts and SHALL NOT run the verifier by default. `--revalidate` is the in-flight mechanical revalidation only: it SHALL NOT issue a feature completion. No closing command SHALL be required for a feature correction to end.

Enforcement: `harness/scripts/utils/correction-routing.ts`, `harness/harness-runner.ts`

#### Scenario: A coding correction ends without a ledger

- **WHEN** a correction rooted at coding is implemented and `--revalidate` passes
- **THEN** the correction is finished; no state file and no reconciliation command are involved

## ADDED Requirements

### Requirement: Post-completion corrections run through a successor whose scope the assessment entry computes

A correction to a feature whose completion already exists SHALL be executed by a successor run started with `goal-runner --supersede <completed run>`. The successor's birth scope SHALL be re-resolved in that supersede context through the same candidate path as any birth: obligations are derived from the current inputs, prior phase evidence from the completion record is reused as `satisfied_by` only after the same evidence check, obligations the assessment entry `assessFeature` reports as uncovered are not reused, and `phase_chain` SHALL be the owner phases of the uncovered obligations. The successor SHALL NOT inherit the source run's scope wholesale. Before any run is created the source run MUST be loadable with a complete (or legacy) birth record, and when the feature frozen record exists its current transfer MUST be the supersede source; otherwise birth SHALL be refused without creating a run, writing an audit event or changing the transfer record. After the supersede audit event is written, the feature frozen record SHALL append a transfer to the successor and keep the earlier transfers. A feature completed on the feature carrier (no run) has no run to supersede: `--supersede` SHALL be refused and the correction SHALL append a feature scope revision and start a fresh run. `--revalidate` SHALL NOT be used as the post-completion exit.

Enforcement: `harness/scripts/utils/feature-execution-scope.ts`（`resolveSuccessorExecutionScope`, `registerFeatureScopeTransfer`）, `harness/scripts/utils/feature-track.ts`（`resolveFeatureExecutionScope` reuse branch）, `harness/scripts/goal-phase-runtime.ts`

#### Scenario: Only the uncovered owner phase runs after evidence damage

- **WHEN** a completed feature loses the UT phase evidence manifest and a successor is started with `--supersede <completed run>`
- **THEN** the successor's `phase_chain` is `[ut]`, the other phases appear in `reused_phases` with evidence refs to the source run that pass the evidence check, the old completion original is unchanged and the new completion lands in the successor run directory

#### Scenario: Lineage mismatch refuses birth

- **WHEN** the feature frozen record's current transfer points to a run other than the supersede source
- **THEN** no successor run is created, no supersede audit event is written and the transfer record is byte-identical
