### 阻塞点（必须由**设计责任方**先补蓝图，否则 consumer 的物化会整批回滚）

我在同一次只读探针里跑通了「投影 → 契约解析 → `validateChangeUnitFeatureProjection(phase='plan')`」，发现两处**蓝图侧**缺口（不在本次写集，故未自行改蓝图）：

1. `design_views[runtime].runtime_data_flows[0].contracts.state_management[0]`
   - `design_ref` 现在是普通地址字符串，投影后仍不是 blueprintRef 对象 → `change_unit_runtime_state_mapping_missing`；
   - 同时缺 `owner_ref`（应为 `view:development/node:dev-card-open-session`）、`contract_refs`（`["contract:card-store"]`）与 `mutations/publications/subscriptions/consumers` 四个 id 数组（应镜像同 flow 顶层同名数组），否则会报 `change_unit_runtime_owner_contract_missing` / `change_unit_runtime_fact_mapping_missing`。
2. `design_views[runtime].runtime_data_flows[0].subscriptions[0]` 缺 `publication_ref` → 复制到 Feature 后 `change_unit_runtime_propagation_edge_mismatch`（应闭合到 `publication:card-open-handoff`，即 `consumer:home-card-state.update_ref`）。

**验证**：在只读内存里给上述两处补上这些字段后，同一套探针返回 `issues: []`、`warnings: []`（`useCasesRequired: true`，蓝图侧 use_cases 已提供），说明本候选的 `design_refs`/`construction_mapping` 与蓝图其余内容自洽；**唯一否决源就是这两处蓝图缺口**。
