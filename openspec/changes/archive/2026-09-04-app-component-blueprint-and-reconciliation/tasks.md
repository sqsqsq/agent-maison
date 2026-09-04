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
- [x] 6.6 整仓 `node scripts/check-plan-version.mjs --release` 与 `npm run release:verify` 继续由总计划 m5/MG 在批次收尾承担；P1 不执行、不勾选、不宣称这些门禁通过。
- [x] 6.7 若实现实际改变消费者可见蓝图输入或发布件契约，先补充兼容/迁移设计并更新 `MIGRATION.md`；若没有破坏性变化，保留“不需要迁移”的验证记录。

> 迁移评估（2026-08-19）：本 change 新增可选的蓝图 artifact、checker 与 Skill，不改变既有消费者输入、既有 phase 行为或已有 artifact schema；无需更新 `MIGRATION.md`。
>
> 迁移评估补充（2026-08-22，M5A t4 codex 二轮）：`deriveDefaultPatternsFromFeaturesDir`
> 使未显式配置 receipt/reports pattern 的宿主默认模式跟随 `paths.features_dir`——自定义
> features_dir 且磁盘上无显式 pattern 的宿主，receipt/report 落点会从字面
> `doc/features/...` 搬至 `<features_dir>/...`（边界按“磁盘上是否有显式 pattern”判定：
> 缺失则 normalize 与 BACKFILL 均派生；
> 显式 pattern 原样保留、默认 features_dir 宿主不变）。已更新 `MIGRATION.md` §3.1.0。

## 7. M5A 演进工作区与蓝图身份纠偏（2026-08-21 追加，plan e2a7c4b9）

> 1.6 的 `blueprint/component/<component-id>/` 路径与 `component-id` 路径键表述已由本节 superseded；1.6 作为实施历史保留不改写。该根路径从未发布、无真实存量，硬切不做兼容层、双读或迁移器。

- [x] 7.1 canonical path 改为 `<features_dir>/<blueprint_id>/blueprint/component-blueprint.yaml`（`paths.features_dir` 默认 `doc/features`，经既有配置解析）；`component-blueprint-path.ts` 的 `componentBlueprintPath`/`loadCanonicalBlueprint`/`resolveComponentBlueprintRef` 改以 `blueprint_id` 定位，并核对 path 段/YAML 根/ref 三处 `blueprint_id` 一致与 YAML/ref `component_id` 一致；删除旧根路径拼接，不读取、不回退、不扫描。
- [x] 7.2 `harness/schemas/app-component-blueprint.schema.json` 只对蓝图根 `blueprint_id` 与 `component_blueprint_ref.blueprint_id` 收紧为安全路径段 pattern（`^[A-Za-z0-9][A-Za-z0-9._-]*$`）；其它 `stableId` 字符集保持不变。
- [x] 7.3 `check-component-blueprint` CLI、`skills/project/app-component-blueprint/SKILL.md`、Provider candidate 写入与内部调用签名改为 `--blueprint <blueprint_id>` 寻址，`component_id` 只作核验输出；评审投影 `component-blueprint.review.md` 与 closure 投影同处工作区 `blueprint/` 目录，`derived_from` 同步。
- [x] 7.4 fixture 树从 `blueprint/component/<component-id>/` 迁移到 `<features_dir>/<blueprint_id>/blueprint/`，测试路径常量与 CLI 参数同步；新增正反用例：同一 `component_id` 双 `blueprint_id` 工作区共存互不覆盖、`blueprint_id` 含 `:`/分隔符被拒、旧根路径存在而工作区缺失时报 missing 不回退、自定义 `paths.features_dir` 下完整解析。
- [x] 7.5 运行 `cd harness && npm test`、`npm run openspec:validate`、`node scripts/check-plan-version.mjs`（default 档）并记录；本节不触碰 6.6，不改 `tests/fixtures/component-blueprint/release-semantics.json`，release 门仍由总计划 m5 在 M0+M6+MG 回归齐备后收口。

## 8. M7 正式需求统一入口纠偏（2026-08-29 追加，plan f9e2c7b4）

> 蓝图从"复杂多 CU 才启用的可选路线"重定位为"正式需求必经的部件内设计阶段"。3.1.0 未发布，
> `@1` 原位纠正，不建兼容层、不设档位、不加升级状态机。本节不触碰 6.6，不改
> `tests/fixtures/component-blueprint/release-semantics.json`。

- [x] 8.1 `applicability` 保持二值；新增正交字段 `evolution_impact: changed|verified_unchanged`（仅 applicable 视图携带）与 `unchanged_evidence`（`evidence_refs` + `current_state_ref`），落 `harness/schemas/app-component-blueprint.schema.json`。
- [x] 8.2 `blueprint-views.ts` 显式接线：applicable 视图必须裁决 `evolution_impact`；not_applicable 视图不得携带；`changed` 保持全量义务；`verified_unchanged` 免除 target/delta 与节点义务但必须带事实依据，且视图内节点声明 delta 即 `blueprint_view_unchanged_masks_change`；完整性不变量"至少一个 applicable+changed 视图"fail-closed。节点变化判据提取为共享 `nodeDeclaresChange`，P1/P3 共用。
- [x] 8.3 `blueprint-questioning.ts` 显式接线：全部 applicable 视图进入必答 scope（不再按字面 `applicability` 跳过），`changed` 视图另含其 runtime flow；`verified_unchanged` 视图的质询义务=核实不变声明与依据，只接受 `answered_with_evidence`。
- [x] 8.4 `runtime-data-flow-check.ts` 显式接线：六类 flow 触发条件仅对 `runtime` = `changed` 评估。
- [x] 8.5 `component-closure-obligations.ts` 与 `component-closure-runtime.ts` 显式接线：applicable 视图全部产生视图事实义务；只有 `changed` 视图的节点可能派生施工义务；runtime 流义务与传播核对仅对 `runtime` = `changed` 派生。
- [x] 8.6 `blueprint-review-projection.ts` 输出 `Evolution impact` 与 `Unchanged evidence`，使 publication 投影可区分"本次改了"与"本次核实未变"。
- [x] 8.7 分层定义：合法 `component-blueprint@1` 不含 CU 数量（`admitted blueprint + 0 CU` 合法）；"完整 `/component-design` 交付"=admitted + 1..N canonical CU + `design_refs` + readiness，由编排层验收。
- [x] 8.8 三张 Story 类宿主接缝 Seam Card（`requirement-source-materialization` / `blueprint-review-publication` / `blueprint-review-feedback`）落本 capability spec；方向与 owner 独立，publication 与 feedback 不合卡。
- [x] 8.9 发布态机器契约 SSOT 与验证入口：新增 `harness/schemas/requirement-source-materialization.schema.json` 与 `harness/schemas/blueprint-review-feedback.schema.json`；publication **复用**既有 blueprint schema + `blueprint-review-projection.ts` renderer，不新建平行 schema；三者校验经 `harness/scripts/utils/blueprint-host-seams.ts` 挂到既有 `check:component-blueprint` CLI 的 `--materialization` / `--projection` / `--feedback` 模式，不新增顶层 CLI；来源解析复用既有 `resolveCurrentScopeSource`，不造 resolver 副本。
- [x] 8.10 App-only 诚实声明：缺 design lens 的 component type 返回 unsupported/missing design lens 明确失败，不强套 App 4+1；不借本 change 建设其它 profile 的 lens。
- [x] 8.11 正反 fixture：`evolution_impact` 缺失/越界、零 changed 视图、`verified_unchanged` 缺证据、不变声明掩盖变化、不变声明未被质询核实；`verified_unchanged` 合法正例 + runtime `verified_unchanged` 跳过触发裁决（含 `changed` 对照，防恒真断言）。
- [x] 8.12 三条接缝的随包有效/无效样例落发布件包含路径 `docs/operations/`（不放被排除的 `harness/tests/**`），并由仓内单测经**同一正式 checker** 验证正例通过、反例失败。

## 9. 设计用户入口收敛（总计划 §6.8）

> 本节 supersede 1.5 的 P1 独立 Skill 登记要求；既有完成历史保留，6.6 发布门不变。

- [x] 9.1 同步 P1 入口行为及 instance-extension-management 知识路由 delta；迁移 P1 为 reference 工作流，撤下旧 command/index/bridge 并同步有效引用。
- [x] 9.2 component-design 按请求与已有产物继续，保留只读/重入 revision、草稿、0 CU 首次交接、已有 CU 复用及局部完成边界；保留 e4/b9 与三条宿主接缝。
- [x] 9.3 复用 UPDATE 备份清理声明，验证全部已物化 adapter（含 Cursor 两种产物与 generic 自定义 bundle）旧入口移除且统一入口/用户内容保留；同步安装/UPDATE 和消费者文档。
- [x] 9.4 运行既有入口、UPDATE、交接测试及 harness 全量、OpenSpec strict、plan default 校验，报告实际范围与未完成事项供独立 review；不勾选发布门禁。

### §9 实施与验证记录（2026-09-04）

- 入口收敛：内置 Skill 18→17；旧 P1 移入 reference，三宿主 command 与共享 bridge 撤下。UPDATE 沿既有名单及 Cursor deprecated_artifacts 先备份再移除；临时消费者验证覆盖 Cursor 两种产物、Claude、Codeagent 与 generic 自定义 `.codex` bundle，保留统一入口和无关用户内容。
- 流程走查：新建完整交接、草稿继续设计/质询、只读检查不写 canonical、无新事实重入不升 revision、admitted+0 CU 首次交接、已有 CU 复用均沿既有 P1/P2 helper；局部完成不冒充完整交接，不进入施工/P3。e4/b9 段落与三条接缝保留，有效 OpenSpec 引用同步；已归档 d8 的知识路由通过本 change 的 delta 同步，未修改 archive 历史。
- `cd harness && npm test`：typecheck 通过；全量 unit 为 4200 passed / 2 failed，失败仅为本次 Skill 超 150 行预算与 Codeagent 旧 command 计数。消除重复说明后 Skill 为 149 行，计数同步为 18；随后 `test:unit -- --filter docs-authoring-lint` 18/18、`--filter codeagent-adapter` 11/11、`--filter component-design-handoff` 10/10 通过。依仓库窄返修规则复用其余全量结果，未重复执行整批单测，未宣称单次 `npm test` 零退出。
- 补跑 `cd harness && npm run test:fixtures`：日志完整收尾，46 passed / 0 failed。原目标套件 resolve-skill-path 4/4、init-task-executor 25/25、component-blueprint 96/96；全量中的 component-assets 38/38、conventions 35/35 通过。OpenSpec strict + enforcement paths、plan default、相关 diff/LF 检查通过。
- 范围无偏离；未新增隐藏注册、模式、状态机或第二流程，未改宿主工程，未推进 m5/发版。总计划 design-entry-convergence 保持 in_progress，等待独立 review 与提交后再完成；P1 6.6、P2/P3 发布门及 release-semantics 未改。

### §9 独立 review 返修（2026-09-04）

- 修复唯一 P2：首轮遗漏原生 codex/chrys/opencode 的 UPDATE 清理，generic 自定义 `.codex` 不能证明 codex adapter 分支。三个 adapter 分别以既有 `deprecated_artifacts` 声明 `skills/app-component-blueprint/`、`skills/app-component-blueprint/`、`skill/app-component-blueprint/`；不改清理解析器、不新增机制。迁移说明、init 提示及本 change 的规格/设计引用同步。
- 扩展同一 UPDATE 用例为独立消费者场景：补声明前精确复现 3 项失败；补声明后 init-task-executor 28/28 通过，验证旧目录整体移除、备份字节可恢复、统一入口/用户内容保留、未执行清理时旧入口保留及重物化不再暴露旧入口。
- typecheck、OpenSpec strict 37/37 + enforcement paths、plan default、diff 检查通过。其余实现未变，复用前轮有效全量/fixtures 结果，不重跑整批；等待独立复核与提交，总计划状态及发布门禁不变。

- 独立复核收口：用户确认无其他意见，准许提交本轮实现与返修；无需进一步扩面，发布门禁仍由 m5 承担。
