# `generic` · Skill `4-code-review` profile addendum

审查时以 **contracts、acceptance、中立 coding 规则**与仓库**实际语言/分层**为准；无 ArkTS 宿主时，**不得**将 `arkts-pitfalls` 或 `.ets` 专用 BLOCKER 套用于非 TS/非声明式 UI 代码。

若阶段在 profile 中被禁用，不必强行触发 hvigor/UT 类 harness；仍应完成本 Skill 声明的结构化 `review-report` 轨道（如适用）。

## Context Exploration Gate（profile 补充）

审查前探索以 `contracts.yaml > files` 为界；语言专用 pitfall 文档仅在实际宿主 profile 启用时列入 `key_inputs_read`。
