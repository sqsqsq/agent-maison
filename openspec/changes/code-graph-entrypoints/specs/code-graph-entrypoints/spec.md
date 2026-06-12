## ADDED Requirements

### Requirement: Code Graph project Skill entry

The framework SHALL expose a project-scoped Skill `code-graph` at `skills/project/code-graph/SKILL.md` that orchestrates: derived generation (via profile `GraphExtractor` when available), human curation of `core`/`intent`, self-check via `evaluateCodeGraphDrift()`, and passing the `module-graph` harness phase. Profile-specific assets SHALL resolve via `profile-skill-asset:code-graph/<key>` from each profile's `skill-assets.yaml`.

#### Scenario: User invokes Skill for one module
- **WHEN** a user runs `/code-graph <ModuleName>` or follows the Skill SSOT for a catalog module
- **THEN** the agent follows the staged flow (derive → curate → drift self-check → harness gate) documented in the public SKILL

#### Scenario: generic profile drift-only boundary
- **WHEN** `project_profile` is `generic`
- **THEN** the profile addendum states generation is unsupported and only drift checking via `--phase module-graph` is available

### Requirement: module-graph global harness phase

The framework SHALL provide harness phase `module-graph` implemented by `harness/scripts/check-module-graph.ts`, registered in `specs/phase-rules/module-graph-rules.yaml` and `workflows/spec-driven.workflow.yaml` with `scope: global` and `requires: [catalog]`.

#### Scenario: Zero graphs pass
- **WHEN** the module catalog exists but no module has an on-disk `code-graph.yaml`
- **THEN** the phase returns PASS with guidance to use the `code-graph` Skill

#### Scenario: Schema invalid fails
- **WHEN** an on-disk `code-graph.yaml` violates schema (missing `schema_version`, `module`, or valid `nodes[].anchor` including `content_hash`)
- **THEN** check `code_graph_schema_valid` emits FAIL with BLOCKER severity

#### Scenario: Drift severity mapping
- **WHEN** `evaluateCodeGraphDrift()` reports `anchor_file_missing`, `anchor_symbol_missing`, or `core_anchor_changed`
- **THEN** the phase maps them to BLOCKER FAIL results
- **WHEN** `evaluateCodeGraphDrift()` reports `body_hash_changed` on a non-core node
- **THEN** the phase maps to WARN

### Requirement: GraphExtractor via profile-host-loader

`GraphExtractor` providers SHALL load only through `tryLoadGraphExtractor(profileDir)` in `profile-host-loader.ts`. `bootstrap-code-graph.ts` SHALL NOT hardcode a profile-specific extractor import.

#### Scenario: hmos-app bootstrap resolves provider
- **WHEN** `bootstrap:code-graph` runs with `project_profile: hmos-app`
- **THEN** the profile `graphExtractor` is loaded dynamically via `graph-extractor` or legacy `hmos-graph-extractor` module and generation proceeds

#### Scenario: Missing provider clear error
- **WHEN** `bootstrap:code-graph` runs for a profile without a registered extractor
- **THEN** the CLI exits with a message that the current profile does not support Code Graph generation

### Requirement: module-graph does not validate flow DAG

The `module-graph` phase SHALL validate Code Graph anchors and drift only. It SHALL NOT validate UT flow DAG continuity (`edge.kind`, `evidence`, `continuity_gaps`).

#### Scenario: Phase scope boundary
- **WHEN** `--phase module-graph` runs
- **THEN** it does not require or parse business-ut flow DAG artifacts
