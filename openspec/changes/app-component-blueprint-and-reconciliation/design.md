## Context

P0 已归档 `complex-capability-meta-model`，冻结了三类对象的身份边界、当前态/目标态/运行事实/证据的权威位置、`unknown` 与 disposition 的失败语义，以及稳定内核与 provider 的接缝。3.1.0 总计划 §6.2 在此基础上要求 P1 为一个 App 部件建立可供 SE、开发、测试共同评审的部件演进蓝图，并在 P2 之前把设计消费边界锁定。

当前仓库已有 `spec/plan/contracts/events`、代码/schema/接口/测试、`architecture/catalog/code-graph/conventions` 与组件资产等事实或知识资产，但没有一个承载本次部件目标态和共同设计决策的对象。P1 只定义这个对象及其发现、质询、完整性和调和协议；本 change 实现 framework/harness 的 P1 生产能力，但不修改宿主 App 业务运行时、不创建新的恢复状态权威。

Stakeholder 分工如下：Agent 负责仓内事实调查和证据包；App design lens 负责把事实投影到适用视图；独立质询 provider 负责反证与根问题检查；SE/有权 owner 负责产品语义、外部契约、风险接受和不可逆取舍；开发和测试消费同一蓝图并验证其可施工性。P1 的结果由 P2 以 `design_refs` 消费，由 P3 进行组合覆盖证明。

## Goals / Non-Goals

**Goals:**

- 定义 provider-neutral 的发现输出与 App 部件蓝图最小协议，区分可复用的 `viewpoint contract` 与某次蓝图的 `view instance`。
- 以稳定的 `logical`、`runtime`、`development`、条件式 `deployment`、`scenarios` 视图承载同一蓝图的观察面，不形成五份独立真源。
- 让每个关键节点、关系、契约映射和运行时数据流都能回到事实/需求/权威输入、验证义务和责任 owner；证据不足保留为 `unknown`，不由模型常识补齐。
- 固化跨视图一致性、App 透镜必答题、权威外部契约的 operation/DTO/mapping/provenance 校验，以及运行时数据流的双向追踪和生命周期矩阵。
- 通过隔离的证据驱动质询发现视图内和跨视图静默假设，并将结论按 `answered_with_evidence`、`decided_with_authority`、`open_decision`、`blocker` 或 `not_applicable` 归位。
- 定义蓝图调和与决策翻转语义：新事实更新蓝图修订和后续工作，受影响的派生结论必须失效并重算；历史证据保留但旧结论不得残留为当前准入依据。
- 明确图是生成时的派生表达：生成图时检查可解析性和引用可落地性，图不替代蓝图对象、证据、mapping 或完整性门。
- 保持 Maison 自身静态内置 provider 边界；App lens、事实输入、SE 输入和独立质询都消费稳定协议，不引入动态插件加载、注册表或运行时 provider 状态。

**Non-Goals:**

- 本 change 实现 P1 framework 的发现协议、App lens、质询/准入、蓝图 checker、resolver 与按需图生成器；不修改宿主 App 业务运行时代码，也不把 fixture 结果宣称为真实宿主语义验证。
- 不实现 Change Unit、`requires/provides`、ready set、Goal Mode 连续推进或 Component closure；这些属于 P2/P3。
- 不重新裁决能力架构、云侧或其它部件的外部契约；缺失契约只输出消费需求、推荐和带 owner 的 disposition。
- 不把蓝图、`architecture/catalog/code-graph/conventions/spec/contracts/events` 合并为万能 schema，不建立新的手工完成台账、跨单元状态或恢复权威。
- 不要求每个项目生成图，不把 Mermaid/其它图格式变成强制产物；不以“图能解析”证明内容完整。
- 不改变当前消费者实例的输入格式、phase 行为、发布件或 `MIGRATION.md`；未来若发布蓝图格式导致消费者可见变更，须另开兼容与迁移评估。

## Decisions

### 1. 稳定协议与同源蓝图，而不是五份视图文档

蓝图采用一个 canonical YAML 正式产物，根对象必填 `component_id`、`blueprint_id`、`revision`、`source_fingerprint` 和 `provenance`，并在同一文件内含 `review_summary`、`design_views`、`decisions_and_gaps` 三组同源内容；五个视图只是同一对象的 `view instance`。`viewpoint contract` 只定义某类部件必须回答的问题和字段，`view instance` 才绑定某个蓝图、适用性、当前态、目标态和 delta。

每个节点、关系、流和决策使用稳定寻址：`view_id` + `node_id`（以及适用时 `relation_id`/`flow_id`/`decision_id`），跨修订保持语义身份；语义替换产生新 id 并留下 `supersedes`。节点、关系和决策必须包含 source/provenance、证据或合法 unknown、责任 owner、验证引用和当前/目标语义，不能只依靠标题或绘图标签。这样 P2 可引用真实设计切片而不复制蓝图正文，P3 可从同一地址做覆盖检查。

备选方案是五份独立 Markdown 或一张万能图 schema；前者会形成平行真源，后者会混淆观察、执行和证据边界，均违反 P0 与总纲 §4；3.1.0 窗口只保留协议和静态内置实现，不引入通用 graph database。

### 1.1 正式产物存放、解析与评审投影

机器可校验的蓝图 SSOT 定位为 blueprint/component 归属的唯一 canonical artifact：
`<project_root>/blueprint/component/<component-id>/component-blueprint.yaml`。`component-id` 是组件身份的路径
键，不从 feature 名称、feature 目录或 feature artifact 推导。实施时只复用既有 YAML 解析、schema 校验和 SHA-256
文件 hash 能力；增加一个最小的 `component-id`→canonical path 解析器，不新增全局 registry、独立索引、动态
注册系统或第二 loader。解析器必须拒绝空值、路径分隔符和 `..`，调用方不得传入任意 path；不存在旧路径时不做
legacy fallback，也不扫描 feature 目录。

`component_blueprint_ref` 是结构化引用，不把文件路径当作稳定身份：

```yaml
component_blueprint_ref:
  artifact: component-blueprint@1
  component_id: <component-id>
  blueprint_id: <stable-blueprint-id>
  revision: <positive-integer>
  source_fingerprint: sha256:<hex>
  artifact_sha256: sha256:<hex>
  target:
    kind: blueprint | view | node | relation | flow | decision | contract
    id: <stable-target-id>
    view_id: <required-for-node-flow; optional-association-otherwise>
```

解析顺序固定为：校验 ref 形状 → 由 `component_id` 解析唯一 canonical path → 读取 canonical YAML 原始字节并用
现有 SHA-256 能力计算 `artifact_sha256` → 按既有 schema/YAML loader 解析 → 校验 path 中 component-id、YAML 根
`component_id`、ref `component_id` 三者完全一致 → 精确匹配 `blueprint_id`、`revision`、`source_fingerprint`、
`artifact_sha256` → 运行 canonical schema 与完整性 checker → 解析 target。`target.kind=blueprint` 时 id 必须等于 `blueprint_id`；`view` 时 id 就是稳定 view id；只有
`node`/`flow` 必须携带 `view_id` 并在该 view 下存在；`relation` 在蓝图关系集合中稳定寻址；`decision` 与 `contract`
是顶层稳定对象，分别按 decision id 与 `contract_id` 寻址，`view_id` 仅作可选关联且存在时必须可解析。解析不接受
第二路径，不回退、不扫描旧目录，因此每个稳定引用都能确定性定位到 blueprint 以及
view/node/relation/flow/decision/contract 等真实设计切片。

canonical YAML 内含 `review_summary`、`design_views`、`decisions_and_gaps`；团队进入评审前生成的 Markdown/HTML
只是这些 YAML 内容的 derived projection，必须携带 `derived_from`（artifact、component_id、blueprint_id、revision、
source_fingerprint、artifact_sha256），不得被 resolver 当作输入或反向覆盖 YAML。评审视图可改善人读布局，但不能
覆盖 YAML 中的节点、关系、决策、契约 mapping、provenance 或准入结论，并必须投影当前态/目标态/delta、runtime flow、
契约 mapping、跨视图关系、逐 scope 质询与派生准入，供 SE、开发和测试共同评审。

### 2. 适配 4+1 的适用性是证据化裁决

`logical`、`development`、`scenarios` 总是必需；可执行 App 的 `runtime` 必需；`deployment` 根据平台、进程、持久化、外部系统和运行拓扑条件裁决。`deployment` 只有在有证据支持 `not_applicable` 时才能省略，不能以“单部件”或“只有一个运行环境”为理由跳过。

每个适用 view instance 至少承载关注者/用途、当前态证据、目标态、演进 delta、决定/缺口、验证义务和跨视图引用。无价值的图不生成，但不影响结构化 view instance 的完整性要求。

### 3. 发现与权威输入采用 provenance-first 规则

发现内核统一记录 `source_kind`、`source_ref`、`source_revision`/hash（可得时）、`observed_at`、证据强度、抽取方式和冲突集合。代码、schema、接口、配置、测试等当前事实优先于文档宣称；SE/权威契约输入优先于模型推断；`architecture/catalog/conventions` 是稳定知识输入而不是本次目标态真源。

同一语义出现冲突时报告双方和责任 owner，不能按输入顺序 last-write-wins。没有足够证据的字段原样标 `unknown`。根 `source_fingerprint` 与 discovery `source_fingerprint` 必须由规范化 discovery facts 及其 provenance 确定性重算并一致，不能接受编写方自报。质询中 Agent 能从仓内查证的事实必须自行查证；只有真实权责问题才打包给 SE/owner 裁决。

### 4. 外部契约使用显式 operation/DTO/mapping/provenance 链

蓝图中的外部契约消费项拆为可检查的链：`operation`（名称/方向/版本或稳定标识）→ request/response `DTO`（字段、类型、必填/可空和语义）→ wire-to-domain/UI `mapping`（来源字段、目标字段、转换/默认/丢弃规则）→ error/idempotency/NFR 与 owner。每一段都带可复核 source ref 和 verification refs；外部权威字段与显式转换/派生边必须额外绑定 provenance，内部派生字段不得编造外部权威来源。只给出 endpoint 或接口标题不算契约闭合。

若已有 SE/权威契约，P1 必须从项目根安全解析各段 `source_ref` 的文件和 JSON Pointer，读取 Swagger/IDL/YAML/JSON 权威切片并与蓝图 operation、DTO 字段、mapping、错误/幂等/NFR 逐段真实比对；路径越界、文件/fragment 不存在或语义不一致均 fail-closed。若缺失，输出消费方需要的 operation/DTO/mapping 需求和解除条件，并标记为提案/`open_decision`/`blocker`，绝不生成“已批准”的 request/response。映射字段、方向、版本或错误语义不一致时完整性门失败。

契约校验禁止把 wire DTO 与领域/聚合/持久化模型做逐字段同形 diff；字段名/类型相同不等于 mapping 完成，像 `parent_level_id` 这样的合法派生字段不能因不在 wire DTO 中而被误判为缺失。派生字段必须有显式 derivation/mapping 边；provenance 只强制绑定外部权威字段与显式转换/派生边，不为内部派生字段编造外部权威来源。备选方案是只校验 operation 名称、允许从 DTO 名称推断 mapping 或强制同形 diff；这些做法会分别掩盖字段缺口、误杀合法领域投影并造成语义漂移，因此拒绝。

### 5. 跨视图关系是结构化引用，图只是派生输出

关键关系至少表达 `from`、`to`、关系类型、适用门槛、来源、证据和验证引用。场景步骤必须能追到真实存在且类型匹配的 logical 元素、runtime 交互、development owner，及适用时 deployment 节点；runtime 边必须解析到真实 logical 契约和 implementation owner；模块和运行节点的 `design_basis_refs`、各 view 的 `decisions_and_gaps` 也必须逐项解析到同一 canonical YAML 的稳定对象。术语、契约、状态 owner 与失败语义必须一致。只写非空字符串但地址不存在不能通过。

如果用户或评审请求 Mermaid/其它图，生成器先由完整对象集合派生图，再只在这次生成过程中检查图的语法可解析性、节点寻址和边引用。图不存在不构成失败豁免，图可解析也不构成完整性通过；完整性门永远直接检查对象、证据、mapping、provenance、disposition 和跨视图关系。跨对象时序、异步回调或恢复顺序是主要关注点时，可生成 sequence/timing 图；否则不预设图型，也不强制生成图。既有或手写图不反向成为 SSOT，也不通过单独解析手写图代替对象校验。

### 6. 运行时数据流采用闭环最小形状和双向追踪

当满足以下任一条件时，runtime view 必须产生 `runtime_data_flow`：持久化或远端数据会被 UI 展示；同一数据被多个页面、组件或聚合 projection 消费；存在后台、系统、外部或定时写入；冷启动、恢复前台、页面挂载或账号切换时需要加载、刷新或调和；一处用户修改需要刷新其它消费者；存在缓存、云同步、数据新鲜度、一致性或进程重建要求。六项全部不满足时，只有数据闭环子模型可以在有证据和重新触发条件的前提下标 `not_applicable`，可执行 App 的 runtime view 仍须覆盖其它运行交互。

每条流拥有稳定 `flow_id`，并至少表达 `data_domain_refs`、`external_contract_refs`、`source_of_truth.authority/persistence/projections_and_caches/reconciliation`、`triggers.kind/timing/idempotency`、`initial_load.initial_load_id/strategy/owner/data_scope/freshness`、`state_owner.ref/states`、`mutations`、`publications`、`subscriptions`（含 replay/snapshot、顺序/并发、attach/detach/cleanup）、`consumers`、`failure_recovery.recovery_id`、`decisions_and_gaps`、`provenance` 和 `verification refs`。trigger、evidence、verification 等流级依据不得以空数组占位；`mutations`、`publications`、`subscriptions`、`consumers` 必须存在为数组，但条目义务由实际触发和行为派生，只读/首次加载流不得伪造 mutation 或 subscription。flow 内部 ID 必须唯一；一旦声明 mutation、publication、subscription 或 consumer，mutation→publication/recovery→受影响 consumer、subscription→consumer、consumer→initial-load/适用时 update 等引用必须解析到真实局部对象，孤立 publication/consumer 必须失败。

构建时执行三种相互独立的检查：从 consumer 反向追到首次加载和更新来源；从 producer 正向追到幂等、写入、传播、派生重算和所有受影响 consumer；按 cold start、warm resume、page attach/detach、account switch、process recreation、background write 生命周期矩阵交叉检查。消费者无来源、写入无传播、晚订阅无快照、后台无持久化/恢复、订阅无清理、缺 freshness/reconciliation 或 owner 冲突的边都进入 frontier，不能用“状态管理会自动刷新”通过。

### 7. 独立质询与分层准入分开责任

蓝图编写者把草稿和证据包交给独立 subagent 或等价隔离上下文的质询 provider。质询必须按 canonical YAML 中每个 `applicability=applicable` 的 view、每条跨视图 relation、每条 runtime flow 和十个 App lens 强制根问题生成唯一 scope 覆盖；证据化 `not_applicable` 的 view 不进入强制 view scope。每项记录问题、证据回答、责任 owner、disposition、frontier 指纹和 verification refs。编写者不得在同一上下文自证通过；质询 provider 缺失、scope 缺失/重复不得静默跳过。

准入分三层：送共同评审前，强制根问题必须有合法 disposition，待人裁决项必须成包；当前 CU 施工前，实际设计切片和关键外部输入必须冻结或形成可消费 fake；远期 CU 可保留有 owner/needed-by 的 `unknown + open_decision`，但部件完成前必须闭合或由有权者接受。`root_questions_complete`、`contracts_ready`、`design_refs_ready` 和准入 status 必须由实际 App lens/质询覆盖、契约 checker、地址/视图/runtime checker 以及此前 schema、artifact、source fingerprint 等全部准入前 BLOCKER 派生，不能相信编写方填写的布尔值或只消费局部 checker 集合。`unknown` 是内容级标记，不是第五类 disposition；当前门需要它时使用 `unknown + blocker`，不能用 `decided_with_authority` 或 `not_applicable` 洗掉未知。

### 8. 调和采用修订指纹和派生结论失效

新事实、证据冲突或权威裁决不会改写已完成的 Goal Mode 事实，而是生成新蓝图 `revision`，更新相关节点/决策/缺口和后续工作。所有派生结论（完整性结果、准入结果、契约 mapping 检查、运行时闭环报告、图输出）必须记录其输入 `revision` 与 `decision_fingerprint`。

当决策翻转（例如“保持直接实现”改为“建立接缝”、外部 DTO 版本或错误语义改变、deployment 从适用改为不适用）时，P1 只将自身的完整性、契约 mapping、runtime flow、图、质询/准入等派生结果标 `stale`，并按新 revision 重算；P1 MUST NOT 创建、修改或移除 P2 ready set 或 P3 closure 状态。下游只消费带 revision/source_fingerprint/artifact_sha256 的 `component_blueprint_ref`，发现任一不匹配时由各自的 ready/closure 权威自行重新派生；P1 不代替下游写状态。历史结论保留、指向 superseding revision，但不能继续作为当前 P1 结论依据。若 P1 无法重算，结果只能是 `unknown`/`open_decision`/`blocker`，不得沿用旧结论。

这直接覆盖“决策已翻转但旧 PASS、旧 mapping、旧 graph 或旧 P1 准入投影残留”的反例；不新增跨轮次 ledger 或第二恢复权威，修订和派生指纹只属于正式蓝图及其 P1 派生报告 provenance。

### 9. 变化轴与宿主演进接缝只登记实质候选

App lens 可根据可追溯变化证据提出候选变化轴；只有同时具有实质影响并触及边界、风险、测试、生命周期或后续成本的候选进入决策卡。卡片记录变化原因、已知变体、稳定契约、Provider/Consumer、绑定时机、状态/数据 owner、缺失/失败/重复语义、替换/故障验证与裁决。人裁决建立接缝或保持直接实现；后者必须给出再提取条件。无门槛候选在进入决策卡前驳回，不强造记录。

宿主演进接缝位于宿主代码内部，不进入 Maison provider 注册面或 P0 的三个依赖命名空间。P1 只形成决策卡，首次纵切落地和替换/降级验证留给 P2/P3。

### 10. Provider 与 profile/adapter 保持静态、可替换边界

P1 至少定义四个静态内置 provider 角色：当前事实发现、SE/人工契约输入、App design lens、独立设计质询；它们都消费稳定蓝图协议。provider id 必须唯一，requirement 只允许 `required|optional`，四张 Seam Card 的权威与来源规则按 capability spec 固定校验，不能由蓝图作者覆盖。权威与来源规则固定为：当前事实 provider 以代码/schema/接口/配置/测试等可复核仓内事实为权威，必须携带 `source_ref`、证据和可得的 source revision/hash；SE/人工契约 provider 以 SE/授权 owner 的 operation/DTO/mapping/error/NFR 输入为权威，必须携带契约 source ref、verification ref 和 provenance，禁止模型补造；App design lens 不是事实权威，只能以当前输入和 lens rule/version provenance 生成视图投影；独立质询 provider 也不是结论权威，只能以隔离读取的蓝图草稿、证据包和登记的外部输入形成带 evidence/source ref 的问题结果。`project_profile` 提供平台/项目事实和适用性线索，`design_lens` 负责部件特有问题，二者不互相冒充真源。e4 conventions 与 b9 组件资产有则消费、无则核心蓝图诚实降级；本 change 不扩写所有 profile，也不引入 Service 透镜。Skill 入口登记到既有 `skills/skills.index.yaml` 真源，不新增第二注册表。

实现必须能替换某个 provider 而不改变 P2 的蓝图消费协议；required provider 缺失形成 blocker，optional provider 缺失形成可见降级或 unknown。provider 不得修改 events/receipt/evidence 完成事实，也不新增动态加载、注册表或运行时插件状态。

## Risks / Trade-offs

- [规则过宽导致蓝图变成文档堆积] → 用稳定节点、结构化关系、operation/DTO/mapping/provenance、运行时流最小形状和强制根问题限定最小输出；不以章节数量或图数量作为完成指标。
- [证据采集成本高、质询轮次不收敛] → 每个 frontier 带指纹、owner、解除条件和预算；重复或耗尽时形成结构化 blocker，不引入常驻 daemon 或跨轮次状态中心。
- [把未知误判为“不适用”] → 统一 `unknown` + disposition 规则，并加入反例：`decided_with_authority`/`not_applicable` 不得覆盖缺证据内容。
- [权威外部契约无法访问] → 只生成消费需求/提案并保留 operation/DTO/mapping 缺口；当前 CU 依赖时阻塞，远期项可带 owner/needed-by 延期，不伪造冻结契约。
- [调和后旧结论造成假绿] → 所有派生结果绑定 revision/decision fingerprint；决策翻转先失效再重算，stale 结论不得进入当前准入集合，增加专项反例测试。
- [图形可解析制造假完整] → 生成图时才做语法可解析性检查，完整性门直接检查结构化对象和证据；图不强制、图不能反向写入蓝图。
- [引入第二套状态或 provider 系统] → 只扩展正式蓝图/报告的 provenance，不新增运行时账本、注册表或动态插件机制；完成事实继续归 Goal Mode events/receipt/evidence。
- [未来 profile 适配器被 P1 协议绑死] → 以 `viewpoint contract`/`view instance` 和 provider-neutral 字段隔离 profile，App lens 仅为静态首个适配器；后续 Service/其它平台另行验证。

## Migration Plan

本 change 为设计与规格起草，不部署、不迁移、不修改现有消费者。未发布的 P1 artifact 可通过删除当前 change 目录回滚，P0 归档产物和总计划的已有未提交修改不在回滚范围内。

后续实现应先在 fixture 中生成新蓝图协议，再接入 profile/lens 与 harness 门；只有确认已有消费者需要读取该协议并发生字段/行为不兼容时，才另开迁移 change，提供版本化读取、兼容窗口和 `MIGRATION.md`。本 P1 不宣称这些步骤已执行。

## Open Questions

- 首个真实宿主批次的数据域已经由总计划 §8.2 裁决为真实账目数据域；仍待确认的只是材料何时到位以及具体可访问的 operation/DTO/mapping、代码和运行时生命周期证据。材料到位前保持 fixture 级合同，不假造宿主事实。
- 图形输出的具体格式与渲染 provider 待 P1 实施时依据真实消费者选择；本设计只锁定“生成时可解析、图不是真源”的边界。
- revision/decision fingerprint 的具体编码和哈希算法待实现阶段复用仓库现有 fingerprint 工具；不得因此新增平行身份或恢复机制。
