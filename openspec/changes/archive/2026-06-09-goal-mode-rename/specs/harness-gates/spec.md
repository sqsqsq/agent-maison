## ADDED Requirements

### Requirement: Init gitignore includes feature goal-runs

The system SHALL include `doc/features/*/goal-runs/` in canonical init `.gitignore` patterns via `ensure-gitignore`, without ignoring the entire `doc/features/` tree.

Enforcement: `harness/scripts/utils/canonical-gitignore.ts`, `harness/scripts/utils/init-task-executor.ts`

#### Scenario: Fresh init adds goal-runs ignore

- **WHEN** `ensureCanonicalGitignore` runs on a project without the pattern
- **THEN** `.gitignore` MUST gain `doc/features/*/goal-runs/` while retaining existing `doc/features/*/*/reports/*` and `/doc/features/_adhoc/` patterns
