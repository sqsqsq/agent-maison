## Context

Three rounds of UT enhancement (layered division, testability-audit + mock-plan, characterization path-c) left the framework with a requirement-level, single-use "DAG" that gets archived even for tiny changes, and with "DAG" overloaded three ways. There is no module-level "core function index" concept, and the user is rightly worried that promoting any such index to a global artifact could make AI treat docs as the source of truth — violating the framework's iron rule "code is the source of truth; docs do not duplicate what code can express."

This change is the conceptual foundation (P0) of the master blueprint in `.cursor/plans/code-graph-ut-evolution_f8fa08ee.plan.md`. It defines vocabulary and the index-only guarantee so subsequent changes (extractor+drift, evidence, registry, closure gate) share one contract. It deliberately introduces **no enforcement**.

## Goals / Non-Goals

**Goals:**
- Lock a three-tier vocabulary: Code Graph (module) / flow DAG (requirement) / Repo Map (global).
- Establish the index-only (non-SSOT) principle and the derived-vs-curated layering as normative requirements.
- Make drift detectability a definitional requirement (anchors carry file+symbol+hash), deferring the gate mechanism.
- Disambiguate the three existing "dag" usages in docs.

**Non-Goals:**
- No schema, generator, harness gate, or skill wiring (those are `code-graph-extractor-drift`, `ut-flow-dag-evidence`, `module-seam-mock-registry`, `code-graph-core-closure-gate`).
- No change to existing flow DAG behavior or archival in this change.
- No Repo Map or global aggregation here.

## Decisions

- **Name the module-level artifact "Code Graph", not "DAG".** Industry navigation-index tools (repo map / code knowledge graph: reponova, codemap, GraphRepo) use "graph", while CPG (Joern, AST+CFG+PDG) is the heavy security-analysis form we explicitly do not adopt. "DAG" is already overloaded, so reusing it would deepen confusion. Alternative considered: keep extending "DAG" semantics — rejected for ambiguity.
- **Index-only principle resolves the "docs-vs-code" tension.** Borrowing codemap's split: a disposable derived layer (regenerable from AST) plus a thin curated layer (intent/invariant/core), anchored to real source with freshness metadata. Because the graph is a projection plus a thin annotation — and consumers must re-verify anchors — code remains SSOT by construction, not by discipline. Alternative considered: a hand-maintained authoritative module spec — rejected as it would compete with code.
- **Land the concept as an OpenSpec capability `code-graph` + `docs/concepts/code-graph.md`.** This matches the framework convention that OpenSpec specs are the readable behavior layer referencing enforcement files; here the enforcement is deferred, so the docs file is the landing point and downstream changes attach gates.
- **Make drift detectability definitional now, gate later.** Mandating anchors (file+symbol+hash) in P0 guarantees later changes can build a deterministic drift gate without re-opening the contract.

## Risks / Trade-offs

- [Concept defined but unused until later changes land] → Keep P0 tiny and doc-only; sequencing in the master plan ensures P1/P2 follow promptly; no enforcement means zero regression risk.
- [Teams might still treat the graph as truth despite the principle] → The principle is normative ("MUST re-verify anchors"), and `code-graph-core-closure-gate` + `code-graph-extractor-drift` later make staleness a detectable, gated condition rather than a matter of trust.
- [Vocabulary churn across existing docs] → Scope doc edits to a single new `docs/concepts/code-graph.md`; do not mass-rename the pre-existing three "dag" usages, only disambiguate them.

## Migration Plan

- Additive, doc-only. No consumer instance migration; `MIGRATION.md` unaffected.
- No profile/adapter impact (no harness, skill, or DSL change). hmos-app and generic profiles are untouched by this change.
- Rollback = delete the new docs file and the `code-graph` spec; nothing downstream depends on enforcement yet.

## Open Questions

- Final on-disk location/key for Code Graph files (`paths.module_graphs_dir`) is decided in `code-graph-extractor-drift`, not here.
- Whether Repo Map ships at all remains deferred (Track A tail in the master plan).
