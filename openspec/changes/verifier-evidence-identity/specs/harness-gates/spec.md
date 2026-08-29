# harness-gates Spec Delta

## ADDED Requirements

### Requirement: The verifier plan is resolved once and consumed by every stage

Whether a phase runs a verifier SHALL be resolved by one shared function from four inputs — the workflow's `verifier_prompt` declaration, the feature track, the resolved evidence policy, and the active adapter's declared verifier capability — producing exactly one of `disabled`, `enabled`, `blocked`. The runner's production path, the receipt gate, the Skill guidance and the hook recovery text SHALL all consume that single result; none of them SHALL re-derive applicability on its own.

Resolution order SHALL be fixed and SHALL NOT be reordered by any caller: profile-disabled phase, then absent workflow declaration, then evidence policy `not_applicable` / `off`, then adapter capability, then enabled.

`disabled` SHALL mean **absent equals zero**: no `ai-prompt.md`, no request, no subject, no invocation, and no closure requirement. A workflow that does not declare `verifier_prompt` for a phase SHALL be `disabled` — that is "not applicable", not "missing", and a fallback template SHALL NOT be synthesized to fill the gap. Artifacts left on disk by an earlier `enabled` generation SHALL **never** re-activate a capability the resolver has judged `disabled`, and switching a phase from `enabled` to `disabled` SHALL NOT require deleting them.

The workflow/track/policy portion of the resolution SHALL apply in `goal` and `headless` runs exactly as in `interactive` ones; otherwise a `lite` feature under `goal` cannot turn the unconditional assembly off. The adapter-capability portion SHALL, for this change, apply to `interactive` only: `goal` publication responsibility still routes through the bedside bypass, and judging those modes `blocked` would flatten every `full × goal` phase into `INCOMPLETE`.

The resolution result SHALL NOT be persisted as a summary snapshot or any other parallel state.

Enforcement: `harness/scripts/utils/verifier-plan.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: A lite feature produces no verifier artifacts in any mode

- **WHEN** a `lite` feature runs `change`, `coding` or `exit` in interactive, headless or goal mode
- **THEN** the plan SHALL be `disabled`, no prompt/request/subject SHALL be written, and the closure path SHALL remain the existing change/coding/exit chain with the receipt mechanism not applicable

#### Scenario: An undeclared phase is not applicable rather than missing

- **WHEN** the active workflow declares no `verifier_prompt` for a phase
- **THEN** the plan SHALL be `disabled`, and no fallback prompt template SHALL be synthesized

#### Scenario: Leftover artifacts cannot resurrect a disabled capability

- **WHEN** a phase that previously ran with `enabled` now resolves to `disabled` while its old prompt, request and report files remain on disk
- **THEN** the gate SHALL still treat the phase as `disabled`, SHALL NOT consume those files, and SHALL NOT require their removal

#### Scenario: A full goal phase keeps producing a request

- **WHEN** a `full` feature phase runs under `goal` and the adapter has not registered that mode
- **THEN** the plan SHALL be `enabled` — the production protocol migrates like any other run, while publication responsibility and closure adjudication for goal are unchanged

### Requirement: A missing verifier provider never suppresses script diagnosis

When the evidence policy declares `verifier` `required` in `interactive` mode and the active adapter has no registered capability, the plan SHALL be `blocked`. `blocked` SHALL NOT short-circuit the harness before the script gate runs. The priority ladder SHALL be:

- the script gate always runs to completion;
- a genuine script `FAIL` SHALL be reported as itself, with the provider gap recorded alongside rather than replacing it;
- only when the script gate would otherwise pass SHALL the phase be reported as `INCOMPLETE` with a `verifier_provider_unavailable` attribution;
- `enabled` produces the request; `disabled` follows the existing closure path unchanged.

The gap SHALL surface at the harness and at the closure entry, not only at the very end of `check-receipt`.

The verifier production surface SHALL be produced **only** when the plan is `enabled` **and** the script gate passed. `blocked` has no provider that could consume a prompt; a non-passing script run must not leave behind a request that looks callable, because the verifier's own contract forbids being invoked while the script gate is failing.

`summary.next_action` SHALL be derived from the resolved plan and the current subject's evidence state, not from a fixed assumption that a passing script run always needs a verifier next. In particular a `blocked` phase SHALL NOT be projected onto the device-external recovery action: the top-level verdict becomes `INCOMPLETE` for a provider reason, and reporting it as "connect a device and re-run UT" sends the operator at an unrelated problem. The console SHALL render the machine projection rather than restating one hard-coded cause for every `INCOMPLETE`.

Enforcement: `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/verifier-plan.ts`

#### Scenario: A real script failure is not masked by the provider gap

- **WHEN** the phase resolves to `blocked` and the script gate also reports genuine BLOCKER failures
- **THEN** the phase verdict SHALL be `FAIL` and the real failures SHALL be reported in full

#### Scenario: A passing script run under a missing provider is INCOMPLETE

- **WHEN** the phase resolves to `blocked` and the script gate reports no other BLOCKER failure
- **THEN** the phase verdict SHALL be `INCOMPLETE` attributed to `verifier_provider_unavailable`, the recommended action SHALL name the provider gap, and the closure entry SHALL refuse to pass the phase

#### Scenario: A failing script run leaves no callable verifier surface

- **WHEN** the plan is `enabled` but the script gate does not pass
- **THEN** no prompt, request or subject SHALL be produced for that run, and the recommended action SHALL be to fix the reported blockers

#### Scenario: A phase whose evidence already passes is not sent back to the verifier

- **WHEN** the plan is `enabled`, the material is unchanged, and verified passing evidence already exists for the current subject
- **THEN** the recommended action SHALL be to complete the receipt and closure, not to re-run the verifier against the same subject (which could only produce a conflict)

### Requirement: check-receipt adjudicates verifier evidence by identity, dispatched on the resolved plan and the summary generation

The receipt gate's verifier block SHALL stop treating the receipt's hand-written fields as machine facts, and SHALL stop using "is a subject present?" as its dispatch anchor. Subject presence conflated three roles at once — protocol generation, applicability, and evidence identity — so a phase whose verifier was legitimately turned off read as "an old artifact". Dispatch SHALL therefore be:

- **plan `disabled`** → the loader SHALL NOT be called and neither the JSON, the markdown nor a request SHALL be required; the observed state SHALL record `not_applicable` or `skipped_by_policy` according to the resolution reason.
- **plan `blocked`** → the gate SHALL BLOCKER FAIL with a `verifier_provider_unavailable` attribution. It SHALL NOT re-run the script diagnosis, which has already completed at the harness.
- **plan `enabled` and the summary declares the current generation** → the gate SHALL load `verifier.report.<subject>.json` through the shared `loadVerifierEvidence()` boundary and SHALL verify five things: the JSON's feature/phase match the phase under check, the subagent identity is present, the stored `invocation_subject` and `result_subject` both equal the current `summary.verifier_subject_id`, the document is structurally valid for schema `2.0`, and `verdict` is consistent with `blocker_count` (`PASS` iff zero). Each failure form SHALL surface as its own machine-readable issue id whose guidance points at re-running the verifier with the recorded request, or at re-running the harness — never at editing the receipt.
- **plan `enabled`, current generation, but no subject/request recorded** → the gate SHALL BLOCKER FAIL stating that this run produced no invocation credential, and direct the operator to re-run the harness. It SHALL NOT be reported as a legacy artifact.
- **an earlier summary generation, the phase closed, and the pre-existing evidence manifest still recomputes as fresh** → the closure is **grandfathered**: the gate SHALL neither parse the markdown nor require a current-generation request, and SHALL rely on the pre-existing manifest freshness chain alone. Re-running check-receipt over such a phase is a **re-verification of the old closure against its own registration surface**, not a fresh adjudication. Grandfathering SHALL NOT bypass the existing freshness rules — the environment recomputation over `framework_config` / `workflow` / `gate_fingerprint` / `framework_version` still applies, and any of them changing still marks the phase stale.
- **an earlier generation in every other case** → the gate SHALL BLOCKER FAIL and direct the operator to re-run the harness for that phase so it gains current-generation artifacts. The guidance SHALL be scoped to re-running that phase's harness and verifier; it SHALL NOT ask for business code to be reverted, for upstream artifacts to be rewritten, or for anything to be committed.

Re-adjudication SHALL enter only through a new harness run that regenerates the summary; that is the single switch point between the grandfathered domain and the current one.

Guidance emitted by the stop gate SHALL follow the same facts. When the script gate has already passed and only closure remains, the first recommended action SHALL be the closure-only entry (`--sync-closure`), never a full harness re-run: a full re-run reassembles a timestamped prompt, rotates the subject, and invalidates the verifier evidence that was just published — turning "almost closed" into an unbounded loop. A full re-run SHALL be recommended only when the script gate has not passed.

The console guidance after a passing script run SHALL follow the derived `next_action` rather than the mere presence of a request file. A phase whose current subject already holds verified passing evidence SHALL NOT be told to invoke the verifier again — re-running the verifier against the same subject can only produce a conflict, and telling an operator to do so contradicts the material-addressed reuse contract directly.

Machine facts that only become verifiable at closure SHALL be computed at closure. Verifier-derived repair candidates are the case in point: the summary writer runs **before** the verifier, so it can never see the current subject's conclusion, and the closure entry deliberately does not re-run the writer. The closure commit SHALL therefore recompute those candidates from the already-verified evidence before freezing the closed summary, using the same shared derivation as the writer and introducing no second state.

Any consumer that reads verifier evidence **before** the current summary is on disk SHALL anchor to the subject it just issued, never to the summary's on-disk value — during a re-run that value still belongs to the previous run, and using it attributes the previous subject's conclusion to the new one.

`closed` in the full/receipt closure domain SHALL mean **script verdict `PASS` and every `required` evidence item provided**, with the verifier item's requirement decided by the resolved plan rather than by a fixed four-item list. The `lite` track SHALL be untouched by this requirement: its change/coding/exit chain and its `receipt: not_applicable` semantics remain exactly as specified elsewhere.

Enforcement: `harness/scripts/check-receipt.ts`, `harness/scripts/utils/verifier-evidence.ts`, `harness/scripts/utils/verifier-plan.ts`

#### Scenario: A forged receipt plus an arbitrary markdown does not close a phase

- **WHEN** a phase carries a current-generation summary with a subject, a receipt claiming `verifier_subagent.verdict: "PASS"`, and a hand-written `verifier.report.md`, but no identity-verified JSON
- **THEN** check-receipt SHALL BLOCKER FAIL and attribute the failure to the missing machine truth

#### Scenario: A grandfathered closure still verifies without a current-generation request

- **WHEN** a phase closed before this change carries an earlier summary generation, a manifest that registered `verifier.report.md`, and that manifest still recomputes as fresh
- **THEN** check-receipt SHALL pass, explicitly reporting that it took the grandfather route

#### Scenario: A grandfathered closure whose old manifest went stale is not waved through

- **WHEN** the same closure has its registered markdown modified, so the pre-existing manifest recomputes as stale
- **THEN** check-receipt SHALL BLOCKER FAIL and direct the operator to re-run that phase's harness

#### Scenario: Deleting the transcript does not invalidate published evidence

- **WHEN** the subagent transcript referenced by the published JSON's audit metadata is deleted or moved after publication
- **THEN** check-receipt SHALL still verify the evidence from in-repository values alone

#### Scenario: A downstream rollback re-enters at the downstream phase

- **WHEN** a downstream phase finds a defect, the responsible upstream phase is edited and its harness, verifier and receipt are re-run, and the downstream phase consequently becomes stale by freshness
- **THEN** work SHALL resume at the downstream phase and, once its own harness and verifier are re-run, it SHALL become fresh again; the feature SHALL NOT be cleared and no commit SHALL be required

#### Scenario: An almost-closed phase is not told to re-run the whole harness

- **WHEN** the stop gate blocks a phase whose script verdict is `PASS` and whose closure is still open
- **THEN** the first recommended action SHALL be the closure-only entry, and SHALL NOT be a full harness re-run

#### Scenario: Verifier-derived candidates survive into the closed summary

- **WHEN** a phase's verifier publishes a finding that yields a repair candidate, and the phase is then closed through the closure-only entry
- **THEN** the closed summary SHALL carry the candidate derived from that verified evidence, **including** candidates whose derivation depends on a check's machine attribution — the closure-time reconstruction SHALL preserve that attribution rather than dropping it through a field-name mismatch

#### Scenario: Reusable evidence is not sent back to the verifier by the console

- **WHEN** the script gate passes and the derived action is to complete the receipt and closure
- **THEN** the console SHALL say the current evidence is reusable and point at the closure-only entry, and SHALL NOT print the "deliver the request to the verifier" instruction

#### Scenario: A re-run does not inherit the previous subject's candidates

- **WHEN** the material changes so the subject rotates, and the previous subject still has published evidence carrying a finding
- **THEN** the new run's summary SHALL NOT carry candidates derived from the previous subject's evidence

### Requirement: Concurrent verifier rounds are separated by identity, and contradictions become an explicit conflict

Concurrent verifier subagents are a supported normal state; the framework SHALL NOT serialize them with a lock, a queue, or a ban. Separation SHALL come from identity alone.

Publication SHALL be a compare-and-set loop, not a read-then-write. Atomic replacement alone is insufficient: it only guarantees that no half-written file is observed, **not** that "read the existing document, decide, write" is atomic. Two concurrent rounds that both observe "no document yet" would both write `published`, and the later writer would silently overwrite the earlier one — a `PASS` swallowing a `FAIL`. Three invariants are therefore required:

- the first publication for a subject SHALL go through an atomic **create-if-absent**; a writer that loses that race SHALL re-read and re-decide rather than overwrite;
- `conflict` SHALL be **monotonic and absorbing** for a given subject: once a document is in conflict it SHALL NOT return to `published`;
- these rules govern **one subject's own file only**; cross-subject interference is excluded structurally by the per-subject partition rather than by any authorization check.

A round SHALL NOT move, delete or overwrite a file belonging to another subject, and SHALL NOT need permission to avoid doing so. Re-checking "am I still the current subject?" cannot close this race at any placement: the check and the mutation are two steps, and the subject can rotate between them — a later check only moves the window. The partition removes the shared mutable resource instead: each round derives its own filename from its invocation subject and touches nothing else, while `summary.verifier_subject_id` independently decides which file the consumers read. A stale round may therefore still write its own file; that file is simply outside every consumer's read surface.

Publication SHALL be idempotent when the subject, the `agent_id`, and the conclusion fingerprint all match an already published document — and in that case the file SHALL NOT be rewritten, because rewriting would change `generated_at` and stale a manifest that has just frozen those bytes. When the subject matches but the `agent_id` or the conclusion fingerprint differs, the canonical document SHALL become `state: "conflict"` recording **both** sides' agent identity, verdict, blocker count and conclusion fingerprint; the shared loader SHALL refuse such a document and check-receipt SHALL BLOCKER FAIL. With three or more concurrent writers the recorded side list is best-effort and SHALL be marked as such — the conflict **state** never degrades, only a forensic entry may be lost. When the subject is stale relative to the current summary, the report SHALL land in the bedside file and SHALL NOT overwrite the canonical document.

Conflict recovery guidance SHALL be executable: stop or await **all** verifiers for that subject; delete the conflict document, which is no longer any side's conclusion; then start exactly **one** verifier, delivering the request JSON named by `summary.verifier_request` in full. Re-running the harness SHALL NOT be presented as the recovery step: it rotates the subject only when the reviewed material actually changed, so with unchanged material it returns to the very same conflict.

The loader SHALL recompute the conclusion fingerprint from the stored `verdict`, `blocker_count` and report text and SHALL reject a document whose stored fingerprint does not match. Accepting the stored value unverified would let an edit that flips a `FAIL` document to `PASS` — leaving the original fingerprint in place — pass verification intact.

The write target SHALL be derived by the hook from the framework configuration plus the feature/phase named in the invocation request. The `prompt_path` claimed in that request SHALL be used **only** for an equality cross-check; a claim containing `..`, an absolute path, a drive prefix, or a different feature SHALL reject the whole round rather than degrade to writing somewhere else. A Task prompt that is not exactly one parseable request document — a hand-transcribed template, an edited field whose subject no longer recomputes, or a request followed by extra instructions — SHALL reject the round to the bedside file.

Enforcement: `agents/claude/templates/hooks/record-verifier-report.mjs`, `harness/scripts/utils/verifier-evidence.ts`, `harness/scripts/utils/verifier-request.ts`, `harness/scripts/check-receipt.ts`

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

- **WHEN** the invocation request claims a `prompt_path` that escapes the phase directory, is absolute, or names another feature
- **THEN** no canonical document SHALL be written and the round SHALL be recorded in the bedside file as a rejected path claim

#### Scenario: A request with extra instructions appended is rejected

- **WHEN** the Task prompt carries the request JSON followed by additional text
- **THEN** the round SHALL be rejected to the bedside file and no canonical document SHALL be written

### Requirement: The review closure attestation binds identity-verified verifier evidence

The review closure attestation's `verifier_report_sha256` SHALL bind the review phase's canonical verifier JSON and SHALL be populated **only** when that document passes identity verification; when verification fails the field SHALL be `null` rather than binding an unverified artifact. The attestation SHALL additionally record `verifier_subject_id` and `verifier_result_sha256` as readable anchors, and its `schema_version` SHALL advance to `1.1`.

Because no consumer of the attestation reads the verifier binding — reconciliation, the testing `review_closure_attestation` gate and the check-ut goal branch all consume `inventory` — attestations written at `1.0` SHALL remain readable and SHALL continue to reconcile against their own recorded source baseline, exactly as the evidence manifest grandfathers older closures. A structurally malformed attestation SHALL still be reported as an unavailable baseline.

Enforcement: `harness/scripts/utils/closure-attestation.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: A review closure without verified verifier evidence records a null binding

- **WHEN** the review phase's verifier JSON is absent or fails identity verification at closure time
- **THEN** the attestation SHALL record `verifier_report_sha256: null` rather than hashing the markdown

#### Scenario: An attestation written before this change still reconciles

- **WHEN** a `1.0` attestation from an earlier closure is consumed by source-drift reconciliation
- **THEN** it SHALL remain readable and reconcile against its recorded inventory

#### Scenario: A closed review at the current summary generation is a usable UT baseline

- **WHEN** the review phase closes with the current summary generation and a valid `closure_commit`
- **THEN** the UT attestation-first probe SHALL treat it as formally closed and usable as a baseline

## MODIFIED Requirements

### Requirement: Receipt hard blocks dispatch by policy

check-receipt 的 verifier / invoked_via / trace_json / context_exploration / self_check 硬必需块 MUST 先查 evidence policy：`required` 走现有校验；`off` 记 `skipped_by_policy` 不 FAIL；`optional` 缺失仅 WARN；lite feature MUST 整体返回 exit 0 + 顶层 `not_applicable` 机读标注。

verifier 块 MUST 消费共享的 verifier plan 解析结果，而非自行按 `policy.verifier` 二分：`disabled` 记 `skipped_by_policy` / `not_applicable` 且 loader 不调用、JSON 与 MD 与 request 均不要求；`blocked` MUST BLOCKER FAIL 并归因 `verifier_provider_unavailable`；`enabled` 走**身份验真**，按 summary 代际分派——当代只认身份验真通过的 `verifier.report.<subject>.json`，上一代按 grandfather / 指引重跑 harness 二分。回执手填的 `invoked_via` / `report_path` / `verdict` MUST NOT 单独构成通过或失败条件。

#### Scenario: balanced 下 verifier off 的 receipt 通过
- **WHEN** full×balanced 的 review phase receipt 无 verifier 节
- **THEN** check-receipt 记 verifier=skipped_by_policy 且 exit 0

#### Scenario: strict 行为不变
- **WHEN** 缺省 strict 下 receipt 缺 verifier verdict
- **THEN** BLOCKER FAIL（与现状一致）

#### Scenario: off 档不因缺 verifier 机器证据而失败
- **WHEN** `policy.verifier=off` 的阶段既无 verifier JSON 也无 MD
- **THEN** check-receipt MUST 记 `skipped_by_policy` 并 exit 0，且 MUST NOT 调用证据 loader

> **Enforced by:** `harness/scripts/check-receipt.ts`
