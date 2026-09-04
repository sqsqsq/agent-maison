# runtime-policy Specification

## Purpose
TBD - created by archiving change verification-matrix. Update Purpose after archive.
## Requirements
### Requirement: evidence_profile config knob

`framework.config.json` MAY 声明顶层 `evidence_profile: strict|balanced`；缺省 MUST 为 strict 且行为与引入前逐一等值。`minimal` MUST NOT 是合法 config 值——它只能是 lite track 的求解结果。

#### Scenario: 缺省零变化
- **WHEN** 消费者 config 未声明 evidence_profile
- **THEN** 全部凭证按 strict（现状）求解，既有夹具零回归

#### Scenario: 全局声明 minimal 被拒
- **WHEN** config 写入 `evidence_profile: "minimal"`
- **THEN** config 校验 FAIL

> **Enforced by:** `specs/framework.config.schema.json`, `harness/config.ts`

### Requirement: Evidence matrix resolution

`resolveEvidencePolicy` MUST 按矩阵求解：full×strict 全 required；full×balanced（仅交互态）verifier 仅 {spec, coding} required（保留集 config 可覆写）、receipt required、trace optional；lite resolved=minimal——verifier off、receipt not_applicable、exit 脚本门禁 required。headless/goal MUST 恒按 strict 求解。

#### Scenario: balanced 交互态跳过 review 阶段 verifier
- **WHEN** interactive + full + balanced 下求解 review phase
- **THEN** verifier=off、receipt=required、脚本门禁=required

#### Scenario: goal-mode 无视 balanced
- **WHEN** goal-runner 驱动同一 feature（config 声明 balanced）
- **THEN** 全凭证按 strict required

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`

### Requirement: Anti-cheat red lines are outside the matrix

The framework control-plane write boundary, build-fingerprint binding, asset-crop reproduction, process-input sanitization, and `diff_within_scope` SHALL remain outside runtime policy's evidence-tier matrix. The framework boundary SHALL be enforced by an out-of-model read-only principal where available, or represented honestly by the cooperative editing-tool guard where it is not.

Runtime policy SHALL NOT introduce or lower a framework Git dirty check, HEAD/commit identity, per-file manifest hashing, sidecar self-check, foreign-file scan, trust baseline, allowlist, or bypass. The guard's shell/script/external-process blind spots SHALL remain explicit at every tier. Legacy signer/confirmation fields SHALL not lower actual machine checks.

The runtime-artifact policy consumed by this boundary SHALL describe only Maison output and guard paths. It SHALL NOT derive host source-control configuration, and no tier SHALL gain a compensating detector that reads or writes the host `.gitignore`.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `agents/shared/guard-framework-write-core.mjs`, `harness/tests/unit/runtime-policy.unit.test.ts`

#### Scenario: Framework boundary does not depend on evidence tier

- **WHEN** a lite track or relaxed evidence profile is active
- **THEN** the environment read-only boundary or cooperative editing-tool guard SHALL remain unchanged, and no Git/hash detector SHALL be added as a tier-independent fallback

#### Scenario: Legacy signer does not bypass crop reproduction

- **WHEN** a crop artifact has a legacy signer field but current source/bbox reproduction fails
- **THEN** the crop gate SHALL fail independently of runtime tier and signer identity

### Requirement: Resolved phase chains expose ownership inputs without becoming an owner registry

Runtime policy SHALL expose the active full/lite/custom workflow phase set and order to the phase write-boundary resolver. Artifact ownership SHALL still come from phase-contract `produces` plus artifact/evidence resolvers, and source ownership SHALL still come from coding scope and profile-specific UT/testing resolvers. Runtime policy MUST NOT add a path-owner manifest, hard-code the canonical six phases, or grant a custom phase source ownership merely because it exists in the chain.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/skill-contract.ts`, `harness/scripts/utils/phase-write-boundary.ts`

#### Scenario: lite workflow derives only its real nodes

- **WHEN** the active chain is `change → coding → exit`
- **THEN** owner/backtrack resolution SHALL use only those nodes and SHALL NOT invent spec, plan, review, UT, or testing targets

### Requirement: Runtime capability support and produced evidence are separate facts

Runtime policy/capability resolution SHALL determine provider/profile support before a phase invocation without reading current-run output evidence. Evidence produced after invocation SHALL be validated by the owning checker and MUST NOT mutate the immutable pre-check capability report. Unsupported capability projects capability-missing; declared support with missing or invalid output projects a checker failure.

Enforcement: `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/utils/capability-resolution.ts`, `harness/harness-runner.ts`

#### Scenario: current evidence cannot retroactively change capability

- **WHEN** a runtime provider declares step telemetry support but produces no observation file
- **THEN** the capability report SHALL remain `available` and testing SHALL report evidence FAIL rather than rewriting support to capability-missing

### Requirement: Runtime phase set derives from workflow

所有运行时组件（harness-runner、check-receipt、phase-transition-policy、trace 校验、goal-runner/monitor/status、compat/backfill/exploration 工具）MUST 从 active workflow 的 `artifacts[]` 解析合法 feature phase 集，MUST NOT 各自持有 `spec|plan|coding|review|ut|testing` 硬编码枚举。

#### Scenario: workflow 新增 phase 后运行时全链认可
- **WHEN** workflow YAML 声明新 phase id（如 `change`/`exit`）且 harness 各入口以该 phase 运行
- **THEN** check-receipt、transition-policy、trace 校验与 goal-runner 均接受该 phase，不出现"runner 放行、其它组件拒绝"的 split-brain

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`, `harness/scripts/check-receipt.ts`, `harness/scripts/utils/phase-transition-policy.ts`

### Requirement: Pure policy resolver set

policy 模块 MUST 提供核心纯函数 `classifyRequestRoute()`、`resolveFeatureTrack()`、`resolveEvidencePolicy()`、`resolvePhaseChain()`；判定集合可由后续 change 在同一模块扩展（C5 增 `resolveCorrectionTarget` / `classifyCorrection` / `resolveEnforcementTier`），扩展 MUST 同守纯函数与 default 等值不变式；`resolveEvidencePolicy` MUST NOT 执行文件 I/O（`provided` 属校验层事实，不在 policy 输出枚举内），输出限于 `required|optional|off|not_applicable`。

#### Scenario: headless 强制 strict
- **WHEN** `runtimeContext.mode` 为 `headless` 或 `goal`，且 config 声明了任何降档
- **THEN** `resolveEvidencePolicy` 仍按 strict 求解（全凭证 required）

#### Scenario: default 态与现状等值
- **WHEN** 无 feature.yaml、config 无 evidence 段、track 缺省 full
- **THEN** 四判定输出与收编前硬编码行为逐一等值（契约单测断言）

> **Enforced by:** `harness/scripts/utils/runtime-policy.ts`, `harness/tests/`（契约单测）

### Requirement: Stop hook policy snapshot fail-safe

harness-runner MUST 将 policy 快照（含 `policy_schema_version`、track、evidence 档位）写入 `.current-phase.json`；下发 Stop hook MUST 只读快照、MUST NOT import harness 模块；快照缺失、`policy_schema_version` 不符或解析失败时，hook MUST fail-safe 按 full+strict 全凭证判定放行条件。

#### Scenario: 快照缺失时 fail-closed
- **WHEN** Stop hook 读取 `.current-phase.json` 无 policy 快照字段（旧 state 或 runner 未写成功）
- **THEN** hook 按 full+strict 判定（宁可多设防），不静默放行

> **Enforced by:** `agents/claude/templates/hooks/check-phase-completion.mjs`, `harness/harness-runner.ts`

### Requirement: Trace phase validation moves to runner

`trace.schema.json` 的 `phase` 字段 MUST 放宽为形态 pattern；phase 语义合法性 MUST 由 runner 侧按 active workflow 合法集校验。

#### Scenario: 旧 workflow 的 trace 继续合法
- **WHEN** 既有 feature 在 spec-driven workflow 下产出 `phase: "coding"` 的 trace.json
- **THEN** schema 与 runner 校验均通过（向后兼容零变化）

> **Enforced by:** `harness/trace/trace.schema.json`, `harness/harness-runner.ts`

### Requirement: Completion status projects gaps and non-reverified verification honestly

The completion projection SHALL distinguish `COMPLETE`, `COMPLETE_WITH_GAPS`, `COMPLETE_WITH_P0_GAPS` and `FAILED`. A phase closed on a prior verifier PASS with changed material SHALL carry `verifier: completed_with_prior_review` and `current_material_not_reverified`; a phase re-closed by `--revalidate` SHALL carry `script_revalidated` and `semantic_not_reverified`. None of these states SHALL be rendered as PASS for the current material, and none SHALL block normal development completion.

Enforcement: `harness/scripts/utils/verify-feature-completion.ts`, `harness/scripts/utils/quality-axes.ts`, `harness/scripts/utils/phase-closure-finalizer.ts`

#### Scenario: Gaps and stale review are visible together

- **WHEN** a feature completes with two P0 unsupported gaps and a testing phase closed on a prior review
- **THEN** the projection reads `COMPLETE_WITH_P0_GAPS` with both facts listed
