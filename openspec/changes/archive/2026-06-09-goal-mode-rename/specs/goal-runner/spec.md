## MODIFIED Requirements

### Requirement: Goal run evidence layer

The system SHALL persist each run under `{paths.features_dir}/<feature>/goal-runs/<run-id>/` (default `doc/features/<feature>/goal-runs/<run-id>/`) with `manifest.json`, `events.jsonl`, per-phase artifacts, and final `goal-report.{md,json}`. `manifest.feature` SHALL be required for new runs.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/goal-manifest.ts`, `harness/scripts/utils/goal-report-generator.ts`

#### Scenario: Resume requires feature or manifest

- **WHEN** user invokes goal-runner with `--resume <run-id>` without `--feature` and without `--manifest`
- **THEN** runner MUST exit non-zero with a message requiring `--feature` or `--manifest`

#### Scenario: Resume with feature loads single path

- **WHEN** user invokes goal-runner with `--resume <run-id> --feature <f>`
- **THEN** runner loads manifest from `{features_dir}/<f>/goal-runs/<run-id>/manifest.json` and continues from last incomplete phase
