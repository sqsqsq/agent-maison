# App Component Blueprint Specification

## Purpose

定义 P1 App 部件发现、适配 4+1 设计视图、证据驱动质询、分层准入、运行时数据流、权威外部契约校验与蓝图调和的 provider-neutral 行为契约。该 capability 只锁定蓝图协议和准入语义；Change Unit、连续推进与 Component closure 分别由 P2/P3 负责。

## ADDED Requirements

### Requirement: Discovery preserves authority and provenance

App 部件发现 MUST 为每个当前态断言、设计输入、冲突和 unknown 记录 `source_kind`、可解析的 `source_ref`、可得的版本或 hash、证据强度、观测时间/轮次、抽取方式和 provenance。代码、schema、接口、配置、测试等当前事实优先于文档宣称；SE 或其它有权 owner 提供的外部契约优先于模型推断。根与 discovery 的 `source_fingerprint` MUST 从规范化 discovery facts 及其 provenance 确定性重算并一致，不得接受编写方自报。证据不足的内容 MUST 原样保留为 `unknown`，发现器 MUST NOT 用常识补齐或静默选择冲突来源。

#### Scenario: Code fact conflicts with a document claim

- **WHEN** 文档声称某状态由模块 A 持有，但代码、schema 或测试事实显示模块 B 是实际 owner
- **THEN** 蓝图必须以可追溯代码事实为当前态依据，报告冲突双方和责任 owner，且不得把文档宣称写成已确认设计

#### Scenario: An external contract source is unavailable

- **WHEN** 蓝图需要云侧 operation 的 DTO 语义，但唯一权威来源不可访问
- **THEN** 相关字段保持 `unknown`，并形成带来源、owner 和解除条件的 `open_decision` 或 `blocker`，不得生成已批准的 request/response

> **Enforced by (P1 implementation):** `skills/project/app-component-blueprint/SKILL.md`, `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-provenance.ts`

### Requirement: Viewpoint contracts and App view instances are separate

蓝图 MUST 区分可复用的 `viewpoint contract` 与某次蓝图的 `view instance`。同一蓝图内的 view id MUST 稳定使用 `logical`、`runtime`、`development`、`deployment`、`scenarios`；`logical`、`development`、`scenarios` 必需，可执行 App 的 `runtime` 必需，`deployment` 必须按平台/进程/持久化/外部边界和运行拓扑条件裁决。每个适用 view instance MUST 记录非 `unknown` 的当前态、目标态和演进 delta，至少一个可寻址节点、关注者/用途、决定/缺口和验证义务；不得以字段存在、空数组或 `unknown` 占位冒充实质视图。五个 view MUST 是同一蓝图的观察面，不得生成五份独立真源。

#### Scenario: An executable App has the required views

- **WHEN** 为一个包含页面、持久化数据和后台恢复的 App 生成蓝图
- **THEN** 蓝图必须包含 `logical`、`runtime`、`development`、`scenarios`，并根据运行拓扑证据决定 `deployment` 是否适用；每个 view 都能区分当前态、目标态和 delta

#### Scenario: Deployment is not applicable with evidence

- **WHEN** 目标 App 的部署拓扑不构成本次部件边界，且输入证据足以支持不适用裁决
- **THEN** 蓝图必须保留 `deployment` 的适用性裁决、证据和 `not_applicable` disposition，不得仅因“单部件”省略该视图

> **Enforced by (P1 implementation):** `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-views.ts`

### Requirement: The blueprint has one structured source with stable addresses

蓝图 MUST 以一个正式 canonical YAML 产物承载评审摘要、设计视图、决策与缺口三组同源内容；根对象 MUST 包含 `component_id`、`blueprint_id`、`revision`、`source_fingerprint` 和整体 provenance。每个 view、节点、关系、决策、外部契约和运行时流 MUST 有稳定地址，外部契约 MUST 使用稳定 `contract_id`；跨修订保持同一语义身份，语义替换产生新地址并标注 `supersedes`。节点、关系、决策和契约 MUST 直接携带来源、证据或合法 unknown、责任 owner、验证引用及当前/目标语义，不能只依赖标题、图形标签或自然语言段落。

#### Scenario: P2 references a design slice without copying the blueprint

- **WHEN** 后续 Change Unit 需要消费运行时节点和关键场景
- **THEN** 它可以通过稳定 view/node/relation/flow/decision id 和 verification refs 定位蓝图切片，蓝图正文仍只有一个真源，不能要求生成 per-view 副本

#### Scenario: A semantic node is replaced

- **WHEN** 原有契约节点已被新版本替换而不是同一语义的文字修订
- **THEN** 新修订必须分配新稳定地址，保留旧节点的 provenance 和 `supersedes` 关系，旧地址不得继续作为当前目标节点

> **Enforced by (P1 implementation):** `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/utils/blueprint-addressing.ts`, `harness/scripts/check-component-blueprint.ts`

### Requirement: Formal blueprint artifact resolves through existing YAML schema and hash infrastructure

机器可校验的蓝图 SSOT MUST 使用 blueprint/component 归属的唯一 canonical 路径
`<project_root>/blueprint/component/<component-id>/component-blueprint.yaml`。`component-id` 是组件身份的路径键，
不得从 feature 名称、feature 目录或 feature artifact 推导。实现 MUST 复用既有 YAML 解析、schema 校验和 SHA-256
文件 hash 能力，只增加最小的 `component-id`→canonical path 解析；不得新增全局 registry、独立索引、动态注册系统
或第二 loader，调用方也不得传入任意 path。解析器 MUST 拒绝空值、路径分隔符和 `..`；不存在 legacy fallback，
也不得扫描 feature 目录。

canonical YAML 根对象 MUST 包含与路径组件身份一致的 `component_id`，并在同一文件内包含 `review_summary`、`design_views`、`decisions_and_gaps` 三组同源内容。`component_blueprint_ref`
MUST 至少包含 `artifact: component-blueprint@1`、`component_id`、`blueprint_id`、正整数 `revision`、
`source_fingerprint: sha256:<hex>`、`artifact_sha256: sha256:<hex>` 和
`target: { kind: blueprint|view|node|relation|flow|decision|contract, id, view_id? }`。`source_fingerprint` 是本 revision
所依据的规范化来源/权威输入集合的语义指纹；`artifact_sha256` 是 canonical YAML 原始字节的 SHA-256，二者 MUST
分开计算、分开比对，不能互相替代。path 中 `<component-id>`、canonical YAML 根 `component_id`、ref
`component_id` MUST 三者完全一致。`target.kind: blueprint` 的 id MUST 等于 `blueprint_id`；`view` 的 id MUST 是稳定
view id；只有 `node`/`flow` MUST 提供 `view_id` 并在该 view 下存在。`relation` MUST 在蓝图关系集合中稳定寻址并
校验其 from/to 稳定引用；`decision` 与 `contract` MUST 是顶层稳定对象，分别按 decision id 与稳定 `contract_id`
寻址，`view_id` 只允许作为可选关联且存在时 MUST 可解析。

解析顺序 MUST 固定为：校验 ref 形状 → 由 `component_id` 解析唯一 canonical path → 读取 canonical YAML 原始字节并
计算 `artifact_sha256` → 按既有 schema/YAML loader 解析 → 校验 path/YAML/ref 三处 component identity → 精确比对 blueprint、revision、
`source_fingerprint`、`artifact_sha256` → 执行 canonical schema/完整性门 → 解析 target。hash 匹配但结构非法的蓝图 MUST fail-closed。解析不接受第二路径、不回退、不扫描旧目录。进入团队评审前生成的
Markdown/HTML 是 canonical YAML 三组内容的 derived projection，必须携带 `derived_from`（artifact、component_id、
blueprint_id、revision、source_fingerprint、artifact_sha256），并完整投影视图 current/target/delta、runtime flow、契约 mapping、跨视图关系、质询与准入；它不能反向覆盖 SSOT 或成为解析输入。

#### Scenario: A stable ref resolves one blueprint slice

- **WHEN** 消费者提供包含 component、blueprint、revision、source/artifact fingerprints 和 `target.kind/id` 的
  `component_blueprint_ref`
- **THEN** resolver MUST 从 `component_id` 推导唯一 canonical path，读取同一正式 YAML，并精确定位到指定 blueprint、
  view、node、relation、flow、decision 或 contract；调用方不需要也不能提供第二个文件路径

#### Scenario: Component identity disagrees across path content and ref

- **WHEN** canonical path 的 `<component-id>`、YAML 根 `component_id`、`component_blueprint_ref.component_id` 任一不同
- **THEN** schema/resolver MUST fail-closed 并同时报告三处值，不得按其中任一继续解析 target

#### Scenario: A top-level contract is referenced without a view owner

- **WHEN** `target.kind=contract` 使用稳定 `contract_id` 且未提供 `view_id`
- **THEN** resolver MUST 在顶层契约集合中解析该 contract；不得因缺少 `view_id` 失败，若提供 `view_id` 则只校验其为可解析关联

#### Scenario: Artifact identity or file hash disagrees

- **WHEN** ref 的 component/blueprint/revision/source_fingerprint 与已解析蓝图不匹配，或 `artifact_sha256` 与 canonical
  YAML 原始字节不匹配
- **THEN** 解析 MUST fail-closed，报告 artifact、component、blueprint、revision、source/artifact fingerprint 和
  target 的具体冲突，不得静默换路径或把 source fingerprint 当作文件 hash

#### Scenario: A review projection cannot become the machine source

- **WHEN** 评审前生成的 Markdown/HTML 或质询投影携带旧 revision/source/artifact fingerprint，试图覆盖 canonical YAML
- **THEN** 系统 MUST 仅把它作为 derived projection 处理并拒绝回写；消费者重新从机器 SSOT 解析 ref，旧投影保持
  provenance 而不成为输入

#### Scenario: A hash-matching blueprint is structurally incomplete

- **WHEN** canonical YAML 的字节 hash 与 ref 一致，但 `design_views` 或其它必需完整性对象被删除
- **THEN** resolver MUST 在解析 target 前运行 canonical schema/完整性门并拒绝该产物，不得因 identity/hash 匹配返回 target

> **Enforced by (P1 implementation):** `harness/scripts/utils/component-blueprint-path.ts`, `harness/scripts/utils/component-blueprint-validator.ts`, `harness/scripts/utils/blueprint-review-projection.ts`, `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/check-component-blueprint.ts`

### Requirement: Cross-view relations are complete and consistent

蓝图的关键跨视图关系 MUST 结构化表达 `from`、`to`、关系类型、适用门槛、来源、证据和 verification refs，且每个地址 MUST 解析到当前 canonical YAML 中真实存在、类型匹配的稳定对象。每个关键 scenario 步骤 MUST 能追到 logical 元素、runtime 交互、development 实现 owner 以及适用时的 deployment 节点；每条 runtime 边 MUST 引用真实 logical 契约和 development owner；每个模块和运行节点的 `design_basis_refs`、每个 view 的 `decisions_and_gaps` MUST 逐项解析到同一 canonical YAML 的稳定 node/contract/decision/gap 对象。非空但悬空的地址 MUST fail-closed。术语、契约、状态 owner 和失败语义在适用视图间不一致时 MUST 失败，不能由图渲染或标题存在满足完整性。

#### Scenario: A scenario has no implementation owner

- **WHEN** scenario 描述了后台自动写入，但没有 development 模块 owner 或 runtime 交互
- **THEN** 跨视图完整性门必须 FAIL，并定位缺失的 scenario、view 和关系，不得将场景标为已覆盖

#### Scenario: A runtime edge has no logical contract

- **WHEN** runtime view 描述 Repository 到 UI 的传播边，但该边没有对应的 logical operation/state contract
- **THEN** 完整性门必须 FAIL 并指出缺失的 logical 引用，即使 Mermaid 图可以正常渲染

#### Scenario: A view or node cites a dangling design basis

- **WHEN** view 的 `decisions_and_gaps` 写入不存在的 `decision:not-real`，或模块节点的 `design_basis_refs` 写入不存在的 `view:logical/node:not-real`
- **THEN** 跨视图完整性门必须逐项解析并 FAIL，不得因引用字符串非空而通过

> **Enforced by (P1 implementation):** `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-cross-view.ts`

### Requirement: Authority contracts validate operation, DTO, mapping, and provenance

对每个蓝图消费的外部契约，P1 MUST 从项目根安全解析 operation、DTO 字段、mapping、error/idempotency/NFR 各段 `source_ref` 指向的 Swagger/IDL/YAML/JSON 文件及稳定 fragment，读取真实权威切片并校验一条可追溯链：`operation` 的稳定标识/方向/版本（或等价权威标识）、request/response `DTO` 的字段与语义、wire-to-domain/UI `mapping` 的来源字段/目标字段/转换或默认规则，以及错误语义、幂等性、NFR、owner、needed-by 和 provenance。来源路径越界、文件/fragment 不存在或蓝图内容与权威切片不一致 MUST fail-closed。校验 MUST NOT 把 wire DTO 与领域/聚合/持久化模型做逐字段同形 diff 或把字段名/类型相同当作 mapping 完成；派生字段（例如由 `parent_id` 计算出的 `parent_level_id`）必须通过显式 derivation/mapping 规则表达，避免误杀合法领域投影。provenance MUST 绑定外部权威字段和显式转换/派生边，不得为内部派生字段编造外部权威来源。operation、DTO、mapping 和 error/NFR 各段 MUST 有可复核 source ref 与 verification ref；只有 endpoint、接口标题或 DTO 名称不能视为闭合。任何字段方向、版本、必填性、转换、错误或幂等语义冲突 MUST fail-closed。缺失内容只能标为需求/提案并进入合法 disposition，不得冒充已冻结 request/response。

#### Scenario: Operation exists but DTO mapping is missing

- **WHEN** SE 契约给出 `createEntry` operation 和 request DTO，却没有说明 `amount`、`currency` 到领域模型的 mapping
- **THEN** 蓝图契约校验必须 FAIL 或形成当前门槛要求的 `blocker`，不得因 operation 名称存在而 PASS

#### Scenario: Mapping conflicts with the authoritative DTO

- **WHEN** 蓝图把权威 response DTO 的 nullable `category` 映射成必有值，或把错误码方向与契约相反
- **THEN** 校验必须报告 operation/DTO/mapping/provenance 的具体冲突，禁止静默采用蓝图推断

#### Scenario: A contract field is fabricated instead of derived explicitly

- **WHEN** 权威 DTO 只有 `parent_id`，但蓝图把不存在的 `parent_level_id` 当作 wire 字段，且没有显式 derivation/mapping 规则
- **THEN** 契约校验必须 FAIL；若 `parent_level_id` 是合法领域派生字段，则必须改为显式转换边并绑定该转换的 provenance，不能伪称为外部契约字段

#### Scenario: A declared DTO is not present in its authority source

- **WHEN** 蓝图声明 request DTO 来自 `contracts/ledger-api.yaml`，但文件不存在、fragment 不存在或该权威切片的字段语义与蓝图不同
- **THEN** 契约校验 MUST fail-closed 并定位 source ref/字段冲突，不能只检查蓝图内部自洽后 PASS

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-contracts.ts`, `harness/scripts/check-component-blueprint.ts`

### Requirement: Runtime data flows are closed in both directions

当满足以下任一条件时，runtime view MUST 生成带稳定 `flow_id` 的 `runtime_data_flow`：持久化或远端数据会被 UI 展示；同一数据被多个页面、组件或聚合 projection 消费；存在后台、系统、外部或定时写入；冷启动、恢复前台、页面挂载或账号切换时需要加载、刷新或调和；一处用户修改需要刷新其它消费者；存在缓存、云同步、数据新鲜度、一致性或进程重建要求。全部六项均不满足时，只允许数据闭环子模型带证据和重新触发条件标为 `not_applicable`，可执行 App 的 runtime 视图仍须覆盖其它运行交互。

每条流至少 MUST 表达以下完整语义形状：`data_domain_refs`、`external_contract_refs`、`source_of_truth`（含 `authority`、`persistence`、非空 `projections_and_caches`、`reconciliation`）、非空 `triggers`（每项含 `kind`、`timing`、`idempotency`）、`initial_load`（含稳定 `initial_load_id`、`strategy`、`owner`、`data_scope`、`freshness`）、`state_owner`（含 `ref`、非空 `states`）、数组形状的 `mutations`、`publications`、`subscriptions`、`consumers`、含稳定 `recovery_id` 的 `failure_recovery`、`decisions_and_gaps`、非空 `evidence_refs` 和 `verification_refs`。四类行为数组是否有条目 MUST 由实际 trigger 和已声明行为派生：只读/首次加载流不得为满足 schema 伪造 mutation、publication 或 subscription；一旦声明 mutation，必须解析到真实 publication/recovery，且该 publication 必须继续追到至少一个受影响 consumer；一旦声明 publication，必须有 consumer 更新引用；一旦声明 subscription，必须解析到 consumer 并具备 replay/snapshot、顺序/并发、attach/detach/cleanup；consumer 必须能反向追到首次加载，并在存在 publication/subscription 时追到更新来源。flow 局部 mutation/publication/subscription/consumer id MUST 唯一。构建完整性时 MUST 同时执行 consumer 反向追首次加载/适用时更新来源、producer 正向追传播/所有受影响 consumer、以及对 cold start、warm resume、page attach/detach、account switch、process recreation、background write 的生命周期矩阵交叉检查；孤立 publication/consumer、悬空引用或未闭合边 MUST 进入 frontier 并阻止当前层声称闭合。

#### Scenario: A consumer has no initial load source

- **WHEN** 首页首次渲染依赖账目列表，但 flow 只有 subscription 没有 initial load 或持久化来源
- **THEN** runtime flow checker 必须 FAIL 并定位 `flow_id` 的 initial-load 缺边，不得以“订阅会自动刷新”通过

#### Scenario: Background mutation has no persistence and recovery path

- **WHEN** 系统后台写入只通知内存 store，没有持久化、前台恢复或进程重建后的读取路径
- **THEN** 生命周期矩阵必须报告 mutation→persistence/recovery 的断链，并将该断链保留为 frontier

#### Scenario: Late subscription lacks replay or snapshot

- **WHEN** 页面在首次发布后才订阅数据流，且没有 replay/initial snapshot 语义
- **THEN** 流完整性门必须 FAIL，具体指出晚订阅 consumer、缺失 snapshot/replay 和责任 owner

#### Scenario: A read-only initial-load flow has no fabricated write chain

- **WHEN** flow 只在 cold start 从权威 source 执行首次加载，没有 mutation、publication 或 subscription
- **THEN** checker MUST 接受这些条件式空数组，并继续校验 trigger、initial load、consumer、freshness、恢复和证据，不得要求伪造写入链

#### Scenario: A mutation publication reaches no consumer

- **WHEN** mutation 指向一个真实 publication，但所有 consumer 仍引用其它 publication，或声明的 consumer 没有任何可解析来源
- **THEN** checker MUST 报告孤立 publication/consumer 及 mutation→consumer 断链，不得因局部引用各自存在而 PASS

> **Enforced by (P1 implementation):** `harness/schemas/runtime-data-flow.schema.json`, `harness/scripts/utils/runtime-data-flow-check.ts`, `harness/scripts/check-component-blueprint.ts`

### Requirement: Independent evidence-driven questioning is mandatory

蓝图送评审前 MUST 经过独立质询 provider；质询上下文必须与蓝图编写上下文隔离，输入包括蓝图草稿、结构化证据包和已登记外部输入。质询 MUST 从 canonical YAML 派生 required scope，并唯一覆盖每个 `applicability=applicable` 的 view、每条跨视图 relation、每条 runtime flow 和十个 App lens 强制根问题；证据化 `not_applicable` 的 view 不属于强制 view scope，不能用一个问题自报覆盖全部 scope。每个问题必须记录问题文本、证据回答、source/provenance、disposition、frontier fingerprint、owner 和 verification refs。质询过程报告只是过程证据，不是新的 SSOT；稳定事实、设计决策和外部契约结论 MUST 只回写蓝图及既有 ADR/契约真源。质询 provider 缺失、scope 缺失/重复、重复 frontier 超预算或无法产生可解释退出时 MUST 形成结构化 blocker，不能静默跳过或自证 PASS。

#### Scenario: The questioning provider is unavailable

- **WHEN** 蓝图编写完成但独立质询 provider 不可用
- **THEN** 蓝图不得进入可送评审状态，必须输出带责任方和解除条件的 blocker，且不伪造质询报告

#### Scenario: The writer answers a repository fact without checking evidence

- **WHEN** 质询指出某模块的状态 owner，编写上下文只给出自然语言断言而无代码/schema/test provenance
- **THEN** 该问题不能得到 `answered_with_evidence`，必须保持 unknown 并按门槛形成 open decision 或 blocker

> **Enforced by (P1 implementation):** `skills/project/app-component-blueprint/SKILL.md`, `harness/scripts/utils/blueprint-questioning.ts`, `harness/scripts/check-component-blueprint.ts`

### Requirement: Dispositions and layered admission preserve unknown

问题 disposition MUST 只使用 `answered_with_evidence`、`decided_with_authority`、`open_decision`、`blocker`、`not_applicable`。`unknown` 是内容级认知标记，不是第五类 disposition；证据不足的内容 MUST 原样保持 unknown，并根据门槛落为 `unknown + open_decision`（可延期）或 `unknown + blocker`（当前依赖）。`decided_with_authority` 和 `not_applicable` MUST NOT 覆盖未知事实。蓝图送共同评审前所有强制根问题 MUST 有合法 disposition；当前 Change Unit 施工前实际设计切片和关键外部输入 MUST 已裁决或形成可消费的受控 fake；远期单元可带 owner/needed-by 的 open decision。`root_questions_complete`、`contracts_ready`、`design_refs_ready` 与 admission status MUST 从实际质询/App lens 覆盖、契约/地址/视图/runtime checker，以及此前 schema、artifact、source fingerprint 等全部准入前 BLOCKER 派生；蓝图作者填写的布尔值或 `pass` 不能覆盖任何 checker blocker。

#### Scenario: A future decision is not needed by the current unit

- **WHEN** 远期 CU 的部署拓扑仍未知，但当前蓝图评审不依赖该拓扑且 owner/needed-by 已登记
- **THEN** 蓝图可以保留 `unknown + open_decision`，但必须显示 owner、needed-by 和解除条件

#### Scenario: The current unit depends on an unknown contract

- **WHEN** 当前 CU 的实现需要尚未裁决的 DTO mapping
- **THEN** 该条目必须是 `unknown + blocker`，设计可施工门拒绝放行；不得用 `not_applicable` 或 `decided_with_authority` 清除缺口

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-admission.ts`, `harness/scripts/check-component-blueprint.ts`

### Requirement: Graph validation is limited to generated graphs

图是蓝图结构化对象的派生表达，不是完整性、执行或恢复权威。只有在本轮确实生成 Mermaid 或其它图时，生成器才 MUST 检查该生成物可解析、节点地址可定位、边引用可落地；未请求/未生成图不应单独失败。无论图是否生成，完整性门 MUST 直接校验蓝图对象、view applicability、节点关系、证据、mapping、provenance、disposition 和 runtime flow。可解析的图 MUST NOT 替代缺失对象、缺证据或未闭合关系；手写/历史图 MUST NOT 反向写入或覆盖蓝图真源。

#### Scenario: A generated graph is syntactically valid but incomplete

- **WHEN** 生成的图可以被 Mermaid parser 解析，但省略了一个 scenario owner、DTO mapping 和 runtime recovery edge
- **THEN** 图生成步骤可以报告 parse PASS，但蓝图完整性门仍必须 FAIL 并定位三个结构化缺口

#### Scenario: No graph is requested

- **WHEN** 蓝图只需要结构化 view instance 和评审摘要，不生成任何图
- **THEN** 系统不得因缺少图而失败，也不得以未生成图为由跳过跨视图、契约或运行时完整性检查

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-graph-generator.ts`, `harness/scripts/check-component-blueprint.ts`

### Requirement: Reconciliation invalidates stale derived conclusions

新事实、权威裁决或冲突解决 MUST 生成新的蓝图 `revision` 或等价的正式修订，并更新相关认知、决策、缺口和后续工作；不得篡改已完成的 Goal Mode events/receipt/evidence。所有 P1 派生结论（完整性结果、contract mapping 检查、runtime flow 报告、生成图、质询结果和 P1 准入结果）MUST 记录输入 revision 与 `decision_fingerprint`。若决策翻转、契约版本/错误语义变化或视图适用性变化影响某个 P1 派生结论，该结论 MUST 先标为 `stale`，再按新 revision 重算。P1 MUST NOT 创建、修改或移除 P2 ready set 或 P3 closure 状态；下游消费带 revision/source_fingerprint/artifact_sha256 的 `component_blueprint_ref`，发现任一不匹配时由各自权威自行重新派生，P1 不代写下游状态。历史结论 MUST 保留 provenance 并指向 superseding revision；无法重算时只能返回 unknown/open_decision/blocker，不能沿用旧结论。

#### Scenario: Decision flips from direct implementation to a seam

- **WHEN** 人类把“直接实现”翻转为“建立宿主演进接缝”，但旧 revision 仍有 direct-implementation PASS、旧 mapping 和 graph
- **THEN** 调和必须使 P1 自身受影响派生结论变为 stale 并要求在新 revision 重算；旧 P1 结论可保留为历史，但不得残留为当前 P1 PASS，P1 不写入 P2 ready 或 P3 closure 状态

#### Scenario: Reconciliation discovers a new external contract version

- **WHEN** 权威来源把 operation 的 response DTO 从 v1 改为 v2，且字段映射发生变化
- **THEN** v1 的 mapping/flow/completeness 结论必须失效并标注其 provenance，v2 缺口在重算完成前必须阻止当前层宣称闭合

#### Scenario: A downstream reference becomes stale without P1 mutating its state

- **WHEN** P2 ready 或 P3 closure 保存的 `component_blueprint_ref` 与新蓝图 revision/source_fingerprint/artifact_sha256 任一不匹配
- **THEN** P2/P3 必须在各自权威内重新派生 ready/closure，P1 只维护自己的 stale/recompute 结果，不创建、修改或移除下游状态

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-reconciliation.ts`, `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/derived-conclusion-freshness.ts`

### Requirement: Substantial evolution candidates receive explicit decisions

App design lens MAY 提出变化轴候选，但只有存在可追溯变化证据且对边界、风险、测试、生命周期或后续成本有实质影响的候选才能进入决策卡。每张卡 MUST 记录变化原因、已知变体、稳定契约、Provider、Consumer、绑定时机、状态/数据 owner、缺失/失败/重复语义、替换或故障验证，以及人类裁决为建立接缝或保持直接实现；保持直接实现时 MUST 给出再提取条件。没有门槛证据的候选 MUST 在进入决策卡前被驳回，不得制造“以后可能会用”的抽象。宿主演进接缝位于宿主代码内部，不得进入 Maison provider 注册面或 `goal_requires/goal_provides`、Change Unit `requires/provides` 命名空间。

#### Scenario: An evidence-backed candidate is kept direct

- **WHEN** 现有多个数据来源证明存在变化轴，但人类裁决当前保持直接实现
- **THEN** 蓝图必须保存决策卡、裁决依据和再提取条件；后续变更若满足条件可重新进入调和

#### Scenario: An evidence-free abstraction is proposed

- **WHEN** AI 仅因“未来可能有第二实现”提出接缝，却没有真实变体、边界、测试或生命周期证据
- **THEN** 候选必须在进入决策卡前被驳回，不生成空接缝、空 Provider 或再提取条件

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-evolution-decisions.ts`, `harness/scripts/check-component-blueprint.ts`, `openspec/specs/complex-capability-meta-model/spec.md`

### Requirement: Static providers consume one provider-neutral protocol

本 P1 实现 MUST 将当前事实发现、SE/人工契约输入、App design lens 和独立设计质询作为静态内置 provider 接入同一蓝图协议，并把 P1 Skill 登记到既有 `skills/skills.index.yaml` 真源。provider id MUST 唯一，requirement 只允许 `required|optional`；四张 Seam Card 的 `authority_rule`/`source_rule` MUST 与下表冻结契约一致，重复 provider 不得按顺序或 Map 覆盖。required provider 缺失 MUST 形成结构化 blocker；optional provider 缺失 MUST 显示降级或 unknown。provider 替换不得改变 P2 消费的蓝图协议；provider MUST NOT 直接修改 Goal Mode 的 events/receipt/evidence，不得引入动态插件加载、第二全局注册表、跨单元运行状态或第二恢复权威。`project_profile` 只提供平台/项目事实和适用性线索，`design_lens` 只负责部件特有问题，e4/b9 等可选知识/资产 provider 缺失不应使核心蓝图伪造 PASS。

四个静态 provider 的 Seam Card 固定如下；它们是本 capability spec 的协议条目，不是新的文件类型、注册表或权威：

| Seam Card | Definition | Consumer | Provider | required/optional | 权威与来源 | 缺失 | 替换 | 退出 | 冲突行为 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 当前事实发现 | `{source_ref,evidence,conflict,unknown}` 的当前事实发现结果 | 蓝图 builder、App lens、质询 | 静态 current-facts discovery | 对当前态断言 required；其它场景 optional | 代码/schema/接口/配置/测试等可复核当前事实为权威；每项带 `source_ref`、evidence、可得 source revision/hash、`observed_at` | 无可信事实时 blocker，带 owner/解除条件；不得生成空 PASS | 保持协议不变，当前事实相关 P1 派生结果 stale 后重算 | 清理临时缓存/监听；正式蓝图事实保留并标 stale/unknown | 权威来源冲突 fail-closed，保留双方 source ref，禁止 last-write-wins |
| SE/人工契约输入 | `{operation,DTO,mapping,error,idempotency,NFR,provenance}` 外部契约输入 | 契约校验器、蓝图 builder、App lens | 静态 SE/manual adapter | 消费外部边界时 required；不消费时 optional | SE/授权 owner 的契约为权威；每段带契约 source ref、verification ref 和 provenance，模型推断不得升级为来源 | open_decision 或 blocker；不得编造契约字段 | 保持契约协议不变，依赖它的 P1 派生结果 stale 后重算 | 保留正式缺口/provenance，不删除契约事实 | 权威输入冲突 fail-closed，报告双方及具体字段/版本 |
| App design lens | App 视图投影与必答根问题，不创建第二蓝图 | 蓝图 builder、分层准入、共同评审 | 静态 App lens | P1 App 蓝图 required | lens 不是事实权威；只能从当前输入、`viewpoint contract` 和 lens rule/version provenance 生成投影 | blocker；不得提交空蓝图或伪造视图 | 保持投影协议不变，重算 P1 自身投影/准入 | 仅失效投影/缓存，canonical YAML 保留 stale/unknown | 与输入或其它 lens 投影冲突时 fail-closed，保留来源，不静默选胜 |
| 独立设计质询 | `{question,evidence,disposition,frontier}` 隔离问题/结果协议 | 蓝图准入、共同评审 | 隔离 subagent 或等价静态 provider | 送评审前 required；探索性草稿可 optional，但不得进入准入 | 质询不是事实/决策权威；来源只能是隔离读取的蓝图草稿、结构化证据包和已登记外部输入，每条回答带 evidence/source ref | blocker；不得自证 PASS | 保持问题/结果协议不变，重跑并更新 P1 准入派生 | 丢弃临时上下文/报告投影，canonical YAML 保留，P1 准入 stale/blocker | 禁止自证；冲突回答保留为 frontier/blocker，不静默合并 |

provider 只能通过上述协议提供输入或派生报告，不能直接改写 events/receipt/evidence、蓝图 SSOT 或下游 P2/P3 状态。

#### Scenario: Required fact provider is missing

- **WHEN** 当前态发现 provider 不可用且蓝图没有可信事实输入
- **THEN** 蓝图必须阻塞并列出责任方与解除条件，而不是生成空视图后送评审

#### Scenario: Optional asset provider is missing

- **WHEN** b9 组件资产 provider 不存在，但 App 蓝图不依赖组件复用才能回答核心数据/状态问题
- **THEN** 核心蓝图可以继续，但必须显示该维度的诚实 unknown/降级，不得呈现资产已被发现或验证

> **Enforced by (P1 implementation):** `skills/skills.index.yaml`, `skills/project/app-component-blueprint/SKILL.md`, `harness/scripts/utils/blueprint-provider-boundary.ts`, `openspec/specs/complex-capability-meta-model/spec.md`
