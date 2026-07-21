# vision-capability-truth Spec Delta

## ADDED Requirements

### Requirement: Vision capability, artifact attestation, and effective policy are three separately-computed axes

The framework SHALL model visual trust as three axes computed independently and combined by a fail-closed meet — `vision_capability` (verdict `tool_read|native|none|unknown`, scope `adapter_declared|run_probed|invocation_bound`, decided only by routing proof/canary/invoke proof), `artifact_attestation` (per artifact sha256: `verified|contradicted|unverified`), and `effective_policy` (`visual|blind_safe`, the meet over all standing downgrade reasons). A higher capability scope SHALL NOT override an artifact-level `contradicted`/`unverified` restriction, and SHALL NOT lift a policy downgrade; when a consumer passes `artifactHashes`, every hash whose attestation is not `verified` SHALL contribute a downgrade reason to the meet, and the policy entry points (phase harness gate clamp, goal-runner prompt/capability projection) SHALL pass the current ui-spec hash whenever the artifact exists (existing-but-unhashable → blind-safe). A blind-safe downgrade SHALL be lifted only by an explicit append-only runner `vision_policy_supersede` event **whose timestamp is later than the downgrade it lifts** (a pre-existing supersede SHALL NOT clear a future downgrade), or by a `verified` attestation bound to a NEW artifact hash. A `verified` attestation SHALL carry a mandatory binding (run_id/invoke_id/reference hashes/ref-elements sha256/gate fingerprint) and consumers SHALL re-verify it against the current state — missing or mismatching binding SHALL project the record as `unverified` in both the attestation map and the downgrade-lift decision (a forged or stale `verified` row cannot lift blind-safe). Binding consumption has two tiers: the final `ui_spec_fidelity_gate` SHALL additionally require the binding's run_id/invoke_id to equal the current signing chain exactly (a verified minted in another invocation cannot final-sign); downstream historical consumers MAY reuse a content-valid binding across invocations (gate fingerprint / ref-elements / refs equality is still enforced — that is the declared inheritance boundary). The attestation idempotence key SHALL cover verdict, reasons, and the canonical binding (re-verification under a new run/invoke refreshes the recorded issuing identity). Both vision ledgers (`artifact-attestations.jsonl`, `policy-downgrades.jsonl`) SHALL be row-hash-chained (`seq`/`prev_row_hash`/`row_hash`); rows without a valid chain SHALL count as corrupt and be excluded fail-closed — a hand-appended raw `verified`/`supersede` JSON line is never consumed.

Enforcement: `harness/scripts/utils/effective-vision-context.ts`（新增）

#### Scenario: refuted artifact cannot re-enter visual path via a later bound receipt

- **WHEN** ui-spec hash H is attested `contradicted` and the run policy is downgraded to blind-safe, and a later invocation obtains an `invocation_bound` capability receipt
- **THEN** `resolveEffectiveVisionContext` SHALL still report `effective_policy.mode = blind_safe` and artifact H as `contradicted`; only a runner supersede event or a verified attestation for a new hash H' lifts the downgrade

### Requirement: resolveEffectiveVisionContext is the sole consumption entry for visual trust state

All consumers — prompt vision injection, spec/coding/testing gates, blind UI-kit derivation, fidelity resolution — SHALL obtain visual trust state exclusively via `resolveEffectiveVisionContext({projectRoot, feature, runId, phase, invokeId, artifactHashes})`. No consumer SHALL read framework.local.json vision state or `ui-spec.verified` directly to decide capability or policy. Axis evidence boundaries: `run_probed` SHALL NOT cross runs; artifact contradiction SHALL be inherited only for identical artifact hashes; `invocation_bound` SHALL be valid only for the bound invoke_id.

Enforcement: `harness/scripts/utils/effective-vision-context.ts`, 消费面收口审计（tasks 3.8）

#### Scenario: downgraded state reaches downstream phases

- **WHEN** the spec phase records a blind-safe policy downgrade and the coding phase starts a new invocation
- **THEN** coding gates and prompt injection SHALL observe `blind_safe` via the resolver (blind UI-kit floor active), even though ui-spec.yaml still carries a stale `verified` field

### Requirement: invocation_bound is issued only by the runner via route-equality or inline canary

`invocation_bound` SHALL be issued only by the runner, under exactly one of: (A) the invocation's adapter/provider/model/CLI args — proven by runner launch parameters or structured CLI events, never agent-reported — are equal to those recorded in the canary receipt including invocation fingerprint; or (B) within the same invocation, a runner-issued random visual challenge is graded by the runner, authoritative refs are read (structured tool events), and the business output is produced, all bound to the same invoke_id. When neither path holds, the scope SHALL remain at most `run_probed`. Canary receipts SHALL record `provider/model/native_image_input/image_tool_available/probe_context`; `model: unknown` SHALL cap scope at `run_probed` and demote canary caching to session scope (re-probe each goal run).

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/vision-capability.ts`

#### Scenario: cursor auto-routing cannot claim instance binding

- **WHEN** the adapter cannot prove the model identity of the current invocation (e.g. cursor auto routing) and no inline canary was performed in that invocation
- **THEN** the capability scope SHALL be `run_probed` at most, and `vl_multimodal` final signing SHALL be rejected

### Requirement: vl_multimodal signing requires bound capability plus per-reference read provenance

`verified_method: vl_multimodal` SHALL be accepted only when all hold: capability scope was `invocation_bound` at signing; every authoritative reference image hash has a structured read tool event bound to the signing invoke_id (reusing the critic-receipt producer/attestation mechanism); **the ui-spec artifact hash is attested `verified`** (`contradicted`, `evidence_gap`, missing record, and `unverified_clean` all reject — the gate SHALL NOT be more permissive than the resolver, which treats non-verified artifacts as blind-safe); the resolved `effective_policy.mode` for the signing context is `visual`; and the adapter has a registered structured event parser (adapters without parsers SHALL be structurally unable to sign — honest fallback to human_gate or blind floor). A passing canary alone SHALL NOT substitute for per-reference read provenance. In goal mode the capability and refs receipts SHALL both belong to the **current invocation** by exact `invoke_id` equality with `spec-<MAISON_GOAL_ATTEMPT>` (suffix matching is a bypass) and match the run manifest's adapter; both receipts SHALL be anchored by a runner event carrying the receipt file's sha256 (the last event for that invoke wins — the runner deletes and reissues receipts after each agent invocation, so agent-forged files/events are superseded); and the refs receipt SHALL cover the **currently derived** authoritative reference set per-file with `read=true` and matching sha256 — an empty receipt cannot sign, and a spec with no authoritative references has no signing object (reject).

Enforcement: `profiles/hmos-app/harness/spec-ui-spec-check.ts`（ui_spec_fidelity_gate）, `harness/scripts/utils/critic-receipt-producer.ts`

#### Scenario: the 20260718 incident signature is rejected

- **WHEN** ui-spec declares `verified: verified / verified_method: vl_multimodal` but the adapter (cursor) has no structured event parser and no per-reference read events exist
- **THEN** the fidelity gate SHALL reject the signature (fail-closed to human_gate or blind floor) instead of trusting the self-report

### Requirement: Output counterevidence separates contradiction from evidence gap

A spec-phase check `vision_output_counterevidence` SHALL scan `componentNode.text`, `global_elements[].texts`, text-bearing nodes' `source_ref`, and ref-elements OCR provenance (not `must_have_elements`, which holds element ids). It SHALL classify: **contradicted** (BLOCKER) — declared image hash mismatch, U+FFFD/invalid surrogates, text conflicting with high-confidence reference evidence, or claimed-read refuted by tool events; **unverified/evidence_gap** — low-confidence OCR text promoted into UI text, text without source/reference mapping, missing provenance, or adapter without parser. Both classes SHALL invalidate `vl_multimodal` and MAY downgrade effective policy to blind-safe, but audit records SHALL NOT conflate "refuted" with "insufficient evidence". A `source_ref` SHALL count as a mapping only when it resolves to a known reference id (ref-elements `element_id`/`screen_ref_id` or a screen `ref_id`); a dangling `source_ref` SHALL be classified `evidence_gap`. Absence of counterevidence SHALL yield at most an `unverified` attestation with reason `counterevidence_clean_no_provenance`; a `verified` attestation SHALL be persisted only when positive provenance (OCR workflow present and every UI text positively matched against reference texts) holds **and** the vl signing chain is bound (current run/exact invoke runner-anchored capability + refs receipts with per-reference hash coverage) — text cross-matching between ui-spec and ref-elements alone SHALL NOT mint `verified` (both files are agent-authored; without the canary-graded capability receipt a blind model could synchronize them). The `verified` record SHALL carry the binding (run_id, invoke_id, reference hashes, ref-elements sha256, gate fingerprint). Dictionary/heuristic signals (out-of-dictionary ratio, single-char fragments, brand-word misses, dual-channel divergence) SHALL be observe-only (WARN + persisted counters) in the first release. The attestation SHALL be persisted as a standalone runner-owned receipt, not embedded into ui-spec.

Enforcement: `harness/scripts/check-spec.ts`（新检查）, `<feature>/vision/artifact-attestations.jsonl`

#### Scenario: OCR garbage text yields contradiction only with strong evidence

- **WHEN** ui-spec contains U+FFFD sequences in `componentNode.text` and additionally several low-confidence OCR strings without source mapping
- **THEN** the check SHALL report the U+FFFD entries as `contradicted` (BLOCKER) and the low-confidence/no-mapping entries as `evidence_gap`, and the artifact's `vl_multimodal` signature SHALL be invalidated in both cases
