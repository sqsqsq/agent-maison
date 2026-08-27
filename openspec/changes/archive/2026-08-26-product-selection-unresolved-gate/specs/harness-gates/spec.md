## ADDED Requirements

### Requirement: Build phases MUST NOT guess the compile form; unresolved stops via existing channels

coding、ut 与 device-testing 的构建入口 MUST 在参数装配前解析一次 product selection，
且解析结果 MUST 作为构建参数显式传给 hvigor（不得在装配内再次名称猜测），
同一 ProductSelection 对象 MUST 直接传给失败分类器与 details 生成器（内存传播，
MUST NOT 依赖 metaExtras 或 result 对象字段做运行时传播）。

source 优先级 MUST 为：`explicit_run`（本次调用显式参数）→ `confirmed_env`
（`HARNESS_DEVICE_TEST_PRODUCT` 等既有 env 覆盖；goal 冻结的 testing product 走同一入口）
→ `explicit_config`（config 值且 local 确认值逐字相等）→ `sole_candidate`
（build-profile.json5 单候选）→ `unresolved`。

名称启发式（`product`/`default`/首位）MUST NOT 产出选定值，仅供 `unresolved` 时的候选
展示排序。

`unresolved`（构建形态无法确定——**四种原因**：`multi_candidate_unconfirmed` 多候选且
config 值未确认 / `no_build_profile` build-profile.json5 缺失 / `empty_products`
存在但未声明 app.products / `unparseable_build_profile` 无法解析）MUST 停止并要求确认：
交互式 harness 出口产出既有 BLOCKER FAIL（复用 `externalBlocked` 语义，不新增 failure
kind、不新建停止机制），details MUST 如实说明原因并列出全部候选（后三种原因**没有真实
候选**，MUST NOT 用虚构 `default` 冒充 `sole_candidate`）；MUST NOT 以未捕获异常打崩
门禁脚本。goal 无人值守由 `goal-runner` 启动前置检查先行处理（见 goal-runner spec），
MUST NOT 跑到 coding 阶段中途才停。

失败归因在 source 非 `explicit_run`/`confirmed_env`/`explicit_config` 时，explanation
MUST 以首句声明编译形态未经确认。

#### Scenario: 多候选且未确认的宿主不再被猜测
- **WHEN** build-profile.json5 声明多个 product，config 无 `preferredProduct` 或未在本机确认
- **THEN** 构建入口 MUST 报告 `unresolved` 阻断（原因 + 候选 + 确认引导）
- **AND** MUST NOT 选 `product`/`default`/首位继续构建

#### Scenario: build-profile 缺失/为空/不可解析不得虚构 default
- **WHEN** build-profile.json5 缺失（或存在但未声明 product / 无法解析）
- **THEN** 构建入口 MUST 报告 `unresolved`（`no_build_profile` / `empty_products` /
  `unparseable_build_profile`，候选为空），MUST NOT 以虚构 `default` 当作 `sole_candidate` 继续构建

#### Scenario: 单候选与已确认工程行为不变
- **WHEN** build-profile.json5 只有一个 product，或 config 值与 local 确认值相等
- **THEN** 构建照常执行，且报告 MUST 包含 `编译形态：product=<X>（来源：<source>）；工程可选：<candidates>`

#### Scenario: 构建期间外部配置改变
- **WHEN** 构建执行过程中外部修改了 config/build-profile
- **THEN** 该次构建的分类与报告 MUST 继续使用构建前解析的 selection（MUST NOT 二次解析）

> **Enforced by:** `profiles/hmos-app/harness/product-selection.ts`,
> `profiles/hmos-app/harness/coding-host-rules.ts`,
> `profiles/hmos-app/harness/ut-host-impl.ts`,
> `profiles/hmos-app/harness/providers/device-test-build.ts`,
> `harness/scripts/check-testing.ts`,
> `harness/tests/unit/*`（product-selection / hvigor-build-verdict / detect-product 语义）