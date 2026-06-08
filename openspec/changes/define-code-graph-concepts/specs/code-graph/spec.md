## ADDED Requirements

### Requirement: Three-tier code-structure vocabulary

The framework SHALL define and consistently use three distinct terms for code-structure artifacts, documented in `docs/concepts/code-graph.md`:
- **Code Graph** — a module-level index of core function/capability nodes, iterated across requirements.
- **flow DAG** — a requirement-level per-scenario test-flow graph (the existing business-ut artifact).
- **Repo Map** — an optional global, cross-module derived navigation index.

New module-level indexing artifacts SHALL NOT reuse the term "DAG".

#### Scenario: Terminology is documented
- **WHEN** `docs/concepts/code-graph.md` is read
- **THEN** it defines Code Graph, flow DAG, and Repo Map with their level (module / requirement / global) and purpose

#### Scenario: No term overload for module-level index
- **WHEN** a new module-level index artifact is introduced by a downstream change
- **THEN** it is named "Code Graph" (not "DAG")

### Requirement: Code Graph is index-only, never source of truth

A Code Graph SHALL be treated as a derived projection of source code plus a thin curated intent layer, and MUST NOT be an authoritative source of truth. Any consumer (PRD/design/coding/UT/device-testing) MUST re-verify a node's source anchor against current code before relying on the node's content. Enforcement landing point: `docs/concepts/code-graph.md`; mechanical drift enforcement is defined by change `code-graph-extractor-drift`.

#### Scenario: Consumer re-verifies before trusting
- **WHEN** a skill consumes a Code Graph node to locate or reason about code
- **THEN** it re-resolves the node's source anchor against the current source before treating the node content as accurate

#### Scenario: Stale node falls back to code
- **WHEN** a Code Graph node's source anchor no longer matches current code
- **THEN** the consumer treats the node as stale and relies on the source code, not the graph

### Requirement: Derived-vs-curated layering

A Code Graph's content SHALL be partitioned into a derived layer and a curated layer. The derived layer SHALL contain only facts that static analysis produces from code (signatures, import/dependency edges, call edges) and is regenerable. The curated layer SHALL be limited to information code cannot express (intent, invariants, `core` marking). Code-derivable facts MUST NOT be hand-authored in the curated layer.

#### Scenario: Derived facts are auto-generated
- **WHEN** a Code Graph is produced
- **THEN** signatures and dependency/call edges originate from the derived layer, not hand-authored curation

#### Scenario: Curated layer stays thin
- **WHEN** the curated layer is inspected
- **THEN** it contains only intent / invariants / `core` markings, not facts obtainable from static analysis

### Requirement: Drift and freshness detectability

Each Code Graph node SHALL carry a source anchor sufficient to detect drift between the graph and current code (at minimum: file path, symbol, content hash). The concrete drift gate and its severity tiers are implemented in `harness/code-graph/drift.ts` with profile `GraphExtractor` providers.

#### Scenario: Node carries a detectable anchor
- **WHEN** a Code Graph node is created
- **THEN** it records file + symbol + content hash for its anchored source

#### Scenario: Drift is detectable
- **WHEN** the anchored source's content hash changes
- **THEN** a drift check can detect the mismatch from the recorded anchor alone

### Requirement: Disambiguation of overloaded "dag" usages

The framework docs SHALL disambiguate the three existing "dag" usages so they are not conflated with Code Graph: the business-ut UT flow DAG, the coding module-dependency acyclicity check, and the architecture DSL `intra_layer_deps: dag` policy.

#### Scenario: Disambiguation is documented
- **WHEN** `docs/concepts/code-graph.md` is read
- **THEN** it lists the three pre-existing "dag" meanings and contrasts each with Code Graph

### Requirement: Module graph path configuration

The framework SHALL expose `paths.module_graphs_dir` on `FrameworkPaths` (default `<module>/code-graph.yaml`) and resolve per-module paths via `moduleGraphPath(projectRoot, moduleRelPath)`.

#### Scenario: Default path pattern
- **WHEN** `framework.config.json` omits `paths.module_graphs_dir`
- **THEN** init/config merge backfills the default pattern with `<module>` placeholder

### Requirement: GraphExtractor contract (v1 skeleton)

The framework SHALL define a profile-pluggable `GraphExtractor` contract. The hmos-app provider SHALL derive import/signature facts via `ast-analyzer` and intra-file call edges via a dedicated CompilerHost (not the UT `ts-compile.ts` `noResolve` path). Cross-module relationships in v1 SHALL be expressed via import edges, not full cross-file TypeChecker resolution.

#### Scenario: Provider returns derived facts
- **WHEN** `hmosGraphExtractor.extractModule` runs for a module package path
- **THEN** the result includes signatures, import_edges, and call_edges suitable for the Code Graph derived layer

### Requirement: Graded drift gate

Drift evaluation SHALL classify: missing file/symbol as BLOCKER; `core: true` anchor body hash change as BLOCKER; non-core body hash change as WARN (regenerate/review prompt, not automatic FAIL).

#### Scenario: Missing anchor file is BLOCKER
- **WHEN** a node's anchored file no longer exists
- **THEN** drift reports BLOCKER for that node

#### Scenario: Non-core body change is WARN
- **WHEN** a non-core node's function body hash changes
- **THEN** drift reports WARN with regenerate/review guidance

### Requirement: Core-node closure (business-ut)

After UT harness passes, business-ut SHALL evaluate whether the requirement touched any `core: true` Code Graph node; if yes, update the graph and sync UT and MAY archive flow DAG; if not, ephemeral flow DAG MAY be discarded.

#### Scenario: Core touched triggers maintenance
- **WHEN** changes intersect a `core: true` node anchor file
- **THEN** business-ut Step 8.0 requires graph update and UT sync

#### Scenario: No core touch keeps ephemeral DAG
- **WHEN** no `core: true` node is touched
- **THEN** flow DAG remains ephemeral by default
