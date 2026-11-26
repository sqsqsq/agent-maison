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

### Requirement: Vendor handover documents never enter the consumer release

`docs/vendor/**` holds requirement and handover material exchanged with external vendors during development. It SHALL NOT be shipped in the consumer release artifact, and its exclusion SHALL be declared in `scripts/release-excludes.json` so the packer, the release verify gate, and `.npmignore` share one source of truth. Excluding it at runtime — by ignoring it in an integrity or freshness check while it still ships — SHALL NOT be used as a substitute, because that leaves the same mismatch for the next mechanism to trip over.

Enforcement: `scripts/release-excludes.json`, `scripts/pack-release.mjs`, `scripts/verify-release-pack.mjs`

#### Scenario: vendor requirement documents are absent from the zip

- **WHEN** `npm run release:pack` is executed
- **THEN** the output zip SHALL NOT contain any path starting with `docs/vendor/`

#### Scenario: the rest of docs still ships

- **WHEN** `npm run release:pack` is executed
- **THEN** consumer-facing documentation under `docs/` outside `docs/vendor/` SHALL still be present

### Requirement: Candidate promotion verifies the build's full test evidence

Candidate build SHALL run the unfiltered root `npm test` once, then pack once,
verify the zip and run consumer lifecycle smoke against the same zip. Build MUST
verify equal start, end and packaging input identities and coverage of every
released source file. It SHALL bind the passing full run and source identity to
the candidate zip and in-zip manifest in the existing sidecar.

Promotion SHALL verify the original build proof, the candidate and manifest
identities, consumer golden, and the release plan gate before moving the original
zip. Selected or older daily results and missing or mismatched build evidence
require a new candidate. Promotion MUST NOT run the full test gate. Standalone
`release:all` MUST run the same root test gate once before packing.

#### Scenario: A candidate retains its original passing full proof
- **WHEN** a candidate passes full testing at build, verifies, and passes same-zip consumer smoke and consumer golden
- **THEN** promotion SHALL check the candidate's proof and current release plan gate
- **AND** a failed release plan gate MAY mark the unchanged candidate eligible

#### Scenario: A candidate lacks matching build proof
- **WHEN** the candidate has only daily results, incomplete proof or mismatched source or artifact identities
- **THEN** promotion MUST reject it before moving the original zip and MUST NOT supplement its test results

#### Scenario: Developer test scripts are sanitized
- **WHEN** a consumer artifact is staged
- **THEN** development `test:*`, `candidate:*` and `release:*` scripts MUST be removed
- **AND** consumer `harness/package.json` SHALL keep `npm test` as `check:global`

> **Enforced by:** `scripts/candidate-release.mjs`, `scripts/release-all.mjs`, `scripts/release-pack-rules.mjs`, `scripts/tests/candidate-gates.unit.mjs`
