## 1. Capability model subtraction

- [x] 1.1 Remove artifact hashes and persistent policy from preflight/goal-runner visual capability routing
- [x] 1.2 Reduce effective-vision-context to current capability receipt resolution and remove ledger APIs
- [x] 1.3 Remove visual ledger migration, anchoring, tamper and checkpoint/head/HWM control flow from goal-runner

## 2. Stateless visual gates

- [x] 2.1 Make vision_output_counterevidence report-only and remove attestation/downgrade writes
- [x] 2.2 Make vl_multimodal validation use current capability/reference receipts plus current counterevidence only
- [x] 2.3 Remove retired ledger fields from phase rules, skills, operations docs and runtime artifact registries

## 3. Stable routing and useful retry

- [x] 3.1 Exclude current-feature generated outputs from requirement dereferencing and add a bc-openCard regression test
- [x] 3.2 Clarify selected_fidelity versus effective_fidelity in prompts and tests
- [x] 3.3 Feed bounded harness fatal output into retry context when summary generation fails

## 4. Compatibility and verification

- [x] 4.1 Update MIGRATION.md and retire conflicting unfinished visual-capability-truth tasks/spec text
- [x] 4.2 Replace ledger/state-machine tests with minimal current-capability and stateless-gate regressions
- [x] 4.3 Run typecheck and affected unit/fixture tests
- [x] 4.4 Run `cd harness && npm test`
- [x] 4.5 Run `npm run openspec:validate` and `npm run release:verify` (strict release gate is blocked by unrelated/incomplete 3.0.0 plans; candidate verification passed with only that gate skipped)

## 5. Review follow-up

- [x] 5.1 Convert feature YAML syntax errors into same-run `shape_issues` and add the bc-openCard poison-line regression
- [x] 5.2 Add blind-mode token/asset metadata to ui-spec schema and validator with a focused regression
- [x] 5.3 Remove stale attestation/blind-safe comments from the stateless counterevidence path
- [x] 5.4 Persist concise unit failure case names under ignored harness reports and test the writer
- [x] 5.5 Reconcile the subtraction and c9e3f7d1 plan statuses without marking unfinished work complete
- [x] 5.6 Run typecheck, affected suites, full harness tests and strict OpenSpec validation
