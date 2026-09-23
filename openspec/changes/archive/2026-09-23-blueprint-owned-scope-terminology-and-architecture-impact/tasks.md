## 1. init 交接（t1）

- [x] 1.1 `design_entry_ready` 入 `INDEX_CAPABILITY_WHEN`，lint 拒绝其 `workflow_artifact`；`profileHasDesignLens` 供 P1 checker 与 init next-steps 同源消费；skills.index 登记 component-design（priority 34），spec/plan 措辞改为存量平铺 / 非正式维护；init-orchestration delta 与单测。

## 2. 术语与模块范围进蓝图（t2）

- [x] 2.1 `resolveAdmittedModules` 三处同源；development 节点 `module` 必填并解析为获准模块；术语事实（glossary rank）与 `spec.terminology` 确认点改挂 component-design。
- [x] 2.2 可修改模块集合只从 CU touches 派生，`cu_scope_matches_blueprint` 落在 `validateChangeUnitFeatureProjection`；叙述路径 Scope/术语映射表核对投影；`plan.scope_expansion` 对 CU-bound 不适用。

## 3. 架构影响迁蓝图决策（t3）

- [x] 3.1 decision 子类型 `architecture_impact`（一条决策一个变化项），`dependency_edge` 按操作核对 DSL 目标许可，`dsl_other` 只 WARN；DSL 核对落在共享投影校验。
- [x] 3.2 plan 退出 DSL writer，保留 init 预设 / 手工编辑 + UPDATE 两条获准路径。

## 4. Skill 主流程收敛（t4）

- [x] 4.1 spec/plan SKILL、verify prompts、confirmation registry/UX、blueprint-design-inputs、component-design SKILL 同步口径，行数预算内。

## 5. OpenSpec 与验证（t5）

- [x] 5.1 补 app-component-blueprint、change-unit-continuous-progression、harness-gates delta；单测覆盖 plan §7 正反例；real-chain 回归扩展；`openspec validate` 与 `cd harness && npm test` 全绿。
