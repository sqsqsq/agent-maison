## 1. Author the concept doc

- [x] 1.1 Create `docs/concepts/code-graph.md` defining the three-tier vocabulary (Code Graph / flow DAG / Repo Map) with level and purpose for each
- [x] 1.2 Add the index-only (non-SSOT) principle: derived-vs-curated layering, mandatory source anchors (file+symbol+hash), and the "consumers MUST re-verify anchors" rule
- [x] 1.3 Add the "dag" disambiguation table: business-ut UT flow DAG vs coding module-dependency acyclicity vs DSL `intra_layer_deps: dag`, each contrasted with Code Graph
- [x] 1.4 Add forward-pointers to `ut-flow-dag-evidence` and master plan (Track A implementation merged into this change + that change)

## 2. Wire docs discoverability

- [x] 2.1 Register `docs/concepts/code-graph.md` in `docs/DOC_INVENTORY.yaml`
- [x] 2.2 Add a one-line cross-reference from `docs/concepts/extensibility.md` (or `docs/overview.md`) to the new concept doc

## 3. Verify

- [x] 3.1 Run `npm run openspec -- validate define-code-graph-concepts --strict` and fix any issues
- [x] 3.2 Run `npm run release:verify` to confirm the doc-only change does not break release packing rules
- [x] 3.3 `cd harness && npm test` + drift/graph extractor unit tests
- [x] 3.4 GraphExtractor + drift + `module_graphs_dir` spec deltas in this change
