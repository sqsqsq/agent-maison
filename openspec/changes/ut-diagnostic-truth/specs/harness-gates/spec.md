## ADDED Requirements

### Requirement: UT scope is independent of Git staging and honest about feature ownership

The hmos-app UT harness SHALL discover test files from the filesystem. Feature-scoped selection SHALL use explicit current-feature context paths and Git working paths as additive hints, and Git staging MUST NOT be required. Because AC, BD, and branch identifiers are feature-local, an `it()` tag by itself MUST NOT assign a filesystem test to the active feature. When no resolvable path hint exists, the harness SHALL retain the deterministic `scoped = all` fallback and report why it was used.

#### Scenario: Ignored test is explicitly declared by the active feature
- **WHEN** a filesystem-discovered `*.test.ets` file is ignored by Git and its path is declared in the active feature's context-exploration artifact
- **THEN** that file MUST appear in the scoped UT set without `git add`
- **AND** the scope diagnostics MUST identify the context path as its source

#### Scenario: Two features reuse the same local acceptance ID
- **WHEN** an old test and a current test both contain `[AC-01]` but only the current test has a current-feature Git or context path hint
- **THEN** the current test MUST be scoped
- **AND** the old test MUST NOT be added merely because its local tag equals the active feature's `AC-01`

#### Scenario: Consumer project is not a Git repository
- **WHEN** UT runs in a non-Git consumer project
- **THEN** filesystem discovery and explicit context scoping MUST still operate
- **AND** absent all path hints the harness MUST use `fallback:all` with a non-Git diagnostic rather than omit the tests

> **Enforced by:** `profiles/hmos-app/harness/ut-file-scope.ts`, `harness/scripts/utils/ut-it-blocks.ts`, `harness/scripts/check-ut.ts`

### Requirement: UT artifact loading distinguishes missing invalid and loaded inputs

The UT harness SHALL preserve and report the observation state of DAG, testability-audit, mock-plan, and coverage-evidence inputs. A candidate that exists but cannot be parsed or has an invalid root structure MUST produce a path-specific BLOCKER and MUST NOT be reported as missing, silently skipped, or collapsed into an empty evidence set. Diagnostics SHALL include the canonical path or probed directories and a bounded parser or validation error.

#### Scenario: DAG YAML is malformed
- **WHEN** a `*.dag.yaml` candidate exists in an archived or ephemeral DAG directory but YAML parsing fails
- **THEN** the UT report MUST identify that candidate path and parser failure as a BLOCKER
- **AND** downstream coverage output MUST NOT imply that no DAG path was searched

#### Scenario: Coverage evidence JSON is malformed
- **WHEN** the canonical `<features_dir>/<feature>/ut/reports/coverage-evidence.json` exists but is invalid JSON or has an invalid document shape
- **THEN** `ut_coverage_evidence_present` MUST report the exact canonical path and validation problem
- **AND** it MUST NOT describe the file as missing

#### Scenario: Optional UT machine artifact exists but is corrupt
- **WHEN** testability-audit or mock-plan exists but contains an unparseable YAML document or invalid root shape
- **THEN** the harness MUST surface the corrupt artifact as a BLOCKER even if a later consumer would otherwise treat an empty parse result as optional

> **Enforced by:** `harness/scripts/check-ut.ts`, `harness/scripts/utils/coverage-evidence.ts`, `harness/scripts/utils/ut-artifact-parse.ts`, `harness/scripts/utils/ut-artifact-validate.ts`

### Requirement: UT coverage gates report their actual evidence contracts

Each UT coverage gate SHALL state the evidence sources it actually evaluates and SHALL list the bounded set of relevant files or identifiers it inspected on failure. `acceptance_coverage` SHALL evaluate DAG linkage only and MUST NOT instruct the user to add or stage an `it()` case. `ut_case_per_unit_ac` and `ut_coverage_evidence_resolves` SHALL distinguish UT-tag, DAG, ac-coverage, and mapping attempts. `ut_coverage_evidence_present` SHALL require the canonical evidence file and MUST NOT suggest that another evidence source substitutes for presence.

#### Scenario: Tagged UT exists but DAG lacks linkage
- **WHEN** an in-scope test has `[AC-01]` but every loaded DAG omits `AC-01` from top-level and node-level linkage
- **THEN** `acceptance_coverage` MUST fail with a DAG-only explanation and the loaded DAG paths
- **AND** UT-tag-aware gates MAY independently pass from the tagged case

#### Scenario: Skill-authored mapping claims an unresolved source
- **WHEN** a coverage-evidence mapping exists but its declared source has no matching underlying UT tag, archived/ephemeral DAG linkage, or ac-coverage fact
- **THEN** `ut_coverage_evidence_mappings_complete` MUST identify the scope ID, declared source, and failed resolution reason

#### Scenario: AC and BD share the same numeric suffix
- **WHEN** acceptance contains `AC-01` and `BD-01` but a test name contains only `[AC-01]`
- **THEN** the harness MUST count evidence for `AC-01` only
- **AND** it MUST NOT treat `[AC-01]` as coverage for `BD-01`

#### Scenario: Boundary-only test uses a direct BD tag
- **WHEN** a test name starts with `[BD-01]` for a declared boundary
- **THEN** the traceability-name gate MUST accept it without requiring an unrelated AC or branch prefix
- **AND** documentation and gate suggestions MUST teach `[BD-<id>]` as a supported direct form

> **Enforced by:** `harness/scripts/check-ut.ts`, `harness/scripts/utils/ac-coverage-report.ts`, `harness/scripts/utils/coverage-evidence.ts`, `profiles/hmos-app/phase-rules-overlays/ut-rules.overlay.yaml`
