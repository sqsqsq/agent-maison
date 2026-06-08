## Why

The framework has no module-level concept for "core function index", and the term "DAG" is overloaded three ways (business-ut UT flow DAG, coding module-dependency acyclicity, architecture DSL `intra_layer_deps: dag`). Before building module-level testing/navigation, we need a shared, normative vocabulary and an explicit guarantee that any derived graph stays an index — never a parallel source of truth competing with code.

## What Changes

- Introduce a normative three-tier vocabulary:
  - **Code Graph** (module-level): an index of a module's core function/capability nodes; can be added/updated/removed and iterated over requirements.
  - **flow DAG** (requirement-level): the existing per-scenario test-flow graph; default ephemeral.
  - **Repo Map** (global, optional/deferred): a lightweight cross-module derived navigation index.
- Establish the **index-only (non-SSOT) principle**: a Code Graph is a derived projection of code plus a thin curated intent layer; it is NEVER authoritative; any consumer (PRD/design/coding/UT/device-testing) MUST re-verify node anchors against source code before trusting graph content.
- Establish the **derived-vs-curated layering** and **freshness/drift expectation** conceptually: facts that static analysis can produce are auto-derived; humans only add what code cannot express (intent, invariants, `core` marking); staleness must be detectable. The enforcement mechanism lands in later changes.
- Disambiguate the three current "dag" usages in framework docs.
- **Also ships (merged from Track A P2/P5):** `paths.module_graphs_dir`, `GraphExtractor` contract + hmos-app v1 provider, graded drift in `harness/code-graph/drift.ts`, business-ut core-node closure Step 8.0.
- UT flow DAG / coverage-evidence / path-c / seam registry live in change `ut-flow-dag-evidence`.

## Capabilities

### New Capabilities
- `code-graph`: defines the three-tier vocabulary, the index-only (non-SSOT) principle, the derived-vs-curated layering, and the drift/freshness expectation as normative requirements that downstream changes implement against.

### Modified Capabilities
<!-- None. No existing requirement changes; later changes will modify harness-gates and related capabilities. -->

## Impact

- New docs under `docs/concepts/` (three-tier terminology + "dag" disambiguation + index-only principle).
- Conceptually affects Phase 5 (business-UT) and downstream Phase 1/2/3/6 navigation, but **adds no phase enforcement** here.
- No consumer migration and no breaking change; MIGRATION.md unaffected. Subsequent changes that add gates will carry their own migration notes.
- Master blueprint and sequencing tracked in `.cursor/plans/code-graph-ut-evolution_f8fa08ee.plan.md`.
- **Target release window: `2.2.0`** (per that plan's `version`; 2.2.0 is the current open window). This change carries no enforced version field — version association flows through the plan; the version-evolution mechanism governs `.cursor/plans/*` only, not `openspec/`.
