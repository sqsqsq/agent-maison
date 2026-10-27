## ADDED Requirements

### Requirement: Verifier material retains current evidence and diagnosis context

Verifier request production and current-disposition assembly SHALL share related acceptance evidence selection. The original producer SHALL anchor relevant material through the existing request/material and frozen execution originals. Verification result writes, finding closure, normal downstream reruns and changing latest-report timestamps MUST NOT remove that evidence or oscillate the subject. Real related input changes or invalid evidence SHALL refresh material through the existing path.

Writer and runtime diagnosis SHALL share complete existing diagnosis context, including report text, rows, diagnostics, refusal basis and current subject. Evidence references MAY be project-relative or uniquely resolvable current-Feature-relative and SHALL normalize to project-relative POSIX material labels. A bad reference SHALL retain its specific diagnostic and other valid references; ambiguity, boundary escape and missing necessary evidence MUST NOT be guessed or automatically confirmed.

#### Scenario: Closing a finding does not remove reviewed counterevidence

- **WHEN** the original verifier closes an old finding after reviewing frozen current counterevidence and the formal gate reruns
- **THEN** the relevant request/material anchor remains applicable without another model call solely because the open-finding set decreased

#### Scenario: Mixed valid and invalid evidence references

- **WHEN** a finding contains a uniquely resolvable Feature-relative reference and another unreadable reference
- **THEN** the valid reference remains comparable with material labels and the unreadable reference produces its concrete existing diagnostic

### Requirement: Materialized execution guidance follows current work

Phase Skills and materialized agent roles SHALL distinguish the original verifier total verdict from the current required work disposition. The source Claude verifier template SHALL generate the Codex verifier through the existing generator. Existing adapter materialization/update SHALL carry the same guidance into the actual loaded roles and Skill/prompt inputs, without inventing a Codex phase-executor TOML or changing custom user authorization.

#### Scenario: Updating a consumer refreshes actual role instructions

- **WHEN** an isolated consumer performs the existing adapter update for Claude and Codex
- **THEN** the loaded phase-executor/verifier and Skill bridges resolve to the synchronized current-work rules and the generated verifier matches its source
