## 1. Closure artifact and authoritative inputs

- [x] 1.1 Add the `component-closure@1` schema and TypeScript model without authored completion, ready, history-ledger, or self-hash fields.
- [x] 1.2 Implement the deterministic component-owned closure path, YAML loader, path/content/blueprint identity checks, and raw-byte `artifact_sha256` result.
- [x] 1.3 Tighten P1 discovery with a `current_scope_items` closed input list, bidirectional requirement/goal/invariant/high-risk traceability, real blueprint-address mappings, and project-safe source resolution; bind only source identities/provenance/revision/hash to `source_fingerprint`, leaving mappings to revision/artifact hash, with no PRD parser, registry, or new fingerprint.
- [x] 1.4 Implement stable-kernel component input enumeration over one validated P1 traceability/blueprint and same-component canonical CUs, then reuse P2 validators to bind deterministic Feature, exact completion, and carry-forward facts without a collector Provider or downstream writes.
- [x] 1.5 Derive the sorted P3 input manifest and `input_fingerprint`, including full traceability mappings, blueprint revision/artifact hash, exact `supersedes` retirement, conflicting superseders, hash mismatch, and cycle rejection.

## 2. Mechanical obligations and coverage bindings

- [x] 2.1 Derive stable obligations from every P1 current-scope source record and mapping plus applicable view nodes, relations, scenarios, runtime flows, decisions, contracts, NFRs, current gaps, and validation references.
- [x] 2.2 Derive stable obligations from P2 predicates, invariants, touches, requires/provides, safe states, verification refs, and bound Feature acceptance/construction mappings.
- [x] 2.3 Derive component assembly obligations for cross-CU edges, migration/compatibility, temporary assets, residual risk, and stable-knowledge placement.
- [x] 2.4 Mechanically derive complete rows—owner/combination owner, deterministic Feature mapping, evidence level/identity, and observation—and reject every authored field mismatch, ambiguity, or manual fallback.
- [x] 2.5 Preserve current-fact-only coverage without fake CUs and classify future gaps as blocking only when their `needed_by` or current design use affects closure.

## 3. Completion, construction, evidence, and provider boundaries

- [x] 3.1 Consume `ABSENT|VALID|STALE|INVALID` completion and P2 carry-forward exactly, preserving distinct gap routes and historical identity.
- [x] 3.2 Resolve predicate/provide/design mappings through existing Feature path, symbol, test, verification, use-case, DAG, and design gates.
- [x] 3.3 Adapt existing UT/coverage, contract/API, build/runtime, UI/device/visual, and manual evidence into provider-neutral observations with obligation-appropriate levels.
- [x] 3.4 Implement the three static evidence-provider Seam Cards, including required/optional absence, replacement, exit, authority conflict, and prohibitions on provider-selected inputs/bindings/verdicts.
- [x] 3.5 Reject stale, invalid, fabricated, duplicate-authority, contradictory, or unsupported evidence without adding a generic evidence registry.

## 4. Cross-view and runtime assembly closure

- [x] 4.1 Rebuild P1 stable-address coherence and verify that every current target/delta design slice is consumed by a CU or explicit combination owner.
- [x] 4.2 Trace key scenarios across logical contracts, runtime interactions, development owners, and applicable deployment mappings, detecting semantic conflicts and design bypass.
- [x] 4.3 Derive conditional runtime obligations per stable flow/object/edge without forcing mutations, publications, or subscriptions into read-only flows.
- [x] 4.4 Require assembled observations when producer, state owner, consumer, recovery, or lifecycle behavior spans multiple CUs/Features.
- [x] 4.5 Add production-entry tests for missing initial load, propagation, late snapshot, persistence/recovery, subscription cleanup, state owner, and consumer refresh.

## 5. Dependency, migration, NFR, seam, and knowledge closure

- [x] 5.1 Reuse exact P2 requires/provides and cycle rules, then require real combination verification for new cross-CU call/data/state/publication edges.
- [x] 5.2 Validate authoritative disposition, owner, gate, and evidence for migration, compatibility, rollback, flags, dual-write, temporary assets, NFRs, and residual risks.
- [x] 5.3 Freeze P1 `human_decision: establish_seam|keep_direct`, make P2/P3 seam gates consume only authoritative `establish_seam`, and validate its four proofs while `keep_direct` follows ordinary CU/dependency closure.
- [x] 5.4 Verify stable knowledge through resolvable existing architecture/catalog/conventions/spec/scenario/ADR refs without copying or rewriting those truth sources.
- [x] 5.5 Add counterexamples for dangling dependency, unverified assembly, temporary-asset exit gaps, incompatible replacement, provider bypass, and unresolved knowledge placement.

## 6. Verdict, review projection, and consumer entry

- [x] 6.1 Implement deterministic obligation/gap sorting and the derived `PASS|PASS_WITH_DEGRADATION|FAIL` aggregation rules.
- [x] 6.2 Implement the main closure validator that recomputes inputs, obligations, coverage, provider observations, gaps, and verdict rather than trusting authored fields.
- [x] 6.3 Generate `component-closure.md` deterministically from validated YAML with complete input, coverage, cross-view/runtime/assembly/seam, degradation, gap, owner, route, and writeback sections.
- [x] 6.4 Add and register the `component-closure` project Skill as a thin consumer of existing loaders/checkers, with no dynamic plugin runtime or new authority.
- [x] 6.5 Add boundary tests proving P3 does not mutate P1 blueprints, P2 ready/CU state, Feature/Goal Mode completion, or claim Capability E2E closure.

## 7. Fixtures and verification

- [x] 7.1 Add a complete multi-CU component fixture proving deterministic closure reconstruction, current completion/carry-forward, and full coverage.
- [x] 7.2 Add failure fixtures for missing/unresolvable requirement source, unmapped requirement, swapped owner, unrelated-valid evidence, stale/invalid completion, unresolved contract provider, migration/NFR gap, and missing combination result.
- [x] 7.3 Add failure/degradation fixtures for cross-view/runtime breaks, `keep_direct` and ordinary-decision seam false positives, seam contract/replacement/absence/bypass failures, and required/optional provider behavior.
- [x] 7.4 Run P3 targeted tests, affected typecheck, full harness, OpenSpec strict validation, default plan scan, and `git diff --check`; record only observed results.
- [ ] 7.5 At batch close, let total-plan m5/MG run the repository `--release` plan gate and `npm run release:verify`; keep this item unchecked until those gates actually run and pass.
- [x] 7.6 Bind executed evidence to its source version: record every existing project file named by a PASS check in the phase evidence manifest, require the authority file to be a tracked input of the fresh manifest at the identity bytes, and add both counterexamples (untracked authority; executed source edited after its report). Found by total-plan m5/MG cross-layer verification.

## 8. M5A evolution-workspace and identity correction (added 2026-08-21, plan e2a7c4b9)

> Supersedes the `blueprint/component/<component_id>/component-closure.{yaml,md}` path and `--component` addressing described by the completed tasks above; those tasks stay as implementation history. The retired root path was never released and has no real host data: hard cut, no compatibility layer, no dual-read, no migrator.

- [x] 8.1 Move the closure projection to `<features_dir>/<blueprint_id>/blueprint/component-closure.yaml` and `component-closure.md` (`paths.features_dir` resolved) in `component-closure-path.ts`; bind `blueprint_id` in path/content/ref and `component_id` in content/ref; tighten only the path-bearing closure-ref `blueprint_id` pattern to a safe path segment in the closure schema; delete every retired-root concatenation (no read, no fallback, no scan, no dual-write).
- [x] 8.2 Limit closure input enumeration in `component-closure-inputs.ts` to CU subdirectories containing `change-unit.yaml` inside the same `<features_dir>/<blueprint_id>/` workspace, resolving CU/Feature observations and evidence only through the single Feature path SSOT; prove that a VALID CU of another workspace (including an earlier evolution of the same `component_id`) never enters the input set, never credits a row, and that recomputing one workspace's closure changes no byte of another workspace.
- [x] 8.3 Switch `check-component-closure` CLI (`--write` included), `skills/project/component-closure/SKILL.md`, closure write/read helpers, Markdown `derived_from` and all internal signatures to `--blueprint <blueprint_id>` addressing; `component_id` is verification output only.
- [x] 8.4 Migrate closure fixtures to the workspace layout (CU directories phase-scoped, new identity encoding); add positive/negative cases: path/YAML/ref `blueprint_id` disagreement fails with all three values reported, content/ref (and owner-blueprint) `component_id` disagreement fails without any path lookup, two closures of the same `component_id` coexist independently, cross-workspace CU/evidence is rejected with the foreign workspace located, retired root closure path is ignored and recomputed, custom `paths.features_dir` end-to-end, `input_fingerprint` still goes stale on any blueprint/CU/Feature/evidence change (regression).
- [x] 8.5 Run `cd harness && npm test`, `npm run openspec:validate`, `node scripts/check-plan-version.mjs` (default mode) and record results; this section does not touch 7.5, `tests/fixtures/component-blueprint/release-semantics.json` or any release gate — those remain with total-plan m5 after M0 + M6 + MG regression are all complete.

## 9. M7 单 CU 退化 closure 与演进影响接线（2026-08-29 追加，plan f9e2c7b4）

> 本节不触碰 7.5、`tests/fixtures/component-blueprint/release-semantics.json` 或任何 release 门禁。

- [x] 9.1 单 CU closure 正向：跨单元组装边为空集是合法结论，closure 退化为"需求 → 蓝图稳定地址 → CU `design_refs` → completion 证据"的追溯核对；复用同一算法、同一投影、同一 mapping schema，不产生第二次验收。
- [x] 9.2 多 CU 既有正反回归全量保持——单 CU 退化不得通过放宽多 CU 义务实现。
- [x] 9.3 `evolution_impact` 接线：`component-closure-obligations.ts` 对全部 applicable 视图产生视图事实义务（不再按字面 `applicability` 跳过），只有 `changed` 视图的节点可能派生施工义务；runtime 流义务与 `component-closure-runtime.ts` 的传播核对仅对 `runtime` = `changed` 派生。节点变化判据复用 P1 的共享 `nodeDeclaresChange`，不写第二份。
- [x] 9.4 正反 fixture：单 CU closure 通过、`verified_unchanged` 视图节点不派生施工义务、多 CU 组装义务回归保持。
