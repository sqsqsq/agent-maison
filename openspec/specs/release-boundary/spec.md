# Release Boundary Specification

## Purpose

Define which AgentMaison repository paths belong to the consumer release artifact
and which paths MUST remain developer-only tooling.

## Requirements

### Requirement: Development tools never enter release zip

The system SHALL exclude all directories listed in `scripts/release-excludes.json`
`excludeRootDirs` from the release zip artifact.

#### Scenario: openspec directory excluded
- **WHEN** `npm run release:pack` is executed
- **THEN** the output zip SHALL NOT contain any path starting with `openspec/`

#### Scenario: IDE dev tool directories excluded
- **WHEN** `npm run release:pack` is executed
- **THEN** the output zip SHALL NOT contain any path starting with `.cursor/`, `.claude/`, or `.codex/`

> **Enforced by:** `scripts/release-excludes.json`, `scripts/verify-release-pack.mjs`, `.npmignore`

### Requirement: Release content directories are included

The system SHALL include the directories listed in `AGENTS.md` as release content
(`skills/`, `specs/`, `harness/`, `profiles/`, `agents/`, `workflows/`, `templates/`, `docs/`)
in the release zip artifact.

#### Scenario: Core framework directories present
- **WHEN** `npm run release:pack` is executed
- **THEN** the output zip SHALL contain `skills/`, `specs/`, `harness/`, and `workflows/`

> **Enforced by:** `scripts/pack-release.mjs`, `AGENTS.md`

### Requirement: Release verify gate blocks excluded paths

The system MUST fail release verification when any excluded root directory appears
in the staged zip contents.

#### Scenario: Verify catches openspec leak
- **WHEN** `npm run release:verify` is executed
- **THEN** the verification script MUST assert that `openspec` is absent from the zip

> **Enforced by:** `scripts/verify-release-pack.mjs`, root `package.json` script `release:verify`
