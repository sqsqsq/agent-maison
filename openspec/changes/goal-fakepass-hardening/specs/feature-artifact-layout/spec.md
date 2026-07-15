## ADDED Requirements

### Requirement: Phase closures carry acyclic evidence manifests derived from the loader SSOT

Each phase closure SHALL produce `phase-evidence-manifest.json` recording inputs, outputs, environment (framework_version, profile, workflow_hash, framework_config_hash) and an aggregate hash. The file set SHALL be resolved by `resolvePhaseEvidenceManifest()` reusing/extending the spec-loader REQUIRED/OPTIONAL tables plus per-phase outputs and the source inventory reference — no second hand-written table. Encapsulation order is fixed and acyclic: reports and receipt body first; receipt canonicalized excluding fingerprint/manifest-pointer fields, then hashed; manifest generated (never hashing itself); receipt/summary store only the manifest path + sha256; verifiers recompute listed evidence hashes before checking the manifest hash. Staleness SHALL be recomputed at the two consumption points (truncated-chain preflight, verify-feature-completion): any changed input or output marks that closure and all downstream closures of the track-resolved chain STALE.

Enforcement: `harness/scripts/utils/phase-evidence-manifest.ts`（新增）, `harness/scripts/utils/spec-loader.ts`, receipt/summary schemas

#### Scenario: editing acceptance.yaml after spec closure stales downstream

- **WHEN** acceptance.yaml is modified after the spec phase closed
- **THEN** preflight recomputation SHALL mark the spec closure and all downstream closures STALE

### Requirement: New governance artifacts have fixed locations and ownership

The feature tree SHALL host: `<phase>/headless-assumptions.jsonl` (agent-written, schema-checked) with optional markdown projection; `review/reports/review-closure-attestation.json` (harness-written at closure); `testing/skip-waivers.yaml` and `<phase>/behavior-switch-waivers.yaml` (coordinate-bound, receipt-backed); acceptance.yaml extended with `flows` and per-AC structured checkpoints plus `requirement_ref`. `feature-completion.json` originals live in the runner-owned run directory (atomic write); the feature directory holds only a projection/reference. All are consumed via recomputation-based verification, never via existence checks.

Enforcement: `harness/scripts/utils/{closure-attestation,verify-feature-completion,confirmation-receipt}.ts`, acceptance schema, `specs/phase-rules/*.yaml`

#### Scenario: completion projection without a verifiable original

- **WHEN** the feature directory contains a completion projection whose runner-owned original fails recomputation
- **THEN** consumers SHALL treat the feature as not completed (verify result INVALID/STALE)
