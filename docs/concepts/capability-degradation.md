# 通用降级模型：能力裁剪与统一保证等级

本模型把「前置输入不全时哪些验证仍可诚实执行」收敛为一份 phase 级、不可变的 `CapabilityResolutionReport`。它不处理设备、编译、安装或运行等 checker 内的运行时依赖；那些事实仍然只由 `CheckResult` 和原有 holder 记录。

```text
contract inputs/capabilities
  -> applicability preflight
  -> ordered artifact/derive resolution
  -> CapabilityResolutionReport (immutable)
  -> capability CheckResult consumption + blocked-only quality-axis projection
  -> summary 1.2 / evidence manifest / assess
```

## 解析状态

input 是 `resolved | absent | invalid | not_applicable`；capability 是 `resolved | pruned | blocked | not_applicable`。track 与 applicability provider 先确定 capability 是否适用；不适用时不读取任何 source。适用后按 source 声明顺序处理，`absent` 可回退、`resolved` 成功终止、`invalid` 失败终止。

`on_missing: prune` 把最终缺失变为 `pruned`；`on_missing: fail` 变为 `blocked`。多 input capability 只在 preflight 已判适用后聚合，任何 `invalid` 或意外 `not_applicable` 都是 `blocked`，因此不依赖输入遍历顺序。

## 保证等级与既有门禁

保证等级严格有序：`blocked < degraded < full`。它只解释 capability 解析完整度：任意 blocked 为 `blocked`；没有 blocked 且存在 pruned 为 `degraded`；其余为 `full`。`minimum_assurance` 仅影响 assess 是否增加 `insufficient_assurance`，不降低 quality axis、phase advance、closure 或 release 的既有判定。

`pruned` 不改写任何 quality axis、phase advance、closure 或 release 投影；它保留在 `assurance: degraded`、`capability_resolutions`、报告降级段和 assess 的 `observed.degradations` 中。`blocked` 才强制对应轴为 `UNVERIFIED`，并把 release 固定为 `BLOCKED`、总 verdict 至少收紧为 `INCOMPLETE`。因此任何策略均不能把缺失核心能力包装成 PASS closure。

## 新鲜度与消费对账

证据绑定只包含项目内的 applicability 依赖，以及每个已尝试 source 的依赖直到终止点；contract 通过 `capability_resolution_contract_fingerprint` 留在 summary/closure provenance，framework contract 路径绝不进入 consumer feature manifest。高优先级 artifact 缺失而回退到 derive 时，缺失路径也进入 manifest；该路径后来出现会使旧 closure stale。artifact 尝试还记录其 contract 声明的上游 producer phase：只有该 producer 报告 `pruned` 且下游 `on_missing: fail` capability 被阻塞时，assess 才产生 `pruned` gap 并定向建议最小 producer 回补；合法的本地裁剪只留在 `observed.degradations`。

静态 `check-contract-consistency` 只校验声明。checker 完成后，runner 通过纯函数 `assertCapabilityConsumption` 校验报告与 `CheckResult[]` 的精确双向关系，避免声明和实际门禁各自形成 SSOT。