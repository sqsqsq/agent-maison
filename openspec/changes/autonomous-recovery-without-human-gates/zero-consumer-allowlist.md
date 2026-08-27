# Human quality key zero-consumer allowlist

This inventory is the explicit exception list for task 8.2. An entry is allowed only when it is
read-only compatibility, a negative/tamper assertion, migration text, ordinary input provenance, or
genuine external authority. None of these entries may turn FAIL/UNVERIFIED into PASS, suppress a
repair candidate, advance a phase, clear a fuse, or satisfy release/completion.

## Legacy readers and inert schema vocabulary

- `harness/schemas/summary.schema.json`, `harness/scripts/utils/{quality-axes,phase-transition-policy,goal-progress,run-state-reducer,verify-feature-completion,visual-debt}.ts`: parse legacy `needs_human`, human owner/actionability, and `AWAITING_HUMAN_REVIEW`; current projectors reclassify them to repair/revalidation and never emit a quality signature wait.
- `harness/schemas/ui-spec.schema.json`, `harness/scripts/utils/ui-spec-shared.ts`, and `profiles/hmos-app/harness/{ui-spec-schema-validate,spec-ui-spec-check,ui-spec-gate,fidelity-governance-check,asset-crop-validation}.ts`: tolerate `human_confirmed`, `human_crop_confirmed`, and `crop_confirmed_by`; gates treat them as unverified/inert provenance.
- `harness/scripts/utils/{goal-manifest,fidelity-shared,adjudication}.ts`, `workflows/goal-manifest.schema.yaml`: parse legacy `allow_blind_visual`, downgrade sources, and halt/status vocabulary. New CLI writers omit the waiver, successors strip it, and current decisions ignore it.
- `harness/scripts/goal-runner.ts`, `harness/scripts/utils/{goal-report-generator,process-integrity}.ts`, and `profiles/hmos-app/harness/{visual-diff-capture,visual-diff-check,visual-provider-review,evidence-tamper-scan}.ts`: preserve legacy diagnostics or explicitly reject/ignore signer state; they do not consume it as authority.
- `harness/scripts/check-ut.ts` and business-UT templates: `human_confirmed` is historical observation-origin vocabulary, not a phase/release gate.

## Negative enforcement, fixtures, and tests

- `harness/tests/**` and `profiles/**/tests/**`: compatibility, negative, tamper, and re-projection assertions. Legacy values are deliberately present to prove that they no longer authorize quality.
- `profiles/hmos-app/harness/tests/fixtures/**`: frozen incident inputs and tamper scripts; never production writers.
- `specs/phase-rules/*.yaml`, phase skills, and agent execution rules may name forbidden/legacy keys only to prohibit writing or state their inert semantics.

## Migration and specification text

- `MIGRATION.md`, `docs/operations/**`, and `docs/spikes/**`: historical/migration explanation. Current instructions must say machine evidence, repair, or capability defer.
- `openspec/specs/**` and this change's delta specs may name legacy keys in removal, compatibility, or negative scenarios. No canonical requirement may grant them quality authority.
- Archived OpenSpec changes are immutable historical records and are outside the production scan.

## Genuine external authority and ordinary input provenance

- Framework package integrity restore/reinstall, device/toolchain readiness, secrets, legal approval, irreversible external operations, explicit hard budgets, and process/run ownership remain external prerequisites. They may pause execution but cannot rewrite a quality verdict.
- Interactive catalog/adapter/product/terminology selection and user-authored requirement or bbox/source input remain ordinary inputs. Their author identity is provenance only; current gates still derive and verify quality from machine evidence.

## Removed production surfaces

The production tree contains no import or executable entry for
`confirmation-receipt`, `visual-confirm`, or `review-feedback-ledger`. New writers do not emit
`confirmed_by`, `human_confirmed`, quality-derived `needs_human`/`AWAITING_HUMAN_REVIEW`, or
`allow_blind_visual`. Any future match outside the categories above is a release blocker.
