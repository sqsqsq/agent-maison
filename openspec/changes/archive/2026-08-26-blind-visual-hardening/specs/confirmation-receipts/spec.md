## ADDED Requirements

### Requirement: Human visual acceptance is a structured receipt with frozen thresholds and bounded remit

A new consumption action `human_visual_acceptance` SHALL validate receipts binding: feature; build_fingerprint; rubric_version; policy_hash; gate_fingerprint; a structured screens mapping `[{screen_id, variant, reference_sha256, actual_sha256}]` (hash-array reordering cannot pass); rubric scores `{container, hierarchy, density, state_color}`; verdict; accepted_debt_ids[]; signed_by/signed_at. Thresholds are frozen before acceptance and SHALL NOT be recalibrated after seeing results: each dimension ≥4/5 by default; any dimension at 3 requires an explicit accepted_debt_id; any dimension at 1–2 SHALL NOT pass. A valid receipt clears subjective visual debt only (visual UNVERIFIED→PASS, debt entries → `accepted` with accepted_by + receipt reference — never rewritten to `closed`); it SHALL NOT clear deterministic FAILs (blank assets, missing/stale evidence, hash mismatches — needs_fix items clear only by fix + re-run). Any bound hash or policy_hash mismatch SHALL stale the receipt. Trust-anchor validation reuses the existing confirmation-receipt consumption contract; issuance remains out of scope.

Enforcement: `harness/scripts/utils/confirmation-receipt.ts`, `harness/scripts/utils/visual-debt.ts`（新增）, `harness/scripts/check-receipt.ts`

#### Scenario: a receipt attempts to clear a blank-asset FAIL

- **WHEN** a valid human_visual_acceptance receipt lists a debt id whose source check is the blank-materialization BLOCKER
- **THEN** validation SHALL reject clearing that entry, leaving the deterministic FAIL and its release block intact

#### Scenario: reordered hashes fail closed

- **WHEN** a receipt's screens mapping pairs screen A's reference hash with screen B's actual hash
- **THEN** binding validation SHALL fail the receipt as stale/invalid rather than accepting set-equality
