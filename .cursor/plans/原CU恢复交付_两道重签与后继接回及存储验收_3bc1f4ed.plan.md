---
name: CU 验收重签、后继接回与干净宿主正式验收
version: 3.1.0
parent_goal: balanced-delivery-and-reliability-a47c9d62
advances:
  - g3-recoverable-execution
  - g5-proportionate-verification
  - g6-real-host-delivery
relation: core
layer: governance
goal_requires:
  - existing-obligation-scope-and-responsibility-contract
  - one-public-completion-driven-execution-path
goal_provides:
  - recoverable-owned-projection-refresh
  - delivery-through-existing-authorized-writers
  - behavior-preserving-targeted-retest
real_host_validation: >-
  用户安排含本批修复的新发布件，在需求实施前的干净产品基线上从原始需求和四图重新发起无人值守交付，核当次根、CU 与当前构建的正式证据。
  2026-11-20 旧 run 原件仅供隔离回放。质询效率沿用 3ec91fa7 的独立验收口径。
parallel_authority_added: false
overview: >-
  让运行器核实已获准的输入变化，保留完整的 spec 范围修订，并在派工时识别同周期 CU，由原有续接规则处理失效绑定。
  在隔离副本验证恢复机制，在新包干净重跑中观察新运行自主交付的产品行为与证据。
todos:
  - id: replay-originals
    content: 在隔离副本从 11 月 20 日原件重建首次拒签和后继接回失败，保存可重复的对照输入。
    status: completed
  - id: owned-acceptance
    content: 逐项核实验收交回、授权源码及测试写入、框架生成物，保留不明漂移和设计变更的责任边界。
    status: completed
  - id: scope-proposal
    content: 保留完整 spec 提案和失效契约的责任归属，验证检查前、检查后和续跑均能推进到原 plan。
    status: completed
  - id: successor-cu
    content: 修正派工处的同周期 CU 归属校验，在隔离副本验证现有后继 CU 重解绑定并正式完成。
    status: completed
  - id: acceptance-layering
    content: 让设计、质询、spec 与测试按实际可观察结果分层，覆盖真实存储证据与混合 UI 义务。
    status: completed
  - id: formal-delivery
    content: 用用户安排的新包在干净基线上重跑 bc-openCard-2，核对本次新根、CU、具名 UT 与当前 HAP 真机原件并签正式交付结论。
    status: pending
  - id: questioning-efficiency
    content: 用原质询材料回放复问范围，按既有可比样本和干净宿主计时口径独立验收效率。
    status: in_progress
---

# CU 验收重签、后继接回与干净宿主正式验收

## 1. 交付终点与回放输入

本批验证 AgentMaison 能否从原始需求自主完成 `bc-openCard-2`。**宿主正式交付以新发布件在需求实施前的干净基线上从头运行，并由该次新根及其 CU 正式完成为准。** 11 月 20 日的 `e8d6d9` 及其父根、后继根只提供历史证据。框架在隔离副本验证后继根能否正确认领同周期 CU，并沿已有后继 CU 路径完成交付。旧宿主现场只读取证，不续跑、不预修产品。框架修复位于开发仓，宿主通过 `framework/` 集成用户安排的校验发布件。[框架设计原则](../../docs/overview.md#121-四条总设计原则) · [干净宿主验收边界](../goals/效率与准确率平衡总体目标_默认基线自主交付与可调精细度及可靠恢复_a47c9d62.goal.md)

历史宿主为 `SimulatedWalletForHmos`，旧发布件为 `3.1.0 / 9c08d1e3`，产品基线为 `3af5f7c16e6344337926a51fb2ba962fb49fa4cc`。当时存储分层、失败清栈落点与产品交互均有偏差，后继还发布了 blueprint rev3 与 CU rev2，不适用“仅框架崩溃且既有阶段成果正确”的接续例外。下表前三行路径相对宿主 `doc/features/bc-openCard-2/`。从现有原件提取最小必要输入用于自含回放，不要求宿主保留或重建旧现场。历史文件按前像哈希取字节，7 个施工依赖的前像可从该产品基线提取，组件索引前像取自事件 271。将历史绝对路径映射到隔离副本，交回后的字节与事件哈希对照。

| 现场 | 必取原件 | 用途 |
| --- | --- | --- |
| 原请求 `goal-runs/20261120T124204Z-205139/` | `manifest.json`、`events.jsonl`、`design-repair/component-blueprint.yaml` | 定位首次停机时的 blueprint rev2。设计质询 i6、i8 的 `blueprint-before.yaml`、原答和签发范围用于效率回放。 |
| 原 CU `open-card-flow/goal-runs/20261120T142738Z-e8d6d9/` | manifest 的出生范围、`phases/work-unit-author/work-unit-author-i1/request-e1.json`、事件 271、294、299–301，以及同 CU 的 `spec/reports/script-report.json` 与 `ut/reports/summary.json` | 核对验收前像、组件索引生成、作者的 45 项交回、spec 提案及停机顺序。UT 报告来自交回前的检查，正式调度只到 spec。 |
| 后继 `goal-runs/20261120T150724Z-ea9765/` | `manifest.json`、`events.jsonl`、`design-repair/original-context.json` 中的 CU 前像，以及当前 canonical 蓝图、CU、验收和契约 | 分开重建首次停机的 CU rev1，和发布 blueprint rev3、CU rev2 后仍引用旧代的阶段产物。15:54 指定旧根续跑仍落到后继并报归属错误。 |
| 需求与设备 | 宿主 `doc/features/原始需求/1-2-银行卡/原始需求.md` 第 6 条、页面说明 4 及同目录四图，以及 `doc/features/_adhoc/testing/reports/20261120-110441/hylyre/failures/step-13.json` | 原文和既有路由决定清栈边界。失败树记录卡片与协议均已勾选、按钮仍禁用及实际文案。它用于隔离回放，并说明 §3 观察项的来源。 |

CU 出生时 `phase_chain=[spec]` 的直接原因是 `pixel_1to1` 缺少可读的 `spec/ui-spec.yaml`。施工签发覆盖六个获准职责。该作者同时新增视觉规格、补写 AC-15/16/17 的 checkpoint 与原文引用，并修改源码、测试、契约。三个数据库条目的检查点缺失触发验收内容变化，与出生时的视觉定义缺口分别处理。

## 2. 框架修复

### 2.1 第一道重签核实输入变化的归属

首次拒签可由两类变化分别触发。旧 acceptance 绑定含 24 个依赖，除验收本身，变化的是 6 个 coding 路径、1 个 UT 路径和框架生成的 `doc/component-index.yaml`。写入检查已确认归属，`refreshOwnedAcceptanceScopeInput` 却只会用设计发布原件解释变动的蓝图或 CU。

逐项比较旧绑定、获准写入及当前字节。验收沿用本 CU 的签发请求、前像、已完成的作者交回、连续哈希和原验收承诺校验。对源码及测试，使用 `createObservedSourceHashReader` 的源码归属判据核实授权写集和交回，验收文件本身另按 spec 产物归属核实。对组件索引，复用 `isProducedPhaseChange` 核实框架生成者、实际路径与前后哈希。验收绑定里这些文件的角色均可标为 `artifact`，归属以实际签发和写入记录判断。蓝图、CU 的实质变更沿用设计发布证明。未获解释的字节、外部覆盖及弱化的验收承诺保留给各自责任方处理。[验收重签](../../harness/scripts/utils/feature-track.ts) · [作者写入读取](../../harness/scripts/utils/phase-evidence-manifest.ts) · [框架生成物核验](../../harness/scripts/utils/phase-write-boundary.ts)

### 2.2 第二道重签保留完整的 spec 提案

用原件先证明两个不同结果。旧发布件在 `assertScopeAcceptanceRevision` 拒签。仅认可上述八项依赖变化后，现行 `proposals.splice(0, proposals.length, ownedAcceptance)` 会用作者交回覆盖 `design_scope_facts`，旧 `design-context:candidate` 的 contracts 满足证明随之带回，修订再次失败。第二个结果是对照回放所得，首次现场只发生了第一道拒签。

由既有范围修订写入器消费一份完整提案。spec 已给出当前验收绑定，并撤下失效的契约满足证明。范围解析器按实际视觉规格解除定义缺口。将作者交回核实的当前 CU、run 和验收新绑定与 spec 提案对应，用它证明该项变化，保留提案里的其他事实。若二者指向不同内容，将具体差异交回责任方。修订后应记录新的 `scope_revised`，得到 `plan → coding → review → ut → testing`、该视觉缺口清除、契约责任回到 plan。plan 须核实并重签当前契约，下游读取其有效绑定。

检查前的 `onlyCompatibleInputs=true` 没有正式检查提案。仅当作者交回单独足以通过完整修订校验时才写事件。若已签交回解释了 acceptance、但它单独带回的过期契约证明须由当前 spec 检查撤下，本次预检不写修订也不转外部等待，让原检查执行或读取其已完成的有效结果。检查后及 resume 以该正式提案配合同一交回重签。仍有未解释的输入时，区分缺本阶段材料和真实设计差额，分别交回 spec/plan 或沿已有 `design_authority` 交原设计责任方。这一处理仅适用于已获准的检查，真实授权、硬预算和原生用户范围指令继续按各自原规则处置。[预检与正式检查入口](../../harness/scripts/goal-phase-runtime.ts)

### 2.3 派工认领同周期 CU，沿已有后继路径完成

旧样本的 CU 出生于根 `20261120T124204Z-205139`，以 `HALTED/execution_scope_unresolved` 停止并已释放执行权。后继根 `ea9765` 已发布 blueprint rev3 / CU rev2，能从现有谱系读出这个 CU，派工处（`goal-phase-runtime.ts` 原约 5544 行）却只比较出生父 run ID 与当前父 ID，因而在真正续接前报错。

**先只修派工归属。** 在上述派工处复用 `delivery-origin.ts` 已审计的同一交付周期成员判定，校验实际子 run、canonical CU 与出生来源。存活写者和已签未交回请求仍沿原入口消费。对已停止且绑定已失效的 CU，使用现有 `childEntry` 与 `decideRunContinuation` 的 `successor / related_repair_changed` 分支，由后继 CU run 按当前设计重新解析绑定，保留谱系、已取得的有效证据和累计预算。旧 CU run 可以保持 HALTED。同周期内 CU 的正式交付按最终有效完成原件判断。[同周期成员判定](../../harness/scripts/utils/delivery-origin.ts) · [实际派工](../../harness/scripts/goal-phase-runtime.ts) · [已有续接规则](../../harness/scripts/utils/goal-run-creation.ts)

**以回放结果决定是否还有框架缺口。** 先从公开入口验证已有后继 CU 可以出生、读取当前权威、经责任阶段产出真实结果并完成。路由返回 successor 或出现一个新目录都不足以证明完成。若有确定性失败，先在本计划记录原件、入口、实际分支、触发条件与后果，再修最小责任点。只有回放证实现有后继路径无法完成且确实需要时，才考虑原 run 内 rejoin 或跨根读取发布授权。设备、外部权限或夹具输入不足仅记待验，不能据此扩大框架改动。

**执行中已复现的失败点（2026-11-20）。** 只修派工判断后，银行卡原件的隔离副本已实际出生后继 CU 并签发请求。另用一条完整受控旅程从旧子 HALTED、父根 supersede、设计修复正式发布一直走到后继子 `20261121T034857Z-fefd57` 签发。该子合法继承 `delivery_origin.run_id=fixture-old-root`，由当前根交回同一已签请求时，公开 `runGoalModeSessionStep` / `--request --report-result` 在 `goal-mode-entry.ts` 的 `resolveOriginalDeliveryRequest`（原第 583 行）报 `[session-handoff] request belongs to another original delivery`，发生在读取签发原件之前。银行卡隔离副本对实际出生的后继 CU 交回其原签请求也复现同一错误，拒绝前后子事件未变化（`harness/reports/3bc1f4ed-dev/successor/after-bin0UY/historical-signed-handoff-rejected.json`）。另一份证据为开发回放的 `harness/reports/3bc1f4ed-dev/successor/fixture-before-handoff-proof/` 中两代根与子事件、后继子 manifest 和签发原件，以及 `test-runtime-control/failure-2XyMDv/failure.json`。最小修订是在这一处沿用同周期成员判定核实施工子 run，根签发仍只限当前根本人，保留 canonical、签发目录/身份与原有写权核验。以同条旅程从报告交回继续到正式完成。无关子和旧根自身的设计签发仍拒收。本次证据指向交回入口，继续沿用已有后继 CU 和绑定重解规则。[公开会话交回](../../harness/scripts/goal-mode-entry.ts)

### 2.4 按可观察结果分层

现场蓝图按已声明的 checkpoint 检查，正式 spec 按整项 Feature 的 UI 属性要求所有 P0 `device/both` 条目补齐。AC-15/16/17 因而都补了同一个“提交 OTP 后结果页可见”的锚点。该锚点只观察到导航，三个数据库结果仍缺证。

设计与独立质询逐条核对“要证明什么、什么测试能读到实际值”。对纯存储义务，设计可沿既有 `ut_layer: unit` 保留必需 ID、原文引用、验证步骤及预期结果，把真实查询写进应用内集成测试责任。应用内测试可以在真机运行。对确有可见结果的义务，继续要求对应的设备动作及断言。混合承诺沿已有独立验收 ID 分别取证。同一结果页截图只支持它实际展示的结果。[已有分层约定](受管交付恢复_责任方重签与真实复验_7d2c49e8.plan.md) · [设计指引](../../skills/reference/app-component-blueprint-workflow.md)

沿蓝图投影、独立质询、spec 检查、UT 责任集合、设备计划及完成判定一致消费该分层。多条 P0 使用完全相同的 checkpoint，或预期结果无法从界面观察时，逐条核对动作、断言和可取得的证据。同一动作可以支持各自能验证的界面结果。若共享锚点只能证明跳页，无法证明某条验收的实际值，将具体差额沿既有设计路由交回设计方修订分层或拆开结果，不要求施工方补写替代性的页面检查点。真实 UI 义务仅缺定位时由 spec 补齐。`device_focus` 已填或关键词相同均不能代替这项判断。[P0 义务解析](../../harness/scripts/utils/p0-semantic-gates.ts) · [UT 与设备责任集合](../../harness/scripts/utils/acceptance-layering.ts) · [正式证据消费](../../harness/scripts/utils/runtime-step-evidence.ts)

## 3. 干净重跑的五项宿主观察

新包从统一前门接收原始需求、四张参考图和正常工程基线，由新的受管运行自行设计、实施、审查、测试及必要返修。下表用于对照运行结果，不向作者提供旧解法，也不要求用户先修改源码、测试或设备。验收按新运行产生的验收 ID 和用例定位。

| 观察项 | 当次运行的通过依据 |
| --- | --- |
| 选卡与协议控制“下一步” | 当前 HAP 上，未选卡或取消协议时按钮禁用，选卡并勾选协议后按钮启用且可点击。保留状态变化前后的正式设备断言。 |
| 进入验证码半模态 | 实际点击启用的“下一步”，OTP 半模态出现，脱敏手机号、验证码输入和发送控件可见。按钮的 enabled 值仅证明上一个观察项。 |
| 协议文案 | 从实际选卡页读取完整文案，银行名及前后文本符合本轮按原文和参考图确认的预期，无 `[object Object]` 占位。 |
| 失败回到“添加卡片” | 从“添加银行卡”和“全部银行”两条入口覆盖失败完成行为。正式用例记录真实失败前置及结果，用户点完成后回到 `AddCardEntryPage`，本轮从 `AddBankCardPage` 到结果页均已出栈，后退不会重进流程。成功分支仍回首页并交接卡号。 |
| 真实 RDB 写入与读回 | 有存储访问权的具名应用内用例经本轮生产开卡路径和真实 RDB 驱动写入隔离测试库，查询实际库表与必需字段，断言读回的完整卡号与提交值逐字符一致，重复提交同卡后查询仍仅一行且记录身份与首次一致。独立 UT 强度审查用 `production_paths`、执行原件和实际断言核验。仅有内存驱动、SQL 字符串或结果页时，该项保持待验。[独立强度审查](../../harness/scripts/utils/acceptance-review-strength.ts) |

## 4. 框架隔离回放与新包宿主正式验收

1. **在隔离副本证明第一道分支。** 使用本次真实调研来源与真实施工写集的交集。固定同一份验收交回，分别只保留 7 个施工依赖变化、只保留索引变化、保留两类变化、两类均还原。旧版前三组拒签，最后一组通过验收交回判定。修后四组均应通过这一道，其他契约仍由下一道核验。加入一项无对应交回的需求或源码改写，以及弱化既有预期结果的反例，验证不能据此签入新范围。
2. **串起两道重签。** 以运行器正式入口重放同一作者同时改 acceptance、源码、UT、contracts，框架生成索引，初始视觉缺口在同轮补齐。核对签发事件和有效范围，再执行 plan 的正式检查，确认它承担契约责任、下游读取新绑定。覆盖检查前仅有作者交回、检查后同时有提案、以及 resume 已有 spec 结果三种入口。验证已成功的同一调用不重复派发，不明输入仍交回，必要的责任方返修可正常执行。补在现有旅程及责任方重签回归上。[现有旅程样例](../../harness/tests/unit/daily-design-journey.unit.test.ts)
3. **在隔离副本验证既有后继路径与分层。** 从 rev3/rev2、旧 CU 已释放的原件重现派工拒绝。只修同周期归属后经同一公开入口继续，记录后继 CU 实际出生时的绑定、父子与 supersede 关系、预算承接、后续检查消费和正式完成原件。核对最终 CU 完成投影为 `VALID`、当前根完成。旧 run 保留原终态。无关请求或跨已完成周期的 CU 继续隔离。若机制回放出现额外阻断，按 §2.3 先记录再定修法。对历史分层样本，三项存储结果仍属 UT 必需项，P0 UI checkpoint 从 19 项回到 16 项，真实 UI 义务保留。隔离回放证明通用接线，宿主新运行从干净基线出发。
4. **在干净宿主上验到新运行正式完成。** 每轮框架开发执行 `npm run test:changed`，收口使用 `npm run test:daily` 和关联回归。**候选包由用户安排。** 用户提供包含本批修复的已校验新包后，记录包身份、干净产品基线和本次运行条件。从需求实施前的干净副本走正常发布件集成与统一前门，重新提交原始需求及四图，启动新的无人值守完整交付。旧设计、旧实现、旧测试材料和旧 PASS 均不作新运行输入，从头产出设计、CU 和当前阶段原件。按当次获准范围完成 spec、plan、coding、独立 review、UT 和正式 device-testing，逐项结算所有必需 ID 和 §3 五项观察。同时核对四图视觉结果、验证码倒计时及禁重发、结果页系统返回与侧滑拦截、清栈与既有路由回归。各项证据与最后一次产品修订、当前签名 HAP 和实际设备对应。

以**本次干净重跑生成的实际根、CU 和 run ID**核验正式交付。每个适用 CU 必须在其完成 run 目录生成 `feature-completion.json`，feature 侧路径和哈希指向该原件，现行 `observeChangeUnitCompletion` 核实为 `VALID`。隔离旅程已观察到正式写入器使用 `run_end=CHAIN_SLICE_COMPLETED`，消费者也接受历史 `COMPLETED`。单一终态标签不足以签收。适用部件组装核验、本次当前根 `COMPLETED` 与本轮全部必需义务的真实完成结论须一致。旧 run ID 不作为新设计或完成条件。缺少用户安排的新包、设备或必要授权时，只记录已验证的框架结果和宿主待验项。[完成原件与投影](../../harness/scripts/utils/verify-feature-completion.ts) · [CU 完成消费](../../harness/scripts/utils/change-unit-completion.ts)

## 5. 质询效率独立验收

复用原根 i6、i8 的质询前像、原答和签发清单。保持其余输入相同，无内容变化时只需复核原遗留的一项。仅改变 `stack-cleanup-boundary` 的决定正文，现行选择器扩到 19 项。逐项区分决定的直接消费者、实际受影响的传递依赖，以及仅引用同一份未变需求文件的条目。复用既有选择器和上轮独立原答，保留有实质影响的复问。对仅共享未变文档、没有实际依赖的条目，以旧答复用作为正例。对清栈决定的真实消费者、来源内容确实改变或有具体新证据的条目，以重新签发作为反例。用实际签发范围、复用理由和修订后的独立结论对账。[质询范围选择](../../harness/scripts/utils/blueprint-questioning.ts)

沿用 3ec91fa7 的计量口径。11 月 20 日从原根 `run_created` 到首次正常施工作者 `agent_process_bound` 为 **14 次设计调用、107 分 37 秒**，11 月 19 日为 **15 次、137 分 57 秒**。优先使用 §4 同一次干净重跑的原始时间线，在条件可比时，沿用相同需求、四图、产品基线和原 manifest 的模型配置（本次为 DSH 的 `volcengine/deepseek-v4.1-flash`），完整计入设计返修、质询和范围准备，以 **≤9 次且 ≤100 分钟** 签收首次施工效率。受影响项不超过首轮一半的可比质询轮，仍按既有输出量 ≤50%、墙钟 ≤70% 的指标评价，注明比较对象。隔离回放耗时单列，首次施工时钟不能从 resume 或 supersede 重新起算。[既有效率验收口径](宿主受管交接与正式真机验收_首次施工提速_3ec91fa7.plan.md)

新包干净宿主的交付结论和质询效率分别签收。旧原件回放只证明恢复和复问选择机制。首次施工计时条件不可比时，效率待验，已取得的宿主交付结论独立有效。
