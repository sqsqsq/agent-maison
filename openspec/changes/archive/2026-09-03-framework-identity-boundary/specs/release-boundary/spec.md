## ADDED Requirements

### Requirement: Vendor handover documents never enter the consumer release

`docs/vendor/**` holds requirement and handover material exchanged with external vendors during development. It SHALL NOT be shipped in the consumer release artifact, and its exclusion SHALL be declared in `scripts/release-excludes.json` so the packer, the release verify gate, and `.npmignore` share one source of truth. Excluding it at runtime — by ignoring it in an integrity or freshness check while it still ships — SHALL NOT be used as a substitute, because that leaves the same mismatch for the next mechanism to trip over.

Enforcement: `scripts/release-excludes.json`, `scripts/pack-release.mjs`, `scripts/verify-release-pack.mjs`

#### Scenario: vendor requirement documents are absent from the zip

- **WHEN** `npm run release:pack` is executed
- **THEN** the output zip SHALL NOT contain any path starting with `docs/vendor/`

#### Scenario: the rest of docs still ships

- **WHEN** `npm run release:pack` is executed
- **THEN** consumer-facing documentation under `docs/` outside `docs/vendor/` SHALL still be present
