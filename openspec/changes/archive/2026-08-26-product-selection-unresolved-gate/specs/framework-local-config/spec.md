## ADDED Requirements

### Requirement: Local product confirmation credential with strict validation

`framework.local.json > toolchain.productSelection.confirmed` MUST 承载本机 product 确认
凭证 `{ value, confirmed_at? }`：`value` 非空字符串、`confirmed_at`（若存在）非空 ISO
字符串；未知键 MUST 被拒绝（与 `LOCAL_PROBE_KEYS` 同等严格）。写入方唯一 =
`record-product-selection` 机器 CLI（用户经 registry `init.product_selection` 显式选择后），
写回 MUST 走 `updateLocalConfig` 无损路径（devEcoStudio / probe / vision / device 等既有
内容逐字保留）。config 与 local 由同一次操作写入并保持一致；任一方写入失败 MUST 回滚先写方
（fail-closed，任何时刻不留下仅单方的不一致状态）。

`explicit_config` 的可信判据 MUST 为：config `toolchain.preferredProduct` **且**
`toolchain.productSelection.confirmed.value` 逐字相等；无 local 记录或值不等均为
`legacy_unverified_config`，MUST NOT 作为可信来源（配置来源治理：推断值不得冒充用户意图）。
来源不明的存量 `preferredProduct` MUST NOT 被静默删除（配置所有权），仅不再被采信。

#### Scenario: 确认后 config 与 local 双写一致且 resolver 采信
- **WHEN** 用户确认 product=X（config 无值或为错误旧值）
- **THEN** config `toolchain.preferredProduct=X` 且 local `confirmed.value=X` 双写一致
- **AND** resolver 得 `explicit_config`，X 生效

#### Scenario: local 无记录时 config 值不采信
- **WHEN** config 有 `preferredProduct` 而 local 无确认记录（含他人 clone、AI 历史推断值）
- **THEN** resolver MUST 按未验证处理（只可能落 `sole_candidate` 或 `unresolved`）

> **Enforced by:** `harness/scripts/utils/framework-local-config.ts`,
> `harness/scripts/record-product-selection.ts`,
> `profiles/hmos-app/harness/product-selection.ts`,
> `harness/tests/unit/product-selection.unit.test.ts`