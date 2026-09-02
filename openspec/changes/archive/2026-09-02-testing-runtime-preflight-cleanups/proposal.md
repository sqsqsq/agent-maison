## Why

a6c4e9f2 的宿主回灌（SimulatedWalletForHmos / bc-openCard-1 / run `20260901T173347Z-253`）把 selector、执行通道与 Step Outcome 主链跑通之后，剩下三处不属于该 plan 任一 todo、也不属于 provider per-TC 绑定（e7cecd22）的 Maison 运行前缺口：

- 宿主顶层 test-plan 自拟 `provider:device-test.perf-probe` / `provider:device-test.gesture-trace`，capability registry 从未登记；`execution-channel.ts` 只验 id 字面格式，通道声明门 PASS，7 条 P0 跑完真机才被 channel evidence obligation 判"永远不可能通过"。声明门把"编译期分派"做成了"编译期放行"。
- 派生计划的 STEP-003 全禁 `start_app`，来由是"harness 已 aa start 预启、勿重复"，不是设计原则；NAV-002/003 本就把 `start_app`/`stop_app` 当复位步，机器键表与 Hylyre 分派都支持二者。单会话不清栈，前序 case 进子页后后续 case 前置状态失真，而作者没有任何合法手段复位。
- bm dump 在部分 HarmonyOS 上把 versionCode 误报为 0；`detectInstallDowngrade` 与 install 的 `versionAllowsReuse` 各自特判 0，但解析边界仍把 0 当合法整数放行，diag JSON 与 install 日志把 0 当确定值输出。

三项各自只做最小改动；plan 见 `.cursor/plans/Maison优化项_能力查表与视口口径与case复位_b3d7e5a1.plan.md`（T2/T3/T4）。报告模板"合计"占位规则（plan E）已在 `2026-09-02-testing-stepresult-evidence-consumption` tasks 6.7c 完成，不在本 change。

## What Changes

- `provider:<capability-id>` 在通道声明解析时做一次 registry **存在性** lookup：双方经 `normalizeCapabilityKey` 归一后精确字符串相等才算已登记，不做分隔符/大小写/相似度归一；未知 id 使声明 `ok=false` → `testing_execution_channel` plan_contract BLOCKER、零设备动作、detail 列出已登记键清单（空清单明示）；report-only 仍完整只读重算；`parseExecutionChannel` 保持纯词法；severity=SKIP 的已登记能力视为存在。不新增 provider 机制、执行账本或模块注册。
- STEP-003 由"全禁 start_app"收窄为"仅允许 case 首部连续的 `stop_app(bundle) → start_app(bundle, page_name)` 复位前奏"：`start_app` 必须紧跟 `stop_app`，身份必须等于 harness 预启同源身份并由 check-testing 注入 lint 与派生知识；中段出现、无 stop 直接 start、身份缺失/不一致均 BLOCKER；`clear_app` 不在本 change 内；即席路径继续全禁；runner 级预启与 cold restart 不变。同步 device-testing SKILL、workflow-detail 4.5.3、planned-step 字段参考、profile addendum 措辞。
- `parseInstalledBundleVersionFromDump` 在解析边界把 versionCode=0 归为 `versionCode:null` + `versionCodeUnknownReason:'parsed_zero'`（`installed` 仍按原始文本判定）；随后删除 `detectInstallDowngrade` 的 `> 0` 子句与 `versionAllowsReuse` 的 0 特判；diag JSON/日志把该情形输出为 unknown。行为不变，只是不再把 0 当确定值。

三项均非 BREAKING：合规计划与正常 versionCode 的行为逐字不变；自拟 provider id 的计划本来就不可能 PASS，只是失败点从跑完真机提前到计划期。

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `harness-gates`: 新增两条需求——provider 通道 id 的计划期 registry 存在性；Hylyre case 首部受限 `stop_app→start_app` 复位前奏。versionCode=0 归一是实施任务，不改契约文本。

## Impact

- 生产实现：`harness/scripts/utils/execution-channel.ts`、`harness/scripts/check-testing.ts`（`loadExecutionChannelDeclaration` 唯一注入点、`collectDeviceTestStaticPlanGates` 注入 reset 身份）、`harness/scripts/utils/derived-hylyre-plan.ts`（STEP-003）、`harness/scripts/utils/hylyre-standard-derive-knowledge.ts`（`reset_preamble` 知识块）、`profiles/hmos-app/harness/hdc-runner.ts`、`profiles/hmos-app/harness/device-install-diag.ts`、`profiles/hmos-app/harness/providers/device-test-install.ts`。
- 文档：`skills/feature/device-testing/SKILL.md`、`skills/reference/device-testing-workflow-detail.md`、`profiles/hmos-app/skills/device-testing/reference/hylyre-planned-step-fields.md`、`profiles/hmos-app/skills/device-testing/profile-addendum.md`。
- 回归：`execution-channel`、`derived-hylyre-plan`、`hylyre-keyset-consistency`、`hylyre-planned-step-lint`、`hdc-runner`/install diag 单测；一次最终 harness 全量。
- 不含：provider per-TC 结果绑定（e7cecd22）、perf/FPS/内存能力设计、`clear_app` 放行、屏幕状态机/可达性图、Hylyre 协议或 contracts 改动、宿主/真机操作。宿主条件验证由用户触发。
