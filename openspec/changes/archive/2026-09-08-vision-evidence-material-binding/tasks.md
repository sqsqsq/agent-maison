# Tasks

## 1. Delete the invocation-level canary chain (plan 8d2b4f60 D1 / S0)

- [x] 1.1 Remove `buildInlineCanaryBlock` from `harness/scripts/utils/vision-canary.ts`; leave `buildCanaryPrompt` / `renderCanaryImage` / `generateRandomCanaryAnswerKey` / `resolveCanaryCacheDecision` untouched — the preflight probe still uses them
- [x] 1.2 Remove the runner's per-invoke question/render block, the prompt concatenation, the pre-sign `rmSync` cleanup of both receipts, the whole marking block, `writeCapabilityReceipt` and the `capability_receipt` event from `harness/scripts/goal-phase-runtime.ts`
- [x] 1.3 Remove `CapabilityReceipt`, `capabilityReceiptPath`, `readCapabilityReceipt`, `writeCapabilityReceipt`, the `invocation_bound` branch and scope member, `evidence.binding_path` and the now-unused `invokeId` argument from `harness/scripts/utils/effective-vision-context.ts`; `evidence.canary_probed_at` becomes the sole probe-source marker
- [x] 1.4 Replace the capability-receipt checks in `verifyVlSigningChain` with `resolveEffectiveVisionContext`, requiring `scope=run_probed` ∧ `evidence.canary_probed_at` present ∧ `verdict ∈ {tool_read, native}`; failure text must not claim measurement

## 2. Bind the reference-read receipt to material (plan 8d2b4f60 D2/D4 / S1)

- [x] 2.1 `SpecRefsReceipt` → schema `1.1`: drop the top-level `invoke_id`, add `refs[].read_at_invoke`
- [x] 2.2 `loadSpecRefsReceipt` accepts only `1.1`; `1.0` and anything else return `null`
- [x] 2.3 `produceSpecRefsReceipt` merges: inherit a previous `read` only when run + adapter match and the content hash is unchanged; always overwrite; return `carriedOver`
- [x] 2.4 Read matching compares normalized full paths (`path.resolve`, lower-cased on win32); delete the basename fallback and the doc comment that described it
- [x] 2.5 Trim `verifyVlSigningChain`: drop the exact `invoke_id` equality, the `events.jsonl` anchor and the `receipt_sha256` comparison; keep run/adapter identity, `unread === 0`, the manifest-recomputed denominator and the per-image hash check; expose `carriedRefs`
- [x] 2.6 Guard receipt production with `executorMode === 'detached'`; an attended round emits `status: skipped` + `reason: attended_no_invoke_audit` and writes nothing. Add the runtime-entry constraint `attended executor ⇒ owner.kind === 'session'` so the gate's attended judgement cannot be bypassed
- [x] 2.7 Put `carried_over` on the existing `spec_refs_receipt_produced` event and render one `↳ 参考图读取` note row in `goal-report-generator.ts`

## 3. Consumers and wording (plan 8d2b4f60 D3/D5/D7 / S2)

- [x] 3.1 `buildClosureVisualEvidenceBlock`: drop the `Mandatory` / `REQUIRED` heading, the `invocation-bound` sentence shared by both branches, the "read EVERY authoritative reference image" order and the "Skipping any image …" line; keep the FROZEN exemption and the honest `unverified` branch; state that an image read earlier in this run still counts while its content is unchanged
- [x] 3.2 `ui_spec_fidelity_gate`: pick the wording and the way out from the most severe of the four failure kinds; the PASS `details` name the run-level measured canary, the verified-read count and any carried-over reads
- [x] 3.3 `check-spec`'s `vision_output_counterevidence` disclosure sentence follows the same shift (both branches stay PASS; wording only)
- [x] 3.4 `skills/feature/spec/SKILL.md` and `skills/feature/spec/reference/ui-spec.md`: add "read within this run and unchanged is enough; a closure round need not re-read"

## 4. Spec, migration and verification (plan 8d2b4f60 D8 / S3)

- [x] 4.1 Four deltas under this change: `visual-capability-routing`, `goal-runner`, `harness-gates`, `feature-artifact-layout`
- [x] 4.2 `MIGRATION.md`: `capability-receipt.json` stops being produced; the refs receipt moves to schema 1.1 and the loader accepts only 1.1
- [x] 4.3 Extend the existing suites — no new suite, no new framework: `effective-vision-context` (capability source), `critic-receipt-producer` (path matching, cross-invoke union, 1.0 residue, the three unreachable predicates), `visual-fidelity` (the four states through the real gate), `goal-runner-phase` / `host-runtime-truth` (closure prompt), `goal-canary-pin-binding` (capability-source matrix, goal-report text), `goal-runner-testing-integrity` (V1/V2/V5 through the production wiring, plus the runtime-entry constraint)
- [x] 4.4 `node scripts/check-plan-version.mjs`, `npm --prefix harness run typecheck`, the eleven `test:unit --filter` runs, `npm run openspec:validate`
- [x] 4.5 `npm run candidate:build` — run by the dispatcher after review, not here
- [x] 4.6 Host acceptance: the user-triggered `C-U` regression over bc-openCard-1 (spec→ut window), merged with B01's V9

## 2026-09-08 closeout evidence

The current candidate manifest records complete=true, built_at=2026-09-08T11:26:37.817Z, smoke_checked_at=2026-09-08T11:28:48.454Z, source_commit bb4aed67. Its in-zip manifest SHA matches the installed host manifest; ZIP SHA=7e1472c011b46b77eb1131b8cac892ca63c5b11d4c42e6ca57b12f9de6814656. B02 host acceptance is now closed using deb77f spec closure retry/carried_over=3 and successor 73fc05 full-chain VALID. See B06 §10; no rerun performed for checkbox synchronization.
