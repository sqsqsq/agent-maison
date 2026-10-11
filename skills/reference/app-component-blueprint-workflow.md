# App Component Blueprint 内部工作流

由 [`/component-design`](../project/component-design/SKILL.md) 或合法内部消费者引用，负责 App 部件发现、设计、质询、准入与调和；不登记独立 Skill、不提供公开 command。蓝图是一次演进的设计权威，本流程不创建 CU、P2 ready set 或 P3 closure。

只有一种蓝图协议，内容深度由真实影响面派生；当前仅支持 `hmos-app` / App design lens，其它 component type 明确返回 unsupported / missing design lens。

> 真实宿主的正式需求在进入蓝图前，材料准入与缺失路由见
> [真实宿主准入与回灌契约](./real-host-admission-and-feedback.md)（适用范围内）；
> 宿主侧三条接缝的适配细则见
> [宿主适配指南](../../docs/operations/component-design-host-adaptation.md)。

## 正式产物

唯一机器 SSOT（演进工作区布局，硬切无兼容）：

```text
<features_dir>/<blueprint_id>/blueprint/component-blueprint.yaml
```

`<features_dir>` 为 `paths.features_dir`（默认 `doc/features`，经框架解析，不硬编码）。`blueprint_id` 是稳定路径标识，必须是单个安全路径段（`^[A-Za-z0-9][A-Za-z0-9._-]*$`）；一次演进定名后不改，不为展示名改名。`component_id` 保留在 YAML 与所有 ref 中做所有权/一致性核验，**不再充当任何路径键**。不得用 feature 身份定位，不扫描 legacy 目录，不回退旧根 `blueprint/component/`，不建立 registry。同目录默认生成评审投影 `component-blueprint.review.md`，`derived_from` 绑定 canonical 蓝图和有效 CU 内容，同页展示需求、方案、运行流程、契约、拆分与显式依赖、安全中间态、替代关系、风险验收；不承载 readiness/run/完成状态，不反向覆盖 YAML。

## 静态 provider 顺序

1. `current-facts-discovery`：读取产品需求、代码、schema、接口、配置、测试及 architecture/catalog/code-graph；当前事实逐项保留 provenance 和冲突。
2. `conventions-knowledge`（optional）：按 `paths.conventions`（缺失用 `doc/conventions.md`）解析；文件存在时必读全文，只把真正适用的 `##` id 交给既有 facts/provenance；默认未启用记 `not_applicable`，显式配置却不可读记 `unknown|degraded`。
3. `se-manual-contracts`：消费 SE/授权 owner 的 operation、DTO、mapping、错误、幂等和 NFR；来源不可达时保持 unknown，不编造字段。
4. `app-design-lens`：回答模块边界、能力接缝、feature flag、生产者/消费者、生命周期、state owner、初始化、发布订阅、UI refresh、进程恢复十个根问题。
5. `independent-design-questioning`：在隔离上下文质询适用视图、关系、flow、根问题，以及适用惯例是否已被相关视图/decision 引用；编写方不得自证。

provider 固定内置并消费同一协议；id 必须唯一，requirement 只允许 `required|optional`，权威与来源规则不得由蓝图作者覆盖。不得动态加载、注册第二个全局 provider 真源，亦不得写 Goal events/receipt/evidence 或 P2/P3 状态。

## 工作流

### 1. 发现与权威分位

先消费 component-design 入口给出的原生路径与可选 design knowledge，实际打开原文；六个静态 provider 是职责与校验接缝，不是自动执行器。catalog/glossary/CodeGraph 进入 current-facts-discovery，惯例与组件仍走各自专业 reader；lens 和独立质询不充当事实源。按本次实际读取登记 `discovery.inputs.knowledge_assets`，不复制为统一知识库。

先按 `blueprint_id` 读取已有 canonical 蓝图，遵循 `/component-design` 的请求范围：只读不写 canonical，草稿从未完成的设计/质询继续，已有 admitted 蓝图不因重入自动调和。

- 当前事实优先引用代码/schema/接口/配置/测试；知识资产提供稳定背景，不覆盖本次事实。当前范围的 requirement/goal/invariant/high-risk 必须在 `discovery.inputs.current_scope_items` 形成带稳定 id、可解析 source ref、provenance 和项目内来源实际原始字节 hash 的闭集；revision 可附加但不能替代 hash，并由 `discovery.requirement_traceability` 双向一一映射到真实蓝图稳定地址。
- `requirement-source-materialization@1` 只处理正式需求来源；接口契约继续逐段消费原 `source_ref`，直接人工/inline/本地来源保留。同一原文可被多个消费者引用，不扩大其 authority。
- 稳定权威决定引用实际承载结论的已有资产，将精确 `文件#模块名/术语/组件id/节点id/标题` 写入 `decision.knowledge_refs`，文件同时在 `discovery.inputs.knowledge_assets`。未来目标不提前写成当前画像。实现后才成立的结论，在相关 run 收口后按原写入授权由 catalog/glossary、CodeGraph、conventions、组件或 extension writer 归位，再由 P1 owner 经 reconciliation 补引用/所需 revision，随后 design preparation 升 CU 指针后 closure。相同已确认决定不重问，未变引用不重复升版；具体授权/刷新边界见[知识读取与维护](../../docs/concepts/skill-contracts.md#知识读取与维护)。
- 惯例文件存在时完整读取，只把适用条目写入 `discovery.facts`：`provenance.source_kind: convention`、`source_ref: <配置路径>#<id>`、`evidence_strength: authoritative`。视图节点与 decision 继续用既有 `provenance` / `verification_refs` 引用同一 source ref；禁止新增 conventions 专用字段。
- **术语事实**（替代 CU-bound spec 的二次术语确认）：从当前范围抽出的业务名词逐条写入 `discovery.facts`：`subject: term:<原始术语>`，`value: {canonical_module, confidence: high|medium|low, easily_confused_with: []}`，`provenance.source_kind: glossary|catalog`。`canonical_module` 须为获准模块（catalog ∪ 本蓝图 add_module / move_module / retire_module 声明）；`high` 只能由 glossary 精确命中且模块一致时直确认；`medium|low` 须按 `spec.terminology`（[用户确认 UX](./user-confirmation-ux.md) §3.4）当场确认并记 `extraction_method: user_confirmed`，headless 自动继续记 `headless_assumed`（WARN、入 must-review、不得记 `user_confirmed`、不回写 glossary，见 §9.2）。未确认且只被远期切片使用的术语，可登记 `open_decision` gap（`needed_by` = 远期切片，`verification_refs` 含该 `term:` subject）停放；同一术语仍被当前切片需要（有当前切片或 `status: blocker` 的 gap 引用）时不得停放。检查 id `terminology_facts_confirmed`。`user_confirmed` 事实 admitted 后按 spec Step 1.5 第 6 条回写 glossary。
- 同一语义冲突时保留双方 source ref 与 owner，禁止 last-write-wins。
- 外部契约按 `contract_id` 建 operation→request/response DTO→mapping→error/idempotency/NFR 链；逐段解析项目内 `source_ref` 指向的权威文件/fragment 并真实比对，来源缺失或语义不同即 blocker。
- mapping 只验证权威 wire 字段和显式转换/派生边；禁止将 wire DTO 与领域模型逐字段同形比较。

### 2. 写入同一蓝图

标题与固定说明用中文，新写叙述用项目语言，保留 API、类型、路径原名。`review_summary` 分别写背景、问题、目标与成功衡量、方案改变、整体定位、范围/非范围；不要全塞 summary。current/target/delta、decision rationale、CU purpose/谓词/安全中间态都写实际含义。真实决策的被否方案使用 `alternatives`；不为凑说明新造会产生 closure 义务的 decision。

写作和质询共用七问：①需求与范围/非范围是什么；②当前问题是什么；③方案如何工作；④哪些模块负责；⑤关键选择为什么；⑥分几步、各交付什么、依赖与中间态是否安全；⑦风险/待决项和验证是什么。除核对原始证据外，评审者应能从文档回答；展示遗漏修 renderer，设计缺口交 owner 在现有字段补足并遵循 revision/权责，不以“未记录”宣称新设计质量通过。此为写作指引，不增加必填检查或人工批准。

**按 4+1 完成可评审设计**：App lens 回答十个根问题时分别使用本问题的真实依据，不复制同一个通用答案。场景（+1）描述目标用户、前提、旅程、人群差异并追到其它视图；逻辑表达能力边界、实体字段/枚举、操作/DTO/映射/错误/幂等；运行表达触发→首次加载→权威/状态→写入/发布→订阅消费→失败恢复，附有序步骤与用例分支；开发表达已消费 DSL 分层、真实目录/文件、组件/接口职责和已声明持久化设计；部署表达实际落点与外部责任、配套顺序及兼容性。核实未变只写结论与依据，未知、不适用、未记录分别说明。取舍、异常、部件质量属性、数据生命周期与 AC/BD/NFR 展开到能审查约束、失败与代价的粒度。代码骨架不入蓝图；端到端时序用有序步骤/分支表，本批不生成时序图。

**设计期 typed 内容**：被 CU `design_refs` 引用的目标在设计期写入已有 `acceptance`、`contracts`、`use_cases`。acceptance 挂 scenarios/logical 等设计目标，包含 ID、优先级、步骤/预期、分层与 focus；contracts 挂 development 节点/runtime flow，包含真实模块目录、根级 module_dependencies、模型字段、接口签名、组件、files 写集和状态；**整个 contracts.change_unit 由 plan 在 Feature contracts.yaml 生成**。use_cases 挂 runtime flow，包含阶段、UI/数据边界、命名调用、主路径/分支去向、预期和 linked_acceptance，分支新写 expected_port_calls。目标 provenance 仍须满足已有 authoritative 要求，作者写内容不等于拥有外部裁决权。详见[蓝图设计输入](../../docs/concepts/blueprint-design-inputs.md)。

**共享不是切片过滤**：引用一个目标就整体继承其设计内容。CU-A 引 S+A、CU-B 引 S+B：S 只放双方共同验收、共同合法写入文件/模型/用例；A/B 专属验收、files、用例放独占目标，设计节点保持语义稳定，不因 CU 身份变化复制版本节点。数组按既有行身份去重并合并，同行身份不同内容报 authority_content_conflict；对象不逐键拼接，module_dependencies/navigation/resource_keys/acceptance.flows 等分别集中在一个承载目标，重复声明只有全内容相等才接受。change_unit 属于 plan 的 Feature 产物，不进入蓝图设计投影，完整映射仍由 plan 原门校验。不能用 predicate 或模块范围过滤误继承内容，合法文件先后交叠不新增门禁。AC/BD 普通 ID 在一次 CU 投影中唯一（沿原行身份），推荐全蓝图稳定唯一；跨目标同 ID 不同内容文档按来源披露，不新加全蓝图唯一门禁。

**P0 真机分工**：无 ui-spec 依据时，只写 ID、优先级、步骤、预期、ut_layer 与 ut_focus/device_focus；不编 linked_flow、checkpoint、屏幕流程或元素 ID。spec 获得真实 UI 依据后沿“不冲突补充”补缺键，保留蓝图已有预期与全部权威键；需要改已声明内容就回 owner 修订。不得删掉整份 acceptance 绕过 P0 门。feature/source 由 provider 推导，plan 通过 canonical resolver 取得 change_unit_ref 并生成映射，设计期不写 contracts.change_unit。

**写作位置一致**：review_summary.title 写可读需求标题，summary 解释本次改变；通用 decision 获准结论写 conclusion，rationale 只写原因，特定 kind 保留自身结论字段。term.meaning 复用术语原定义，模型字段 description 写单位、约束与语义。flow publications.payload 表达已声明载荷，failure_recovery.handling/retry 分别写失败处理与重试；持久化契约的 table_schema 保留列 name/type/from/encoding、约束、默认值和来源。不得把已有真实内容写成“未记录”，存量 rationale 不由 renderer 推定成结论。旧 expected_boundary_calls 由共同加载/归一化入口兼容；与 expected_port_calls 同时冲突时披露，不选边或丢弃。

六类可选表达仅有以下增量，缺失不补事实、坏形状只 WARN，蓝图 schema 不变：

| 位置 | 可选内容 |
| --- | --- |
| review_summary | background/problem/positioning；goals[{goal_id,statement,success_measures[]}]/in_scope[]/non_goals[] |
| decision | alternatives[{option,rejected_reason,defect}]，只解释被否方案 |
| term: 事实的 value | meaning，复用已有 glossary 定义 |
| scenarios 节点 | journey_steps[{step_id,stage,user_action,system_behavior,preconditions[]}]；path_variants[{user_type,difference}] |
| deployment 节点/视图 | responsibilities[]/inputs[]/outputs[]/not_responsible_for[]/failure_impact；rollout[{order,unit,depends_on[],note}]；coordination[{counterpart,relation}] |
| 蓝图根 | quality_attributes[{qa_id,category,requirement,landing,source_ref,verification_refs[]}]；data_domains[{data_domain_id,usage,retention,isolation,cleanup,security}] |

flow.data_domain_refs 与 data_domains 使用同一标识。精确阈值/预期继续归 acceptance，不另维护 NFR 真源。contracts.data_models.fields 的可选 description/source_ref 字符串表达字段约束与来源，非字符串显示“未能表达”，不新增校验。所有新增 source_ref 只引用设计期已有来源，不指向本 CU 将新建的文件，也不扩大写权限。持久化配置/表字段只用已有 contracts 模型、接口、source_of_truth 和字段说明表达实际设计，不猜索引/事务，不增第七类字段。实际打点属于本部件时可写 quality_attributes 并关联既有验收/落点；外部运营配套写 coordination，无依据不造按钮 ID 或 BI 协议。Visual Handoff 仍由 spec 沿真实视觉职责完成。

canonical YAML 根对象含 `component_id`、`blueprint_id`、`revision`、`source_fingerprint`、`decision_fingerprint`、整体 provenance，以及 `review_summary`、`design_views`、`decisions_and_gaps`。根/discovery `source_fingerprint` 必须只由规范化 discovery facts 与 current-scope source identity/provenance/revision/hash 重算一致；requirement→blueprint mapping 不进入该指纹，其变化由 revision、artifact hash 和下游 input fingerprint 捕获。所有稳定对象保留 owner、provenance、verification refs；语义替换使用新 id 并记录 `supersedes`。

`evolution_candidate` 的 `human_decision` 只能是 `establish_seam|keep_direct`。前者必须以四个互不复用、同时进入 decision tests 的精确 `closure_proofs` 绑定契约兼容、Provider 替换、缺失/失败与 Consumer no-bypass 证明；后者只保留普通施工语义并记录再提取条件。

4+1 使用固定 view id：`logical`、`runtime`、`development`、`deployment`、`scenarios`。前四项中除 deployment 外，对可执行 App 均为 applicable；deployment 即使不适用也保留证据化裁决。

**deployment 按部件固有运行拓扑裁决**：平台、进程、独立持久化和外部边界决定适用性，不随单次需求切换；本次演进影响仍由 evolution_impact 单独表达。适用 deployment 按既有 requiredQuestioningScopes 进入独立质询。外部参与方节点只记当前事实，current_state=target_state、无 delta；根级 contracts 只登记本部件实际消费/提供的接口，由消费 CU design_refs 认领本侧契约与指向外部节点的 relation，并提供本侧证据。外部方自身未消费的施工，阻挡切片时用 gap + CU blocker 说明解除条件，其余用 coordination/rollout，不建根 contract、不代其宣称完成。deployment 适用时，纯本地场景也必须在 deployment_refs 引本部件自己的实际运行节点，外部节点不能替代本部件落点。

**两个正交维度（M7）**：`applicability`（部件类型固有适用性，二值 `applicable|not_applicable`，`not_applicable` 仍仅限 deployment）与 `evolution_impact`（本次演进影响，`changed|verified_unchanged`，**只由 applicable 视图携带**）互相独立，不得合并成三态枚举。

- `applicable` + `changed`：全量义务（非 unknown 的 current/target/delta、≥1 可寻址节点、verification_refs）；
- `applicable` + `verified_unchanged`：必须带 `unchanged_evidence`（`evidence_refs` 非空 + `current_state_ref`）与非 unknown 当前态，据此**免除** target/delta 与节点义务；该视图内任一节点声明本次 delta 即失败（不变声明不得掩盖真实变化）；其质询义务是**核实不变声明与依据**，只接受 `answered_with_evidence`；
- **至少一个 `applicable` + `changed` 视图**；全部 `verified_unchanged` = 本次不构成演进，fail-closed；
- 六类 runtime flow 触发条件**只对 `runtime` = `changed` 评估**。

**条件式设计义务**（只在对应事实被发现时触发）：

| 发现 | 义务 |
|---|---|
| 多个 CU | 完成 CU 边界与关系分析（真实依赖、共享资源、可并行性、独立性）；**只有事实要求时**才生成 `requires` 与顺序约束，不得为记录先后伪造依赖边 |
| 共享部件级设计决策 | 只在蓝图裁决一次，各 CU 经 `design_refs` 消费；不在多个 Feature plan 各裁一次 |
| “单独绿 ≠ 整体完成” | Component closure 追加真实组装与组合证据义务 |
| （通用，单/多 CU 都适用） | 每个 CU 的 `safe_intermediate_state` |

**模块归属与架构影响（spec/plan 只投影）**：

- `applicable` + `changed` 的 development 视图，每个节点**必须**填 `module`（缺失 `blueprint_node_module_missing`），且须为获准模块 = module-catalog 当前模块 ∪ 本蓝图 `add_module` / `move_module` / `retire_module` 决策声明的模块（否则 `blueprint_node_module_unadmitted`；catalog 不可读 `blueprint_node_module_unresolved`）。`owner` 仍是责任方，不承载模块身份。CU `touches[].design_ref` 指向的节点 `module` 去重即该 CU 的可修改模块集合。
- 架构变化用 `kind: architecture_impact` 决策表达，**一条决策一个变化项**，复合变化拆多条；每条带 `change`、条件字段、`rationale` 及既有 `owner` / `provenance` / `verification_refs` / `status`（change 非法、条件字段 / rationale / owner / verification_refs 缺失或层不在 DSL 即 `blueprint_architecture_impact_invalid`）：

  | `change` | 条件字段 | 生效与归位 |
  |---|---|---|
  | `add_module` | `module`、`layer`（∈ 当前 DSL `outer_layers`） | 施工期作获准目标模块；CU 落地后 closure 归位 catalog |
  | `retire_module` | `module` | catalog 不提前退役；CU 落地后 closure 归位（已移出 catalog 只 WARN 核对拼写） |
  | `move_module` | `module`、`from_layer`、`to_layer`（均 ∈ DSL） | 施工期按 `to_layer` 判依赖；closure 归位 |
  | `responsibility_rewrite` | `module`（获准模块） | 实现验证后 closure 归位 catalog 职责 |
  | `dependency_edge` | `from`、`to`（模块名或外层 id）、`direction: add\|remove` | 施工前 DSL 须已达目标许可（add 已允许、remove 已不允许）且决策 `decided_with_authority`，否则相关 CU 不得施工 |
  | `dsl_other` | `affected_items[]` | 只登记不机检，施工前须经权威批准落盘 |

  `verified_unchanged` 的 development 不得有该类决策（`blueprint_view_unchanged_masks_change`）。蓝图期不改 catalog 与 DSL；DSL 只经 framework-init 既有获准路径（预设 / 手工编辑 config 后重跑 UPDATE）改写。

### 3. 运行时流与跨视图检查

逐项裁决六类 flow 触发条件。触发时记录 source-of-truth/reconciliation、trigger idempotency、initial-load freshness、state owner、mutation/publication/subscription cleanup、consumer、failure/recovery、证据和验证引用，并覆盖 cold start、warm resume、page attach/detach、account switch、process recreation、background write。闭环关键集合不得为空；局部 id 唯一，mutation/subscription/consumer 的引用必须解析到真实 flow 对象。

scenario 必须追到 logical/runtime/development 以及适用 deployment；runtime flow 必须追到 logical contract 和 development owner。缺边作为 frontier，不用图或标题补齐。

### 4. 质询、准入与调和

- 独立质询从 canonical YAML 派生 scope，唯一覆盖每个 view/relation/runtime flow 和十个 App 根问题，并逐项给出 evidence、disposition、frontier fingerprint、owner 和 verification refs。
- 在同一批既有 scope 内实读 4+1 与 typed 细节：核对来源、共享/专属继承、完整异常与取舍、写集、本侧外部契约证据、质量与验收的关系。不因标题齐全、字段 dump 或一段 summary 宣称设计充分；不新增平行 scope 或缺字段门禁。
- root questions、contracts/design refs readiness 和 admission status 由实际质询/App lens 及 checker 结果派生，不接受自报布尔值。
- 当前切片依赖的 unknown 必须 blocker；远期 open decision 必须有 owner、needed-by 和解除条件。
- 仅重入、查看或重跑 checker 不增加 revision；意见、建议与未接受反馈不自动触发修订。接受新事实、权威裁决或解决冲突后，才按既有调和规则生成新 revision，不回写旧 revision。
- 决策/契约版本/视图适用性变化时，只把 P1 自身派生结果标 stale 并按新 revision 重算；历史保留 provenance。
- 下游发现 `component_blueprint_ref` 的 revision/source_fingerprint/artifact_sha256 不匹配时，在各自权威内重新派生；P1 不代写 ready/closure。

### 5. 写作、检查与本地交付

完整交接默认交付同目录 `component-blueprint.review.md`，同页展示蓝图与 canonical CU 的需求、方案、职责、施工拆分、显式依赖、安全中间态、替代关系及风险验收。Maison 自动收集 CU，宿主无需自拼 CU 附件；不把 readiness、run 或完成状态写入设计正文。

交接 readiness 在指针调和非 busy 后，对全部未退役（含已完成）且原设计 constructable 的 CU 调用现有 deriveBlueprintSkillInput 默认只读模式，分别检查已声明 acceptance/contracts/use_cases；不传 pure，以便当前来源戳产物和手写 use-cases.yaml 的真实冲突仍提前报告，过期来源戳产物交 plan 重建。absent 不新增缺字段门禁，明确缺口与 spec/plan 补设计责任；canonical 内容 invalid 复用现有 authority_* 原因令 perUnit blocked/not-ready。另一类 absent 不得漏掉坏 use_cases，未来 plan 映射缺失不使设计未就绪。正常交接不物化 Feature acceptance/contracts/use-cases，不产 phase PASS/receipt；spec/plan 直接消费推导输入并各写本阶段产物，投影带用例时 plan 必须写 use-cases.yaml 供业务 UT，required_outputs 不只看文件已存在。prepare-blueprint-design CLI 保留当前投影导出用途，不承担未发布旧交接数据的迁移兼容。

当前 spec/plan 的带戳产物可作不冲突补充。canonical CU 通过原校验后指针照常升版；只有冻结的完整绑定能证明设计/CU 契约等价时，才更新该 Feature 来源身份并保留补充原字节。plan 尚未冻结、重写后未再次冻结，或内容变化不能证明等价时，该 Feature 文件保持原字节，由既有绑定/输入缺口交回 spec/plan，不让兄弟 CU 因缺少冻结记录阻断整批升版。真实写入失败和依赖并发变化仍按原事务回滚；readiness 继续只读评估，不选择 CU 或启动 Goal。

人读文档按目标展示 canonical typed 内容，并逐 CU 用投影共用的纯选取/合并函数显示实际继承 AC/BD/NFR 和 contracts.files；固定说明“是否通过交接校验见 readiness”。文档不运行完整投影门、不读取 Feature 的 use-cases.yaml、需求原文或外部 catalog，不用 touches/predicate 估算或过滤集合。canonical 可确定架构相关集合时沿用原 identityNeutralDigest；某层级相关性依赖外部 catalog 才能确定时省略中立摘要，精确 CU 绑定与声明集合仍可展示，不承诺 carry-forward。待升版 CU 的合并集合写“待指针升版后显示”。有明确关系才复用现有图模块画结构图；完整地址区分跨视图同名节点，canonical 无效图不展示并说明原因。一个充实表达夹具供测试与[完整样例](../../docs/operations/samples/blueprint-review-projection.valid.md)共用，样例不是真实宿主验收。

**本次调用改了 canonical 蓝图或 CU 内容，结束前必须重建**：继续草稿、质询/准入写回、局部修改、新增/替代 CU、正式修订均适用，不以 admitted 或 revision 增加作触发条件。新增 CU 仍经 consumer 接受，不能直接写 canonical。接受、readiness、持锁整批调和与 B1 已自动调用同一物化入口；agent 直接改蓝图后执行：

```bash
cd framework/harness
npm run check:component-blueprint -- --project-root <宿主根> --blueprint <blueprint-id> --write-review
```

草稿可生成，显示真实准入与未决项；生成不会改 YAML、升 revision、重签 CU 或重新质询。`--write-review` 不与材料检查模式混用。查看/解释使用无参 checker 的只读文档状态，缺失/过期如实披露；用户明确要求补生成时直接重建。

生成失败保留 canonical 与原 readiness/接受结果，只重试物化。完整交接最终回复必须链接当前文档并概述变化与未决项，单独报告 readiness；失败时明确文档未交付/过期，不声称交付完成。文档结果看整个尝试最终状态：内部已刷新而外层同字节未写仍是已刷新，最后失败不得被先前成功遮盖。


在消费者工程的 `framework/harness` 中运行：

```bash
npm run check:component-blueprint -- --project-root <宿主根> --blueprint <blueprint-id>
```

需要解析稳定切片时，传入序列化 `component_blueprint_ref`。target 支持 `blueprint|view|node|relation|flow|decision|contract`；只有 node/flow 强制 `view_id`，decision/contract 是顶层稳定对象，contract 以 `contract_id` 寻址。resolver 在返回 target 前必须先通过 canonical schema/完整性门。蓝图/评审投影/closure 投影同处工作区 `blueprint/` 目录。

只有本轮生成 Mermaid 时才校验其 parser 和引用。未生成图不阻塞；生成图可解析也不替代结构化完整性。

## 完成边界

checker 无 BLOCKER，独立质询完成，当前切片可施工，P1 派生结果与当前 revision/fingerprint 一致。此结果只代表 P1 蓝图完成，不代表 P2 Change Unit 或 P3 Component closure 完成。

## 组件资产 App lens（b9）

新依赖边的人类裁决遵循 [用户确认 UX](./user-confirmation-ux.md)。

沿 [组件资产 SSOT](../../docs/concepts/component-assets.md) 消费配置的 index/catalog。development 或涉 UI 的 logical/scenarios 视图 changed 时，先读完整库存与策展卡，live 检索候选调用点，再按语义同一性、增量兼容、影响规模、变体轴判五级。每个页面/UI development 节点形成 component_asset_selection decision；节点沿既有 kind/decorator/navigation 信号并声明使用模块 module，target_ref 指该节点。provenance 指 index/catalog 证据，component_ref 指定义；owner/verification_refs 齐全。verified_unchanged development 不产生选型。

同一 providers[] 必有静态 optional component-assets 卡。冻结 authority_rule = `Source is component fact authority; curation is human selection guidance.`，source_rule = `Selection evidence cites the configured component index or catalog; component_ref identifies the asset.`。definition=共享 UI 资产输入，consumer=builder/lens/questioning，provider=静态 index/catalog reader；missing_behavior=诚实 unknown/degraded/not_applicable，replacement_behavior=同源重扫并使相关 P1 结果过期，exit_behavior=丢临时检索保留 provenance，conflict_behavior=源码优先且保留策展冲突，writes=[canonical_blueprint_input]。

无 UI 维度可 not_applicable；有 UI 缺索引必须 unknown|degraded + unknown gap（verification_refs 含 provider:component-assets），owner/needed_by/unlock_condition 齐全。远期 open_decision 可继续，当前切片依赖则 blocker，不伪造选型。依赖预检复用 componentDependencyAllowed；顺序换选>plan 声明下沉>用户批新边。DSL 未获批准不能自改；未决新边保留 open_decision/blocker 和引用该 decision 的 gap，获批后更新正确 DSL 与决定。Story publication 由同一 renderer 输出四个选型字段并跑 --projection。
