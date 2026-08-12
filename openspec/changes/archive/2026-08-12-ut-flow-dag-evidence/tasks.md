## 1. Coverage-evidence contract

- [x] 1.1 Define `coverage-evidence.json` schema (fields: `evidence_source` enum, evidence path(s), AC/branch → evidence mapping) and document it in a business-ut template
- [x] 1.2 Make business-ut emit `doc/features/<feature>/ut/reports/coverage-evidence.json` when the feature has ≥1 `ut_layer ∈ {unit, both}` AC/BD; for device-only or profile-UT-disabled features, omit or emit empty with a recorded reason
- [x] 1.3 (If applicable) add `coverage-evidence` to `validate:ut-artifact` so the file is schema-validated

## 2. Ephemeral flow DAG default

- [x] 2.1 Update `skills/feature/business-ut/SKILL.md` Step 2 + path-c + registry references
- [x] 2.2 Harness must not fabricate coverage-evidence mappings; present gate FAIL when file missing (P0/P1 scope)
- [x] 2.2 Update `specs/phase-rules/ut-rules.yaml` so DAG archival under `{module}/test/dag/` is no longer required by default

## 3. Loader + gate enforcement

- [x] 3.1 Extend `harness/scripts/check-ut.ts > loadDagFiles` to also scan the ephemeral DAG location
- [x] 3.2 Add an evidence resolver implementing the priority order (archived DAG > ephemeral DAG > ac-coverage.json > ut_tags) driven by `coverage-evidence.json`
- [x] 3.3 Update `branch_coverage_full` / `ut_case_per_unit_ac` to consume the resolver; for in-scope unit/both AC/branch with no evidence emit FAIL (BLOCKER)/INCOMPLETE — SKIP only under the allowlist (no unit/both scope, profile disables UT, registered compat downgrade) with a recorded reason; never silent pass
- [x] 3.4 Surface the evidence source / downgrade reason in the UT status panel output

## 4. Regression coverage

- [x] 4.1 Add harness fixtures: (a) ephemeral DAG present → coverage gate evaluates against it; (b) in-scope unit/both AC with no evidence → FAIL/INCOMPLETE (not SKIP, not pass); (c) SKIP-allowed case (no unit/both scope or profile UT disabled) → explicit SKIP with reason; (d) archived DAG still highest priority
- [x] 4.2 Confirm an existing already-archived feature still passes unchanged

## 5. Verify

- [x] 5.1 `cd harness && npm test` (unit + fixtures) green
- [x] 5.2 `npm run openspec -- validate ut-flow-dag-evidence --strict`
- [x] 5.3 `npm run release:verify` passes (publishable content touched: skills/, specs/, harness/)
- [x] 5.4 Update `MIGRATION.md` only if a default flip affects in-flight consumer features
