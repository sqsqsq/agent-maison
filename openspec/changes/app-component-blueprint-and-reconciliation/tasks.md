# Tasks: App Component Blueprint and Reconciliation

> 本 tasks 属于 P1 实施清单；设计复核通过后已进入实施。checkbox 按已完成并验证的事实更新，仍须遵守 P0 元模型、权威边界与静态 provider 接缝语义。

## 1. Blueprint protocol and authority contracts

- [x] 1.1 定义并冻结 provider-neutral App 部件蓝图 canonical YAML schema：根对象必填 `component_id`，同一文件内含 `review_summary`、`design_views`、`decisions_and_gaps`、view instance、稳定地址、revision、`source_fingerprint`、provenance、verification refs 和合法 disposition。
- [x] 1.2 定义 `viewpoint contract` 与 `view instance` 的分离，以及 `logical`/`runtime`/`development`/`deployment`/`scenarios` 的适用性、必需性和 `not_applicable` 证据规则。
- [x] 1.3 实现 authority/provenance 解析与冲突诊断：代码/接口/schema/测试事实优先，unknown 原样保留，根/discovery `source_fingerprint` 从规范化 discovery facts 与 provenance 确定性重算，来源不可访问时形成带 owner/解除条件的缺口。
- [x] 1.4 实现 operation/DTO/mapping/provenance 链校验，外部契约使用稳定 `contract_id`，从项目根安全解析每段 source ref 的权威文件/fragment 并真实比对 request/response 字段语义、转换/默认规则、错误、幂等、NFR、owner、needed-by；禁止逐字段同形 diff，允许 `parent_level_id` 等显式派生字段，并只为外部权威字段与显式转换/派生边绑定 provenance；禁止由 endpoint、DTO 名称或蓝图内部自洽推断闭合契约。
- [x] 1.5 将当前事实发现、SE/人工契约输入、App design lens、独立质询接入静态内置 provider seam，并将 P1 Skill 登记到既有 `skills.index.yaml`；验证 provider id 唯一、requirement 仅 `required|optional`、冻结权威/source rule、缺失、替换、冲突和不修改 Goal Mode 完成事实的边界。
- [x] 1.6 复用既有 YAML/schema/hash 能力，增加最小 `component-id`→`<project_root>/blueprint/component/<component-id>/component-blueprint.yaml` 路径解析，并定义 `component-blueprint@1` 的 `component_blueprint_ref`；覆盖 path/YAML/ref 三处 component identity 一致、`source_fingerprint` 与 `artifact_sha256` 分离校验、target 前 canonical schema/完整性门、blueprint/view/node/relation/flow/decision/contract 精确寻址、仅 node/flow 强制 `view_id`、decision/contract 顶层寻址、拒绝任意 path/feature/legacy fallback，以及 Markdown 只能作为带 `derived_from` 且完整投影视图/flow/contract/relation/questioning/admission 的评审前 derived projection。

## 2. App discovery and 4+1 blueprint generation

- [x] 2.1 实现 App 部件发现入口：消费产品需求、SE 外部输入、代码/schema/接口/配置/测试、architecture/catalog/code-graph/conventions 与可选组件资产，并为每项结果生成 provenance。
- [x] 2.2 实现 App design lens：填充模块边界、能力接缝、特性开关、数据生产者/消费者、生命周期触发、状态 owner、初始化、发布订阅、UI 刷新和进程恢复根问题。
- [x] 2.3 实现单一 canonical YAML 产物及稳定 node/relation/flow/decision/contract 寻址；验证同一蓝图内三组同源内容、跨 revision 的语义身份、`supersedes` 和 P2 可消费的引用切片。
- [x] 2.4 实现适配 4+1 view instance 生成与 applicability checker；验证 executable App 的 runtime 必需、deployment 的证据化不适用、适用视图的当前态/目标态/delta 非 unknown、节点与验证引用非空，不接受字段齐全但内容空壳。
- [x] 2.5 实现证据驱动的独立质询 provider：隔离编写上下文，从 canonical YAML 派生并唯一覆盖每个适用 view/relation/runtime flow 与十个 App 根问题，证据化 `not_applicable` view 不进入强制 scope；记录证据、disposition、frontier fingerprint、owner 和验证引用，质询 scope 缺失/重复不得跳过。

## 3. Cross-view and runtime completeness

- [x] 3.1 实现跨视图关系 checker：scenario→logical/runtime/development/适用时 deployment、runtime edge→logical contract/development owner、模块/运行节点→设计依据、view→decision/gap 均逐项解析到真实且类型匹配的稳定对象，以及术语/契约/状态 owner/失败语义冲突诊断；非空悬空地址 fail-closed。
- [x] 3.2 实现 `runtime_data_flow` 最小形状、稳定 `flow_id` 和六项触发条件（持久化/远端 UI 展示、多 consumer、后台/系统/外部/定时写入、冷启动/恢复/挂载/账号切换、用户修改刷新其它 consumer、缓存/同步/freshness/一致性/进程重建）；完整校验 source-of-truth/reconciliation、trigger idempotency、initial-load/recovery 稳定 id 与 freshness、state owner、非空 evidence/verification、failure/recovery、provenance/verification refs；mutation/publication/subscription/consumer 由实际行为条件式要求，只读/首次加载流不得伪造写入链。
- [x] 3.3 实现 runtime flow 双向追踪和 lifecycle matrix：局部 id 唯一，consumer→initial-load/适用时 update、subscription→consumer、mutation→publication/recovery→受影响 consumer 引用真实存在，producer 正向追所有影响并拒绝孤立 publication/consumer，冷启动/前后台/外部触发/恢复交叉检查，并将缺边保留为 frontier。
- [x] 3.4 实现生成图适配器：只有本轮生成图时做 parser、节点寻址和边引用检查；覆盖“图可解析但结构化对象不完整”和“不生成图不阻塞但不得跳过完整性门”的反例。
- [x] 3.5 实现分层准入：从实际 App lens/质询 scope、契约/地址/视图/runtime checker 及 schema、artifact、source fingerprint 等全部准入前 BLOCKER 派生 root questions、contracts/design refs readiness 和 admission status，不信任编写方自报布尔值；当前 CU 所需切片/契约已冻结或有受控 fake，远期项可带 owner/needed-by，unknown 不得被 authority/not_applicable 洗掉。

## 4. Reconciliation and evolution decisions

- [x] 4.1 实现蓝图 revision、decision fingerprint 和 P1 自身派生结论 provenance；新事实/冲突/裁决只更新蓝图认知与后续工作，不修改已完成 events/receipt/evidence。
- [x] 4.2 实现 P1 自身派生结论的 stale→按新 revision 重算流程；覆盖 operation/DTO 版本变化、view applicability 变化和 direct implementation↔seam 决策翻转；不得创建、修改或移除 P2 ready set/P3 closure。
- [x] 4.3 增加“旧结论残留”反例 fixture：决策翻转后旧 P1 PASS、mapping、graph、flow completeness 或质询/准入投影不得作为当前 P1 结果，历史结论保留 provenance 并指向 superseding revision；另验证 P2/P3 只因 `component_blueprint_ref` revision/source_fingerprint/artifact_sha256 mismatch 在各自权威内重新派生。
- [x] 4.4 实现实质候选变化轴的决策卡：记录变化证据、影响、稳定契约、Provider/Consumer、绑定时机、owner、失败语义、测试与人类裁决；无门槛候选在入卡前驳回。
- [x] 4.5 验证宿主演进接缝只作为蓝图内容，不进入 Maison provider 注册面、plan 治理依赖或 Change Unit 施工依赖；首次纵切落地留给 P2。

## 5. Fixtures and integration surfaces

- [x] 5.1 建立正常 fixture：从 App 需求与当前事实生成 canonical YAML，带真实可读取的权威契约/mapping 文件，包含根 `component_id`、实质适用 4+1、至少一条非空 runtime flow、逐 scope 质询、决策/缺口和稳定 blueprint/view/node/relation/flow/decision/contract 引用；再完整生成供 SE/开发/测试共同评审的 Markdown derived projection。
- [x] 5.2 建立失败 fixture 集：path/YAML/ref component identity 不一致、hash 匹配但 canonical 结构非法、适用视图空壳、跨视图悬空地址、design basis/view decision 悬空、source fingerprint 自报不一致、权威 source file/fragment 不存在或 DTO 不匹配、scenario 无 owner、runtime 无 logical contract、模块无设计依据、deployment 伪不适用、operation/DTO/mapping 冲突、契约在而字段编造、逐字段同形 diff 误杀派生字段、provenance 缺失和语义冲突。
- [x] 5.3 建立 runtime 断链 fixture 集：flow 必需依据为空、局部 id 重复/引用悬空、无首次加载、mutation publication 无 consumer、孤立 publication/consumer、晚订阅无快照、后台无持久化/恢复、订阅无清理、状态 owner 冲突，并以正例验证只读/首次加载流无需伪造 mutation/publication/subscription。
- [x] 5.4 建立质询/准入/provider fixture 集：单问题自报全覆盖、仅适用 view 强制质询、准入布尔自报、schema/artifact/source blocker 不得假 PASS、编写方自证、质询 provider 缺失、required/optional provider 缺失、重复 provider、非法 `conditional`、权威规则篡改、重复 frontier 超预算、unknown 被错误洗成已裁决和远期 open decision 延期；验证四个静态 provider 的权威归属、source ref/provenance、替换、退出和冲突行为。
- [x] 5.5 将蓝图稳定地址与 `component_blueprint_ref`/`design_refs` 的消费约束以 provider-neutral 方式暴露给后续 P2；下游发现 revision/source_fingerprint/artifact_sha256 mismatch 时自行重新派生，P1 不写入 ready set、closure 或执行调度状态。

## 6. Verification and release gates

- [x] 6.1 为新增 schema、解析器、关系 checker、runtime flow、质询、调和和图生成器编写受影响范围的单元/fixture 测试，并注册到既有测试入口，防止未注册套件造成假绿。
- [x] 6.2 若实现触及 runtime SSOT、harness 或 phase rules，运行 `cd harness && npm test` 并确认所有受影响 gate 通过。
- [x] 6.3 运行 `npm run openspec:validate`（等价 `openspec validate --all --strict`），确认 change 与归档 spec 的 requirement/scenario/依赖契约通过。
- [x] 6.4 P1 阶段只运行 `node scripts/check-plan-version.mjs`，确认新增 P1 plan 的完整父目标声明和当前窗口语义通过。
- [x] 6.5 增加并运行 P1 专项 fixture，验证 release 语义（当前窗口、未完成 P1 todo 和由 m5/MG 委托的整仓门禁披露）；该 fixture 不替代整仓 `--release` 检查。
- [ ] 6.6 整仓 `node scripts/check-plan-version.mjs --release` 与 `npm run release:verify` 继续由总计划 m5/MG 在批次收尾承担；P1 不执行、不勾选、不宣称这些门禁通过。
- [x] 6.7 若实现实际改变消费者可见蓝图输入或发布件契约，先补充兼容/迁移设计并更新 `MIGRATION.md`；若没有破坏性变化，保留“不需要迁移”的验证记录。

> 迁移评估（2026-08-19）：本 change 新增可选的蓝图 artifact、checker 与 Skill，不改变既有消费者输入、既有 phase 行为或已有 artifact schema；无需更新 `MIGRATION.md`。
