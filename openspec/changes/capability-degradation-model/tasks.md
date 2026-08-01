## 1. Contract and resolution foundations

- [x] 1.1 Replace tier/input-policy schema types with capability, applicability-provider, and structured source declarations; remove `tiers`/`when`/`satisfies` loader paths.
- [x] 1.2 Implement pure capability applicability preflight and ordered artifact/derive input resolver with distinct input/capability states and attempt provenance.
- [x] 1.3 Implement report fingerprints and source-attempt dependency extraction through resolved/invalid termination.
- [x] 1.4 Extend static `check-contract-consistency` for capability declarations, providers, tracks, artifacts, producers, and active-track uniqueness.
- [x] 1.5 Add unit/fixture coverage for applicability order, absent fallback, invalid termination, and static declaration failures.

## 2. Summary, evidence, quality, and runtime consumption

- [x] 2.1 Migrate summary 1.2 schema/types and script-report protocol from depth/missing-input mirrors to assurance and capability-resolution provenance.
- [x] 2.2 Bind contract fingerprint plus project-local actual source-attempt dependencies into closure provenance and evidence freshness without coupling framework contract paths into consumer manifests.
- [x] 2.3 Adapt quality-axis and projected verdict derivation for pruned and blocked capability outcomes without adding public PRUNED statuses.
- [x] 2.4 Add pure phase-final `assertCapabilityConsumption(report, checks)` and wire it after checker execution.
- [x] 2.5 Add regression coverage for stale fallback selection, blocked PASS-closure prevention, axis routes, and strict bidirectional check consumption.

## 3. Goal and assessment assurance migration

- [x] 3.1 Replace goal `minimum_depth_by_phase` with optional sparse `minimum_assurance`, including manifest identity and schema validation.
- [x] 3.2 Migrate assess observation, fingerprints, gaps, and recommendations from depth to assurance and persisted capability resolutions.
- [x] 3.3 Add assess regressions for sparse floors, observed degradations, insufficient assurance, upstream pruned propagation, and blocked non-PASS behavior.

## 4. Phase contract and checker migration

- [x] 4.1 Migrate all seven feature contracts to capability/input-source declarations and register required pure providers.
- [x] 4.2 Migrate business-UT policy, remove dead plan wrapper code, and replace quality-depth disclosure with report-derived assurance/degradations.
- [x] 4.3 Migrate review acceptance/visual policies, including explicit non-UI applicability and invalid-input behavior.
- [x] 4.4 Split only static testing gates from `checkDeviceTestRunGate`; preserve build→install→run holder and runtime evidence flow.
- [x] 4.5 Update feature checker/report integrations and add cross-phase fixtures for contract axis ownership and runtime report consumption.

## 5. Documentation and migration

- [x] 5.1 Update `MIGRATION.md`, contract and reconcile concepts, and add `docs/concepts/capability-degradation.md` with the frozen data flow and breaking changes.
- [x] 5.2 Update relevant skill guidance and remove obsolete tier/quality-depth references and duplicated missing-input output.

## 6. Verification and release readiness

- [x] 6.1 Register the capability-degradation CORE_SUITE and run targeted unit/fixture regressions.
- [x] 6.2 Run `cd harness && npm test`, `npm run openspec:validate`, and `node scripts/check-plan-version.mjs`; record results.
- [x] 6.3 Run `npm run release:verify` and `npm run release:check-plans`; resolve change-owned failures and record any unrelated window blockers.
## 7. Post-review correctness corrections

- [x] 7.1 Correct authorized-pruning projection: retain `pruned` in assurance/report/assess provenance only, remove its quality-axis and `AxisResolution.reason_code` projection, preserve all blocked behavior, and add equality regressions.
- [x] 7.2 Make testing adhoc derivation honest: remove goal-requirement aliasing, classify degenerate normalized adhoc input as absent at resolver scope without changing the shared kernel, and add explicit-source regressions.