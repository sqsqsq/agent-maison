---
name: 需求设计按规模减负 — 短蓝图与CU映射收编（B）
version: 3.1.0
parent_goal: balanced-delivery-and-reliability-a47c9d62
advances:
  - g1-default-delivery-baseline
  - g2-user-adjustable-quality
  - g5-proportionate-verification
  - g6-real-host-delivery
relation: core
layer: component-blueprint
goal_requires:
  - source-bound-unified-request-intake
  - deterministic-proportionate-delivery-policy
  - content-aware-affected-verification
  - direct-change-framework-capabilities
goal_provides:
  - compact-blueprint-on-existing-contract
  - blueprint-backed-single-request-verification
  - deterministic-cu-mapping-without-redundant-design
  - verified-proportionate-host-delivery
real_host_validation: >
  A/B均完成开发后，仅安排一次联合验收批次：真实需求覆盖四档、用户覆盖、专项检查、
  小型原位升中型和明确映射跳过plan。保留需求/代码基线、环境、模型和原生调用日志，
  同类任务总耗时不高于现行基线；不宣称固定增加几秒或凭夹具证明更快。
  回灌、业务宿主与设备操作由用户安排；未实际覆盖的项目保持未完成。
parallel_authority_added: false
overview: >
  消费A的同源判断，在现有蓝图协议、位置与检查器中支持短蓝图；小型无CU准入、独立质询和评审文档，
  review/UT沿现有request消费蓝图验收。中型CU只为真实未决设计安排plan，明确映射由原writer复用或派生；
  复杂沿既有多CU与组合闭环，不增加设计产物、运行器或状态库。
todos:
  - id: b1-compact-blueprint-contract
    content: 按§3扩展同一蓝图schema/checker的条件义务，短蓝图仅承载四项必要内容及原身份来源；原入口/模板/renderer同步，不新增平行设计格式。
    status: completed
  - id: b2-small-request-consumers
    content: 按§4接通无CU的小型设计到实现、review/UT/testing消费，断言预期绑定蓝图验收，复用A自动request及架构/专项能力。
    status: completed
  - id: b3-cu-mapping-and-scope
    content: 按§5收编明确CU施工映射的复用/确定生成与真实缺口路由，修正feature-track定义满足判定，避免文件缺席导致冗余plan。
    status: completed
  - id: b4-upgrade-and-common-rules
    content: 按§6完成短蓝图原位升中型、用户覆盖和复杂多CU接续，统一旧规则取代与历史读取，删除A过渡接线。
    status: completed
  - id: b5-unified-development-acceptance
    content: 按§8在实际schema、checker、request/provider、范围及完成消费链验证全部正反例，集中运行相称仓库门禁，不把替身当宿主结果。
    status: completed
  - id: b6-joint-host-and-efficiency
    content: 按§9在用户安排的真实宿主统一验收A/B四档、覆盖、专项及成本；保留同口径基线、实际时间和缺口，未测不关闭。
    status: pending
---

# B：短蓝图、中型映射与联合验收

## 1. 范围与顺序

本计划依赖[A：统一需求入口与四档判定](统一需求入口与四档判定_内容核对及轻量执行_e4a7b2c9.plan.md)完整开发验收。实施前仍须用户通知、72b6f0d9对应P4的两项宿主待办及3f8a6c21收口；起草/联合检视不受限制。两份计划当前只起草，不实施、不提交。A/B最终使用同一3.1.0窗口，不新建goal。

本批一次完成、统一验收。内部任务顺序不是用户中途审批点；真实授权、不可逆外部动作、秘密和用户限制沿原边界。回灌、打包、提交与设备操作不由计划自动授权。

目标是去掉小型任务的固定设计开销，并让中型CU已有设计真正可复用。复用蓝图、ExecutionScope、request、writer、修正/恢复与正式完成原件；不恢复lite、不引入“改动卡”、小规格、旁路manifest、注册表或场外状态。

## 2. 事实接缝与验收边界

| 现有接缝 | 实际问题 | 本批改变 |
|---|---|---|
| `app-component-blueprint.schema.json`、`component-blueprint-validator.ts`、App lens | 顶层完整结构和适用视图的changed/verified_unchanged义务，小任务仍需证明未变 | 同一schema/checker依A有效判断按条件验证；短蓝图不补空章节或未变证据 |
| `component-design`、`app-component-blueprint-workflow.md` | 完整设计交接要求admitted＋1..N CU＋独立质询＋评审投影 | 为小型提供真实短设计终点；不将无质询的短蓝图标成完整admitted设计 |
| `deriveBlueprintSkillInput` | 要求canonical CU，按design_refs选取typed设计 | 共享typed解析/校验，为request增加无CU蓝图来源，不伪造CU |
| `feature-track.ts::authorityGapOf`、`change-unit-feature-projection.ts` | 缺Feature专属施工映射即安排plan，即使蓝图typed内容已充分 | 先复用/确定派生，只有语义未决才安排责任设计 |
| `request_expectation_source`及request provider | 可验证显式来源，但无短蓝图消费闭环 | 自动request传原蓝图路径/当前身份/验收ID，UT断言实际绑定其预期 |
| 原renderer/closure | 假设完整评审和CU结构 | 小型不产独立评审投影、不走Component closure；完整设计/多CU保持原正式终点 |

上一轮生产解析器隔离复现（2026-11-11）：typed蓝图已resolved而缺CU映射→`plan,coding,review,ut`；同一蓝图补合法映射与用例→`coding,review,ut`。此为真实解析器调用、夹具输入，不是HMOS产品实跑，也不证明所有映射均可自动推导。

## 3. 同一蓝图的短版本

### 3.1 位置、身份与内容

沿现有`paths.features_dir/<blueprint_id>/blueprint/component-blueprint.yaml`、同一`component-blueprint@1` schema和`check:component-blueprint`入口。复用现有请求名称/蓝图ID，不自动产生Feature施工身份。原身份、来源与必要revision仍保留，不把“四样业务内容”误解为可以丢失权威来源。

小型只需四样业务内容：

1. 改动点：原需求所指对象、本次目标和边界；复用current_scope及其source引用。
2. 可检验验收：稳定ID、操作/输入与可观察预期及适用验证方式，使用现有typed acceptance子结构。
3. 要改的文件：当前已知目标，复用contracts已有文件表达；它是研究/施工目标，不能仅因预测遗漏就扩范围或锁死合法实现。
4. 局部选择（如有）：复用decisions；写明选项、取舍和本模块影响，无此选择允许省略。

通过原有节点/根级typed内容承载这些信息，复用相同parser与字段含义；不另造`small-blueprint.yaml`、改动卡、第二份spec或plan。简短表示必须有一份随包有效样例和同入口反例，避免只有文案说支持。

### 3.2 同一检查器的条件义务

schema由当前必填全集改成共同身份/来源必填＋按有效设计外框验证的内容义务；不复制第二份检查器。完整蓝图继续用原视图、质询、CU和评审要求；历史完整产物按原语义读取，不批量改写。

短形态的适用依据来自A自动request writer生成的原request JSON（真实用户来源/定位、判断事实、基线及派生外框），不接受作者仅删除字段就自动降级。检查器经已有request输入解析该上下文与原件绑定，取设计深度并与实际内容专项同源核对；检查结果写入原报告。A无法取得原生请求/有效基线时不将来源unknown自动填成小型：仍可报告“短内容结构可解析、档位未核”，不能签完整请求完成、中型admitted或假定用户已选小型。

首次短蓝图检查就在本来要执行的`check:component-blueprint`调用中复用A自动request准备，接受同一原生session定位并返回原request路径；不要求先编译、先有Feature或另跑一次prepare。后续实现/review/UT引用该原request，按实际输入变化更新既有绑定。这样设计前可取得来源，产品写入前不增加分类CLI，不能等施工后才补一份设计适用证明。

不涉及的视图可不写，不要求`verified_unchanged`和证明不变的附录；原三问为否、已取得的机器事实以及必要语义依据足够时才省这些工作。**不要求接口、路由、持久化全部未变**：仓内改名、新增兼容默认列、已有A→B均可能小型；应在四项内容中保留对应改动和验收，专项验证继续执行。机器未覆盖的持久化含义不能宣称已被配置diff证明。

仅复用既有页面/组件且无新选型决定，不强制补完整组件选型表；确需比较方案且影响用户的，A的Q1会进入中型。不能为通过short分支删除原用户目标、关键验收或真实选择。

小型检查不要求独立质询结果、CU数量或评审文档。沿原输出显示其授权终点为“小型请求设计”，不把它标成“完整设计交接完成”。不新增可手填的admitted状态。渲染器仍能读取短内容用于正常摘要，但不得为了渲染而自动补齐完整章节或产生独立review.md。

## 4. 无CU的小型请求闭环

入口消费A结果：小型短蓝图完成必要内容后，继续同一请求实现，调用A已接通的编译/架构及适用review、UT、设备能力；不先创建CU，不借用另一个Feature，不进入要求selected CU的初始设计施工分支。

执行仍复用现有工作单元作者、request/profile执行器及真实结果处置；轻量来源和结果终点由原request承载，不新增轻量runner或控制队列。现有“完整实现一律初始设计root”的分流按A/B范围在原位置取代；中型/复杂及已有CU仍归同一Goal runtime，不能用轻量request绕过在途义务。

### 4.1 输入消费

在现有`capability-resolution`/蓝图typed投影里增加request subject读取同一蓝图的分支：沿原path安全解析、来源与内容校验，按本请求验收取真实结构。与CU分支共享typed处理；CU继续按design_refs选取，短蓝图分支不生成假design_refs/CU映射。

review得到原用户目标、短蓝图、实际diff和已执行验证。UT自动request引用当前蓝图与验收ID，断言逐条预期来源必须落到相关验收条目，不能用“蓝图文件存在”代替语义一致；继续允许诚实characterization但不得把它计为需求验收。测试准备复用现有载体/allowed_test_writes，不由Agent手写request JSON。

蓝图发生相关修订时，原binding失效并只重验受影响断言；不以旧报告自动通过。不变的代码/验收/工具证据按既有复用规则保留。需求只要求编译或仅review时止于原请求终点；“小型完成”依据该请求全部适用义务，不冒充CU/Component完成。

### 4.2 材料同步与用户指定

沿A：修正断言旧行为的测试；在途需求的验收/契约走原修正入口；已完成需求蓝图作为历史施工图保留。新增小型需求自己的短蓝图是本次设计真源，不重新打开旧Feature。

用户固定特别简单则不强建短蓝图；固定小型则使用短外框，不因自动规则建议中型而偷偷补独立质询。未做验证如实披露，原始失败不消失；真实授权和不可逆外部动作仍沿原范围。现有运行中降低流程要求须沿原范围修订/授权入口处理，保留历史证据与失败，不创建新request清账。

## 5. 中型CU映射收编

### 5.1 先辨别缺文件还是缺决定

`contracts.change_unit`继续是一份Feature施工映射真源；不搬进蓝图另存副本。完整身份从canonical resolver取得，predicate/provide/design ref与实现/测试引用沿现有映射合同。

顺序：①已有合法且与当前蓝图/CU一致的映射直接复用；②确有现存来源可唯一推出的部分由现有投影/物化writer确定生成；③需要作者判断的实现/测试归属在原中型设计工作中一次明确；④仍未解决的具体条目才交后续plan职责。不能仅按touches目录、同名文件、predicate文案或空数组猜映射，不把解析成功等同完整设计。

| 映射内容 | 真正的生产者与来源 |
|---|---|
| 精确`change_unit_ref` | 原consumer接受CU后，canonical resolver提供实际身份/摘要，程序填入 |
| 已有组件选型可推出的`design_ref_mappings` | 复用`component-selection-check.ts`现有确定投影；其余design ref仍需明确引用 |
| predicate/provide的`implementation_refs`、`test_refs`及其余设计引用 | 中型设计作者在同一次设计工作中明确现有合同要求的实际/合法planned文件引用；AC id、touches和write_refs均不足以自动推出测试文件 |
| 已完成的Feature合法映射 | 验当前CU/设计与引用仍有效后复用，不复制旧身份冒充新CU |

新中型CU的正常路径必须有上述作者生产步骤：在原设计请求的临时交回材料中提供同形的`contracts.change_unit`候选，CU身份由正式接受后补齐；候选不是蓝图内第二份映射真源。既有投影/物化writer按当前设计owner请求、已接受CU及允许的产物路径，校验后写入该CU的Feature `contracts.yaml`。消费完成后沿原临时材料清理规则处理；canonical只保留这一份映射。作者只明确文件归属，不在此写产品实现或正式测试结果。

必须补接初始设计请求输出/写界→CU接受→原writer发布映射→readiness/范围准备的顺序。不要让尚无CU的作者猜摘要，也不要让未获该输出授权的作者绕写child目录。映射候选的产出包含在已有中型设计调用中，不新增仅为转录的plan模型；既有设计已完成且确实缺少这些决定时，仍由原责任方补，不伪称纯机械生成。

可确定生成的前提：对应稳定ID已存在、实现与验证引用已由上述真实生产者或现有合法产物明确、来源与当前CU身份一致、引用唯一且原checker通过。只有身份字段、已有选型投影或已声明ID→引用复制缺失时可以机械补齐。多个合理落点、需新增接口/数据/验收决定或测试归属未定，仍是具体设计职责；同一作者一次补完，不额外冷启动阶段作者。

### 5.2 生成、消费与失败原子性

复用`blueprint-skill-projection.ts`已有writer与`change-unit-feature-projection.ts`校验，在当前合法owner/范围内生成；由`feature-track.ts::authorityGapOf`及后续消费者共同读取同一结果。范围准备可只读计算候选满足情况，正式写出沿原已有准备/物化调用，不在只读status中偷偷写文件。

生成前校验整份目标和当前来源；失败保留原文件与具体缺口，不半写、不覆盖人工合法补充。蓝图/CU真实改变时沿已有修订/重绑，不能仅改来源戳洗白；只刷新身份但内容等价仍走现有安全刷新规则。

设计义务已有真实InputRef满足时，scope不再为缺物理映射文件安排一次plan模型调用；机械生成不制造plan PASS、receipt或独立核验结果。完成与CU consumer核同一当前输入和必要验证，不能因为没跑plan而要求补一个虚假plan报告。

必须同时覆盖接受/readiness→范围准备→出生→执行→完成读取，不能只改纯resolver或放松`authorityGapOf`报错。未解决的真实设计缺口继续交其责任方，不以“减负”为由删除CU映射检查。

## 6. 升级、复杂任务与规则替换

小型出现可核对的新事实，且用户未固定流程时，A重算为中型/复杂；在同一蓝图路径和身份上补适用视图、决定及需要的内容，沿原revision/来源规则保留既有验收、局部选择和实现成果，不另建一份蓝图。

从短内容到完整设计必须完成当前适用独立质询和原准入，再通过原consumer创建CU；不得把短蓝图结构通过直接当admitted。原请求关系复用已有来源/交接引用，已有相关验证经freshness和范围核对后复用；初始diff/基线和原用户约束不重置。升级前已经授权写出的实现不推倒，但新发现的设计决定先修订再继续依赖它的工作。

用户指定仍优先；只是影响披露不自动升级。自动降回轻量只影响未执行工作，不能抹已发布CU/历史完成、绕过失败或消除当前在途责任；沿既有修订接回，不静默删除产物。相同事实重复调用不反复升降、不重复写设计。

复杂沿既有共享蓝图、多个独立CU及真实requires/组合责任；每个CU单独算实际工作，不把复杂root标签变成每个CU固定全套spec→真机。所有必要CU通过后仍消费原Component正式closure与真实组合证据。

同步范围：A列出的旧规则在B完成时更新最终形态；`component-design`、App lens、schema/checker、`blueprint-design-inputs.md`、`request-harness.md`、renderer、相关spec与MIGRATION一并对齐。移除A过渡，保持只有一种现行入口。历史M7/lite裁决记录与旧完成原件保留，不重写已完成todo。

## 7. 新增机制准入

| 新增或扩展内容 | 改善场景 | 实际收益及边界 |
|---|---|---|
| 原schema/checker按A上下文条件验证 | 小改动被迫16部分、未变视图证据和完整选型 | 同一蓝图只写必要四项；复用原身份、来源、报告，不新增档位注册表/短格式协议 |
| request subject的蓝图typed输入分支 | 小型不建CU后review/UT找不到权威预期 | 复用原投影/parser，断言指向同一验收；binding沿原request，不新增AC台账 |
| 原writer确定生成CU映射 | 已有充分设计仍被迫plan | 仅复制唯一已定事实；原checker完整校验，无可确定映射就保留真实缺口 |
| 原设计交回材料携带同形映射候选及限定输出写界 | 新CU没有predicate/provide测试路径，消费端能复用但没人生产 | 原设计作者同次明确文件引用，CU接受后原writer发布唯一contracts.change_unit；候选为现有临时结果，不入蓝图/第二账本，不写产品/测试结果 |
| 短到完整的原位修订接线 | 做到一半发现影响扩大、重建丢成果 | 复用revision、consumer、交接与输入绑定；保留原路径/请求，不新建迁移状态机 |
| 完成消费者区分短请求与完整设计准入 | 无质询短蓝图被误当中型已准入 | 复用现有subject/终点与A结果，不新造完成布尔字段、不伪造CU/Feature凭证 |

如实现确需在原已有上下文增加设计深度或来源引用，字段只能由A结果派生且供上述具体消费者使用；记录在同一request/报告，不在蓝图和manifest另存两套可编辑档位。独立状态库、场外状态、改动卡和只为审计好看的字段不在范围。

## 8. 开发统一验收

每轮代码执行`npm run test:changed`；稳定收口执行`npm run test:daily`、typecheck及必要目标测试；涉及共享schema/输入/完成链的定向反例必须实际覆盖。纯文档返修只跑对应校验。发布完整门禁与宿主回灌等另行授权。

| 验收 | 必要证明 |
|---|---|
| B1 短蓝图 | 四项业务内容经同一schema/checker通过；无CU、独立质询或review.md；原身份/来源及相关专项保留；完整蓝图缺必需内容仍失败 |
| B2 真实小型链 | 从A结果经短设计、代码、compile/架构到自动review/UT request实际执行；断言预期引用具体蓝图验收；错误预期、旧revision、characterization不能冒充完整验收 |
| B3 升级 | 同一文件/ID扩充完整设计并独立质询、CU准入；保留已有内容与合法代码/有效证据；用户固定小型时仅披露、不自动升级 |
| B4 映射明确 | 分别覆盖已有合法映射、原设计作者实际交回predicate/provide文件引用、原选型投影等真实确定来源及未决缺口。走原请求/写界/consumer/writer生成后再实际范围与完成消费；前三类不启动额外plan模型、不制造plan证据，不能只由夹具预填contracts证明作者生产 |
| B5 映射负例 | 一个ID多个合理目标、过期CU、缺验收、越权引用、来源不一致仍交原责任方；不能凭touches或文件名猜；失败不半写 |
| B6 复杂与恢复 | 两CU不同范围、共享设计和组合义务仍成立；断点恢复不重置基线/选择，不把旧FAIL清掉；同条件重入不重复设计 |
| B7 规则同源 | A三个正向锚点可用短/直接路径，三个反例有完整外框；最终入口/所有消费者已移除A过渡和冲突旧文案 |

真实CLI测试必须消费生成的request与蓝图，而非只验证对象形状。自含工程编译/测试可实际运行；HMOS工具替身只证明接线。复用A有效结果，不重复所有adapter长链；生产路径改变时只补受影响入口。

## 9. A/B一次宿主联合验收与效率

由用户安排发布件及干净业务宿主，A/B在同一验收批次覆盖不同真实需求，不要求一个需求同时属于四档。首批用已存在的真实需求及修复材料选取特别简单、小型、中型、复杂样本；新增构造的锚点只能记规则/隔离用例，不冒充宿主历史任务。

最低覆盖：直接修改无设计产物；小型短蓝图到真实验证；中型原设计作者真实给出映射、原writer接受后不另跑plan；复杂多个CU及组合闭环；用户降/升档与明确豁免；漏判后专项补齐；小型原位升级。可在同一真实任务的自然变化中复用观察，不为凑矩阵反复重跑整单。真机相关案例必须有真实设备结果，未执行准确保留。

效率按同类任务比较当前流程基线和新流程：需求/起始源码、客户端/模型、工具链/设备、缓存和验证范围应可比；记录开始到首次产品修改、到首次可用结果、到请求最终结果的墙钟，模型调用与重复构建/测试从原日志读取。新流程不能通过省掉用户明确验证或掩盖失败获得速度优势。

特别简单首次修改前新增分类步骤/CLI/模型轮次/确认均为0，无蓝图/CU/设计文件；本来必要的读代码和编译仍计入。所有档位同类需求总耗时不高于当前同口径基线，不预设“只多几秒”。缺可比历史基线时，在隔离副本用相同条件保留一个最小基线，不新造基准系统或要求大规模统计；模型/环境波动不能被当作改造收益，无法判断的项保持未验。

慢例必须归因到本改造新增的读取/解析、模型轮次、设计/验证重复等具体环节并修复；复用有效业务结果，只重跑受影响的效率观察。不能因功能通过就关闭效率项，也不保证不同随机运行逐秒一致。原始时间与不足如实交用户判断，不制造提升百分比。

联合验收只关闭实际覆盖的A/B义务，不自动关闭前序goal/plan。两份plan检视通过后仍停在待实施；只有用户通知且§1前置全部成立才开工。
