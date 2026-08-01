# skill-quality-tiers Specification

## Purpose
TBD - created by archiving change skill-contracts-assess. Update Purpose after archive.
## Requirements
### Requirement: Business UT supports full and basic depth
The business-UT contract and `harness/scripts/check-ut.ts` SHALL select full depth when plan and contracts inputs are present and basic depth when supported optional inputs are absent. Acceptance coverage and applicable toolchain gates MUST remain blocking at both depths.

#### Scenario: Plan is absent but required UT inputs exist
- **WHEN** business UT runs with source and acceptance inputs but without plan
- **THEN** it SHALL derive test scope from diff scope and module catalog, record basic depth, and preserve all basic-tier PASS criteria

### Requirement: Device testing supports artifact and adhoc case inputs
The device-testing contract SHALL accept either `acceptance@1` or normalized natural-language cases. `harness/scripts/adhoc-device-test.ts` and the feature-phase testing path SHALL share the same normalization and check kernel.

#### Scenario: Natural-language cases are supplied
- **WHEN** device testing receives supported adhoc case text instead of acceptance artifacts
- **THEN** it SHALL normalize the cases, record adhoc depth, and execute the same device truth gates

### Requirement: Code review supports explicit basic depth
The code-review contract and review check SHALL allow basic depth when spec/contracts inputs are absent, using module catalog, glossary, and code intent, while declaring the missing inputs in `review-report.md` and `summary.json`.

#### Scenario: Review lacks spec and contracts
- **WHEN** review has source context but no spec/contracts
- **THEN** it SHALL run the basic review contract and SHALL NOT label the result full

### Requirement: Degradation never weakens truth semantics
Tier selection SHALL change analysis depth only. FAIL, INCOMPLETE, external-block, device-policy, toolchain, and applicable quality-gate semantics enforced by `specs/phase-rules/*.yaml` and `harness/scripts/check-*.ts` MUST NOT be downgraded into PASS.

#### Scenario: External device condition blocks an adhoc test
- **WHEN** device testing cannot establish a required device condition
- **THEN** it MUST retain the existing external-block verdict regardless of adhoc depth
