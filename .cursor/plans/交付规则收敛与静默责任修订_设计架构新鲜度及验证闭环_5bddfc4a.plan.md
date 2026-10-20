---
name: 交付规则收敛与静默责任修订 — 设计架构、新鲜度及验证闭环
version: 3.1.0
parent_goal: balanced-delivery-and-reliability-a47c9d62
advances:
  - g1-default-delivery-baseline
  - g3-recoverable-execution
  - g5-proportionate-verification
  - g6-real-host-delivery
  - g7-lean-governance
relation: core
layer: closure
goal_requires:
  - existing-authoritative-blueprint-and-change-unit-revision
  - existing-phase-ownership-and-effective-obligation-view
  - existing-design-repair-init-writer-and-run-continuation
  - existing-host-recovery-history-and-quality-verification
goal_provides:
  - consistent-design-selection-and-derived-projections
  - unattended-design-and-architecture-owner-recovery
  - ownership-consistent-freshness-and-phase-delivery
  - cause-based-repair-and-unverified-capability-disposition
real_host_validation: >
  开发回放区分历史错误诊断与当前生产动作；实现后的干净宿主原需求运行验证 runner
  自主修订、重绑及继续施工，不靠主 Agent 临场补文件或用户查询触发。
  与 395 t6、38 t7、664 t7、4f t10、c6 t9、e9 t7 和 a47 R5/H1 共用一次联合观察，
  用户已自行完成系统引导，联合验收不保留或制造 OOBE 现场；395 引导恢复分支记为
  真机未验证，由开发接线测试覆盖，其余交付验收照常；此前开发完成状态不重开。
parallel_authority_added: false
overview: >
  挂 a47 R6，基于 ce2465d0 与 10-19 两个失败 run，按真实记录四问收敛规则。
  用既有权威与所有权统一选型、证据和阶段产出，按原因派发修复，消除 unknown 即失败。
  落实用户 10-19 新裁决：无人值守时原需求范围内设计/CU及架构修订静默完成，
  仍经正式责任入口、隔离质询、检查、发布与接续，不让下游原地自授。
todos:
  - id: t1-evidence-and-rule-audit
    content: 按 §2/§3 保全两个新 run 并完成 20 个 run 的有界四问核对；下游检查上游字段时核实上游实际分支已接同源规则，区分未来实现检查；不复制运行时规则表。
    status: completed
  - id: t2-selection-fact-and-projection
    content: 按 §4.1 收拢组件选型权威及适用对象，设计/CU/Feature 共用事实，能派生的引用和副本不再要求重复手填，按具体缺口区分修复责任。
    status: completed
  - id: t3-ownership-and-freshness
    content: 按 §4.2 贯通源码/资源/测试产出的所有权及有效证据视图，门禁、assess、恢复、完成核验同源，保留真实上游变化和越界反例。
    status: completed
  - id: t4-phase-delivery-and-static-unknown
    content: 按 §4.3 修正 coding 提前索取 UT 产物、入口声明缺失的归因，以及共享导出刷新和静态 unknown 的真实验证接续。
    status: completed
  - id: t5-cause-routing-and-halt-guidance
    content: 按 §4.4 复用现有候选、设计权威及回退通道按原因派修；可恢复缺口不在无权阶段耗尽重试，停机事件/状态/报告共用可执行处置。
    status: completed
  - id: t6-unattended-design-and-architecture
    content: 按 §4.5 接通设计草稿、CU 内容修订、架构配置正式写入、隔离质询、发布重绑及自动接续；处理 running/busy 与冻结失效，不依赖用户或外层 Agent。
    status: completed
  - id: t7-policy-and-spec-alignment
    content: 按 §5 对齐新授权政策、Skill/提示/手册/OpenSpec/兼容说明；保留有人在场流程与预算既定三项条件，不新增开关、审批或平行账本。
    status: completed
  - id: t8-development-validation-and-review
    content: 按 §6 完成真实生产接线、反例、必要变异、官方开发验收及代码 review；复用稳定验证结果，提交前汇报，开发通过不代替宿主交付。
    status: completed
  - id: t9-joint-host-observation
    content: 按 §7 在用户安排的同一次干净宿主联合观察中验证无人值守修复后继续并完成真实验收；与既有 pending 待办共用，不另起长跑。
    status: pending
---

# 交付规则收敛与静默责任修订

## 1. 定位、目标与新裁决

本 plan 挂 [a47c9d62](../goals/效率与准确率平衡总体目标_默认基线自主交付与可调精细度及可靠恢复_a47c9d62.goal.md) R6，遵守 [四条总原则](../../docs/overview.md#121-四条总设计原则) 与 [AGENTS.md](../../AGENTS.md)。起草基线 `ce2465d089b497b64cbdd3a75315da6a98e98249`，版本 `3.1.0`。目标是把真实故障链上的规则、事实与恢复统一起来，让任务完成；仅更早停机、更准确分类或更详细报错不算达成。

**当前只写本 plan 和同步路标**：不实施、不提交、不打包、不复制夹具、不改宿主或手机；证据入库放在实施首项 t1。用户已自行完成系统引导，不为验收保留或制造 OOBE 现场。起草时开发仓干净；实施、提交时重新核对并排除其它会话改动。Maison 只通过构建并校验的发布件进入宿主，不直接修宿主 framework 或产品代码。

保留 [28e31f53](宿主全链恢复补修_义务重开与授权交接_设备及预算同源_28e31f53.plan.md) 和 [395ff0ab](设备引导阻断闭环补修_就绪归因同源与失败收口去重_395ff0ab.plan.md) 已完成的正文、状态及验证事实。本批承接 28 §3.1 所承诺的“下游正常产出不使上游回卷”在资源归属和 assess 消费中的遗漏，不重新做义务模型；395 的设备恢复与同次失败收口不重开。

### 1.1 用户 10-19 裁决：取代旧确认口径

无人值守完整交付中，原需求范围内的蓝图、CU 和必要架构修订，由 runner 自动交给设计责任方完成，不另向用户询问，不依赖主 Agent 在场。架构范围包含既有 `architecture_impact` 的 `dependency_edge`、`add_module`、`move_module`、`retire_module`、`responsibility_rewrite`、`dsl_other`；有人在场的交互流程保持原样。

这项新裁决替代 10-16“修改已交接蓝图/CU一律先确认、仅个人预授权 B1 例外”的限制。它不把 plan/coding 变成设计权威，也不把无人值守等同于任意后台进程：资格读取既有请求、manifest 的有效无人值守语义与明确限制；不新增授权登记层。原施工写集是可经设计修订重签的派生边界，不等同于用户永久禁止调整的范围。

仍须请求用户决定的是：改变原需求或实质验收目标；真实秘密/凭据、不可逆外部操作等未获授权事项；突破用户给定的总预算上限或其它明确禁止。自动修设计可以补遗漏、纠正错误技术方案，不得删验收、缩产品范围、虚构事实或假记用户确认。

设备、工具或存储条件未满足，以及预算/既有有界恢复耗尽，仍允许准确技术停放；这和请求用户作产品决定不同。保留等待、探针、既有恢复入口及有效成果，不承诺所有故障永不停机。框架默认预算扩容仍沿既定“无人值守＋不要询问＋完整交付”三项条件，用户总上限、累计消耗与无进展保护不变；不把条件缩成两项，不扣睡眠时间。

### 1.2 规则收敛准则

一个事实只由其权威产物决定，其它记录是引用或投影；有多个消费者不等于需要多个独立裁决。区分记录缺失、定义缺失、产品失败、验证能力不足与真实授权不足。阶段不能 PASS，不等于整个任务必须交还用户。可修问题先到有权修的责任方，裁决落回原权威产物并重新验证，普通检查、无人值守、恢复和完成核验读取同一结果。

不用账本覆盖 FAIL，不新增“先让 verifier 统一豁免”环节，不以建后继清零预算或失败历史。是否应删除一条阻断看实际保护对象和后果，不由检查名称、BLOCKER 标签或“机器判不出”单独决定。

## 2. 证据范围与已核实事实

### 2.1 材料与保全责任（t1）

范围封顶为 20 个 run：既有 `harness/tests/fixtures/host-recovery-history/` 中 R5 的 8 个有效 run、10-16 的 9 个 run、10-18 的 `d818e6`，加宿主 `doc/features/bc-openCard-2/open-card-flow/goal-runs/` 下的：

- `20261019T024808Z-4131b6`：spec PASS，plan 两次 FAIL，`no_progress_guard`；总调用数 3 不等于 plan 三次。
- `20261019T033030Z-1b91ba`：修订后 spec/plan 各一次 PASS，coding 两次 FAIL，`no_progress_guard`，未进入 review/UT/testing。

实施开始先只读保存两个新 run 的 manifest/events、停机时 summary/script-report、phase evidence、契约、CU、蓝图及最少的关联源码/日志；沿现有 `sources.json` 登记来源、源哈希、夹具哈希和必要变换。未冻结的公共阶段文件可能已被后继覆盖，必须按事件摘要、调用输出和绑定 hash 核对，不能把当前文件冒充旧调用原件。不采秘密或整份无关会话。

4131b6 绑定蓝图 rev4，已知 hash 为 `9302934ce9d80d3290b45ec683fbdc9c85244b54e594ce5eae335734b1612d9f`；后来被改成 rev5。候选还原依据为 `C:/Users/shengqsq/.codex/sessions/2026/10/18/rollout-2026-10-18T22-04-31-01a151e7-3e07-7083-a448-96dd2a7f563a.jsonl` 中 03:26–03:28Z 补丁及其后关联修改。只在开发夹具中逆推；hash 相等才称字节还原，不等则标为重建材料并列缺失，不伪造宿主原件。

10-14 完整 run 原件缺失；10-15 完整 run 原件未确认，但 `facts-plan-handoff` 已保存该轮部分真实产物，不能说全部材料都不存在。`d818e6` 现有 events 截至 08:16:14Z 的 run_end，属于已保存时段，不冒称包含其后全部恢复。取证缺口不靠手写事件填满。

历史层持续检出旧错误，生产层把相同输入喂给当前真实判定/入口验证正确动作；不改历史日志“让它全绿”。原始记录数量、halt 事件数量、重试次数分别统计。起草只核了事件清单：20 个 run 的已保存片段合计 `phase_halt/no_progress_guard` 11 次、`budget_wall_clock` 5 次、`backtrack_target_absent` 3 次、spec `framework_bug` 2 次、`upstream_closure_gap` 2 次；这不是唯一终态统计，也不是完成了全部规则审计。

### 2.2 本次事实与不得沿用的推断

| 事实 | 当前证据与影响 | 本批归属 |
|---|---|---|
| 最新包生效 | 宿主 ce2465d0 的 1241 个文件与发布清单一致 | 不以旧包解释失败 |
| 选型交接不一致 | rev4 两条选型写 `component_selection`，UI 实际产物嵌在模块节点契约里；设计校验/交接放行，plan 七条 `component_asset_projection` 无设计 owner 路由 | t2/t5/t6 |
| 13 与 3 的分叉 | 不带当前责任阶段重算，13 个业务文件变更且均在 contracts.files；coding 门传 `pendingOwnerPhase`，10 个已标 coding owner 的源码被排除，只有三个无 owner 的资源仍过期 | t3 |
| plan 失效口径也分叉 | 整链重算会从 spec 传播；真实 upstream 门逐阶段重算，spec/plan 各自命中 color.json、string.json、route_map.json；assess 未传同源上下文，建议 rerun spec | t3/t5；不能通过回卷吸收 |
| UT 文件被提前索取 | file_completeness 与 HMOS plan_file_to_code 都要求 coding 交出 bank_open_card_2_ut.test.ets | t3/t4 |
| 无从验证被说成不可达 | 三条 integration_points 缺 entry_symbol，门直接报“页面孤岛、真机必然失败” | t4/t5；缺定义不等于已证实产品失败 |
| 包装 builder 的 unknown | 两个新 builder 确实从模块公共入口导出；扫描只见包装调用，字体/触控为 unknown，新导出规则禁止 unknown | t4；公共导出登记有依据，不能因 custom 一概豁免 |
| 停机没有动作 | phase_halt 无 halt_guidance；goal-report 只有“等待人工处置/确定性闸门无进展” | t5：先修派发，再同源展示 |

spec＋plan 首轮约 33 分钟；本次未实际回卷，不记为已发生的回卷损耗。新建文件不必然 custom、修改已导出文件不必然 evolve，选型由设计方结合语义、复用对象和影响裁决。页面出现 fp 与 44 高按钮不证明所有表面合格，unknown 既不等于失败也不等于通过。主 Agent 手修后起后继只证明人工编排有路径，不证明 runner 自主恢复。

## 3. 真实记录的四问核对表（t1）

四问：①保护什么事实；②唯一依据及投影；③按原因谁能修；④如何恢复、设计交接是否已消费同一事实。范围是下表及实际记录中同一事实链的直接生产/消费点，不扩成全仓全部检查普查。表是本批 review 材料，不进运行时注册表。

对每条“下游核对上游所写字段”的检查，第四问必须追到上游实际执行分支（包括 CU typed 与普通文档路径），确认该阶段已按同一适用规则核过自己应交的定义；仓里存在一个检查函数不等于该分支调用了它。只核该时点应成立的事实，不前移要求未来代码、测试或 plan 映射已经存在。entry_symbol 的现场就是此类漏接：CU typed plan 分支跳过了原 integration_scope_consistency，三条 requires_modification=false 的缺字段直到 coding 才暴露。

“已确认冲突”来自 §2；“沿旧修复窄核”表示当前应按既有行为验证，不表示本轮已经把历史每个现场重跑通过。t1 将实际 run/阶段/报告关联补入开发验证记录，逐项给出保留、合并、修正、旧修复有效或证据不足结论。只有证实的同类断点进入本批；不同故障类别、无证据加固不顺手扩入。

| 检查或同一事实组 | ①保护对象 | ②依据/投影 | ③按原因的责任方 | ④恢复与交接 / 当前结论 |
|---|---|---|---|---|
| component_asset_projection | 选型与设计权限；混入表达/映射 | 蓝图有效选型；CU/Feature 为投影 | 唯一可推导的映射由框架；未定或冲突选型回设计；plan 自写错误回 plan | 已确认冲突；同一 UI 集合与权威解析，设计期不检查未来 sidecar，t2/t6 |
| contract_file_reference_closure、authoritative_content_aligned | 文件写集与已定契约 | 蓝图/CU 写集、typed 契约、只读资源事实 | 资源误写/获准漏列回 plan；确需修订设计回 owner | 区分三种原因，沿 1caa/28 接线窄核；新静默政策由 t6 承接，不一律 external 或不一致即人签 |
| context_exploration_facts_source_stale、upstream_verdict_gate、upstream_closure_gap | 真实输入变化及上游质量 | 原始证据＋有效所有权/义务；摘要与状态为投影 | 正常下游产出由框架判归属；真实上游变化回对应 owner | 已确认资源归属及 assess 分叉，t3；不让未通过 coding 冒充 PASS |
| file_completeness、plan_file_to_code | 本阶段应交文件 | contracts/CU 目标按已有 phase ownership 分区 | coding/UT 各交其产物；责任不清回 plan | 已确认提前索取 UT，t4；设计可以列全链文件，不要求提前存在 |
| host_entry_reachability、integration_scope_consistency | 实际入口接通与可验证定义 | integration_points/源码/路由；不是名字推断 | 缺声明由 plan 当场补，继承的设计冲突回设计；真实未接通回 coding | 已确认 CU typed plan 漏接原 integration_scope_consistency，t4/t5；核通 typed/普通路径，零修改绑定在 plan 核实，未来接入不提前要求实存 |
| component_export_registered | 公共出口真实库存 | 源码合法导出→派生 index | 授权内确定性刷新由框架；实际错误导出回 coding | 登记本身不删除；查刷新写入归属及返修可达性，t4 |
| component_new_static_checks | 有限质量事实/分析能力 | 真实 UI 源码；四值静态结果是观察 | 实锤缺陷回 coding；unknown 由已有 review/testing 补验证 | 规则禁止 unknown 已确认过重，t4；不把包装层无信息判成坏产品 |
| diff_within_scope、ui_diff_within_declared_files | 实际写权限 | 有效 contracts/CU/阶段写边界 | 合法拼写/投影由框架；越界退责任方；必要扩集经设计重签 | 沿 28 的路径/归属与新设计政策窄核；coding 不自扩权限 |
| plan_to_code、review_scope_to_design | 实现与有效方案相符 | 当前施工契约/源码/review 证据 | 漏实现回 coding；定义错误回 plan/设计 | 保留真实差异检查；只核 owner 与现有回退链，不强迫过时方案 |
| ut_hvigor_test、ut_hvigor_build | 编译/执行真值及环境 | 冻结构建执行记录、设备观察 | 代码/测试缺陷回相应阶段；设备/工具走原恢复 | 沿 4f/28/395 窄核，不重做 OOBE、任务选择和失败收口 |
| change_unit_dag_required、change_unit_mapping_planned_ref_not_allowed | CU 依赖与实施落地 | canonical CU、生产义务及源码 | 派生/时点错误由框架；定义回 plan/设计；实际未实现回 coding | 沿 4f/28 窄核 planned 阶段时序与责任回退，不提前要求未来产物 |
| ut_case_per_unit_ac、ut_coverage_evidence_present、ut_coverage_evidence_resolves | 实测覆盖/证据 | 有效验收＋UT执行及覆盖关联 | 缺测试/关联回 UT；层级定义冲突回 spec | 保留覆盖要求；沿 e9/4f/28 复核真实链，不以补字符串假覆盖 |
| ut_unsupported_targets_handled、named_business_handler | 可测性与真实业务入口 | 验收分层、真实 handler、审计 | 接缝/入口回 coding；层级定义回 spec；测试策略由 UT | 沿 4f 的 option_a/b 与现有候选窄核，不让 UT 自改验收 |
| negative_verdict_closure、conditional_pass_closure | 真实否决不被洗白 | 当前有效 review/verifier 逐项意见与证据 | 实锤交实际 owner；格式/投影缺口沿既有局部修正 | 沿 c6/28 窄核；不放宽负面结论，不新增“先请 verifier 豁免” |
| p0_coverage_integrity、p0_semantic_coverage_integrity、p0_pass_rate_dual_metrics | P0义务/执行真值 | e9 统一设备义务、原生步骤与有效测试计划 | 定义回 spec，测试关联回 testing，实现回 coding | 沿 e9 窄核；生产/消费适用性同源，不因标签或缺记录假通过 |
| visual_diff | 当前范围内真实视觉质量 | 有效参考/范围/严格度＋截图观察 | 内容回 coding；误用范围回定义责任方；provider 故障走原出口 | 沿 c6/e9/395 窄核，保留有效观察，真实差异不由过程裁决覆盖 |
| device_test_run、testing_channel_evidence_obligation | 实测行为/渠道依据与设备状态 | 真实 trace、渠道选择及同源就绪观察 | 用例/渠道回 testing；实现回 coding；环境走等待 | 沿 395 窄核，不把无法运行归为产品视觉缺陷 |
| testing_failure_routing_* | 测试失败归因与修复可达 | 原失败证据＋既有分类/候选 | 按具体失败区分 coding/testing/spec/环境 | 按一族核对生产→summary→runner，不新增平行归因表 |
| no_progress_guard、backtrack_target_absent、framework_bug、预算/设备等停止 | 有界消耗、恢复正确性与诚实状态 | 原事件、有效授权/预算/义务 | 有合法 owner 先交接；真实框架缺口准确诊断；外部/预算原出口 | 旧修复不重做；重点 t5 保留实因/动作，不能用熔断替代责任派发 |

## 4. 改造点、责任入口与修复边界

### 4.1 一份选型事实，多个投影（t2）

责任入口：`blueprint-evolution-decisions.ts`、`change-unit-design-gate.ts`、`blueprint-skill-projection.ts`、`component-selection-check.ts`、`change-unit-feature-projection.ts` 及原 CU 接受/readiness。

蓝图 `component_asset_selection` 仍是选型结论权威；只在这里作一次选择。共用 UI 目标解析覆盖 development 节点及该节点已有 typed 契约内的页面/组件，不再各自枚举不同集合。一个决定可以有多个明确的施工消费者，不强制为每个包装函数新增节点，也不把“模块节点下有 UI 契约”当非法建模。

CU 引用、Feature 映射与 `asset_selection` 保留既有消费形状，但凡可从已闭合决定及现有目标关系唯一派生的部分，由原投影/候选生产链生成，不要求 AI 四处手填。CU 内容有变化仍经正式 consumer 修订，不在接受器内偷偷改候选。组件局部 rationale/bindings 与决定总理由保持原分工，不恢复逐字比较。

设计交接共用“UI适用集合、选型存在/闭合、决定与施工字段实质一致”判据，不调用要求未来 plan sidecar 的完整 `componentProjectionErrors`。plan/coding 只检查自己新增的映射和实现是否符合这份事实。已有投影副本冲突可重建；原设计中实质决定互相冲突则交设计方裁决，不能让 plan 满足两份矛盾真源。

`component_selection` 等错形在设计期按选型专属字段 `asset_resolution` 确定性识别：decision 带该字段却不是 `kind: component_asset_selection`，由原选型检查指出具体字段和应有类型，设计作者依据原事实修正后重验；正式类型缺字段仍沿原 shape 判据。普通业务决定不封闭 kind 枚举。不做名称相似判断、运行期别名归一或静默改写后放行；存量错形走同一道设计检查和正式设计修订。选择、目标或关系不唯一时仍由设计方裁决，不把 plan 已自填的 custom 反推成上游授权。

### 4.2 所有权与新鲜度同源（t3）

责任入口：`capability-resolution-entry-input.ts` 的 source_owners、`phase-write-boundary.ts` 的 `resolvePhaseWriteBoundary/resolvePhasePathOwnership`、`phase-evidence-manifest.ts`、`upstream-verdict-gate.ts`、`assess.ts`、28 的有效范围/完成消费。

共用已有权责事实区分产品源码/资源、UT 源码、阶段权威定义与只读研究来源；不能以 `.ets` 后缀决定资源是否属于 coding，也不能把 contracts.files 任意路径都视作可豁免源码。spec/plan 尚无完整施工绑定时，读取当前已准入 CU/蓝图的既有目标与 required 义务补足归属，不能因 codeBoundary 不可解析而静默丢掉合法资源 owner。用户需求、验收、契约、框架配置、外部只读依赖不因混入 files 就获得 coding 权限。

按归属解析的有效观察是共用输入；不再让调用方自行决定“传不传 pendingOwnerPhase 就换一种事实”。阶段门、assess/reconcile、续跑/后继、完成核验复用同一归属与有效执行上下文。已签发原 evidence 不原地改 hash；正常下游修改不推翻上游研究观察，下游是否完成仍由它的真实 PASS/证据决定。未完成或失败的 coding 不能借“上游未过期”冒充产品完成。

assess 的 active reconcile 已带 phase_outcome，须与同次 gate 读取同一事实；无 active 调用的状态查询/恢复从既有事件与义务取得责任状态，不凭空塞入 pending=coding。单阶段请求无 coding 授权、越界改动、需求/契约改变或未知归属仍保留严格的失效/回责任方语义。解决当前 3/13 分叉后，合法新增 UT 文件、testing 报告不能让 plan/coding 回卷；真正被测源码变化仍使相关 review/UT 证据失效。

### 4.3 按本阶段交付；静态未知交真实验证（t4）

1. `check-coding.ts/checkFileCompleteness` 与 HMOS `coding-host-rules.ts/checkDesignFilePlanToCode` 消费同一阶段产出分区。contracts.files 可以列全链文件；coding 只为自身应交产品文件负责，UT 文件在 UT 验收。保留真实产品文件缺失阻断，不让 coding 造空测试、删规划或通过改后缀绕过。
2. `checkHostEntryReachability` 分清缺 entry_symbol 的定义缺口与实际消费不存在。补接 `check-plan.ts` 的 CU typed 分支到既有 `integration-scope.ts/evaluateIntegrationScopeConsistency` 同源定义规则，让 plan 当场补齐字段；普通 plan 与 typed 路径不能再用两把尺子。requires_modification=false 声称既有绑定，plan 就应核 entry_symbol 与现存消费；requires_modification=true 只核当期应有的定义及获准写集，不要求未来接入代码已经存在。所有 coding 必需的上游声明都按此时序核对。如需改变继承的权威方案，回设计方；字段完整但实际没接通仍由 coding 修。缺字段不能直接写“页面孤岛、真机必然失败”，也不能改成已通过；不新加独立门。
3. `component_export_registered` 保留公共导出登记：以实际合法出口为准，custom 新实现也可以成为公开资产。索引仍由原 `scanComponentIndex/bootstrap-component-index` 派生，沿原索引写入责任及授权刷新，不要求 agent 手写；若当前写边界尚未容纳，应由框架责任入口接续，不能要求 coding 擅自越界或无限重试。
4. 调整 `component_new_static_checks` 及对应规格：`fail` 是已证实的适用静态缺陷，继续修复；`unknown` 表示能力不足，不等同不合格。对包装 builder，优先利用已有导出、源码和路由关系定位真实表面；不为本批新建全程序静态分析器。能确定的依旧检查，不能确定的保留原四值 unknown，按现有 WARN/审查材料进入 review；涉及真实视觉/交互时由既有 testing 验证。
5. 把未确认项、涉及源码和检查事实带入 `componentReviewContext` 及既有 review/testing 材料，禁止仅降 WARN 后丢弃。明确必需的验收没有真实验证不得完成；非必需能力缺口按原披露规则处理。无字体表面才可 not_applicable，不能以未知冒充不存在；页面出现一个合规按钮也不证明全部触控通过。

### 4.4 原因、责任与处置共同产出（t5）

在本表范围内，检查生产点按真实原因填已有 `repair_owner/failure_kind/blocking_class/actionability`，设计问题沿既有 `structured.kind=design_authority`。同一个 check id 可包含多种原因，不建立一张“某 id 永远由谁修”的新总表。修复候选继续经 `repair-candidates.ts`、summary 和原回退/有效义务链，不另解析 Agent 散文来推翻机器事实。

确定性可归一/重建的由既有解析器或派生 writer 处理；当前阶段有权修的沿原有界重试；上游缺定义或真实上游错误第一次就产生对应候选；设计侧问题进入 t6。多个失败并存按依赖顺序先消除上游定义障碍，再保留产品缺陷，不把任何一个 owner 标记当成整阶段 FAIL 豁免。

`no_progress_guard` 继续防同输入空转，但不能用它替代漏接的责任派发。Agent 已在既有审计/报告指出的缺口用于诊断与修复材料，真正接线仍由检查事实产生；不得只教 Agent 换话术或手写 repair-notes。没有合法路径或恢复耗尽时保留真实原因，不兜底编造 code_regression。

停机生产端在原 `halt_guidance` 中列出具体原因/证据、可修责任方、已做尝试和下一步及恢复入口；`goal-progress`、`goal-report-generator` 读同一份。无进展报告不能只有“等待人工处置”；规则冲突不能建议用户重跑整个 spec 链充数。报告不再写一套独立责任判断，不新增停机原因或报告机制。

### 4.5 无人值守设计与架构静默修订（t6）

复用 `design-repair-unattended.ts/runUnattendedDesignRepair` 的草稿、隔离质询、校验和发布骨架，及 `goal-phase-runtime.ts` 原设计权威分支、`decideRunContinuation` 与恢复入口。新政策不再以个人 `design_repair.unattended_b1=true` 为额外前提，不再只修 `authority_content_not_machine_structure`。B1/B2 原分类可用于说明，不能再把 B2 标签直接等同于必须问人；按实际请求、问题和明确限制判是否可自主处理。旧字段保持可解析并说明退役语义，不新增替代开关；明确的人类禁止优先于默认政策。

**完整执行次序与边界：**

1. 在现有设计 owner 分支收敛问题与原需求、裁决、受影响 CU；派发设计责任调用，只处理本次缺口及必要的直接关联。允许原需求内补节点/关系/决定、改技术方案与派生写集，并进行必要的只读调查、按原来源规则登记新观察；“依据事实”不等于禁止调研，也不允许补造事实。禁止改用户需求、实质降低验收、编辑运行记录或产品源码。保留正常质询职责，不能靠作者自报准入。
2. 复用原 run 报告区的修复草稿容纳必要蓝图、CU候选和架构配置候选，不新增权威 manifest/账本。字段级旧限制应收编为本次明确修订范围，不能仍把改决定、加节点、更新必要说明全部判越权；也不能简单删除范围核验放开全工程写入。
3. CU 内容修改必须走 `change-unit-design-preparation.ts/reviseChangeUnitContent`，不是仅 `reconcileHeldBlueprintRefs` 升指针。优先把指针调和已有的 `heldFeatureLocks` 借锁路径（`reconcilePointerInRun` → `reconcileChangeUnitBlueprintRefs` → `acquireBlueprintWriteLocks`）扩到内容 consumer：在本阶段调用已结束的原恢复接点，借入 runner 持有的同一 feature 锁，并按既有 run/锁身份限定本 run 的内容修订，不先结束 run、放锁再另开窗口。当前 consumer 的 running 检查也须同向适配，不能只加借锁参数却仍必报 busy；其它活跃 run、外部调用和竞争仍保持 busy，借来的锁不由 consumer 释放。原绑定有效时在本 run 重评接续；修订导致冻结绑定失效时，由 `decideRunContinuation` 自动承接后继并保留累计预算。不要求用户重发、主 Agent 补文件或额外 supervisor，不新增并行协调器或状态。
4. 架构设计覆盖六类既有 architecture_impact；先换合法候选，再考虑组件下沉，必要时才增边/改模块。模块迁移/退役不等于授权丢失用户数据或删除仍需满足的产品能力。设计方按原需求作决定，`decided_with_authority` 的依据写当前无人值守请求与设计事实，不写虚假的人签；`evolution_candidate.human_decision` 字段名和值域不改，说明此模式由设计方裁定并保留真实 provenance。
5. DSL 必须在施工前达到目标许可，catalog/模块投影按原职责同步。复用 `init-task-executor.ts/executeInitTask` 的配置写入、备份、缓存清理和 `config-builder.ts/prepareConfigWriteForTask` 的现有 UPDATE 校验/保留未改字段；把设计方的已裁决 architecture 候选经现有 `configWritePayload` 接入。**`mergeFrameworkConfig` 只做回填/迁移，当前明确不覆盖 architecture，不能将它误写成现成架构修改入口。** 不重跑整套 init 询问与不相关安装；必要适配限定于原配置 writer 的接线，不由 plan/coding 直接改 DSL。
6. 独立质询核原需求、范围、设计与配置/CU候选的一致性；按候选目标配置使用既有 schema、`validateArchitectureDsl`、蓝图/CU验证，不能让“未落盘目标 DSL”与“必须先检查”形成新的先后死锁。发布由框架走原 writer/consumer，不接受作者手改 hash。发布、CU修订、配置写入有部分失败时不得开工或宣称恢复，依据既有磁盘产物、修订身份和备份从失败步骤恢复，不盲目重做已发布部分，不新建事务账本。
7. 重绑当前受影响输入、重新派生范围/施工投影，原门实际重验通过后继续应执行阶段。架构配置变化会使旧 environment hash 失效，不能原地改旧证据洗白；沿既有重签/后继保留真实有效证明，只作废受影响部分，不重跑全链充数。
8. 所有修复、质询调用和等待继续计入原累计预算。旧 `designRepairSignature` 只含 feature/phase/check/code，不能把相同错误编号当成终身只可修一次：沿原候选身份、输入变化与无进展判据区别新事实和同输入空转，不新增计数器，不通过换 run 重置尝试。具体失败无新信息时如实停止，不能无限自主重试。

自动决议继续写已有 `<phase>/headless-assumptions.jsonl`，由原 goal-report 审计汇总展示改了哪个决定、CU、边或模块、依据什么、最终重验结果。账本只记录，不授予权限、不覆盖失败；权威仍在需求、正式设计/配置与真实验证。多 CU/已完成 CU 的现有身份、依赖与内容修订限制保持，不能为了修当前未完成 CU 改写别人的承诺或历史完成。

## 5. 规格、指引及机制准入（t7）

同步以下已有来源及直接消费点；实施时定向 grep 旧规则并更新相关断言，不无边界重写文档：

| 规则 | 需对齐的入口 |
|---|---|
| 原需求内无人值守设计修订不必问 | `docs/operations/project-entry.md`、`goal-phase-runtime.ts/DESIGN_MODIFICATION_CONFIRMATION` 及引用、`check-plan.ts`、`blueprint-skill-projection.ts`、MIGRATION |
| 新设计恢复责任与接续 | `goal-mode`、`component-design` 的 Skill/reference；`goal-mode-runbook.md`、`design-repair-unattended.md`；现行 OpenSpec 的 B1、goal-runner、CU progression 条款 |
| 旧个人预授权不再是门槛 | `framework-local-config.ts`、`specs/framework.local.schema.json` 的兼容说明、原单测；不重解释为预算/秘密授权 |
| 静默架构裁决与配置落盘 | `component-assets.md`、`app-component-blueprint-workflow.md`（包括 human_decision/architecture_impact）、`plan-workflow-detail.md`、coding Skill、framework-init Skill/config writer 指引、相关 OpenSpec |
| 选型投影与静态 unknown | component-assets 概念/规格、蓝图/CU/Feature 指引、对应 phase rules；fail/unknown 混写条款全部同向调整 |
| 证据归属/阶段产出/停机动作 | 现有事实/phase evidence、assess、coding/UT、report 与相应规格；不新增机器登记 |

主 Agent 的指引与 runner 一致：无人值守设计修复由正式恢复链自动承担，外层只观察/报告，不临场手改蓝图/CU或自行拼 `--supersede`、需求增量。有人在场的现有确认点不改。预算扩容三项条件已经在 project-entry、goal-mode-operations、runbook 中存在，本批只核一致性，不降低门槛。常用 Skill 主干遵守现有行数限制，细节放 reference。

| 改动 | 真实场景与收益 | 复用/删减及准入结论 |
|---|---|---|
| 选型适用集合与投影统一 | 4131b6 上游放行、plan七条必败 | 收编已有解析和派生，减少重复手填；不新增检查 id 或全局 kind 枚举 |
| 所有权有效事实同源 | 1b91ba 的资源 owner 缺失、3/13分叉与 UT 提前交付 | 复用 owner/义务/证据，不新增状态表；下游正常产出无需回卷 |
| unknown 分流到真实验证 | 包装 builder 静态看不穿 | 保留四值与现有 review/testing；不造分析器或质量豁免账本 |
| 设计/CU/架构自动修订接线 | 主 Agent 不在场时既有 B1 修不了并停机 | 扩展原恢复链适用范围与已有 writer/consumer 接线；不新增守护进程、审批模式或停机原因 |
| 原因/责任/指导同源 | 无权阶段重试后只报无进展 | 复用 CheckResult/summary/候选/halt_guidance，报告不另算责任 |

除上述已说明收益的接线，不新增阻断规则、必填字段、状态或注册表。发现确需额外机制时先在本 plan 评审说明具体场景、收益和现有机制为何不足，不在实施中顺手加入。

## 6. 开发验收（t8）

| 场景 | 必须证明的结果与反例 |
|---|---|
| 真实四问表 | 20个 run 逐一关联证据；缺原件/截断/重建分开；下游核上游字段逐项追到上游实际分支；已修项复用证据，当前冲突才改；历史层继续报旧错误 |
| 选型同源 | rev4带asset_resolution而kind错误的记录在设计期被准确指出，作者修正后交接；无该专属字段的普通业务决定不被名称匹配误伤；模块节点内UI与独立节点同样适用，无未来sidecar也可交接；一决定多组件合法，冲突决定不任取，不靠运行期别名归一 |
| runner 自动回设计 | 不让测试替身直接预写“修好”结论：真实候选/原 consumer/发布重绑运行；4131b6形状从 plan 失败交 owner，正式修订后进入 coding，无用户或主 Agent 救场 |
| CU 与 busy/接续 | 需要改design_refs的修复通过同一run既有heldFeatureLocks完成内容修订，不先停run造窗口；consumer不释放借锁，外部/竞争run仍busy；绑定未失效原地重评，实际失效才自动后继；失败不假完成，旧证明/预算/身份保留 |
| 架构授权 | 六种 architecture_impact 在原 schema/投影覆盖；至少一条 dependency_edge 和一条模块变更走真实配置writer→校验→CU重签→续跑。原需求内静默，用户明确禁改/凭据/不可逆外部动作仍拒绝；有人在场流程不变 |
| 配置与质询 | 原配置中不相关字段保留；无效 DSL、伪造人签、质询真实否决不能发布/继续；失败后恢复正式产物一致，不改旧 evidence hash、不新建状态账本 |
| 新鲜度四处一致 | 1b91ba 原 evidence/写集：10个源码与3个资源的合法产出均不反向推翻 spec/plan，gate、assess、恢复与完成核验读同一结果；coding 自身 FAIL 仍不能完成；无 active 上下文不靠强塞 pendingOwner 放行 |
| 防回卷与防假通过 | UT新测试、testing报告不使上游失效；真实需求/验收/契约变化、只读输入修改、越界源码仍使相应责任证据失效。单职责无实现授权不能借 owner 逃逸 |
| 分期文件交付 | coding产品齐全、UT文件未到产出阶段时不因该文件 FAIL；UT阶段缺它仍失败；产品文件缺失仍由 coding 修，两处完整性检查一致 |
| 入口与责任 | CU typed与普通plan均在requires_modification=false缺entry_symbol时当场要求plan修复；true且声明完整但接入代码待coding产出时不提前拦；存量缺定义仍经真实检查→summary→候选回plan/设计；实际未接通仍回coding |
| 公共导出与 unknown | 真实包装 builder 保留 unknown并带入实际 review材料/适用testing；索引由既有扫描刷新；可确定 fp/尺寸反例仍报真实失败，未知不变PASS或not_applicable，不因custom跳过公开出口登记 |
| 混合失败与无进展 | upstream定义缺口先处理，剩余真实coding缺陷继续修；不可修或耗尽时原事件/状态/报告均含同一实因、责任和动作；不能只断言存在字符串 |
| 联合组合 | 按用户确认的新正确链路，10-19两个输入经真实runner生产接线贯通设计修订→plan当场补齐入口声明→coding资源变化→review→UT责任交接；旧输入缺声明后回plan的兼容恢复单列，保留真实checker/候选回归并写明验证层级，不为凑旧顺序绕过plan检查。耗时模型调用可用限定替身，检查、发布、范围、归属、恢复判定不手填。现有 real-chain 继续守住 review/UT/testing，不另起长时宿主彩排 |

目标套件优先扩展 `host-recovery-history`、`host-replay-fixes`、`component-design-handoff`、`component-assets`、`phase-evidence-manifest`、`assess`、`goal-assess-driver`、`execution-scope` 和已有设计修复/config writer 测试。关键接线做必要反向变异：恢复旧的 UI 漏判、资源归属遗漏、assess上下文分叉、coding索取UT文件、unknown一律阻断、仅CU指针调和或 no_progress 无指导，应被对应生产回归抓住；不为穷举每行变异增加整轮重跑。

完成生产逻辑后按 AGENTS.md：官方 `cd harness && npm test` 全 PASS（包含官方 typecheck），`npm run openspec:validate`、`node scripts/check-plan-version.mjs`、`git diff --check` 与 LF核对通过。先目标测试、稳定后一次全量；纯文案窄返修复用仍有效结果。实施代码 review 按用户要求实际调用 Claude Code CLI 并打印调用及结论，验证记录沿原 reports 位置；提交前汇报，未获提交授权不提交。本轮计划评审由用户交 Claude，不调用代码 review 或跑产品测试。

## 7. 联合验收与不做事项（t9）

本 plan t9 与 395 t6、38 t7、664 t7、4f t10、c6 t9、e9 t7、a47 R5/H1 共用用户安排的一次干净宿主原需求观察，联合验收保持 pending。按用户 10-18 后续决定，系统引导已自行完成，不再在宿主测试该故障场景：395 引导恢复分支记为真机未验证，仅由已有开发接线测试覆盖，不冒称真机验收通过；本次联合验收不保留、不重置或制造 OOBE 现场，其余真实 UT/testing 与交付验收照常。此处更新本次观察口径，不改 28/395 已完成的开发范围与状态。

准备时必须单独处理 Git 忽略的目标 Feature 生成目录，保留原始需求/参考图；这是将来验收准备，不是本轮清理或操作手机的授权。

宿主仍只接受最简单的原需求输入，不把修复指令、内部观察点或手工补元数据任务塞给宿主。Maison 开发侧依据原事件/产物观察自动恢复、无效重复、首次可用交付和真实完成；不依赖用户“查进度”触发修复。自然未触发的恢复分支以开发接线测试报告，不冒称宿主已覆盖；旧现场手修接续不能算干净无人值守验收。

不做交付前彩排、全仓阻断普查、固定完整工作流重构、独立规则引擎/状态机、运行时巡检注册表、全程序UI静态分析器、账本豁免、额外预算系统或自动修手机。新场景若超出 §3 的真实故障类别另行说明，不凭“所有问题本批修掉”无限扩面。

## 8. 当前状态

2026-10-19：依据用户合并裁决起草，基线 ce2465d0 / 3.1.0。已完成起草所需只读核对：最新两个run的终态、3/13新鲜度分叉、包装builder、无进展报告和原设计/CU/config恢复入口。§3为待实施核实的四问边界，不宣称完成20个run全部生产回放。t1–t9均 pending，等待Claude计划评审及用户实施指令；只新增本plan、同步a47，不改28/395已完成范围，不写夹具、不实施、不提交、不打包、不动宿主或手机。

2026-10-19 首轮评审返修：落实一条必修及三条建议。撤掉保留/重造OOBE现场的要求，395引导恢复分支如实记为真机未验证、开发接线覆盖；四问补查上游实际typed/普通分支，entry_symbol沿既有规则在plan补齐；CU内容修订优先扩展原heldFeatureLocks借锁并限定本run资格，不先结束run造窗口；错选型类型只按asset_resolution在设计期识别，不做名称相似或运行期归一。保留此前撤回结论：不能用文件新旧机械推出custom/evolve，也不将decision.kind封闭成枚举。本轮仅窄改计划与路标，全部todo及联合验收仍pending，未实施。

2026-10-19 代码评审返修（M1/M2）：t1–t7 已实施；撤回原 t8 完成声明，保持 pending。已补 no_progress 真实 runtime 指导断言及删除兜底的变异；10 个受影响 release-only 套件整套执行，发现的失败逐因修复并窄复测；RC-9b 连续两次可信 UT 失败均交 coding，最终 UT 通过，RC-9 普通回退仍通过。范围修订保留可信候选的重开意图，并接回原返修事务传递候选身份与拒修上下文。真实 contracts 还暴露出“补 entry_symbol 却违反无 ID 行全字段对齐”的直接冲突，已按原权威字段规则统一，原标量和 files 写集约束不放宽。当前官方 npm test 5478/0、fixtures 46/0，OpenSpec 58/0；实际 Claude Code CLI 窄复核无必须修复项，记录在 harness/reports/5bddfc4a/review-repair/。

联合组合覆盖差异待用户裁定：新 typed plan 已在 plan 阶段发现并补齐 entry_symbol，正常新 run 的实际顺序为“设计修订→plan 声明修复→coding 资源写入→UT 交接”，与 §6 将声明修复列在 coding 之后的表述不同。新增 RC-10 用 10-19 保全输入贯通这条新正确链，真实检查、发布、归属和恢复不绕过；旧形状的 coding 缺声明→plan 候选由真实 checker/候选单元回归覆盖，未宣称同一 runner 组合已重演旧顺序。rev4 CU 原件缺失仍如实标注，使用受控旧形状绑定不冒称完整历史还原。RC-10 正在执行，在最终结果及该覆盖差异获确认前，t8 不标 completed。联合宿主 t9 保持 pending，未提交、打包或操作业务宿主/手机，28/395 完成范围不变。

2026-10-19 返修阶段结果：RC-10 先抓到本批索引刷新晚于输入取样的真实回归，已将原 writer 前移到取样前，保持绑定检查严格；最新生产代码官方 npm test 5478/0、fixtures 46/0、exit 0，CLI 窄复核无必须修复项。之后只修测试作者材料：review 实际阅读目标写入本阶段 delta，专项覆盖29个真实目标，baseline不改。最后一次完整 RC-10 耗时2660秒，已自动完成设计修订、plan修声明、coding资源写入与review，进入真实UT调用；终点断言错误地要求prompt内联测试文件名而失败。真实入场事件已将缺失的bank_open_card_2_ut.test.ets归属UT，断言现改读同run/attempt的正式facts_context，保全事件的窄复核与typecheck通过。但该次登记结果仍为0/1，后续新鲜度与末尾断言尚未执行，不能称整链验收通过。

按代码review M1允许的成本例外，t8继续pending，待用户决定验收顺序差异及是否继续完整复跑；不擅自取消用例、不用局部通过替换原失败结果。性能取样表明主要开销在新鲜度/身份中性摘要反复解析CU与蓝图，本批只记录，不另建缓存或扩面。完整证据见harness/reports/5bddfc4a/review-repair/REVIEW-REPAIR.md、verification-matrix.md及各原始日志；M1①②、M2已验证，M1③尚未收口。t9与既有联合验收仍pending，未提交、打包、改业务宿主或手机，未混入其它会话改动。

2026-10-19 用户确认“新正确链路＋旧态恢复另列”：§6联合组合按实际生产顺序验收，旧形状的checker/候选回归与通用runner恢复验证各自列明，不冒称同一组合重演旧顺序。已开始完整复跑修正终点断言后的RC-10；217个文件与上轮收口快照无漂移，生产代码全量结果复用，t8在复跑通过前不标完成。联合宿主t9仍pending，不提交、不打包、不动宿主和手机。

2026-10-19 开发验收收口：CLI窄核发现测试将环境attempt（i13）与事件invoke_id（ut-i13）直接比较，已按既有写法补阶段前缀并要求attempt非空。修正后官方完整RC-10为1/1、exit0，耗时2584秒（约43.1分钟）；自动设计修订、plan当场修声明、coding资源写入、review、UT正式入场归属、spec/plan新鲜度及末尾断言全部执行通过。没有以旧0/1或窄验证代替这次完整结果。最新官方typecheck通过；发布代码未变，复用5478/0、fixtures46/0、OpenSpec58/0及已完成的10组release-only补测与对应窄返修。最终实际Claude Code CLI复核结论为必须修复项零、未见直接回归、可收口，调用和结论已打印。

据用户已确认的§6口径关闭t8，旧态checker/候选回归与通用runner恢复单列，不冒称同一链验证。当前重放事件、manifest及各阶段证据保存在harness/reports/5bddfc4a/review-repair/approved-chain-evidence/；结果为rc10-approved-final.json，CLI结果为claude-approved-close.json。用例在UT交接哨兵处结束，不代表真实UT/设备执行或业务交付。43分钟开发回放的重复解析开销已记录，未扩成新机制或宣称宿主提速。t9及所有既有联合验收继续pending，未提交、打包、改业务宿主或手机，28/395完成范围不重开。
