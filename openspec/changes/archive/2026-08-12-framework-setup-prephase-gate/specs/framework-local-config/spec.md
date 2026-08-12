# Delta: Framework Local Config — Inline ensure

## ADDED Requirements

### Requirement: Personal setup JSON contract for phase entry

`check-personal-setup.ts --json --ensure` MUST emit stable fields:
`ok`, `code`, `status`, `activeAdapter`, `materializedAdapters`, `ensured`,
`candidates`, `message`. Phase SKILLs and tests MUST parse this JSON only.

#### Scenario: needs_adapter_choice exposes candidates
- **WHEN** multiple materialized adapters exist and personal setup is fallback
- **THEN** JSON includes `code: "needs_adapter_choice"` and `candidates` listing adapter names

> **Enforced by:** `harness/scripts/utils/personal-setup-gate.ts`, `skills/reference/personal-setup-gate.md`
