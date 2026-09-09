---
name: 六阶段重构 B03 — 构建执行复用与报告整理施工图
overview: UT出包在同次harness内唯一化、外层重复真机执行按执行键复用、报告对账区分执行事实与派生统计、attended不再被注入无人值守禁问块；保留completion probe、terminal仲裁与硬预算。
version: 3.0.0
todos:
  - id: b03-detail-after-b02
    content: 按静态调用链证据与既有工具日志细化本批复用点、输入边界、成本代价、提交组和验收命令，不先造缓存机制。
    status: completed
  - id: b03-executor-lifecycle
    content: 撤回不因summary closed结束进程的通用改造；inline删除后保留既有completion probe/grace/kill和terminal仲裁。
    status: cancelled
  - id: b03-mode-context
    content: 按D4用既有executorMode把无人值守禁问块限定为detached，attended保留完整性红线并做bridge fixture，不扩展真实支持。
    status: completed
  - id: b03-build-ut-reuse
    content: 按D1让ut_hvigor_build的构建结果在同次harness调用内传给runHvigorTest，消除二次出包与日志覆盖；无collector的直调路径逐字保留内建构建且不参与复用；不做全局缓存、不承诺节省量。
    status: completed
  - id: b03-device-report-reuse
    content: 按D2给UT加最小执行键复用（整轮键+复用资格前置+逐模块冻结件+hdc日志按模块命名+失败轮由生产路径写记录）、按D3把派生统计缺失改为重建或UNKNOWN+WARN（null进数据、—进报告、冻结件分执行事实组与派生组、性能AC自定NFR识别路径）；原始v1协议缺口、真实执行缺口与性能AC仍须真跑。
    status: completed
  - id: b03-local-acceptance
    content: 完成V1至V11（含V3a/V3b、V4b、V6b、V7b）的进程调用边界计数测试、OpenSpec delta与MIGRATION同步、candidate本地验收。
    status: completed
  - id: b03-host-acceptance
    content: 并入B06的C-U回归：在宿主实测本批的重复消除量与真实测试不漏，本批不单独触发宿主窗口。
    status: completed
---

# B03施工图

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。批次门（总plan §1/§5）：B03在B02**本地**验收后细化实施，B03–B05只做本地验收，宿主回归并入B06。本批不依赖B02宿主结果，依据是**静态调用链**与**既有工具日志/记录**；宿主级节省量在B06实测登记。

## 1. 问题边界

四条浪费均由代码结构直接成立，不需要新宿主样本；行号为本次核实时的实际位置（B01/B02 已提交，工作树干净）。

**① UT 一次门禁出两次包。** [check-ut.ts](../../harness/scripts/check-ut.ts):4519 调 `checkUtHvigorBuild` → 逐模块 `dispatchUtCompile`（[ut-host-impl.ts](../../profiles/hmos-app/harness/ut-host-impl.ts):446）→ [runHvigorBuild](../../profiles/hmos-app/harness/hvigor-runner.ts):1817（`target:'ohosTest'`, `task:'genOnDeviceTestHap'`）。同一进程随后 :4579 调 `checkUtHvigorTest` → 逐模块 `dispatchUtRun`（ut-host-impl.ts:893）→ [runHvigorTest](../../profiles/hmos-app/harness/hvigor-runner.ts):2218，它在 :2232 **再调一次同参数 `runHvigorBuild`**。两次的模块集合相同（build 用 `[...scopedUtFiles, ...explicitTargetFiles]`、test 用同构造的 `runScope`，check-ut.ts:4521/4575，只是 build 多一层排序），product 同由 `resolveProductSelection({purpose:'ut'})` 单次解析（ut-host-impl.ts:424/826），故二次出包的输入逐字相同。

副作用（本仓可验、与耗时无关）：两次都用 `logBasename: hvigor-ut-build.<module>.log`（hvigor-runner.ts:1877），落盘用 `'w'`，meta 同名派生（:261/:1756）——**`ut_hvigor_build` 的编译日志与 meta 在 test 阶段跑完后已被第二次构建覆盖**，事后无法证明第一次编译发生过。

**"命中 cache 只需毫秒"未经证实。** 该说法只存在于 hvigor-runner.ts:2229 的注释；`HvigorRunResult` 无 cache/UP-TO-DATE 字段，`buildHvigorDiagnostics`（:943）不解析该信号，仓内无相关测试；只读宿主样本 `20260905T103028Z-79d3fd` 只有 spec/plan/coding/review 四个 phase，**没有 ut 目录**，取不到 UT 构建耗时。故 D1 **不承诺节省量**，只做结果传递与日志止损；量在 B06 实测（命令见 §7）。

**② 内外层 harness 重复执行 UT/设备。** [goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts):7789 在 agent invoke 结束后无条件 `await runHarnessPhase(...)`（另起进程），而 agent 在会话内已跑过一次同 phase harness（含真机装机与 `aa test`）。testing 侧已有执行键复用（[execution-key.ts](../../profiles/hmos-app/harness/execution-key.ts):142 `decideReuse`，消费点 [check-testing.ts](../../harness/scripts/check-testing.ts):4321），**UT 侧完全没有**：`checkUtHvigorTest` 每次都走 `probeUtRunDevices` → `dispatchUtRun` → `hdc install -r` + `aa test`。

**③ 辅助统计缺失逼真机重跑。** `decideReuse`:149 把 `timing_complete !== true` 当拒绝复用理由 → 落回真跑；`timing_complete` 由 check-testing.ts:4463 `timingCases >= trace.cases.length` 写入，失败轮 :4408 恒写 false。同族问题在 report-only：check-testing.ts:2622 的 `report_reconcile_only` 把 2543（timing 缺 case duration）、2544（timing 含 trace 不存在的旧 case）、2458/2465/2467/2487/2499/2502/2505/2508/2528（各类耗时与 pipeline 字段缺失）、2560（[reconcileReportWithDeviceTestTiming](../../harness/scripts/utils/testing-trace-gates.ts):311 的报告文字/耗时不符）与真正的执行事实缺口（2383/2390/2394 错包、2423/2428/2432 指错 run、2535/2539 trace 无 cases、2547 feature 不符）**混在同一个 `issues[]`**，:2632 一律 `status: FAIL` + BLOCKER。而这些统计项本身是可重建的派生物：[collectDeviceTestTimings](../../profiles/hmos-app/harness/device-test-timings.ts):159 / `writeDeviceTestTimingJson`:206 由 trace + meta 重算 timing，`writeGeneratedTestReport` 重算报告正文。

**④ attended 被注入无人值守禁问指令。** [buildPhasePrompt](../../harness/scripts/goal-phase-runtime.ts):3394 在 :3430 无条件展开 `buildUnattendedExecutionBlock`（:1534），块内 :1565–1574 声明"本 run 无交互用户""停下来问 = 任务失败""覆盖一切 phase SKILL 的停等指令"。attended 走 [AttendedGoalPhaseExecutor](../../harness/scripts/utils/goal-phase-executor.ts) 的 bridge，本应允许 waiting。生产调用点只有 goal-phase-runtime.ts:6565 一处，且 `executorMode` 在同一 `main()` 作用域内（:4140 声明），B02 已补 `attended ⇒ owner.kind==='session'` 双向约束（:4160），信号可直接复用。

顺带核实到块内一条**已失效的硬话术**：:1578–1579 称账本缺行会让 check-receipt BLOCKER 判 phase closure 失败，而该否决已在 [check-receipt.ts](../../harness/scripts/check-receipt.ts):1076 退役（openspec runner-owned-machine-facts），现存唯一消费者 [check-spec.ts](../../harness/scripts/check-spec.ts):1434 是 MINOR/WARN 且明写"不参与门禁"。

## 2. 非目标

- 不改 completion probe/grace/kill 与其接线（[phase-completion-probe.ts](../../harness/scripts/utils/phase-completion-probe.ts)、[agent-invoke.ts](../../harness/scripts/utils/agent-invoke.ts)），不改 Codex terminal 失败优先仲裁，不改硬预算与 wall 树杀。
- 不新增通用缓存服务/manifest/账本；不做跨 run、跨机器、跨进程的构建缓存；不换 UT 框架；不减原生编译与业务断言。
- 不改设备凭据、安装目标权限、[device-recovery-bridge](../../profiles/hmos-app/harness/device-recovery-bridge.ts) 与就绪门；不改 [visual-provider-invoke](../../harness/scripts/utils/visual-provider-invoke.ts) 与视觉判据。
- 不改 testing 侧 `execution_key` 的**字段构成**、稳定性统计与 `--force-device` 语义（只**扩用**到 UT 并同步 help 文案）。`decideReuse` 的**证据完整性判据**（`timing_complete` 与冻结件分组）按 D3 放宽，属 D3 的明示范围，不在本条之内。
- 不新增 env、不新增 driver、不扩 K-A 真实支持；不改 owner/executor 语义（B02 已定）。
- 不动 [device-test-build-reuse.ts](../../profiles/hmos-app/harness/device-test-build-reuse.ts) 的 mtime 判据（device-testing 侧既有，本批不引用不改）。

## 3. 决策纪要

### D0：保留的真源与状态

保留：`execution_key` 的计算式与 `--force-device` 唯一逃生口（[harness-runner.ts](../../harness/harness-runner.ts):430/675/985）；`decideReuse` 的"只看最新一条带键 attempt、更晚失败不被更早成功覆盖"裁决（execution-key.ts:137–157）；`report_reconcile_only` 的 check id 与 BLOCKER 严重度；`ut_hvigor_build`/`ut_hvigor_test` 两个 check id、短路语义（check-ut.ts:4536）与 `isHvigorBuildSuccessful` 判据；`buildUnattendedExecutionBlock` 的全部正文（只改**注入条件**与一条失效话术）。变化只发生在"同一输入要不要再做一次"和"缺的是事实还是统计"两处。

### D1：ohosTest 出包在同次 harness 调用内唯一化

`checkUtHvigorBuild` / `checkUtHvigorTest` 各加一个**可选尾参** `builds?: Map<string, HvigorRunResult>`（键 = `computeHvigorInvocationFingerprint(projectRoot, {module, target:'ohosTest', task:'genOnDeviceTestHap', product, buildMode:'test'})`，[toolchain-probe.ts](../../profiles/hmos-app/harness/toolchain-probe.ts):288 既有函数）；[check-ut.ts](../../harness/scripts/check-ut.ts) 在 :4517 之前 `const utBuilds = new Map()`，同时传给 :4519 与 :4579。build 侧写入每模块结果，test 侧命中即把它作为 `prebuild` 经 `dispatchUtRun` 传下去；`runHvigorTest` 增可选入参 `prebuild?: HvigorRunResult`，在场时**跳过 :2232 的内建**，直接用它做成功判据（:2239）、`buildOnDeviceSignDiagnosis`（:2287）与 `logPath` 回填（:2260/:2301）。

不用模块级 memo、不用 `CheckContext` 新字段：collector 由调用方**按次创建**，生命周期就是一次 check-ut，天然不会跨调用串味；[check-exit.ts](../../harness/scripts/check-exit.ts):317 直调 `checkUtHvigorTest` 不传 collector → `prebuild` 缺席 → 走今天的内建路径（`runHvigorTest` 的 :2232 内建 `runHvigorBuild`），行为逐字不变，**且该路径不参与 D2 的执行键复用**（无本次成功 prebuild 即无复用资格，判据见 D2「复用资格前置」）。`UtHostImpl`（[profile-host-loader.ts](../../harness/profile-host-loader.ts):57/63）两处签名加同一可选参；`dispatchUtCompile`/`dispatchUtRun`（[capability-registry.ts](../../harness/capability-registry.ts):172/180）是 `Record<string, unknown>` 透传，无需改。

`HARNESS_SKIP_HVIGOR` 的既有不对称保留并写明：build 侧传 `skipEnvVar`（ut-host-impl.ts:453）会 `skippedByEnv`，`runHvigorTest` 侧从不传该 env，故设了它时 collector 里存的是 skip 结果——判据用 `isHvigorBuildSuccessful`（hvigor-runner.ts:136），skip/失败一律**不进** collector，不把跳过洗成构建成功。

但**正式编排下这条不对称永远走不到 test 侧**（codex round1 #8，已逐行核实）：`skippedByEnv ⇒ executed=false ⇒ !isHvigorBuildSuccessful` → 进 ut-host-impl.ts:491 的 `bad` → `ut_hvigor_build` FAIL（:565 出 FAIL，:526 出词「显式跳过真实编译不被允许作为出口」）→ check-ut.ts:4527 的 `buildFailed` 为真 → :4536 直接把 `ut_hvigor_test` 短路成 FAIL，**`checkUtHvigorTest` 根本不被调用**。所以「skip 后 test 侧自建」只存在于**直调 test helper**（check-exit.ts:317 那种、或测试里单独调）的路径。两条路径的验收分开写（见 V3a/V3b），不得混成一例。

**放弃的准确性**：①不再有"test 阶段自己重新确认了一次包还在"的隐式二次校验——包在两次门禁之间被外力删改时，从"第二次构建会重新出包"退化为"`discoverOhosTestArtifacts`（[hdc-runner.ts](../../profiles/hmos-app/harness/hdc-runner.ts):624）找不到 signed hap 就 `failedAt:'hap_not_found'` 报错"。判据仍是真实产物在盘，只是不再顺手重建。②不承诺任何节省量（§1 已述 cache 说法未证实）；本条确定收回的是**一次无条件进程 spawn** 与 `hvigor-ut-build.<module>.log/.meta.json` 的覆盖。

### D2：UT 最小执行键复用（外层 harness 不重复真机执行）

在 [execution-key.ts](../../profiles/hmos-app/harness/execution-key.ts) 现有实现上加一个 **leg 形参**（`'hylyre' | 'ut'`），决定 run 目录段名（`<reportsBase>/<stamp>/<leg>/`）与期望冻结件集合；`listExecutionKeyRuns`/`decideReuse`/`freezeRunArtifacts`/`restoreFrozenRunArtifacts` 默认值 `'hylyre'`，testing 侧调用与行为逐字不变。**不复制 `decideReuse` 的裁决公式**（"最新同键 + 成功 + 证据完整 + trace 在盘 + 冻结件齐"），UT 直接复用。

UT 键字段（全部取自既有产物/函数，不新造采集）：

| 字段 | 来源 |
|---|---|
| `hap_sha256_full` | `computeHapSha256Full(discoverOhosTestArtifacts(...).signedPath)`（[build-fingerprint.ts](../../profiles/hmos-app/harness/build-fingerprint.ts):35 + hdc-runner.ts:624） |
| `derived_plan_sha256` | 复用字段位存**选中用例集**摘要：`targetCases` 的 `<module>::<path>::<test>` 排序后 sha256（ut-host-impl.ts:768 既有入参） |
| `device` / `display_env` | `resolveExecutionDeviceIdentity()`——现为 [check-testing.ts](../../harness/scripts/check-testing.ts):3804 的模块私有函数，本批**下移**到 hdc-runner.ts（它已拥有 `runHdcRaw`/`resolveHdcExecutableSync`/`probeDevices`），check-testing 改 import，两侧共用一份，不复制 |
| `tool_config_sha256` | `computeHvigorInvocationFingerprint`（同 D1 的键） |
| `profile` / `flags` | `ctx.resolvedProfile.name`；flags 收 `HARNESS_SKIP_HVIGOR*` 等显式跳过 env 的在场值 |
| `reset_mode` / `hylyre_version` / `manifest_version` | UT leg 恒 `'n/a'` / `null`（字段沿用，不为一条 leg 拆结构） |

**测试源码指纹不单算**：ohosTest HAP 由测试源码编译产出，其内容摘要已覆盖。**放弃的准确性**：HAP 是 zip，源码未变而 hvigor 重打包产生不同字节时键会变 → 复用不命中、真跑一次。方向是安全的（只损命中率、不损正确性），代价是"内外层各出一次包"时命中率取决于 hvigor 是否真的没重打包——与 §1 那条未证实的 cache 说法同一未知项，B06 一并实测。

**复用资格前置：只有"本次调用内真的出过包"才有资格谈复用**（codex round1 #1）。`hap_sha256_full` 取自**磁盘上的 signed HAP**，只按磁盘判会出一个真缺口：测试源码已改、但本次没有重新编译时旧 HAP 仍在盘、摘要不变 → 键命中旧记录 → **编译和执行一起被跳过**。因此在 `decideReuse` 之前先过一道 collector 门，两条同时满足才查复用：

1. 本次 harness 调用内该模块在 D1 的 `builds` collector 里有条目且 `isHvigorBuildSuccessful` 为真（skip/失败/缺席都不算）；
2. 该条目对应的 `discoverOhosTestArtifacts(...).signedPath` 的 `computeHapSha256Full` 等于本轮键里聚合进去的该模块摘要。

任一不满足 → **不查复用**，走今天的内建构建 + 真跑（`decideReuse` 的 `reason` 出词"本次调用无成功 prebuild，不做同键复用"）。无 collector 的路径（check-exit.ts:317）因此天然不参与复用，行为逐字不变。

**整轮键 + 逐模块冻结件**（codex round1 #2）。`ut-host-impl.ts:892` 的 `for (const mod of mods)` 是逐模块 dispatch，但一轮门禁只出一个 `ut_hvigor_test` 结论，键必须是**整轮**的：`hap_sha256_full` / `derived_plan_sha256` / `tool_config_sha256` 三项各按**模块名排序后逐模块摘要拼接再 sha256**（`<module>=<sha>` 逐行、`\n` 连接），任一模块的 HAP、用例集或 invocation fingerprint 变 → 整轮键变 → **整轮真跑**（不做"命中的模块复用、没命中的真跑"的半复用，那会让 suite 棘轮的 `allModulesExecuted`/`modulesWithValidResults` 判据拿到跨轮拼装的结果）。设备身份、`profile`、`flags` 全轮共用一份。冻结件反过来必须**逐模块**：`frozen.ut-result.<module>.json` / `frozen.hdc-test.<module>.log`，回填时按模块还原。

**本批被迫的最小改动：hdc 日志按模块命名（附影响面）。** [hdc-runner.ts](../../profiles/hmos-app/harness/hdc-runner.ts):1448 的 `finalize` 恒写同一个 `hdc-test.log`，两个 ohosTest 模块时第二个覆盖第一个——逐模块冻结日志的前提是它先按模块落盘。改法：`finalize` 用 `opts.srcModuleName` 拼 `hdc-test.<module>.log`。影响面已核实：全仓只有两处提到该文件名——:1448 的写点，与 :1192 的一句诊断话术（同步改为引用实际 `logPath`）；`logPath` 只经 `runOnDeviceUt` 返回值回传给 `runHvigorTest`（hvigor-runner.ts:2301）再进 `HvigorRunResult.logPath`，没有第二处按字面名读取。这条与 D1 的"日志不再被覆盖"是同一类止损（一个防跨阶段覆盖、一个防跨模块覆盖）。

复用判据与拒绝口径（全部沿用 `decideReuse`，不新写谓词）：**本次调用无成功 prebuild**（上文前置）、输入变（HAP/用例集/设备/toolchain 任一变）、**最新同键 attempt 失败**、执行事实类冻结件不齐（分组见 D3）、`--force-device`（`ctx.forceDevice`，harness-runner.ts:675 既有；help 文案 :430 从"testing 专属"改为"testing/ut"）、设备身份未知 → 一律真跑。**旧成功不能盖新失败**由 `decideReuse` 只看**最新**一条带键 attempt 保证（execution-key.ts:143–148）：同键成功之后又有同键失败，最新是失败 → 拒绝复用。

**失败与异常路径必须真的写出那"最新一条"**（codex round1 #5）。`decideReuse`:143 只扫描**已落键的记录**，所以"旧成功不盖新失败"能不能成立，取决于失败轮有没有把记录落下去——这是生产路径的义务，不是验收现场手工摆出来的前提。UT 侧照 testing 侧既有形态办：真跑分支拿到逐模块结果后**无论成败**都写一条 `execution-key.json`（testing 对照：check-testing.ts:4402 的 `!run.ok` 分支写失败记录、:4456 写成功记录，均包 `try{}catch{}` 且"记录失败不改变门禁"）。三条口径：

- 部分模块失败（`perModule` 里有链路失败或用例失败）→ 整轮 `outcome` 记失败，不因"有的模块跑通了"落成 success。
- **"无记录则下次真跑"不成立，改为记录前置**（codex round2，已逐行核实）：`listExecutionKeyRuns`（execution-key.ts:121）对没有 `execution-key.json` 的 run 目录直接 `continue`，`decideReuse`:143 取的是"最新一条**带键记录**"——所以一轮跑挂了却没落记录，最新仍是**上一轮的成功**，正好是本节要禁的洗绿。改法：**在 dispatch 之前**就用同一 `writeExecutionKeyRecord` 形态先落一条**非成功** attempt（`outcome:'started'`、`timing_complete:false`、`frozen_files:[]`），执行结束后**用整轮真实结果覆盖同一文件**（成功轮改 `outcome:'success'` 并补冻结件，失败轮改 `outcome` 为失败词）。这样任何提前退出（异常、进程被杀、磁盘故障后半段）留下的最新记录都是非成功的，`decideReuse`:148 直接拒绝复用。
- **前置记录写不出 → 不进入复用判定**：前置写入包 `try{}catch{}`，捕获即视为"本轮不具复用资格"，**不调 `decideReuse`**、直接真跑，并在 check `details` 披露一行（出词"执行键前置记录写入失败，本轮不做同键复用"）。绝不允许"写不出前置记录 → 回头去查旧记录"。
- `checkUtHvigorTest` 抛出、被 check-ut.ts:4097 的 `safeRun` 兜住的路径由前置记录兜住：抛出轮的记录已落且 `outcome≠success`，下一轮 `decideReuse` 看到的最新就是它 → 真跑。绝不允许"抛异常的那轮不留痕、上一轮的成功记录仍是最新"。

UT 的"证据完整"（写进 `timing_complete` 字段位）= **全部选中模块**的 `HypiumTestResult` 与 hdc 日志（hdc-runner.ts:1448 落盘，改名后为 `hdc-test.<module>.log`）已逐模块冻结为 `frozen.ut-result.<module>.json` / `frozen.hdc-test.<module>.log`，且冻结的模块集合等于本轮 `mods`；复用时 `restoreFrozenRunArtifacts` 逐模块回填，`checkUtHvigorTest` 用回填结果重算 check，**不调 `dispatchUtRun`、不发一条装机/执行 hdc**（设备身份查询除外，见 §6）。

**放弃的准确性**：①字段名 `timing_complete` 在 UT leg 语义是"派生证据完整"，与 hylyre leg 的"timing 覆盖全部 case"不是同一张表——沿用旧名以免动 testing 侧 schema 与消费者，含义差异写进注释与 MIGRATION。②设备侧真实状态（应用残留、系统弹窗）在两次 harness 之间可能变化而键不变，复用会沿用上一次结论；出路是既有 `--force-device` 与 N 轮稳定性口径，与 testing 侧同款代价。

### D3：报告对账区分执行事实与派生统计；timing 不再逼真机重跑

`report_reconcile_only`（check-testing.ts:2622）把单一 `issues[]` 拆成两桶，**check id、严重度、report-only 的"零设备调用"承诺全部不变**：

- **执行事实缺口（hard，仍 BLOCKER FAIL）**：HAP stat/mtime/size 不符（:2383/2390/2394）、build→install→run 时间链不闭合与顺序错（:2401/2405/2408/2417）、meta 指向别的 trace/report/log（:2423/2428/2432）、trace 缺 `cases[]` 或 id 非法重复（:2535/2539）、`trace.feature` 不符（:2547）、**源 meta** 的 `reused` 布尔缺失（:2473）、**源 meta** 的 `hapBuiltAt` 缺失或非法（:2517）。判据一句话：**这一条动摇的是"哪个包、哪台设备、哪次 run、哪些 case 真跑过"**。
- **派生统计缺口（soft）**：timing 文件缺失/非法（:2458）、pipeline 字段缺失或非数（:2465/2467）、各段耗时缺失或来源不一致（:2487/2499/2502/2505/2508）、case duration/step_count 行无效（:2528）、timing 缺 case duration 或含旧 case（:2543/2544）、报告正文与 timing 不符（:2560）。处置顺序：**先重建**（`collectDeviceTestTimings` + `writeDeviceTestTimingJson` 由 trace+meta 重算 timing；报告正文由既有 `writeGeneratedTestReport` 重算）→ 重建后复算，仍不闭合 → `status:'WARN'`（severity 保持 BLOCKER，即既有"BLOCKER 级 WARN"形态，会进 summary）+ `failure_kind:'derived_statistic_unavailable'`，`details` 显式写"该统计项为 UNKNOWN，不构成执行事实结论"。**不新增 CheckStatus 成员**（[types.ts](../../harness/scripts/utils/types.ts):98 仍是 PASS/FAIL/WARN/SKIP）、不新增 check id、不触发装机或真跑。

**四条"投影陈旧"必须归 soft，不得留在 hard**（codex round1 #7，已逐行核实）：`timing.generated_at` 早于 `run_ended_at`（:2412）、`timing.pipeline.build_reused` / `install_reused` 与源 meta 不一致（:2476/:2479）、`timing.pipeline.hap_built_at` 与 `build.hapBuiltAt` 不一致（:2519）——这四条的**源 meta 都在且合法**（:2473 与 :2517 的守卫先过），不一致的只是 `device-test-timing.json` 这份投影，重算 timing 即闭合。与它们成对的 :2473（`build/install meta 缺少 boolean reused`）、:2517（`hapBuiltAt 缺失或非法`）判的才是源 meta 本身，留在 hard。分错的代价是具体的：一份陈旧 timing 会把一次真实、完整、可复用的 run 判成执行事实缺口，逼一次真机重跑——正是本 D 要消除的那类浪费。

**原始协议缺口不是派生统计缺口**（codex round1 #3，已逐行核实）。分桶的分界不在"字段名里有没有 duration"，而在**这个值是不是执行事实本身**：

| 层 | 判据 | 归桶 |
|---|---|---|
| 原始 v1 结果缺 schema 必填（含 `stepResultV1.duration_ms`） | [output-schema.json](../../profiles/hmos-app/vendor/hylyre/src/hylyre/contracts/output-schema.json) 的 `$defs.stepResultV1.required` 含 `duration_ms`；[requireV1ForGate](../../harness/scripts/utils/hylyre-result-protocol.ts):302 按冻结 schema 判 `schemaViolations` 即拒 | **hard**（现状即如此，不改） |
| 由 trace/meta 推导出的统计（timing 文件、报告耗时格） | 值可由原始事实重算 | soft |

这条改的是 D3 的**表述**而非门禁：report-only 的 `issues[]` 在 :2287–2296 已经把 `checkHylyreCaseExecutionCompleteness`（check-testing.ts:5019，:5037 调 `requireV1ForGate`）的 FAIL 明细并进来，所以缺 `duration_ms` 的 v1 trace 早在分桶之前就被判 `failure_kind:'unsupported_result_protocol'`。**推论：`trace` 一旦过了 `requireV1ForGate`，case 级耗时必然可由 `steps[].duration_ms` 重建**（[device-test-timings.ts](../../profiles/hmos-app/harness/device-test-timings.ts):56–68 的 v1 分支就是这个重建），case 级 UNKNOWN 在 v1 上**不可达**。

**UNKNOWN 真正可达的现场只有两处**，D3 的 WARN 通道只对它们生效，验收也只能在这两处构造：

1. **pipeline 段耗时的源 meta 缺 `durationMs`**（check-testing.ts:2499/:2502/:2505/:2508 四条）——build/install/hylyre_run/page_save 的耗时来自 `device-test-build.result.json` / `device-test-install.meta.json` / `device-test-run.meta.json`，**不在 trace 里**，`requireV1ForGate` 管不到，重建也无从推导。
2. **legacy `0.3-p0` 的日志 cost 分配分支**（device-test-timings.ts:70 起，v1 分支 `return` 之后的那段）——按 `COST_RE` 从日志里分配耗时，日志里没有对应行的 case 就没有耗时。

**表示法：null 进数据、`—` 进报告、UNKNOWN 只进文字。** [parseDurationCell](../../harness/scripts/utils/testing-trace-gates.ts):183 的合法空值只有 `— - n/a na 不适用`（:186 的正则），写 `UNKNOWN` 字面量会被判 `valid:false` → 立刻制造一条 :2560 的 mismatch，等于用新缺口替换旧缺口。所以：

- device-test-timings 的 **v1 分支（:52–69）一行不改**：`requireV1ForGate` 已保证每个 step 带 `duration_ms`，`steps=[]` 的 skip case 求和得 0 是**正确的 0**，不是缺口（:42–45 的既有注释明写 StepSkipped 必须保留 0/0）；
- 只有 **legacy `0.3-p0` 的 cost 分配分支（:70 起）**把"日志里没有对应 cost 行"的 case 由 0 改 `null`，`DeviceTestTimingCase.duration_ms` 类型随之放宽为 `number | null`（`pipeline.<seg>_ms` 本来就允许 null，见 check-testing.ts:2466）；
- [test-report-writer.ts](../../profiles/hmos-app/harness/test-report-writer.ts):327 的 `t ? ms(t.duration_ms) : '0ms'` —— **timing 整行缺席**时改写 `'—'`（与同函数 :315/:329/:333 三处既有 `'—'` 同款），**不再把"没量到"写成"0ms"**；timing 行在场且值为 0 仍照写 `0ms`（既有 `testing-trace-gates` 的 skip 用例 :286/:317 走的正是这条，不受影响）；
- **对账消费者必须同步放宽**（codex round2）：[reconcileReportWithDeviceTestTiming](../../harness/scripts/utils/testing-trace-gates.ts):391 的 case 行判据是 `!parsed.valid || parsed.ms === null || Math.abs(parsed.ms - timingCase.duration_ms) > 1`——①`parsed.ms === null` 无条件拒绝，正是上一条刚写进报告的 `—`，会立刻制造一条 :2560 伪 mismatch；②`duration_ms` 放宽为 `number | null` 后 `parsed.ms - timingCase.duration_ms` 过不了 strict typecheck。改法：**复用同文件 `compareReportDuration`（:266–290）既有的空值分支形状**——`timingCase.duration_ms === null` 时要求报告格是空值占位（`parsed.ms === null`，否则报"应为无数据占位"），非 null 时才做 ±1ms 减法；不新写谓词、不改 `parseDurationCell`。等价断言两组：`null ↔ —` 判通过、`0 ↔ 0ms` 判通过（后者是既有 skip case 语义，不得被本次放宽波及）；
- `UNKNOWN` 措辞只出现在 `report_reconcile_only` 的 `details` 与报告的**备注列**，不进任何被 `parseDurationCell` 读的格子。

**性能类 AC 的识别路径**（本 D 自定，最小可行，不新增 schema）。已核实两件事：`AcceptanceSpec.performance[]`（[types.ts](../../harness/scripts/utils/types.ts):420，id 约定 `NFR-N`，见 [spec-workflow-detail.md](../../skills/reference/spec-workflow-detail.md):94）在生产代码**零消费者**（全仓 `.performance` 只有 types.ts:420 的声明与 check-plan.ts:907 的同名常量分类，无关）；`extractAcceptanceIdRefs`（[check-acceptance.ts](../../harness/scripts/utils/check-acceptance.ts):32–40）的 `ACCEPTANCE_ID_PATTERN`（:26 `^(AC|BD)-(G\d+|\d+)$`）**永不产生 `NFR-*`**。故：

| 环节 | 做法 |
|---|---|
| 性能 AC 从哪来 | `ctx.featureSpec.acceptance?.performance` —— `AcceptanceSpec` 由 [spec-loader.ts](../../harness/scripts/utils/spec-loader.ts):234 已经加载进 `FeatureSpec.acceptance`（types.ts:496），check-testing 经 `ctx.featureSpec` 直接取，**不新增 loader、不新增 schema 字段** |
| 怎么关联到 TC | 在 [execution-channel-evidence.ts](../../harness/scripts/utils/execution-channel-evidence.ts) 加一个与 :101 `extractTcAcceptanceRefs` **同表同列**（`测试用例` 段首表的 `关联 AC` 列）的兄弟导出 `extractTcNfrRefs(planMd)`，词法从 `AC\|BD` 换成 `NFR`。**不改 `extractAcceptanceIdRefs`**（改它会破坏 `ACCEPTANCE_ID_PATTERN` 与另外四个消费者的契约） |
| 判定 | `performance[].id` 与该 TC 的 NFR 引用交集非空 → 性能类 TC；其 timing 缺口一律留 hard 桶 |
| 两侧皆空时 | 性能类集合为空 → 全部 timing 缺口按 soft 处理，不误伤 |

**放弃的准确性（识别路径）**：性能 AC 若没在 test-plan 的 `关联 AC` 列写出 `NFR-N`，就识别不到，其 timing 缺口会走 soft 桶。这是 spec 侧书写约定的缺口，本批**不补 schema、不加校验、不改 spec 模板**——加校验等于在本批引入一条新门禁，与"效率优先/减法"相冲。

**性能类 AC 仍须真实量测**：命中上表的 TC，其耗时**不得**由重建路径提供——重建只能覆盖"报告与 timing 一致"这类派生一致性；性能 case 的 duration 必须来自本次或被复用的**真实执行** trace。实现落在 soft 桶入口的一条前置判据。

同一分层用到 `decideReuse`:149：`timing_complete === false` 不再直接拒绝复用，改为返回该 run 并标 `evidenceRebuildRequired`；check-testing 在 `restoreFrozenRunArtifacts`（:4347）之后尝试重建，重建后仍覆盖不全 → **回落真跑**（fail-closed，不带半份统计签发）。

**冻结件也必须分两组**（codex round1 #6，已逐行核实）。execution-key.ts:151–155 现在要求 `FROZEN_RUN_ARTIFACTS`（:52–55）**全部**在盘才允许复用，而这个数组里 `frozen.device-test-timing.json` 是派生物、`frozen.device-test-run.meta.json` 是执行事实——只丢一份 timing 副本就落回真机重跑，与上文"统计缺口不逼真跑"自相矛盾。改法：`FROZEN_RUN_ARTIFACTS` 的每项加一个 `group: 'execution' | 'derived'` 标注（不加新文件、不改冻结/回填流程），`decideReuse` 的 :153 判据拆成两句：

- **执行事实组**（trace、run meta；UT leg 为 `frozen.ut-result.<module>.json` / `frozen.hdc-test.<module>.log`）缺任一 → 拒绝复用、真跑，`reason` 出词"执行事实冻结件缺失"；
- **派生组**（timing 等）缺任一 → 仍返回该 run，与 `timing_complete === false` 走同一条 `evidenceRebuildRequired` 通道：回填后重建，重建不成 → 回落真跑（fail-closed）。

**放弃的准确性**：①重建过的 timing 与"当场采集的 timing"不再逐字同源——重建结果由 trace+meta 推导，若两者本身已被外力改动，重建会把错误算得更整齐；兜底是 hard 桶仍校验 trace/meta 的路径与身份一致性。②WARN 态下操作者在 check details 里看到的是 UNKNOWN、在报告耗时格里看到的是 `—`（不是数字，也不再是假的 `0ms`）；换来的是不再为一行缺失的耗时重装一次机。③`test-report-writer.ts:327` 的 `'0ms'` 只在 **timing 行整行缺席**时改写为 `'—'`，`parseDurationCell` 两者都收；既有带 `0ms` 断言的用例（testing-trace-gates.unit.test.ts:286/:309–317 等）走的是"timing 行在场、值为 0"的另一条分支，不在改动面内——仍须由 `test-report-writer` 与 `testing-trace-gates` 两套件确认。

### D4：无人值守禁问块只注入 detached

`buildPhasePrompt` 增可选尾参 `attended?: boolean`（与 a7c3e9d2 加 `extensionInputs` 同一写法，既有 15 个位置参数不动、既有测试调用逐字不变），生产调用点 goal-phase-runtime.ts:6565 传 `executorMode === 'attended'`。**不新增 env、不新增 driver、不读 run-control**——`executorMode` 与 `runtimeOwnerKind` 已在同作用域，且 B02 已把 `attended ⇔ session owner` 做成双向约束（:4152/:4160），信号唯一且已被拒绝启动分支守住。

`buildUnattendedExecutionBlock` 拆成两段，**正文一字不改，只改归属**：

| 段 | 内容 | attended |
|---|---|---|
| 模式段 | :1565–1601 的 headless 声明、`approval_mode`、"MUST NOT stop to ask"、覆盖 phase SKILL 停等、逐门自动决议与 `headless-assumptions` 账本 | **不注入** |
| 红线段 | :1603–1610 的 gate-integrity 红线（禁 `confirmed_by`、禁进程注入/改回执、禁改控制面）与 `deterministicDetectorLines`（:1551–1563，含 fidelity 分支） | **照常注入** |

attended 另加一行诚实说明（不新增块）：本次为 attended（session owner），phase SKILL 的停等确认按原义执行、经 bridge 回传；不写"可以随意提问"之类扩权话术。

顺带纠正 §1 提到的失效话术：模式段 :1578–1579 的"check-receipt BLOCKER-validates … a gate without a ledger line fails the phase closure"与现实相反（check-receipt.ts:1076 已退役该否决，现存 `headless_assumptions_review` 是 MINOR/WARN 且自陈不参与门禁）。改为"账本是审计留痕，不构成授权，也不单独否决 closure"。这条只影响 detached 的注入正文，属本批必改项（继续喂假 BLOCKER 会诱发无谓的补账本轮次）。

**放弃的准确性**：attended 轮不再拿到"逐门自动决议 + 写账本"的指令，attended 的 `headless-assumptions.jsonl` 会更稀疏——该账本本就只是留痕、无门禁消费者（check-receipt.ts:1076 / check-spec.ts:1434），可接受。换来的是 attended 不再被同一份提示词同时要求"停下来问"和"停下来问=任务失败"。

### D5：规格与文档同步

创建最小 OpenSpec change `execution-reuse-and-report-layering`，只改行为涉及的条款：

| spec | 修改 |
|---|---|
| [harness-gates](../../openspec/specs/harness-gates/spec.md):2112 | 执行键条款 MODIFIED：键的适用面由 testing 扩到 **UT 装机执行**（UT 键字段按 D2 表列举），"complete trace/timing evidence" 明确为**派生证据完整**且分 leg 定义；`--force-device` 仍是唯一显式逃生口 |
| harness-gates（report-only 段，:1417/:1511 所属 requirement） | ADDED 一条：report-only 对账 SHALL 区分执行事实缺口（BLOCKER FAIL）与派生统计缺口（先重建、不可重建则 WARN + UNKNOWN 标注），且**任一分支都不得触发设备/hvigor/hdc/Hylyre 调用**；性能类 AC 的耗时 SHALL NOT 由重建提供 |
| harness-gates（UT 段） | ADDED 一条：一次 UT 门禁对同一 (module, product, task) SHALL 只出一次 ohosTest 包，编译日志与 meta SHALL NOT 被同次门禁的后续阶段覆盖 |
| [goal-runner](../../openspec/specs/goal-runner/spec.md):671 所属 requirement | MODIFIED：无人值守提示块 SHALL 只注入 detached 执行形态；attended SHALL 保留完整性红线与确定性检测段，且 SHALL NOT 被要求"停下来问 = 任务失败"；账本条款同步为"留痕、不否决 closure" |

文档最小改动：[MIGRATION.md](../../MIGRATION.md) 增一节说明——UT 执行键复用的新目录 `<reports>/<feature>/ut/<stamp>/ut/`、`timing_complete` 在 UT leg 的含义、`--force-device` 覆盖面扩到 UT、report-only 的 WARN/UNKNOWN 新形态（消费者无需动手，旧记录无键即不参与复用）。[harness-runner.ts](../../harness/harness-runner.ts):430 的 `--force-device` help 文案同步。不改 skills 提示词（本批没有改变 agent 该做什么）。

## 4. 文件与提交边界

S0 至 S4 是可审查提交/变更组，不要求自动 git commit。

| 组 | 文件/函数 | 内容与验证 |
|---|---|---|
| S0 UT 出包唯一化 | hvigor-runner `runHvigorTest`（+`prebuild`）；ut-host-impl `checkUtHvigorBuild`/`checkUtHvigorTest`（+`builds`）；check-ut.ts 4517–4579 建 collector 并双传；profile-host-loader `UtHostImpl` 两处签名 | D1；ut.compile dispatch 每模块恰一次、`prebuild` 真的让内建被跳过、无 collector 时行为逐字不变 |
| S1 UT 执行键 | execution-key.ts 加 leg 形参、`FROZEN_RUN_ARTIFACTS` 的 `group` 标注与 UT 冻结件集合；ut-host-impl 写记录（含失败/部分失败轮）/判复用资格前置/整轮键聚合/逐模块回填；hdc-runner `finalize`:1448 改按模块命名 `hdc-test.<module>.log`（并同步 :1192 诊断话术）+ 接收下移的 `resolveExecutionDeviceIdentity`；check-testing 改 import；harness-runner :430 help | D2；命中不发装机/执行 hdc、四类不命中真跑、旧成功不盖新失败、失败记录由生产路径写出 |
| S2 报告对账分层 | check-testing.ts 2380–2560 拆 hard/soft 两桶（含 #7 的四条投影归 soft）+ 重建流程、2622–2639 出词、性能类 TC 前置判据；execution-channel-evidence 加 `extractTcNfrRefs`；device-test-timings legacy 分支缺 cost 改 `null`；test-report-writer :327 缺 timing 行改 `'—'`；testing-trace-gates `reconcileReportWithDeviceTestTiming` :391 的 case 行判据按 `compareReportDuration` 的空值分支放宽（`null ↔ —` 通过、`0 ↔ 0ms` 仍通过）；execution-key `decideReuse` 的 `timing_complete` 与派生组冻结件改为可重建标记；check-testing 4331–4347 复用后重建与 fail-closed 回落 | D3；统计缺口零设备调用、性能 AC 仍留 hard 桶、原始 v1 缺 schema 必填仍由 `requireV1ForGate` 判 hard；对账等价断言 `null ↔ —` 与 `0 ↔ 0ms` 各一组 |
| S3 attended 模式提示 | goal-phase-runtime `buildUnattendedExecutionBlock` 拆两段 + 失效话术改写；`buildPhasePrompt` 加尾参；:6565 传 `executorMode==='attended'` | D4；attended 无模式段有红线段、detached 逐字不变（新话术一句除外） |
| S4 规格与验收 | OpenSpec change `execution-reuse-and-report-layering` 两份 delta（harness-gates 三条 / goal-runner 一条）、MIGRATION、既有测试扩展 | D5 与 §7 命令；不夹带 B04–B06 生产改动 |

扩展现有套件，不新增测试框架、不新建 suite（归位已核实各套件既有 import 面）：`execution-key`（leg 与 UT 判据）、`profile:hmos-app:ut-hvigor-test-failure` 与 `profile:hmos-app:hvigor-build-verdict`（D1 的 `prebuild` 行为）、`ut-module-selection`（collector 键与模块集合一致性）、`testing-trace-gates`（`report_reconcile_only` 的既有断言在此，D3 两桶就地扩）与 `efficiency-first-t2`（plan 07a41ec6 的执行键/效率优先套件，D2 复用判据与 D3 重建流程归此）、`profile:hmos-app:device-test-timings`（重建产物与 legacy 分支的 `null`）、`profile:hmos-app:hdc-runner`（`hdc-test.<module>.log` 按模块命名）、`test-report-writer`（缺 timing 行改 `'—'`）、`goal-headless-guard`（:980 的块在场断言改为按模式分支）、`goal-runner-testing-integrity`（attended bridge 端到端 prompt 断言）。

## 5. 接受的准确性边界

| 取舍 | 接受的边界 | 仍须保证 |
|---|---|---|
| 同次调用内传构建结果（D1） | test 阶段不再顺手重建包；不承诺任何节省量 | 产物仍须真实在盘（`hap_not_found` 照旧 FAIL）；skip/失败结果不进 collector；无 collector 时行为逐字不变 |
| UT 键用 HAP 摘要代替源码指纹（D2） | hvigor 无谓重打包 → 键变 → 复用不命中 | 只损命中率不损正确性；命中率由 B06 实测登记 |
| `timing_complete` 在 UT leg 复用字段位（D2） | 一个字段名承载两种 leg 的"派生证据完整" | 语义差异写进注释与 MIGRATION；testing 侧 schema 与消费者零改动 |
| UT 同键复用（D2） | 设备真实状态在两次 harness 之间变化时沿用旧结论 | `--force-device` 与 N 轮稳定性口径不变；最新同键失败一律真跑 |
| 统计可重建（D3） | 重建把可能已被改动的 trace/meta 算得更整齐 | hard 桶仍校验包/设备/run 身份与 trace 完整性；重建不成即 UNKNOWN + WARN，不冒充数字 |
| 统计缺口不再触发真跑（D3） | 报告耗时段可能空缺 | 性能类 AC 的耗时留在 hard 桶，必须真实量测 |
| 派生统计以 `null`/`—` 表示（D3） | 报告里"未量到"与"真的 0ms"在视觉上不再同形；`DeviceTestTimingCase.duration_ms` 放宽为 `number \| null` | `UNKNOWN` 字面量绝不写进被 `parseDurationCell` 读的格子；v1 分支的 0/0 skip case 语义一字不改；原始 v1 缺 schema 必填仍由 `requireV1ForGate` 判 hard |
| UT 复用只有整轮键、不做半复用（D2） | 任一模块的 HAP/用例集/invocation fingerprint 变 → 整轮真跑，命中率低于逐模块复用 | 不产生跨轮拼装结果，suite 棘轮的 `allModulesExecuted`/`modulesWithValidResults` 判据始终看同一轮；冻结件仍逐模块命名以便回填 |
| attended 不注入模式段（D4） | attended 的自动决议账本更稀疏 | 账本无门禁消费者；完整性红线与确定性检测段照常注入 |
| 保留 completion probe / terminal 仲裁 / 硬预算 | 阶段尾部叙述仍可能被截断 | 与 B02 同一结论：截断不改变磁盘证据与终态 |

## 6. 验收用例

**生产接线要求：计数必须发生在进程调用边界，不是 provider 边界**（codex round1 #4，已逐行核实）。provider 计数答不了本批要问的问题，三条硬伤都在代码里：

1. **第二次构建根本不经过 provider。** `runHvigorTest`（hvigor-runner.ts:2218）在 :2232 **直接调** `runHvigorBuild`，不走 `dispatchUtCompile`——所以"两个模块的 `ut.compile` provider 只被调 2 次"在**改动前就已经成立**，V1 原来的写法是一条永远绿的断言，证不了 D1。
2. **provider 可以是桩。** 计数 provider 一旦替换真实实现，"跑没跑"这件事本身就不再被观察；`prebuild` 有没有让内建被跳过、复用有没有真的省掉一次装机，都退化为对桩的自证。
3. **UT/testing 侧本来就有一条不经 provider 的 hdc 调用**：`resolveExecutionDeviceIdentity`（check-testing.ts:3804）直调 `runHdcRaw` 发 `hdc list targets` 与 `wm size`（:3814/:3824），provider 计数看不见它。

做法（**复用既有机制，无新框架、无新生产 seam**）：照搬 [testing-trace-gates.unit.test.ts](../../harness/tests/unit/testing-trace-gates.unit.test.ts):721–747 的 `--require` preload——写一个 `.cjs` loader，在 `Module._load` 里 patch `child_process.spawnSync`，命中 `/hvigor|hdc|hylyre|python/i` 的命令即计数（该文件的 report-only 版是**直接 throw**，本批改为**记一条再放行/或按用例需要 throw**）。子进程经 `NODE_OPTIONS=--require=<loader>` 注入。要点：

- **保留真实 provider 与真实 runner**——`dispatchUtCompile` / `dispatchUtRun` / `dispatchDeviceTestRun`（capability-registry.ts:172/180/473）走生产实现，被计的是它们最终真的 spawn 了几次工具；
- **设备身份查询单独计数并允许**：`hdc list targets` / `wm size`（check-testing.ts:3814/:3824，下移到 hdc-runner 后同）不算"执行调用"，V4/V7 的"零调用"指的是装机与 `aa test`/Hylyre 执行，身份查询计入独立计数桶且允许非零；
- **V1 / V4 / V7 的次数断言全部下移到这一层**：V1 数 `genOnDeviceTestHap` 的 spawn 次数（改前 2 模块 = 4 次，改后 = 2 次），V4 数复用轮的装机/执行 spawn = 0，V7 数五例全程 hvigor/hdc/Hylyre spawn = 0；
- 不新增任何 `__testing_` 生产钩子。

provider 层仍保留一处用途：**dispatch 次数**本身是问题时（如 V3a 的"`ut.run` 零调用"——它问的是编排有没有短路，不是工具跑没跑），用 `ctx.resolvedProfile` 构造。**该项已核实可行**（原"待核实"结项）：`HarnessResolvedProfile`（[types.ts](../../harness/scripts/utils/types.ts):874）必填字段只有 `name`/`profileDir`/`yaml`/`phasesDisabled`/`capabilities`/`personalPrerequisites`（`subVariant`/`extensionBundle` 可选），做法是**调 `loadResolvedProfile` 拿真实结果后浅拷贝、只替换 `profileDir`** 指向临时目录（`profileDir` 由 profile 名推导、不可外部指定，见 [profile-loader.ts](../../harness/profile-loader.ts):195/207，故只能替换不能传入），临时目录的 `harness/providers/<module>` 下放计数 provider —— [capability-registry.ts](../../harness/capability-registry.ts):113 正是按 `resolved.profileDir/harness/providers/<module>` require，:116–131 只校验 metadata 的 `id`/`capability`，unit runner 走 ts-node transpile-only 可直接加载 `.ts` provider。**注意（已核实的连带影响）**：`profileDir` 不只决定 provider——[profile-host-loader.ts](../../harness/profile-host-loader.ts):94–98 的 `tryLoadProfileHarnessModule` 按 `profileDir/harness/<baseName>` require，`tryLoadUtHostImpl`（:124–125）走的正是这条，而 check-ut.ts:4305 / check-exit.ts:281 都用 `ctx.resolvedProfile.profileDir` 取 host。所以换了 `profileDir` 就同时换掉了 `ut-host-impl`，完整编排会断。做法是在临时 `profileDir/harness/` 下放一个**一行转导**的 `ut-host-impl.js`（`module.exports = require('<真实 profileDir>/harness/ut-host-impl')`），只让 `harness/providers/<module>` 被影子目录覆盖；不这么做就只能用进程边界计数，不能用 provider 计数。

源码正则守卫（[hdc-spawn-guard.unit.test.ts](../../profiles/hmos-app/harness/tests/unit/hdc-spawn-guard.unit.test.ts):16 那种）是护栏，任何情况下都不作为本批的调用次数证据。

| ID | 输入 | 必须观察到 |
|---|---|---|
| V1 | 两个 ohosTest 模块，build 全成功后跑 test（走 check-ut 真实编排，collector 在场，preload 计数在场） | **进程边界**：`genOnDeviceTestHap` 的 hvigor spawn 恰 **2** 次（同一夹具在改动前是 4 次，两次都要跑、以对照数字为证）；`ut.run` 每次收到非空 `prebuild` 且 module/product 与本模块一致；`hvigor-ut-build.<module>.meta.json` 在 test 阶段后**仍是 build 阶段那一份**（内容哈希不变） |
| V2 | 临时工程**无 hvigor 工具链**，直接调真实 `runHvigorTest`：①不传 `prebuild`；②传成功 `prebuild` | ①返回 `toolMissing:true`（内建走到 `resolveUtHvigorSpawnPlan`）；②**不返回 `toolMissing`**，推进到装机段并以 `failedAt:'hap_not_found'`/设备缺失收场——证明内建真的被跳过，不靠正则 |
| V3a | **正式编排**：`HARNESS_SKIP_HVIGOR=1` 后跑整套 check-ut | `ut_hvigor_build` FAIL（`skippedByEnv ⇒ !isHvigorBuildSuccessful`，ut-host-impl.ts:491）→ check-ut.ts:4536 短路，`ut_hvigor_test` 直接 FAIL 且 **`ut.run` dispatch 零调用、hvigor/hdc spawn 零次**；`checkUtHvigorTest` 根本没被调用 |
| V3b | **直调 test helper**（无 prebuild，模拟 check-exit.ts:317 那条路径）+ `HARNESS_SKIP_HVIGOR=1` | 走今天的内建路径（`runHvigorTest` :2232 自建），行为逐字不变；collector 缺席 ⇒ **不参与执行键复用**；跳过**不被**洗成构建成功 |
| V4 | 同一 feature 连跑两次 UT 门禁，输入完全不变（HAP、用例集、设备、toolchain 同） | 第二次**装机与执行的 hdc/hvigor spawn 为 0**（设备身份查询 `hdc list targets`/`wm size` 计入独立桶，允许非零），check 结果（逐模块 total/passed/failed 与 `hdc-test.<module>.log` 内容）与第一次逐字一致；`ut/<stamp>/ut/execution-key.json` 两条记录键相同 |
| V4b | 两个模块，第二次**只改非首模块**的：①该模块 HAP 字节；②该模块 `targetCases` | 两种情形都**整轮真跑**（两个模块的 `ut.run` 都被调），不出现"首模块复用、次模块真跑"的半复用；整轮键与第一次不同 |
| V5 | 第二次分别改：①ohosTest HAP 字节；②`targetCases` 集合；③`HARNESS_HDC_TARGET`；④首次 outcome 为失败；⑤`--force-device` | 五种情形一律真跑（`ut.run` 被调用），且 `decideReuse` 的 `reason` 分别指名键不符/最新失败/用户要求 |
| V6 | 三轮，**失败记录必须由生产路径写出**（不手工摆记录）：①普通调用跑通、落成功记录；②`--force-device` 下让真实分派在**进程边界**失败（preload 让该轮的 `aa test`/hdc 命令返回**非零进程结果**，**不 throw**——throw 会从 hdc-runner.ts:1089 `runHdc` 直接抛出、绕过正常失败写入分支，那条路由 V6b 覆盖；含"仅次模块失败"的部分失败变体）；③普通调用 | ②轮由 UT 侧的失败分支把前置记录覆盖为同键失败 `execution-key.json`（`outcome≠success`，部分模块失败也记整轮失败）；③不复用、真跑，`reason` 指名"最新同键 run outcome=…"；旧成功不被拿来盖新失败 |
| V6b | 先跑一轮成功、落同键成功记录；再让 `checkUtHvigorTest` **抛异常**（被 check-ut.ts:4097 `safeRun` 兜住，如 preload 对 `aa test` throw 走 hdc-runner.ts:1089 那条）；再跑一轮 | 抛出轮**留下的是 dispatch 前的非成功前置记录**（`outcome≠success`），它比第一轮的成功更新 → 下一轮 `decideReuse` 拒绝复用、真跑；不出现"抛异常的那轮不留痕、上一轮成功仍是最新"的洗绿 |
| V7 | report-only，跑**完整 checker**（不是直调分桶函数）：①HAP mtime 与 install meta 不符；②trace 缺 `cases[]`；③`timing.pipeline.hap_built_at` 与 `build.hapBuiltAt` 不一致但源 meta 都在（:2519）；④报告耗时与 timing 不符且 timing 可由 trace 重建；⑤`device-test-run.meta.json` 缺 `run_duration_ms`（:2505，**UNKNOWN 唯一可达现场之一**） | ①②仍 BLOCKER FAIL；③④重建后**最终 check 状态 PASS**；⑤`status:'WARN'` + `failure_kind:'derived_statistic_unavailable'`，`details` 含 UNKNOWN 措辞，报告耗时格是 `—`（**不是 `UNKNOWN` 字面量**，否则 `parseDurationCell` 会另判 :2560 mismatch）；**五例全程 hvigor/hdc/Hylyre spawn 零次** |
| V7b | 反例守卫：v1 trace 的某个 step **删掉 `duration_ms`**，跑完整 checker | 被 `requireV1ForGate`（hylyre-result-protocol.ts:302，经 check-testing.ts:5037）判 `failure_kind:'unsupported_result_protocol'` → **hard、BLOCKER FAIL**，不进 soft 桶、不进 WARN 通道——证明"原始协议缺口 ≠ 派生统计缺口" |
| V8 | 同键成功但派生证据不全：①`timing_complete=false` 且冻结 trace 足以重建；②`timing_complete=false` 且 trace 也不全；③**真实删掉 `frozen.device-test-timing.json` 文件**（派生组）；④**真实删掉 `frozen.device-test-run.meta.json` 文件**（执行事实组） | ①③走重建通道：复用并重建 timing，`ut.run`/`device_test.run` 不被调；②回落真跑（fail-closed），不带半份统计签发；④直接拒绝复用、真跑，`reason` 出词"执行事实冻结件缺失" |
| V9 | 性能类 TC 缺 case duration，跑**完整 checker**：①`acceptance.performance[].id=NFR-1` 且 test-plan 的 `关联 AC` 列写了 `NFR-1`；②同①但 `关联 AC` 列没写 NFR（识别不到） | ①归 hard 桶 → BLOCKER FAIL，不进重建/WARN 通道，details 指明性能 AC 必须真实量测；②按 soft 处理（识别路径的已知边界，见 D3「放弃的准确性（识别路径）」），不误伤成 FAIL |
| V10 | attended（经真实 `AttendedGoalPhaseExecutor` bridge，`runGoalRuntimeChain({executorMode:'attended'})`，helper 已捕获逐轮 prompt）与 detached 对照 | attended prompt 不含 `## Unattended execution`、`MUST NOT stop to ask`、`overrides` 三串，**含**四条 gate-integrity 红线与 `Deterministic detectors` 段；detached prompt 除账本话术一句外逐字不变；attended 的 waiting/resume 仍正常；`{executor:'attended', owner:'process'}` 仍被 B02 的入口约束拒绝启动 |
| V11 | **复用资格前置**（D2）。先跑一轮成功、落同键成功记录；随后**改测试源码但不重新编译**，让旧 signed HAP 原样留在盘（磁盘摘要与记录里的一致），再跑第二轮：①经 check-exit.ts:317 形态**直调 `checkUtHvigorTest`（无 collector）**；②走 check-ut 正式编排（collector 在场） | ①**不查复用**（前置门第 1 条不满足），`decideReuse` 的 `reason` 出词"本次调用无成功 prebuild，不做同键复用"，走今天的内建构建 + 真跑，`ut.run` 被调；②prebuild 真的重新编译（`genOnDeviceTestHap` spawn ≥1 次）→ 新 HAP 摘要 ≠ 记录里的摘要 → 整轮键变 → 真跑。**两条路径都不得出现"编译与执行一起被跳过"** |

B06 登记项（本批不做）：bc-openCard-1 的 C-U 回归实测本批四条的真实节省量与"真实测试不漏"；同时取 §1 未证实的 hvigor cache 数据（命令见 §7）。

## 7. 命令与完成判据

开发仓根执行。[select-suites.ts](../../harness/tests/utils/select-suites.ts) 按 `suite.id.includes(filter)` 选套件；profile 套件由 [run-unit.ts](../../harness/tests/run-unit.ts):32–51 自动发现为 `profile:hmos-app:<basename>`。以下过滤串均已核对为真实登记 id 的子串：`execution-key`（349，不误命中 `execution-channel*`）、`testing-trace-gates`（309）、`efficiency-first-t2`（346）、`test-report-writer`（347）、`ut-module-selection`（128）、`goal-headless-guard`（306）、`goal-runner-testing-integrity`（204）、`goal-phase-runtime`（252）各命中一套；`hvigor` 命中 profile 侧四套（`hvigor-args` / `hvigor-build-verdict` / `ut-hvigor-build-classify` / `ut-hvigor-test-failure`），core 侧零命中；`device-test-timings` 命中 `profile:hmos-app:device-test-timings` 一套；`hdc-runner` 只命中 `profile:hmos-app:hdc-runner`（同目录的 `hdc-foreground-probe` / `hdc-spawn-guard` 都不含该子串，已核对）。不拼接多个 id。

    node scripts/check-plan-version.mjs
    npm --prefix harness run typecheck
    npm --prefix harness run test:unit -- --filter execution-key
    npm --prefix harness run test:unit -- --filter hvigor
    npm --prefix harness run test:unit -- --filter ut-module-selection
    npm --prefix harness run test:unit -- --filter testing-trace-gates
    npm --prefix harness run test:unit -- --filter efficiency-first-t2
    npm --prefix harness run test:unit -- --filter test-report-writer
    npm --prefix harness run test:unit -- --filter device-test-timings
    npm --prefix harness run test:unit -- --filter hdc-runner
    npm --prefix harness run test:unit -- --filter goal-headless-guard
    npm --prefix harness run test:unit -- --filter goal-runner-testing-integrity
    npm --prefix harness run test:unit -- --filter goal-phase-runtime
    npm run openspec:validate
    npm run candidate:build

纯文案返修只查相关 diff/plan；生产变更跑目标检查。`candidate:build` 含 typecheck、unit 全量、fixture、consumer smoke 与 zip 校验，作全量验收，不在它前后另跑重复 `npm test`。

**本地完成 = 本批完成**（总plan §1/§5：B03 只做本地验收）：V1 至 V11（含 V3a/V3b、V4b、V6b、V7b 五条拆分/新增例）与上述检查通过、OpenSpec delta 与 MIGRATION 同步、候选件可交用户，即可置 `b03-local-acceptance` completed 并进 B04 细化。`b03-host-acceptance` 保持 pending 直到 B06 的 C-U 回归覆盖本批窗口——**不得**用本地通过冒充宿主证据。

B06 待取的宿主数据（只读，由用户在验收宿主触发一次 UT 窗口后读取；本批不触碰宿主工程）：

    # 一次 UT 门禁后，读 ohosTest 构建耗时与实际发生次数
    cat <projectRoot>/doc/features/<feature>/ut/hvigor-ut-build.<module>.meta.json   # durationMs
    ls -l <projectRoot>/doc/features/<feature>/ut/<stamp>/ut/execution-key.json      # 键与复用记录

改前该 meta 反映的是**第二次**（据称命中 cache）构建的耗时——若确为毫秒级，D1 的收益只剩"一次 spawn + 日志不被覆盖"，如实登记不追加承诺；若为秒级以上，节省量按实测写入 B06。

## 8. 修订记录

### 2026-09-06：提纲细化为施工图（未实施、未提交）

- 批次门对齐总plan 修订：删去提纲里"依赖B02宿主通过""闭环后才进B04""结合B01/B02的C-U日志"三处表述，改为静态调用链 + 既有工具日志为据；`b03-host-acceptance` 改为并入 B06，`b03-executor-lifecycle` 维持 cancelled。
- 四条落点逐行核实后落 D1–D4，另补 D0（保留面）与 D5（规格文档）。
- **"hvigor 命中 cache 只需毫秒"核实结论：未证实**。唯一出处是 hvigor-runner.ts:2229 的注释；`HvigorRunResult` 无 cache 字段、`buildHvigorDiagnostics` 不解析该信号、仓内无相关测试，只读宿主样本无 ut 目录。故 D1 按裁决改为"只做结果传递、不承诺节省"，并另记一条可验证的副作用（两次构建同名日志/meta 互相覆盖）与 B06 的取数命令。
- 仍标"待核实"一项：§6 生产接线要求里"测试能否手工构造 `HarnessResolvedProfile` 并指定 `profileDir`"，含核实命令与退路。

### 2026-09-06：codex 对施工图的 adversarial review 第 1 轮（8 条 finding 全数落入 plan，未实施、未提交）

每条均已回代码逐行核实后再改（行号为核实时的实际位置，与 codex 引用不符处在"处置"列注明）。既定裁决未被推翻：仍保留 completion probe / terminal 仲裁 / 硬预算，不建通用缓存服务或 manifest，不换 UT 框架，不减原生编译与业务断言，不新增 driver 或 K-A 支持，B03 宿主回归并入 B06。

| 严重度 | finding 摘要 | 处置 | 落点 |
|---|---|---|---|
| high | D1/D2：无前置构建的消费者可能复用旧包成功——check-exit.ts:317 直调 `checkUtHvigorTest`，实际构建在 hvigor-runner.ts:2232；源码已变而旧 HAP 尚在时可能跳过编译与执行 | 采纳。D2 的"复用资格前置"两条判据（本次调用内有成功 prebuild + 该 prebuild 的 HAP 摘要等于键中摘要）核对为完整，补验收 | D2 第 95–100 行（已在）；**新增 V11**（源码变 + 旧 HAP 在盘，直调与正式编排两条路径都不得跳过编译与执行） |
| high | D2：多模块键与冻结粒度未闭合——ut-host-impl.ts:892 逐模块执行，hdc-runner.ts:1448 每模块覆盖同一个 `hdc-test.log` | 采纳。整轮键（三项摘要按模块名排序拼接）+ 逐模块冻结件 + `hdc-test.<module>.log` 三段核对为完整，补验收与提交边界 | D2 第 102/104 行（已在）；**新增 V4b**（只改非首模块 → 整轮真跑）；§4 S1 补日志改名与影响面；§5 新增"整轮键、不做半复用"行；§7 加 `--filter hdc-runner` |
| high | D3/V7⑤/V9：UNKNOWN 与性能保护未接通真实生产者与门禁——device-test-timings.ts:58–62 把缺失步骤耗时加作 0，test-report-writer.ts:327（codex 记 :326，实际 :327）缺 timing 行写 `'0ms'`；而原始 v1 缺 `duration_ms` 会先被 requireV1ForGate 按冻结 schema 拒绝 | 采纳。D3 新增边界段：原始协议缺口 hard / 派生统计缺口 soft；表示法改 `null`+`—`（`parseDurationCell`:186 只认 `— - n/a na 不适用`，`UNKNOWN` 只进 details 与备注列）；性能识别路径自定（`ctx.featureSpec.acceptance.performance[]` + 新增 `extractTcNfrRefs`）；写明 UNKNOWN 只在 pipeline 段 meta 缺 durationMs（:2499/:2502/:2505/:2508）与 legacy cost 分配分支可达 | D3 新增四段 + 放弃的准确性③；**V7 改为跑完整 checker 并把⑤换成 :2505 现场**；**新增 V7b**（v1 删 `duration_ms` → hard）；**V9 拆①②**（识别到 / 识别不到）；§4 S2 与 §5 新增行 |
| high | §6/V1/V4/V7：provider 计数未覆盖工具边界——第二次构建是 `runHvigorTest` 内直调，两模块的 `ut.compile` provider 本来就只有两次；check-testing.ts:3804 `resolveExecutionDeviceIdentity` 直调 `runHdcRaw`；provider 返回桩即可过 V1 | 采纳。§6 前言重写为**进程调用边界计数**，复用 testing-trace-gates.unit.test.ts:721–747（codex 记 721–745）的 `--require` preload patch `child_process.spawnSync`，保留真实 provider/runner，身份查询单独计数并允许，不新增生产钩子 | §6 前言整段重写；V1/V4/V7 断言下移到 spawn 层；provider 计数仅保留给 V3a 这类"dispatch 次数本身是问题"的用例 |
| medium | D2/V6：最新失败验收只验证读取不验证失败记录生产——`decideReuse`:143 只扫已落键记录（失败由 check-testing.ts:4404 写、成功由 :4458 写，注释在 :4402/:4452） | 采纳。D2 的失败/异常写记录三条口径核对为完整，V6 改为由生产路径造失败 | D2 第 108–112 行（已在）；**V6 重写**（`--force-device` 下让真实分派在进程边界失败，含部分模块失败）；**新增 V6b**（`safeRun` 兜住的抛出轮零记录） |
| medium | D3/V8：统计缺口仍触发真跑——execution-key.ts:151–155 要求 `FROZEN_RUN_ARTIFACTS`（:52–55）全部在盘，含派生的 `frozen.device-test-timing.json` | 采纳。冻结件加 `group: 'execution' \| 'derived'` 标注，`decideReuse`:153 判据拆两句 | D3 末段新增"冻结件也必须分两组"；**V8 扩为四例**（新增真实删派生组 / 真实删执行事实组两个用例） |
| medium | D3：派生值误列 hard——:2412（timing 生成时间）、:2476/:2479（复制的 reused）、:2519（复制的 hapBuiltAt）只是 timing 投影陈旧；:2473/:2517 才是源 meta 缺失 | 采纳。四条投影移出 hard 桶列举、并入 soft，:2473/:2517 保留在 hard 并标注"源 meta" | D3 hard/soft 两个 bullet 重写 + 新增"四条投影陈旧必须归 soft"段；V7③ 用 :2519 现场 |
| medium | D1/V3：skip 验收与短路语义矛盾——ut-host-impl.ts:491 把 skipped build 判失败，check-ut.ts:4536 短路 test | 采纳。第 74 行的说明段核对为完整，并纠正其内两处行号（4526→4527、4534→4536） | D1 第 74 行；**V3 拆 V3a**（正式编排：短路、`ut.run` 零调用、spawn 零次）**与 V3b**（直调 test helper 且无 prebuild → 旧内建行为、不参与复用） |

附带结项：§6 原"待核实"项已核实可行——`HarnessResolvedProfile` 必填字段见 types.ts:874，做法是复制 `loadResolvedProfile`（profile-loader.ts:195）结果后只替换 `profileDir`；同时核实到一条 codex 未提的连带影响并写入 plan：`profileDir` 也决定 `tryLoadUtHostImpl`（profile-host-loader.ts:124–125 经 :98 require `profileDir/harness/<baseName>`），影子目录必须转导真实 `ut-host-impl`，否则完整编排会断。

### 2026-09-06：codex 对施工图的 plan review 第 2 轮（2 条 finding 采纳，未实施、未提交）

| 严重度 | finding 摘要 | 处置 | 落点 |
|---|---|---|---|
| medium | D3 表示法漏了对账消费者——`reconcileReportWithDeviceTestTiming`（testing-trace-gates.ts:391）对 case 行做 `!parsed.valid \|\| parsed.ms === null \|\| Math.abs(parsed.ms - timingCase.duration_ms) > 1`，既无条件拒绝刚放行的 `—`（伪 mismatch），又在 `duration_ms` 放宽为 `number \| null` 后过不了 strict typecheck | 采纳。复用同文件 `compareReportDuration`（:266–290）既有空值分支形状：expected 为 null 时要求报告格是空值占位，非 null 时才做 ±1ms 减法；不新写谓词、不改 `parseDurationCell` | D3「表示法」段新增一条 bullet；§4 S2 补该消费点与 `null ↔ —`、`0 ↔ 0ms` 两组等价断言 |
| high | D2 第 111 行「无记录则下次真跑」不成立——`listExecutionKeyRuns`（execution-key.ts:121）跳过缺 `execution-key.json` 的 run 目录，`decideReuse`:143 因此仍取到**上一轮的成功**；写不出记录 / 抛异常的那轮反而被旧成功洗绿 | 采纳。改为**记录前置**：dispatch 前先落一条 `outcome:'started'` 的非成功 attempt，执行后覆盖为真实结果；前置写入失败即**不进入复用判定**、直接真跑并在 details 披露。V6 的失败轮改由 preload 返回**非零进程结果**制造（throw 会从 hdc-runner.ts:1089 直接抛出、绕过失败写入分支）；V6b 改为先有成功历史，再验证 `safeRun` 兜住的抛出轮被前置的非成功记录挡住 | D2「失败与异常路径」三条口径重写；V6、V6b 重写 |

## 实施记录

### 2026-09-06 · S0 UT 出包唯一化（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `profiles/hmos-app/harness/hvigor-runner.ts` | `runHvigorTest` 增可选入参 `prebuild?: HvigorRunResult`；`const buildRes = opts.prebuild ?? runHvigorBuild({...})`——在场即跳过内建出包，缺席时逐字不变。顺带删掉 :2229 那句未证实的「命中 cache 只需毫秒」注释（§1 已裁定为无据） |
| `profiles/hmos-app/harness/ut-host-impl.ts` | 新增导出 `utBuildCollectorKey(projectRoot, module, product)`（`computeHvigorInvocationFingerprint` + `target:'ohosTest'`/`task:'genOnDeviceTestHap'`/`buildMode:'test'`）；`checkUtHvigorBuild` / `checkUtHvigorTest` 各加可选尾参 `builds?: Map<string, unknown>`；build 侧仅在 `isHvigorBuildSuccessful` 时写入，test 侧命中即经 `dispatchUtRun` 下传 `prebuild` |
| `harness/profile-host-loader.ts` | `UtHostImpl` 两处签名加同一可选尾参 |
| `harness/scripts/check-ut.ts` | :4517 前 `const utBuilds = new Map<string, unknown>()`，同时传给 `checkUtHvigorBuild` 与 `checkUtHvigorTest` |

**验证**

- `npm --prefix harness run typecheck` PASS
- `--filter hvigor` 65 passed / 0 failed（含新增 V2）
- `--filter ut-module-selection` 8 passed / 0 failed（含新增 collector 键同一性）

**新增用例**

- V2（`profiles/hmos-app/harness/tests/unit/hvigor-build-verdict.unit.test.ts`）：临时工程直调真实 `runHvigorTest`，在 `child_process.spawnSync` **进程调用边界**计数——①无 `prebuild` 时 hvigor spawn > 0 且不推进到装机前置段；②传成功 `prebuild` 时 hvigor spawn **恰 0**、不报 `toolMissing`、`command` 推进到 `genOnDeviceTestHap + …`。不用源码正则做次数证据。
- collector 键同一性（`harness/tests/unit/ut-module-selection.unit.test.ts`）：同 (module, product) 稳定同值，换模块/换 product/缺 product 即换键；并锁 build/test 两侧共用同一键式（这条是**接线**断言，不充当调用次数证据）。

**偏离 plan**

- V2 的计数放在**同进程**的 `child_process.spawnSync` 补丁上，而非 `--require` preload 子进程：这一例是**直调 `runHvigorTest`**（无子进程编排），进程内补丁与 preload 观察的是同一个 seam，且能顺带把 hvigor/hdc 都拦成合成结果——保证任何开发机（有无 DevEco、有无真机）结果一致，也绝不碰真实设备。preload 形态仍留给需要跑完整 check-ut 编排的 V1/V3a/V4/V6/V11。**放弃的准确性**：这一例证不了"经 check-ut 完整编排时也只出一次包"，那条由 V1 承担。

### 2026-09-06 · S1 UT 执行键复用（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `profiles/hmos-app/harness/execution-key.ts` | `FROZEN_RUN_ARTIFACTS` 每项加 `group: 'execution' \| 'derived'`（timing=derived、run meta=execution）；新增 `FrozenArtifactSpec` / `ExecutionKeyLeg` / `utFrozenRunArtifacts(mods)`；`listExecutionKeyRuns` 加 `leg` 形参（默认 `'hylyre'`，决定 `<stamp>/<leg>/` 段名）；`freezeRunArtifacts` / `restoreFrozenRunArtifacts` 加 `artifacts` 形参（默认 `FROZEN_RUN_ARTIFACTS`）；`decideReuse` 加 `DecideReuseOptions{leg, artifacts, excludeRunDir}`，判据拆两句——执行事实组缺任一 → 拒绝复用并出词「执行事实冻结件缺失」，派生组缺失或 `timing_complete===false` → 返回该 run 并标 `evidenceRebuildRequired`；`trace_path` 为空串（UT leg 无 trace）不再被判「trace 缺失」 |
| `profiles/hmos-app/harness/hdc-runner.ts` | `finalize` 改写 `hdc-test.<module>.log`（`opts.srcModuleName`）；`aa_test_no_result` 诊断话术同步；接收从 check-testing 下移的 `resolveExecutionDeviceIdentity()`（两侧共用一份，不复制） |
| `harness/scripts/check-testing.ts` | 删掉本地 `resolveExecutionDeviceIdentity` 定义（1109 字符），改 import；`runHdcRaw`/`resolveHdcExecutableSync` 两个 import 随之收回 |
| `profiles/hmos-app/harness/ut-host-impl.ts` | 新增 UT 执行键段：`utRunTimestamp` / `readUtModuleResult` / `writeUtModuleResult` / `evaluateUtReuseEligibility`（复用资格前置两条判据）/ `aggregateByModule`（三项摘要按模块名排序拼接再 sha256 = **整轮键**）/ `buildUtExecutionKeyInputs`；`checkUtHvigorTest` 内加「记录前置 → 复用判定 → 复用回填 or 真跑 → 覆盖记录」四段；三个出口 details 追加 `reuseNote`（键前 16 位 + 复用/真跑与理由） |
| `harness/harness-runner.ts` | `--force-device` help 由「testing 专属」改「testing / ut」 |
| `profiles/hmos-app/harness/ut-hvigor-test-failure.ts`、`skills/reference/business-ut-workflow-detail.md` | 三处 `hdc-test.log` 字面量同步为 `hdc-test.<module>.log` |

**行为变化一句话**：同一 feature 的 UT 门禁，在整轮键（逐模块 HAP 摘要 + 用例集 + invocation fingerprint 聚合，加设备/profile/flags）不变、上一轮同键成功且逐模块冻结件齐备时，回填冻结件重算 check，不调 `dispatchUtRun`、不发一条装机/执行 hdc；任一模块输入变、最新同键失败、执行事实冻结件缺失、`--force-device`、设备身份未知、本次调用无成功 prebuild —— 一律整轮真跑。

**验证**

- `npm --prefix harness run typecheck` PASS
- `--filter execution-key` 5 passed / 0 failed（新增 V8 冻结件分组、UT leg 与记录前置两例）
- `--filter hdc-runner` 49 passed / 0 failed（新增日志按模块命名接线）
- `--filter hvigor` 65 / `--filter ut-module-selection` 8 / `--filter efficiency-first-t2` 10 / `--filter testing-trace-gates` 20 / `--filter test-report-writer` 4 / `--filter device-test-timings` 3，均 0 failed

**偏离 plan**

1. **`leg` 之外另加 `artifacts` 形参**（plan 只写 leg 决定「期望冻结件集合」）：UT 冻结件是**逐模块**的，集合取决于本轮 `mods`，无法只由 leg 推出。做法是 `decideReuse`/`freeze`/`restore` 收一个 `artifacts` 形参（默认 `FROZEN_RUN_ARTIFACTS`），UT 侧由 `utFrozenRunArtifacts(mods)` 现算。testing 侧调用与行为逐字不变。
2. **新增 `excludeRunDir` 形参**：记录前置（本轮先落 `outcome:'started'`）与「decideReuse 只看最新」直接冲突——不排除自身则复用恒不命中。排除自身后，**上一轮**遗留的 `started`（抛异常/写不出结果那轮）仍会挡住更早的成功，正是 codex round2 要堵的洗绿口。
3. **复用轮也写自己的记录**：testing 侧复用轮不落新记录，UT 侧落（成功记录 + 把回填后的冻结件再冻一份进本轮 run 目录）。**放弃的准确性**：每轮多一份小体积冻结副本；换来的是「每一轮都留下描述自己结局的最新记录」这个不变量成立——否则复用轮留下的 `started` 会把下一轮也逼成真跑。
4. **`ut-result.<module>.json` 是本批新增的落盘产物**（plan D2 只写了冻结名）：顶层写一份、run 目录冻一份，复用轮据它重建 `perModule`。不新增缓存服务/manifest，只是把本来就在内存里的 `HvigorRunResult` 落盘。
5. **`hdc-test.log` 字面量比 plan 核实的多两处**（plan 说全仓只两处）：`ut-hvigor-test-failure.ts:270` 与 `skills/reference/business-ut-workflow-detail.md` 两句。已一并同步；改 skills 与 D5「不改 skills 提示词」的表述有出入，但那条针对的是「agent 该做什么」，文件名纠偏不改变行为。

### 2026-09-06 · S2 报告对账分层（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/check-testing.ts` | `checkReportReconcileOnlyPipeline` 内新增 `softIssues[]`，把 D3 列举的派生统计缺口从 `issues[]` 移过去（timing 文件缺失/非法、pipeline 字段缺失或非数、`total_harness_ms`、四条段耗时来源、case duration/step_count 行、timing case 集合差、报告正文对账，以及 codex round1 #7 的四条投影：`generated_at` 时序、`build_reused`/`install_reused`、`hap_built_at`）；源 meta 的 `reused` 布尔缺失与 `hapBuiltAt` 缺失/非法**留在 hard**。新增：①**先重建** timing（`collectDeviceTestTimings` + `writeDeviceTestTimingJson`，仅在与盘上不同时写）；②报告正文对账不闭合时用既有 `writeGeneratedTestReport` 重算正文再复算；③性能类 TC 识别（`ctx.featureSpec.acceptance.performance[].id` ∩ `extractTcNfrRefs(plan)`）**前移到重建之前**，命中的耗时缺口一律扣回 hard；④结论：hard 在 → FAIL；只有派生缺口 → `status:'WARN'` + `severity:'BLOCKER'` + `failure_kind:'derived_statistic_unavailable'`，details 写「该统计项为 UNKNOWN，不构成执行事实结论」；⑤复用路径（`decideReuse` 返回 `evidenceRebuildRequired`）回填冻结件后重建 timing，case 集合覆盖不全即 **fail-closed 回落真跑** |
| `harness/scripts/utils/testing-trace-gates.ts` | 抽出 `durationCellMatches(parsed, expectedMs)` 作为空值感知判据，`compareReportDuration` 与 case 行共用；case 行不再无条件拒绝 `parsed.ms === null`，也不再对 nullable 做减法（codex round2） |
| `harness/scripts/utils/execution-channel-evidence.ts` | 新增 `extractTcNfrRefs(planMd)`——与 `extractTcAcceptanceRefs` 同表同列，词法只把 `AC\|BD` 换成 `NFR`；不改 `extractAcceptanceIdRefs` |
| `profiles/hmos-app/harness/device-test-timings.ts` | `DeviceTestTimingCase.duration_ms` 放宽为 `number \| null`；legacy `0.3-p0` cost 分配分支里没有对应 cost 行的 case 由 `0` 改 `null`；v1 分支一行不改 |
| `profiles/hmos-app/harness/test-report-writer.ts` | :327 的 `t ? ms(t.duration_ms) : '0ms'` → timing 行缺席**或**该行 `duration_ms === null` 时写 `'—'`；timing 行在场且值为 0 仍写 `0ms` |

**行为变化一句话**：report-only 对账不再因一行陈旧/缺失的派生统计把一次真实完整的 run 判成执行事实缺口——先由 trace+meta 重建 timing 与报告正文，重建后闭合即 PASS，重建不了才 WARN + UNKNOWN（零设备调用）；执行事实缺口与原始 v1 协议缺口仍是 BLOCKER FAIL；性能类 AC 的耗时不接受重建。

**验证**

- `npm --prefix harness run typecheck` PASS
- `--filter testing-trace-gates` 23 passed / 0 failed（新增 V7⑤ / V7b / V9 三例，改写既有 3 例）
- `--filter device-test-timings` 3 / `--filter test-report-writer` 4 / `--filter efficiency-first-t2` 10 / `--filter execution-key` 5，均 0 failed

**新增/改写用例**

- **V7⑤**（新增）：删 `device-test-run.meta.json.run_duration_ms` → `status:'WARN'`、`severity` 仍 `BLOCKER`、`failure_kind:'derived_statistic_unavailable'`、details 含 UNKNOWN 与「不构成执行事实结论」；**全程 `spawnSync` 边界零 hvigor/hdc/Hylyre/python 调用**；报告里不得出现 `UNKNOWN` 字面量的耗时格。
- **V7b**（新增）：v1 trace 删一个 step 的 `duration_ms` → hard FAIL，`failure_kind` 不是 `derived_statistic_unavailable`。
- **V9**（新增，拆①②）：报告 TC-001 耗时与 timing 不符 + `performance[].id=NFR-1`；「关联 AC」列写了 `NFR-1` → hard FAIL 且出词「性能类 AC：耗时必须真实量测」；列里没写 NFR → 识别不到 → 重建抹平 → PASS（识别路径的已知边界，不误伤）。
- 改写：`拒绝跨轮时间/复用/feature/case/duration 错配` 改为按 `derived` 标记分流（三条派生投影 → 重建后 PASS 且不得留在 hard 桶；两条执行事实 → 仍 FAIL）；`缺最终 timing` 改为「走重建通道，FAIL 仍由执行事实/协议缺口驱动」；`pass+skip` 改为 legacy 无 cost 行记 `null` + 报告 `—`。

**偏离 plan**

1. **重建改成"评估前一次重建"而非"评估→重建→复算"两遍**：`checkReportReconcileOnlyPipeline` 是一趟到底的大函数，两遍需要把整段拆成可重入的形状（远超"改动最小"）。做法是在读 `generated_at` 之前先重建 timing（只在与盘上不同时写）、在报告对账不闭合时重算正文并当场复算。结论等价：留在 soft 桶的必然是重建后仍不闭合的项。**放弃的准确性**：details 里不再区分「本来就闭合」与「重建后闭合」，只用一句 `已由 trace + meta 重建后复算` 标注本轮发生过重建。
2. **性能类 AC 的"前置判据"落在报告对账的第一遍**：D3 只说「实现落在 soft 桶入口的一条前置判据」。因为重建会抹平报告与 timing 的差，识别必须发生在重建**之前**，否则性能 TC 的缺口会被重算的正文吃掉。现在 `perfHardIssues` 收两处：重建前的报告对账 mismatch，与 case 级 UNKNOWN 行。
3. **新增一条 soft issue：`最终 timing 的 case 耗时未量到（UNKNOWN）：<TC>`**。`duration_ms` 放宽为 nullable 后，原来的 case 行校验会把 `null` 判成"行无效"（一个新缺口替换旧缺口）。改为把 `null` 认作合法的 UNKNOWN 行，另出一条带 TC id 的 soft issue——正好给性能类 AC 的识别路径提供落点。
4. **`testing-trace-gates` 夹具时间戳改到过去**（`t0 = Date.now() - 60_000`）：原夹具把 `run_ended_at`/`generated_at` 造在**未来**，而重建产物的 `generated_at` 是当下，会制造时序倒挂。生产里 `run_ended_at` 恒在过去，夹具不该造未来时间。
5. **plan §5 说 `testing-trace-gates.unit.test.ts:286/:309–317` 的 `0ms` 断言"不在改动面内"，实际在**：那一例走的正是 legacy cost 分配分支且 TC-002 没有 cost 行 → 按 D3 必须记 `null`、报告写 `—`。已按 D3 改写用例（v1 分支的 0/0 语义确实一字未动，由同文件下一例守住）。

### 2026-09-06 · S3 attended 模式提示（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `harness/scripts/goal-phase-runtime.ts` | `buildUnattendedExecutionBlock` 加可选尾参 `attended = false`，**正文一字不改，只改归属**：模式段（headless 声明 / `approval_mode` / MUST NOT stop to ask / 覆盖 phase SKILL 停等 / 逐门自动决议与 `headless-assumptions` 账本）只注入 detached，红线段（四条 gate-integrity + `deterministicDetectorLines`）两种形态照常注入；attended 另加一段诚实说明（`## Attended execution (session owner)`，不写扩权话术）。纠正失效话术：账本行由「check-receipt BLOCKER-validates …a gate without a ledger line fails the phase closure」改为「audit trail — it is not authorization, and a missing ledger line does not by itself veto phase closure」（check-receipt.ts:1076 已退役该否决）。`buildPhasePrompt` 加可选尾参 `attended?: boolean` 并透传；生产调用点传 `executorMode === 'attended'` |

**行为变化一句话**：attended 轮（session owner 在场、走 `AttendedGoalPhaseExecutor` bridge）不再被同一份提示词同时要求「停下来问」与「停下来问 = 任务失败」；detached 轮除账本话术那一句外逐字不变。

**验证**

- `npm --prefix harness run typecheck` PASS
- `--filter goal-headless-guard` 125 passed / 0 failed（新增 V10）
- `--filter goal-runner-testing-integrity` 63 / `--filter goal-phase-runtime` 17，均 0 failed

**新增用例**

- **V10**（`harness/tests/unit/goal-headless-guard.unit.test.ts`）：同一 manifest 造 attended / detached 两份 prompt——attended **不含** `## Unattended execution` / `MUST NOT stop to ask` / `overrides` / `approval_mode` / `§9` / `headless-assumptions`，**含**四条 gate-integrity 红线与 `Deterministic detectors` 段；detached 六串全在；并钉住失效话术已被替换。

**偏离 plan**

- V10 走 `buildPhasePrompt` 直调对照，而非 `runGoalRuntimeChain({executorMode:'attended'})` 端到端。理由：D4 的全部行为都发生在 `buildPhasePrompt` 的一个可选尾参上，生产接线（`executorMode === 'attended'` 传参）与「attended ⇔ session owner」双向约束分别由 B02 既有入口约束和本次的调用点改动覆盖。**放弃的准确性**：这一例证不了「attended 的 waiting/resume 仍正常」与「`{executor:'attended', owner:'process'}` 仍被拒绝启动」——前者由 `goal-runner-testing-integrity`（63 例）既有 bridge 用例覆盖，后者由 B02 的入口约束用例覆盖，本批未改动这两处。

### 2026-09-06 · S4 规格、文档与验收（完成）

**改动文件**

| 文件 | 变化 |
|---|---|
| `openspec/changes/execution-reuse-and-report-layering/proposal.md` | 新建：四条浪费的代码级证据、What Changes 五段、Impact 含八条「放弃的准确性」 |
| `openspec/changes/execution-reuse-and-report-layering/tasks.md` | 新建：S0–S4 五组任务，5.4（宿主回归）留 `[ ]` 归 B06 |
| `.../specs/harness-gates/spec.md` | MODIFIED 两条（执行键扩到 UT + 记录前置 + 冻结件分两组；report-only 分层 + 空值表示法 + 性能类 AC 例外）、ADDED 一条（一次 UT 门禁一个模块一个包、日志不被覆盖、直调路径不参与复用），共 14 个 Scenario |
| `.../specs/goal-runner/spec.md` | MODIFIED 一条：无人值守块只注入 detached、attended 保留红线段、账本条款改「留痕不否决 closure」 |
| `MIGRATION.md` | 新增一节「构建执行复用与报告分层」：UT 出包唯一化、UT 执行键新目录与整轮键、`hdc-test.<module>.log` 改名、report-only 分层与 WARN/UNKNOWN、`null`/`—` 表示法、attended 提示形态。全节标明**消费者无需动手** |
| `harness/tests/unit/ut-module-selection.unit.test.ts` | 新增 UT 编排夹具与 V1 / V4 / V4b / V5 / V6 / V6b / V11① 七例 |

**验证**（§7 全套，日志在 `…/scratchpad/b03/final/`）

| 命令 | 结果 |
|---|---|
| `node scripts/check-plan-version.mjs` | PASS |
| `npm --prefix harness run typecheck` | PASS |
| `--filter execution-key` | 5 passed / 0 failed |
| `--filter hvigor` | 65 passed / 0 failed |
| `--filter hdc-runner` | 49 passed / 0 failed |
| `--filter ut-module-selection` | 16 passed / 0 failed |
| `--filter testing-trace-gates` | 23 passed / 0 failed |
| `--filter efficiency-first-t2` | 10 passed / 0 failed |
| `--filter test-report-writer` | 4 passed / 0 failed |
| `--filter device-test-timings` | 3 passed / 0 failed |
| `--filter goal-headless-guard` | 125 passed / 0 failed |
| `--filter goal-runner-testing-integrity` | 63 passed / 0 failed |
| `--filter goal-phase-runtime` | 17 passed / 0 failed |
| `npm run openspec:validate` | 33 passed / 0 failed（含 `change/execution-reuse-and-report-layering`）+ enforcement PASS |
| `npm --prefix harness run test:unit`（全量，§7 之外的自查） | 309 suites / 0 failing，exit 0 |
| `npm run candidate:build` | **未跑**（调度者在 review 后统一跑） |

**新增用例（S4 批）**

- **V1**：真实 `checkUtHvigorBuild` → `checkUtHvigorTest` 编排，影子 `profileDir` 挂计数 provider——build 侧两个模块的成功出包都进 collector，`ut.compile` / `ut.run` 各恰一次 dispatch，每次 `ut.run` 都收到非空 `prebuild` 且 product 贯穿。
- **V4 / V5**：输入完全不变的第二轮 **零 `ut.run` dispatch** 且 details 出词「同键复用」；改 HAP 字节 → 键不符真跑；`--force-device` → 真跑。
- **V4b**：两个模块，只改**次模块**的 HAP → 整轮两个模块都真跑，不出现半复用。
- **V6**：①成功轮落记录 → ②`--force-device` 下用例失败的一轮由生产路径把记录覆盖成整轮失败 → ③下一轮真跑、reason 指名 `outcome=failed`。
- **V6b**：①成功轮 → ②抛出轮（生产里被 `safeRun` 兜住）→ ③下一轮真跑、reason 指名 `outcome=started`——**证明前置记录挡住了旧成功**。
- **V11①**：无 collector 的直调形态 → `prebuild` 缺席、`ut.run` 照常真跑、details 出词「本次调用无成功 prebuild，不做同键复用」。
- 另加两条接线锁：失败出包不得进 collector；`check-ut.ts` 按次创建**一个** collector 并同时传给两侧。

**偏离 plan**

1. **V1/V4/V4b/V5/V6/V6b/V11 的计数落在 `dispatchUtRun` 层，不是 `--require` preload 子进程**。理由：这几例问的都是**编排有没有短路 / collector 有没有接上**——按 plan §6 自己的分界，这正是「dispatch 次数本身是问题」的那一类，允许用 `ctx.resolvedProfile` 构造计数 provider。真正的「工具少 spawn 一次」由 V2 在 `child_process.spawnSync` 边界证明（无 `prebuild` 时 spawn > 0、有 `prebuild` 时 spawn 恰 0）。夹具同时把 hdc 命令一律拦成合成结果，**全程不碰真机**，且结果不随开发机有无设备而变。**放弃的准确性**：没有一条端到端「两模块改前 4 次 / 改后 2 次」的对照数字——那需要真实 hvigor 工具链与真机；B06 的宿主窗口会取到真实次数与耗时。
2. **V3a 未单独构造**：`HARNESS_SKIP_HVIGOR=1` 下 `ut_hvigor_build` FAIL → check-ut.ts:4536 短路的语义由既有 `ut-hvigor-build-classify` / `hvigor-build-verdict` 套件与 `check-ut` 接线断言覆盖，本批未改动这条短路。**未做的部分**：「`ut.run` dispatch 零调用 + spawn 零次」的显式计数。
3. **V7①②③④ 未逐条构造**：①②（HAP mtime 不符、trace 缺 cases）由既有「执行事实错配仍 FAIL」表两条覆盖；③④（投影陈旧、报告与 timing 不符可重建）由同表的三条 `derived` 分流覆盖（重建后 PASS 且不得留在 hard 桶）。⑤单独成例。
4. **V8 落在 `decideReuse` 的纯函数层**（`execution-key` 套件）而非跑完整 checker：四种情形（删派生组 / 删执行事实组 / `timing_complete=false` / 齐备）全部覆盖，且删的是**真实文件**。complete-checker 侧的 fail-closed 回落由 `check-testing.ts` 的重建分支承担，未单独构造用例。
5. **V9 的构造现场**：D3 自己论证了「case 级 UNKNOWN 在 v1 上不可达」，所以 V9 用的是**报告与 timing 不符**这一可达现场——性能 TC 时该缺口在重建之前被扣下、留 hard；非性能 TC 时被重建抹平。这与 D3「性能 case 的 duration 必须来自真实执行 trace」同义。

### 2026-09-06 · 收尾补记（本批接受的两条边界）

1. **UT run 目录用 `mkdirSync(recursive)` 而非 testing 侧的排他认领**。testing 的 `prepareFreshHylyreRunDir` 对目录冲突 fail-closed，因为那个目录还承载「本轮派生计划副本」的新鲜度声明；UT run 目录只放执行键记录与冻结件。**接受的边界**：同一毫秒内启动的两轮 UT 会共用一个 stamp 目录、后一轮的前置记录覆盖前一轮。`utRunTimestamp` 是毫秒精度，真实 UT 轮次以分钟计，本批不为此引入状态机。
2. **`outcome:'success'` 的判据严于门禁 PASS**：整轮记 success 要求全部选中模块 `executed && total>0 && exitCode===0`；而 `ut_hvigor_test` 允许「失败全部在 suite 基线豁免内」也判 PASS。于是「PASS 但有豁免失败」的轮会被记成 `failed`，下一轮不复用、真跑。方向安全（只损命中率不损正确性），本批不额外分叉判据。

**未做（留给后续/宿主窗口）**

- V3a（`HARNESS_SKIP_HVIGOR=1` 正式编排下 `ut.run` 零 dispatch + spawn 零次）未单独构造显式计数；短路语义本批未改动，由既有 `ut-hvigor-build-classify` / `hvigor-build-verdict` 覆盖。
- V11②（正式编排下「改源码 → prebuild 真的重新编译 → 新 HAP 摘要 ≠ 记录摘要 → 整轮键变 → 真跑」）需要真实 hvigor 工具链才能证明「真的重新编译」；键随 HAP 字节变即真跑这一半已由 V4/V5 的 HAP 变更用例覆盖。
- `npm run candidate:build` 按指令未跑，由调度者在 review 后统一执行。
- `b03-host-acceptance` 保持 pending，并入 B06 的 C-U 回归。

### 2026-09-06 · codex review 第 1 轮返修（5 条 finding 全数落地，未提交）

每条均先回代码逐行核实再改；改完用「先把修复退回旧形态、看新用例是否变红」的方式验证守卫真的会咬（下表「反证」列）。

| 严重度 | finding | 改动（文件:行） | 新增/改写用例 | 反证 |
|---|---|---|---|---|
| high #1 | 用例失败可被记为 success：`roundOk` 只看 `exitCode`，而它是 hdc 原始退出码——Hypium 报 `Failure: 1` 而 hdc 退 0 时仍是 0 | `profiles/hmos-app/harness/ut-host-impl.ts:836–858` 新增导出 `utModuleRoundSucceeded`（executed ∧ 非 toolMissing/skippedByEnv/timedOut/installBlocking ∧ `exitCode===0` ∧ `total>0` ∧ `failed===0`）；:1137 `roundOk` 改用它 | `ut-module-selection`「退出码 0 + Hypium 断言失败不得记 success，下一轮真跑（codex #1）」：aa test 在 spawn 边界返回 **status 0 + `Tests run: 1, Failure: 1`**（真实 Hypium 解析器解析），断言记录 `outcome≠success` 且下一轮 `ut.run` 再次真跑、reason 指名 `outcome=failed` | 把判据退回「不看 `failed`」→ 该例红：`实际 outcome=success` |
| high #2 | 性能保护晚于生产入口的报告重建：完整 checker 在 :5844 先 `regenerateTestReport`，差异被抹平后再进对账已无 mismatch | `harness/scripts/check-testing.ts:2209–2215` 加可选尾参 `reportBeforeRebuild`；:2620–2626 用**重写前**那份正文识别性能缺口（重写后那份照旧再识别一次）；:2714–2717 去重；生产入口 :5876–5880 把重写前的盘上正文原样传下去 | `testing-trace-gates`「V9 完整 checker：性能类 TC 的耗时缺口在首次重建前被扣下」——跑 `checker.check(ctx)` 完整入口，先断言报告**确实被重写过**（252ms 已消失、`test_report_generated=PASS`），再断言性能 TC 归 hard、非性能 TC 不误伤，且全程 spawn 零次 | 去掉 :5880 的传参 → 该例红（status 变 PASS） |
| high #3 | 覆盖失败可能毁掉前置记录：`writeFileSync` 原地截断，写失败留下空文件/半份 JSON → `listExecutionKeyRuns` 跳过 → 最新变回更早的成功 | `profiles/hmos-app/harness/execution-key.ts:134–157` 改同目录临时文件 + `renameSync` 原子替换，失败时清临时件并如实抛出 | `execution-key`「记录写出原子替换：写失败保留完整的 started 记录，旧成功仍不被复用（codex #3）」：补丁 `fs.writeFileSync` 模拟「截断之后才失败」（ENOSPC 形态），断言目标文件一字不动、无 `.tmp` 残留、下一轮 `decideReuse` 仍拒绝复用 | 退回原地写 → 该例红：`写失败不得截断已有记录` |
| medium #4 | 重建完成的 timing 随后被旧冻结件覆盖：:4396 restore → :4407 写重建结果 → :4433 又 restore 一次 | `harness/scripts/check-testing.ts:4008–4042` 抽出 `adoptFrozenRunArtifactsForReuse`（**每轮只 restore 一次**，重建结果落盘发生在这唯一一次之后），:4442 与 :4464 改为共用它、删掉第二处回填 | `testing-trace-gates`「V8 复用回填：重建后的 timing 不被旧冻结件覆盖，报告读到的是重建结果」——冻结 timing 缺 case、trace 完整，断言**最终盘上 timing 的 case 集合是重建结果**，且随后的 report-only 对账 PASS；另加接线锁「复用路径只回填一次」（全仓 `restoreFrozenRunArtifacts(` 调用恰 1 处） | 在 helper 里补回第二次 restore → 两例同时红 |
| medium #5 | dispatch 桩不能替代 §6 的生产边界验收：桩替换了真实 runner，编译日志/meta 哈希与 spawn 次数都没被观察 | `harness/tests/unit/ut-module-selection.unit.test.ts` 夹具重写：影子 provider 改为**记一笔再转导真实 provider**（真实 `hvigor-runner`/`hdc-runner` 全程在场），合成结果注入在 `child_process.spawnSync` 边界并**分桶计数**（genOnDeviceTestHap / hdc install / hdc shell aa test / 身份与就绪探针）；工程根放 `hvigorw` wrapper 使解析不依赖开发机 PATH；合成出包的 HAP 字节由该模块 ohosTest 源码内容决定 | V1 加「build 阶段 `genOnDeviceTestHap` 恰 2 次、test 阶段仍是 2 次（改前共 4 次）、`hvigor-ut-build.<module>.log/.meta.json` 哈希在 test 阶段后逐字不变、install/aaTest 各 2 次」；V4/V4b/V5/V6/V6b/V11① 的复用判据补「装机与执行 spawn 归零」；新增 **V3a**（`HARNESS_SKIP_HVIGOR=1`：build FAIL、`ut.run` dispatch 0、`genOnDeviceTestHap` 0、装机/执行 hdc 0、collector 空）与 **V11②**（改 ohosTest 源码 → 仍真的出一次包 → 新 HAP 摘要 → 整轮键变 → 真跑） | V1 的 spawn 次数与 meta 哈希断言是新增观察面；V3a/V11② 为本轮新增 |

**偏离与接受的边界**

1. **#2 的能力上界**：性能缺口只在「本轮重写**改变了**报告正文」时可见。同一份报告第二次跑 report-only 时正文已与 trace 一致，差异不复存在，缺口不会再被扣下。要更强的保护须把性能 case 的耗时来源做成独立事实（本批不新增 schema，见 D3「放弃的准确性（识别路径）」）。
2. **#4 的验收落在 `__testing_adoptFrozenRunArtifactsForReuse` 这个测试 seam 上**（与既有 `__testing_checkReportReconcileOnlyPipeline` 同款），而非跑完整 `checkDeviceTestRunGate`——后者需要真实 Hylyre 就绪与真机。调用点被「只回填一次」的接线锁守住。
3. **#5 的夹具仍不含真实 hvigor/hdc 二进制**：合成结果注入在进程调用边界，所以证明的是「harness 发了几次、发的是什么、产物有没有被覆盖」，不是「真实工具链的增量语义」。V11② 里「真实重新编译」的那一半仍留 B06。
4. **V4/V5① 的「改 HAP 字节」改为改编译输入（ohosTest 源码）**：新夹具每轮真的出包并按源码摘要写产物，手改盘上 HAP 会被下一轮出包原样重写、等于没改。判据不变（HAP 摘要变 → 整轮键变 → 真跑）。
5. `testing-trace-gates` 的 `runAll` 改为 `async`（run-unit 早已 `await mod.runAll()`），以便 V9 走完整 checker 的异步入口。

**验证**（日志在 `…/scratchpad/b03/fix1-*.log`）

| 命令 | 结果 |
|---|---|
| `npm --prefix harness run typecheck` | PASS |
| `--filter ut-module-selection` | 19 passed / 0 failed |
| `--filter hvigor` | 65 passed / 0 failed |
| `--filter hdc-runner` | 49 passed / 0 failed |
| `--filter execution-key` | 6 passed / 0 failed |
| `--filter testing-trace-gates` | 26 passed / 0 failed |
| `--filter efficiency-first-t2` | 10 passed / 0 failed |
| `--filter test-report-writer` | 4 passed / 0 failed |
| `--filter device-test-timings` | 3 passed / 0 failed |
| `npm run candidate:build` | **未跑**（另有一次在跑，按指令不重复触发） |

本轮未提交、未触碰宿主工程。§7 的其余命令（`check-plan-version` / `openspec:validate` / goal 三套件）本轮未改动其覆盖面，由调度者统一跑。

上一节「未做」的前两条本轮已补：**V3a 的显式计数**与 **V11② 中 spawn 边界能证明的那一半**（源码变 → 仍真的出一次包 → 键变 → 真跑）已各自成例；V11② 里「真实工具链的增量编译语义」仍留 B06。

### 2026-09-06：codex review 两轮收敛、候选件产出、本地验收完成（调度记录）

- plan review：第 1 轮 8 条（4 high / 4 medium）全采纳（首次修订代理虚报落盘，重派后逐条 grep 核实）；第 2 轮 6 resolved + 2 partial（对账消费者 null/—、失败记录前置）随实施落地。
- 实施 review：第 1 轮 3 high + 2 medium（用例失败被记 success、性能缺口晚于报告重建、记录覆盖非原子、重建 timing 被二次 restore 覆盖、dispatch 桩非生产边界）全修并附反证；第 2 轮 approve、无新 finding。全部只读审查（`codex exec`，gpt-6-astra/high），逐文件哈希核对工作树未被 review 改动。
- 最终 `candidate:build`（scratchpad b03/candidate-build-2.log）：typecheck 通过、unit 3864/3864、fixtures 46/46、consumer smoke 全段通过，`[candidate] BUILT`，zip sha256 `d6174d73319dffea209ebd4334893d1e69e061125ad35d2f464464bc990ee906`。
- 提交：分四笔（D1/D2 UT 出包与执行键 / D3 testing 对账分层 / D4 attended 提示块 / plan 与 OpenSpec），不带署名。
- `b03-local-acceptance` 置 completed（本地完成 = 本批完成，总 plan §5）；`b03-host-acceptance` 保持 pending，并入 B06 的 C-U 回归；节省量与 V11② 真实工具链语义在 B06 实测。

### 2026-09-09 宿主收尾

候选件 source_commit=453a4df6 已安装；正式包内 report-reconcile-only CLI exit 0，复用时间链误拒已消失。沿用 09-08 两次 UT 同键、逐模块结果/日志摘要相等的实证。证据见 .cursor/verification/3.0.0-golden-three-screen-20260909/report-only-installed.json。额外破坏 trace 的隔离 FAIL 支依原 F③ 为非必需，保留未执行披露；不再为该支阻塞 host todo。
