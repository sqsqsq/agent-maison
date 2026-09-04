## Why

b9e2c7d4 closes the missing shared UI component inventory and traceable reuse decision chain after d8/e4/M7. Existing components, providers, CU references and phase consumers remain authoritative.

## What Changes

- Opt-in, reproducible component index and individually confirmed thin component catalog.
- Blueprint-owned five-level selection, projected through existing CU design refs into Feature components.
- Honest static checks, dependency preflight and review context with live call sites.
- Existing catalog/plan/coding/review phases and six adapter surfaces receive incremental wiring.

## Capabilities

### New Capabilities
- `component-assets`: discovery, curation, selection and static checks.

### Modified Capabilities
- `app-component-blueprint`: optional component-assets seam and flat decision subtype.

## Impact

Framework-only implementation in config, harness, profile, skills, templates and docs. No consumer edits, commits, archives or release. No index means Feature behavior is unchanged. Blueprint cards explicitly report availability. Activated in-flight UI contracts must be completed during plan; MIGRATION documents that opt-in boundary. Real wallet dogfood and m5 remain subsequent closure work.
