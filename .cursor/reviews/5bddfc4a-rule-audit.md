# 5bddfc4a 四问核对（开发记录）

基线 ce2465d0；本表不进入运行时、不注册检查。t1已完成真实记录清单与规则生产/消费核对，生产接线回归在t8执行；不能把本表当作20轮已重跑通过。

## 记录边界

已核对 20 个 events 文件。4131b6 rev4按补丁逆推后的SHA256与原run绑定一致；旧CU/覆盖后的报告缺口沿sources.json说明。d818e6仅保存到08:16:14Z。

| 记录 | 事件数 | 实际phase_halt |
|---|---:|---|
| 20261016/20261016T065049Z-408844/events.jsonl | 145 | plan:no_progress_guard；plan:no_progress_guard |
| 20261016/20261016T083014Z-b5ada8/events.jsonl | 187 | coding:backtrack_target_absent |
| 20261016/20261016T103148Z-b9ac66/events.jsonl | 164 | review:backtrack_target_absent |
| 20261016/20261016T121435Z-b632bb/events.jsonl | 76 | review:budget_wall_clock |
| 20261016/20261016T155250Z-4ca610/events.jsonl | 8 | coding:budget_wall_clock |
| 20261016/20261016T160736Z-b23184/events.jsonl | 76 | coding:budget_wall_clock；plan:backtrack_target_absent |
| 20261016/20261016T170800Z-71c521/events.jsonl | 241 | ut:device_not_ready；testing:no_progress_visual_gap |
| 20261016/20261016T193756Z-1b12f4/events.jsonl | 215 | ut:budget_wall_clock；ut:no_progress_guard |
| 20261016/20261016T220800Z-65403a/events.jsonl | 159 | ut:no_progress_guard |
| 20261018-oobe/events.jsonl | 117 | 此保存片段无phase_halt |
| 20261019/20261019T024808Z-4131b6/events.jsonl | 67 | plan:no_progress_guard |
| 20261019/20261019T033030Z-1b91ba/events.jsonl | 102 | coding:no_progress_guard |
| r5/20261012T121727Z-23f8d5/events.jsonl | 78 | spec:framework_bug；spec:framework_bug |
| r5/20261012T131449Z-ee81fd/events.jsonl | 97 | ut:no_progress_guard |
| r5/20261012T144628Z-66d180/events.jsonl | 107 | review:no_progress_guard |
| r5/20261012T161922Z-dca0e5/events.jsonl | 379 | review:backtrack_fingerprint_repeat |
| r5/20261012T204232Z-847ca7/events.jsonl | 269 | review:no_progress_guard；ut:no_progress_guard；coding:upstream_closure_gap；coding:upstream_closure_gap |
| r5/20261013T001316Z-0eecab/events.jsonl | 132 | review:no_progress_guard |
| r5/20261013T015410Z-8ff819/events.jsonl | 322 | 此保存片段无phase_halt |
| r5/20261013T055551Z-f84ff8/events.jsonl | 359 | testing:budget_wall_clock；testing:external_retry_exhausted |

## 四问与责任

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

## 当前生产分支核对结论

| 事实组 | 实际入口 | 处置 |
|---|---|---|
| 选型/投影 | blueprint-evolution-decisions.ts / change-unit-design-gate.ts / component-selection-check.ts | 修正：UI节点与typed组件两套集合；asset_resolution错kind被跳过；缺映射与缺决定都扔回plan。保留选型实质检查，确定性投影取原权威。 |
| 闭包/权威对齐 | check-plan.ts / blueprint-skill-projection.ts | 保留28的只读资源、已授权漏列、扩写集三分；设计确认政策由本批替换，不能回到无条件补files。 |
| 新鲜度/上游 | capability-resolution-entry-input.ts / phase-evidence-manifest.ts / assess.ts / upstream-verdict-gate.ts | 修正：spec/plan无施工绑定时资源owner丢失；gate传pending、assess不传；同一状态3/13两结论。统一归属，不回卷消化。 |
| 阶段文件交付 | check-coding.ts / profiles/hmos-app/harness/coding-host-rules.ts | 修正：两处直接遍历contracts.files，未分UT归属。生产所有权已有SSOT，不能靠后缀再造一套。 |
| 入口声明 | check-plan.ts typed分支 / integration-scope.ts / check-coding.ts | 修正：普通plan会核零修改绑定，typed分支漏调；缺entry_symbol不是产品不可达。先plan补定义，真实接入缺陷仍coding负责。 |
| 公共导出/静态能力 | component-selection-check.ts / component-extractor.ts / componentReviewContext | 修正：公共出口登记有效；框架刷新索引不该被当coding手写义务。unknown保留观察与review/testing责任，不作为静态实锤失败。 |
| 写边界/计划实现对齐 | phase-write-boundary.ts / check-coding.ts / ui-scope-gate.ts | 保留真实越界与已签发契约对齐；必要设计变化经正式修订。本批不放宽coding字面越界比较。 |
| UT执行、构建与设备 | ut-hvigor-test-failure.ts / hvigor-runner.ts / device-readiness-gate.ts | 沿4f/28/395保留：模块任务选择、执行诊断、设备等待、同次失败收口；OOBE真机分支未验，不重造现场。 |
| CU/DAG/计划引用 | change-unit-feature-projection.ts / repair-candidates.ts | 沿已有阶段适用性与28授权域回退；不为planned引用提前要求未来源码。设计缺口接新自动设计链。 |
| UT覆盖、入口与可测性 | check-ut.ts / repair-candidates.ts | 保留真实验收与覆盖证据；已有option_a回spec、option_b回coding，不让UT改验收。记录形状与真实覆盖不混为一谈。 |
| 负面/条件裁决与scope | goal-closure-gate.ts / review报告及repair-candidates.ts | 保留有效否决和独立审查；c6局部修正与28回退既有通路复用，不由账本覆盖失败。 |
| P0设备证据 | p0-semantic-gates.ts / runtime-step-evidence.ts / check-testing.ts | 沿e9统一P0义务与真实步骤，定义缺口回spec、实现回coding、测试关联回testing；不新增适用性真源。 |
| 视觉/渠道/测试路由 | check-testing.ts / visual-provider-review.ts / repair-candidates.ts | 保留目标/严格度与有效观察；设备、provider、真实内容分别走395/e9既有出口；本批只核责任接续，不重做视觉体系。 |
| 无进展/终态 | goal-phase-runtime.ts / goal-report-generator.ts | 修正：当前无权阶段先派责任候选，剩余无进展保留真实原因、owner和动作；不新建halt类型。 |
| 预算/授权/普通回退 | goal-run-creation.ts / execution-scope.ts / goal-phase-runtime.ts | 保留28有效义务与授权域、累计预算、出生拦截；本批仅设计/架构无人值守政策替换。 |

当前需改的规则集中在选型、资源/阶段所有权、typed定义生产、静态未知、责任派发和设计/CU/架构恢复；其它组保持真实质量与既有修复，通过目标测试防直接回归。不依据历史失败自动放宽产品真值。机器可检索的原事件检查ID与哈希见 harness/reports/5bddfc4a/history-inventory.json；冻结报告/日志路径由同目录sources.json关联，不手填历史事件。
