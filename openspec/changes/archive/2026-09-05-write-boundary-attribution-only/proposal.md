## Why

The phase write boundary introduced by `autonomous-recovery-without-human-gates` binds three separate things into one step: observing that a file changed, deciding who changed it, and deciding whether the run may continue. Only the first is reliable.

A host run on 2026-09-04 produced a clean spec phase (harness verdict PASS, zero blockers, every artifact on disk) and still halted terminally. The harness itself writes `visual-debt.json` / `visual-debt.md` into the feature root; those paths are not registered in `specs/artifact-schemas/inventory.yaml`, so ownership resolved to `no_owner`, which the incident registry classifies as `framework_fault` + `structurally_terminal`. The run could not resume.

The registry cannot be completed by adding entries. `inventory.yaml` declares that it describes skill-authored narrative artifacts and explicitly excludes harness-derived reports, so diagnostics, notes and machine ledgers will always be absent from it. The same trigger already exists for `revalidation.json` and for the `<phase>/notes.md` files that the phase skills instruct agents to write. A file-name exclusion list cannot close this either: the skills run `harness-runner.ts` inside the agent process, so the current requirement that runner writes "occur outside the agent boundary" does not hold in the self-run mode that consumer projects actually use.

A second, independent blockage sits next to it. Write attribution runs before the checkers, and coding owns the product source tree by path prefix, so a testing- or UT-phase edit to product source is classified as a cross-phase violation and force-backtracks before `review_closure_attestation` can run. Meanwhile the goal runtime reconciles the same drift facts a second time and force-backtracks again. `efficiency-first-closure` already converted that judgement to a graded WARN with review recommendations on the checker side; the two remaining hard blocks make it unreachable.

## What Changes

- Write attribution stops rendering verdicts on ownership it cannot resolve. Paths with no owner or multiple owners are recorded as observed facts and the run continues; they no longer produce a violation, a halt, or a terminal incident.
- Cross-phase writes are split by the role the existing resolvers already assign. Paths whose matched role includes an inventory-registered `artifact` keep the existing invalidate-and-backtrack recovery unchanged. Paths matched only as `source` or `phase_workspace` are deferred to the checkers that already judge them (`check-coding` scope gate, `ut_no_src_mutation`, `review_closure_attestation`).
- Failures of the attribution machinery itself — boundary resolution errors, unresolved source phases, and pre/post invocation snapshot failures — degrade to diagnostics that skip attribution for that invocation instead of halting the run.
- The goal runtime's duplicate source-drift adjudication and the forced backtrack it produces are removed. Drift disposition comes from the checker WARN and its graded review recommendations, adjudicated once.
- The unreviewed-drift fact is disclosed through the existing readiness-signal channel computed from the current `ScriptReport`, so a final testing phase can report it without depending on a next phase and without a report-ordering cycle.
- Incidents whose producers this change removes are retired from the registry; `testing_write_violation` is kept as legacy-only because historical `events.jsonl` resume compatibility still reads it.

## Capabilities

### Modified Capabilities

- `phase-write-boundary`: ownership derivation still comes from the existing contracts and resolvers, but unresolvable ownership becomes an observed fact rather than a closed gate, and backtracking narrows to inventory-registered artifact domains.
- `goal-runner`: source drift is adjudicated once, by the responsible checker, and the runtime consumes that verdict instead of recomputing a second, stricter one.
- `feature-artifact-layout`: harness-derived ledgers, revalidation records and phase notes are named as legitimate feature-tree output that is deliberately outside the inventory and therefore outside write-boundary restriction.

## Impact

- Runtime: `harness/scripts/utils/phase-write-boundary.ts` (classification split), `harness/scripts/goal-phase-runtime.ts` (attribution call site, boundary/snapshot degradation, removal of the outer drift reconciliation), `harness/scripts/utils/adjudication.ts` (incident retirement), `harness/harness-runner.ts` (readiness signal).
- Behavior deliberately given up: an unregistered path or a product-source path written by the wrong phase is no longer blocked at the moment it happens. It is recorded, and the existing checkers judge it on their own schedule. Early detection is traded for reachability of the graded disposition. Compile, test and acceptance failures are untouched and still fail.
- Schemas and CLIs: none. `readiness_signals` already admits `status: unknown`; no new artifact, manifest, state machine, permission table, risk classifier or file-name exclusion list is introduced.
- Tests: write-boundary classification matrix (no owner, multiple owners, artifact-domain cross-phase write, source-domain cross-phase write), goal-runner non-halt paths for degraded attribution, single-adjudication drift behavior, readiness-signal disclosure, and a negative case proving real failures still fail.
- Migration: no consumer artifact is rewritten. Runs previously halted by `phase_write_owner_unresolved` proceed. `MIGRATION.md` records the semantic change from ownership gate to attribution diagnostic.
