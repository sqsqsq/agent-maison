## ADDED Requirements

### Requirement: flow DAG is ephemeral by default

A requirement-level flow DAG SHALL default to ephemeral storage under the feature reports area (e.g. `doc/features/<feature>/ut/reports/.../dag/`) and SHALL NOT be archived into `{module}/test/dag/` unless archival is explicitly requested. (The "Code Graph core node touched → archive" trigger is defined in capability `code-graph` / business-ut Step 8.0.)

#### Scenario: Small requirement does not archive a DAG
- **WHEN** business-ut generates a flow DAG for a requirement without an explicit archival request
- **THEN** the DAG is written to the ephemeral reports location and no file is created under `{module}/test/dag/`

#### Scenario: Explicit archival request still archives
- **WHEN** the user explicitly requests that a flow DAG be archived
- **THEN** the DAG is written under `{module}/test/dag/` as before

> **Enforced by:** `skills/feature/business-ut/SKILL.md`, `specs/phase-rules/ut-rules.yaml`, `harness/scripts/check-ut.ts`

### Requirement: Machine-readable coverage evidence

When a feature has at least one `ut_layer ∈ {unit, both}` **P0 or P1** AC/BD, business-ut SHALL emit a machine-readable `doc/features/<feature>/ut/reports/coverage-evidence.json` that records the `evidence_source` (one of `dag_archived`, `dag_ephemeral`, `ac_coverage`, `ut_tags`), the path to the evidence file(s), and a mapping from each **covered** P0/P1 AC / branch to its supporting evidence. When a feature has only device-only AC, only P2+ unit/both items, or the active profile disables UT compile/run, the file MAY be omitted or emitted empty with a recorded reason.

#### Scenario: Evidence file is produced when P0/P1 unit/both coverage exists
- **WHEN** the UT phase completes for a feature that has at least one `ut_layer ∈ {unit, both}` **P0 or P1** AC/BD
- **THEN** `coverage-evidence.json` exists and contains `evidence_source`, evidence path(s), and parseable mappings for covered P0/P1 scopes

#### Scenario: No unit/both scope needs no evidence
- **WHEN** a feature has only device-only AC, or the active profile disables UT compile/run
- **THEN** `coverage-evidence.json` MAY be omitted or emitted empty, accompanied by a recorded reason (no unit/both coverage to evidence)

#### Scenario: Evidence source is one of the allowed values
- **WHEN** `coverage-evidence.json` is present and validated
- **THEN** every `evidence_source` value is within `{dag_archived, dag_ephemeral, ac_coverage, ut_tags}`

### Requirement: Coverage evidence priority order

Coverage gates SHALL resolve evidence using a fixed priority order — archived DAG > ephemeral DAG > `ac-coverage.json` > UT `it()` tags — and consume the highest available source for each covered AC / branch.

#### Scenario: Highest available source wins
- **WHEN** both an ephemeral DAG and `ac-coverage.json` are available for a feature with no archived DAG
- **THEN** coverage gates evaluate against the ephemeral DAG (higher priority) rather than `ac-coverage.json`

#### Scenario: Tags as last-resort evidence
- **WHEN** no DAG (archived or ephemeral) and no `ac-coverage.json` exist, but UT `it()` tags are present
- **THEN** coverage gates evaluate against the `it()` tags

### Requirement: Missing evidence for in-scope unit/both coverage fails, not skips

For every in-scope `ut_layer ∈ {unit, both}` **P0 or P1** AC / boundary, if no coverage evidence is resolvable through the priority order, `branch_coverage_full` and `ut_case_per_unit_ac` MUST report FAIL (BLOCKER) or INCOMPLETE — they MUST NOT pass and MUST NOT silently SKIP. An explicit SKIP is permitted ONLY when one of the following holds and the reason is recorded: the feature has no unit/both P0/P1 UT scope, the active profile disables UT compile/run, or an explicit compatibility downgrade is registered. The DAG loader (`loadDagFiles`) SHALL also scan the ephemeral location, not only `{module}/test/dag/`.

Resolvers SHALL treat DAG evidence as present when `linked_acceptance` / `linked_boundaries` appear on the DAG root **or** on any `nodes[]` entry (e.g. assertion nodes). Resolvers SHALL treat `ac_coverage` as present when `doc/features/<feature>/ut/reports/ac-coverage.json` lists the scope with `ut_covered: true`.

#### Scenario: In-scope P0/P1 unit/both AC without evidence fails
- **WHEN** an in-scope `ut_layer ∈ {unit, both}` **P0 or P1** AC / boundary has no resolvable evidence
- **AND** none of the SKIP-allowed conditions hold
- **THEN** the gate reports FAIL (BLOCKER) or INCOMPLETE, not SKIP and not pass

#### Scenario: SKIP only under allowed conditions with a reason
- **WHEN** the feature has no unit/both UT scope, or the active profile disables UT compile/run, or an explicit compatibility downgrade is registered
- **THEN** the gate MAY SKIP, and MUST record the reason

#### Scenario: Loader scans ephemeral location
- **WHEN** a feature has only an ephemeral flow DAG (no archived DAG)
- **THEN** `loadDagFiles` discovers the ephemeral DAG so coverage gates can evaluate against it

### Requirement: Harness must not fabricate coverage mappings

`check-ut.ts` MUST NOT synthesize per-AC `mappings[]` rows in `coverage-evidence.json`. Only business-ut (or a human) MAY author mappings. Harness MAY validate mappings only when each row's `evidence_source` matches its backing (strict): `ut_tags` → UT tag present; `dag_*` → DAG link for that scope; `ac_coverage` → `ac-coverage.json` `ut_covered: true`. `ac-coverage.json` SHALL be written before evidence gates run (same UT pass, in-memory or on disk).

#### Scenario: Second harness run does not self-pass via invented mappings
- **WHEN** harness runs twice without business-ut updating `coverage-evidence.json`
- **THEN** the second run does not PASS solely because the first run wrote blanket mappings

#### Scenario: Present gate fails when P0/P1 unit/both scope lacks file
- **WHEN** in-scope unit/both P0/P1 AC/BD exist and `coverage-evidence.json` is missing
- **THEN** `ut_coverage_evidence_present` reports FAIL (BLOCKER), not WARN

#### Scenario: Mappings complete for P0/P1 when file exists
- **WHEN** `coverage-evidence.json` exists and the feature has unit/both P0/P1 AC/BD
- **THEN** `ut_coverage_evidence_mappings_complete` requires a `mappings[]` row per P0/P1 scope id, each backed by resolvable evidence (not an empty shell row)

### Requirement: Module seam/mock registry

Module-level seam and reusable mock/fixture artifacts SHALL live under `doc/modules/<module>/ut-registry/` (schema in profile template `module-seam-mock-registry-schema`). Feature-level `testability-audit.md` and `mock-plan.yaml` SHALL derive from or reference the registry, not recreate seams per requirement.

#### Scenario: business-ut references registry first
- **WHEN** business-ut Step 1.5/1.6 runs for a module with an existing registry
- **THEN** the skill consults `ut-registry/seams.yaml` before inventing new seams

### Requirement: Characterization path-c

business-ut SHALL support `flow_type: characterization` with per-node `origin` metadata, `[CHAR-*]` UT naming, and harness rules `origin_tag_required` / `characterization_trace_matches`. Demand-side coverage rules (`ut_case_per_unit_ac`, `acceptance_coverage`, `branch_coverage_full`) SHALL SKIP only when **all** DAGs with a declared `flow_type` are `characterization` (mixed spec-driven + characterization MUST NOT disable spec-driven gates).

#### Scenario: Mixed DAG types keep AC gates
- **WHEN** a feature has both characterization and non-characterization flow DAGs
- **THEN** `ut_case_per_unit_ac` and related gates still run for spec-driven coverage

#### Scenario: All-characterization feature skips demand-side AC gates
- **WHEN** every DAG with `flow_type` set is `characterization`
- **THEN** demand-side AC/branch coverage gates SKIP with an explicit reason

> **Enforced by:** `harness/scripts/check-ut.ts`, `specs/phase-rules/ut-rules.yaml`
