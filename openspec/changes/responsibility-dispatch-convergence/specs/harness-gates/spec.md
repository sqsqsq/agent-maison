## MODIFIED Requirements

### Requirement: Receipt hard blocks dispatch by policy

check-receipt 的 verifier / invoked_via / trace_json / context_exploration / self_check 硬必需块 MUST 先查 evidence policy：`required` 走现有校验；`off` 记 `skipped_by_policy` 不 FAIL；`optional` 缺失仅 WARN；已退役 lite MUST NOT 产生跳过闭环的 not_applicable 捷径。

verifier 块 MUST 消费共享的 verifier plan 解析结果，而非自行按 `policy.verifier` 二分：`disabled` 记 `skipped_by_policy` / `not_applicable` 且 loader 不调用、报告与 request 均不要求，其中 `adapter_has_no_reviewer` MUST 记 `not_reviewed` 并以非阻断 WARN 披露；`enabled` 读当前 subject 的 `verifier.report.<subject>.md`，仅当终态块回显 `summary.verifier_subject_id` 且 verdict 与 blocker_count 自洽时接受。代际分派 MUST NOT 参与（plan d2f7a9c4：按 `summary.schema_version` 劈成两代会让能力被合法关闭读成这是旧件）。回执手填的 `invoked_via` / `report_path` / `verdict` MUST NOT 单独构成通过或失败条件。

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

### Requirement: Closure source dispatches by policy

Closure SHALL consume existing receipts and effective obligation evidence. Policy not_applicable MUST NOT be relabelled receipt-passed. Retired lite exit reports and change checkboxes SHALL no longer sign closure or resume completion.

#### Scenario: A historical lite closure is encountered
- **WHEN** entry finds a frozen change/coding/exit birth chain
- **THEN** it SHALL report the retirement migration route without resuming its exit-report closure under the new release

Enforcement: `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/runtime-policy.ts`

### Requirement: Runner filters DAG by track

The runner SHALL validate requested phases against the supported workflow and original effective authorization. A residual track:lite key on a modern request/run SHALL be ignored with a retirement diagnostic, without converting its obligations to a full chain. A frozen change/exit run MUST be rejected with migration guidance before removed-stage registration validation.

#### Scenario: Modern scope with a residual key
- **WHEN** a valid modern scope retains track:lite
- **THEN** its existing requested responsibilities remain authoritative and no retired phase executes

Enforcement: `harness/harness-runner.ts`, `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/feature-track.ts`

### Requirement: The verifier plan is resolved once and consumed by every stage

Whether a phase runs a verifier SHALL be resolved by one shared function from four inputs — the workflow's `verifier_prompt` declaration, the feature track, the resolved evidence policy, and whether the active adapter declares `verifier_subagent` — producing exactly one of `disabled` or `enabled`. The runner's production path, the receipt gate and the Skill guidance SHALL all consume that single result; none of them SHALL re-derive applicability on its own.

Resolution order SHALL be fixed and SHALL NOT be reordered by any caller: profile-disabled phase, then absent workflow declaration, then evidence policy `not_applicable` / `off`, then absent adapter reviewer, then enabled.

`disabled` SHALL mean **absent equals zero**: no `ai-prompt.md`, no request, no subject, no invocation, and no closure requirement. A workflow that does not declare `verifier_prompt` for a phase SHALL be `disabled` — that is "not applicable", not "missing", and a fallback template SHALL NOT be synthesized to fill the gap. Artifacts left on disk by an earlier `enabled` generation SHALL **never** re-activate a capability the resolver has judged `disabled`, and switching a phase from `enabled` to `disabled` SHALL NOT require deleting them.

`enabled` SHALL mean the capability exists this round; whether a request is actually issued SHALL be a separate judgement made by the shared request-eligibility predicate, which covers both the ordinary `PASS` path and the two narrow diagnosable-failure shapes. Applicability and eligibility SHALL remain two questions with two answers: a phase may be `enabled` and still issue nothing.

The resolution SHALL be identical in `interactive`, `headless` and `goal`. There SHALL be no mode-conditional branch anywhere in verifier adjudication: the previous asymmetry — an adapter-capability gate that applied to `interactive` only, paired with a publication path that refused to publish under `goal` — produced an empty intersection in which a completed, passing review could never close a phase, and burned two unattended runs before anyone noticed.

There SHALL be no third state. A `blocked` outcome existed to express "policy demands a verifier that this adapter cannot publish"; with publication no longer adapter-specific, the only remaining gap is a tool that cannot dispatch a subagent, which is disclosed as `disabled` rather than raised as a failure.

The resolution result SHALL NOT be persisted as a summary snapshot or any other parallel state.

Enforcement: `harness/scripts/utils/verifier-plan.ts`, `harness/harness-runner.ts`, `harness/scripts/check-receipt.ts`

#### Scenario: A workflow has no verifier declaration

- **WHEN** a supported workflow phase has no verifier_prompt
- **THEN** the plan SHALL be disabled and SHALL write no prompt/request/subject or verifier closure requirement

#### Scenario: An enabled phase can still issue nothing

- **WHEN** the plan resolves `enabled` and the script gate fails outside the two diagnosable shapes
- **THEN** the plan SHALL remain `enabled`, no request SHALL be issued, and the closure gate SHALL keep treating the phase as one that owes a verifier once its script gate passes

## REMOVED Requirements

### Requirement: change phase gate

**Reason**: c2f7a91e retires lite execution and its dedicated artifacts/entry points. Canonical source clauses are explicitly marked retired until archive removes them; deleted implementations are no longer claimed as current enforcement.

**Migration**: Ignore residual track keys on modern runs; finish historical change/coding/exit runs with their matching old release or start a newly authorized run, preserving delivery budgets. Non-lite behavior remains supported.

### Requirement: exit gate is the single lite checkpoint

**Reason**: c2f7a91e retires lite execution and its dedicated artifacts/entry points. Canonical source clauses are explicitly marked retired until archive removes them; deleted implementations are no longer claimed as current enforcement.

**Migration**: Ignore residual track keys on modern runs; finish historical change/coding/exit runs with their matching old release or start a newly authorized run, preserving delivery budgets. Non-lite behavior remains supported.

