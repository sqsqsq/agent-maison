# harness-gates Spec Delta

## ADDED Requirements

### Requirement: check-receipt adjudicates verifier evidence by subject echo

The finalize step SHALL adjudicate verifier evidence from the resolved plan alone. plan `disabled` → nothing required; plan `enabled` → load `<reports>/verifier.report.<subject>.md` for the current subject through the shared loader, which SHALL accept it only when the terminal block echoes `summary.verifier_subject_id` and `verdict` agrees with `blocker_count`.

Adjudication SHALL NOT dispatch on `summary.schema_version`. Splitting the read surface into a current generation and a grandfathered one made "the capability was legitimately turned off" indistinguishable from "this is an old artifact"; a phase re-validated without a current report is simply reviewed again, which costs one review and removes an entire dispatch axis.

When the current subject has no report but the phase holds any verified PASS report, closure SHALL proceed with `verifier: completed_with_prior_review` and `current_material_not_reverified` listing the differing material; it SHALL NOT be described as PASS for the current material. BLOCKER SHALL remain only when the policy is `required` and the phase never obtained a PASS report.

When the plan is `disabled` for reason `adapter_has_no_reviewer`, the gate SHALL pass and SHALL disclose the verifier axis as `not_reviewed` in a non-blocking warning. A tool that cannot dispatch a subagent is an environment fact; refusing to close the phase over it makes the whole `full` track unusable on that adapter, while an honest disclosure keeps the closure record truthful.

Hand-written receipt fields SHALL hold no adjudication authority; a mismatch with the machine fact SHALL be a warning, never a verdict.

Enforcement: `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`, `harness/scripts/utils/verifier-evidence.ts`

#### Scenario: Changed material with a prior PASS completes honestly

- **WHEN** spec.md changed after a verified PASS and the dispatcher did not re-run the verifier
- **THEN** the phase SHALL close with `completed_with_prior_review` and the summary SHALL list `spec.md` under `current_material_not_reverified`

#### Scenario: An adapter without a reviewer closes with disclosure

- **WHEN** the active adapter declares no `verifier_subagent` and a `full` phase's script gate passes
- **THEN** no request SHALL have been issued, the gate SHALL pass, and the verifier axis SHALL be recorded as `not_reviewed` with a non-blocking warning

#### Scenario: An unreadable report is a re-run, not a closure wall

- **WHEN** the report for the current subject is missing, carries zero or multiple terminal blocks, or contradicts its own blocker count
- **THEN** the gate SHALL name that single failure and SHALL instruct the dispatcher to re-run the verifier and rewrite the report

### Requirement: The review closure attestation records the reviewed verifier subject

The review closure attestation SHALL record `verifier_subject_id` as a readable anchor naming which material the review phase's verifier examined, and its `schema_version` SHALL advance to `1.2`. It SHALL NOT hash the verifier report.

Hashing the report would reintroduce, through the attestation, exactly the tamper detection this change removes from the loader: a report whose modification is deliberately undetectable must not simultaneously stale a closure when edited. The conclusion the closure adopted is already recorded in the summary.

Because no consumer of the attestation reads the verifier binding — reconciliation, the testing `review_closure_attestation` gate and the check-ut goal branch all consume `inventory` — attestations written at `1.0` or `1.1` SHALL remain readable and SHALL continue to reconcile against their own recorded source baseline, exactly as the evidence manifest grandfathers older closures. A structurally malformed attestation SHALL still be reported as an unavailable baseline.

Enforcement: `harness/scripts/utils/closure-attestation.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: A review closure records the subject without hashing the report

- **WHEN** the review phase closes with a verified verifier report
- **THEN** the attestation SHALL record that report's `verifier_subject_id` and SHALL carry no report hash field

#### Scenario: An attestation written before this change still reconciles

- **WHEN** a `1.0` or `1.1` attestation from an earlier closure is consumed by source-drift reconciliation
- **THEN** it SHALL remain readable and reconcile against its recorded inventory

#### Scenario: A closed review at the current summary generation is a usable UT baseline

- **WHEN** the review phase closes with the current summary generation and a valid `closure_commit`
- **THEN** the UT attestation-first probe SHALL treat it as formally closed and usable as a baseline

### Requirement: The phase evidence manifest excludes the verifier report

The phase evidence manifest SHALL register the phase's own outputs — the summary, the script report, the trace and the phase artifacts — so that a later edit to any of them marks the closure stale. The verifier report SHALL NOT be registered.

Its content is deliberately unprotected: the loader performs no tamper detection on it, so registering its bytes would make the manifest the only place where editing the report has a machine consequence — contradicting the adjudication rule and reviving the stale cascade that motivated subject partitioning in the first place. The conclusion a closure adopted is recorded in the summary, which is registered.

Enforcement: `harness/scripts/utils/phase-evidence-manifest.ts`

#### Scenario: Editing a closed phase's verifier report does not stale it

- **WHEN** a closed phase's `verifier.report.<subject>.md` is edited and the manifest is recomputed
- **THEN** the phase SHALL remain fresh and no downstream phase SHALL be invalidated

#### Scenario: Editing the summary still stales the closure

- **WHEN** a closed phase's `summary.json` is edited
- **THEN** manifest recomputation SHALL report the phase stale

## MODIFIED Requirements

### Requirement: The verifier plan is resolved once and consumed by every stage

Whether a phase runs a verifier SHALL be resolved by one shared function from four inputs — the workflow's `verifier_prompt` declaration, the feature track, the resolved evidence policy, and whether the active adapter declares `verifier_subagent` — producing exactly one of `disabled` or `enabled`. The runner's production path, the receipt gate and the Skill guidance SHALL all consume that single result; none of them SHALL re-derive applicability on its own.

Resolution order SHALL be fixed and SHALL NOT be reordered by any caller: profile-disabled phase, then absent workflow declaration, then evidence policy `not_applicable` / `off`, then absent adapter reviewer, then enabled.

`disabled` SHALL mean **absent equals zero**: no `ai-prompt.md`, no request, no subject, no invocation, and no closure requirement. A workflow that does not declare `verifier_prompt` for a phase SHALL be `disabled` — that is "not applicable", not "missing", and a fallback template SHALL NOT be synthesized to fill the gap. Artifacts left on disk by an earlier `enabled` generation SHALL **never** re-activate a capability the resolver has judged `disabled`, and switching a phase from `enabled` to `disabled` SHALL NOT require deleting them.

The resolution SHALL be identical in `interactive`, `headless` and `goal`. There SHALL be no mode-conditional branch anywhere in verifier adjudication: the previous asymmetry — an adapter-capability gate that applied to `interactive` only, paired with a publication path that refused to publish under `goal` — produced an empty intersection in which a completed, passing review could never close a phase, and burned two unattended runs before anyone noticed.

There SHALL be no third state. A `blocked` outcome existed to express "policy demands a verifier that this adapter cannot publish"; with publication no longer adapter-specific, the only remaining gap is a tool that cannot dispatch a subagent, which is disclosed as `disabled` rather than raised as a failure.

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

#### Scenario: A full goal phase resolves exactly as interactive

- **WHEN** a `full` feature phase runs under `goal` with an adapter declaring `verifier_subagent`
- **THEN** the plan SHALL be `enabled`, the same request and report protocol SHALL apply, and closure SHALL be reachable without any operator intervention

#### Scenario: An adapter without a reviewer disables rather than blocks

- **WHEN** the evidence policy resolves `verifier` to `required` and the adapter declares no `verifier_subagent`
- **THEN** the plan SHALL be `disabled` with reason `adapter_has_no_reviewer`, and no request SHALL be issued

## MODIFIED Requirements (appended 2026-09-05: missed in the first pass)

### Requirement: Receipt hard blocks dispatch by policy

check-receipt 的 verifier / invoked_via / trace_json / context_exploration / self_check 硬必需块 MUST 先查 evidence policy：`required` 走现有校验；`off` 记 `skipped_by_policy` 不 FAIL；`optional` 缺失仅 WARN；lite feature MUST 整体返回 exit 0 + 顶层 `not_applicable` 机读标注。

verifier 块 MUST 消费共享的 verifier plan 解析结果，而非自行按 `policy.verifier` 二分：`disabled` 记 `skipped_by_policy` / `not_applicable` 且 loader 不调用、报告与 request 均不要求，其中 `adapter_has_no_reviewer` MUST 记 `not_reviewed` 并以非阻断 WARN 披露；`enabled` 读当前 subject 的 `verifier.report.<subject>.md`，仅当终态块回显 `summary.verifier_subject_id` 且 verdict 与 blocker_count 自洽时接受。代际分派 MUST NOT 参与（plan d2f7a9c4：按 `summary.schema_version` 劈成两代会让能力被合法关闭读成这是旧件）。回执手填的 `invoked_via` / `report_path` / `verdict` MUST NOT 单独构成通过或失败条件。

#### Scenario: balanced 下 verifier off 的 receipt 通过
- **WHEN** full×balanced 的 review phase receipt 无 verifier 节
- **THEN** check-receipt 记 verifier=skipped_by_policy 且 exit 0

#### Scenario: 无审查员的 adapter 照常闭环并披露
- **WHEN** 当前 adapter 未声明 `verifier_subagent` 且脚本门禁通过
- **THEN** check-receipt exit 0，verifier 轴记 `not_reviewed` 并输出非阻断 WARN

#### Scenario: strict 行为不变
- **WHEN** 缺省 strict 下 receipt 缺 verifier verdict
- **THEN** BLOCKER FAIL（与现状一致）

## REMOVED Requirements

### Requirement: A missing verifier provider never suppresses script diagnosis
**Reason**: The `blocked` state it governed no longer exists. Publication is no longer adapter-specific, so "the policy demands a verifier this adapter cannot publish" has no referent; the remaining case — a tool that cannot dispatch a subagent — resolves to `disabled` with disclosure instead of a BLOCKER.

**Migration**: Delete the `verifier_provider_unavailable` check, the `resolve_verifier_provider_then_rerun` next action, and the `blocked` branches in the runner and the receipt gate.

### Requirement: Concurrent verifier rounds are separated by identity, and contradictions become an explicit conflict
**Reason**: The compare-and-set publication loop, the absorbing `conflict` state and the conclusion-fingerprint recomputation were all properties of a hook that no longer exists, and all served tamper resistance. The dispatcher is a single writer per subject, and running two verifiers on one subject is an operator error the skills already forbid — not a supported state worth a state machine.

**Migration**: Delete the conflict state, `result_sha256` and its recomputation, the bedside record and its sixteen failure classifications; a later round for the same subject simply overwrites the report, and the subject partition still keeps distinct subjects apart.

### Requirement: check-receipt adjudicates verifier evidence by identity, dispatched on the resolved plan and the summary generation
**Reason**: Both dispatch axes are gone. Identity verification depended on hook-published binding fields, and the generation split existed only to grandfather the pre-identity protocol; keeping either would preserve the read surface that made a legitimately disabled capability look like a missing artifact.

**Migration**: Replaced by "check-receipt adjudicates verifier evidence by subject echo" in this change; delete `readSummarySchemaVersion` and `readSummaryClosureStatus` from the evidence loader.

### Requirement: The review closure attestation binds identity-verified verifier evidence
**Reason**: `verifier_report_sha256` and `verifier_result_sha256` bound a canonical JSON that no longer exists, and hashing the markdown instead would make the attestation the one place where editing a deliberately unprotected report still has a machine consequence.

**Migration**: Replaced by "The review closure attestation records the reviewed verifier subject" in this change; `schema_version` advances to `1.2` and only `verifier_subject_id` is retained.
