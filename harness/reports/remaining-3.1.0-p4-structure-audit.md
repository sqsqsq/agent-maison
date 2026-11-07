# P4 删除、保留与迁移核对（2026-11-06）

核对基线为前置三项提交后的 main（755d6c0e），并纳入 P4 本项差异。这里只记录结构和责任去向；测试最终结果另见 handoff。没有将关键词命中一概当作执行路径，也没有删除历史原件。

## D1–D11

| ID | 当前去向与核对点 |
|---|---|
| D1 | GoalPhaseRuntime 的 invokeWork 按 work-unit-author 保留同单元会话；无 resumePostAgentPhases。goal-in-session-driver.ts 已删除。独核/初建设计的职责标签保留，不是 CU 冷作者队列。冷派工内存变异被 daily-recovery 原例杀死。 |
| D2 | assess、correction-routing、repair-candidates/responsibility 保留真实发现与责任对象；共同 check-disposition 决定 repair/verify/wait，不以旧 phase action 表执行下一作者。phase-transition-policy 现为检查族元数据、请求范围/NL 与旧事件词汇读取。 |
| D3 | workflow requires、scope显式control/proof仍决定真实执行前置；inputEdges/inputOwners只传播实际材料失效，不再把review/UT互读误排成控制环。原件工作流SHA一致、最小回归修前红/修后绿，显式控制环反例仍拒绝。原27条旧红另按同名场景逐条定性，未反推未复现的历史根因。 |
| D4 | receipt/closure/finalizer 是机器证据 writer；resolveCurrentDisposition、verify-feature-completion 决定完成；exit0/hook/summary PASS 不是完成证明。强制 completionEligible 的变异被原硬失败反例抓住。 |
| D5 | goal-timeout.ts 已删除；新 manifest builder 不写旧 budget/phase deadline；effectiveHeadlessUnattended 丢弃旧 max_turns/timeout；仅 user_deadline_at 和实际工具/静默保护生效。GoalBudget 类型仅允许读旧记录。 |
| D6 | delivery-origin 保留原请求身份；不再累计预算控制。goal-progress 中 turns_limit 仅旧 manifest 展示；adjudication/goal-runner-phase 的旧 budget halt 字面仅历史归类/接续。没有预算重置或新别名。 |
| D7 | design-repair-unattended 保留草稿/锁/事务发布和原件恢复，input.invoke 由同一作者会话内核承接；repairRoleStart 只定位原调用。唯一 for(;;) 是 QuestioningFormatFailure 原反馈修复，dispatcher 对相同输入暂停，不是旧内容次数循环。 |
| D8 | hook/stop 只触发共同协调器，独立请求沿原 execute_command；无 manual_fallback/no-run 完整交付。P4 无把 author 完成信号写成正式完成。 |
| D9 | 普通框架故障提示要求继续独立授权工作；root goal-runs 不在 FEATURE_MARKER_DIRS。实际项目 compile 和混合框架等待/业务修复/恢复用例覆盖；恢复HALT及误加目录变异均红。 |
| D10 | 现行 skill/adapter/workflow 按产物性质和真实授权界定写入；agents-entry-detail 唯一漏网的预算停机段在本批清理。MIGRATION 旧分批行为留历史，并由顶部现行迁移说明明确覆盖。安全注入故障专用 halt 不等于普通 framework bug 全停。 |
| D11 | 旧配额/阶段结构专用断言退役，真实业务/权限/完成反例仍在日常及正式扩展域；正式全量逐组执行，不把历史失败改成 PASS。七种生产内存变异复用原用例，无源文件写入。 |

## K1–K10

| ID | 保留落点 | 验证责任 |
|---|---|---|
| K1 | 蓝图/CU/readiness、execution-scope、change-unit-progress-loop | daily-design 完整交付、scope/ready-set、real-chain/seams |
| K2 | run-control/epoch/锁、guardian/PID、invocation-completion | session-execution-handoff、session-slow-gate、agent-invoke-settle |
| K3 | invoke/parsers/request/report/events/write snapshots | 双运输、精确SID与重报去重原例；新 DSH 短续接 |
| K4 | disposition/current inputs/executeCheck/完成与发布分层 | check-disposition 及 consumers、completion-tools、current-disposition-recovery |
| K5 | 共用schema/admission/投影/独立questioning | component-blueprint、initial-design、e2a4145e 原件接续 |
| K6 | evidence manifests/facts/keys/冻结工具证据 | evidence-validity、phase-evidence、real-chain与影响复验原例 |
| K7 | 真实 checker/profile/verifier/tool providers | 正式全量；自含 TSC/Node 实跑，HMOS设备不冒称已验 |
| K8 | phase-write-boundary/只读独核/testing机器结果保护 | 原 writing-boundary、testing-integrity、DSH只读实际工具面 |
| K9 | 原件/有效历史/完成与发布分层 | 原宿主hash不变；历史读取与旧完成证明，不重开t8 |
| K10 | 单职责/global/maintenance/adapter/profile接缝 | standalone-coding-review、global与双运输范围测试 |

## M01–M54

以下为 goal §5 全部54行责任映射；M02–M52仍覆盖原补丁46文件，M53/M54另计，不缩成46行。并入表示现行实现已承接有用职责，不声称原 b84 全补丁按字节重新应用。

| ID | 当前去向 |
|---|---|
| M01 | b84 plan 保留停点与已完成事实，未验联合责任转 P4 t5/t6，仍 pending；未改 b84 文件。 |
| M02 | app-component-blueprint schema readOnly/过程字段；历史 frontier 字段 deprecated，不作为新准入计数。 |
| M03 | component-blueprint-model 共用 author content/责任指引；进展由共同完成评估。 |
| M04 | component-blueprint-validator 读取共享 schema 与全部真实独核。 |
| M05 | blueprint-discovery currentBlueprintSliceId 是统一 slice 定位。 |
| M06 | blueprint-views 不代答 applicability；空骨架不等于合格。 |
| M07 | blueprint-reader-guide 内容摘要；实际依赖变动仍重评。 |
| M08 | blueprint-questioning 保留真实调用壳/完整否定；e2a验收证明送回作者。 |
| M09 | frontier_budget/repeated_frontier_count 只剩历史 schema 描述；当前收敛由共同事实判断。 |
| M10 | change-unit-design-preparation 读取完整准入和可投影缺口。 |
| M11 | change-unit-reconciliation 完整语义校验/有效绑定与承接。 |
| M12 | change-unit-validator 保留 provenance/revision/身份冲突，非信摘要PASS。 |
| M13 | prepareBlueprintDesignDraft 提取为确定容器准备，作者仍负责业务内容。 |
| M14 | designWorkSnapshot/inputFingerprint 观察实际草稿；byte change 不能单独续命。 |
| M15 | design repair 保留候选/失败原件与发布事务，恢复沿已有request归属。 |
| M16 | 原冷循环被工作单元会话/增量独核承接，repairRoleStart 仅原件定位。 |
| M17 | GoalPhaseRuntime 初建准备/独核写保护保留；waiting不签准入。 |
| M18 | 旧阶段重试/回退队列退役；原设计与工作单元作者接当前任务。 |
| M19 | 运行观察/暂停指引/显式继续保留；无变化不重拉。 |
| M20 | initial-design-delivery 保留机器/作者分责与真实终点，purpose不派CU冷作者。 |
| M21 | assess 读共同当前处置，不按内容次数截断必需缺口。 |
| M22 | phase-transition-policy 不再有旧phase行动表；只保请求/检查元数据。 |
| M23 | goal-failure-classifier 用完成义务/核实发现比较进展，不把unknown当失败。 |
| M24 | goal-manifest 的 budget 字段仅旧读取；新builder不用。 |
| M25 | supervisor 沿真实条件恢复，固定重启数不作为任务额度终止。 |
| M26 | provider-admission fixtures 保真实Q与业务否定，不依模型自报次数。 |
| M27 | adjudication tests 保授权/故障分类及旧原因读取，不要求新产旧额度停机。 |
| M28 | assess tests 验证共享反馈与完成结论。 |
| M29 | component-blueprint tests 保坏Q/缺口不可发布。 |
| M30 | design-authority-repair tests 保设计owner/独核/重签与恢复；旧结构红项按实际语义定性。 |
| M31 | goal-assess-driver tests 转共同处置/终点。 |
| M32 | goal-headless-guard 保未知/有据进展/字节抖动反例，本批加普通framework故障提示断言。 |
| M33 | goal-runner-policy 保显式用户时限、取消、权限，旧默认配额退役。 |
| M34 | repair-convergence 场景由同会话完成进展/往复暂停承接。 |
| M35 | testing-integrity 保弱化测试/伪结果/拒修与必须证据反例；Jimp造图API仅适配。 |
| M36 | supervisor tests 保条件变化恢复，不查账号余额。 |
| M37 | initial-design-delivery tests 保初建输入完整送达与独核原件复用。 |
| M38 | initial-design-repair tests 保失败原件/跨signature/格式恢复，不沿旧冷角色循环。 |
| M39 | initial-design-waiting 保双运输waiting不可准入与幂等。 |
| M40 | phase-transition-policy tests 保范围/NL/检查族输入，不复活旧行动表。 |
| M41 | testing-stepresult-evidence 保设备执行事实/结论一致，替身不称真实设备。 |
| M42 | MIGRATION 顶部当前迁移优先；旧分批记录只作历史，不能反推执行配额。 |
| M43 | phase-transition-policy 概念文档为方法/里程碑与真实证据依赖。 |
| M44 | goal-mode-runbook 为同单元next/report/resume/环境恢复/用户截止。 |
| M45 | ledger-class-failure-containment proposal 保同源处置，不依旧次数。 |
| M46 | 同 change goal-runner spec 保账本可重建/必需未知不通过。 |
| M47 | managed-initial-design-delivery proposal 为持续工作单元入口，ready不等于交付。 |
| M48 | 同 change complex-capability-meta-model 保正式蓝图权威与机器分责。 |
| M49 | 同 change goal-runner spec 保初建→CU→原请求终点。 |
| M50 | component-design Skill 机器字段/业务作者责任同源，无默认额度流程。 |
| M51 | blueprint-workflow reference 保投影/质询/进展真实事实，不手抄机器身份。 |
| M52 | design-repair-unattended reference 为同授权设计单元修订，两呈现同规则。 |
| M53 | 旧phase/receipt/summary/预算字段只读承接成果与历史；原件hash保留，旧执行器不复活。 |
| M54 | architecture 已转开发现状且真实宿主pending；overview 保三层分离、能力拆解和3.1–3.9教训。754/91/P7旧执行口径由P3清理，a47/6fd/c6本轮用户保护改动不碰，未覆盖联合义务不自动关闭。 |

测试结果和仍存真实缺陷须以本次 full/定向原件及逐条红项表为准。结构去向不替代业务验收，未取到6fe679完整保全链不冒称已有原件级全链覆盖。
