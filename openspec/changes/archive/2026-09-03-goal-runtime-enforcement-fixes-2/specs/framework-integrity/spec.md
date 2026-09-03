## ADDED Requirements

### Requirement: Canonical enforcement paths are mechanically closed

Repository validation SHALL parse canonical `openspec/specs/*/spec.md` `Enforcement:` lines and require every exact repository-relative file path to exist. Missing exact paths MUST fail strict OpenSpec or release validation; functions, prose labels and supported glob expressions SHALL be classified separately rather than mistaken for exact files.

Enforcement: `scripts/check-openspec-enforcement-paths.mjs`, `package.json`

#### Scenario: Canonical requirement names a removed runtime file
- **WHEN** an `Enforcement:` line contains an exact path to a file that does not exist
- **THEN** repository validation fails and reports the spec line and missing path

#### Scenario: Enforcement names a function beside a valid file
- **WHEN** an `Enforcement:` line names a valid file plus a non-path function symbol
- **THEN** the file is validated and the symbol is not treated as a missing filesystem path
