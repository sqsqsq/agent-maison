# Proposal: Runtime Policy Core — track/evidence/phase-chain 三判定单点化

## Why

feature phase 集合 `spec|plan|coding|review|ut|testing` 与闭环判定散落硬编码于 8+ 处运行时（check-receipt、phase-transition-policy、trace schema、compat-loader、goal-runner、Stop hook 下发件等）。任何新档位 / 新 phase 都会"入口认、运行时不认"，出现 runner 放行、Stop hook / check-receipt 继续阻断的 split-brain——这是轻量化分档（plan d4a7c1e8）的第一性障碍。

## What Changes

- 新增 policy 模块（`harness/scripts/utils/runtime-policy.ts`）提供四个纯函数判定：
  - `classifyRequestRoute()` → `direct|feature`（入口路由决策，L0 不做成假 track）
  - `resolveFeatureTrack(featureDir, config)` → `lite|full`（读 feature.yaml，缺省 full）
  - `resolveEvidencePolicy(track, runtimeContext, config)` → 各凭证 policy 档 `required|optional|off|not_applicable`（纯函数不读文件；headless/goal 强制 strict）
  - `resolvePhaseChain(workflow, track)` → 该 track 的合法 phase 集与 requires DAG（含 auto_chain 投影，一致性校验、不做隐式推导）
- `runtimeContext` 显式类型契约：`mode: interactive|headless|goal`、`adapter`、`phase`、`workflow`、`can_prompt_user`、`can_collect_usage`
- 收编运行时枚举硬编码为消费 workflow 合法集 / C0 输出：check-receipt.ts VALID_PHASES、phase-transition-policy.ts FeaturePhase/FEATURE_PHASE_ORDER、trace.schema.json phase enum（改 pattern + runner 侧按 workflow 合法集校验）、compat-loader / backfill-context-exploration / context-exploration / exploration-strategy / goal-progress / phase-alias 同型枚举、goal-runner/monitor/status
- Stop hook 下发件改读 `.current-phase.json` 内 policy 快照（不 import harness 模块）；快照带 `schema_version`，hook 读不到 / 版本不符 / runner 未写成功时 **fail-safe 回 strict 全凭证**

## Impact

- Affected specs: runtime-policy（新增）
- Affected code: `harness/scripts/utils/runtime-policy.ts`（新增）、`harness/scripts/check-receipt.ts`、`harness/scripts/utils/phase-transition-policy.ts`、`harness/trace/trace.schema.json`、`harness/compat-loader.ts`、`harness/scripts/backfill-context-exploration.ts`、`harness/scripts/utils/{context-exploration,exploration-strategy,goal-progress,phase-alias}.ts`、`harness/scripts/goal-{runner,monitor,status}.ts`、`agents/claude/templates/hooks/{check-phase-completion,record-verifier-report}.mjs`、`harness/harness-runner.ts`
- 兼容不变式：**纯重构**——default full+strict 下四判定输出与现状逐一等值，全 fixture 零变化（契约单测锁死）
