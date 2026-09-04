# correction-routing Specification

## Purpose
TBD - created by archiving change correction-routing. Update Purpose after archive.
## Requirements
### Requirement: Attribution resolves before any edit

对进行中工程的 NL 修正请求，agent MUST 在任何产物编辑发生前经 `resolveCorrectionTarget` 解析 feature 归属；无法确定时 MUST 先向用户确认或显式进入 no-feature correction 模式。"按 diff 经 catalog 反查"MUST 只作收尾对账手段，MUST NOT 作为首次归属来源。

#### Scenario: 归属不明先停
- **WHEN** 修正请求无法映射到已管理 feature 且用户在场
- **THEN** agent 停下确认归属或声明进入 no-feature 模式，而非先动手改

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`（resolveCorrectionTarget）, `templates/AGENTS.md.template`

### Requirement: Correction classifies to root layer with machine-computed revalidation

A correction SHALL still be classified by `classifyCorrection` into `{root_layer, touched_layers[], revalidate[]}` for routing and for the revalidation hint. Revalidation SHALL be executed by `--revalidate`, which runs only the necessary existing checks against stale inputs; it SHALL NOT re-produce unaffected artifacts, SHALL NOT require receipts and SHALL NOT run the verifier by default. No closing command SHALL be required for a feature correction to end.

Enforcement: `harness/scripts/utils/correction-routing.ts`, `harness/harness-runner.ts`

#### Scenario: A coding correction ends without a ledger

- **WHEN** a correction rooted at coding is implemented and `--revalidate` passes
- **THEN** the correction is finished; no state file and no reconciliation command are involved

### Requirement: Correction state persists for self-check

Only no-feature (`--adhoc-correction`) corrections SHALL persist state, and only the fields the adhoc path consumes (`base_commit`, `session_id`, `created_at`, `expires_at`). Feature corrections SHALL NOT write `.current-correction.json`, and the Stop hook SHALL NOT read it.

Enforcement: `harness/scripts/utils/correction-state.ts`, `harness/harness-runner.ts`

#### Scenario: Feature corrections leave no state behind

- **WHEN** a correction is initiated for an existing feature
- **THEN** no `.current-correction.json` is written and stopping the session is never blocked on its account

### Requirement: No-feature corrections run via adhoc entry

无 feature 归属的修正 MUST 经 `--adhoc-correction` 专用入口执行验证，MUST NOT 为此创建临时 feature 目录。契约：输入 MUST 为含 `base_commit` 的 correction state（缺失/stale → exit 非零）；changed-files MUST 取 `git diff --name-only <base_commit>` ∪ 工作区未提交变更，触及模块经 catalog 反查记录回 state；必跑检查 MUST 含 profile `coding.compile`、`coding.lint`、架构规则（层依赖/跨模块出口）与受保护前缀（no-feature 下以此替代 `diff_within_scope`，越界防护不豁免）；报告 MUST 落 `framework/harness/reports/_adhoc/<timestamp>/` 并逐项列 revalidate 结果；revalidate 含 testing 时 evidence MUST 为 device 即席报告或 `manual_confirm` 记录，缺能力走验证转嫁禁令。

#### Scenario: 散修不造假目录
- **WHEN** no-feature correction 完成实施并自检
- **THEN** `--adhoc-correction` 读 correction state 跑上述检查清单，features_dir 无新增目录，报告落 `reports/_adhoc/`

#### Scenario: 缺 base_commit 快速失败
- **WHEN** `--adhoc-correction` 读到无 base_commit 的 correction state
- **THEN** exit 非零并提示先经修正入口建立 correction，不得凭空猜 diff 基准

> **Enforced by:** `harness/harness-runner.ts`

### Requirement: Enforcement tier is adapter-honest

`resolveEnforcementTier` SHALL keep describing whether physical Stop interception exists for phase closure. No tier SHALL claim that corrections are intercepted, because correction reconciliation no longer exists.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `agents/README.md`

#### Scenario: hard_hook tier makes no correction claim

- **WHEN** the Claude adapter resolves to `hard_hook`
- **THEN** documentation and reports SHALL describe phase-closure interception only

### Requirement: Verification hand-off is an evidence gap

When a correction requires testing but the host lacks the required device/runtime capability, the runner SHALL record the concrete missing capability and project the existing external/capability-missing defer state. A request for someone to test manually, a manual-confirm record, or a user reply MUST NOT count as completion evidence. If the capability is available but the execution evidence is missing or invalid, the owning testing gate SHALL FAIL and retry/fuse normally.

Enforcement: `harness/scripts/goal-runner.ts`, `harness/scripts/utils/capability-resolution.ts`, `templates/AGENTS.md.template`

#### Scenario: correction host lacks a required device provider

- **WHEN** a correction's revalidation includes P0 device testing and preflight proves the selected profile/provider cannot supply it
- **THEN** the correction SHALL defer with the exact capability blocker and SHALL NOT announce completion or wait for a quality signature

### Requirement: User feedback after completion is successor input, not retrospective confirmation

User feedback received after a valid feature completion SHALL create or amend a new correction/successor input bound to the new run identity. The prior run's evidence and completion result SHALL remain immutable audit history. The feedback SHALL route to spec when it changes the target requirement and to the responsible implementation phase when the requirement is unchanged.

Enforcement: `harness/scripts/utils/correction-routing.ts`, `harness/scripts/goal-runner.ts`, `harness/scripts/utils/verify-feature-completion.ts`

#### Scenario: changed UX intent routes to spec

- **WHEN** the user changes the desired layout after delivery rather than reporting an implementation mismatch
- **THEN** the new successor input SHALL route to spec and the old run SHALL NOT gain or lose a confirmation mark
