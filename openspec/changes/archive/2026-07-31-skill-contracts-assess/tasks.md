## 1. Artifact and Contract Schemas

- [x] 1.1 Generate and review the complete skill-authored artifact inventory from spec-loader inputs, phase-evidence outputs, and all seven skill output declarations
- [x] 1.2 Add versioned schemas under `specs/artifact-schemas/` and document their authority boundary with phase rules and imperative checks
- [x] 1.3 Add `specs/skill-contract-schema.yaml` with the bounded tier predicate DSL and explicit satisfaction sets
- [x] 1.4 Add contract loading, parsing, and finite tier-combination evaluation utilities with unit tests

## 2. Feature Contracts and Consistency

- [x] 2.1 Add phase-aware `contract.yaml` files for all seven feature skills and complete the device-testing adhoc input design
- [x] 2.2 Add missing change/exit `skill_doc` workflow metadata
- [x] 2.3 Implement producer/consumer graph, control-dependency, hidden-input, skill-doc, track/tier, and predicate determinism checks
- [x] 2.4 Register contract consistency tests in `CORE_SUITES` and add failing fixtures for missing producers, zero tier matches, and multiple tier matches

## 3. Summary 1.2 and Closure Finalization

- [x] 3.1 Upgrade summary JSON Schema and mirrored TypeScript readers/writers to 1.2 with required depth and `closure_commit@1`
- [x] 3.2 Refactor phase-state persistence to provide a strict closure write path that fails instead of warning
- [x] 3.3 Extend phase-evidence-manifest resolution with canonical-path staged-output/precomputed-hash support
- [x] 3.4 Implement the staged `finalizePhaseClosure` sequence and route direct receipt checks plus `--sync-closure` through it
- [x] 3.5 Add legacy 1.0/1.1 `legacy_unverified`, unknown-depth, staged-manifest freshness, crash-consistency, and dual-entry equivalence tests

## 4. Deterministic Assessment and Projection

- [x] 4.1 Add `assess@1` schema and deterministic observe/diff/recommend implementation using workflow, track, closure, provenance, and per-phase depth
- [x] 4.2 Add authorization-context handling that leaves manual/batch/goal execution permission in the driver
- [x] 4.3 Implement `next.json` as a disposable fingerprint-bound projection and reject stale/corrupt recommendations on continue
- [x] 4.4 Add reconciled/fuse behavior without naked `COMPLETED` and cover PASS-open, PASS-closed, FAIL, DEFERRED, stale, insufficient-depth, and idempotence branches
- [x] 4.5 Fold recommendation mapping into the `classifyPhaseVerdict` transition-policy SSOT and remove the independent assess action table

## 5. Harness and Skill Integration

- [x] 5.1 Add the bounded next-step renderer outside `HARNESS_SUMMARY` with one render per outer invocation and exact adhoc/global silence conditions
- [x] 5.2 Replace hard-coded next-step labels and feature-skill epilogues with assess output while keeping init-only guidance separate
- [x] 5.3 Add output-budget and direct harness/check-receipt/sync-closure integration fixtures

## 6. Quality Tier Ladders

- [x] 6.1 Freeze business-UT at full/basic depth disclosure; transfer depth-specific check restructuring to plan d4f8b2a6
- [x] 6.2 Unify device-testing phase and adhoc case normalization under one contract/check kernel while preserving device-policy blockers
- [x] 6.3 Freeze code-review at basic-depth/missing-input disclosure; transfer catalog/glossary baseline enforcement to plan d4f8b2a6
- [x] 6.4 Add tier fixtures for business UT, device testing, and code review, including `minimum_depth_by_phase` completion behavior

## 7. Documentation and Verification

- [x] 7.1 Add skill-contract and reconcile-loop concept docs and update transition-policy, confirmation UX, and affected skill references
- [x] 7.2 Update `MIGRATION.md` for summary 1.2, legacy closure re-finalization, unknown depth, and new harness stdout
- [x] 7.3 Run `cd harness && npm test` and fix all runtime-SSOT regressions
- [ ] 7.4 Run `npm run openspec:validate`, `node scripts/check-plan-version.mjs`, and `npm run release:verify`
