## MODIFIED Requirements

### Requirement: First host evolution seam lands as one vertical Change Unit

P2 MUST apply host evolution seam rules only when the resolved P1 decision has `kind=evolution_candidate`, `status=decided_with_authority` and `human_decision=establish_seam`. A `keep_direct` candidate or ordinary decision MUST use ordinary CU constructability and exact dependency rules and MUST NOT be forced through contract/provider/consumer seam roles.

当 CU 首次落实明确获批的宿主演进接缝 decision 时，同一 CU MUST 覆盖稳定契约、首个真实 Provider、真实 Consumer 与契约测试，且具备真实 target predicates、touches 与 verification refs；空接口横向 CU MUST 被拒绝。后续 Provider MAY 是独立 CU，但 MUST 继续引用该权威 decision，并以精确 `requires.from_change_unit_id + provide_id` 消费已落地稳定契约。前置 CU MUST 引用同一 `human_decision=establish_seam` 的 evolution decision，且该 `provide_id` MUST 由其 contract predicate 单独绑定；被所有 predicates 共用的整单元 outcome 不得冒充稳定契约。P2 MUST NOT 以 priority、Consumer/Provider 描述字符串或仅有 `kind=evolution_candidate` 推断 Provider 演进顺序；若契约或 Consumer 必须变化，该 delta MUST 由当前获准 design/decision refs 明示，否则先触发蓝图调和、契约版本化或迁移裁决。

#### Scenario: First seam slice is complete

- **WHEN** 蓝图以 `human_decision=establish_seam` 批准把记账来源作为接缝且当前尚未落地
- **THEN** 首个 CU 同时施工 contract、首个真实来源 Provider、实际记账 Consumer 和 contract test，不能只提交 interface/factory

#### Scenario: Provider evolution is not inferred from prose or priority

- **WHEN** 两个 Provider CU 的 priority 或 Consumer 描述字符串暗示先后，但没有明确建缝 decision ref 与精确 contract require/provide 关系
- **THEN** P2 不得推断 Provider 演进；只有 `human_decision=establish_seam`、明确依赖和当前获准 design refs 参与接缝施工与调和裁决

#### Scenario: Keep-direct candidate follows ordinary construction

- **WHEN** CU 引用一个合法 `kind=evolution_candidate`、`human_decision=keep_direct` 的 decision
- **THEN** P2 MUST NOT 要求 contract/provider/consumer 纵切或后续 Provider seam dependency，只执行普通 design gate 与 exact dependency 校验

> **Enforced by (P2 implementation):** `harness/scripts/utils/change-unit-evolution-seam.ts`, `harness/scripts/utils/change-unit-design-gate.ts`, `harness/scripts/check-review.ts`
