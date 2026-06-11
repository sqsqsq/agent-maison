# Design: Feature artifact resolver

## Resolver contract

- `PHASE_SCOPED_ARTIFACTS`: basename → phase (spec.md→prd, design.md→design, review-report.md→review, test-plan.md|test-report.md→testing, testability-audit.md|mock-plan.yaml→ut)
- `ALREADY_PHASED_ARTIFACTS`: no legacy flat path for ut artifacts
- Input normalization: strip leading `<phase>/` if present before lookup (idempotent for `ut/mock-plan.yaml` vs `mock-plan.yaml`)
- `featureArtifactPath`: canonical write path = `<features_dir>/<feature>/<phase>/<basename>` or feature root for global specs
- `resolveFeatureArtifact`: returns `{ actualPath, canonicalPath, legacyPath, usedLegacy, legacyDuplicate, exists }`
  - exists=false → actualPath === canonicalPath
  - legacyDuplicate → WARN via shared helper

## Layout

```
doc/features/<feature>/
  *.yaml (global contracts at root)
  prd/spec.md
  design/design.md
  review/review-report.md
  testing/test-plan.md, test-report.md
  ut/testability-audit.md, mock-plan.yaml
  <phase>/context-exploration.md, phase-completion-receipt.md, reports/
```

## Migration

- Dual-read on read side only; writes always canonical
- Receipt/reconcile pattern aligned with existing reports_dir_pattern migration
