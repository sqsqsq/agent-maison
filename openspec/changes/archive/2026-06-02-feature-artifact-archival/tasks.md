# Tasks: feature-artifact-archival

## 1. Config SSOT

- [x] 1.1 Add PHASE_SCOPED_ARTIFACTS, ALREADY_PHASED_ARTIFACTS, resolver APIs in harness/config.ts
- [x] 1.2 Add feature-artifact-resolver.unit.test.ts (four input forms + dual-read + legacyDuplicate)

## 2. Wire harness

- [x] 2.1 spec-loader.inspectFeatureArtifacts + loadFeatureDoc
- [x] 2.2 check-catalog feature_scope_integrity
- [x] 2.3 check-coding, check-ut, check-testing, derive-hylyre-plan-hint
- [x] 2.4 check-prd, check-design, check-review labels + legacy duplicate WARN helper
- [x] 2.5 harness-runner collectContextFiles + printFeatureArtifactInspection
- [x] 2.6 backfill-context-exploration ARTIFACT_REL
- [x] 2.7 prd-visual-handoff-check relFeatureArtifact

## 3. Docs & skills

- [x] 3.1 Update skills 0-6, profile addenda, verify prompts, docs, DOC_INVENTORY

## 4. Fixtures & verify

- [x] 4.1 Migrate fixtures; keep legacy flat + add duplicate fixture
- [x] 4.2 npm test + openspec:validate
