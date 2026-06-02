## Why

Every requirement — even a few-line change — currently produces an archived flow DAG under `{module}/test/dag/`, which is disproportionate. Worse, the UT coverage gates read DAG only from that archived path (`check-ut.ts > loadDagFiles`), so if we simply stop archiving, gates like `branch_coverage_full` / `ut_case_per_unit_ac` silently degrade to SKIP. We need flow DAGs to be ephemeral by default while keeping coverage enforcement intact via a machine-readable evidence contract.

## What Changes

- **flow DAG ephemeral by default**: written to the reports/temp location, NOT archived into `{module}/test/dag/`, unless the user explicitly requests archival or a Code Graph `core` node is touched (see `define-code-graph-concepts` / Skill 5 Step 8.0).
- **Machine-readable coverage evidence**: introduce `doc/features/<feature>/ut/reports/coverage-evidence.json` recording `evidence_source ∈ {dag_archived, dag_ephemeral, ac_coverage, ut_tags}`, the evidence file path, and an AC/branch → evidence mapping.
- **Evidence priority order**: archived DAG > ephemeral DAG > `ac-coverage.json` > UT `it()` tags. Coverage gates consume the highest available source.
- **Loader + gate behavior**: extend `loadDagFiles` to also scan the ephemeral location; `branch_coverage_full` / `ut_case_per_unit_ac` take the highest available evidence source and may SKIP **only explicitly with a recorded downgrade reason** — never a silent pass.

## Capabilities

### New Capabilities
- `ut-flow-dag-evidence`: flow DAG archival policy (ephemeral by default) plus a machine-readable coverage-evidence contract with a defined source-priority order that keeps UT coverage gates enforced when DAGs are not archived.

### Modified Capabilities
<!-- None at requirement level. Existing harness-gates requirements are unchanged; UT coverage rules live in specs/phase-rules/ut-rules.yaml (runtime SSOT) and this change adds new normative behavior rather than altering an existing OpenSpec requirement. -->

## Impact

- **Phase 5 (business-ut)**. Touched files: `harness/scripts/check-ut.ts` (`loadDagFiles` + coverage checks), `specs/phase-rules/ut-rules.yaml`, `skills/5-business-ut/SKILL.md` (archival wording), reports path under `doc/features/<feature>/ut/reports/`. Profile overlay `profiles/hmos-app/phase-rules-overlays/ut-rules.overlay.yaml` if hmos-app specifics apply.
- **No breaking change for existing archived DAGs**: they remain the highest-priority evidence source, so already-passing features keep passing. No consumer migration required; MIGRATION.md unaffected (note added if any default flips for in-flight features).
- **Also ships (merged Track B P3/P4):** module seam/mock registry template + Skill 5 wiring; characterization path-c (`flow_type`/`origin`, harness gates, `paths/path-c-characterization.md`).
- **Depends on** `define-code-graph-concepts` for Code Graph / core archival semantics.
- Sequencing tracked in `.cursor/plans/code-graph-ut-evolution_f8fa08ee.plan.md` (Track B / P1, the low-risk quick win).
- **Target release window: `2.2.0`** (per that plan's `version`; 2.2.0 is the current open window). This change carries no enforced version field — version association flows through the plan; the version-evolution mechanism governs `.cursor/plans/*` only, not `openspec/`.
