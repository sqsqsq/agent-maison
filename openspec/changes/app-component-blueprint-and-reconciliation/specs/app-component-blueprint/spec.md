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

> **Enforced by (P1 implementation):** `skills/reference/app-component-blueprint-workflow.md`, `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-provenance.ts`

### Requirement: Viewpoint contracts and App view instances are separate

蓝图 MUST 区分可复用的 `viewpoint contract` 与某次蓝图的 `view instance`。同一蓝图内的 view id MUST 稳定使用 `logical`、`runtime`、`development`、`deployment`、`scenarios`；`logical`、`development`、`scenarios` 必需，可执行 App 的 `runtime` 必需，`deployment` 必须按平台/进程/持久化/外部边界和运行拓扑条件裁决。五个 view MUST 是同一蓝图的观察面，不得生成五份独立真源。

**两个正交维度（M7）**：view instance MUST 同时携带互相独立的两个维度，MUST NOT 合并为一个三态枚举：

| 字段 | 语义 | 取值 |
|---|---|---|
| `applicability` | **部件类型固有适用性**——这个视图对本类部件是否成立 | `applicable` \| `not_applicable`（`not_applicable` 仍仅限 `deployment`，且须证据化裁决） |
| `evolution_impact` | **本次演进影响**——这次演进有没有改动这个视图 | `changed` \| `verified_unchanged`；MUST 只由 `applicable` 视图携带 |

- `applicable` + `changed`：全量义务——非 `unknown` 的当前态、目标态与演进 delta，至少一个可寻址节点，关注者/用途、决定/缺口和验证义务；MUST NOT 以字段存在、空数组或 `unknown` 占位冒充实质视图；
- `applicable` + `verified_unchanged`：MUST 携带事实依据（`unchanged_evidence.evidence_refs` 非空 + `current_state_ref`）与非 `unknown` 当前态；据此**免除** target/delta 与可寻址节点义务；但**视图自身**或其任一节点声明本次 delta（`delta` 非 none/no_change/unchanged，或 `current_state ≠ target_state`）时 MUST 失败——不变声明不得掩盖真实变化。**视图级与节点级 MUST 各判一次且共用同一判据**：只抹平节点、视图自身仍宣告 current≠target 或实质 delta，是节点级检查抓不到的洗白路径；
- `not_applicable` 视图 MUST NOT 携带 `evolution_impact`；
- **完整性不变量**：蓝图 MUST 至少有一个 `applicable` + `changed` 视图。零 `changed` 即"本次不构成演进"，MUST fail-closed，MUST NOT 生成 admitted 蓝图。

`evolution_impact` MUST 同步接线全部消费面而不仅是 schema：质询 scope 派生（`applicable` 视图**全部**进入必答范围，`changed` 视图另含其 runtime flow；`verified_unchanged` 视图的质询义务是**核实不变声明与其依据**，只接受 `answered_with_evidence`，且其 `evidence_refs` MUST 与该视图 `unchanged_evidence.evidence_refs` 有交集——拿任意无关证据搪塞等同自证）、runtime 六类 flow 触发条件（仅对 `runtime` = `changed` 评估）、closure 义务派生（`applicable` 视图全部产生视图事实义务；只有 `changed` 视图的节点可能派生施工义务，`verified_unchanged` 视图的节点一律是当前事实）与 fixture。按字面 `applicability !== 'applicable'` 跳过视图的旧路径 MUST NOT 残留。

#### Scenario: An executable App has the required views

- **WHEN** 为一个包含页面、持久化数据和后台恢复的 App 生成蓝图
- **THEN** 蓝图必须包含 `logical`、`runtime`、`development`、`scenarios`，并根据运行拓扑证据决定 `deployment` 是否适用；每个 applicable+changed view 都能区分当前态、目标态和 delta

#### Scenario: Deployment is not applicable with evidence

- **WHEN** 目标 App 的部署拓扑不构成本次部件边界，且输入证据足以支持不适用裁决
- **THEN** 蓝图必须保留 `deployment` 的适用性裁决、证据和 `not_applicable` disposition，不得仅因“单部件”省略该视图；该视图不得携带 `evolution_impact`

#### Scenario: An untouched view is verified unchanged with evidence

- **WHEN** 本次演进不改动 development 视图，且有可复核的当前态事实依据
- **THEN** 该视图标 `applicable` + `verified_unchanged` 并给出 `unchanged_evidence`，免除 target/delta 与节点义务，但仍进入质询必答范围并只能以证据作答

#### Scenario: A verified_unchanged claim masks a real change

- **WHEN** 某视图标为 `verified_unchanged`，其节点却声明了本次 delta（`current_state ≠ target_state` 或非空 delta）
- **THEN** 校验必须失败并定位该节点，不得让不变声明掩盖真实变化

#### Scenario: View-level delta survives node flattening

- **WHEN** 某视图标为 `verified_unchanged`，其全部节点都被抹平为无 delta，但**视图自身**的 `current_state ≠ target_state` 或 `delta` 仍是实质内容
- **THEN** 校验必须失败并定位该视图；仅靠节点级检查放行该视图即违约（runtime 视图还会因此跳过六类 flow 触发条件）

#### Scenario: Unchanged verification cites unrelated evidence

- **WHEN** `verified_unchanged` 视图的质询项以 `answered_with_evidence` 作答，但其 `evidence_refs` 与该视图 `unchanged_evidence.evidence_refs` 毫无交集
- **THEN** 质询校验必须失败——核实义务必须针对该视图交出的那份不变依据

#### Scenario: Every applicable view is verified unchanged

- **WHEN** 蓝图的全部 applicable 视图都标 `verified_unchanged`
- **THEN** 校验必须失败——本次不构成演进，不得生成 admitted 蓝图

#### Scenario: A verified_unchanged view is dismissed instead of verified

- **WHEN** `verified_unchanged` 视图的质询项用 `not_applicable` 或 `open_decision` 打发
- **THEN** 质询校验必须失败——不变声明的核实义务不得变成无人核实的自证

> **Enforced by (P1 implementation):** `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-views.ts`, `harness/scripts/utils/blueprint-questioning.ts`, `harness/scripts/utils/runtime-data-flow-check.ts`, `harness/scripts/utils/component-closure-obligations.ts`, `harness/schemas/app-component-blueprint.schema.json`

### Requirement: A legal blueprint and a complete design handoff are separate bars

**合法 `component-blueprint@1`（P1 协议层）** MUST 只要求：闭集 `discovery.inputs.current_scope_items`（≥1 项，逐项带项目内可解析 `source_ref`、原始字节 `source_sha256`、provenance）+ 至少一个 `applicable` + `changed` 视图 + 必要的当前/目标/delta + 决策/缺口/关系/验证义务满足本 capability 其余条目。合法性 MUST NOT 包含 Change Unit 数量——P1 MUST NOT 反向依赖 P2。

**完整 `/component-design` 设计交付（编排层）** MUST 同时满足：蓝图 admitted + 已分解 1..N canonical `change-unit@1` + 每个 CU 建立 `design_refs` 引用 + 后续施工 readiness。该层验收由 `/component-design` 编排入口承担，MUST NOT 被写进蓝图自身的合法性判据。

因此 `admitted blueprint + 0 CU` MUST 是一个**合法状态**（P2 设计准备子流程的合法入口），而不是蓝图校验失败。

#### Scenario: An admitted blueprint with zero change units is legal

- **WHEN** 一份蓝图已通过全部 P1 校验并 admitted，但尚未分解出任何 canonical CU
- **THEN** `check:component-blueprint` 必须 PASS；CU 数量不进入蓝图合法性判据

#### Scenario: A design handoff without change units is incomplete

- **WHEN** `/component-design` 在蓝图 admitted 后返回，却没有任何 canonical CU 与 readiness
- **THEN** 编排层必须判定设计交付未完成，而不是宣称完成；该判定 MUST NOT 通过修改蓝图合法性实现

> **Enforced by (P1 implementation):** `harness/scripts/utils/component-blueprint-validator.ts`, `skills/project/component-design/SKILL.md`, `skills/project/change-unit-progression/SKILL.md`

### Requirement: App is the only component type with a design lens today

蓝图入口 MUST 只对已具备 design lens 的 component type 给出设计交付。当前 MUST 只声明 `hmos-app` / App component profile 具备 design lens。请求为缺少 lens 的 component type 建立蓝图时，入口 MUST 返回明确的 unsupported / missing design lens 失败并说明缺什么，MUST NOT 把 Service、Library 等类型送入 App 4+1 视图后宣称已支持，也 MUST NOT 借本 change 顺带建设其它 profile 的 lens。

#### Scenario: A component type without a lens fails honestly

- **WHEN** 请求为一个没有 design lens 的 component type 建立部件演进蓝图
- **THEN** 入口返回 unsupported / missing design lens 的明确失败，不生成套用 App 4+1 骨架的蓝图

> **Enforced by (P1 implementation):** `skills/reference/app-component-blueprint-workflow.md`, `skills/project/component-design/SKILL.md`, `openspec/specs/complex-capability-meta-model/spec.md`

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

机器可校验的蓝图 SSOT MUST 存放于该次演进的**工作区**内，使用唯一 canonical 路径
`<features_dir>/<blueprint_id>/blueprint/component-blueprint.yaml`，其中 `<features_dir>` 即 `paths.features_dir`
（默认 `doc/features`），所有蓝图路径 MUST 经该配置解析，不得写死 `doc/features`。`blueprint_id` 是一次部件演进的
稳定路径键：一份蓝图对应一次演进，同一 `component_id` 可以先后存在多个 `blueprint_id` 工作区且互不覆盖；
`component_id` 只承担所有权与一致性核验，不得充当路径键或 CLI 定位参数，也不得从 feature 名称、feature 目录或
feature artifact 推导。承担路径身份的 `blueprint_id`（蓝图根字段与 `component_blueprint_ref.blueprint_id`）MUST 是
安全路径段（`^[A-Za-z0-9][A-Za-z0-9._-]*$`，拒绝 `.`、`..` 与分隔符）；view、节点、关系、flow、decision、contract
等其它 stable id 保留原有字符集，不得为此全局收紧。实现 MUST 复用既有 YAML 解析、schema 校验、SHA-256 文件 hash
与 `paths.features_dir` 解析能力，只增加最小的 `blueprint_id`→canonical path 解析；不得新增全局 registry、独立索引、
动态注册系统或第二 loader，调用方也不得传入任意 path。解析器 MUST 拒绝空值、路径分隔符和 `..`；不存在 legacy
fallback，不得读取或回退到已废止的 `blueprint/component/<component-id>/` 根路径，也不得扫描 feature 目录。

canonical YAML 根对象 MUST 包含与路径段一致的 `blueprint_id` 和与 ref 一致的 `component_id`，并在同一文件内包含 `review_summary`、`design_views`、`decisions_and_gaps` 三组同源内容。`component_blueprint_ref`
MUST 至少包含 `artifact: component-blueprint@1`、`component_id`、`blueprint_id`、正整数 `revision`、
`source_fingerprint: sha256:<hex>`、`artifact_sha256: sha256:<hex>` 和
`target: { kind: blueprint|view|node|relation|flow|decision|contract, id, view_id? }`。`source_fingerprint` 是本 revision
所依据的规范化来源/权威输入集合的语义指纹；`artifact_sha256` 是 canonical YAML 原始字节的 SHA-256，二者 MUST
分开计算、分开比对，不能互相替代。path 中 `<blueprint_id>`、canonical YAML 根 `blueprint_id`、ref
`blueprint_id` MUST 三者完全一致；canonical YAML 根 `component_id` 与 ref `component_id` MUST 一致。
`target.kind: blueprint` 的 id MUST 等于 `blueprint_id`；`view` 的 id MUST 是稳定
view id；只有 `node`/`flow` MUST 提供 `view_id` 并在该 view 下存在。`relation` MUST 在蓝图关系集合中稳定寻址并
校验其 from/to 稳定引用；`decision` 与 `contract` MUST 是顶层稳定对象，分别按 decision id 与稳定 `contract_id`
寻址，`view_id` 只允许作为可选关联且存在时 MUST 可解析。

解析顺序 MUST 固定为：校验 ref 形状 → 由 `blueprint_id` 经 `paths.features_dir` 解析唯一 canonical path → 读取
canonical YAML 原始字节并计算 `artifact_sha256` → 按既有 schema/YAML loader 解析 → 校验 path/YAML/ref 三处 blueprint
identity 与 YAML/ref component identity → 精确比对 revision、`source_fingerprint`、`artifact_sha256` → 执行 canonical
schema/完整性门 → 解析 target。hash 匹配但结构非法的蓝图 MUST fail-closed。解析不接受第二路径、不回退、不扫描旧目录。
进入团队评审前生成的 Markdown/HTML 是 canonical YAML 三组内容的 derived projection，MUST 与 canonical YAML 同处工作区
`blueprint/` 目录（`component-blueprint.review.md`），必须携带 `derived_from`（artifact、component_id、
blueprint_id、revision、source_fingerprint、artifact_sha256），并完整投影视图 current/target/delta、runtime flow、契约 mapping、跨视图关系、质询与准入；它不能反向覆盖 SSOT 或成为解析输入。

#### Scenario: A stable ref resolves one blueprint slice

- **WHEN** 消费者提供包含 component、blueprint、revision、source/artifact fingerprints 和 `target.kind/id` 的
  `component_blueprint_ref`
- **THEN** resolver MUST 从 `blueprint_id` 经 `paths.features_dir` 推导唯一 canonical path，读取同一正式 YAML，并精确
  定位到指定 blueprint、view、node、relation、flow、decision 或 contract；调用方不需要也不能提供第二个文件路径

#### Scenario: Blueprint or component identity disagrees across path content and ref

- **WHEN** canonical path 的 `<blueprint_id>`、YAML 根 `blueprint_id`、`component_blueprint_ref.blueprint_id` 任一不同，
  或 YAML 根 `component_id` 与 `component_blueprint_ref.component_id` 不同
- **THEN** schema/resolver MUST fail-closed 并同时报告各处值，不得按其中任一继续解析 target

#### Scenario: Two evolutions of the same component coexist

- **WHEN** 同一 `component_id` 在 `<features_dir>` 下存在两个不同 `blueprint_id` 的工作区
- **THEN** 两份蓝图 MUST 各自独立解析、互不覆盖；引用其中一个 `blueprint_id` 的 ref 不得解析到另一个工作区，
  创建或修订其中一个工作区不得改变另一个工作区的任何字节

#### Scenario: Path-unsafe blueprint identity is rejected

- **WHEN** 蓝图根 `blueprint_id` 或 ref `blueprint_id` 含 `:`、路径分隔符，或为 `.`/`..`
- **THEN** schema 与 resolver MUST fail-closed；其它 stable id（view/node/relation/flow/decision/contract）的字符集不受影响

#### Scenario: Retired root path is never consulted

- **WHEN** 工作区 canonical path 不存在，而旧根 `blueprint/component/<component-id>/component-blueprint.yaml` 存在
- **THEN** resolver MUST 报告 canonical blueprint 缺失，不得回退读取旧根路径，也不得扫描任何目录寻找替代文件

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

> **Enforced by (P1 implementation):** `skills/reference/app-component-blueprint-workflow.md`, `harness/scripts/utils/blueprint-questioning.ts`, `harness/scripts/check-component-blueprint.ts`

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

本 P1 实现 MUST 将当前事实发现、SE/人工契约输入、App design lens 和独立设计质询作为静态内置 provider 接入同一蓝图协议，公开设计入口 MUST 仅为登记在既有 `skills/skills.index.yaml` 的 `/component-design`；P1 发现、设计、质询、准入与调和 MUST 由 `skills/reference/app-component-blueprint-workflow.md` 内部引用承载，不再登记为独立 Skill 或物化公开 command/bridge。provider id MUST 唯一，requirement 只允许 `required|optional`；四张 Seam Card 的 `authority_rule`/`source_rule` MUST 与下表冻结契约一致，重复 provider 不得按顺序或 Map 覆盖。required provider 缺失 MUST 形成结构化 blocker；optional provider 缺失 MUST 显示降级或 unknown。provider 替换不得改变 P2 消费的蓝图协议；provider MUST NOT 直接修改 Goal Mode 的 events/receipt/evidence，不得引入动态插件加载、第二全局注册表、跨单元运行状态或第二恢复权威。`project_profile` 只提供平台/项目事实和适用性线索，`design_lens` 只负责部件特有问题，e4/b9 等可选知识/资产 provider 缺失不应使核心蓝图伪造 PASS。

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

> **Enforced by (P1 implementation):** `skills/skills.index.yaml`, `skills/reference/app-component-blueprint-workflow.md`, `harness/scripts/utils/blueprint-provider-boundary.ts`, `openspec/specs/complex-capability-meta-model/spec.md`

### Requirement: Three Story-class host seams are separate directional contracts

正式需求统一经蓝图后，Maison 与宿主之间 MUST 存在三条**方向与 owner 各自独立**的静态接缝。它们照上表 Seam Card 格式冻结如下；publication 与 feedback 方向相反、owner 不同，MUST NOT 合并为一张卡，评审投影 renderer MUST NOT 兼任 feedback provider。

| Seam Card | Definition | 方向 | Consumer | Provider | required/optional | 权威与来源 | 缺失 | 替换 | 退出 | 冲突行为 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| requirement-source materialization | `{item_id,kind,source_ref,source_sha256,source_revision?,provenance{authority…}}` 的来源材料物化输入 | 宿主 → Maison | 蓝图 builder 的 `discovery.inputs.current_scope_items` | 宿主 story 类扩展（获取/脱敏/物化） | 来源为宿主/外部 provider 时 required；直接人工/inline/本地文件输入时由 builder 直接规范化为同一 currentScopeItem，不走本文件接缝 | 宿主物化后的**项目内**文件为唯一可解析来源；每项带项目相对 `source_ref`、原始字节 `source_sha256`、`provenance.evidence_strength`/`extraction_method` 与 authority；Maison MUST NOT 知道内网标识、token、URL 或归档 API，MUST NOT 把模型转述升级为来源 | required 缺失 → 结构化 blocker，带 owner/解除条件；不得凭记忆或转述补造 scope item | 保持输入契约不变；来源变化使依赖它的 P1 派生结果 stale 后重算 | 已物化文件与已收录 scope item 保留并标 stale/unknown，不删除 | 同一 `item_id` 出现两份不同 `source_sha256`，或声明 hash 与实际字节不符 → fail-closed，报告双方，禁止 last-write-wins |
| blueprint-review publication | 指定 admitted revision 的确定性评审投影（`derived_from` = artifact/component_id/blueprint_id/revision/source_fingerprint/artifact_sha256） | Maison → 宿主 | 宿主 Story Document / 归档件装配方 | Maison 确定性 review projection renderer | optional | canonical YAML 是唯一机器 SSOT；投影 MUST 零新设计事实，MUST NOT 反向覆盖 YAML；宿主可在其后附加 CU/spec 施工附件，但附件 MUST NOT 成为部件内设计的事实来源 | 宿主未接该接缝 → 诚实降级（无人读投影），核心蓝图链不受影响，不得宣称已归档 | 投影内容契约稳定；同一 revision 重算字节确定性一致 | 清理投影副本；canonical YAML 与 revision 历史保留 | 投影包含 canonical 中不存在的设计事实 → 校验失败；同一 revision 出现两份内容不同的投影 → fail-closed |
| blueprint-review feedback | `{feedback_id,kind,source_revision,authority?,decision?,evidence_refs?}`，`kind` ∈ `opinion \| fact_supplement \| suggestion \| authoritative_ruling` | 宿主 → Maison | 既有 P1 reconciliation | 宿主评审系统/评审人 adapter | optional | 只有同时具备 `authority`（有权 owner 标识）、`source_revision`（指向被评审的 revision）与明确 `decision` 语义的 `authoritative_ruling` 才 MAY 进入 `decided_with_authority`；其余三类只能记为意见/事实补充/建议。批次身份（`blueprint_id` **与** `component_id`）与目标蓝图不一致 MUST fail-closed | 无反馈 → 蓝图保持当前 revision，不得自我升格 | 更换评审系统不改变四类分类与 authority 门槛 | 清理未接受反馈；已生成的 revision 与 provenance 保留 | authority 不足却声称裁决、`source_revision` 不指向已存在 revision、批次身份不一致、或试图回写旧 revision → fail-closed。intake 本身 MUST NOT 自动接受任何反馈、MUST NOT 改写任何 revision；**被接受后**，授权裁决与事实补充都落在既有 P1「新事实、权威裁决 MUST 生成新 revision」覆盖面内，MUST 经既有 reconciliation 生成**新** revision；意见与建议 MUST NOT 触发 revision 递进 |

**发布态机器契约 SSOT 与验证入口**（三者 MUST 在发布件内点名落地，MUST NOT 只存在于 dev-only OpenSpec；MUST NOT 新增顶层 CLI）：

| 接缝 | 发布件内 SSOT | 验证入口 |
|---|---|---|
| requirement-source materialization | `harness/schemas/requirement-source-materialization.schema.json`（宿主可读的镜像；**字段语义权威**是 `app-component-blueprint.schema.json#/$defs/currentScopeItem`，校验判据复用 P1 的 current-scope helper，不复制出第二套可漂移语义） | `check:component-blueprint` 既有 CLI 的材料校验模式（`--materialization <path>`）；**该模式 MUST NOT 要求 canonical blueprint 已存在**（物化在建蓝图之前）；解析复用既有 `resolveCurrentScopeSource`，不造 resolver 副本 |
| blueprint-review publication | **复用既有** `harness/schemas/app-component-blueprint.schema.json` + 确定性 `harness/scripts/utils/blueprint-review-projection.ts` renderer | `check:component-blueprint` 既有 `derived_from`/投影一致性校验（`--projection <path>`）；MUST NOT 新建平行 publication schema |
| blueprint-review feedback | `harness/schemas/blueprint-review-feedback.schema.json`（四类分类、authority、source revision、决策语义） | reconciliation intake 校验挂 `check:component-blueprint` 既有入口（`--feedback <path>`） |

三者的随包有效/无效样例 MUST 位于发布件包含路径（`docs/operations/`），MUST NOT 放在被排除的 `harness/tests/**`，并 MUST 被仓内单测经上述**同一正式 checker** 验证正例通过、反例失败。

#### Scenario: Materialization runs before any blueprint exists

- **WHEN** 一项新的正式需求刚物化来源材料，工作区内**还没有** canonical blueprint
- **THEN** `--materialization` 模式 MUST 独立完成校验并给出结论，MUST NOT 因 `component_blueprint_missing` 前置失败——编排顺序是「物化 → 建蓝图」；`--projection` / `--feedback` / `--ref` 模式仍 MUST 要求蓝图存在

#### Scenario: Materialized source revision disagrees with its provenance

- **WHEN** 某条物化材料同时声明 `source_revision` 与 `provenance.source_revision` 且两者不一致
- **THEN** 校验 MUST 失败并同时报告两值——该判据与 P1 current-scope 校验共用同一实现，两侧不得漂移

#### Scenario: Feedback component identity disagrees

- **WHEN** 一批反馈的 `component_id` 与目标蓝图不一致
- **THEN** intake MUST fail-closed 并报告双方；该批次 MUST NOT 产出任何可进入 `decided_with_authority` 的裁决

#### Scenario: Inline requirement input needs no provider manifest

- **WHEN** 一项小型正式需求由人直接给出需求文本并落到项目内文件，没有宿主 provider 参与
- **THEN** blueprint builder MUST 可以把它直接规范化为同一 `currentScopeItem`（带项目内 `source_ref`、原始字节 hash、provenance、authority），MUST NOT 因为"没有 materialization JSON"而阻塞；该 item 仍 MUST 通过与文件接缝完全相同的 current-scope 校验

#### Scenario: Required materialization is missing

- **WHEN** 一项正式需求进入蓝图，但宿主未物化任何可解析来源材料
- **THEN** 必须形成结构化 blocker 并列出 owner 与解除条件，不得凭转述补造 `current_scope_items`

#### Scenario: Materialized source hash conflicts with actual bytes

- **WHEN** materialization 输入声明的 `source_sha256` 与项目内该文件的实际原始字节不一致
- **THEN** 校验必须 fail-closed 并同时报告声明值与实际值，不得按任一侧静默取胜

#### Scenario: Publication tries to add a design fact

- **WHEN** 评审投影包含 canonical 蓝图中不存在的设计事实
- **THEN** 投影一致性校验必须失败；宿主附件不得成为部件内设计的事实来源

#### Scenario: Feedback without authority cannot rule

- **WHEN** 一条反馈声称 `authoritative_ruling`，却缺 `authority`、缺 `source_revision` 或没有明确决策语义
- **THEN** intake 校验必须拒绝它进入 `decided_with_authority`，只能记为意见/建议

#### Scenario: Authorized feedback produces a new revision

- **WHEN** 一条合法 `authoritative_ruling` 被接受
- **THEN** 调和必须生成新的蓝图 revision 并按既有规则把受影响 P1 派生结论标 stale；试图回写被引用的旧 revision 必须失败

#### Scenario: Publication and feedback are not merged

- **WHEN** 某实现用同一个 provider 同时输出评审投影并接收评审反馈
- **THEN** 违反本契约——两条接缝方向相反、owner 不同，必须独立

> **Enforced by (P1 implementation):** `harness/schemas/requirement-source-materialization.schema.json`, `harness/schemas/blueprint-review-feedback.schema.json`, `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-host-seams.ts`, `harness/scripts/utils/blueprint-review-projection.ts`, `docs/operations/component-design-host-adaptation.md`

### Requirement: One component design entry continues from existing artifacts

/component-design MUST 创建或继续同一演进工作区的部件设计，依据用户请求与现有产物从未完成步骤继续，不新增模式、状态机或隐藏 Skill 注册机制。只读请求 MUST NOT 修改 canonical 设计；仅重入、查看、重跑 checker MUST NOT 增加 revision。新事实、被接受的权威裁决或冲突解决 MUST 按既有 reconciliation 形成正式修订；意见、建议及未接受反馈 MUST NOT 自动升 revision。P1 协议、三条宿主接缝及 e4/b9 的蓝图、CU/Feature/review/Story 消费链 MUST 保留。

#### Scenario: Reenter or inspect an existing design

- **WHEN** 用户查看、检查、质询或局部修改既有设计
- **THEN** 入口只完成所请求的步骤；草稿未 admitted 时继续设计与质询，仅重入或只读检查不改变 canonical 字节或 revision，不强制分解或交接

#### Scenario: Finish handoff with zero or existing change units

- **WHEN** 用户要求完成设计交接，蓝图已 admitted
- **THEN** 0 CU 时调用既有 P2 设计准备与 consumer validator 首次生成 1..N canonical CU；已有 CU 时复用并派生 design_refs/readiness，不重复接受；修订走既有 superseding 规则
- **AND** 完整交接仍要求 admitted 蓝图、1..N canonical CU、design_refs 与 readiness，局部操作完成不冒充交接完成，不选择 CU、不启动 Goal Mode/P3

#### Scenario: Install and update expose only the unified entry

- **WHEN** 安装或 UPDATE 物化各 adapter
- **THEN** 新产物只公开 /component-design；旧入口清理复用 cleanup-deprecated、LEGACY_SKILL_BRIDGE_IDS 和 adapter deprecated_artifacts，覆盖 Cursor command/Skill、Claude/Codeagent command、Codex/Chrys/OpenCode 原生 Skill 目录与 generic 配置 bundle 路径，先备份再删除明确旧路径，保留统一入口和无关用户内容
- **AND** 用户跳过清理时 MUST 披露旧入口仍保留，不宣称清理完成

> **Enforced by:** `skills/project/component-design/SKILL.md`, `skills/reference/app-component-blueprint-workflow.md`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/utils/legacy-skill-bridge-cleanup.ts`, `agents/cursor/adapter.yaml`, existing entry/update/handoff unit tests
