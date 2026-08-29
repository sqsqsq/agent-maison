# harness-gates Spec Delta

## ADDED Requirements

### Requirement: check-receipt adjudicates verifier evidence by identity, dispatched solely on subject presence

The receipt gate's verifier block SHALL stop treating the receipt's hand-written fields as machine facts. When `policy.verifier` is not `off`, it SHALL dispatch on exactly one anchor — whether `summary.verifier_subject_id` is present (the current runner always writes it; artifacts from before this change never carry it):

- **subject present** → the gate SHALL load `verifier.report.json` through the shared `loadVerifierEvidence()` boundary and SHALL verify five things: the JSON's feature/phase match the phase under check, the subagent identity is present, the stored `invocation_subject` and `result_subject` both equal the current `summary.verifier_subject_id`, the document is structurally valid for schema `2.0`, and `verdict` is consistent with `blocker_count` (`PASS` iff zero). Each failure form SHALL surface as its own machine-readable issue id whose guidance points at re-running the verifier or the harness, never at editing the receipt.
- **`policy.verifier` is `off`** → the loader SHALL NOT be called and neither the JSON nor the markdown SHALL be required; existing semantics are preserved verbatim.
- **subject absent, phase closed, and the pre-existing evidence manifest still recomputes as fresh** → the closure is **grandfathered**: the gate SHALL neither parse the markdown nor require the JSON, and SHALL rely on the pre-existing manifest freshness chain alone. Re-running check-receipt over such a phase is a **re-verification of the old closure against its own registration surface**, not a fresh adjudication. Grandfathering SHALL NOT bypass the existing freshness rules — the environment recomputation over `framework_config` / `workflow` / `gate_fingerprint` / `framework_version` still applies, and any of them changing still marks the phase stale.
- **subject absent in every other case** → the gate SHALL BLOCKER FAIL and direct the operator to re-run the harness first, so the phase gains subject-bearing artifacts.

Re-adjudication SHALL enter only through a new harness run that regenerates the summary and rotates the subject; that is the single switch point between the grandfathered domain and the new one.

Enforcement: `harness/scripts/check-receipt.ts`, `harness/scripts/utils/verifier-evidence.ts`

#### Scenario: A forged receipt plus an arbitrary markdown does not close a phase

- **WHEN** a phase carries a subject, a receipt claiming `verifier_subagent.verdict: "PASS"`, and a hand-written `verifier.report.md`, but no identity-verified `verifier.report.json`
- **THEN** check-receipt SHALL BLOCKER FAIL and attribute the failure to the missing machine truth

#### Scenario: A grandfathered closure still verifies without a subject

- **WHEN** a phase closed before this change has no `verifier_subject_id`, a manifest that registered `verifier.report.md`, and that manifest still recomputes as fresh
- **THEN** check-receipt SHALL pass, explicitly reporting that it took the grandfather route

#### Scenario: A grandfathered closure whose old manifest went stale is not waved through

- **WHEN** the same closure has its registered markdown modified, so the pre-existing manifest recomputes as stale
- **THEN** check-receipt SHALL BLOCKER FAIL and direct the operator to re-run the harness

#### Scenario: Deleting the transcript does not invalidate published evidence

- **WHEN** the subagent transcript referenced by the published JSON's audit metadata is deleted or moved after publication
- **THEN** check-receipt SHALL still verify the evidence from in-repository values alone

### Requirement: Concurrent verifier rounds are separated by identity, and contradictions become an explicit conflict

Concurrent verifier subagents are a supported normal state; the framework SHALL NOT serialize them with a lock, a queue, or a ban. Separation SHALL come from identity alone.

Publication SHALL be a compare-and-set loop, not a read-then-write. Atomic replacement alone is insufficient: it only guarantees that no half-written file is observed, **not** that "read the existing document, decide, write" is atomic. Two concurrent rounds that both observe "no document yet" would both write `published`, and the later writer would silently overwrite the earlier one — a `PASS` swallowing a `FAIL`. Three invariants are therefore required:

- the first publication for a subject SHALL go through an atomic **create-if-absent**; a writer that loses that race SHALL re-read and re-decide rather than overwrite;
- `conflict` SHALL be **monotonic and absorbing** for a given subject: once a document is in conflict it SHALL NOT return to `published`;
- these rules govern **one subject's own file only**; cross-subject interference is excluded structurally by the per-subject partition rather than by any authorization check.

A round SHALL NOT move, delete or overwrite a file belonging to another subject, and SHALL NOT need permission to avoid doing so. Re-checking "am I still the current subject?" cannot close this race at any placement: the check and the mutation are two steps, and the subject can rotate between them — a later check only moves the window. The partition removes the shared mutable resource instead: each round derives its own filename from its invocation subject and touches nothing else, while `summary.verifier_subject_id` independently decides which file the consumers read. A stale round may therefore still write its own file; that file is simply outside every consumer's read surface.

Publication SHALL be idempotent when the subject, the `agent_id`, and the conclusion fingerprint all match an already published document — and in that case the file SHALL NOT be rewritten, because rewriting would change `generated_at` and stale a manifest that has just frozen those bytes. When the subject matches but the `agent_id` or the conclusion fingerprint differs, the canonical document SHALL become `state: "conflict"` recording **both** sides' agent identity, verdict, blocker count and conclusion fingerprint; the shared loader SHALL refuse such a document and check-receipt SHALL BLOCKER FAIL. With three or more concurrent writers the recorded side list is best-effort and SHALL be marked as such — the conflict **state** never degrades, only a forensic entry may be lost. When the subject is stale relative to the current summary, the report SHALL land in the bedside file and SHALL NOT overwrite the canonical document.

Conflict recovery guidance SHALL be executable. It SHALL NOT instruct anyone to "re-run the harness to rotate the subject": under this design the subject is deliberately stable when nothing material changed, so re-running the harness returns to the very same conflict — a deadlock. The recovery contract is: stop or await **all** verifiers for that subject; delete the conflict document, which is no longer any side's conclusion; then start exactly **one** verifier, delivering the existing `ai-prompt.md` verbatim.

The loader SHALL recompute the conclusion fingerprint from the stored `verdict`, `blocker_count` and report text and SHALL reject a document whose stored fingerprint does not match. Accepting the stored value unverified would let an edit that flips a `FAIL` document to `PASS` — leaving the original fingerprint in place — pass verification intact.

The write target SHALL be derived by the hook from the framework configuration plus the feature/phase named in the invocation machine block. The path claimed in that block SHALL be used **only** for an equality cross-check; a claim containing `..`, an absolute path, a drive prefix, or a different feature SHALL reject the whole round rather than degrade to writing somewhere else.

Enforcement: `agents/claude/templates/hooks/record-verifier-report.mjs`, `harness/scripts/utils/verifier-evidence.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: Interleaved verifier rounds each land in their own phase

- **WHEN** verifier subagents for plan, coding and ut finish in an interleaved order while the shared state file points at coding
- **THEN** each phase SHALL hold its own published document carrying its own subagent identity, and none SHALL be overwritten by another

#### Scenario: A contradicting second round is recorded as a conflict, not resolved by arrival order

- **WHEN** a second subagent reports `FAIL` under the same subject for which a first subagent already published `PASS`
- **THEN** the canonical document SHALL become `state: "conflict"` recording both sides, and check-receipt SHALL FAIL

#### Scenario: Genuinely concurrent rounds cannot let a PASS swallow a FAIL

- **WHEN** two verifier rounds for the same subject publish contradicting verdicts concurrently, both having observed no existing document
- **THEN** the canonical document SHALL end in `state: "conflict"` carrying both sides, and SHALL NOT end as a `published` document holding either single verdict

#### Scenario: An edited conclusion is rejected even when its fingerprint is left untouched

- **WHEN** a published document's `verdict`, `blocker_count` and report text are edited to claim a clean pass while `result_sha256` retains the original value
- **THEN** the loader SHALL reject the document on fingerprint recomputation and check-receipt SHALL FAIL

#### Scenario: A late round from a superseded subject cannot overwrite current evidence

- **WHEN** a verifier from a previous harness run finishes after the subject has rotated
- **THEN** the canonical document SHALL be unchanged and the late report SHALL land in the bedside file marked as a stale subject

#### Scenario: Interleaved subjects cannot change each other's bytes

- **WHEN** a round for subject A stops just before its final write, the runner rotates to subject B, a verifier for B publishes the current evidence, and A is then released
- **THEN** B's file SHALL be byte-identical to before A resumed, A SHALL at most have written its own subject's file, and the loader SHALL still return B

#### Scenario: An out-of-scope claimed path rejects the whole round

- **WHEN** the invocation machine block claims a report path that escapes the phase directory, is absolute, or names another feature
- **THEN** no canonical document SHALL be written and the round SHALL be recorded in the bedside file as a rejected path claim

### Requirement: The review closure attestation binds identity-verified verifier evidence

The review closure attestation's `verifier_report_sha256` SHALL bind the review phase's canonical `verifier.report.json` and SHALL be populated **only** when that document passes identity verification; when verification fails the field SHALL be `null` rather than binding an unverified artifact. The attestation SHALL additionally record `verifier_subject_id` and `verifier_result_sha256` as readable anchors, and its `schema_version` SHALL advance to `1.1`.

Because no consumer of the attestation reads the verifier binding — reconciliation, the testing `review_closure_attestation` gate and the check-ut goal branch all consume `inventory` — attestations written at `1.0` SHALL remain readable and SHALL continue to reconcile against their own recorded source baseline, exactly as the evidence manifest grandfathers older closures. A structurally malformed attestation SHALL still be reported as an unavailable baseline.

Enforcement: `harness/scripts/utils/closure-attestation.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: A review closure without verified verifier evidence records a null binding

- **WHEN** the review phase's `verifier.report.json` is absent or fails identity verification at closure time
- **THEN** the attestation SHALL record `verifier_report_sha256: null` rather than hashing the markdown

#### Scenario: An attestation written before this change still reconciles

- **WHEN** a `1.0` attestation from an earlier closure is consumed by source-drift reconciliation
- **THEN** it SHALL remain readable and reconcile against its recorded inventory

## MODIFIED Requirements

### Requirement: Receipt hard blocks dispatch by policy

check-receipt 的 verifier / invoked_via / trace_json / context_exploration / self_check 硬必需块 MUST 先查 evidence policy：`required` 走现有校验；`off` 记 `skipped_by_policy` 不 FAIL；`optional` 缺失仅 WARN；lite feature MUST 整体返回 exit 0 + 顶层 `not_applicable` 机读标注。

verifier 块在 `required` 档下的"现有校验" MUST 为**身份验真**：按 `summary.verifier_subject_id` 在场与否分派，在场时只认身份验真通过的 `verifier.report.json`，缺席时按 grandfather / 指引重跑 harness 二分。回执手填的 `invoked_via` / `report_path` / `verdict` MUST NOT 单独构成通过或失败条件；`off` 档 MUST 保持既有语义——loader 不调用，JSON 与 MD 均不要求。

#### Scenario: balanced 下 verifier off 的 receipt 通过
- **WHEN** full×balanced 的 review phase receipt 无 verifier 节
- **THEN** check-receipt 记 verifier=skipped_by_policy 且 exit 0

#### Scenario: strict 行为不变
- **WHEN** 缺省 strict 下 receipt 缺 verifier verdict
- **THEN** BLOCKER FAIL（与现状一致）

#### Scenario: off 档不因缺 verifier 机器证据而失败
- **WHEN** `policy.verifier=off` 的阶段既无 `verifier.report.json` 也无 `verifier.report.md`
- **THEN** check-receipt MUST 记 `skipped_by_policy` 并 exit 0，且 MUST NOT 调用证据 loader

> **Enforced by:** `harness/scripts/check-receipt.ts`
