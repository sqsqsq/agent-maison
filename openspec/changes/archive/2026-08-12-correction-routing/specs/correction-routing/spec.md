# Delta: Correction Routing — 修正横切操作

## ADDED Requirements

### Requirement: Attribution resolves before any edit

对进行中工程的 NL 修正请求，agent MUST 在任何产物编辑发生前经 `resolveCorrectionTarget` 解析 feature 归属；无法确定时 MUST 先向用户确认或显式进入 no-feature correction 模式。"按 diff 经 catalog 反查"MUST 只作收尾对账手段，MUST NOT 作为首次归属来源。

#### Scenario: 归属不明先停
- **WHEN** 修正请求无法映射到已管理 feature 且用户在场
- **THEN** agent 停下确认归属或声明进入 no-feature 模式，而非先动手改

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`（resolveCorrectionTarget）, `templates/AGENTS.md.template`

### Requirement: Correction classifies to root layer with machine-computed revalidation

修正 MUST 经 `classifyCorrection` 得 `{root_layer, touched_layers[], revalidate[]}`；revalidate MUST 为"落点层及下游已闭环 phase 的脚本门禁"清单（重验 ≠ 重做——不重新生产上游产物）；receipt 走既有 stale 指纹刷新。修正确认 gate MUST 报 root_layer + touched_layers + 重验集 + 理由（strict 必确认；headless 低置信 halt-confirm）。

#### Scenario: 纯实现修正的重验集
- **WHEN** 修正三问判定 root_layer=coding 且 feature 的 coding/ut 已闭环
- **THEN** revalidate 为 coding 与 ut（及依赖它们的已闭环下游）的脚本门禁，spec/plan 不在重验集

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`, `skills/reference/confirmation-registry.yaml`

### Requirement: Correction state persists for self-check

correction 会话 MUST 持久化 `harness/state/.current-correction.json`，字段 MUST 含 schema_version / feature? / root_layer / touched_layers / revalidate / status / created_at / session_id / base_commit / request_fingerprint / enforcement_tier / expires_at；`--correction-check` MUST 以其为稳定输入核查 revalidate 清单全绿后置 closed。session_id 不符（超 grace）或已过期的 state MUST 判 stale——`--correction-check` MUST 拒绝并要求重建 correction，防跨会话误读旧 state（对齐 `.current-phase.json` 既有 session 治理）。

#### Scenario: 跨回合自检
- **WHEN** 修正实施后（同会话或 grace 内）执行 `--correction-check`
- **THEN** 命令读 state 对照清单逐项核查门禁已重跑且绿，否则报缺项 exit 非零

#### Scenario: 陈旧 correction state 被拒
- **WHEN** `--correction-check` 读到 session_id 不符且超 grace、或 expires_at 已过的 state
- **THEN** 判 stale 并 exit 非零，提示重建 correction，不得按旧清单放行

> **Enforced by:** `harness/harness-runner.ts`（--correction-check）, `harness/scripts/utils/phase-state.ts`（session 治理复用）

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

修正闭环保证 MUST 按三档判定并如实声明：`hard_hook` / `headless_runner` / `soft_rule_only`。判档 MUST 为派生纯函数 `resolveEnforcementTier(adapterManifest, runtimeContext)`——依据 adapter manifest 既有 `settings_file`+`hooks` 声明与 `runtimeContext.mode` 派生，MUST NOT 新增 adapter schema 字段，MUST NOT 按 adapter 名字硬编码。派生优先级 MUST 为 mode 先行：`mode ∈ {headless, goal}` → headless_runner（即便 manifest 有 hooks——goal 无头进程下 Stop hook 旁路，物理拦截不在场）；其后 hooks → hard_hook；否则 soft_rule_only。任何文档、报告或剧本 MUST NOT 对 soft_rule_only 档宣称"Stop hook 一定拦"。

#### Scenario: cursor 档的诚实声明
- **WHEN** 修正流程在 cursor adapter 下运行并输出闭环说明
- **THEN** 说明标注 soft_rule_only 档保证边界，不承诺物理拦截

#### Scenario: Claude goal 模式不判 hard_hook
- **WHEN** claude adapter（manifest 有 hooks）在 goal-runner 无头模式下执行修正
- **THEN** enforcement tier 判 headless_runner，报告不得声称物理拦截

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`, `agents/README.md`

### Requirement: Verification hand-off is an evidence gap

revalidate 指向 testing 而宿主缺真机/hylyre 能力、或 feature 无 device 层验收可派生时，agent MUST 显式声明 evidence 缺口并 halt-confirm（列出需要人工验证的具体清单）；"请在真机上试一下"类表述 MUST NOT 作为正常完成收尾。goal-runner MUST 为此记专用 halt 分类，不计入 no_progress。

#### Scenario: 缺真机能力时的收尾
- **WHEN** 修正的重验集含 testing 而宿主无设备能力
- **THEN** 输出"需要人工验证：<清单>"并停在待确认态，而非宣布修复完成

> **Enforced by:** `harness/scripts/goal-runner.ts`, `templates/AGENTS.md.template`

### Requirement: Reconciliation blocks undeclared touched layers

（C5-full）回合收尾对账 MUST 只拦"未声明的 touched layer"：声明仅 spec/plan 却出现 code diff MUST 拦；声明含 coding 的组合修正 MUST 放行但 MUST 重验 coding 及下游。correction 状态 MUST 并入 evidence_policy_snapshot 机制。

#### Scenario: 组合修正合法
- **WHEN** 确认 gate 声明 touched_layers=[spec, coding] 且实施中同轮改了 spec 与代码
- **THEN** 对账放行，revalidate 含 coding 及下游门禁

#### Scenario: 假申报被拦
- **WHEN** 声明 touched_layers=[spec] 但回合产生了源码 diff
- **THEN** 对账 FAIL（按 enforcement 档拦截或报缺项）

> **Enforced by:** `harness/harness-runner.ts`, `agents/claude/templates/hooks/check-phase-completion.mjs`（hard_hook 档）
