## MODIFIED Requirements

### Requirement: Code Graph project Skill entry

The framework SHALL expose project Skill `code-graph` at `skills/project/code-graph/SKILL.md`. It SHALL perform the requested derived generation, curation or drift check using existing profile GraphExtractor and validators. Generation SHALL preserve existing curation, and curation SHALL require the existing semantic confirmation only when requested. Profile assets SHALL resolve via `profile-skill-asset:code-graph/<key>`.

#### Scenario: User invokes Skill for one module
- **WHEN** a user requests generation for a module with a valid catalog mapping or explicit source package
- **THEN** the agent SHALL generate and check that module without requiring all-project catalog, glossary, curation or UT execution

#### Scenario: generic profile drift-only boundary
- **WHEN** project_profile is generic and no extractor is available
- **THEN** generation SHALL report the existing capability gap while drift checking remains available

### Requirement: module-graph global harness phase

The framework SHALL provide `module-graph` through the existing checker, phase rule and workflow with global scope. Catalog SHALL be an optional source of module identity rather than an unconditional control predecessor. Selected module and package-path parameters SHALL resolve identically for generation and checking. Invalid explicit sources MUST fail rather than silently falling back.

#### Scenario: Zero graphs pass for a project scan
- **WHEN** the module catalog exists but no graph exists and no module was explicitly selected
- **THEN** the project scan SHALL return PASS with optional guidance to build a graph

#### Scenario: Explicit module has no graph
- **WHEN** the caller selects a module without its requested graph
- **THEN** the checker SHALL report that specific gap rather than returning a zero-graph PASS

#### Scenario: Schema invalid fails
- **WHEN** the selected graph has invalid schema or mismatched module identity
- **THEN** code_graph_schema_valid SHALL emit BLOCKER FAIL

#### Scenario: Drift severity mapping
- **WHEN** evaluateCodeGraphDrift reports missing anchors, symbols or changed core anchors
- **THEN** the existing BLOCKER checks SHALL fail; non-core body changes SHALL remain WARN
