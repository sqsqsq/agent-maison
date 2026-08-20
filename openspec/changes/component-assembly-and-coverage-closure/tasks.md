## 1. Closure artifact and authoritative inputs

- [ ] 1.1 Add the `component-closure@1` schema and TypeScript model without authored completion, ready, history-ledger, or self-hash fields.
- [ ] 1.2 Implement the deterministic component-owned closure path, YAML loader, path/content/blueprint identity checks, and raw-byte `artifact_sha256` result.
- [ ] 1.3 Tighten P1 discovery with a `current_scope_items` closed input list, bidirectional requirement/goal/invariant/high-risk traceability, real blueprint-address mappings, and project-safe source resolution; bind only source identities/provenance/revision/hash to `source_fingerprint`, leaving mappings to revision/artifact hash, with no PRD parser, registry, or new fingerprint.
- [ ] 1.4 Implement stable-kernel component input enumeration over one validated P1 traceability/blueprint and same-component canonical CUs, then reuse P2 validators to bind deterministic Feature, exact completion, and carry-forward facts without a collector Provider or downstream writes.
- [ ] 1.5 Derive the sorted P3 input manifest and `input_fingerprint`, including full traceability mappings, blueprint revision/artifact hash, exact `supersedes` retirement, conflicting superseders, hash mismatch, and cycle rejection.

## 2. Mechanical obligations and coverage bindings

- [ ] 2.1 Derive stable obligations from every P1 current-scope source record and mapping plus applicable view nodes, relations, scenarios, runtime flows, decisions, contracts, NFRs, current gaps, and validation references.
- [ ] 2.2 Derive stable obligations from P2 predicates, invariants, touches, requires/provides, safe states, verification refs, and bound Feature acceptance/construction mappings.
- [ ] 2.3 Derive component assembly obligations for cross-CU edges, migration/compatibility, temporary assets, residual risk, and stable-knowledge placement.
- [ ] 2.4 Mechanically derive complete rows—owner/combination owner, deterministic Feature mapping, evidence level/identity, and observation—and reject every authored field mismatch, ambiguity, or manual fallback.
- [ ] 2.5 Preserve current-fact-only coverage without fake CUs and classify future gaps as blocking only when their `needed_by` or current design use affects closure.

## 3. Completion, construction, evidence, and provider boundaries

- [ ] 3.1 Consume `ABSENT|VALID|STALE|INVALID` completion and P2 carry-forward exactly, preserving distinct gap routes and historical identity.
- [ ] 3.2 Resolve predicate/provide/design mappings through existing Feature path, symbol, test, verification, use-case, DAG, and design gates.
- [ ] 3.3 Adapt existing UT/coverage, contract/API, build/runtime, UI/device/visual, and manual evidence into provider-neutral observations with obligation-appropriate levels.
- [ ] 3.4 Implement the three static evidence-provider Seam Cards, including required/optional absence, replacement, exit, authority conflict, and prohibitions on provider-selected inputs/bindings/verdicts.
- [ ] 3.5 Reject stale, invalid, fabricated, duplicate-authority, contradictory, or unsupported evidence without adding a generic evidence registry.

## 4. Cross-view and runtime assembly closure

- [ ] 4.1 Rebuild P1 stable-address coherence and verify that every current target/delta design slice is consumed by a CU or explicit combination owner.
- [ ] 4.2 Trace key scenarios across logical contracts, runtime interactions, development owners, and applicable deployment mappings, detecting semantic conflicts and design bypass.
- [ ] 4.3 Derive conditional runtime obligations per stable flow/object/edge without forcing mutations, publications, or subscriptions into read-only flows.
- [ ] 4.4 Require assembled observations when producer, state owner, consumer, recovery, or lifecycle behavior spans multiple CUs/Features.
- [ ] 4.5 Add production-entry tests for missing initial load, propagation, late snapshot, persistence/recovery, subscription cleanup, state owner, and consumer refresh.

## 5. Dependency, migration, NFR, seam, and knowledge closure

- [ ] 5.1 Reuse exact P2 requires/provides and cycle rules, then require real combination verification for new cross-CU call/data/state/publication edges.
- [ ] 5.2 Validate authoritative disposition, owner, gate, and evidence for migration, compatibility, rollback, flags, dual-write, temporary assets, NFRs, and residual risks.
- [ ] 5.3 Freeze P1 `human_decision: establish_seam|keep_direct`, make P2/P3 seam gates consume only authoritative `establish_seam`, and validate its four proofs while `keep_direct` follows ordinary CU/dependency closure.
- [ ] 5.4 Verify stable knowledge through resolvable existing architecture/catalog/conventions/spec/scenario/ADR refs without copying or rewriting those truth sources.
- [ ] 5.5 Add counterexamples for dangling dependency, unverified assembly, temporary-asset exit gaps, incompatible replacement, provider bypass, and unresolved knowledge placement.

## 6. Verdict, review projection, and consumer entry

- [ ] 6.1 Implement deterministic obligation/gap sorting and the derived `PASS|PASS_WITH_DEGRADATION|FAIL` aggregation rules.
- [ ] 6.2 Implement the main closure validator that recomputes inputs, obligations, coverage, provider observations, gaps, and verdict rather than trusting authored fields.
- [ ] 6.3 Generate `component-closure.md` deterministically from validated YAML with complete input, coverage, cross-view/runtime/assembly/seam, degradation, gap, owner, route, and writeback sections.
- [ ] 6.4 Add and register the `component-closure` project Skill as a thin consumer of existing loaders/checkers, with no dynamic plugin runtime or new authority.
- [ ] 6.5 Add boundary tests proving P3 does not mutate P1 blueprints, P2 ready/CU state, Feature/Goal Mode completion, or claim Capability E2E closure.

## 7. Fixtures and verification

- [ ] 7.1 Add a complete multi-CU component fixture proving deterministic closure reconstruction, current completion/carry-forward, and full coverage.
- [ ] 7.2 Add failure fixtures for missing/unresolvable requirement source, unmapped requirement, swapped owner, unrelated-valid evidence, stale/invalid completion, unresolved contract provider, migration/NFR gap, and missing combination result.
- [ ] 7.3 Add failure/degradation fixtures for cross-view/runtime breaks, `keep_direct` and ordinary-decision seam false positives, seam contract/replacement/absence/bypass failures, and required/optional provider behavior.
- [ ] 7.4 Run P3 targeted tests, affected typecheck, full harness, OpenSpec strict validation, default plan scan, and `git diff --check`; record only observed results.
- [ ] 7.5 At batch close, let total-plan m5/MG run the repository `--release` plan gate and `npm run release:verify`; keep this item unchecked until those gates actually run and pass.
