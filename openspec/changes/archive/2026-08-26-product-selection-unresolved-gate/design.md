# Design

## 解析优先级

`resolveProductSelection({ projectRoot, purpose, explicitProduct?, envProduct? })`：

| source | 判据 | 说明 |
|---|---|---|
| `explicit_run` | 本次调用显式参数（如 `buildCodingHvigorArgs` 的 `overrides.product`） | 最高；goal testing 冻结值经 `HARNESS_DEVICE_TEST_PRODUCT` env 注入后由 goal 侧前置解析消费 |
| `confirmed_env` | `HARNESS_DEVICE_TEST_PRODUCT`（仅 `device_test` purpose 读取进程 env；显式 `envProduct` 参数均可） | 既有 env 覆盖通道；goal 冻结的 testing product 走同一入口 |
| `explicit_config` | config `toolchain.preferredProduct` **且** local `toolchain.productSelection.confirmed.value` 逐字相等 | t3 专用机器写入路径保证同一次操作双写一致 |
| `sole_candidate` | `build-profile.json5` 恰好一个 product | 无歧义；仍属「未经用户确认」形态——失败归因首句声明形态未经确认 |
| `unresolved` | 以上全无且无法选定——**不猜**；由上游转既有 halt / 阻断结果。**四种原因**（`unresolvedCause` 逐一对齐）：`multi_candidate_unconfirmed`（多候选且 config 值未确认）、`no_build_profile`（build-profile.json5 缺失）、`empty_products`（存在但未声明 app.products）、`unparseable_build_profile`（无法解析）——后三种**绝不用虚构 `default` 冒充 `sole_candidate`**（review P1：那会重新引入"猜 default 后错误 PASS"的核心风险）。 |

`purpose ∈ 'coding' | 'ut' | 'device_test'` 只用于 env 读取与报告，**不做 per-phase 存储**。

## explicit_config 的来源约束

`preferredProduct` 的写入通道只有一条：`record-product-selection`（机器写 config + local）。
AI 的 `configWritePayload` 通道不含 toolchain（t2b 白名单拒绝），因此「config 值＝local
确认值」只能来自用户经 registry `init.product_selection` 的显式选择。他人 clone 后 local
无记录 → 各自确认一次（届时 config 已有值，一次交互即确认该值）。

## 停止与恢复

- **交互式**（普通 harness 运行）：`unresolved` 时构建入口产出既有 BLOCKER FAIL
  （复用 `externalBlocked` 语义的阻断归因），details 列出全部候选与统一引导文案；
  用户经 `init.product_selection` 确认（或设 `HARNESS_DEVICE_TEST_PRODUCT`）后重跑。
  不新增 failure kind、不新增停止机制、不崩溃。
- **goal 无人值守**：`goal-runner` 在**整个 run 的第一个 phase agent invocation 之前**
  （与 `declared_product_layer_missing` 同一时点模式）解析一次；`unresolved` →
  `phase_halt` + `run_end{HALTED}`（halt_reason=`product_selection_unresolved`），
  不烧任何 phase 预算；确认后 `--resume` 重检。

## 单次解析与 carrier

每个构建作用域（`checkCodingCompile` / `ut-host` 构建入口 / `runDeviceTestAppBuild`）内
解析**一次**，返回的 `ProductSelection` 对象直接用于：(a) 构建参数（显式 `product`）；
(b) 同一对象传给分类函数与 details 生成函数（内存传播，不依赖 `metaExtras`——
`metaExtras` 只写入 `hvigor-*.meta.json` 审计文件，`invokeHvigor` 返回对象不含该字段）。

## 明确不做

- `observed_build`（report 的 `completeCommand` 无终态/task，且文件多写者）；
- per-phase 编译形态存储；
- 新 failure kind / 新停止机制 / `HvigorRunResult` 新顶层字段；
- 删除来源不明的存量 `preferredProduct`。