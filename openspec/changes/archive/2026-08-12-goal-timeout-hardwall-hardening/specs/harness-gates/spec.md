## ADDED Requirements

### Requirement: Gate internal errors are attributed as framework_bug, not agent content failures

When a phase checker throws a programmer error (TypeError/RangeError/SyntaxError), the `safeRun` wrapper SHALL keep the fail-closed BLOCKER FAIL and additionally set `failure_kind: 'framework_bug'` and `blocking_class: 'framework_internal'` on the result (reusing existing CheckResult/summary-blocker fields — no schema change). Downstream goal-runner classification SHALL treat a fresh, non-empty, all-framework_bug blocker set as `framework_bug` and halt on first touch with guidance to upstream the defect (agent must not modify framework release files nor keep mutating its own artifacts to work around the gate).

Enforcement: `harness/scripts/check-spec.ts`, `check-plan.ts`, `check-coding.ts`, `check-review.ts`, `check-ut.ts` (safeRun), `harness/scripts/utils/goal-failure-classifier.ts`

#### Scenario: Gate crash stops feeding the agent retry loop

- **WHEN** a checker crashes with a TypeError while parsing an agent-authored YAML and the summary is fresh
- **THEN** the goal run SHALL halt with `framework_bug` guidance naming the checker id and stack head, instead of retrying the agent against an unfixable blocker

### Requirement: Agent-authored YAML shape deviations produce structured FAILs, never crashes

Checkers consuming agent-writable YAML/JSON fields (per the source-artifact→loader→field→consumer inventory: ui-spec.yaml assets/screens trees, visual-parity.yaml mappings, asset-crop-vl.yaml entries, contracts/acceptance/use-cases collections) SHALL iterate via a shared `asArray()` guard so that non-array truthy values (`{}`, `""`, nested dicts) or a null parse cannot throw. Each guarded site SHALL be paired with a shape validation that reports a structured FAIL (expected shape + minimal valid sample); an invalid shape passing silently is a defect.

Enforcement: `profiles/hmos-app/harness/*` inventory sites, shared `asArray` util

#### Scenario: Dict-shaped assets fail with guidance instead of crashing

- **WHEN** an agent writes `assets: {}` (or `mappings.components` as a dict) into ui-spec.yaml / visual-parity.yaml
- **THEN** the affected checker SHALL emit a structured FAIL describing the expected list shape and SHALL NOT throw `[Harness 内部错误]`

#### Scenario: Invalid shapes are not silently washed

- **WHEN** `asArray()` converts a non-array value to an empty list at a guarded site
- **THEN** the paired shape validation SHALL still surface a FAIL for that field (coverage asserted by the fixture matrix: `{}`, `""`, nested dict, parse-null)

### Requirement: PRD-to-code traceability entries are validated per entry, not in aggregate

The `plan_to_code` gate SHALL validate every `prd_to_code_traceability` entry individually before running the aggregate file-existence check: each entry SHALL have a non-blank `prd_id` (string, trimmed non-empty); each entry SHALL map at least one key file (`key_files.length > 0`); every key-file path SHALL be a trimmed non-empty, project-root-relative safe path (no absolute paths, drive letters, or `..` segments — reusing `validateProjectRelativePath`, with its throw wrapped into a gate verdict) and SHALL resolve to a regular file (`stat.isFile()`, not a directory). Any violation SHALL produce a BLOCKER FAIL on `plan_to_code` naming the offending entries — never an internal `[Harness 内部错误]` and never a vacuous PASS over an empty or fabricated set.

Enforcement: `harness/scripts/check-coding.ts` (checkDesignToCode)

#### Scenario: A partially empty entry cannot hide behind a valid one

- **WHEN** one entry has `key_files: []` while another entry maps an existing file
- **THEN** the gate SHALL FAIL as BLOCKER, naming the empty entry's `prd_id` and the empty/total count (aggregate-only checking that passes because "all 1 mapped files exist" is forbidden)

#### Scenario: Fabricated paths do not count as traceability

- **WHEN** `key_files` contains `""`, `"."`, a directory path, or a `../`-escaping path
- **THEN** the gate SHALL FAIL as BLOCKER with an actionable message (path must be a project-root-relative regular file), not an internal error

#### Scenario: Entries without a PRD identity fail

- **WHEN** an entry omits `prd_id`, or sets it to `""` or whitespace-only
- **THEN** the gate SHALL FAIL as BLOCKER stating the entry cannot be traced to any PRD, even if its key files exist

#### Scenario: Fully valid traceability passes

- **WHEN** every entry has a non-blank `prd_id` and at least one safe relative path resolving to an existing regular file
- **THEN** the gate SHALL PASS (per-entry strictness must not reject legitimate traceability)
