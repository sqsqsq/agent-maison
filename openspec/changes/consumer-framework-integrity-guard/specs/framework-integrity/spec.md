## ADDED Requirements

### Requirement: Release artifacts ship a per-file integrity manifest

The release packer SHALL compute a sha256 over the **staged** bytes (post-sanitize, LF-normalized) of every shipped file and write an in-zip manifest `framework/RELEASE-MANIFEST.json` containing `{schema_version, version, files:[{path, sha256}]}`. The in-zip manifest SHALL NOT contain the zip sha (only known after zipping). The dist sidecar manifest SHALL retain the zip sha and reference the in-zip manifest's own hash.

Enforcement: `scripts/pack-release.mjs`, `scripts/verify-release-pack.mjs`

#### Scenario: Per-file hash basis is the staged byte stream

- **WHEN** the packer sanitizes `package.json` / `harness/package.json` / vendor manifest and normalizes EOL to LF during staging
- **THEN** the manifest per-file sha256 SHALL be computed over the staged file bytes, so a consumer that extracts the zip recomputes identical hashes (no false drift from source-vs-staged differences)

#### Scenario: In-zip manifest excludes the zip sha

- **WHEN** the in-zip `RELEASE-MANIFEST.json` is written into staging before zipping
- **THEN** it SHALL contain only schema_version/version/files, while the dist sidecar SHALL carry the zip sha plus the in-zip manifest hash for chained verification

### Requirement: Consumer harness enforces framework source integrity

The harness SHALL run a global `framework_integrity` preflight at the harness-runner entry for **all modes (normal and goal)**, independent of project profile (NOT dispatched via the capability registry, so a profile SKIP or missing provider cannot disable it). It SHALL compare each manifest file's sha256 against the consumer's `framework/<path>`.

Enforcement: `harness/scripts/utils/framework-integrity.ts`, `harness/harness-runner.ts`

#### Scenario: Source/dev layout without manifest is a no-op

- **WHEN** no in-zip `RELEASE-MANIFEST.json` is present (the framework's own source repo, or a non-released integration)
- **THEN** the preflight SHALL return SKIP and never block, so the framework's own `npm test` is unaffected

#### Scenario: Drift in a consumer layout is BLOCKER by default

- **WHEN** the in-zip manifest is present and any listed file is missing or its bytes differ
- **THEN** the preflight SHALL emit a BLOCKER FAIL (`failure_kind=framework_drift`) listing the drifted files, with a suggestion to upstream the fix or opt out

#### Scenario: Explicit opt-out downgrades or allowlists drift

- **WHEN** `framework.config.json` sets `integrity.allow_local_drift=true`
- **THEN** detected drift SHALL be reported as a non-blocking WARN rather than a BLOCKER
- **WHEN** a drifted path is listed in `integrity.drift_allowlist`
- **THEN** that path SHALL be excluded from drift detection
