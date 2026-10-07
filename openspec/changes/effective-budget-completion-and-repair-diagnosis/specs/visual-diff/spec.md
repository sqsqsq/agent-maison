## ADDED Requirements

### Requirement: Deterministic anchor checks inspect screens by their effective disposition

The visual-diff gate SHALL select the screens subject to its deterministic anchor checks from the authorization-filtered effective view: a screen whose effective verdict is pass, or whose effective `visualResidualDisposition` is `minor`, SHALL be inspected, while the inspected list keeps referencing the original screen entries for downstream filtering. A raw excluded major on the same screen as an authorized minor MUST NOT remove that screen from inspection, so a missing anchor on it SHALL still be reported.

Enforcement: `profiles/hmos-app/harness/visual-diff-check.ts`

#### Scenario: An excluded major does not hide a missing anchor

- **WHEN** under the hard tier a screen carries an excluded major and an authorized minor, and its anchor is missing from the capture
- **THEN** the screen SHALL be inspected and the missing anchor SHALL be reported
