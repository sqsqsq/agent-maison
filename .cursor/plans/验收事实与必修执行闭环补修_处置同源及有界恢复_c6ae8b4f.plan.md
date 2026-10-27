---
name: 验收事实与必修执行闭环补修 — 处置同源及有界恢复
version: 3.1.0
parent_goal: balanced-delivery-and-reliability-a47c9d62
advances:
  - g1-default-delivery-baseline
  - g3-recoverable-execution
  - g4-completion-and-polish-separation
  - g5-proportionate-verification
  - g6-real-host-delivery
  - g7-lean-governance
relation: core
layer: closure
goal_requires:
  - existing-current-disposition-and-responsibility-contract
  - existing-invocation-evidence-and-obligation-scope
  - current-native-execution-evidence-and-owned-artifacts
  - existing-verifier-and-bounded-recovery-channels
goal_provides:
  - acceptance-evidence-first-finding-applicability
  - consistent-author-guidance-and-phase-closure
  - complete-required-work-delivery-through-existing-inputs
  - purpose-based-verification-and-content-retry-accounting
real_host_validation: >
  挂 a47 R6，承接 fb3ef864 回灌后 fe4512 的 2026-10-26 恢复失败。
  开发期只读保全新截面并在隔离副本回放；本次仅起草计划和同步路标，
  不实施、不提交、不打包、不改宿主或手机。实施完成后仍由用户安排发布与同 run 接续。
  本计划 t8 与 6fd6c8c1 t8、a47 R5/H1 及既有适用联合项共用观察，当前均保持 pending。
  不重开前序已完成开发待办，不将开发回放或准确停机当作宿主交付完成。
parallel_authority_added: false
overview: >
  四段同一链：先用当前验收事实核旧发现适用性，再由现有统一处置判动作与责任，
  作者/门禁/回执/恢复只消费该完整处置，最后按实际动作归属预算并闭合。
  已满足验收的文档漂移不制造新必修义务；真实契约或验收变化仍须受影响验证。
  不新增运行时状态、停机原因、问题登记表、送达回执或指纹系统。
todos:
  - id: t1-evidence-and-consumers
    content: 按§1/§3保全S2原件、对应invoke的gate原件/事件及当前验收反证，登记来源与缺口，逐项核实消费者、派发输入和生成物化路径；固定可复用证据及预算基线。
    status: completed
  - id: t2-applicability-and-proof-reuse
    content: 按§4.1在派作者前同源组装当前验收反证，未覆盖的已核发现转既有补核；接通原验证方完整材料与有据关闭，保持核实内及关闭后材料稳定，守住真正变更的复验边界。
    status: completed
  - id: t3-disposition-and-delivery
    content: 按§4.2收齐事实后统一计算处置，贯通本阶段与跨职责任务送达、作者下一步、回执/闭环及完成消费者，删除旧独立裁决。
    status: completed
  - id: t4-verification-facts-and-budget
    content: 按§4.3/§4.4统一引用和诊断，承接合法来源；以对应invoke原件核严格补核资格，收编外层旧发现FAIL的一刀切，避免重派作者；总调用照计，满额后只做无需模型的机器收口，保持有界恢复。
    status: completed
  - id: t5-guidance-and-materialization
    content: 同步§3中的Skill、verifier契约、代理模板及生成/物化入口、运行指引与现行OpenSpec；核对实际调用输入，不修改四条总原则。
    status: completed
  - id: t6-production-regressions
    content: 完成§6矩阵、S2生产回放及入口反证/送达变异；硬断言29→30仅1次plan核实、0次plan作者及下游四段零新调用，并验证30/30仍需核实必停；交真实模型证据，不以知答案替身绕过派发。
    status: completed
  - id: t7-validation-and-review
    content: 按§6.3运行官方全量及受影响release-only分片，完成计划/LF/规范检查与独立检视，交付逐项证据、消费者收编表及准确限制，提交前汇报。
    status: completed
  - id: t8-host-continuation
    content: 用户安排发布后按§7接续fe4512原run，核29→30一次核实/零作者、满额机器收口、下游旧PASS与空完成问题的跳过及正式Feature/CU完成；真实缺口不算成功，与既有联合项共用证据，未实测不得关闭。
    status: pending
---

# 验收事实与必修执行闭环补修

## 0. 阅读、权限与实施顺序

本计划可交给任何实施者；执行分工、模型选择和实际调用记录不属于计划要求。先读仓库 AGENTS.md、docs/overview.md §1.2.1 四条原文，再读本计划。基线为 fb3ef86485159c8ebfee99848b4bf12804c4a75c，版本以 package.json 的 3.1.0 为准；引用行号仅定位，不授权回退到旧代码。

路径均相对开发仓根。表内省略目录的工具文件默认在 harness/scripts/utils/；harness-runner 位于 harness/harness-runner.ts，runtime 指 harness/scripts/goal-phase-runtime.ts，check-receipt/check-init/公开CLI位于 harness/scripts/。宿主绝对路径仅作原件来源，不是实施位置。

父目标为 [a47c9d62](../goals/效率与准确率平衡总体目标_默认基线自主交付与可调精细度及可靠恢复_a47c9d62.goal.md) R6。沿 91/c2 的责任与义务、7d9 的验证缺口、1804 的共同执行内核、6fd 的当前处置继续收口，不另起平行架构。6fd t1–t7 的既有开发结果保留；其 t8 尚未通过，新增真实缺口由本计划承接，不回写前序历史结论。

当前仅获准起草。收到明确实施指令后，一次完成 t1–t7、统一验收；t1 的核对表用于开发和检视，不增加中途审批点。t8 单独等用户安排。本轮不创建 OpenSpec 提案或夹具、不改生产代码、不提交、不打包、不运行宿主 harness、不操作手机。既有 DSH 4e92a7c6 等其它会话改动不纳入。本计划放既有 .cursor/plans/，不新建 .cursor 子目录。

实施顺序：t1 固定事实与输入边界；t2 与 t3 先建立共享语义和实际送达；t4 接恢复及预算；t5 随行为同步；t6/t7 在稳定源码收口。可并行处理互不写同一文件的工作，测试按现有用例分片并行。新发现不能静默改计划范围；常规实现选择沿授权推进，确需新增机制按§5说明场景和收益。

## 1. 现场、已核事实与撤回边界

现场只读路径：

    D:/1.code/SimulatedWalletForHmos/doc/features/bc-openCard-2/bank-card-opening-flow/goal-runs/20261023T044016Z-fe4512

本轮标为 S2：同一 run 在 10-23 原始执行、10-24 首次 resume 之后的 10-26 再次 resume；不是后继 run。宿主 RELEASE-MANIFEST 的 source_commit 为 fb3ef864，相关 runtime/处置/候选代码与仓库一致。

| 事实 | 已核原件或代码 | 含义 |
|---|---|---|
| 三次判定并非三次 OTP 实修 | events.jsonl 第593/622/656行：plan-i2为facts覆盖FAIL；plan-i26原PASS但诊断待核而retry；plan-i28为已核发现FAIL并content_retry_exhausted | 必须分清准备、核实和内容修复，不按phase名混算 |
| 最终计划产物未变 | plan/plan.md、contracts.yaml、use-cases.yaml 与已保全S1原始SHA相同；最新作者日志明确只转录verifier、不修非BLOCKER | 不能把本次描述成已执行两次正确的契约修复 |
| 旧担忧已有实质反证 | WalletMain frozen UT结果26/26，包含 [AC-3][BD-2] OTP starts once…；用例实际驱动生产OtpVerificationState，UI经业务服务调用其状态能力 | 要核“现在是否仍妨碍验收”，不能仅核文档有没有补方法名 |
| 相关实现/测试未漂移 | OtpService、BankCardOpeningService、OtpVerificationSheet、BankConstants、bank_open_card_ut、SpyBankCardOpeningDependencies 六文件与UT证据SHA相同 | 不是仅凭ut_covered标签或用例名称认定已满足 |
| 作者动作早于完整事实 | harness-runner.ts:2325先算next_action，2373再加诊断，2408再加候选 | 仅后移语句不够，动作必须改读完整统一处置 |
| 收口和运行器相反 | phase-closure-finalizer.ts:698排除所有open_finding；runtime:10224以后对本阶段必修改判FAIL | 本职责必修、跨职责工作和真实负面验证不能被同一豁免混掉 |
| 核实输入丢字段 | writer传diagnostics，runtime:9922只挑reportText/rows；两份真实format-repair prompt的Diagnostics均为空 | 共用函数不等于消费了同一完整输入 |
| 补核标记未被持续消费 | used分支置resumePostAgentPhases，但入口:7774–7781以retries===0限制验证优先 | 以实际调用事实和当前动作决定，不以重试序号替代资格 |
| S2缺少只核实入口 | plan-i28作者已settled、对应raw gate PASS、计划产物与业务输入未变，但事件656的phase_verdict FAIL来自open_finding旧处置；reusablePassedInvocation只找有效phase PASS，resolveValidationOnlyEligibility遇phase_verdict即拒绝 | 必须核可追溯的对应invoke原件与负面来源后直接恢复gate/核实；不能把外层FAIL全当产品失败，也不能靠当前无绑定PASS猜旧失败 |
| 首次facts阻断涉及13目标 | 12份后来创建的源码及1份PNG未在头部/本阶段delta；context-facts.ts:308走FAIL | 仅在缺覆盖且不满足合法新增豁免时发生，不是所有上游重开都必失败 |
| 原预算仍在 | progress为29/30轮、17,382,369ms；manifest为30轮/480min，有效wall为540min | 540来自五阶段时限合计510min加30min缓冲，不是新增固定60min恢复额度 |

S2需要保全：manifest/events/progress/goal-report、当前plan三产物、facts及原基线、两个作者/核实请求与可取得的输出、verifier请求/材料/报告、关联原生UT结果/执行键/日志与上述源码/测试、当前蓝图/CU和验收。开发时复用已有S0/S1，仅新增必要截面到 harness/tests/fixtures/host-recovery-history/20261026-fe4512-s2/；本次起草不创建它。

历史原件不修改。部分按固定路径写出的 prompt/agent-output/verifier 报告已被后轮覆盖，不能将现在的75dbc…报告冒称为首次生成时的字节。缺口如实记录；若用已保全S1字节和S2事件复现起点，明确组合与适配，不合成历史事件。环境适配限隔离副本并登记。机器日志混合换行沿既有Git binary保全；可无损LF归一的文本登记原始SHA，并核干净检出与还原结果。不复制真实秘密。

已撤回、不作为修复依据的说法：
- 无进展只看候选哈希：实际还看blocker签名和产物快照；本次停止是内容重试耗尽。
- 任意上游重开必失败：只在上表具体条件下成立。
- 没送达就一律等待：能执行就补齐输入继续，只有确实缺条件才等待。
- 文档变更一律免验、或必须补完所有预测接口才算功能完成：均不采用。
- 将所有MAJOR/SKIP升级为阻断、或将所有文档问题自动降级：均不采用。

## 2. 统一规则与成功定义

四段是同一条链：当前事实适用性 → 现有统一处置 → 执行送达 → 有界恢复。原始检查/报告、当前工作是否完成、普通Feature完成、发布资格仍是不同用途；保留原始PASS/FAIL和历史证据，不靠改写历史总判取得一致。

1. 先核本次用户验收是否真的欠缺。旧发现换编号、重新描述或文档落后，不自动成为新义务；真实新增要求不能借旧PASS冒领。
2. 只有经当前证据核实、仍妨碍本次授权终点的问题，才进入必修处置。明确必需工作的阶段/对象不能凭MAJOR标签跳过，也不能仅凭原总PASS或有效旧回执退出。
3. 负责方、合法修改者与验证签发者沿 c2 责任契约区分。当前职责能修的就地修；他方工作走已有回退/下游义务/设计链。真实负面结论在原验证方复验前保留，不能仅因owner是他方就签质量通过。
4. 验证未完成走补核，不冒充产品FAIL；候选为空不能抹掉已经知道的必需或待核问题。一般建议、历史未分类SKIP和c2问题单格式提示保持原非阻断边界。
5. 具有明确任务且有执行条件时继续。外部条件、真实授权或能力缺失按现有出口处理并说明解除条件；硬预算仍可终止，不造永远唤不醒的等待。
6. 相同目标/授权/能力/事实下，两种作者运输共用这些规则；request保留本职责终点，不强造蓝图、阶段、run或Feature完成凭证。

本计划的完成不是“改了措辞”或“停机原因准确”：必须证明旧担忧已由有效验收事实解决时能够收口，真正未满足的工作能收到正确输入、实际修复、原验证方复验并到达授权终点。

## 3. 消费者收编清单

本表是开发期清点，不是运行时注册表。以函数/用途为准，不因行号漂移漏项。实施t1沿这些调用方再核实际渲染/物化入口；每项交付注明删除、薄适配或保留及其理由，不能以grep数量代替接线证据。

| 编号 | 入口 / 既有落点 | 旧判断或风险 | 本批处置 |
|---|---|---|---|
| C01 | harness/prompts/verify-spec.md、verify-plan.md 的原总判与必需验收段 | 原总PASS与必修并存却未明确父级该读何者；恢复时沿用施工前担忧 | 保留原始判级，补当前实证适用性；“当前还有什么必修”只由统一处置输出 |
| C02 | repair-candidates.ts 的 readVerifierSemanticIssues / readPhaseRepairIssues / verifiedPhaseRepairIssues / verifiedPhaseDesignFindings | 把报告字段齐备当作实质必需性；解析失败丢诊断 | 以当前核实和完整材料产事实；保留非必需与未知的区别 |
| C03 | readableIssueEvidence、现有Feature/产物定位器 | 仅项目根引用；一个坏引用清空全部 | 按上下文归一为与verifier material同形的项目相对POSIX label，经phaseIssuesForVerifierSubject实测；保留有效引用与逐条诊断，不猜跨Feature或越权路径 |
| C04 | verifier-material.ts、verifier请求生成、phaseIssuesForVerifierSubject及findUnreadableDiagnosisChecks消费点 | 核实前缺当前证据，回传或关闭后材料回摆；writer/runtime挑不同字段 | 与入口同源选择完整材料，由原producer签发request/material；以该材料和冻结执行原件为锚，关闭不删反证，真正变化才刷新；拒修/当前subject/诊断不丢 |
| C05 | verify-feature-completion.ts 的 readCurrentDispositionInput / readRegisteredFindings / readDiagnosticFindings；check-disposition.ts 的 resolveCurrentDisposition | 各入口取不同子集；已核旧发现因入口看不到当前反证仍被派repair | 派作者前只读组装与后续verifier同源的相关验收证据；原核实未覆盖或无法确认覆盖时复用verificationRequired转verify，不自判验收满足、不生成请求文件；完整输入后再统一处置 |
| C06 | harness-runner.ts writeRunSummaryBase / decideNextAction | 下一步先算，诊断/候选后加；只按verifier总判收口 | 先收齐当前事实；旧decideNextAction收为共同处置的词汇适配，不再独立裁决 |
| C07 | harness-runner.ts buildNextLine / NEXT_STEP / patchRunSummaryClosure / --sync-closure | “只修BLOCKER”“闭环即停”等旧指令；通用返修句无任务 | 显示当前任务、责任、依据、实际下一步；保留原始检查事实并说明其用途 |
| C08 | phase-closure-finalizer.ts finalizePhaseClosureUnlocked | 无差别排除open_finding | 按本职责工作、验证资格与合法交接判断；自身事务待发布事实仍不反向阻断自己 |
| C09 | check-receipt.ts；goal-runner-phase.ts resolveClosureAdvanceBlock / resolvePhaseHarnessVerdict | 把证明有效或closed直接当当前无工作 | 回执有效性不改；前进/作者退出须同时消费当前工作，旧证明不遮新义务 |
| C10 | assess.ts collect/recommendation及goal-assess-driver.ts / goal-reconcile-boundary.ts | unclosed占位遮具体问题；同阶段候选退回通用retry | 完整问题不丢，选合法下一步；同阶段与跨职责复用同一任务事实和既有事件边界 |
| C11 | goal-phase-runtime.ts buildPhasePrompt、约7853旧失败兜底、约8309候选注入 | 只在backtrack数组注入完整候选；原PASS尾日志误作“未产可读报告” | 所有当前派发从共同任务事实取得本职输入，不依赖是否发生跨阶段回退 |
| C12 | runtime约9895核实循环、约9922诊断调用、invokeOutOfChain | 少传diagnostics/拒修/subject上下文；空诊断仍派核实 | 与writer共用完整诊断组装；仅处理真实核实任务，不让模型猜缺什么 |
| C13 | runtime约7774的验证优先、reusablePassedInvocation、resolveValidationOnlyEligibility、resumePostAgentPhases、session-execution-handoff | 重试序号及有效phase PASS一刀切，拒绝raw gate PASS但旧发现导致外层FAIL的补核 | 入口先按C05识别verify；仅在对应invoke已settled/已接报告、原件证明gate PASS且负面仅源于待重核旧发现、产物/业务输入仍有效时，直接复用原invoke走gate及核实；真实gate FAIL、实质变化或来源不可确认不豁免，保留安全guard |
| C14 | runtime失败投影/重试/停机；goal-failure-classifier.ts shouldHaltNoProgress | 补核回普通内容计数；通用“补原始输入”替代具体修法 | 动作与计数同源；保留原签名、快照与总预算，不另造指纹系统 |
| C15 | capability-resolution-entry-input.ts；context-facts.ts checkFactsArtifact；相关探索检查 | 合法下游新增目标在上游补验时要求再登记，先失败一次 | 按§4.3区分纯补核和真正新阅读；承接合法来源，不伪造已读或改基线 |
| C16 | phase-evidence-manifest.ts、identity-neutral-digest.ts、execution-scope.ts、feature-track.ts | 文档同步与真实业务证据失效混同 | 复用既有归属/语义和当前证据；不按扩展名豁免输入，也不机械触发作者/设备重做 |
| C17 | blueprint-skill-projection.ts compareAuthoritativeContent / materializeBlueprintSkillInputs；现有设计修订链 | 将实现细化或文字漂移当新设计缺口 | 不冲突增量按原职责；真实权威变化才重签；本次优先核旧必修性而非强行补接口 |
| C18 | request-phase.ts、generateRequestScriptReport及请求准备；report-generator / quality-axes | Feature判据污染专项；原报告标签自定动作 | 保留请求授权终点、真实FAIL和原始轴；执行指导读同一处置，不扩大请求 |
| C19 | Feature完成生成/校验、feature-assessment、CU完成/依赖；goal-progress/report/state-reducer、公开assess/status | 已修消费面可能被新作者出口再次分叉 | 保持6fd有效行为并回归；明确run观察与Feature最终评估，不把标签差异当重跑许可 |
| C20 | 六阶段Skill及plan/code-review/business-ut/device-testing细则、goal-mode-operations | 多份“只有BLOCKER才修”及receipt早返回 | 不再复述另一套判级；统一引用既有共同动作规则，并给明确的本职执行步骤 |
| C21 | agents/claude/templates/agents/verifier.md、phase-executor.md；Codex verifier.toml；sync-codex-agent-templates.ts、codex-agent-toml.ts | 高优先级子代理指令仍覆盖新动作；生成物与源分叉 | 改模板源、用原生成链更新派生文件，保留生成等值检查，不分别手改两套规则 |
| C22 | agents的subagent物化配置、check-init.ts及实际调用加载路径；Goal/request/会话入口 | 源文件改了，实际角色仍载旧内容；误查不存在的Codex作者TOML | 在隔离消费者走现有物化/更新，核真正生效的request、Skill、prompt及角色输入；Codex作者指令来自Skill/prompt，没有phase-executor TOML，verifier.toml由C21源模板生成；不碰用户自定义授权 |
| C23 | runtime-policy.ts、goal-runner-phase.ts、goal-timeout.ts、预算及恢复指引 | 把允许调预算说成runner自动增额；空等待或后继刷新机会 | 沿§4.4/§7原计数与显式恢复入口；预算与权限不因运输变化 |

上述C19及其它已统一的路径以复用和防回归为主，不借盘点重做整个框架。global catalog/glossary等未使用本类任务事实的入口不强塞Feature材料；其既有异常语义保持。DSH独立视觉provider及其它在研能力不在范围。

## 4. 四段链的实现边界

### 4.1 当前事实适用性与文档差异

唯一事实输入组装继续落在 readCurrentDispositionInput；纯处置继续落在 resolveCurrentDisposition；权责继续由 resolveRepairResponsibility 求解。不得再建“第二个当前任务裁判”。原独立verifier承担语义核实，框架负责提供完整、可定位的当前材料和执行既定处置。

对旧发现先回答：它担心的哪条现行验收尚未满足；还是仅文档/预测未跟上已经完成的实现。按该发现涉及的AC和对象选择必要证据，复用现有phase-evidence、执行键、冻结原生结果、覆盖定位、源码/测试绑定和原核实链。用例名、ut_covered、单独的PASS字符串或“源码没改”都不足以自动认定验收满足；要核对应断言、实际执行、输入新鲜度及生产调用关系。不要把一条UT成功扩大为整项device验收或整个Feature通过。

适用性输入必须在阶段入口派作者、分配新作者调用之前具备。readCurrentDispositionInput与后续verifier请求共用材料选择：按已核发现的acceptance_ids及真实对象取得当前有效相关验收反证，核对原核实绑定的材料是否覆盖这些证据。原材料未覆盖、或无法确认覆盖时，复用既有verificationRequired将该发现转verify，交原验证方补核，沿completed_with_prior_review未复核材料的既有出口；不直接认定验收已满足，也不仍按旧repair先派作者。assess/共同输入层只读组装，不生成prompt、request、material或其它文件，不另做语义预裁判；真正签发仍由既有producer完成，材料选择必须与入口一致。

本次核实所需材料及已有直接反证在上述入口确定，并在当前request签发前完整准备；不能先核实，再因补上本就已知的UT/源码而无意义地换subject。以本次既有request/material中的路径、哈希及其绑定的冻结执行原件为材料锚；核实回写、发现关闭和本轮gate重跑不因open发现集合减少而移出反证、回摆subject或再派一次核实。恢复/后续组装沿该锚读取仍相关的材料，不仅凭“当前仍开放”重新选取，不修改历史原件，不新增持久字段、账本或另一份材料真源。

稳定的是这次核实选定且仍适用的材料，不是永久冻结subject：现行验收、相关业务输入/产物、生产代码、测试断言或执行条件有实质变化，冻结证据已失效，或出现真实相关矛盾/新增材料时，仍须刷新当前材料并按原机制失效/复验。仅UT/testing正常重跑、latest报告位置/时间或正常输出变化，不将可变latest长期纳入plan材料，也不以其反向重开上游。决定是否解除旧必修判断的新证据必须实际被核对，不能拿旧PASS冒充已审阅反证。下游证明只为该发现适用性提供必要只读依据，不把所有下游产物变成上游作者硬前置。

| 核实结果 | 处置与写入边界 |
|---|---|
| 当前有效证据已解决旧担忧，剩下非必需文档差异 | 原验证方据证关闭“妨碍验收”的判断；差异事实保留在现有报告/notes，或由合法负责方同步。不得自动新增验收义务、重开下游作者或重跑设备 |
| 可确定无歧义的说明/定位同步 | 沿既有投影、产物归属与局部验证更新记录；保留旧原件。必要的引用校验、重新绑定可执行，不等于重做业务 |
| 接口、验收、测试条件或真实权威发生实质变化 | 原责任方修订，按实际影响复验；旧测试不能冒领新增要求，不能因为只改文档就免验 |
| 无法判断是否满足、证据不足/失效 | 原验证方补核并给具体缺口；不自动修产品、不自签已满足，也不把未知清空为无问题 |

本次OTP已有真实实现与UT反证，首选有据处理旧发现，不能把“把六个方法补进契约并全链重签”写成固定答案。文档本身若被用户明确要求为必需交付，仍须完成；真实公共契约及权限约束不降级。

仅在现有可信旧值、归属和语义/执行输入能够证明等价时保留相关结果；记录材料变化而旧执行仍适用时，补最小必要校验/绑定。不得全局忽略contracts/use-cases，不得直接把旧manifest哈希换成新哈希洗白。没有等价依据时，沿既有受影响验证处理，并报告具体影响；也不为完成这次输入强行做不必要的文档改写。

原始verifier总结论保留兼容，不要求重写历史PASS。明确仅建议/已不再妨碍验收的当前结论通过原报告及既有逐条核实表示；不得由作者删acceptance_ids消除真实问题。普通文档建议用现有notes/报告披露，不默认新建发布债务或把所有文档漂移设为release阻断。

### 4.2 完整处置、送达与收口

顺序固定为：取得本轮原始检查、当前verifier、问题/诊断、拒修、有效证明和授权事实 → 唯一组装/处置 → 再生成作者任务、next_action、闭环资格及各终点投影。新写入后重算；同一动作内复用同一事实视图，不跨写入缓存。仅把旧decideNextAction挪到后面但仍按总PASS独立判断，不算完成。

harness writer和runtime核实必须共用诊断上下文组装，不分别挑reportText/rows/diagnostics等子集。唯一落点在repair-candidates.ts，收编现有phaseIssuesForVerifierSubject及其调用链；若需提取普通函数，命名为buildCurrentVerifierDiagnosisContext。输入是本轮project/feature/phase/run/subject、原请求与报告及既有拒修事实；输出完整现有ReviewDiagnosisContext（含reportText、rows、diagnostics、拒修依据和当前subject资格），供findUnreadableDiagnosisChecks等原判据消费。已有等价函数可直接复用并在C04记录，不保留两套组装。这只是共同输入层的子步骤，不是新的裁判、持久字段或协议；单次动作内可复用已完整读取的对象，新写入后刷新。已有必需/待核事实组装失败时沿7d9缺口语义保留影响；不把异常后的空数组当“已无问题”，也不把所有旁证/普通账本告警升级为必需。

每次派发的输入从既有当前处置取得本职可执行工作，包含：问题及依据、负责对象和权限、真正需要做的动作、原始报告/证据定位、复验条件。仍使用现有候选、prompt和phase_execute_request；摘要/指纹可有界，完整依据必须能通过原件路径定位，不能只剩截断的400字。

同阶段候选复用这条送达路径，不依赖backtrackRepairCandidates曾被赋值；相应文案不再假定总是“A downstream phase reported”。核实任务只交验证角色，不给产品作者一个泛化“补材料”任务。任务未送达且仍可执行时先补齐并继续，不用“等待”掩盖缺线。

本职责的真正必修工作未完成，不得给作者“已完成、停等”的动作。本阶段已完成而只剩合法下游工作时按c2交接；真实负面审查结论仍待修改方修好、原验证方复验，不因owner不同就签PASS。单职责只审查不被强制扩成开发。

回执检查继续证明回执自身有效，不能改写旧事实；是否可结束本次任务还须看当前处置。旧closed、有回执或原始PASS均不能遮住新义务。finalizer应按职责和当前动作决定，不再全排open_finding；自身正在发布的manifest/receipt等仍不能反向要求已发布。assess保留全部相关问题，不让“未闭环”占位遮掉具体必修项，也不强行把所有动作一次并发派出。

### 4.3 引用、facts与只补核恢复

引用解析继续从readableIssueEvidence及既有产物定位链收编：
- 支持当前材料能唯一确定的项目相对引用和Feature相对引用；归一后的label与verifier material文件项同为项目相对POSIX路径，经过phaseIssuesForVerifierSubject逐文件比对实测，写作示例、物化提示与读取器同口径。
- 不全仓猜同名文件；存在歧义时指出候选及缺什么，由原核实方明确。不越项目/授权边界，不扩大到其它Feature或秘密。
- 一个坏引用给具体诊断，保留其余有效引用；解析成功只证明定位/可读，不证明整条发现成立。必要证据仍不足时保留待核，不能自动confirmed。
- 复用既有evidenceFiles/diagnostics承载，不新增报告协议；普通上游问题单格式提示仍按c2非阻断反馈，不借统一输入升级为新门禁。

facts区分两个场景：
- 纯补核已有结果：已由合法下游产出且有可核来源的新增文件，不因上游头部/本阶段delta未抄这些路径而先制造一次内容失败；沿既有来源、归属和证明承接，机器能确定的登记不要求AI重抄。
- 确实需要理解的新输入：先提供本次必要阅读/准备任务，实际获取事实后再判断；不把别的阶段读过等同本作者读过。真实不可读、越界、未验证的关键输入和基线变化仍如实处理。

事实基线头部及原建立身份不改写，下游只追加其增量。不得靠全局关闭facts_scope_coverage放行；不能为省一次调用伪造“已读”。本次13个目标由合法产出/当前用途决定，PNG不因为在目标清单里就自动成为重新探索的产品阻断。

验证优先先消费§4.1派作者前的共同输入：本阶段当前工作确实只剩verify时，按已有调用事实决定复用，不以重试序号或有效phase PASS代替资格。收编reusablePassedInvocation与resolveValidationOnlyEligibility对phase_verdict的一刀切：S2虽记录外层FAIL，只要对应invoke已settled/已接收绑定报告、可追溯的该invoke gate原件/事件证明raw gate PASS、负面结论仅来自待重核发现的旧处置，且原产物与相关业务输入仍有效，就复用该invoke直接进入原gate＋核实路径，不分配新作者。不能拿本轮无对应绑定的PASS倒猜历史FAIL是假的；原件不足以确认负面来源、真实内容gate FAIL、产物或业务输入实质变化时，仍沿正常责任修复/受影响验证，不走此豁免。

删除“只能第一次重试补验”的计数近似；第二次或以后仍只有核实工作且满足上述资格时，保持原核实/正式gate路径。材料选择及稳定/刷新边界按§4.1，同一subject已尝试且没有新有效材料时，沿既有去重/闭环/无进展出口有界处理，说明具体尚缺什么，不重新申请整轮作者、无界新request或无唤醒条件的等待；真实新材料才给新的核实机会。原owner/epoch/fence、回退/失效、时限、PID和报告幂等边界保持。

### 4.4 预算、进展与停止

是否计内容重试按实际动作，不能按phase名称或原始FAIL标签：
- 纯补gate、核实和报告转录不消耗内容返修配额；其模型调用与耗时照现有总轮数/墙钟计入。
- 已交付明确任务的真实内容修复仍按原预算计数；不能“有一点变化就不计次”。
- 沿既有blocker签名、相关产物快照、调用记录与有界核实出口；不新增按问题计数器或指纹系统。
- 未送达的任务不能算“尝试修过仍失败”。同样不能以未送达为由抹掉已经消耗的真实总预算。
- 总预算不足仍停止，准确列未完成项、责任方、依据和下一步；需要外部条件时必须给真实解除条件，不能制造无唤醒条件的WAITING。

总调用计数、checkRunBudget的>=阈值及墙钟口径不变，只区分是否还需新模型调用。29→30的必要核实已启动并完成后，只要无需再调用模型且墙钟允许，原正式gate、closure、finalizer及完成投影仍可完成，不因本轮刚到30而错误拒绝机器收口；不得借此启动第31次调用。30/30起步仍有必要核实时必须停budget_turns，保留具体待核任务。真实gate FAIL或产物/业务输入实质变化不能假扮纯机器收口或借验证优先跳过必修。

现有prompt_written/调用原件和事件足以供开发期断言任务送达，不增加“作者已读”回执、确认字段或人工审批。测试证明输入完整且动作一致，不声称可证明模型心理上理解或保证模型永不犯错。

预算现状已核：resolveTaskAutomationPolicy返回defaultBudgetChangeAuthorized，但不是自动增额执行器；buildBudgetExhaustedGuidance明写runner不自行增额，获授权的主Agent通过修改预算及--override-manifest恢复。countAgentInvokeStarts统计阶段与辅助invoke，vision_canary按现行契约只计墙钟而不占轮；这不是免费调用，实际调用次数仍单列。本批不新增runner自动加轮机制、不改总预算口径或wall地板公式，不能依赖隐含扩额过验收。

## 5. 机制准入与不采用方案

| 调整 | 具体场景与收益 | 复用 / 裁剪边界 |
|---|---|---|
| 完整当前任务输入组装 | S2的next_action先于诊断/候选，作者收不到实际工作 | 收编readCurrentDispositionInput及现有writer，不新增任务账本、持久字段或第二裁判 |
| 同职责与核实任务接线 | S2必修项被旧总PASS/闭环指令遮住，补核退回作者 | 复用候选、请求原件、invoke和恢复动作，删除旧独立规则，不建送达协议 |
| 有上下文的引用与诊断 | 真实Feature相对引用和空Diagnostics消耗返修 | 扩展现有解析的内存上下文/诊断，不新建引用登记表或格式版本 |
| 文档差异按适用性处理 | AC-3/BD-2已有实证却因规划落后重开 | 原verifier有据关闭/原owner合法同步，复用新鲜度和执行键；不新增“文档一律免验”通道 |
| 目的明确的来源准备 | 本次13个后来目标触发初次coverage失败 | 复用已有基线、合法写入/产物来源和增量，不改历史、不宣称没发生的阅读 |

本计划不授权新增阻断检查、停机原因、持久状态/字段、注册表、预算池或审批点。若实现证明现有载体确实不足，先明确实际场景、收益和为何不能复用，再按AGENTS处理，不能默默添上。

不采用：按acceptance_to_interface或Feature名特判；全MAJOR升级/全UNKNOWN放行；重写原PASS或原事件；为文档改动豁免所有契约；另建“已交代/已满足”账本；给空候选再造一套指纹；以等待替代可执行工作；通过新run、重置预算或提高额度让回放绿；先让主Agent临场手改宿主消除故障。

四条总原则原文不改。实施时沿现有OpenSpec变更流程同步受影响的goal-runner、runtime-policy、verifier/责任/恢复规范；本轮起草不生成其它提案文件。所有前序已完成开发范围保留，仅收编本批明确冲突的消费/指引。

## 6. 验收：证明送达、适用性与实际完成

### 6.1 测试边界

历史诊断层保留S2原来的失败；生产层用真实输入喂新代码验证正确动作，不修改历史日志使其“通过”。正式reader、处置、责任、scope、gate、closure、完成原件及最终消费者不得替身。允许有界作者/verifier/SDK替身，但它们只按实际收到的任务和材料行动：可有有限修复算法，不能预先知道框架未交代的责任方、下一阶段或应改哪份文件。不得按phase名直接补蓝图，再将此称为送达验收。

至少一条真实模型执行验证“静态/原总PASS中有本阶段必修项”的实际作者闭环：从正常入口读取实际物化Skill/模板、当前request和动作，到授权终点。不得给测试专供提示替框架指出应修项以绕过旧规则。沿既有CLI/运输验收脚本，记录实际执行者、模型、输入与输出，不能将CLI存在或adapter名称当实测。模型选择属于执行时安排，不固化开发分工。

真实调用验证与可重复故障注入分开：程序替身只能遵从公开动作和自身权限；把生产送达或下一步改坏时，应因缺任务/错误收口而不修、无法完成，不能仍自动给出预设正确产物。不得用源码正则或手填PASS替代生产接线。

### 6.2 场景与反例

| 场景 | 正例终点 | 必须保留的反例 |
|---|---|---|
| S2验收已满足的文档漂移 | 派作者前同源反证将旧发现转verify，严格复用plan-i28；原累计29→30仅1次计入预算的plan核实恢复调用、0次plan作者，invokeOutOfChain不因先耗作者而拒绝；核实后无模型的gate/closure/finalizer在墙钟内收口，正式Feature/CU/公开下一步完成 | 30/30起步仍需核实时停budget_turns并列任务，不给第31次；对应invoke真实gate FAIL、来源不可确认、产物/业务输入实质变化不得复用；同名测试、失效执行或断言不覆盖该义务不能误放 |
| S2材料稳定与下游跳过 | 反证由既有request/material及冻结执行原件承接，核实关闭与gate重跑不回摆subject；coding/review/ut/testing各自旧PASS且完成问题为空，在预算检查前跳过，四段零新调用 | 关闭后UT/testing正常重跑、latest报告变化不改变plan subject、不重开plan；真实相关验收/输入或绑定证据失效必须刷新/复验，下游若有真实缺口不得将四段跳过或本例记成功 |
| 真正变化的契约/验收 | 有授权的新要求由责任方处理并复验受影响部分，旧有效部分复用 | 不能用“文档变化”或旧PASS冒领新接口、新数据约束、新测试条件 |
| spec/plan本阶段必修MAJOR、原总PASS | 自检下一步和实际作者输入明确该项，实际修本职产物、原verifier核后才能收口 | 删除同阶段送达或恢复旧“只修BLOCKER”时相应用例失败；建议MAJOR不被升级 |
| 跨职责发现/下游必做 | 合法修复方执行、原验证方复验、到授权终点；原本属于下游的工作带入而不误扣当前阶段 | 不因owner不同伪造负面审查PASS；不派给无能力/未授权阶段 |
| 仅核实的第二/第三轮 | 以对应invoke原件确认严格资格，包含raw gate PASS而外层旧发现FAIL；入口已转verify，复用有效作者工作，只走核实与正式gate，总资源照计 | 真gate FAIL、不能追溯负面来源或新内容实质失效需修时，不得套旧invoke跳过作者 |
| 项目相对/Feature相对证据 | 合法唯一引用归一为与material同形的项目相对POSIX label，经phaseIssuesForVerifierSubject得出相同当前解释；坏引用具体诊断，其余有效引用保留 | 歧义、越界、必要证据缺失不能自动confirmed；问题单普通格式告警不升级 |
| 合法下游新增来源及PNG | 纯补验承接已有来源，不先耗一次内容失败，不改facts头部 | 不可读/越界/真正新关键输入仍处理；不把其它阶段读过说成本作者已读 |
| unclosed占位与具体任务并存 | 作者收到真正要做的事，先处理再完成本职闭环 | 不只提示填回执，也不因本事务尚未发布证明而死锁 |
| 有效旧回执与新真实义务 | 历史证明保留，新义务正常送达和履行 | 新编号复述已满足验收不被当新义务；旧回执不能遮真正新增工作 |
| 未送达与预算 | 仍有预算/条件时补齐任务并继续，不能宣称内容修复已耗尽 | 总预算耗尽仍停且具体说明；已执行内容修复不能以有进展免计 |
| 合法披露和旧兼容输入 | visual/asset发布限制保留；普通完成不被软残差撤销；旧未分类SKIP、无DAG/interfaces输入不补造 | 真实hard、必需证据缺失、实际断言失败不能被披露盖过 |
| 会话/后台/request | 同任务/授权/事实的两运输动作一致；请求按自身终点完成 | 只审查不扩成开发；真实权限/硬上限/依赖边界不因模式放开 |
| 提交与旧记录 | 夹具可在干净检出还原原始SHA；旧有效成果仍可消费 | 不拿后改报告代替已覆盖的历史字节，不手填完成事件或修改旧证明 |

同一场景至少断言：当前处置、harness/公开next、执行者原件、回执/closure、真实修改或零修改、原验证者、终点/报告一致。应执行时不得只有建议文字；无需执行时不得因修文档而产生无效作者或设备调用。

关键生产变异至少覆盖：先算动作后补候选；同阶段候选未送达；一律排除open_finding；丢诊断上下文；按重试序号或有效phase PASS一刀切退回作者；有效实证不参与旧发现适用性；纯记录漂移导致业务重做。删除派作者前共同输入中的验收反证必须使S2回放变红：会先耗作者至30、随后必要核实预算拒绝，不能靠替身预知答案仍通过。反例和合理等价保护如实记录，不为让每个局部变异红而删除其它有效保护。已有必修项是否收到，以实际调用原件为准，不新增运行时送达门禁。

### 6.3 验证与交付

用现有registered suites覆盖新增行为：current-disposition-recovery、verifier-semantic-handoff、verifier-production-routing、check-receipt-policy、phase-closure-finalizer、goal-assess-driver、context-facts/事实准入相关、request与session-transport-parity、上游问题/责任恢复及真实S2回放。新增用例注册到现有run-unit，不新建运行器。

稳定源码跑一次官方验收（在harness目录）：

    npm test

仓根检查：

    npm run openspec:validate
    node scripts/check-plan-version.mjs
    git diff --check

受影响release-only按实际用例分片并行，范围包括real-chain/real-chain-seams、fe4512-semantic-recovery及owner-repair、reliability-scenarios四组、design-authority-repair四组、change-unit-revision-recovery、lifecycle-evolution、session-transport-parity/slow-gate和直接恢复分片。核用例选择器与非空命中，不能把SKIP算通过。改规则/指纹须补所有migrateHostSnapshot消费者；只改提示/生成模板或验收状态时按实际影响验证，已有未变结果可按AGENTS比例性复用。不要为了小返修重复全量或重复多条重型长链。禁止release:all/candidate:build等会打包的命令。

所有新可编辑文本LF；机器原件按已登记的字节保全/可逆归一处理，原件尾空白不为格式绿而修改。结果存harness/reports/c6ae8b4f/，包含原件清单/缺口、C01–C23逐项收编、实际送达原件、最终源码哈希、选择器/结果、变异、真实模型与独立检视、调用/门禁/设备成本分列。交付不得只报测试总数：必须回答这次是否真正完成、哪些证据复用、是否新增内容作者/设备执行、尚有哪些发布限制。

## 7. t8：原run接续与预计消耗

当前基线：29/30个计入上限的调用，约290分钟；阶段作者与辅助核实分别列出。manifest的max_retries_per_phase=2、max_total_turns=30、wall_clock_minutes=480均未手改。本次有效540分钟来自既有队列时限地板，不能记成“自动增加60分钟恢复奖励”。

本例的成功预期必须在开发回放先验证：保持原29/30累计，入口已将未覆盖当前反证的旧发现转verify，并按§4.3的对应invoke原件严格复用plan-i28；硬断言**29→30仅1次计入预算的plan核实恢复调用、0次plan作者**。反证一次完整进入request/material，核实关闭及本轮gate重跑不得回摆subject再索取调用；不漏算verifier/格式修复，也不省略必要独立核实或伪造结论。计数到30后，正式gate、closure、finalizer和完成投影只要无需模型且墙钟允许仍须完成，不能在新一轮入口误以轮满拒绝本轮机器收口。金丝雀按现行计轮例外及实际必要性处理，真实调用与墙钟单列，不隐藏。

本例不应改动既有业务实现/测试，不应重跑真机；必要的正式门禁、记录校验、合法绑定重评照常执行。spec及下游结果由生产reader核当前输入；coding/review/ut/testing须以各自有效旧PASS＋完成问题为空，在预算检查前直接跳过，回放断言四段零新调用，不预先免掉新鲜度检查。若plan重新闭环确实使下游证据失效或发现真实缺口，必须按缺口处理，不能把本例记成功。成功需有效完成原件、Feature complete、适用CU VALID、公开Feature状态/下一步及再次接续一致，视觉/发布限制如实保留。

若从30/30起步仍需核实，或新的真实缺口/额外必要核实确使剩余1轮不够：真实停budget_turns，不给第31次调用，不把本例写绿，不隐式扩轮或起新run刷新。真gate FAIL、产物/业务输入实质变化不能走只核实或满额机器收口豁免。明确具体任务、负责方、已有实证和剩余预算；获原用户授权的预算有权者可按现有“仅改预算字段＋--override-manifest”接回同一请求，累计不清零，用户显式硬上限不可突破。本计划不把这种增额当作S2预期节省成功的证据，也不新造自动加轮服务。

t8仅在用户安排发布后执行；本轮和开发期均不运行宿主gate/安装包/操作手机。保留fe4512现场至适用观察结束，不推倒重来、不清理特性目录。与6fd t8、a47 R5/H1及前序适用联合项共用一次真实观察，各自缺口分别判断，全部未验证项保持pending；395引导分支仍仅有开发接线覆盖，不保留或制造OOBE场景。

## 8. 起草状态

2026-10-26：基于fb3ef864、当前只读现场及合并讨论起草；首轮独立评审提出M1后，本次仅补齐派作者前反证、严格只核实资格、材料稳定/刷新和满额机器收口边界，同步a47 R6。t1–t8均pending，尚未实施、未作本计划开发验收；独立计划复核通过，尚未实施，等待用户实施指令。静态计划检查不代表检视通过或已交付，实际调用记录保留在检视报告目录。

