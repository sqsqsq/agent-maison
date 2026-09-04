# project-conventions Specification

## Purpose
定义可选工程惯例资产及其唯一策展入口，使适用惯例从部件蓝图经 CU 契约传递到完整的 review 覆盖台账。

## Requirements
### Requirement: Project conventions are an opt-in single-source knowledge asset

Maison SHALL expose `paths.conventions` with runtime default `doc/conventions.md` and a shared harness resolver. The framework concept document MUST be the only format SSOT. Every convention id MUST be the exact `##` heading text and unique; a review-enforced card MUST NOT declare machine enforcement fields, while a gate card MUST declare both `enforcement: gate` and `gate_ref: <phase>/<rule_id>`. A gate ref MUST resolve to a real rule in the named resolved phase. The asset MUST remain optional: framework initialization and UPDATE-keep MUST NOT create the file or backfill the key.

#### Scenario: Existing consumer has no conventions asset

- **WHEN** an existing consumer omits `paths.conventions` and has no file at the default path
- **THEN** runtime resolution SHALL use the default path without mutating configuration or creating the file

#### Scenario: Gate card points to no real rule

- **WHEN** a convention declares gate enforcement but its phase or rule id cannot be resolved
- **THEN** bootstrap admission and activated review validation SHALL reject that card instead of copying or interpreting gate text

> **Enforced by:** `harness/config.ts`, `specs/framework.config.schema.json`, `templates/framework.config.template.json`, `harness/scripts/utils/config-field-merger.ts`, `docs/concepts/conventions.md`, `harness/scripts/check-review.ts`

### Requirement: Bootstrap is the single confirmed writer

The `/conventions-bootstrap` skill MUST create an empty skeleton only after explicit invocation, inventory review history/incidents, code observations and existing prose, prioritize repeated failures, measure deterministic conformance where practical, classify candidates as established, human-decision-needed or aspirational, and de-duplicate against existing gates. Every persisted card MUST receive an individual human `y` confirmation. Existing gate semantics MUST NOT be copied into a review card; a curated gate index card MAY contain only rationale, a resolvable gate ref and a golden example. Review MUST only suggest promotion and MUST NOT write the asset.

#### Scenario: Candidate is not confirmed

- **WHEN** bootstrap presents a candidate and the user does not answer `y` for that card
- **THEN** the skill MUST leave that candidate out of the conventions asset

#### Scenario: Existing prose is adopted

- **WHEN** an authoritative project document already owns the full convention
- **THEN** bootstrap MUST persist only a short summary and exact link rather than copying the source body

> **Enforced by:** `skills/project/conventions-bootstrap/SKILL.md`, `skills/reference/conventions-bootstrap-workflow.md`, `skills/project/conventions-bootstrap/assets/conventions.template.md`, `skills/skills.index.yaml`, adapter command templates

### Requirement: Conventions flow through blueprint, CU and review without a second authority

When the asset exists, component design MUST read it in full and represent only applicable cards through existing blueprint facts and provenance. CU planning SHALL declare applicable ids and planned locations through normalized Feature contracts. Review SHALL read the asset independently of the CU declaration and publish one coverage row for every convention id. The same id used as an applicable blueprint convention MUST be present in `contracts.conventions_applied` or be assessed `NOT_APPLICABLE` in review when that blueprint is referenced by the CU.

#### Scenario: Applicable convention survives the full chain

- **WHEN** a blueprint fact cites `<configured-conventions-path>#repository-single-source`, the CU touches its applicable scope, and review assesses the target files
- **THEN** the CU SHALL declare `repository-single-source` and the review ledger SHALL contain exactly one row for that id

#### Scenario: Blueprint convention is dropped during construction

- **WHEN** a referenced blueprint cites an applicable convention but the CU omits it and review does not mark it `NOT_APPLICABLE`
- **THEN** review validation SHALL report a MAJOR failure for losing a blueprint design basis

> **Enforced by:** `skills/project/component-design/SKILL.md`, `skills/reference/app-component-blueprint-workflow.md`, `skills/feature/plan/SKILL.md`, `harness/scripts/utils/spec-loader.ts`, `harness/scripts/check-review.ts`

### Requirement: Activated review uses a complete deterministic coverage ledger

If the asset exists, `check-review` SHALL require exact set equality between unique convention headings and unique ledger ids, one of `PASS|VIOLATION|GATE_DELEGATED|NOT_APPLICABLE|NOT_ASSESSED`, an issue-list reference for every VIOLATION, declared ids contained by the asset, every planned location matching at least one target file on a full path-segment boundary, and `GATE_DELEGATED` if and only if the card is gate-enforced. A missing asset with no declaration SHALL skip conventions checks; a missing asset with a non-empty declaration SHALL fail at MAJOR severity.

#### Scenario: Ledger silently omits a card

- **WHEN** the asset has two unique ids but the review ledger has only one
- **THEN** `check-review` SHALL fail exact coverage at MAJOR severity

#### Scenario: Directory prefix collides lexically

- **WHEN** a planned location is `src/data` and the only target file is under `src/database2`
- **THEN** `check-review` SHALL treat the declaration as unfulfilled

#### Scenario: Review card delegates to a gate

- **WHEN** a review-enforced card is assessed `GATE_DELEGATED`
- **THEN** `check-review` SHALL fail because only a gate card can use that verdict

> **Enforced by:** `specs/phase-rules/review-rules.yaml`, `harness/scripts/check-review.ts`, `harness/prompts/verify-review.md`

### Requirement: Existing code violations remain advisory

For cards scoped to new code, review MUST classify uncommitted or untracked lines as new, lines whose blame date is on or after the card effective date as new, and earlier lines as legacy. Legacy violations SHALL be advisory and MUST NOT block. If blame is unavailable or has no history, review MUST use `NOT_ASSESSED` advisory and MUST NOT upgrade it to a blocker.

#### Scenario: Pre-effective-date line violates a convention

- **WHEN** a target line violates a new-code-only convention and its blame date predates the card effective date
- **THEN** review SHALL report a legacy advisory rather than a blocking violation

#### Scenario: Line history cannot be determined

- **WHEN** git blame cannot classify a relevant line
- **THEN** review SHALL use `NOT_ASSESSED` advisory and SHALL NOT block the phase on that convention

> **Enforced by:** `skills/feature/code-review/SKILL.md`, `skills/reference/code-review-workflow-detail.md`, `harness/prompts/verify-review.md`
