## MODIFIED Requirements

### Requirement: Init run-log next_steps SSOT

The orchestrator MUST derive structured `next_steps` via `deriveInitNextSteps(log,
ctx?)` during `finalizeInitRunLog` / `writeRunArtifacts` for all exit paths
(execute, preflight blocked, cross-check blocked). `run-log.json` MUST persist
only structured `next_steps` (no `next_steps_markdown`). `buildRunSummary` and
`summary.md` MUST consume the same rendered markdown from `log.next_steps`.

Phase 0 (BLOCKER) MUST synthesize only `failure_recovery` harness steps from
`log.entries` without reading `ctx`, config, workflow, or catalog. Phase 0 MUST
NOT emit separate `init_rerun` steps.

Capability recommendations MUST come from `skills/skills.index.yaml`
`init_next_steps[]` (including `workflow_artifact` for `graph_gap` and
`feature_ready`). Recovery/corrupt steps MUST be harness-synthesized and MUST
NOT masquerade as Skills.

The formal-requirement entry uses `when: design_entry_ready` (kind optional, no
`workflow_artifact`). It MUST hold only when the catalog is ready and the
configured `project_profile.name` has a design lens per `profileHasDesignLens`,
the same predicate the P1 blueprint checker uses for its unsupported result.
The harness MUST append one disclosure line stating whether the files at
`paths.conventions` and `paths.component_index` exist; the disclosure MUST NOT
create required steps, block init, or add a readiness type. `feature_ready`
entries for spec/plan remain and are worded as legacy flat Feature /
non-formal maintenance.

The framework-init Skill MUST verbatim replay harness「必须处理」/「可选下一步」
sections; it MUST NOT list static downstream phase bullets.

#### Scenario: Cross-check blocked still writes recovery
- **WHEN** execute aborts on materialized_adapters cross-check before
  `deriveContextForExecution`
- **THEN** run-log and summary MUST include `kind: required` failure_recovery
- **AND** derive MUST NOT read catalog from disk

#### Scenario: Failed execute emits only failure_recovery
- **WHEN** `executeInitPlan` produces a failed task entry
- **THEN** `next_steps` MUST contain failure_recovery only (no init_rerun)

#### Scenario: graph_gap maps module-graph artifact to code-graph skill
- **WHEN** catalog has modules but the first module lacks code-graph.yaml
- **THEN** optional next_steps MUST reference the index entry with
  `workflow_artifact: module-graph` and enclosing skill `code-graph`

Phase 1 MUST treat module-graph as ready only when every catalog module has a
valid code-graph.yaml passing schema validation and no BLOCKER drift findings
(same gate as phase check-module-graph). Schema-invalid or BLOCKER-drift graphs
MUST NOT be considered ready for `feature_ready` or `graph_gap` resolution.

When module-graph is schema-invalid or BLOCKER-blocked, derive MUST emit a
single harness `kind: required` repair step (`module-graph_corrupt` or
`module-graph_blocked`) and MUST suppress index `feature_ready`, `graph_gap`,
and other optional recommendations (including `always_optional` entries such as
goal-mode). The repair message MUST direct the user to fix or re-run code-graph
and subsequent phase validation; it MUST NOT instruct re-running
`/framework-init`.

`always_optional` index entries (e.g. goal-mode) MAY appear alongside primary
recommendations when no corrupt/blocked module-graph or catalog/glossary corrupt
state applies.

#### Scenario: module-graph corrupt emits harness required repair
- **WHEN** a catalog module's code-graph.yaml fails schema validation
- **THEN** next_steps MUST contain `kind: required` harness
  `module-graph_corrupt`
- **AND** MUST NOT contain `graph_gap`, `feature_ready`, or goal-mode optional
- **AND** the repair message MUST mention code-graph and MUST NOT mention
  `/framework-init`

#### Scenario: module-graph BLOCKER drift emits harness required repair
- **WHEN** a catalog module's code-graph.yaml passes schema but has BLOCKER drift
  (e.g. missing anchor file or core hash mismatch)
- **THEN** next_steps MUST contain `kind: required` harness
  `module-graph_blocked`
- **AND** MUST NOT emit `feature_ready` for downstream phases

#### Scenario: always_optional coexists with primary recommendation
- **WHEN** catalog, glossary, and module-graph are ready and a feature phase
  skill entry exists
- **THEN** next_steps MAY include both `feature_ready` and `always_optional`
  (e.g. goal-mode) index entries

#### Scenario: module-graph probe failure is not silent missing
- **WHEN** module-graph readiness probing throws (e.g. unreadable anchor source)
- **THEN** probe MUST return `corrupt` with an error message (not `missing`)
- **AND** derive MUST emit harness required repair without optional goal-mode

#### Scenario: design lens profile with ready catalog recommends component-design
- **WHEN** `project_profile.name` is `hmos-app` and the catalog is ready
- **THEN** optional next_steps MUST include the `component-design` index entry
  (`when: design_entry_ready`, priority 34, ordered between code-graph 30 and
  plan 35)
- **AND** its message MUST end with one line disclosing whether the
  `paths.conventions` and `paths.component_index` files exist
- **AND** a missing conventions or component index file MUST NOT produce a
  required step

#### Scenario: profile without design lens gets no component-design entry
- **WHEN** `project_profile.name` is `generic` and the catalog is ready
- **THEN** next_steps MUST NOT include `component-design`
- **AND** a `feature_ready` plan entry, when present, MUST be worded as
  legacy flat Feature / non-formal maintenance
- **AND** the P1 blueprint checker MUST report
  `blueprint_design_lens_unsupported` for that profile

#### Scenario: catalog not ready gets no component-design entry
- **WHEN** the catalog is missing or empty
- **THEN** next_steps MUST NOT include `component-design`

#### Scenario: design_entry_ready rejects workflow_artifact
- **WHEN** an index entry declares `when: design_entry_ready` with a
  `workflow_artifact`
- **THEN** the skills.index lint MUST report `unexpected_workflow_artifact`

> **Enforced by:** `harness/scripts/utils/init-next-steps.ts`,
> `harness/scripts/utils/finalize-init-run-log.ts`,
> `harness/scripts/init-orchestrate.ts`,
> `harness/scripts/check-skills-index-init-steps.ts`,
> `harness/scripts/utils/skills-index-init-steps.ts`,
> `harness/scripts/utils/blueprint-provider-boundary.ts`,
> `harness/scripts/check-component-blueprint.ts`,
> `harness/code-graph/module-graph-probe.ts`,
> `skills/skills.index.yaml`,
> `skills/project/framework-init/SKILL.md`,
> `harness/tests/unit/init-next-steps.unit.test.ts`,
> `harness/tests/unit/module-graph-probe.unit.test.ts`,
> `harness/tests/unit/skills-index-init-steps.unit.test.ts`,
> `harness/tests/unit/component-blueprint.unit.test.ts`
