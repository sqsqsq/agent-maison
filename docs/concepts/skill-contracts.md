# Skill 契约与能力解析

Skill contract 是 feature phase 的可执行输入声明。它定义产生的 artifact、验证入口，以及在 checker 开始前能够确定的能力输入；它不替代 phase rules、quality axes、closure 或 release 的既有裁决。

每个 feature Skill 在 `skills/feature/<skill>/contract.yaml` 中维护契约；`harness/scripts/utils/skill-contract.ts` 负责加载，`check-contract-consistency.ts` 负责静态一致性校验。新增或调整 phase 时，先调整 contract，再调整 checker 与 Skill 文档。

## 输入与 capability

一个 phase 的 `inputs` 只是输入目录：每项由稳定 `id` 和按顺序尝试的结构化 `sources` 组成。

- `artifact` source 精确引用已登记 artifact；不存在时记录为 `absent`，然后尝试下一 source。
- `derive` source 精确引用纯 provider id；不存在的目录或无法推导的输入同样是 `absent`；`invalid` 会停止该 input 的 fallback。
- 不存在字符串 DSL、交互式 ask source、动态 provider 匹配或 input 级 required/optional 政策。

`capabilities` 通过 input id 声明要验证的能力，每一项都包含 `id`、`axis`、`inputs`、`tracks`、可选 `applicability_provider_id` 和唯一的缺失策略 `on_missing`。

```yaml
inputs:
  - id: acceptance
    sources:
      - kind: artifact
        artifact: acceptance@1
      - kind: derive
        provider_id: derive.requirement
capabilities:
  - id: capability_example_acceptance
    axis: evidence
    inputs: [acceptance]
    tracks: [full]
    on_missing: fail
```

解析先运行 track 与命名 applicability provider；若不适用，capability 是 `not_applicable`，且不会尝试 source。适用后 source 依声明顺序解析：`resolved` 停止成功，`absent` 回退，`invalid` 停止并使 capability `blocked`。可用 capability 的最终状态只有 `resolved`、`pruned`、`blocked`；input 的缺失政策只由 capability 的 `on_missing` 决定。

### `derive.requirement` 来源表（plan c8e5b3f1 t1）

`derive.requirement` 是 spec 阶段 `capability_spec_requirement` 的唯一来源，按序尝试三段；前一段 `absent` 才落入下一段：

| 顺序 | 来源 | 判据 | resolved 依赖绑定 |
|---|---|---|---|
| ① | goal manifest | `options.requirement` 非空（goal 模式经 `MAISON_GOAL_RUN_ID` 注入） | 空（goal 需求由 manifest 身份与 closure 独立绑定） |
| ② | fidelity-intent SSOT | `state==='valid'` ∧ `requirement_provenance==='explicit_cli'` ∧ `execution_identity === phase:<feature>:spec`（不跨身份导入历史 goal 残留） | 只绑 `spec/reports/fidelity-intent.json`（真实 path + sha256） |
| ③ | `change.md`（legacy） | 文件存在 | `change.md` path + sha256 |

**不解锁**：`intent_fallback` provenance、缺 `requirement_provenance` 字段的旧版 SSOT（legacy 兼容、不判 corrupt）、`state==='corrupt'`（按 absent 继续，不升 invalid）、SSOT 身份与当前阶段不符、feature 根宽泛文本（README/笔记/`spec.md`）——这些都不是权威需求来源。三段全无时 input 为 `absent`、capability 因 `on_missing: fail` 变 `blocked`，`detail` 会列出已尝试来源与两条修复路径（goal 模式经 manifest；手动模式带需求文本重跑 Step 1 的 `fidelity-intent-init --requirement(-file)`）。

## 一次性报告、保证等级与新鲜度

phase runner 在 checker 之前只生成一次不可变 `CapabilityResolutionReport`。报告只描述 artifact/derive 的前置可用性；build、install、device run、trace 等运行时事实仍由 checker 的 `CheckResult` 与 holder 管理，绝不回写报告。

报告据 capability 状态机械计算全局保证等级：`blocked < degraded < full`。`summary.json` 1.2 持久化 `assurance`、`capability_resolutions` 及 `capability_resolution_contract_fingerprint`；不再输出 `summary.depth` 或 quality-depth/missing-input 镜像字段。

为保证 fallback 可审计，evidence manifest 只绑定项目内的 applicability 输入，以及从第一个 source 到 resolved/invalid 终止 source 的每一次实际尝试；framework contract 不以文件路径进入 consumer manifest，而以 `capability_resolution_contract_fingerprint` 留在 summary/closure provenance。缺失的高优先级文件按 `exists:false` 绑定，因此随后出现文件也会使旧 closure stale；未尝试的低优先级 source 不进入绑定。

## 质量轴、closure 和 assess

Capability report 是进入质量轴的唯一桥接：

- `pruned` 不改写 quality axis；它保留在 `assurance`、`capability_resolutions`、报告降级段和 `assess.observed.degradations` 中，后者的 `reason_code=capability_pruned` 仅用于 assess 溯源。
- `blocked` 强制对应轴为 `UNVERIFIED`，并令 release 为 `BLOCKED`、投影视图至少 `INCOMPLETE`；这不能被 visual/asset 的 advance 豁免绕过。其 axis resolution 继续复用既有 `needs_fix/agent/current_phase` 路由。

这些投影不会新增公开 `PRUNED` 状态，也不会覆盖任何既有质量、phase advance、closure 或 release 规则。runner 收尾会以 `assertCapabilityConsumption(report, checks)` 双向对账：每个 active `resolved` capability 恰有一个同 ID `CheckResult`，其他状态没有；重复或反向矛盾均为错误。

Goal manifest 可选提供稀疏的 `minimum_assurance`：`{ phase: degraded|full }`。它只会给 `assess@1` 增加 `insufficient_assurance` gap，绝不成为 release 或 closure waiver。满足 floor 的 `pruned` 会列入 `observed.degradations`，不另造 gap；但若带 producer 指针的上游裁剪令下游 `on_missing: fail` capability 变为 `blocked`，assess 会产生 `pruned` gap 并把回补定向到该 producer phase。

## 维护清单

1. 更新 contract schema 与七个 feature contracts。
2. 确保 input source/provider、capability track/axis 和 artifact producer 可由静态 gate 验证。
3. 确保 resolver report 在同一 phase 内只解析一次，并由 summary、质量轴、evidence 和 assess 共用。
4. 为 fallback、invalid、N/A、blocked、freshness 与双向消费分别提供负例回归。
5. 运行 `cd harness && npm test`。