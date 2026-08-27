## ADDED Requirements

### Requirement: Goal startup MUST resolve product selection once and halt on unresolved

goal run MUST 在**整个 run 的第一个 phase agent invocation 之前**（与
`declared_product_layer_missing` 同一时点模式，`--resume` 同样经过）MUST 解析一次 product
selection——当且仅当链路含需 product 的 phase（coding.compile / ut.* / device_test.*
任一非 skip）。解析按 profile 能力入口（profile 侧 `resolveProductSelection`），profile
不可用时跳过（generic 等无构建语义 profile 不受影响）。

解析结果 `unresolved`（构建形态无法确定——**四种原因**：`multi_candidate_unconfirmed`
多候选且 config 值未确认 / `no_build_profile` build-profile.json5 缺失 / `empty_products`
存在但未声明 app.products / `unparseable_build_profile` 无法解析；后三者**无真实候选**，
MUST NOT 以虚构 `default` 冒充 `sole_candidate`）
MUST 转既有 `phase_halt` 通道（不新建停止机制）：
`phase_halt{ phase: chain[0], halt_reason: 'product_selection_unresolved', verdict: 'FAIL' }`
+ `run_end{HALTED}` + 退出非零，halt_guidance MUST 含全部候选与统一确认引导
（`init.product_selection` / `record-product-selection` CLI / `HARNESS_DEVICE_TEST_PRODUCT`
env 三条路径）。

该检查 MUST 先于任何 phase 预算消耗；确认（config+local 双写）或 env 覆盖后 `--resume`
重检即放行。单候选与已确认工程 MUST 完全不受影响（零新增交互）。

#### Scenario: 多候选未确认的 goal run 在启动阶段停止
- **WHEN** 链路含 coding/ut/testing 且解析结果 `unresolved`
- **THEN** run MUST 在首个 phase agent invocation 前 HALT（`product_selection_unresolved`）
- **AND** MUST NOT 消耗任何 phase 尝试预算，MUST NOT 进入 coding 阶段中途才停

#### Scenario: 未确认值经 idempotent 确认后放行
- **WHEN** 用户经 `record-product-selection` 或 env 显式确认 product
- **THEN** 下一次 `--resume` 的启动前置检查 MUST 放行（`explicit_config` / `confirmed_env`）

> **Enforced by:** `harness/scripts/goal-runner.ts`
> （`product_selection_unresolved` 启动前置检查块）,
> `harness/tests/unit/goal-runner-*.unit.test.ts`