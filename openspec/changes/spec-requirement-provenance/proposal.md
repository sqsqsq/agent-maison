# spec-requirement-provenance

## Why

宿主实锤（SimulatedWalletForHmos，2026-08-10）：**fresh 手动执行 `/spec` 走 L2 完整流程**
（无 goal run 身份、feature 下无遗留 `change.md`）时，contract 声明 spec 需要 `requirement` 且
`on_missing: fail`，而 provider `derive.requirement` 只认 goal 入参与 lite 轨 `change.md`——阶段驱动
的手动入口拿不到用户需求，却被判成"需求真的缺失"→ capability blocked → INCOMPLETE →
check-receipt 拒绝闭环，重跑多少次都一样。根因是**声明与实现不匹配**：阶段驱动路径缺一个
"用户显式给了需求"的机器可读来源。

## What Changes

- 给既有 `fidelity-intent.json` SSOT（唯一 SSOT，`spec/reports/fidelity-intent.json`）加**可选**
  `requirement_provenance` 字段（`goal_manifest` / `explicit_cli` / `intent_fallback`）。writer 从此
  永远写；字段缺失=旧版 doc（legacy 兼容，不判 corrupt、也不解锁）；字段在场但枚举非法=corrupt
  （半写/篡改不得被当 legacy 混过去）。**不 bump `FIDELITY_INTENT_SCHEMA_VERSION`**。
- 共享 `FidelityRoutingInitInput` 增**必填** `requirementProvenance`，由 TS 必填参数防漏接：
  goal 模式（preflight / vision policy 收紧重建）传 `goal_manifest`；阶段驱动的
  `fidelity-intent-init` CLI 只可能传 `explicit_cli`（收到显式非空需求）或 `intent_fallback`
  （仅靠 `collectIntentTextWithPhaseFallback` 兜底），**不得**判断或写入 `goal_manifest`。
- `fidelity-intent-init` CLI 增 `--requirement-file`，与 `--requirement` 走同一个共享
  `resolveRequirementInput`（互斥 fail-closed + projectRoot 相对路径 + 空文件拒绝）；并在调共享
  resolver 前局部拦截"显式传了空 `--requirement`"（fail-fast，不静默降级成宽泛意图文本解锁）。
- `derive.requirement` 候选链插入中间一段：goal manifest → fidelity-intent SSOT（`valid` ∧
  `explicit_cli` ∧ `execution_identity` 匹配当前 `phase:<feature>:spec`）→ `change.md`（legacy）。
  新段依赖**只绑 `fidelity-intent.json` 本身**（真实 path + sha256），血缘靠既有
  `capabilityResolutionEvidenceInputs` → `productionEvidence` 链自动生效（需求变更重跑 Step 1
  重新签发 SSOT → 旧 closure 自然 stale）。`intent_fallback`/缺字段旧 SSOT/corrupt/跨身份一律
  不解锁；宽泛文本（README/笔记/`spec.md`）不是来源。

## Capabilities

- `harness-gates`：`derive.requirement` 候选链、SSOT 字段校验、失败话术。

## Impact

保护不降级：`on_missing: fail` 不动；三段来源全无时仍然 blocked、仍然拒闭环。goal / lite /
遗留 feature 行为零变化（`change.md` 对 full 轨仍可解）。不新建平行文件/writer/状态/层；不改
共享 resolver 既有语义；blocked capability 仍不产 CheckResult（双射/轴映射/计数不动）。plan：
`.cursor/plans/spec阶段闭环阻断根治_需求来源阶段驱动回退与blocked可诊断化_c8e5b3f1.plan.md`
（v8，t1）。