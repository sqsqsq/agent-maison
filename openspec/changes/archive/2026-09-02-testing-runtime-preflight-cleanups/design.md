## Context

三项缺口都在"设备动作之前"的准入面，且都有现成的落点：通道声明门已经在 build/install/device 之前解析一次；STEP lint 已经逐步扫描根键；bm dump 解析器已经是 versionCode 的唯一入口。本 change 不新建机制，只把判据放到正确的位置。

- A：`execution-channel.ts:33` 注释自称"与既有 capability registry 同形"却从不查表。registry 就是 profile.yaml `capabilities:` 解析后的 `ctx.resolvedProfile.capabilities`，键经 `normalizeCapabilityKey`（只有一条显式 alias）。
- C：`derived-hylyre-plan.ts:489-496` STEP-003 的消息原文是"harness 已 aa start 预启；步骤列勿重复 start_app"；同文件 NAV-002/003 已把 `start_app`/`stop_app` 列为复位步；`hylyre-planned-step-keys.ts` 允许二者；Hylyre `step_dispatch.py` 分派二者，`agent.py` 要求 `bundle`、`start_app` 可带 `page_name`；`docs/vendor/hylyre-0.5.1-CLI选项穿透与静默忽略根治需求.md` §五已冻结"Maison 先用既有 stop_app/start_app 做受限 reset，不新增 teardown 状态机"。
- D：`hdc-runner.ts:938-946` 用 `\d+` 解析 versionCode，0 被当合法值；`device-install-diag.ts:31-41` 与 `device-test-install.ts:243-250` 各自特判 0。

## Goals / Non-Goals

**Goals**

- 未登记的 provider id 在计划期以 plan_contract BLOCKER 停下，零设备动作，detail 可对着已登记键清单改。
- 派生计划有且只有一种合法复位手段：case 首部 `stop_app→start_app`，身份与 harness 预启同源。
- versionCode=0 在解析边界归 unknown，两处调用方特判随之删除。
- 合规计划、无 provider 通道、正常 versionCode 的 feature 行为逐字不变。

**Non-Goals**

- 不做 provider per-TC 结果绑定、provider 结果 schema、registry 扩为执行账本。
- 不放行 `clear_app`；不做 case 开头堆 `back`、屏幕状态机、可达性图、Hylyre teardown 状态机。
- 不改即席（adhoc）的 start_app 禁令，不改 runner 预启/冷重启链路。
- 不改 Hylyre 协议、trace schema、contracts。
- 不操作宿主、不发起真机 smoke。

## Decisions

1. **A 的匹配语义是精确相等。** 双方都经 `normalizeCapabilityKey`（显式 alias 表）归一后逐字符相等；不做连字符/下划线/点互换、大小写、前缀或相似度匹配。harness 不按名字猜能力，与"不按用例名、优先级、步骤散文猜通道"是同一条纪律。宿主的 `device-test.perf-probe` 即便将来登记成 `device_test.perf_probe` 也对不上，这是有意的。
2. **A 的落点是 `evaluateExecutionChannelDeclaration(planMd, opts?)`，注入点是 `loadExecutionChannelDeclaration`。** 纯函数增 `registeredCapabilityIds` 可选集合与 `unknown_provider[]` 结果字段，未知 id 并入 `ok=false`，这样 `shouldRunDevicePipeline` 与所有既有调用方自动得到零设备动作；`parseExecutionChannel` 不读 profile。省略 opts 时结果逐字不变。detail 附已登记键清单（normalize 后、字典序；空清单明示"当前 profile 未登记任何 capability"）——清单来源就是注入的集合，零新数据。
3. **A 只回答"存在"。** severity=SKIP 的已登记能力视为存在；可用性、缺 provider、capability gap 继续归 capability-resolution 与 channel evidence obligation，不重叠。
4. **C 的合法形态唯一且严格。** `stop_app(B)` 紧跟 `start_app(B,P)`，只在 case 首部；`start_app` 不得单独出现；B/P 由 check-testing 从 `loadAppInstallCandidateMeta().bundleName` 与 `resolveHylyreToolConfig().hypium_page_name || discoverEntryMainElement()` 解析后经 `LintHylyrePlanOptions.resetIdentity` 注入，派生知识块 `reset_preamble` 同源注入；身份不可解析时前奏 BLOCKER，而不是放行。运行时 Maison 预启成功后已省略 `--bundle`，planned `start_app` 根键自带 bundle，与 runner 级 `--bundle` 独立，不冲突。
5. **C 删除 `clear_app`。** 它清产品数据、权限与状态，不属于导航复位；将来确有需求须由顶层测试计划显式授权，本 change 不改它现有的 lint 处境。
6. **C 与既有规则的关系。** NAV-002/003 已视前奏为复位步，不改；STEP-SETUP 把前奏算作首个 assertion 前的 action——冷启后断言入口屏是合法 setup，接受并记录；STEP-004（`action` 包装 `start_app`）维持 BLOCKER；即席 `forbidStartApp:true` 与 `hylyre-planned-step-lint.ts` STEP-002 继续全禁。
7. **D 在解析边界归一。** `parseInstalledBundleVersionFromDump` 把 0 归为 `versionCode:null` + `versionCodeUnknownReason:'parsed_zero'`，`installed` 仍按原始文本判定（0 不能把已安装变成未安装，也不能当降级）。随后 `detectInstallDowngrade` 的 `> 0` 与 `versionAllowsReuse` 的 0 分支成为死代码，删除；diag JSON `deviceVersionCode=null`，details/日志写 `(未解析：bm dump 报 0，按 unknown)`。

## Risks / Trade-offs

- [Risk] A 让此前"能跑到真机"的自拟 provider 计划提前在计划期停下。→ 这些计划本来就不可能 PASS；提前停下节省数小时真机时间，detail 直接给出可改的键清单。
- [Risk] C 放开 `start_app` 后派生 AI 可能到处加前奏。→ 只允许 case 首部、必须成对、身份同源、身份不可解析即 BLOCKER；知识块只教这一种形态。
- [Risk] D 改解析器影响 UT/testing 两条安装链。→ 归一后 `devVc===null` 已被两处调用方的既有 null 分支覆盖，行为等价；单测钉 0→null+reason 且 installed=true。

## Migration

无消费者迁移。宿主若已有自拟 provider id 的顶层 test-plan，会在下一次 testing 的计划期收到 plan_contract BLOCKER 与已登记键清单，按清单改通道或登记能力即可。
