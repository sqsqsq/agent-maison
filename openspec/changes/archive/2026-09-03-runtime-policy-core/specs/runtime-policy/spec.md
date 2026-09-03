# Delta: Runtime Policy — 判定单点化与枚举收编

## ADDED Requirements

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
