---
name: 六阶段重构 B01 — 负面结果verifier回修施工图与过时指令删除
overview: 窄放行可诊断的review/UT产品失败，接通请求、输出、候选和下一步；保留产品FAIL、Task协议、原生执行与completion probe。
version: 3.0.0
todos:
  - id: b01-reproduce-matrix
    content: 扩展verifier-production-routing/repair-candidates生产集成，从真实UT失败格式器和完整script-report取输入，覆盖结构化优先/原文回退、终态自洽、goal与非goal的harness次数及原矩阵。
    status: completed
  - id: b01-producer-routing
    content: 在verifier-plan.ts实现D1纯判据，供Step4与writeRunSummaryBase共用；窄放行review两类负面和UT code_regression，不改产品verdict/closure。
    status: completed
  - id: b01-ut-failure-attribution
    content: 按D1补齐真实UT断言失败的failure_kind生产，保留结构化优先和details旧格式回退；完整执行/真实失败记录才可标code_regression，混合环境和未执行不冒充。
    status: completed
  - id: b01-result-parsing
    content: 按D3修改parseVerifierCheckStatus，复用extractTables读取正式汇总与旧YAML，冲突不采信，消费者结果等值。
    status: completed
  - id: b01-repair-and-guidance
    content: 按D2/D4接通run_verifier_for_repair、NEXT和失败回喂；正式goal写报告后交回runner外层harness，非goal才由agent重跑，生成当前subject候选沿assess回owner，FAIL不finalize。
    status: completed
  - id: b01-adapter-transport
    content: 按D5只核对09-05已确认的Claude/Codex Task verifier契约、调用方写报告和codeagent共享模板，不抽象传输层或改能力声明。
    status: completed
  - id: b01-remove-stale-instructions
    content: 按D6删除后续phase旧MUST subagent/数量要求、goal旧attestation BLOCKER、无provider旧critic要求；保留建立阶段与真实安全约束。
    status: completed
  - id: b01-contract-sync
    content: 按D7同步最小OpenSpec delta、六阶段Skill、Claude/.cac模板、Codex bundle和相关错误注释，使失败可诊断但不能推进产品。
    status: completed
  - id: b01-local-acceptance
    content: 按命令表完成typecheck、目标生产链测试及candidate构建全量验收，准备候选件与bc-openCard-1受影响窗口的精确宿主命令。
    status: completed
  - id: b01-host-acceptance
    content: 用户触发候选件集成和C-U goal回归后，核对负面诊断→owner修复→窗口闭环及无直接回归；证据通过后验收B01并细化B02。
    status: pending
---

# B01施工图

总plan：[9c6e2a41](pipeline_master_9c6e2a41.plan.md)。2026-09-06按Claude评审细化。本批只实现F01/F02及明确F09删除；B02至B06须滚动细化，不凭提纲顺带实施。

## 1. 问题边界

生产链：harness-runner Step4只在脚本PASS装配 → writeRunSummaryBase再以PASS签request → buildSummaryRepairCandidates要求verifier正文 → 产品FAIL留原phase重试。review的negative_verdict_closure/conditional_pass_closure和UT真实断言失败都命中。

临时工程驱动生产writer已确认：report_validity=PASS、verdict=FAIL、request=null、repair_candidates=[]、next_action=fix_blockers_then_rerun。生产解析器另确认：同样两个UT语义PASS，YAML产coding候选，正式Markdown汇总表产零候选。

本轮按V2追到真实生产端：buildUtHvigorTestFailDetails接收一个executed=true、total=1/failed=1且有失败用例的结果时，普通断言分支返回failureKind未定义，details也不含“失败归因：code_regression”；经现有候选组装仍为零。先前仅手造failure_kind的fixture没覆盖此断点。补字段生产属于F01/V2根因闭环，不扩展其它UT执行机制。

报告合法、产品不通过与“这个失败可信”是不同事实。本批打通诊断到现有回修，不把verifier PASS当产品PASS，不要求失败phase先closed。

## 2. 非目标

- 不改completion probe/grace/kill、Codex terminal仲裁、硬预算；不为等待阶段全文改生命周期。
- 不删inline canary或改视觉回执/非goal视觉资格，交B02。
- 不重构UT底层出包/运行、缓存、revalidate范围、one-shot或prior PASS政策；仅按D2省去goal写报告后的agent侧重复harness。
- 不建传输接口、Task映射层、能力注册层、诊断phase、修复账本或审核服务。
- 不重构测试质量/DAG/mock体系，不新增codeagent/attended真实支持。
- 不自动替换HMOS主宿主framework或物化入口，宿主运行由用户触发。

## 3. 决策纪要

### D0：现有真源与状态保留

保留resolveVerifierPlan的enabled/disabled、现有Task request/原始报告协议；调用方写summary.verifier_report。复用report_validity、产品质量轴、repair_candidates、closure_status和assess/driver；不增summary顶层裁决状态或新的完成回执。

### D1：request生产资格精确到现行失败

在 [verifier-plan.ts](../../harness/scripts/utils/verifier-plan.ts) 增加小型纯函数canProduceVerifierRequest，输入本轮verifier plan、phase、脚本verdict/checks、报告有效性及既有capability blocked投影，输出boolean。只判资格，不读模型、不执行provider、不建新模块或配置。Step4和writer共用。

| 条件 | 生产request |
|---|---|
| verifier disabled | 否；not_reviewed/off/not_applicable原语义保留 |
| enabled且脚本PASS | 按原成功路径，不顺带改变原资格 |
| review脚本FAIL；report_validity=PASS；至少一个BLOCKER FAIL；所有BLOCKER FAIL仅为negative_verdict_closure/conditional_pass_closure；无其他BLOCKER SKIP或blocked capability | 是，诊断负面产品 |
| ut脚本FAIL；ut_hvigor_build=PASS；ut_hvigor_test=FAIL且归因按下文统一优先级解析为code_regression；除此之外无BLOCKER FAIL/SKIP或blocked capability；报告有效性非FAIL | 是，核对测试语义 |
| 其它FAIL/INCOMPLETE、缺源码、坏格式/UT结构、编译/设备/工具失败、混合负面与材料错误 | 否，保留先修输入/环境的出路 |

UT不机械要求report_validity=PASS：纯UT可能未执行报告格式检查而合法为UNVERIFIED，资格靠真实UT结构/编译结果。ut_run_status是MINOR WARN派生面板，不能因can_claim_done=NO再拦已经允许的断言诊断。零测试、未完整执行或环境错误不得改归code_regression。

归因口径明确为：CheckResult.failure_kind优先；缺失时才用现有extractFailureClassification(details)的“失败归因：xxx”原文回退。classification是summary/候选内层的派生字段，不是原始CheckResult的输入。Step4资格与writer/candidate使用相同优先级及现有回退解析器，不复制另一段正则。结构化device/toolchain分类与文本冲突时以结构化为准。

生产端最小补接位置：[ut-host-impl.checkUtHvigorTest](../../profiles/hmos-app/harness/ut-host-impl.ts) 的最终失败返回。仅当选中模块均有真实执行结果、所有bad模块均已执行且testResult.total>0、failed>0并有实际failures、且不存在toolMissing、timedOut、非clear的installBlocking或onDeviceFailureEvidence所示环境/运行基础故障时，输出既有failure_kind=code_regression；否则保留 [ut-hvigor-test-failure](../../profiles/hmos-app/harness/ut-hvigor-test-failure.ts) 的原归因或unknown，不能把所有非工具链错误默认当产品缺陷。这里表示可进入测试语义诊断，是否真要改产品仍由verifier合取决定。details继续保留真实格式器原文，不为凑正则改写日志。

has_blocked复用 [deriveSummaryVerdictLattice](../../harness/scripts/utils/quality-axes.ts) 已有纯投影，两处输入一致，不再运行provider。测试必须用真实完整script-report形状（含派生面板），不能只造单FAIL而隐藏伴随阻塞。

### D2：生产与回修顺序

1. [harness-runner.ts](../../harness/harness-runner.ts) 的Step4与writeRunSummaryBase共用D1；允许时仍按原collectContextFiles、assembleAIPrompt、buildVerifierMaterialView、issueVerifierRequest链执行，崩溃回写FAIL照旧。仅D1负面分支在ai-prompt中附加“本轮为产品失败诊断”说明，列出已允许的失败check及仍须验证的语义；作为既有assembleAIPrompt的内存选项/正文处理，不新增request字段或持久模式。verifier仍读取原始FAIL报告，不投影成假PASS。
2. 产品FAIL仍为FAIL、exit 1、closure=open。既有next_action增加一个动作字符串run_verifier_for_repair，仅用于D1负面分支且缺当前可用正文；不是新phase或状态机，PASS路径不改。
3. decideNextAction在D1确认资格后优先处理该动作，避免UT面板can_claim_done=NO吞掉它；未获D1资格的环境/材料问题保留原分流。
4. buildNextLine先处理该动作，再处理“非PASS都先修”的通用分支；失败控制台必须给request路径、写报告路径与后续命令，不能仅在PASS时显示verifier指引。
5. agent按现有协议调verifier并写原始回复。正式GoalPhaseRuntime编排中（含其attended bridge），写完即结束本轮，回传当前FAIL和summary/报告路径，由runner现成的外层runHarnessPhase消费报告、重算候选；agent不再额外跑harness。非goal没有这次外层执行，才由agent重跑同phase现有harness。材料没变则subject相同；不调finalizer把FAIL关环、不建“只发布候选”CLI。不能只凭用户说“goal”、native元数据或残留环境变量就假定外层必跑；现有运行上下文须确认真实编排路径。
6. 外层或非goal重跑产出候选后，NEXT/goal失败回喂显示owner和已有assess建议；当前phase不改产品。goal沿既有candidate→owner链，非goal按原授权执行/提示正确owner。goal phase-executor在写报告后的回传不要求候选已生成或phase已closed，否则又会逼它自行重跑；attended回调不得为此假报passed。
7. 产品修好后照旧harness PASS与finalizer闭环；check-receipt继续拒绝FAIL完成。不能用“失败已被审查确认”改写质量结果。

### D3：正式输出与解析等值

改 [repair-candidates.parseVerifierCheckStatus](../../harness/scripts/utils/repair-candidates.ts)，复用 [markdown-parser.extractTables](../../harness/scripts/utils/markdown-parser.ts) 读取含精确id/status表头的正式汇总；保留旧“- id / status”YAML。只认PASS/FAIL/WARN，同条一致重复可去重，冲突/坏状态不采信并走未确认/格式修复提示，不选择有利PASS。

end_to_end_driving、business_assertion_value、device_ac_delegation共用解析口径。不要要求模型额外补PASS YAML；review的issue-verification及内容绑定不改，不用汇总PASS替代逐条confirmed。

两分支终态均沿用唯一含义：B为本轮verifier自身语义检查中severity=BLOCKER且status=FAIL的项数，blocker_count=B；B=0时verdict=PASS，B>0时verdict=FAIL。回显当前subject，禁止FAIL/0或PASS/非0。confirmed产品缺陷数不计入B，不改变终态字段的既有语义。

| 诊断报告情形 | 报告终态 | 产品/候选含义 |
|---|---|---|
| review报告准确，确认N条未关闭产品问题，本轮审查自身无BLOCKER FAIL | PASS / 0 | issue-verification逐条confirmed可产生候选；产品summary仍FAIL/open，不代表产品合格 |
| review有真实误报/论证等语义BLOCKER FAIL | FAIL / B（B>0） | 按实际失败修报告；已有逐条候选仍只由其现行确认/绑定条件决定，不用整报终态替代逐条结果 |
| review未确认任何问题，只有unclear/WARN且无语义BLOCKER FAIL | PASS / 0 | 不产生未经确认的coding候选，产品不能因此自动放行 |
| UT测试语义有效，两个候选必需检查PASS且本轮无其它语义BLOCKER FAIL | PASS / 0 | ut_hvigor_test的产品执行FAIL保持；其它合取满足才产coding候选 |
| UT测试语义存在真实BLOCKER FAIL | FAIL / B（B>0） | 修相应测试/验收材料；各候选仍按已有逐检查合取，不从报告FAIL猜产品根因 |

因此不采用“review诊断固定FAIL、blocker_count等于confirmed条数”：confirmed可能是MAJOR产品问题，甚至为0；该写法会混淆报告与产品裁决，并可能制造FAIL/0。现有loader对PASS/0和自洽FAIL/B均可读取，无需更改它的接收规则。

### D4：当前材料绑定和失败后的出口

writer仍按本轮签发subject读报告；旧材料/缺正文/坏终态不能造当前候选。成功闭环的prior PASS政策不变。UT的failure_kind及真实details透传给buildSummaryRepairCandidates，按D1结构化优先/原文回退解析；不能只在内层测试传classification而绕过真实接线。

phase-closure-finalizer仍只服务产品PASS后的原路径，不扩事务；FAIL诊断后的候选由goal外层harness或非goal agent重跑的writer产生。assess/runtime的候选优先路由以组合测试证明；必要时只改extractPriorFailureContext/Prompt对诊断动作的显示，不重做推进器。

verifier判误报/测试错误时修review报告或UT材料；未确认问题不发coding凭猜测改产品。格式错误优先从已有原始回复重写，确无有效回复才重调。

**"正文不可采信"的判据（codex一轮返修补写）**：终态自洽只证明报告有个合法结论块。诊断轮还须能从正文读出**本次诊断的必需检查项**——ut是end_to_end_driving与business_assertion_value，review是issue-verification逐条验证块；缺项/冲突/占位一律视同缺可用正文，仍走run_verifier_for_repair并在NEXT给"按原始回复重写报告"的出口，不落回通用"先修blocker"。**放弃的准确性**：必需项只覆盖上述两处既有解析器的口径，review逐条内容是否新鲜/自洽、ut其余语义检查项写坏，本判据都读不出来，仍按既有未确认通道处理；换来的是不新增第三套报告校验器、不新增动作字符串与状态机。

### D5：adapter只核对现状

接受 [Codex adapter](../../agents/codex/adapter.yaml) 的09-05已确认verifier_subagent=true与Task/subagent_type=verifier契约。Claude/codeagent沿用现状，报告发布不依赖SubagentStop。撤回旧计划“Codex不存在该API”的未经实测断言。

C-U/C-N/X-U/X-N覆盖生产接线，K/A做模板/fixture。只核源模板、生成器与物化内容一致，不抽象工具传输、不改能力声明。真实宿主以后出现工具差异再按事实处理。

### D6：前移已确认的过时指令删除

| 源头 | 具体修改 | 保留 |
|---|---|---|
| plan/coding Skill、agent-behavioral-principles/reference中后续phase默认MUST subagent/最低数量 | 改为facts增量；量化要求限定建立阶段/旧兼容路径 | 必要实际阅读、复杂问题探索、建立阶段与兼容代码 |
| goal runtime的attestation-locked/BLOCKER提示 | 改为现行漂移分级WARN及owner责任说明，不改check实现 | 禁止测试捷径、禁止越权改需求/契约 |
| device-testing-workflow-detail无provider也强要critic/region_attest | 按现行分支限定适用条件，不重写视觉协议 | 有provider检查、几何/内容/样式缺口披露 |
| 六阶段“脚本非PASS禁止verifier”、共享bundle缺request推断 | 增加D1窄例外，消费NEXT；无request区分disabled与材料/环境未就绪 | 产品FAIL不能推进下游，manual/batch权限 |
| verify-ut.md中任意源码漂移都BLOCKER的旧断言 | 对齐现有ut_no_src_mutation分级WARN，不让verifier重新施加已退役的硬门 | 原有owner纪律、真实产品错误与测试语义检查 |

只删除与代码冲突的要求，不将所有BLOCKER降级；attended禁问实际逻辑仍交B03细化，不顺带重构native /goal。

### D7：规格与文档同步

实施时创建最小OpenSpec change verifier-repair-diagnostics，修改harness-gates、agent-adapters、feature-artifact-layout中的相关诊断/输出条款；只改行为涉及的条款，不铺开整个pipeline规格。按现有流程校验，不另加审批机制。

同步verify-review/verify-ut、六阶段AI Harness段落、Claude phase-executor/verifier模板、codeagent共享引用、Codex共享bundle真实生成器。特别修改 [verifier.md](../../agents/claude/templates/agents/verifier.md) 的description与第3步“脚本FAIL/can_claim_done=false就停止全部语义检查”，以及 [verify-ut.md](../../harness/prompts/verify-ut.md) 前置第6条：D1诊断请求下允许测试语义核对，报告终态只表示本轮语义检查结论，产品执行FAIL仍原样保留，不能强迫报告继承产品FAIL而跳过两个候选必需检查。正常验证请求的原生编译/执行约束不降低。新增诊断正文和这些接收端约束必须同一变更组交付，不能只改request生产者。

两个诊断分支的正文与唯一终态块均明确引用D3的计数/例子；phase-executor、NEXT和失败回喂明确D2的goal交回runner/非goal自行重跑区别。不得保留“所有模式写报告后必重跑harness”的旧指令。

触及代码旁已经与material寻址/报告发布矛盾的注释随修，不全仓改历史记录。

### D8：本批即上宿主

本地通过后准备candidate。用户触发或明确委托集成到HMOS验收副本，以bc-openCard-1有效上游跑C-U受影响窗口。验收须观察review/UT诊断→候选→owner修复→窗口闭环，不只跑无缺陷happy path。

需要可控缺陷时仅在用户认可的验收输入/隔离副本中使用，不故意破坏主宿主，不改summary/签名造失败。旧问题若阻挡目标测试，记录真实前置，调整已知顺序；不假PASS、不越批热修。用户未触发则host todo pending，不能把本地通过当B01完成。

## 4. 文件与提交边界

S0至S3是可审查提交/变更组，不要求自动git commit。

| 组 | 文件/函数 | 内容与验证 |
|---|---|---|
| S0 指令清理 | D6的Skill/reference、goal提示字符串、共享模板 | 纯对齐已实现行为；查diff，不改阈值/执行器 |
| S1 请求与下一步 | ut-host-impl真实断言归因；verifier-plan纯函数；harness-runner Step4/writer/decideNextAction/buildNextLine；report-generator诊断正文；verifier.md/verify-ut接收前置；必要失败回喂 | D1/D2真实formatter至writer矩阵、request、NEXT、verifier可审、产品FAIL/open、goal零额外重跑 |
| S2 解析与候选 | repair-candidates状态解析及现有组装、必要调用方指引 | D3/D4同subject报告→候选→owner组合 |
| S3 规格与验收 | 小型OpenSpec delta、现有测试、迁移说明 | 命令表与用户触发C-U证据；不夹带B02至B06生产改动 |

扩展现有verifier-production-routing、repair-candidates、verifier-plan、verifier-evidence、goal-phase-runtime、context-facts、codeagent-adapter单测，不新增测试框架。

## 5. 接受的准确性边界

| 取舍 | 接受的边界 | 仍须保证 |
|---|---|---|
| D1只开放已复现失败 | 其它失败未必自动诊断，有新证据再扩 | 不把材料/环境错误交coding |
| 不证明报告不可篡改 | 原样报告仍可能误改，沿现有恢复处理 | 当前subject、解析一致、质量FAIL不变 |
| Markdown/YAML兼容 | 非规范自由文本可能无法采信，需修格式 | 正式Prompt必可读，冲突不能选PASS |
| 保留completion probe | 非必要阶段尾部叙述或usage细节可能截断 | 磁盘质量事实、终态和预算正确；B02去inline依赖 |
| 诊断后由现成执行方重算 | 非goal仍需一次harness；goal只用runner原有外层执行 | 不新增agent侧goal重跑，不建轻量发布机制，B03再处理其它重复成本 |
| 不改adapter能力层 | K/A不承诺本机实测支持 | C/X已确认协议不凭猜测推翻，标清fixture等级 |
| 不改测试/审查质量体系 | 现有覆盖与误报上限仍在 | 真问题可回修，误报留报告层，不能改正确产品 |

## 6. 验收用例

| ID | 输入 | 必须观察到 |
|---|---|---|
| V1 | 完整合法review的negative/conditional产品FAIL | request→逐条confirmed及报告PASS/0→同subject外层或非goal重算→candidate→assess回owner；产品仍FAIL/open |
| V2 | 从真实UT失败formatter/ut-host返回及完整报告构造，保留原文details、compile PASS和ut_run_status WARN | 先复现普通失败缺归因的断点，再验证最小生产字段补齐；另测缺结构化字段但有真实旧“失败归因”原文的回退，以及结构化环境故障优先；不可只造classification/code_regression |
| V3 | 负面同时缺源码/坏表，或UT编译/设备/注册/结构失败 | 不放行诊断例外，NEXT指材料/环境，不改产品 |
| V4 | 表格/旧YAML、同义重复/冲突/缺项；D3两分支终态含confirmed=0/非0 | 同义等值，冲突不采信；PASS/0、真实语义FAIL/B可由loader读；FAIL/0、PASS/非0拒收；confirmed数不充blocker_count |
| V5 | 材料变化、旧报告、坏终态、refuted | 不借旧正文造候选；修报告/UT，不盲改产品 |
| V6 | 正常PASS、disabled、lite | 原闭环/skip不回归，无新hook/能力要求 |
| V7 | C/X的U/N与K/A补充fixture | 诊断语义一致；goal写报告至交回runtime间agent侧harness新增调用数为0，外层仅原有一次；非goal由agent一次重跑；attended不等候选/closed才回传，不假报passed |
| V8 | facts delta、漂移WARN、无provider提示 | 旧硬文案消除，建立阶段/安全约束仍在 |
| V9 | 用户触发C-U宿主受影响窗口 | 真实调用、所改路径、正确回修后窗口闭环，有候选件与日志，无直接回归 |

## 7. 命令与完成判据

开发仓根执行。已核对 [select-suites.ts](../../harness/tests/utils/select-suites.ts)：filter先按suite.id.includes(filter)选套件，命中才只运行这些suite；verifier-是合法子串过滤，生产函数已确认只选中verifier-plan、verifier-evidence、verifier-production-routing、verifier-material四个。无suite命中才回退为“跑全套后过滤用例名”，不能任意拼接多个id。

    node scripts/check-plan-version.mjs
    npm --prefix harness run typecheck
    npm --prefix harness run test:unit -- --filter verifier-
    npm --prefix harness run test:unit -- --filter repair-candidates
    npm --prefix harness run test:unit -- --filter goal-phase-runtime
    npm --prefix harness run test:unit -- --filter context-facts
    npm --prefix harness run test:unit -- --filter codeagent-adapter
    npm run openspec:validate
    npm run candidate:build

纯文案返修只查相关diff/plan；生产变更跑目标检查。candidate:build包含的typecheck、unit、fixture、zip校验作全量验收，不在它前后另跑重复npm test。

实施方在候选件准备好后，填入真实路径与合法窗口，交用户触发；以下为已存在CLI模板，不得原样执行占位符：

    # 在用户已集成候选件的验收宿主 framework/harness 执行
    npx ts-node scripts/goal-runner.ts --feature bc-openCard-1 --adapter claude --requirement-file '<原始需求文件绝对路径>' --start '<有效上游之后的受影响起点>' --end '<本批窗口终点>' --detach

有可恢复run时使用真实run_id的原resume协议，不混fresh/resume参数；上游无效从实际需重验的最上游开始，不伪造上游闭环，不改变原需求/授权范围。

本地完成：V1至V8与相应检查通过，候选件可交用户。本批完成：V9也通过，证据记入已有维护/宿主报告，本批todo才可completed，总里程碑随后完成。诊断FAIL是中间态，不能算窗口完成；之后再细化B02，不提前实施后续提纲。

## 实施记录

### 2026-09-06：S0–S3 本地实施（未提交、未跑宿主）

**S0 指令清理（D6）** — 只改与已实现行为冲突的句子，不整段重写：

| 文件 | 行为变化 |
|---|---|
| [skills/feature/plan/SKILL.md](../../skills/feature/plan/SKILL.md) Step 3 | 删「`source_code_paths` ≥5 / 默认 MUST subagent」，改为「plan 是 delta 阶段，量化阈值与 subagent 强制只在建立阶段（spec/change）与旧 `context-exploration.md` 兼容路径生效」；仍要求 `phase_delta: plan` 节非空 |
| [skills/feature/coding/SKILL.md](../../skills/feature/coding/SKILL.md) Step 3 | 同上（`≥3` / MUST subagent → delta 阶段口径） |
| [skills/reference/agent-behavioral-principles.md](../../skills/reference/agent-behavioral-principles.md) 原则 1 第 1/2/4 条、Gate 对照表、自检清单 | 建立阶段 vs delta 阶段分工写明；补 L2_small 评分低于阈值同样豁免（旧文案只说"仅 L1 trivial"）；清单 schema 改 facts.md 的 `"1.0"` |
| [harness/scripts/goal-phase-runtime.ts](../../harness/scripts/goal-phase-runtime.ts) 无人值守 prompt | 「attestation-locked → testing BLOCKER」改为分级 WARN + owner 责任（对齐 `review_closure_attestation` / `ut_no_src_mutation` 的 MAJOR WARN 实现）；`*_FAST_PATH` 红线保留 |
| [skills/reference/device-testing-workflow-detail.md](../../skills/reference/device-testing-workflow-detail.md) 第 3/5 条 | `region_attest` / critic 回执限定为「有 delegated 视觉 provider 时」，指向本节已有的 no-provider 分支 |
| [harness/prompts/verify-ut.md](../../harness/prompts/verify-ut.md) 前置第 4 条 | `ut_no_src_mutation` 由「BLOCKER」改为分级 MAJOR WARN 陈述；禁改业务源码的纪律与 owner 责任不变 |

**S1 请求与下一步（D1/D2）**：

- [harness/scripts/utils/verifier-plan.ts](../../harness/scripts/utils/verifier-plan.ts)：新增纯函数 `canProduceVerifierRequest`（+ `REVIEW_NEGATIVE_CLOSURE_CHECK_IDS`），按 D1 表判资格，返回 `{allowed, kind, reason, diagnosticCheckIds}`。
- [profiles/hmos-app/harness/ut-host-impl.ts](../../profiles/hmos-app/harness/ut-host-impl.ts)：新增 `isRealAssertionFailure`，在 `checkUtHvigorTest` 最终失败返回处按 D1 条件补 `failure_kind='code_regression'`；格式器已给归因时不覆盖，`details` 原文不动。
- [harness/harness-runner.ts](../../harness/harness-runner.ts)：新增 `resolveVerifierRequestEligibility`（Step 4 门控与 `writeRunSummaryBase` 共用，`report_validity`/`has_blocked` 取自既有 `deriveSummaryVerdictLattice`）；`decideNextAction` 最前处理 `run_verifier_for_repair`；`buildNextLine` 先于通用分支渲染该动作并给齐 request/报告路径与后续命令；新增 `outerGoalHarnessWillRerun`（agent 侧 goal 信号 ∧ 盘上 run-control 可读）区分 goal/非 goal 后续动作；`extractFailureClassification` 改为导出（唯一归因回退解析器，供测试与 D1 注入）。
- [harness/scripts/utils/report-generator.ts](../../harness/scripts/utils/report-generator.ts)：`assembleAIPrompt` 增内存选项 `repairDiagnosis`，尾部追加「本轮为产品失败诊断」正文（列已放行 check、重申终态计数口径）；常规请求正文零变化。
- [harness/scripts/goal-runner.ts](../../harness/scripts/goal-runner.ts)（经 `goal-phase-runtime.ts`）：`SummaryJson` 增 `verifier_request`/`verifier_report`；`extractPriorFailureContext` 在诊断轮追加三条可执行指令（投 request / 写报告 / 回传即止，不改产品、不自跑 harness、不等候选或 closed）。
- 接收端同变更组：[verifier.md](../../agents/claude/templates/agents/verifier.md) description 与第 3 步、[phase-executor.md](../../agents/claude/templates/agents/phase-executor.md) 第 3/4/6 步、[check-phase-completion.mjs](../../agents/claude/templates/hooks/check-phase-completion.mjs) 非闭环分支、[verify-ut.md](../../harness/prompts/verify-ut.md) 前置第 6 条、[verify-review.md](../../harness/prompts/verify-review.md) §八 新增第 6 条、六个 feature SKILL 的「harness 没有输出 request 时」第 ③ 条。

**实施中被既有门禁抓到并修掉的两处**（都不是设计问题，是落笔位置/归一化写错）：①`normalizeVerifierIdCell` 首版把 `_` 当强调符剥掉，`end_to_end_driving` 永远匹配不上表格行（自测时定位）；②`isRealAssertionFailure` 首版放在 `checkUtHvigorBuild` 与 `checkUtHvigorTest` 之间，其文档注释提到 `buildUtHvigorTestFailDetails`，触发既有接线回归「诊断 helper 只接入 checkUtHvigorTest，不得污染 ut_hvigor_build」（该套件按源码切片断言）——已把函数整体上移到 `checkUtHvigorBuild` 之前，行为不变。

**S2 解析与候选（D3/D4）**：[repair-candidates.ts](../../harness/scripts/utils/repair-candidates.ts) 的 `parseVerifierCheckStatus` 改为复用 `extractTables` 读 §7.1 正式汇总表（精确 `id`/`status` 列头）+ 兼容旧 YAML；只认 PASS/FAIL/WARN，同义重复去重，冲突与坏状态一律返回 null。实现坑：id 单元格归一**不得**剥下划线（首版剥了 `_`，`end_to_end_driving` 恒匹配不上）。

**S3 规格与验收**：新建 OpenSpec change [verifier-repair-diagnostics](../../openspec/changes/verifier-repair-diagnostics/)（proposal/tasks + harness-gates / feature-artifact-layout / agent-adapters 三份 delta）；[MIGRATION.md](../../MIGRATION.md) 新增「3.0.x：可诊断的产品失败照样签发 verifier request（非 Breaking）」一节，含消费者需重新物化的三个模板与放弃的准确性。

**D5 只核对现状（无改动）**：claude / codeagent / codex 三个 `adapter.yaml` 均已 `verifier_subagent: true`；codeagent 的 `template_dir: ../claude/templates/agents` 共享 verifier/phase-executor 模板，本轮改动自动生效；共享 bundle 的 skills-bridge 是跳板文件，正文继承已修订的 framework SKILL。未抽象传输层、未改任何能力声明。

**测试（扩展既有套件，无新框架）**：`verifier-plan` ⑦ D1 资格矩阵；`verifier-production-routing` G/H（驱动 `writeRunSummaryBase` 走 review 负面与 UT `code_regression` 两条真实分流，断言 request 签发、FAIL/open 不变、`next_action`、两种 NEXT 分支、报告写回后 owner 候选出现、诊断正文只在诊断分支出现）；`repair-candidates` V4（表 ≡ 旧 YAML 消费者等值、冲突/重复/坏状态）与 V2（先复现真实 formatter 缺归因的断点，再验证补齐、`details` 原文回退、结构化环境归因优先、未完整执行/`total=0`/`timedOut` 不得改判）；`goal-phase-runtime` 诊断回喂；`context-facts` V8 文案对齐。

**与 plan 的取舍差异**：

- D1 正文写「输出 boolean」，实现返回 `{allowed, kind, reason, diagnosticCheckIds}`。理由：D2 第 1 条要求 ai-prompt 列出「已允许的失败 check」，只回 boolean 会逼调用方在 runner 里复制一遍"哪几条算负面裁决"的判据，等于制造第二处真源。**放弃的准确性**：无（判据仍只有一处实现，返回值只是把它已经算出来的事实带出来）；代价是返回类型比 boolean 宽。
- D2 第 4 条要求「失败控制台必须给 request 路径、写报告路径与后续命令」，实现只扩了 `buildNextLine` 的单行 NEXT（三样齐全），未在 FAIL 分支另加多行指引块。**放弃的准确性**：失败控制台的诊断指引比 PASS 分支简短，弱模型可能需要多读一行；换来的是不新增渲染函数、不把 `buildPassGuidanceLines` 用成名不副实的通用块。

**验证结果（本地）**：`check-plan-version` PASS；`typecheck` 通过；五条目标 `test:unit --filter` 全绿；`openspec:validate` 31/31；`candidate:build` 的 typecheck + unit **3822/3822** + fixtures **46/46** + pack + zip 校验全部通过。

**候选件未产出，原因是一处既有失败（非本批引入）**：`candidate:build` 最后一步 consumer lifecycle smoke 的 `goal/#5：UT 改源码应自动回 coding 并重新闭环` 失败——driver 场景 `ut_source_mutation` 在 UT invoke 窗口内改产品源码后，只落 `phase_write_observed`，没有落 `phase_write_violation`，因而无失效记录、不回退 coding，run 直接 `CHAIN_SLICE_COMPLETED`。已用同一 driver 场景在**本仓**做对照：把本批全部改动 `git stash` 后重跑，结果逐字段相同（`writeObserved=true / writeViolation=false / invalidationRecords=[]`）——**该失败在 Br_release_3.0.0 上先于本批存在**，落点在 `classifyPhaseInvocationChanges`（`harness/scripts/utils/phase-write-boundary.ts`）到 `goal-phase-runtime.ts:7434` 的违规判定，与 D1/D3 无接触面。本批不越批热修（plan §2 非目标 + 总 plan §5「不越批热修」），如实登记为前置阻塞：**它不修好，`candidate:build` 就出不了候选 zip，宿主验收无法开始**。zip 与 manifest 本身已由本轮 pack 写出（`dist/candidates/framework-3.0.0-candidate.zip`，只是未经 smoke 放行、`[candidate] BUILT` 未打印，按纪律不当作可交付候选件。

**未完成**：上述 `goal/#5` 既有失败（须由用户裁决是否单独开一批修，或确认可豁免后重跑 `candidate:build`）；`b01-host-acceptance`（V9）——宿主集成与 C-U 实跑由用户触发，本轮未执行；未 commit、未改 git 配置、未触碰宿主工程（只读读取过 run manifest 与 goal-report 以填宿主命令的真实路径）。

### 2026-09-06：smoke goal/#5 对齐 plan 1741b6f2（B01 之外的前置修复）

上条「未完成」里登记的 `candidate:build` 末步阻塞已解除。**这不是 B01 的改动**，而是候选件出不来的前置修复：失败的是过期断言，不是产品行为。

- **根因**：提交 002fc87c（plan `写边界归属门禁裁撤_信息缺失不再终局与源码漂移单次裁决_1741b6f2`）刻意把写边界降为归因诊断——纯 `source` / `phase_workspace` 域的跨阶段写入只发 `phase_write_observed` 留痕后继续跑，`phase_write_violation` + 自动回退只留给 inventory 登记的 artifact 域，源码漂移交责任 checker 分级 WARN 单次裁决。那次提交跑了 `npm test` 与 golden，**没跑 consumer smoke**，于是 [scripts/smoke-consumer-lifecycle.mjs](../../scripts/smoke-consumer-lifecycle.mjs) goal/#5（原 694–729 行）仍钉着已退役的旧语义。
- **改法**：只改该段断言与注释（现 694–723 行）。新断言 = UT invoke 窗口内改产品源码后 `eventTypes` 含 `phase_write_observed`、不含 `phase_write_violation`、`invalidationRecords` 无 `reason='phase_write_violation'`、`phaseHalts` 无 `awaiting_human_review`、run 正常收官（exit 0 / error null）。注释改写为新语义并引用 plan 1741b6f2 与提交 002fc87c。未动 driver、未动生产代码、未动其它 smoke 段。
- **放弃的准确性**：不再断言「自动 backtrack 回 coding 全量重验」——那条行为已被 002fc87c 撤销，本段改为断言「留痕 + 不终局 + 正常收官」。披露面（`ut_no_src_mutation` MAJOR WARN、`post_review_source_drift_unreviewed` readiness signal）本段**不**断言：它落在 script-report / 本轮 summary，`GoalRunOutcome`（[harness/tests/helpers/goal-run-driver.ts](../../harness/tests/helpers/goal-run-driver.ts):100）不带这些字段，为一条 smoke 断言扩 driver 不划算；披露面的回归留在 `goal-post-harness-drift.unit.test.ts` 与各 checker 单测。代价：写边界若静默改道成「只留痕但披露也没了」，这条门不会红，得靠单测兜。
- **验证**：`npm run candidate:build` 全绿并打印 `[candidate] BUILT → dist\candidates\framework-3.0.0-candidate.zip`；zip sha256 `7f8989adba42f092e6e844fdd141ef13e25f577bb97205d4027c5a79ea545a6c`，in-zip manifest sha `99a1e9ee902549a82d56f3ae27075b563641e03e9b8edf0643faf852429ea029`。unit 3822/3822、fixtures 46/46、pack 校验、consumer smoke 全段通过，无其它 smoke 段失败。未提交、未跑宿主。

### 2026-09-06：codex review 第 1 轮返修（5 条 finding 全修，未提交）

改动全部在既有函数内收口，无新模块、无新动作字符串、无新状态机。

| finding | 落点 | 改法 |
|---|---|---|
| 1 [high] 真实 UT 断言失败仍进不了诊断 | [ut-host-impl.ts](../../profiles/hmos-app/harness/ut-host-impl.ts) `isRealAssertionFailure` 349–373（判据改动落在 355–367） | 区分**断言诊断**与**环境诊断**：生产 hdc-runner 对用例失败固定产 `failedAt='no_pass'` + `runDiagnosis.kind='test_failed'`（`aa.report ? 'no_pass' : 'run'` 与 `classifyAaTestFailure` 首个分支），旧判据把它们一律当环境故障，等于否掉唯一的真实形状。改为：`installDiagnosis` 在场即否；`failedAt` 非 `no_pass` 即否；`runDiagnosis.kind` 非 `test_failed` 即否。其余守卫（toolMissing / timedOut / installBlocking / 完整执行 / total>0 / failed>0 / failures 非空）一字未动 |
| 2 [medium] 冲突与占位状态被读成 PASS | [repair-candidates.ts](../../harness/scripts/utils/repair-candidates.ts) `normalizeVerifierStatusCell` 426–437 | 剥装饰（`` ` `` `*` `_` `~` + 首尾空白）后**精确**等值匹配，删掉 `\b(PASS\|FAIL\|WARN)\b` 的取首词。`PASS / FAIL`、`NOT PASS`、`<PASS>`、`PASS（部分）` 一律 null。表格与旧 YAML 两条路径共用该归一函数，同时收口 |
| 3 [medium] 正文不可采信时缺格式修复出口 | 新增 `findUnreadableDiagnosisChecks`（repair-candidates.ts 493–519）；[harness-runner.ts](../../harness/harness-runner.ts) writer 1897–1919、`repairDiagnosisNeedsVerifier` 1966–1971、`buildNextLine` 2298–2301 | 诊断轮除终态校验外再判**必需检查项**能否读出（ut=两项候选必需检查，review=issue-verification 块，均复用既有解析器）；读不出 → 仍 `run_verifier_for_repair` + 控制台 warn 点名 + NEXT 追加"先按原始回复重写这一份报告，不要改产品"。同时把 writer 里的报告正文读取上提一次，供可采信性判定与候选组装共用同一份正文 |
| 4 [medium] 残留 run id 被当成外层仍会执行 | harness-runner.ts `outerGoalHarnessWillRerun` 2340–2367（并按 `decideNextAction` 先例导出供单测直驱，文件末 export 段） | 三件事齐备才判 true：invocation 带 `MAISON_GOAL_ATTEMPT`（与 run id 同批注入）、run-control 可读、`owner.state==='active'`。`released` / `orphaned_session` / `quiescing` 一律回落"自行重跑" |
| 5 [medium] Stop 指引在诊断轮仍直接要求闭环 | [check-phase-completion.mjs](../../agents/claude/templates/hooks/check-phase-completion.mjs) `repairDiagnosis` 582–586、headline/首要动作 587–606、第 3 步 648–662 | 诊断轮首要动作改为投 verifier（不再是重跑 harness）；第 3 步由 `sync-closure` 换成二选一：正式 goal 编排写完交回 runner；非 goal 重跑本阶段 harness 重算候选、再按新 NEXT 的 owner 指引回修。已核对 codeagent `template_dir: ../claude/templates/hooks`——`.cac` 与 `.claude` 共用同一份模板，一处生效 |

**取舍（与 codex 要求的差异）**：finding 3 未新增 `next_action` 字符串。理由：D2 的动作语义就是"去把当前 subject 的可用正文拿到手"，重写报告与重投 request 是同一动作的两种取材方式（D4 已规定优先级）；新增字符串要同步 6 个 SKILL、3 份 OpenSpec delta、MIGRATION 与两个模板，收益只是措辞更短。**放弃的准确性**：诊断轮的 NEXT 多带一句条件句（"若该报告已存在却读不出必需检查项…"），弱模型需多读一行才知道适用哪一半；换来的是消费面零改动。必需检查项的覆盖边界见 D4 补写段。

**规格同步（最小）**：[harness-gates](../../openspec/changes/verifier-repair-diagnostics/specs/harness-gates/spec.md) 补"usable 不止终态自洽"与 owner/attempt 判据各一段 + 两条 scenario；[feature-artifact-layout](../../openspec/changes/verifier-repair-diagnostics/specs/feature-artifact-layout/spec.md) 补"整格精确匹配"一句 + 一条 scenario。未新增 requirement。

**测试（扩既有套件）**：
- `repair-candidates`：V2 夹具**改为完整生产形状**——`parseHypiumStdout` → `classifyAaTestFailure`（断言 kind=test_failed）→ `buildOnDeviceFailureEvidence` / `ensureFailedAtStageTag` 现算，不手拼；新增 ⓪ 构造性前提断言（`failedAt='no_pass'` ∧ `runDiagnosis.kind='test_failed'`）与 ④b 五连否决（`failedAt=run/install/hap_not_found`、`runDiagnosis=aa_test_no_result`、`installDiagnosis` 在场）。V4 补 `PASS / FAIL`、`NOT PASS`、`<PASS>`、`PASS（部分）`、空串与三个 YAML 坏值，并断言占位/冲突真的把 coding 候选拦下。新增用例「D3/D4 必需检查项可采信性」覆盖 `findUnreadableDiagnosisChecks` 的 ut/review 正负例
- `verifier-production-routing`：新增 **I**（review 缺逐条验证块 / ut 两项冲突占位 → `next_action` 仍 `run_verifier_for_repair`、NEXT 含"重写"、不落回"一轮修完全部"；再换成可读表格作正例对照，候选恢复且动作退出）与 **J**（`outerGoalHarnessWillRerun`：无 control→false、有 control 无 owner→false（旧实现正是这里误判）、active→true、缺 attempt→false、quiescing/released/orphaned_session→false、gate harness→false）；caseD 补 ③ 诊断轮 Stop 指引（首要动作=投 verifier、显式"不要跑 sync-closure"、非 goal 重跑出口、goal 交回、owner 指引）
- V2 的生产接线链未改：真实解析器 → ut-host 归因 → writer → `canProduceVerifierRequest` → 候选，仍由 `repair-candidates` V2 与 `verifier-production-routing` H③ 端到端覆盖

**验证结果（本地，日志在 scratchpad/b01/fix1-*.log）**：`typecheck` 通过（exit 0）；`test:unit --filter verifier-` **30/30**（verifier-plan 7、verifier-evidence 9、verifier-production-routing **11**、verifier-material 3）；`--filter repair-candidates` **33/33**；`--filter goal-phase-runtime` **17/17**；`--filter context-facts` **19/19**；`--filter codeagent-adapter` **12/12**；`--filter hook-stale-state` **28/28**；`--filter init-update-policy` **6/6**；`openspec:validate` **31/31**。命令表里的 `--filter ut-hvigor-test-failure` / `--filter ut-host` **没有对应 suite id**（run-unit.ts 未登记），已改跑真正 import 这两个生产模块的三个套件：`ut-module-selection` 7/7、`blocker-suggestion-ratchet` 3/3、`profile-decoupling` 9/9。所有改动文件经 node 扫描确认 0 处 CRLF。

**未做**：`candidate:build` 按调度者要求未跑（另有构建在跑）；未 commit；未触碰宿主工程与 `scripts/smoke-consumer-lifecycle.mjs`。

### 2026-09-06：codex review 第 2 轮返修（1 条 finding，未提交）

| finding | 落点 | 改法 |
|---|---|---|
| [medium] 第 1 轮的整格精确匹配没覆盖 YAML 完整值 | [repair-candidates.ts](../../harness/scripts/utils/repair-candidates.ts) `parseVerifierCheckStatus` YAML 分支 471–487（判据落在 481） | `status:` 的值改取**整行剩余部分**（`/^\s*status:\s*(.*)$/`，归一函数自己 trim）再交 `normalizeVerifierStatusCell`。旧的 `(\S+)` 先把 `status: PASS / FAIL` 截成 `PASS` 再归一，第 1 轮的精确匹配在这条路径上等于没生效；表格与 YAML 两条路径至此口径一致 |

**为什么它可驱动 goal 去改产品**：subject 报告终态自洽、`business_assertion_value` 写 PASS、`end_to_end_driving` 写冲突值 `PASS / FAIL` 时，截断后两项都读成 PASS ⇒ `findUnreadableDiagnosisChecks` 返回空（正文被判可采信，不进"重写报告"出口）∧ 候选合取成立 ⇒ 产出 `ut_product_assertion_failure` coding 候选。

**顺带收口**：`harness/prompts/verify-ut.md:283` / `verify-review.md:228` 的模板占位行就是 `status: FAIL | WARN | SKIP`——照抄不改的报告过去会被读成 FAIL，现在一律不采信（null，走既有"未确认"通道）。空值 `status:` 同理由不采信改判为坏状态（旧实现该行不匹配、继续往下扫）。

**放弃的准确性**：YAML 值带行尾注释（`status: PASS  # 见 §7.1`）现在也判坏状态。verifier 报告不是配置文件、模板里没有这种写法，为它加注释剥离得再引一套 YAML 词法；宁可让这类报告走"按原始回复重写"出口，也不再猜作者意图。

**测试（扩 V4 用例，无新 run 块）**：[repair-candidates.unit.test.ts](../../harness/tests/unit/repair-candidates.unit.test.ts) V4 的 YAML 坏值表补 `PASS / FAIL`、`NOT PASS`、`<PASS>`、`PASS（部分）`、`FAIL | WARN | SKIP`、`PASS 或 FAIL`、空串，并新增合法值对照（`PASS` / 带首尾空白的 `FAIL` / `**WARN**` 仍正确解析，证明改宽捕获没放过头）；新增候选回归 `viaYamlConflict`——`end_to_end_driving: PASS / FAIL` + `business_assertion_value: PASS` 时 `findUnreadableDiagnosisChecks('ut', …)` 恰好点名 `end_to_end_driving`，且 `buildSummaryRepairCandidates` 不产 `ut_product_assertion_failure`。**变异验证**：把判据改回 `(\S+)` 重跑，V4 如期红在「YAML 坏状态「PASS / FAIL」必须 null」（32/1），改回后复绿。

**验证结果（本地，日志在 scratchpad/b01/fix2-*.log）**：`typecheck` 通过（exit 0）；`--filter repair-candidates` **33/33**；`--filter verifier-` **30/30**（verifier-plan 7、verifier-evidence 9、verifier-production-routing 11、verifier-material 3）。两个改动文件经 node 扫描 0 处 CRLF。未跑 `candidate:build`、未 commit、未触碰宿主工程。

### 2026-09-06：codex review 三轮收敛、候选件产出、本地验收完成（调度记录）

- review：第 1 轮 needs-attention（1 high + 4 medium），第 2 轮 needs-attention（1 medium，YAML status 首词截断），第 3 轮 approve、无新 finding。三轮均为只读审查（`codex exec`，gpt-6-astra/high），逐文件哈希核对工作树未被 review 改动。
- 最终 `candidate:build`（scratchpad b01/candidate-build-5.log）：typecheck 通过、unit 3825/3825、fixtures 46/46、consumer smoke 全段通过，`[candidate] BUILT → dist/candidates/framework-3.0.0-candidate.zip`，zip sha256 `5f58436440b7c6919856e7c6cadd7816e4fd98f2d399ead7d51fe9b6a65d32d0`。
- 提交：按 §4 分四笔（smoke 前置修复 / D6 指令清理 / D1–D4 生产代码与模板 / plan 与 OpenSpec），不带署名。
- `b01-local-acceptance` 置 completed；`b01-host-acceptance`（V9）保持 pending：候选件集成到验收宿主与 C-U goal run 由用户触发。宿主命令模板见 §7 与"S0–S3 本地实施"记录。
