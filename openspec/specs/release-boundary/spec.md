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

### Requirement: Candidate testing cannot replace formal release testing

Candidate build SHALL execute the daily test gate, pack once, and verify and run
consumer lifecycle smoke against that same zip. Candidate completion MUST NOT
claim formal release qualification.

Formal `release:all` MUST retain full testing. Candidate promotion MUST either
reuse a passing full result and `completeRun` for the matching stable source
snapshot, or execute the full gate on that matching source. Daily results and
changed selection MUST NOT satisfy this requirement. Sanitized, LF-normalized
source release contents MUST match the candidate contents; matching HEAD alone
is insufficient. Promotion SHALL move the original candidate zip.

#### Scenario: Daily candidate still needs formal proof
- **WHEN** a candidate has passed daily tests, zip verification and consumer smoke
- **THEN** promotion MUST still require matching full test proof and the existing formal gates

#### Scenario: Full proof has the wrong source
- **WHEN** full results are unstable, incomplete or belong to a source whose release contents differ from the candidate
- **THEN** promotion MUST reject that proof and MUST NOT move the candidate to a formal artifact

#### Scenario: Developer test scripts are sanitized
- **WHEN** a consumer artifact is staged
- **THEN** development `test:*`, `candidate:*` and `release:*` scripts MUST be removed
- **AND** consumer `harness/package.json` SHALL keep `npm test` as `check:global`

> **Enforced by:** `scripts/candidate-release.mjs`, `scripts/release-all.mjs`, `scripts/release-pack-rules.mjs`, `scripts/tests/candidate-gates.unit.mjs`
