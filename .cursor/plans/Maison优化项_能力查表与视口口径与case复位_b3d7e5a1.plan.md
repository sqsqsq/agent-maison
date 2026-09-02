---
name: Maison 优化项 — provider 计划期查表、参考图视口尺寸前置门、受限 case 首部复位、versionCode=0 归一
version: 3.0.0
# 窗口说明：Br_release_3.0.0 在途 plan。来源是 a6c4e9f2 T8 宿主回灌（run 20260901T173347Z-253）
# 顺带暴露、但不属于 a6c4e9f2 任一 todo 的四项 Maison 缺口 + 一项报告模板占位规则。它们不阻断
# T8 收口，也不进 a6c4e9f2 返修；provider per-TC 绑定归 e7cecd22，本 plan 不碰；perf/FPS/内存
# 等新能力另行拍板。后续 OpenSpec change 待当前 change 归档后再建，避免与在途 execution-channel
# delta 并行重叠；除 E 已按 review 建议在当前 change 顺手完成外，plan 确认前不动生产代码。
#
# 2026-09-02 review 修订（两处阻断意见已吸收）：
#   C 删除 clear_app——它清产品数据/权限/状态，不是导航复位；将来确有需求须由顶层测试计划显式授权。
#   B 砍掉 reference_region、自动 crop resolver、crop hash 语义与下游改造，收窄为"参考图与 viewport
#   尺寸不兼容的前置门"；出路是作者建模：长页按锚点拆成多个 viewport 尺寸的 screen（各自 ref_id 裁图 + nav 末步 scroll_to 锚点；像素路径前提=每段 nav 从已知状态出发且落点已证明可重复，不属像素范围的段落排除在 pixel_1to1 屏外、由功能/结构 AC 覆盖，无屏级/段级档位）（2026-09-02 三轮修订，机制不动只改出路描述）。
#   E 改为必做，已在 testing-stepresult-evidence-consumption tasks 6.7c 完成，后续 change 不再包含。
#
# 2026-09-02 实证（宿主 SimulatedWalletForHmos / feature=bc-openCard-1）：
# [E1] 宿主顶层 test-plan 自拟 `provider:device-test.perf-probe` / `provider:device-test.gesture-trace`，
#   capability registry（profile.yaml `capabilities:` → ctx.resolvedProfile.capabilities）从未登记；
#   harness/scripts/utils/execution-channel.ts:32-54 只验 id 字面格式（注释 :33 自称"与既有 capability
#   registry 同形"），通道声明门 `testing_execution_channel` PASS，7 条 P0 跑完真机才被
#   testing_channel_evidence_obligation 判"永远不可能通过"。
# [E2] 宿主参考图 expanded（高 4350）/ all_banks（高 8312）对 2120 高视口。profiles/hmos-app/harness/
#   visual-diff-check.ts:1138 注释已承认"整页参考图 vs 单视口口径缺口"；visual-diff-ocr-gates.ts:372-382
#   用宽高比启发式（ref 高宽比 > 截图 ×1.15）判整页，:517-523 把纵向乱序整体降级 uncertain——
#   缺口被"注明"而不是被"前置拦下"，pixel_1to1 下像素口径静默变结构口径。
# [E3] harness/scripts/utils/derived-hylyre-plan.ts:489-496 STEP-003 话术是"harness 已 aa start 预启；
#   步骤列勿重复 start_app"，来由是避免重复预启，不是设计原则；同文件 NAV-002/003（:721/:739）本就把
#   back/home/start_app/stop_app 当复位步；机器键表 hylyre-planned-step-keys.ts:14-21 允许
#   stop_app/start_app；Hylyre vendor step_dispatch.py:21-28 分派二者，agent.py:853-861 / 1121-1131
#   要求 `bundle`、start_app 可带 `page_name`；docs/vendor/hylyre-0.5.1-CLI选项穿透与静默忽略根治需求.md:150
#   已写"Maison 侧先用既有 stop_app/start_app 做受限 reset"。当前派生计划 case 之间不清栈
#   （profile-addendum.md:114），前序 case 进子页后，后续 case 前置状态失真。
# [E4] profiles/hmos-app/harness/device-install-diag.ts:31-41 detectInstallDowngrade 用 `> 0` 排除 0；
#   providers/device-test-install.ts:243-250 versionAllowsReuse 再次特判 0 并注释"部分 HarmonyOS bm dump
#   误解析为 0"；但 hdc-runner.ts:938-946 解析边界把 0 当合法整数放行，diag JSON（device-install-diag.ts:
#   80-118 deviceVersionCode）与 install 日志（device-test-install.ts:308）把 0 当确定值输出。
# [E5] profiles/hmos-app/harness/device-test-timings.ts:199 写 `total_harness_ms` 恒为 null；harness/scripts/
#   utils/testing-trace-gates.ts:325 + compareReportDuration 要求 null 时报告"合计"行必须是 `—` 类占位；
#   模板 test-report-template.md:26/34 原本没有这句，报告作者会把各阶段相加填 `Nms`。（已修，见 6.7c）
#
# 简单原则冻结：A 只加一次 registry 存在性 lookup，不新增 provider 机制、不扩 registry 为执行账本；
# B 只做参考图/viewport 尺寸兼容性前置检查，不新增 reference_region、自动 crop、crop hash、多套参考真源、
# 自动分段或滚动拼接，不静默把 pixel_1to1 降成结构口径；C 只允许 case 首部 `stop_app → start_app`，
# 不含 clear_app、不做"堆 back 猜深度"、不向 Hylyre 要 teardown 状态机（备选）；D 只在解析边界把 0
# 归 unknown；E 只加一句占位规则。不恢复任何已否决方案（ui-spec/acceptance/contracts 白名单并集、
# 屏幕状态机/可达性图、runtime hash 家族、人签/receipt 载体）。
todos:
  - id: t1-archive-then-openspec
    content: T1 当前 change（testing-stepresult-evidence-consumption）经宿主 report-only → T8/5.2/6.8 → archive 之后，再创建两个后续 OpenSpec change 并 strict 通过：`testing-runtime-preflight-cleanups`（harness-gates ADDED：provider 通道 id 计划期 registry 存在性；Hylyre case 首部受限 `stop_app→start_app` 复位；D 作实施任务登记；E 已完成不含）与 `visual-reference-viewport-precheck`（visual-diff ADDED：参考图与 viewport 尺寸兼容性前置门，不含 reference_region/crop 系统）。不混进 framework-identity-boundary，不再拆更多 change。strict 通过前不动生产代码。
    status: completed
  - id: t2-provider-registry-lookup
    content: T2（A）`evaluateExecutionChannelDeclaration(planMd, opts?)` 增 `registeredCapabilityIds` 可选集合与 `unknown_provider[]` 结果字段，未知 id 并入 `ok=false`，detail 话术"该能力不存在（capability registry 未登记），此 TC 不可能通过"并列出当前 profile 已登记的 capability 键清单（normalize 后、字典序；空清单明示）；匹配 = 双方经 normalizeCapabilityKey 后精确相等，不做分隔符/大小写/相似度归一；`check-testing.ts:3703 loadExecutionChannelDeclaration` 唯一注入点传入 `ctx.resolvedProfile.capabilities` 键集（经 normalizeCapabilityKey），从而 `testing_execution_channel` BLOCKER（failure_kind=plan_contract）且 `shouldRunDevicePipeline` 零设备动作；report-only 仍完整只读重算。`parseExecutionChannel` 保持纯词法；severity=SKIP 的已登记能力视为"存在"（可用性归 capability-resolution）。回归：unknown/registered/alias/无 opts 四态 + 分隔符不同即 unknown（`provider:device_test.visual-diff` 对已登记 `device_test.visual_diff` → unknown，证明不做模糊匹配）+ detail 含已登记键清单（含空清单文案）+ 一条 check-testing 接线 + report-only 不被截断。
    status: completed
  - id: t3-versioncode-zero-unknown
    content: T3（D）在 `hdc-runner.ts parseInstalledBundleVersionFromDump` 解析边界把 versionCode=0 归为 `versionCode:null` 并带 `versionCodeUnknownReason:'parsed_zero'`，`installed` 仍按原始文本判定（0 不能把已安装变成未安装）；随后删除 `detectInstallDowngrade` 的 `> 0` 子句与 `versionAllowsReuse` 的 0 特判（已成死分支）；diag JSON/日志对该情形输出 `(未解析：bm dump 报 0，按 unknown)`，不再展示成确定版本。回归：解析器 0→null+reason 且 installed=true、diag kind=clear 且 deviceVersionCode=null 且 downgradeDetected=false、正常正整数行为不变。
    status: completed
  - id: t4-case-leading-reset
    content: T4（C）STEP-003 由"全禁 start_app"收窄为"仅禁 case 中段"：合法前奏只有 case 首部连续的 `stop_app(bundle) → start_app(bundle, page_name)`，`start_app` 必须紧跟 `stop_app`，`bundle`/`page_name` 必须等于 harness 预启同源身份（`loadAppInstallCandidateMeta().bundleName`、`resolveHylyreToolConfig().hypium_page_name || discoverEntryMainElement()`），由 check-testing 经 `LintHylyrePlanOptions.resetIdentity` 注入，身份不可解析时前奏步骤 BLOCKER；中段出现 lifecycle 步骤、无 stop 直接 start、身份缺失/不一致均 BLOCKER；`clear_app` 不在本 plan 内（仍按现状 STEP 规则处理，派生 AI 不得自行加入）；`forbidStartApp:true` 保留为即席全禁；runner 级预启与 cold restart 不变。派生知识 `buildStandardHylyreDeriveKnowledge(reset?)` 新增 `reset_preamble` 块并把 stop_app/start_app 移回 allowed；STEP-004（action 包装 start_app）维持 BLOCKER。同步 SKILL.md:63、workflow-detail 4.5.3 与 :45、hylyre-planned-step-fields.md:10、profile-addendum.md:114 措辞。回归：首部合法前奏 0 违规、无 stop 直接 start BLOCKER、中段 BLOCKER、bundle/page_name 不一致 BLOCKER、即席全禁、不含 reset 的计划行为不变、NAV-002/003 与 STEP-SETUP 对前奏的既有语义不变、keyset-consistency 知识块断言更新。
    status: completed
  - id: t5-reference-viewport-precheck
    content: T5（B）只做尺寸兼容性前置门：复用 `readImageDimensions` 与 `resolveRefSourceImage`，在现有 visual 检查入口（spec：`checkFidelitySnapshotPromise` 旁、viewport 取 fidelity-lock `viewport`；testing：`visual-diff-check.ts checkVisualDiffCore` 内容比对之前、viewport 取实测截图尺寸）比较参考图与 viewport 高宽比，沿用 ocr-gates 的 ×1.15 阈值迁为共享常量；明显不兼容时 pixel_1to1 → `visual_reference_viewport` FAIL（责任 spec 参考资产），低档位按既有 `fidelityRatchetFailOrWarn` WARN/SKIP，且该屏不得再用原始长图产出 pixel/OCR 内容结论（从内容比对输入集合剔除并点名）；指引作者建模出路——长页按锚点拆成多个 viewport 尺寸的 screen（各自 ref_id 裁图 + nav 末步 scroll_to 锚点；像素路径前提=每段 nav 从已知状态出发且落点已证明可重复，不属像素范围的段落排除在 pixel_1to1 屏外、由功能/结构 AC 覆盖，无屏级/段级档位），每屏参考图兼容后现有 pipeline 原样运行。不新增 reference_region、自动 crop resolver、派生 crop 文件、crop hash 语义、分段、滚动拼接、多套参考真源或下游批量改造；ocr-gates 既有整页 uncertain 分支保留为防御性诊断，不删。回归：1320×4350 与 1320×8312 对 1320×2120 在 pixel_1to1 明确 FAIL、1320×2120 对 1320×2120 行为不变、长页拆成多个 viewport 尺寸 screen（各自 ref_id + scroll_to 锚点）后正常进入原 visual diff、低档位按既有 ratchet 不静默升级为像素 PASS、lock 无 viewport 时 spec WARN 推迟到 testing。
    status: completed
  - id: t6-report-total-placeholder
    content: T6（E，必做）模板一句"`pipeline.total_harness_ms` 为 null 时合计填 `—`，不得自行加总各阶段"+ trace-gates 钉子（加总值被判「应为无数据占位」、`—` 通过）。已于 2026-09-02 按 review 建议在当前 change 顺手完成（tasks 6.7c），不改 writer、不算新总时长、不增字段；后续 change 不再包含。
    status: completed
  - id: t7-regression-and-closeout
    content: T7 每项定向回归 + 一次最终 harness 全量单测 + typecheck + `openspec:validate` strict + `release:check-plans` + LF/`git diff --check`；B/C 的宿主验证列为条件项（用户触发，不由实施代理发起）：B 期望宿主 expanded/all_banks 在 pixel_1to1 下被点名 FAIL，按锚点拆成多个 viewport 尺寸 screen 后进入原比对（须至少两个冷启动轮次的中/尾 checkpoint 落点一致，否则如实记为当前限制）；C 期望重新派生的计划以 stop_app→start_app 开头的 case 在真机冷启后前置成立。没有环境时如实记录"条件未验"，不阻塞 Maison 本地逻辑验收；全部完成并过独立 review 后置 completed。
    status: completed
overview: >
  a6c4e9f2 宿主回灌把 selector/通道/Step Outcome 主链跑通后，剩下四处不属于该 plan 任一 todo 的
  Maison 缺口：provider 通道 id 只验格式不查 registry，让不存在的能力跑完真机才被判死；整页参考图
  对单视口的口径缺口被注释与 uncertain 降级"注明"而非前置拦下；派生计划因"勿重复预启"的旧话术全禁
  start_app，导致 case 之间无法复位而前置失真；bm dump 误报 versionCode=0 在两处被特判却在解析边界
  当确定值输出。四项各自只做最小改动：一次 registry lookup、一个尺寸兼容性前置门、一条收窄到
  `stop_app→start_app` 的 STEP-003 加同源身份注入、一处解析边界归一；报告模板一句占位规则已在当前
  change 顺手完成。后续两个 OpenSpec change 待当前 change 归档后再建。
---

# Maison 优化项：provider 计划期查表、参考图视口尺寸前置门、受限 case 首部复位、versionCode=0 归一（b3d7e5a1）

状态：**已收口（2026-09-02）——T1–T7 completed；codex 七轮 review 无残留；两个 OpenSpec change 已归档；宿主条件项（B 长图点名 + 两冷启动落点一致、C 真机复位）如实记"条件未验"，由用户触发时按 tasks 5.3/3.3 核对。**

关联资产：

- 上游 plan：[testing回灌纠偏_入口可达性与首失败归因收口_a6c4e9f2](./testing回灌纠偏_入口可达性与首失败归因收口_a6c4e9f2.plan.md)（T8 宿主回灌是本 plan 全部实证的来源；本 plan 不承接其任何 todo）
- 邻接 plan：[provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22](./provider通道per-TC机器证据绑定_当前run身份与证据闭环_e7cecd22.plan.md)（provider per-TC 证据绑定归它；本 plan 的 A 只管"计划期 id 是否存在"）
- 当前 change：[testing-stepresult-evidence-consumption](../../openspec/changes/testing-stepresult-evidence-consumption/)（E 已以 tasks 6.7c 落在其中；本 plan 不修改其 delta；A/C 待其归档后以新 change 的 ADDED requirement 落位）
- Hylyre 外部需求：[hylyre-0.5.1-CLI选项穿透与静默忽略根治需求.md](../../docs/vendor/hylyre-0.5.1-CLI选项穿透与静默忽略根治需求.md)（§五已冻结"不新增 case-level teardown 状态机；Maison 先用既有 stop_app/start_app 做受限 reset"）

---

## 零、决策纪要（2026-09-02，含 review 修订）

### D1 A：provider id 的"存在"在计划期回答，"可用"仍归 capability-resolution

- `execution-channel.ts` 的 `PROVIDER_ID_RE` 只是词法；注释自称"与既有 capability registry 同形"却从不查表，是本版把"编译期分派"做成了"编译期放行"。
- 决策：通道声明门增加一次 registry **存在性** lookup。查的是 `ctx.resolvedProfile.capabilities` 的键集（profile.yaml `capabilities:` 经 `normalizeCapabilityKey`），不是 capability-resolution 的 contract capability 列表，也不是 provider 模块表——后两者回答"能不能调用"，不是"有没有这个名字"。
- 未知 id 是 **plan contract** 缺陷：`testing_execution_channel` BLOCKER，`decl.ok=false` 使 `shouldRunDevicePipeline` 零设备动作；report-only 按既有契约仍完整只读重算，不被提前截断。
- 匹配语义冻结：`provider:<id>` 的 id 与 registry 键都经 `normalizeCapabilityKey`（只走显式 alias 表）归一后**精确字符串相等**才算已登记。不做连字符/下划线/点的互换归一，不做大小写、前缀或相似度匹配——harness 不按名字猜能力，与"不按用例名、优先级、步骤散文猜通道"是同一条纪律。宿主自拟的 `device-test.perf-probe` 即便将来登记成 `device_test.perf_probe` 也对不上，这是有意的。
- 话术冻结："`TC-xxx` 的 execution_channel=provider:`<id>`：该能力不存在（capability registry 未登记），此 TC 不可能通过。请改通道（hylyre/visual/manual）或先在 profile capabilities 登记该能力并提供 provider；harness 不按名字猜能力。当前 profile 已登记的 capability 键（normalize 后、字典序）：<list>。"若清单为空则明示"当前 profile 未登记任何 capability"。理由：作者拿到 BLOCKER 得能对着清单改拼写或改通道，否则只是换了个地方猜；清单来源就是 T2 注入的 `registeredCapabilityIds`，零新数据。
- `severity: SKIP` 的已登记能力视为"存在"：存在≠可用，可用性/缺 provider 继续走 capability-resolution 与既有 capability gap，本 plan 不重叠。
- 否决：把 provider id 校验做进 `parseExecutionChannel`（纯词法函数不该持有 profile）；在 execution-channel-evidence 里报（那已经是跑完真机之后）；新增 provider schema、执行账本或模块注册机制。

### D2 B：只做尺寸兼容性前置门，不建区域/裁图体系（review 修订）

- 真实需求只有一句：**不允许把 4350/8312 高的长参考图，作为 2120 高单视口截图的直接像素参考。**
- 初版设计的 `reference_region` + 自动 crop resolver + crop hash 语义 + 两处下游改造，是为一个"提供正确尺寸的参考图"这种作者侧动作造了一套机器体系；review 否决，砍掉。
- 决策：在现有 visual 检查入口比较参考图与 viewport 的高宽比（沿用 ocr-gates 的 ×1.15 阈值，迁为共享常量）。明显不兼容时：pixel_1to1 → FAIL，责任归 spec 参考资产；低档位按既有 `fidelityRatchetFailOrWarn` WARN/SKIP，不静默升级为像素 PASS。不兼容后该屏不得继续用原始长图产出 pixel/OCR 内容结论。
- 出路由作者建模而非机器推导（三轮修订：原"换一张 viewport-sized 图"的表述会让长页作者以为不支持）：长页按锚点拆成多个 screen，每段一个 viewport 尺寸的 `ref_id` 裁图，`visual-diff-nav.json` 中该段 nav 末步 `scroll_to` 锚点元素（nav 校验复用 planned-step 全键表，`scroll_to` 本就合法）；锚点选对齐确定的元素（如列表项）。像素路径的前提：每段 nav 从已知状态出发，且滚动落点已证明可重复（宿主至少两个冷启动轮次的中/尾 checkpoint 落点一致；`scroll_to` 目标已可见即返回、否则固定向上滚，本身不对齐坐标）；无法证明的段落不放 pixel_1to1 屏，继续 FAIL 而不宣称支持。不属于像素验收范围的段落须明确排除在 pixel_1to1 屏之外、由需求/spec 的功能或结构 AC 覆盖——`UiSpecScreen` 没有屏级 fidelity，所有门读 run 级 `ctx.fidelityTarget`，不存在"段落降档"。每屏参考图兼容后现有 pipeline 原样运行，没有第二套参考真源。
- viewport 来源：spec 阶段用 fidelity-lock `viewport{w,h,dpr}`（`fidelity-lock-shared.ts:43`），未声明则 WARN 明示推迟到 testing；testing 阶段用实测截图尺寸（`readImageDimensions`）。两阶段共用同一判据函数。
- 既有整页 uncertain 分支（ocr-gates.ts:517-523）保留为防御性诊断：严格路径由前置门先拦，不为缩小一段旧代码扩大 diff。
- 否决：`screens[].reference_region`、`reference-viewport.ts` 自动 crop resolver、派生 crop 文件与新 hash 语义、自动分段、滚动拼接、多套 reference 真源、下游消费者批量改造、按参考图尺寸自动改写 viewport。

### D3 C：STEP-003 的禁令来自"勿重复预启"，收窄为"禁 case 中段"；不含 clear_app（review 修订）

- 证据链：STEP-003 消息原文、NAV-002/003 已把 start_app/stop_app 当复位步、机器键表允许、Hylyre 分派支持、0.5.1 需求文已冻结"Maison 侧先用既有 stop_app/start_app 做受限 reset"。禁令是历史实现细节，不是契约。
- 决策：允许且只允许 **case 首部连续复位前奏** `stop_app(bundle) → start_app(bundle, page_name)`，`start_app` 必须紧跟 `stop_app`，两者身份必须等于 harness 预启同源身份（同一份 `loadAppInstallCandidateMeta` / `resolveHylyreToolConfig().hypium_page_name || discoverEntryMainElement`）。中段出现、无 stop 直接 start、身份缺失或不等 → STEP-003 BLOCKER。身份由 check-testing 解析后注入 lint（`resetIdentity`），派生知识块同源注入（`reset_preamble`），派生 AI 不自拟 bundle。
- **`clear_app` 从本 plan 完全删除**：它清产品数据、权限与状态，不属于导航复位；将来确有需求时必须由顶层测试计划显式授权，不允许派生 AI 自行加入。本 plan 不改变它现有的 lint 处境。
- 与既有规则的关系：NAV-002/003 已把前奏视为复位步，不改；STEP-SETUP（首个 assertion 前须有同 case action）把前奏算作 action——冷启后断言入口屏是合法的 setup，接受并记录，不为它另开豁免；不新增 screen state graph，不扩 failure routing。
- 即席（adhoc）不变：harness 冷重启负责复位，`forbidStartApp:true` 与 `hylyre-planned-step-lint.ts` STEP-002 继续全禁；runner 级预启与 cold restart 行为不变。
- 否决：case 开头堆 `back` 猜栈深度；向 Hylyre 提 case-level teardown 状态机（记为备选：若受限 reset 覆盖不了数据态/多进程场景再另提需求）。

### D4 D：在解析边界归一，让两处特判成为死代码后删除

- 用户给的锚点是 `device-install-diag.ts:38`；但 0 被两处各自特判（diag 的 `> 0`、install 的 `versionAllowsReuse`）而解析边界仍放行，是典型"每个调用方各补一刀"。
- 决策：`parseInstalledBundleVersionFromDump` 把 0 归为 `versionCode:null` + `versionCodeUnknownReason:'parsed_zero'`，`installed` 仍按原始文本判定（0 不能把已安装变成未安装，也不能当降级）。随后 `detectInstallDowngrade` 的 `> 0` 与 `versionAllowsReuse` 的 0 分支删除；diag JSON/日志输出 `(未解析：bm dump 报 0，按 unknown)`，不再展示成确定版本。正常正整数行为不变；不新增状态机或安装策略。

### D5 E：必做，已完成

- writer 恒写 null、对账要求占位、模板不说——三者一致指向"合计填 `—`"。review 定为必做并建议归档前顺手完成：已在当前 change 以 tasks 6.7c 落地（模板一句 + trace-gates 钉子），不改 writer、不算合计、不增字段。

## 一、问题边界与定性

| 项 | 现象 | 定性 | 归属 |
|---|---|---|---|
| A | 自拟 provider id 通过声明门，跑完真机才判永不可能通过 | 计划期缺一次存在性查表（编译期放行） | Maison 通道声明门 |
| B | 整页参考图对单视口比对，缺口以注释与 uncertain 降级表达 | 缺尺寸兼容性前置门 | Maison visual（spec/testing 两阶段） |
| C | 派生计划全禁 start_app，case 之间无法复位，前置失真 | 历史话术被当契约 | Maison 派生 lint/知识块/文档 |
| D | versionCode=0 被两处特判但在边界当确定值输出 | 归一位置错 | Maison 设备安装诊断（UT/testing 共用） |
| E | 报告"合计"行被作者加总，对账判占位错误 | 模板缺一句（已修） | 报告模板 |

不属于本 plan：provider per-TC 证据绑定（e7cecd22）、perf/FPS/内存能力设计、Hylyre 协议/contracts 任何改动、a6c4e9f2 T8 收口本身、`clear_app` 的任何放行。

## 二、目标模型

### 2.1 A：一次 lookup 的落点

```text
top test-plan.md ──► extractExecutionChannels ──► evaluateExecutionChannelDeclaration(planMd, { registeredCapabilityIds })
                                                       │  unknown_provider[] ≠ ∅ → ok=false
check-testing.ts:3703 loadExecutionChannelDeclaration(ctx, planRaw)   ← 唯一注入点：
   registeredCapabilityIds = new Set(Object.keys(ctx.resolvedProfile.capabilities).map(normalizeCapabilityKey))
   provider_id 同样经 normalizeCapabilityKey 后再查；匹配 = 精确字符串相等（不做分隔符/大小写/相似度归一）
   detail 附当前 profile 已登记键清单（normalize 后、字典序；空清单明示）
checkExecutionChannelDeclaration → testing_execution_channel BLOCKER（failure_kind=plan_contract）
shouldRunDevicePipeline(decl.ok=false) → 零 build/install/Hylyre/device；report-only 仍完整只读重算
```

- `opts` 省略时行为逐字不变（既有纯函数单测与 legacy 调用不受影响）。
- 不在 `parseExecutionChannel` 里查表，不改 `PROVIDER_ID_RE`，不新增 registry 字段。

### 2.2 B：尺寸兼容性前置门

```text
共享判据（迁 ocr-gates ×1.15 阈值为常量）：
  refDims = readImageDimensions(resolveRefSourceImage(refIndex, screen.ref_id ?? screen.id).path)
  viewport = spec: fidelity-lock.viewport ｜ testing: readImageDimensions(本屏截图)
  incompatible = refH/refW > (viewportH/viewportW) × 1.15
spec（checkFidelitySnapshotPromise 旁，check id visual_reference_viewport）：
  lock 有 viewport → 逐屏判；incompatible 且 pixel_1to1 → FAIL；低档 → fidelityRatchetFailOrWarn
  lock 无 viewport → WARN"viewport 未声明，尺寸校验推迟到 testing 实测"（不 PASS-by-silence）
testing（visual-diff-check.ts checkVisualDiffCore，在任何内容比对之前）：
  incompatible 屏 → visual_reference_viewport FAIL（pixel_1to1）/ ratchet（低档），点名屏与尺寸
  该屏从后续 pixel/OCR 内容比对的输入集合剔除（不得用原始长图产出内容结论）
出路（作者建模）：长页按锚点拆成多个 screen → 每段 viewport 尺寸的 ref_id 裁图 + visual-diff-nav.json 该段 nav 末步 scroll_to 锚点 → 不属像素范围的段落排除在 pixel_1to1 屏外（功能/结构 AC 覆盖）；落点未证可重复的段落继续 FAIL → 每屏兼容后 pipeline 原样运行
```

- 不新增 ui-spec 字段、不新增 resolver、不产派生文件、不改任何 hash 语义、不改 visual-diff-capture 的参考图解析。
- 责任归 spec（参考资产口径），不路由 coding，不 defer（这不是能力缺失），不落 uncertain。

### 2.3 C：受限复位前奏

```text
合法：[{"stop_app":{"bundle":B}}, {"start_app":{"bundle":B,"page_name":P}}, ...业务步骤]
       前奏连续、紧贴 case 开头；start_app 紧跟 stop_app；B/P == harness 预启同源身份（resetIdentity）
非法：中段任意位置出现 start_app/stop_app；无 stop_app 直接 start_app；缺/错 bundle 或 page_name；resetIdentity 不可解析
即席：forbidStartApp:true → 一律 BLOCKER（不变）
clear_app：不在本 plan 内，维持现状处理；派生 AI 不得自行加入
```

- lint：`lintHylyrePlanStepRules(md, { forbidStartApp?, resetIdentity? })`；默认（正式路径）为 preamble-only；check-testing.ts:3738 注入 `resetIdentity`。
- 知识块：`buildStandardHylyreDeriveKnowledge(reset?)` 新增 `reset_preamble:{ position:'case_head_only', order:['stop_app','start_app'], bundle, page_name, example }`，`allowed_step_roots` 含 stop_app/start_app，`forbidden_in_steps` 只剩 CLI 名；两入口（derive-hylyre-plan-hint.ts、check-testing 自动 hint）同源解析身份。
- 运行时：Maison 预启成功后省略 `--bundle`（device-test-run.ts `omitBundleForHylyre`），planned `start_app` 根键自带 bundle（agent.py:1203 明示与 runner 级 `--bundle` 独立），不冲突；start_app 的 StepResult 形态已有 golden（`passed-action-start-app.json`），P0 绑定只认 touch/input/swipe/scroll，不受影响。
- 文档四处：SKILL.md:63（"禁 start_app/dump_ui 根键" → "start_app/stop_app 仅限 case 首部复位前奏，禁 dump_ui 等 CLI 名"）、workflow-detail 4.5.3（:25）与失败表（:45）、hylyre-planned-step-fields.md:10、profile-addendum.md:114（执行模型补"需要复位的 case 在首部写 stop_app→start_app"）。

### 2.4 D：解析边界归一

```text
parseInstalledBundleVersionFromDump(text)
  raw versionCode 解析 → installed 判定（按原始文本，不变）
  versionCode === 0 → { versionCode: null, versionCodeUnknownReason: 'parsed_zero' }
detectInstallDowngrade：删 `installed.versionCode > 0`（null 已短路）
versionAllowsReuse：删 `(devVc === 0 && candVc > 0)` 分支（devVc===null 已覆盖）
diag JSON deviceVersionCode=null；details/日志：`(未解析：bm dump 报 0，按 unknown)`
```

### 2.5 E：已完成

`test-report-template.md:26-27` 已补："合计行按 `pipeline.total_harness_ms` 填写；为 `null`（当前 writer 恒为 null）时填 `—`，不得自行把各阶段相加。" trace-gates 单测钉住加总值被判「应为无数据占位」、`—` 通过。

## 三、实施批次

### T1 当前 change 归档后再建两个 change

```text
宿主 report-only（用户触发）→ T8 / 5.2 / 6.8 完成 → archive testing-stepresult-evidence-consumption
→ 新建 testing-runtime-preflight-cleanups（A / C / D；harness-gates ADDED ×2）
→ 新建 visual-reference-viewport-precheck（B；visual-diff ADDED ×1）
→ 两者 strict 通过后才动生产代码
```

- 不写成 MODIFIED：被改语义的通道/编译需求此刻仍在在途 change 的 delta 内。
- Enforcement 路径按 `check-openspec-enforcement-paths.mjs` 可解析：execution-channel.ts、check-testing.ts、derived-hylyre-plan.ts、hylyre-standard-derive-knowledge.ts、hdc-runner.ts、visual-diff-check.ts、fidelity-snapshot-check.ts。

### T2（A）+ T3（D）——便宜且互不依赖，先落

- A：`execution-channel.ts` 增 opts 与 `unknown_provider`；`check-testing.ts:3703` 注入键集；`execution-channel.unit.test.ts` 四态 + check-testing 接线一条（通过既有 `__testing_` 导出风格暴露 `checkExecutionChannelDeclaration`）+ report-only 不被截断。
- D：`hdc-runner.ts` 解析归一；删两处特判；`hdc-runner.unit.test.ts` 与 diag 单测各一条。

### T4（C）

- lint 收窄、身份注入、知识块、adhoc 不变、文档四处；更新 `derived-hylyre-plan.unit.test.ts:243-252`（TC-004 `{"start_app":{}}` 仍 BLOCKER——无 stop_app 且缺 bundle/page_name；新增首部合法前奏 0 违规、无 stop 直接 start BLOCKER、中段 BLOCKER、身份不等 BLOCKER、即席全禁）与 `hylyre-keyset-consistency.unit.test.ts:170-183`（知识块 allowed 含 stop_app/start_app、forbidden 只剩 CLI 名、含 `reset_preamble`）。

### T5（B）

- 共享判据常量 + spec 检查 + testing 内容比对前的剔除与 FAIL；单测用 jimp 生成尺寸已知的合成 PNG（不可用时 SKIP，与既有图像测试同款）；不删 ocr-gates 旧分支。

### T6（E）

- 已完成（当前 change tasks 6.7c）。

### T7 回归与收口

- 定向：execution-channel、hdc-runner、device-install-diag、derived-hylyre-plan、hylyre-keyset-consistency、visual-diff-*、fidelity-snapshot、testing-trace-gates。
- 一次最终全量：`npm --prefix harness run test`（typecheck + unit + fixtures）、`npm run openspec:validate`、`npm run release:check-plans`、LF/`git diff --check`。
- 宿主条件项（用户触发）：见 §四 9/10。

## 四、验收场景

1. **A 未知 id 计划期 BLOCKER**：plan 声明 `provider:device-test.perf-probe`，hmos-app profile 未登记 → `testing_execution_channel` FAIL、detail 含冻结话术并列出已登记键清单（normalize 后、字典序；空清单时明示）、`shouldRunDevicePipeline` 返回 device=false；report-only 仍产出完整报告。
2. **A 已登记 id 放行**：`provider:device_test.visual_diff`（含 severity=SKIP 情形）→ 存在性通过，后续由 capability-resolution/evidence obligation 裁决，行为逐字不变。
3. **A 纯函数向后兼容**：`evaluateExecutionChannelDeclaration(planMd)` 无 opts 时结果与改动前逐字相同；alias `prd.visual_handoff` 经 normalize 视为已登记；分隔符/大小写变体（如 `device_test.visual-diff`、`Device_Test.visual_diff`）不视为已登记；无 provider TC 的计划行为不变。
4. **B 长图明确 FAIL**：参考图 1320×4350 对 viewport 1320×2120，pixel_1to1 → `visual_reference_viewport` FAIL 点名屏与尺寸；1320×8312 同样 FAIL；该屏不再产出 pixel/OCR 内容 hit。
5. **B 尺寸兼容行为不变**：1320×2120 对 1320×2120 → 现有 pipeline 逐字不变；长页拆成多个 viewport 尺寸的 screen（各自 `ref_id` + nav 末步 `scroll_to` 锚点）后正常进入原 visual diff。
6. **B 低档与未知 viewport**：低档位按既有 ratchet WARN/SKIP，不静默升级为像素 PASS；lock 无 viewport → spec WARN 明示推迟，testing 用实测尺寸再判。
7. **C 首部前奏合法**：`stop_app(B) → start_app(B,P) → touch → wait_for` 0 违规；NAV-002/003 视其为复位步；STEP-SETUP 满足。
8. **C 越界即拒**：无 `stop_app` 直接 `start_app`、中段 `start_app`/`stop_app`、bundle≠预启、缺 page_name、resetIdentity 不可解析、即席 `forbidStartApp:true` → 均 BLOCKER；STEP-004 action 包装仍 BLOCKER；不含 reset 的计划行为不变。
9. **C 宿主条件项（用户触发）**：重新派生后以前奏开头的 case 在真机冷启后前置成立，无"停在上一 case 子页"的级联失败。
10. **B 宿主条件项（用户触发）**：宿主 expanded/all_banks 在 pixel_1to1 下被点名 FAIL；按锚点拆成多个 viewport 尺寸 screen 后进入原比对（须至少两个冷启动轮次的中/尾 checkpoint 落点一致，否则如实记为当前限制）。
11. **D 0 归 unknown**：bm dump `"versionCode": 0` → versionCode=null + reason、installed=true；diag kind=clear、deviceVersionCode=null、downgradeDetected=false；install 日志打印 unknown 说明；候选 versionCode 正常时无降级误报；正整数行为不变。
12. **E 占位钉子（已完成）**：timing `total_harness_ms=null` 而报告合计 `123ms` → 对账报"应为无数据占位"；合计 `—` → 通过。
13. **零影响**：无 provider 通道、参考图尺寸兼容、不含复位前奏、versionCode 正常的 feature，在 checks/summary/quality axes/report-only 上行为逐字不变。

## 五、边界与不做

- provider per-TC 结果绑定、provider 结果 schema、registry 扩为执行账本 —— 归 e7cecd22。
- perf/FPS/内存等新能力的设计与登记 —— 另行拍板，本 plan 只保证"未登记就计划期报死"。
- B 不新增：`screens[].reference_region`、自动 crop resolver、派生 crop 文件与新 hash 语义、自动分段、滚动拼接、多套 reference 真源、下游消费者批量改造、按参考图改 viewport、pixel_1to1 静默降级。
- 备选（路线图，本 plan 不做）：应用内快照钩子——`componentSnapshot` + `Scroller` 在应用内产整页图，作为带 per-TC 证据的 provider 能力；这是长页问题的长期正确工具，需宿主代码配合，超出黑盒范围。
- C 不含 `clear_app`（将来需顶层测试计划显式授权）；不做 case 开头堆 `back`、屏幕状态机/可达性图、Hylyre case-level teardown 状态机（备选，不在本轮）；不扩 failure routing。
- 即席（adhoc）steps 内 start_app 禁令、harness 预启/冷重启链路 —— 不变。
- 不恢复：ui-spec/acceptance/contracts 白名单并集、runtime hash/sidecar 家族、人签/receipt/confirmed_by 载体。
- 不修改 testing-stepresult-evidence-consumption 的在途 delta（E 只加了 tasks 6.7c 与模板一句），不混进 framework-identity-boundary，不再拆更多 change。
- 不操作宿主、不发起宿主 smoke/真机 run；§四 9/10 由用户触发。

## 六、验证与交付顺序

```text
宿主 report-only（用户触发）→ T8 / 5.2 / 6.8 完成 → archive 当前 change
→ T1 两个后续 OpenSpec change（ADDED）strict 通过
→ T2 A + T3 D（便宜、无依赖）定向回归
→ T4 C（lint / 知识块 / 文档 / 测试更新）定向回归
→ T5 B（共享判据 / spec 检查 / testing 内容比对前剔除）定向回归
→ T7 一次最终全量单测 + typecheck + openspec strict + check-plans + LF/diff
→ 宿主条件项由用户触发（B/C），未跑则如实标"条件未验"
→ 独立 review 收口，按事实置 todos completed
```

本 plan 属 `3.0.0` 当前窗口，不使用 `deferred_to`；与 a6c4e9f2 T8、e7cecd22 分开推进。
