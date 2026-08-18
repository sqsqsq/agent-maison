## Why

2026-08-17 宿主 WalletForHarmonyOS 三轮取证定谳：framework「DevEco 能编、framework 编不过」的
表象是——framework 去编了一个**未经用户确认**的 product（`rom`），而 `rom` 在 DevEco 自己的
UI 里同样编不过（三样本错误集合逐字相同）。更深一层：`detectProduct` 按**名称启发式**猜测
product，猜完不验证、不记录来源、不参与报告；**猜错而恰好编译成功时会直接签发 PASS**——
门禁签发的是「错误形态下的通过」，失败提示根本不会出现。这决定了本 change 不能靠「失败时
提示」兜底，必须在**选定阶段**就要求可信来源。

非致命 `> hvigor ERROR:` 与 errors 判据的误杀（同一取证顺带实锤）由独立 plan todo 治理，
不在本 change 范围。

## What Changes

- 新增 `resolveProductSelection`（profile 侧）：source 枚举按优先级
  `explicit_run → confirmed_env → explicit_config → sole_candidate → unresolved`。
  名称启发式（`product` → `default` → 首位）降级为**仅供候选展示排序**，不产出选定值。
- `explicit_config` 的可信判据：`framework.config.json > toolchain.preferredProduct`
  **且** `framework.local.json > toolchain.productSelection.confirmed.value` 逐字相等；
  其余（无 local 记录 / 值不等 / AI 推断值落盘）一律 `legacy_unverified_config`，
  **不作为可信来源**。确认写入走专用机器路径（`record-product-selection` CLI，
  AI configWritePayload 通道被 t2b 白名单拒绝）。
- `unresolved` 是**新增门禁行为**：构建形态无法确定即停止并要求确认，不再猜 `default`。
  **四种原因**（`unresolvedCause` 逐一对齐）：`multi_candidate_unconfirmed`（多候选且
  config 值未确认）、`no_build_profile`（build-profile.json5 缺失）、`empty_products`
  （存在但未声明 app.products）、`unparseable_build_profile`（无法解析）——后三者的
  **无真实候选，绝不得用虚构 `default` 冒充 `sole_candidate`**（那会重新引入
  "猜 default 后错误 PASS"的核心风险）
  ——coding / ut / device_test 三个受影响 phase 的构建入口以内置既有通道报告阻断
  （不新增 failure kind，不新增停止机制）；goal 无人值守**在 goal 启动前置检查**解析一次，
  未确认即在启动阶段以既有 `phase_halt` 停止（不跑到 coding 中途才停），
  确认后 `--resume` 继续。
- 单候选工程与已确认工程**行为完全不变**（零新增摩擦）：`sole_candidate` / `explicit_config`
  照常构建，报告新增一行 `编译形态：product=<X>（来源：<source>）；工程可选：<candidates>`。
- 不做 `observed_build`（hvigor report 的 `completeCommand` 不携带终态与 task，读取会重现
  选中失败 product 的事故；且该文件由 IDE/CLI/framework 共写，来源不可隔离）。

## Capabilities

### New Capabilities

无。`unresolved` 复用既有 `phase_halt` 通道与既有 blocking_class 语义，不新造停止机制、
不新增 failure kind、不新增 `HvigorRunResult` 顶层字段、不改 `dispatchCodingCompile`
通用返回契约。

### Modified Capabilities

- `harness-gates`：coding 真实编译门禁（`coding.compile`）与 device-testing 打包门禁
  （`device_test.build`）、ut 编译/执行（`ut.compile` / `ut.run`）在编译形态不可信时的
  停止语义；构建参数必须显式使用构建前单次解析的 product。
- `goal-runner`：启动前置检查（第一个 phase agent invocation 之前）解析 product 一次，
  `unresolved` 转既有 `phase_halt`（halt_reason=`product_selection_unresolved`）。
- `framework-local-config`：`toolchain.productSelection.confirmed` 本机确认凭证
  （schema 扩展 + 严格叶子校验 + `updateLocalConfig` 无损写回）。

## Impact

- 代码：`profiles/hmos-app/harness/product-selection.ts`（新增解析器）、
  `harness/scripts/record-product-selection.ts`（新增机器写入 CLI）、
  `harness/scripts/utils/framework-local-config.ts`（local schema 扩展）、
  `profiles/hmos-app/harness/hvigor-runner.ts`（detectProduct 语义收紧）、
  `profiles/hmos-app/harness/coding-host-rules.ts`、`ut-host-impl.ts`、
  `providers/device-test-build.ts`、`harness/scripts/check-testing.ts`、
  `harness/scripts/utils/testing-build-conventions.ts`（hmos-app）、
  `harness/scripts/goal-runner.ts`（启动前置检查）。
- 文档：`docs/profiles/hmos-app-harness-toolchain.md`、
  `skills/reference/device-testing-workflow-detail.md`、
  `skills/reference/confirmation-registry.yaml`（`init.product_selection`）、
  `skills/project/framework-init/SKILL.md`、`templates/framework.config.template.json`、
  `harness/config.ts` 字段注释。
- 行为收紧：多候选且无任何可信来源的工程，构建从「猜一个继续（可能签假 PASS）」变为
  「停止并要求确认一次」；来源不明的存量 `preferredProduct` **不静默删除**（配置所有权），
  只是不再被当作可信来源。
- 不新增配置字段（`toolchain.productSelection` 仅存在于本机 local）、无消费者迁移。