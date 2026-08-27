# Tasks

- [x] 解析器：`profiles/hmos-app/harness/product-selection.ts`（五源优先级、候选展示排序、未确认引导文案）
- [x] 确认凭证：`framework-local-config.ts` 扩展 `toolchain.productSelection.confirmed`（键白名单 + 严格叶子校验）+ `record-product-selection` 机器写入 CLI（双文件原子写 + 失败回滚 fail-closed）
- [x] coding 入口：`checkCodingCompile` 内单次解析 → 构建参数显式 product；同一 ProductSelection 传分类/详情；`unresolved` 阻断；失败归因首句声明形态未经确认（非可信来源时）
- [x] ut 入口：`ut-host-impl` 单次解析 → `runHvigorBuild`/`runHvigorTest` 显式 product；`unresolved` 阻断
- [x] device_test 入口：`runDeviceTestAppBuild` 单次解析 → 显式 product + 审计（result JSON / metaExtras）；`check-testing` 出口阻断；`detectProduct` 语义收紧（unresolved 抛错，逐调用点核验上游处置）
- [x] goal 启动前置检查：`chain` 含需 product phase 时在首个 phase agent invocation 前解析一次；`unresolved` → 既有 `phase_halt`（`product_selection_unresolved`）+ `run_end{HALTED}`
- [x] 报告可见性：details 一行 `编译形态：product=<X>（来源：<source>）；工程可选：<candidates>`（coding pass/fail、ut、device-test 摘要）
- [x] 文档同步：harness 工具链 doc、device-testing workflow、config.ts 字段注释、template、testing-build-conventions env 说明、confirmation-registry（`init.product_selection`）、framework-init SKILL
- [x] 单测：五 source 各一条（含 explicit_run/confirmed_env 走真实调用链）、carrier 同对象断言、unresolved 上游处置、goal 前置检查、local schema、record CLI fail-closed
- [x] OpenSpec：harness-gates / goal-runner / framework-local-config 三条 spec delta（本 change）