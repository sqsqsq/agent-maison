## 1. Concept and configuration

- [x] 1.1 Add `paths.conventions`, the shared `conventionsPath()` resolver, schema/template defaults, and CREATE/UPDATE path tests while keeping UPDATE-keep backfill disabled.
- [x] 1.2 Add the conventions concept/format SSOT, AGENTS optional-asset entry, and DOC_INVENTORY registration.

## 2. Bootstrap workflow and adapters

- [x] 2.1 Add the `conventions-bootstrap` skill, detailed workflow reference, and skeleton/card templates with per-card confirmation and gate-ref validation discipline.
- [x] 2.2 Register the skill and wire all existing adapter command surfaces plus the agent-bundle skills bridge without adding a registry.

## 3. Blueprint and Change Unit consumption

- [x] 3.1 Extend the existing P1 provider validator with the optional `conventions-knowledge` card and honest disabled/degraded semantics; update fixtures and samples.
- [x] 3.2 Teach component-design/app-component-blueprint skills to read and cite applicable conventions through existing facts/provenance and extend the existing review projection renderer and validation fixtures.
- [x] 3.3 Add optional `contracts.conventions_applied` schema/type/SpecLoader normalization with structured shape errors and loader tests.
- [x] 3.4 Add the conditional spec/plan guidance and generic/HMOS plan template section without making it a required chapter.

## 4. Review closure

- [x] 4.1 Extend code-review guidance and `verify-review.md` with target-file-set assessment, full coverage ledger, blueprint continuity, golden-example checks and legacy advisory classification.
- [x] 4.2 Inject configured conventions content into the existing review context/prompt and add an assembly test containing both conventions and target source.
- [x] 4.3 Implement the MAJOR review rule for activation truth table, three-way uniqueness, exact coverage, verdict/issues, normalized declarations, path-segment fulfillment, blueprint continuity, gate-ref existence and gate/delegation equivalence.
- [x] 4.4 Add focused positive and negative fixtures for every deterministic branch and prove the same convention id traverses blueprint, contracts and review.

## 5. Closure and verification

- [x] 5.1 Verify normal/goal parity, documentation/index/adapter consistency, and add one maintainer changelog entry; record any evidenced plan deviation in the change and plan implementation record.
- [x] 5.2 Run affected unit tests, full `cd harness && npm test`, `npm run openspec:validate`, plan validation, `npm run release:verify`, `git diff --check`, and changed-text LF checks.
- [x] 5.3 Reconcile implementation against every OpenSpec requirement, mark plan/OpenSpec tasks complete, and leave the change active and the uncommitted workspace ready for review.

## Verification record（2026-09-04）

The following record is the initial implementation baseline, not acceptance of the review corrections below.

- Harness: typecheck PASS; 4152 unit + 46 fixture cases PASS (zero failures).
- OpenSpec: `npm run openspec:validate` 36/36 PASS including enforcement-path scan; default plan validation PASS.
- Focused conventions: 29/29 including the real P1 resolver/projection → normalized CU contracts → review ledger chain and negative cases.
- Skill/index/adapters: creator validation, docs budget/links, confirmation UX, six host entry surfaces and shared bridge parity PASS.
- Release content: candidate `release:verify --skip-typecheck --skip-plan-release-gate` PASS (temporary zip/manifest/LF/exclusion/extracted entry checks). Full-window `release:verify` is blocked by the unrelated 3.1.0 master plan and b9 pending tasks; their status is unchanged. No dist promotion, commit or OpenSpec archive.
- Diff whitespace and changed-text LF checks PASS; original plan body preserved with only todo status updates and the authorized implementation record appended.

## 6. Bounded review corrections

- [x] 6.1 Validate real convention fact paths/ids in P1 and require node/decision convention refs to correspond to the same fact; cover wrong path, unknown id and orphan references.
- [x] 6.2 Distinguish missing default files from read failures; test default-file EACCES and honest degradation.
- [x] 6.3 Keep all target text sources but represent binary resources by path only; test mixed TS/PNG prompt assembly.
- [x] 6.4 Revalidate the three fixes and direct regressions, run required harness/OpenSpec/plan/diff/EOL gates, and reconcile t3/t4/t5 without addressing non-blocking extra-field suggestions.

### Review correction verification（2026-09-04）

- Three requested fixes completed; conventions 35/35, P1 96/96, M7 projection/handoff 25/25 PASS.
- Fresh full harness run: typecheck + 4158 unit + 46 fixtures PASS, zero failures.
- OpenSpec strict 36/36, default plan check, diff/LF and candidate release-content validation PASS.
- t3/t4/t5 rechecked and restored completed. Contracts extra-field policy remains unchanged (non-blocking); no commit, archive, host modification or dist promotion.
