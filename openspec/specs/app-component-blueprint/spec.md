# app-component-blueprint Specification

## Purpose
定义 App 部件发现、适配 4+1 蓝图、证据驱动质询、设计准入、运行时数据流与调和契约；统一部件设计入口、宿主接缝以及工程惯例和组件资产的消费，保持既有 provider/provenance 协议与下游 CU、closure 的权责边界。
## Requirements
### Requirement: P1 exposes conventions through the existing provider and provenance protocol

Every P1 blueprint MUST contain exactly one static optional `conventions-knowledge` Seam Card in the existing `providers[]` protocol with frozen authority and source rules. If the default path is not explicitly configured and its file is absent, the card MUST state `available: false` and `missing_disposition: not_applicable`. If `paths.conventions` is explicitly configured but the file is missing or unreadable, the card MUST state `available: false` and `missing_disposition: unknown|degraded`; it MUST NOT state `not_applicable` or claim conventions were consumed. A readable file MUST be read in full, while only applicable ids are represented as existing `discovery.facts` with `provenance.source_kind: convention`, `<configured-path>#<id>` source refs and authoritative evidence strength. Nodes and decisions MUST reuse existing provenance or verification refs; no conventions-specific blueprint field is permitted.

The static Seam Card freezes `authority_rule` as `Project conventions are stable knowledge input, not current-code authority.` and `source_rule` as `Applicable facts cite the configured conventions file and exact heading id.` Its definition is applicable project conventions; consumers are the blueprint builder, App lens and independent questioning; provider is the static conventions reader; requirement is optional. Replacement preserves the existing fact/provenance protocol and stales affected P1 results; exit drops temporary reads but retains canonical provenance; conflicts retain both refs and do not override current code authority.

#### Scenario: Project has not enabled conventions

- **WHEN** the default conventions path is absent and was not explicitly configured
- **THEN** provider validation SHALL require the `conventions-knowledge` card and accept only an honest unavailable `not_applicable` result

#### Scenario: Default conventions file exists but cannot be read

- **WHEN** reading the default conventions file fails with EACCES or another non-absence error, without explicit path configuration
- **THEN** the provider SHALL remain unavailable with `unknown|degraded`; `not_applicable` SHALL be rejected because a read failure is not evidence of disabled conventions

#### Scenario: Convention fact cites the wrong file or an unknown id

- **WHEN** a convention fact's source ref does not match the configured conventions file and one of its existing level-two heading ids
- **THEN** P1 SHALL reject the fact at the first consumption point using the existing heading parser

#### Scenario: Node or decision convention reference has no corresponding fact

- **WHEN** a node or decision cites a convention through provenance or a configured-conventions verification ref without the same source ref in a convention discovery fact
- **THEN** P1 SHALL reject that orphan reference, including when the conventions file is absent; downstream projections and CU review SHALL continue consuming the validated fact set, not a second reference protocol

#### Scenario: Explicit path cannot be read

- **WHEN** `paths.conventions` is explicitly configured but the file cannot be read
- **THEN** provider validation SHALL reject `available: true` and `missing_disposition: not_applicable`, accepting only `unknown|degraded`

#### Scenario: Convention informs a design decision

- **WHEN** an applicable card constrains the component design
- **THEN** the blueprint MUST cite the same configured-path/id source ref through existing fact and decision provenance without adding another schema field

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-provider-boundary.ts`, `harness/scripts/utils/blueprint-discovery.ts`, `harness/scripts/check-component-blueprint.ts`, `skills/project/component-design/SKILL.md`, `skills/reference/app-component-blueprint-workflow.md`

### Requirement: Review projection publishes adopted convention refs without new facts

The existing deterministic blueprint review renderer SHALL emit the convention id and source ref for every convention fact actually adopted by the canonical blueprint. Projection validation MUST continue to prove that all emitted entries derive from the selected canonical revision; the projection MUST NOT introduce a convention, applicability decision or design fact absent from canonical facts/provenance.

#### Scenario: Canonical blueprint adopts one convention

- **WHEN** one canonical discovery fact has `source_kind: convention` and a valid source ref
- **THEN** the review projection SHALL list that id and source ref and pass the existing `--projection` validation

#### Scenario: Projection invents a convention

- **WHEN** a review projection lists a convention source ref absent from canonical facts
- **THEN** the existing projection consistency check SHALL fail closed

> **Enforced by (P1 implementation):** `harness/scripts/utils/blueprint-review-projection.ts`, `harness/scripts/check-component-blueprint.ts`, `docs/operations/samples/blueprint-review-projection.valid.md`

### Requirement: App lens owns component asset decisions through the existing protocol

The App lens MUST read index/catalog and live candidate usage when development or UI-related logical/scenarios views are changed. Each page/UI development target SHALL have one flat existing decision subtype kind=component_asset_selection, target_ref=view:development/node:<id>, asset_resolution reuse|configure|adapt|evolve|custom, component_ref required for non-custom and rationale required for adapt/evolve/custom, with existing owner/provenance/verification_refs/status. provenance.source_ref denotes index/catalog evidence, not the selected ID. The existing decision validator SHALL enforce conditional fields. A verified_unchanged development view MUST NOT emit asset selection decisions. New dependency edges require authorized disposition or controlled open_decision/blocker before current CU admission.

#### Scenario: Incomplete decision or unchanged mask
- **WHEN** a selection decision misses a required field or targets a verified_unchanged development view
- **THEN** blueprint validation SHALL reject it, using unchanged_masks_change for the latter

#### Scenario: Referenced asset evidence is unreadable
- **WHEN** a selection decision cites the configured index or catalog but that particular file cannot be read
- **THEN** blueprint validation SHALL reject the decision; an unreferenced optional catalog may remain missing, with no added fragment resolver or hash-binding protocol

> **Enforced by:** `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/utils/blueprint-evolution-decisions.ts`, `skills/reference/app-component-blueprint-workflow.md`, `skills/project/component-design/SKILL.md`

### Requirement: Static optional component-assets seam reports honest availability

Every blueprint MUST have one static optional component-assets Seam Card in the existing provider rules table. Frozen authority_rule is `Source is component fact authority; curation is human selection guidance.` and source_rule is `Selection evidence cites the configured component index or catalog; component_ref identifies the asset.` Index absence MUST NOT claim available=true or emit selections. No UI dimension permits not_applicable; UI dimension requires unknown|degraded and an unknown gap with owner/needed_by/unlock_condition. Future slices may use open_decision; current-slice dependency MUST use blocker through existing admission rules. No registry or additional state is permitted.

#### Scenario: UI asset unavailable
- **WHEN** UI targets exist and no index is readable
- **THEN** provider validation SHALL reject available=true or not_applicable, require a controlled gap, and existing admission SHALL reject a current-slice open_decision

#### Scenario: Optional seam omitted
- **WHEN** the component-assets card is missing
- **THEN** the same provider validator SHALL reject the blueprint

#### Scenario: A correctly labeled current asset blocker still forbids construction
- **WHEN** an unresolved component-assets gap has needed_by equal to the current slice and status blocker
- **THEN** the existing admission validator SHALL derive an actual BLOCKER issue and the existing CU design gate SHALL reject construction even when the admission status is also blocker; a controlled future open_decision remains constructable

> **Enforced by:** `harness/scripts/utils/blueprint-provider-boundary.ts`, `harness/scripts/utils/blueprint-admission.ts`, `skills/reference/app-component-blueprint-workflow.md`

### Requirement: Review publication retains the canonical asset choice

The same review renderer SHALL emit target_ref, asset_resolution, component_ref and rationale for component_asset_selection decisions. Existing --projection validation SHALL reject any changed or invented selection and MUST NOT create a second publication schema.

#### Scenario: Published selection changes
- **WHEN** the review projection alters reuse into custom
- **THEN** canonical projection validation SHALL fail

> **Enforced by:** `harness/scripts/utils/blueprint-review-projection.ts`, `harness/scripts/check-component-blueprint.ts`

### Requirement: Discovery preserves authority and provenance

App 部件发现 MUST 为每个当前态断言、设计输入、冲突和 unknown 记录 `source_kind`、可解析的 `source_ref`、可得的版本或 hash、证据强度、观测时间/轮次、抽取方式和 provenance。代码、schema、接口、配置、测试等当前事实优先于文档宣称；SE 或其它有权 owner 提供的外部契约优先于模型推断。根与 discovery 的 `source_fingerprint` MUST 只从规范化 discovery facts、`discovery.inputs.current_scope_items` 及其 source/provenance/revision/hash 确定性重算并一致，不得接受编写方自报，也不得包含 requirement→blueprint 设计映射。证据不足的内容 MUST 原样保留为 `unknown`，发现器 MUST NOT 用常识补齐或静默选择冲突来源。

既有 discovery/人工权威输入 MUST 在 `discovery.inputs.current_scope_items` 中提供当前范围 `requirement|goal|invariant|high_risk` 的闭集；每项 MUST 包含稳定 `item_id`、kind、project-safe 且可解析到精确来源/fragment 的 `source_ref`，并为项目内文件绑定实际原始字节的 `source_sha256`；`source_revision` MAY 作为额外来源版本，但不能替代内容 hash。`discovery.requirement_traceability` MUST 使用相同 `item_id` 与该输入清单双向一一覆盖，并为每项提供一个或多个指向同一 canonical blueprint 真实稳定地址的 mappings。traceability mappings MUST NOT 进入 `source_fingerprint`；mapping 变化 MUST 通过既有 blueprint `revision`、完整 artifact `artifact_sha256` 以及下游 P3 `input_fingerprint` 捕获，不得新增 `traceability_fingerprint`。重复 ID、来源缺失/越界/无法解析、hash 缺失或不符、任一输入无 traceability、额外 traceability、空 mappings、悬空地址或跨 component 地址 MUST 阻塞 P1 admission。该结构只登记已由现有输入识别的当前范围；非结构化材料若没有机器稳定 ID，既有人工权威输入 MUST 先提供稳定 item/source-fragment identity，不要求 P1/P3 建设通用 PRD 解析器、目录扫描器或来源注册表。

#### Scenario: Code fact conflicts with a document claim

- **WHEN** 文档声称某状态由模块 A 持有，但代码、schema 或测试事实显示模块 B 是实际 owner
- **THEN** 蓝图必须以可追溯代码事实为当前态依据，报告冲突双方和责任 owner，且不得把文档宣称写成已确认设计

#### Scenario: An external contract source is unavailable

- **WHEN** 蓝图需要云侧 operation 的 DTO 语义，但唯一权威来源不可访问
- **THEN** 相关字段保持 `unknown`，并形成带来源、owner 和解除条件的 `open_decision` 或 `blocker`，不得生成已批准的 request/response

#### Scenario: A current requirement source is missing

- **WHEN** current-scope traceability 声明 `requirements/ledger.md`，但该路径不能通过项目安全路径解析或文件不存在
- **THEN** P1 admission MUST block，并保留 requirement ID、source ref、owner 和解除条件；不得把未读取的需求视为已覆盖

#### Scenario: A current requirement has no blueprint mapping

- **WHEN** `discovery.inputs.current_scope_items` 中一个已识别的 requirement/goal/invariant/high-risk 没有对应 traceability，或没有映射到任何真实 blueprint stable address
- **THEN** P1 MUST 拒绝蓝图完整性结论并要求补齐设计映射，P3 不得自行选择映射

#### Scenario: Only a design mapping changes

- **WHEN** current-scope source items and discovery facts remain byte-equivalent but a requirement is remapped to a corrected blueprint stable address
- **THEN** `source_fingerprint` MUST remain unchanged while blueprint `revision` and `artifact_sha256` change, causing the old P3 `input_fingerprint` to become stale

> **Enforced by (P1 implementation):** `skills/reference/app-component-blueprint-workflow.md`, `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/check-component-blueprint.ts`, `harness/scripts/utils/blueprint-discovery.ts`, `harness/scripts/utils/blueprint-provenance.ts`

### Requirement: Viewpoint contracts and App view instances are separate

蓝图 MUST 区分可复用的 `viewpoint contract` 与某次蓝图的 `view instance`。同一蓝图内的 view id MUST 稳定使用 `logical`、`runtime`、`development`、`deployment`、`scenarios`；`logical`、`development`、`scenarios` 必需，可执行 App 的 `runtime` 必需，`deployment` MUST 按部件固有的平台、进程、独立持久化、外部边界和运行拓扑裁决，不随单次需求切换适用性。五个 view MUST 是同一蓝图的观察面，不得生成五份独立真源。

适用 deployment 时，所有 scenario（包括纯本地场景）的 `deployment_refs` MUST 指向本部件自己的实际运行节点，外部节点 MUST NOT 替代本部件落点。外部参与方节点 MUST 只记录当前事实，`current_state = target_state` 且无本次 delta；根级 contracts MUST 只登记本部件实际消费或提供的接口，由消费该契约的 CU 经 `design_refs` 认领本部件侧证据，指向外部节点的 relation 同样 MUST 由该 CU 引用。外部方自己的施工中本部件不消费的部分，阻挡当前切片时 MUST 复用 gap 与 CU blocker 表达解除条件，其余 MAY 用 `coordination/rollout` 说明，MUST NOT 建根级 contract 或让本部件 CU 虚假认领。rollout MUST NOT 自动成为 CU `requires` 或执行授权。

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

- **WHEN** 核对目标部件固有的平台、进程、独立持久化和外部边界后，运行拓扑证据支持 deployment 不适用
- **THEN** 蓝图必须保留 `deployment` 的适用性裁决、证据和 `not_applicable` disposition，不得仅因“单部件”省略该视图；该视图不得携带 `evolution_impact`

#### Scenario: External rollout remains context while the component owns its side

- **WHEN** 本部件实际消费一个外部服务接口，外部服务还有本部件不消费的独立上线施工
- **THEN** 外部节点 MUST 保持当前事实，本侧契约与指向它的 relation MUST 被消费 CU 认领；外部独立施工只作为 gap/blocker 或协同说明，不产生无人认领的根契约施工义务
- **AND** 适用 deployment 的纯本地场景仍 MUST 引用本部件实际运行节点并接受已有跨视图检查与独立质询

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

完整设计交接 MUST 默认生成并链接蓝图同目录 `component-blueprint.review.md`。canonical 蓝图/CU 内容修改后 MUST 在本次调用结束前重建，覆盖草稿、质询写回与局部修改。设计 owner、App lens 和独立质询 MUST 沿同一蓝图形成可评审的 4+1：场景与旅程、逻辑边界/模型/接口、运行顺序/分支/失败恢复、开发目录/文件/组件/持久化、适用部署落点及外部配套；并说明背景、目标/成功衡量、范围/非范围、选择/被否方案、质量/数据生命周期和 AC/BD/NFR。设计 MUST 能回答需求/范围、当前问题、工作方案、模块责任、选择依据、分步交付与安全中间态、风险验收七问，MUST NOT 以一段 summary、标题齐全或行数代替真实设计细节。

设计期 MUST 在将被 CU 引用的 canonical 目标上写入已有 `acceptance`、`contracts`、`use_cases` 结构，保持既有 provenance 权威、类型/版本与检查；spec/plan MUST 直接消费已有 typed 投影，只补本职责未声明的内容。无 ui-spec 依据时，P0 真机条目 MUST 保留 ID、优先级、步骤、预期、分层与 focus，MUST NOT 编造 linked_flow、checkpoint、屏幕流程或元素 ID；spec 得到真实 UI 依据后 MAY 只补未声明键，MUST 保留原权威预期并通过原对齐与 P0 检查。缺 typed 内容的存量蓝图 MUST 如实显示“设计期未写入，将由 spec/plan 补”，MUST NOT 因本批缺字段新增机器门禁或强制迁移合法手写产物。

写作 SHALL 用 review_summary.title 表达可读需求标题，summary 说明本次改变；原字段已可读 SHALL 直接使用，仅改表达 SHALL 优先使用唯一可选 review_summary.reader_guide，MUST NOT 强制各小节另建 guide、复制权威明细或由 renderer 造事实。修改原字段仍属于设计修订，会使说明摘要过期，也可能改变整蓝图引用的 CU 摘要。通用决策获准选择写 conclusion，rationale 只解释原因，特定 kind 保留自身结论字段。term.value.meaning SHALL 由 glossary 已有说明结合需求语境提炼，sample_usage SHALL 仅作示例消歧而非机械当定义；模型字段 description SHALL 依已消费来源写入。App 根问题及独立质询的回答、问题和结论 SHALL 使用中文，保留 API/类型/路径原名。

设计 owner、App lens 与独立质询 SHALL 在原问题/scope 内逐项核真实设计深度：根 contracts[].table_schema 的表/列/约束结合 data_domains.security 与既有叙述说明实际库名/版本、安全级别/是否加密、主键唯一、升级和敏感字段；真实依赖失败与用户中断先核已有 boundaries/failure_recovery、真实缺失才补，mock SHALL NOT 编外部故障/新业务；约定错误、幂等键与范围，以及涉及跨会话重复卡时的策略/主键 SHALL 明确；现有 quality_attributes SHALL 对兼容、安全隐私、UX 深浅色/无障碍、打点、性能给实际结论，不涉及给理由，不凑量化阈值。此为写作/质询要求，MUST NOT 新增数据库配置字段、requiredQuestioningScopes 项或机器阻断，MUST NOT 降级既有 typed/来源/授权检查。当前时序效果由用户在原工作区定向补设计后实读，保留其它有效设计；隔离重渲染不证明写作充分。

renderer SHALL 用专用格式展示 publications.payload/timing、consumers.handling（原 consumption 仍保留）、failure_recovery.handling/retry、根 contracts[].table_schema 及原约束/默认值，多键同时存在 MUST NOT 丢一侧。table_schema SHALL 保留现有单表与库级 tables[] 双形状、列 description、库名/版本/安全/加密、主键/约束/升级/来源，内容约定以 docs/concepts/blueprint-design-inputs.md 为准，不新建字段/schema。所有单元格 SHALL 共用取值规则，string/number/bool/list 保真，false/0 非空，显式空对象/数组为“无”，只有来源键的对象才称“仅来源信息”；直接数组及业务对象的数组值 SHALL 支持一层扁平记录：业务键值为字符串、数字、布尔值或 null 时，按原顺序逐项展示“键：值”并清楚分隔记录。含更深对象/数组的成员 SHALL 仅自身保留占位，同数组其它扁平成员 MUST NOT 隐藏；MUST NOT 递归展开或为 errors 新增字段别名。标量数组、显式空字符串、null、空集合及原 Markdown 转义/链接保护 SHALL 保持。深层声明未展开 SHALL 如实说明范围，有值 MUST NOT 假报未记录。缺项汇总 SHALL 只处理 renderer 标记，MUST NOT 改作者标题/正文。机制元数据按所在结构排除，来源/验证引用保留；陌生业务键只一层键值，不递归 dump。布尔含义列 SHALL 显示是/否，框架枚举只在消费字段中文化，未知值、业务状态、API/类型原样保留。用例新写 expected_port_calls，旧 expected_boundary_calls SHALL 由同一加载/归一化内核兼容；两键冲突 SHALL 披露且不得静默丢失。

canonical 设计对象在根 contracts[].table_schema 以外的位置声明 table_schema 时，既有展示诊断 SHALL 仅以 WARN 报告实际路径及已发布的正确承载位置。合法根级单表/库级双形状 SHALL 不报错位，未声明 SHALL 不报缺失，说明/引用/代码字符串中的同名词 MUST NOT 误报。该诊断 MUST NOT 自动移动/复制/改写数据、兼容节点挂载、猜别名、扩 schema 或改变 admission/readiness；其它独立 BLOCKER SHALL 保持原行为。

当前 CU 的精确绑定与合法 supersedes 历史 SHALL 分开判定：精确退役关系成立时，前身旧蓝图指针不能中立展开 SHALL 仅表示不能证明等价，不隐藏当前合并集合、不把退役 pending 混入当前 publication sourceGaps。坏 hash、缺前身、断链或当前坏 ref SHALL 继续披露，不重写历史指针或新增快照仓库。

以下六类保留原对象的可选表达，数组 MAY 为空；真正缺失 MUST 每节一行集中说明，明确未知、明确不适用与缺失 MUST 分开，空值 MUST NOT 推不适用，MUST NOT 产表头空表/整空列。存在但形状错误 MUST 由现有 validator 给出带位置/原因的 WARN，MUST NOT 经 schema、CU sourceGaps 或 readiness 间接阻断；蓝图 schema MUST 保持不变，既有强契约检查 MUST NOT 降级：

| 位置 | 可选形状 |
| --- | --- |
| review_summary | background/problem/positioning: string；goals: [{goal_id: string, statement: string, success_measures: string[]}]；in_scope/non_goals: string[] |
| decision | alternatives: [{option: string, rejected_reason: string, defect: string}]，只说明被否方案 |
| term: fact 的 value | meaning: string，复用已消费 glossary 定义 |
| scenarios 节点 | journey_steps: [{step_id: string, stage: string, user_action: string, system_behavior: string, preconditions: string[]}]；path_variants: [{user_type: string, difference: string}] |
| deployment 节点/视图 | 节点 responsibilities/inputs/outputs/not_responsible_for: string[]、failure_impact: string；视图 rollout: [{order: number, unit: string, depends_on: string[], note: string}]、coordination: [{counterpart: string, relation: string}] |
| 蓝图根 | quality_attributes: [{qa_id: string, category: string, requirement: string, landing: string, source_ref: string, verification_refs: string[]}]；data_domains: [{data_domain_id: string, usage: string, retention: string, isolation: string, cleanup: string, security: string}] |

flow 的 data_domain_refs MUST 复用同一标识，精确质量阈值/预期 MUST 留在已有 acceptance，不另维护 NFR 真源。`contracts.data_models[].fields[]` MAY 携带可选字符串 description/source_ref，现有加载/投影 MUST 透传；展示 SHALL 保留有值事实，真实非法形状如实诊断，MUST NOT 新增 schema/validator。所有新增 source_ref MUST 只引用设计期已有来源，MUST NOT 把未来施工文件当输入或授予写权限。本批 MUST NOT 新建独立文档权威、artifact/协议、审批门禁或代码骨架；完整时序 SHALL 使用下述既有字段与派生图流程。

完整调用 SHALL 在 runtime flow 承载的 contracts.state_management[].ordered_steps（string[]）逐条写明 caller/callee/操作、参数/结果、等待/回调、条件、失败与完成返回，typed components/interfaces/data_models 与根 operation/DTO/errors/idempotency/table_schema、flow 恢复及用例 SHALL 提供同源细节。设计 agent SHALL 同次生成已有 generated_graphs sequenceDiagram，既有 runtime/flow 独立质询 SHALL 逐段核图文调用者、参数、返回、分支及完成/导航/消费者一致；语法通过 MUST NOT 代替语义核对。保留 flow.ordered_steps 时 SHALL 同次同步；renderer MUST NOT 从 user_sequence、expected_port_calls、方法同名或目录猜 caller/交错关系。缺图 MUST NOT 新增门禁，也 MUST NOT 声称此项人读已完整。

文档 MUST 只读取 canonical 蓝图/CU，逐 CU 与生产投影共用纯目标选取/合并逻辑保留实际继承范围及冲突。正文 SHALL 按方案摘要、背景/目标/边界、术语、用户旅程与界面、整体方案、关键流程、数据与存储、关键取舍、失败与恢复、质量与安全、施工与上线、验收、待补问题组织，MAY 省略无意义空小节；4+1 SHALL 继续建模/质询，并在参考给章节对照。完整字段/类型、接口/存储、AC/BD/NFR、用例分支、施工精确映射、需求追溯及质询/稳定地址 SHALL 留同文档参考。验收身份 SHALL 为“来源目标 + 条目编号”，不同目标各自 AC-1 MUST 保留；正文验收主题与 CU 编号/链接 SHALL 保留精确范围。身份/准入/来源/机制说明 SHALL 集中参考入口，说明缺失/过期提示 MUST 在文首可见。可读标签优先已有 label/name/含义、缺时短 ID，锚点/链接目标 MUST 保留。框架状态枚举 SHALL 用中文，API/类型/自由业务状态名 MAY 保原名，不凭名称补业务结论。MUST NOT 读取 Feature use-cases.yaml、需求原文或外部 catalog 反向设计、运行完整投影门或按 predicate/touches 估算集合。待升版 CU MUST 保留自身施工契约，合并集合标“待指针升版后显示”；canonical 无法独立确定架构相关集合时 MAY 省略中立摘要并保留精确绑定，不新增来源缺口、不宣称 carry-forward。

正文 SHALL 优先放有效作者说明、按同位置配当前事实及图像，MUST NOT 重复 summary。技术参考 MUST 用已有专用字段/枚举/接口/步骤/分支/异常/验收格式保留精确内容，不递归 dump 原始对象或调用模型重造明细。目录树 SHALL 合并公共前缀并可还原所有精确 files 路径；用途仅取已有组件说明或链接接口明细，MUST NOT 从目录推新责任或扩授权。跨视图图 SHALL 只用 canonical relations；运行阶段节点 SHALL 取 state_model.phases，边只各 branch.expected_phase_seq 相邻项，按起止对去重保留全部分支来源，首分支仅具名作基准、不得假定 Success 包含完成链；模块依赖图 SHALL 只取 contracts 根级 module_dependencies，声明模块补层级/变化、其它仅名称，不合成冲突并集。三类图 SHALL 复用 flowchart/parser、逐边追真实来源，MUST NOT 按 phases 排列造边或把模块/状态名伪装稳定地址。结构图仍限显式关系、完整地址区分端点；有效图 SHALL 就近呈现，同图首次引用绘制、后续引用保留图名回链，MUST NOT 静默丢弃引用或新增章节优先级；坏图/过期图回链 SHALL 指向原位说明，无效图不展示且披露原因，时序图诊断级别按下述 Graph validation。

同源 DTO/模型 SHALL 核字段/语义/约束/来源后复用，required/nullable 独立、差异保留，MUST NOT 同名判等；UI、完全相同恢复、验收全文与完整 files SHALL 只主责处完整展示、其它链接，保留每 CU 精确范围和多源关联，MUST NOT 用 touches 代 files 或全局删同值列。指定说明列仅至少三行内容/链接全同时 MAY 提表前。页面清单 SHALL 取 components.kind/useCases.ui_bindings，集中截图每张一次、其它链接；journey_steps 去向文本保留，MUST NOT 推导航路由。renderer 只输出登记图片引用，外部图片字节 MUST NOT 成为设计/绑定输入。隔离 A SHALL 保 canonical/CU/图片原样、只验展示；B SHALL 另存明确补 ordered_steps/派生图的设计变体验证生成/质询/实际预览，不混入 A、不声称原样无数据凭空四图。前轮隔离与用户实读通过记录 SHALL 保留；本轮真实回归 SHALL 由用户在 SimulatedWalletForHmos-br 干净基线上沿相同话术及任务边界从需求开始，原设计 agent 同次写设计与说明、先草稿后质询并一轮修订后重渲，MUST NOT 用单独写作 agent 样稿代替默认路径验收或修改当前宿主稿；设计专项不代替端到端施工。readiness/run/完成状态 MUST 独立。

蓝图 checker SHALL 与原消费入口共用只依赖条目自身的 acceptance/contracts/use_cases 内容及 SpecLoader 形状规则，在 `--write-review --json` 同轮以 WARN 输出 canonical 路径、实际缺键或形状原因，默认文本/JSON/评审参考 SHALL 同源；三类材料互不短路，同一物理路径不得因重复引用多报。作者 SHALL 沿既有一轮定向修订按已发布字段回原承载修正，未解决如实披露；MUST NOT 自动改 canonical、新增字段别名或由 renderer 补事实。原拆 CU、readiness 和阶段包装 SHALL 保留原 id、级别和责任，MUST NOT 因蓝图 WARN 降级原 BLOCKER。

该接点 MUST NOT 要求 CU/Feature、整图合并、授权判断、criteria/用例集合全局非空、跨条目冲突、引用解析或 CU/flow 映射；节点 typed contracts MUST NOT 与根 operation/DTO 契约混用。feature/source SHALL 由派生补写，schema_version MUST NOT 自动补默认值；最终 use-cases 产物 SHALL 有版本，合法分散片段 MAY 由其中一个提供，MUST NOT 逐片段强制。SpecLoader 集合及 state_management 子字段 SHALL 保持原形状及缺失/null 语义，MUST NOT 新增 data/holder 等必填，不为合法分散片段强求整份 Feature 产物。

蓝图 checker SHALL 沿现有可消费目标枚举 use_cases map 片段（包括根 blueprint 直接目标上的片段），同一对象去重；至少一个片段有非空用例条目数组且所有片段均未按原消费者有无判定提供 schema_version 时，SHALL 只报一条 WARN，定位首个含用例片段并说明整图扫描边界。无用例内容或任一片段供版本（含仅供合并的版本片段）SHALL 不报该 WARN；MUST NOT 将内层用例条目、说明/字符串或外部文件当作片段。该提醒 MUST NOT 调完整派生、构造 CU、读取 Feature、实现合并器或新增版本值/类型检查，也 MUST NOT 改变 admission/readiness 及原消费 id/级别；版本冲突与具体 CU 是否选择供版本片段 SHALL 留原消费链，零 WARN MUST NOT 等同每个 CU 可派生。[artifact schema](../../../specs/artifact-schemas/use-cases.schema.yaml) SHALL 只作为兼容身份/形状，作者 SHALL 按适用 profile 已发布的[业务 UT 用例模板](../../../profiles/hmos-app/skills/business-ut/templates/use-cases-schema.md)及原消费规则填写，写作指引 MUST NOT 写死版本值。

#### Scenario: Use case versions are certainly absent across the blueprint

- **WHEN** 蓝图含非空用例条目数组，且所有可消费片段（包括根 blueprint 直接目标）均缺 schema_version
- **THEN** 蓝图 checker SHALL 只在首个含用例片段报告一条定位明确的 WARN，默认文本/JSON/评审参考 SHALL 同源；原消费者的版本缺失 FAIL/BLOCKER SHALL 保持

#### Scenario: Empty designs and distributed version sources remain valid

- **WHEN** 蓝图无用例内容，或任一可消费片段已提供版本，包括只有版本而无用例的片段
- **THEN** 整图版本缺失 WARN SHALL 不出现，MUST NOT 逐片段要求版本、补默认值或将零 WARN 当作具体 CU 合并成功

#### Scenario: Existing item errors are visible before CU consumption

- **WHEN** canonical 目标的验收、类型契约或用例条目违反原消费者的条目自身规则
- **THEN** 蓝图 checker SHALL 在同轮给出路径/缺键 WARN，文档及其它材料检查继续；原消费阶段 SHALL 保留原级别，合法分散片段、缺派生身份及原规则通过的 state_management MUST NOT 被新增条件误报

#### Scenario: Draft and complete local delivery
- **WHEN** 当前 canonical 蓝图可解析但未准入，或完整设计交接完成
- **THEN** 本地投影 SHALL 可生成并如实显示准入与缺口，含仅定稿蓝图、尚无 CU 的供人评审交付；`--write-review --json` SHALL 分别报告 checker 与 review_document，checker FAIL/非零退出时文档仍可 current/refreshed。尚待质询的草稿 SHALL 可供阅读，MUST NOT 要求先通过含质询结果的完整准入；生成不得改变检查结论或吞掉真实解析/来源及其它 BLOCKER，也不证明准入通过，供人评审交付 MUST 链接当前文档

#### Scenario: Optional presentation fields do not become a new handoff gate

- **WHEN** 存量蓝图缺少六类可选字段，或其中字段形状错误
- **THEN** 文档 MUST 集中表达真正缺失，已有值和深层未展开声明不得假报未记录，形状错误只给 WARN；已有 typed 内容非法仍 MUST 经原 readiness 处理，不能被展示宽容豁免

#### Scenario: Canonical content controls the review document

- **WHEN** canonical 蓝图与 CU 字节未变，但 Feature use-cases.yaml 或需求原文改变
- **THEN** 文档字节与同源发布比对 MUST 保持不变；只读 readiness MUST 检查 canonical 设计来源，Feature 阶段用例对齐 MUST 留在 plan 原门，不能从文档生成成功推导交接通过

> **Enforced by:** skills/project/component-design/SKILL.md、skills/reference/app-component-blueprint-workflow.md、harness/scripts/check-component-blueprint.ts、harness/scripts/utils/blueprint-review-projection.ts

### Requirement: Reader-oriented narrative remains a non-authoritative explanation

原设计 owner SHALL 在同一设计任务先完成可渲染事实/图草稿与说明、复核并记录摘要，先 `--write-review --json` 生成草稿，再派已有独立质询，MUST NOT 默认另派专职写作 agent；仅补说明 SHALL 从已有 canonical 与登记材料继续，MUST NOT 为此重做产品源码发现或启动施工。可选 review_summary.reader_guide SHALL 包含 source_digest 与 sections；每节包含 section/title/prose/source_refs，MAY 包含 graph_ids。section SHALL 取 summary/background/terms/journey/solution/flows/data/decisions/recovery/quality/delivery/acceptance/questions，同位置按作者顺序讲述。原 summary 与 guide.summary MUST NOT 重复呈现。source_refs SHALL 是蓝图内 JSON Pointer，验收主题 MAY 引 acceptance 对象、三类数组或完整单项，以引用集合限定实际来源目标加编号并逐条建立链接、同项去重，MUST NOT 借未引用目标的同号条目补链接或要求逐 ID 堆来源；无效来源 SHALL 保留原诊断；graph_ids SHALL 仅引用已有 generated_graphs。prose SHALL 用段落/列表/代码名称，MUST NOT 维护另一套权威表、截图或 Mermaid；实际 Markdown 标题块 SHALL 降为加粗段落并给 WARN，代码块内 # MUST 保留。

实现时序 SHALL 按一个界面步骤或一次跨层交互拆图与说明，MUST NOT 将从入口到完成的全过程称为一件事；一次保存 MAY 跨页面、业务对象、Repository、实际 helper/数据库并完整返回，MUST NOT 按方法或 ordered_step 机械拆分。成功完成与失败退出 SHALL 分别解释，MAY 在同图用分支表示，MUST NOT 强求两张图。例子 SHALL 分为“打开验证码”“提交、保存并显示结果”“结果页点击完成后清栈、首页刷新”三个界面步骤，分别说明和配图，保存链本身不按层拆。调用返回 SHALL 指返回值或回调回到调用方，MUST NOT 包含用户之后点击完成引发的导航返回。保留真实调用返回、等待、分叉及段间交接，完整调用事实留原 ordered_steps 与参考。端到端 SHALL 仅用于用户旅程总览、角色关系图，不套用实现时序拆分要求，MUST NOT 将全过程实现时序改名总览来豁免。每段 SHALL 先导读再用既有 graph_ids 就近放图，generated_graphs/derived_results 继续为唯一派生图承载，不设数量硬门。作者 SHALL 在正常预览宽度实读，MUST NOT 把放大、图语法通过或生成成功当作可读验收。同图 SHALL 首次引用绘制、后续位置回链，不增章节优先级；图就近放在第4节本身 MUST NOT 被视为错误。普通正文汉字间、中文全角标点后的多余空格及成功衡量句末拼接 SHALL 由 renderer 统一处理，MUST NOT 依赖 YAML 字面块规避；代码、链接、URL、标识符间空格、原换行及 Markdown 硬换行 SHALL 保留，canonical MUST NOT 被改写。

决定与 generated_graphs SHALL 用现有 label 写中文名称，稳定 decision_id/graph_id MUST 保持；缺 label SHALL 沿既有回退，MUST NOT 自动翻译或新增缺 label 检查。App 根问题及独立质询回答 SHALL 使用中文，代码/API 名 MAY 保留。首屏 SHALL 向不了解项目代码的评审人说明现状、变化、用户结果与范围；产品非目标与本次只执行设计的阶段状态 SHALL 分开，摘要施工只链接第 11 节。第8节关键取舍 SHALL 固定为作者开场加 canonical 决策逐项呈现名称、选择、理由和已有被否方案，decisions guide MUST NOT 替代逐项内容或以决定编号串代替解释。组件选型无 label 时 SHALL 优先显示已解析 target_ref 节点的已有 label/name，缺时沿原名称/id 回退；SHALL 按[组件资产五级选型](../../../docs/concepts/component-assets.md#五级选型)显示中文，未知值保留。custom 无 component_ref SHALL 视为正常，不显示“组件：未记录”，已有引用保留；被否理由/缺陷同值 SHALL 只展示一次、异值分列或分行保留，避免“。；”拼接。所选方案代价 SHALL 仅展示已有来源，MUST NOT 从被否方案缺陷反推或为无 alternatives 的决定补造被否方案。参考 SHALL 只保留决策身份、来源、状态等元数据及正文回链，不重复决策正文。第13节待补问题 SHALL 在作者说明后固定展示当前 headless_assumed 术语、review_summary.must_review 及带真实状态的 gaps，MUST NOT 依赖作者重复登记术语，questions guide MUST NOT 遮蔽这些事实、把假定/未决说成已确认/已裁决或把已解决项冒充待处理，展示 MUST NOT 自动改变阻断级别。恢复速查 SHALL 用 guide.prose 的 Markdown 短表，每行对应实际 BD 编号和 source_refs，解释发生什么、用户看到什么、数据是否保存、如何继续；MUST NOT 改精确 BD 预期或补造行为，素材不足如实未定。

角色正文 SHALL 由设计 agent 从已有职责/状态/调用事实归纳，中文角色与消息意图在前，类名/方法必要时括注、完整方法目录留参考，目录 MUST NOT 冒充角色说明。接口映射 SHALL 与模型字段一致，不同图中的调用责任 SHALL 一致，由原作者与既有质询核源；本批 MUST NOT 新增机器语义检查。旅程总览和角色关系图 SHALL 默认绘制；只有一两步的简单旅程或一两个角色的简单协作 MAY 说明原因后省略对应总览，MUST NOT 实现机器计数门。两类图 SHALL 由作者按明确旅程顺序、原调用或责任关系写入既有 generated_graphs 并以 graph_ids 就近放置，MUST NOT 猜连线或混淆流转/调用/归属含义。组件职责 SHALL 在主责小节解释一次；界面有登记截图时 SHALL 各写 journey 小节，并以 source_refs 精确引用对应图片登记单项或只含该图路径的来源对象，图紧随说明、每图一次，MUST NOT 从名称猜图或新增图片字段。正文文件落点 SHALL 用单一目录树，CU 精确范围仍在参考可查；各节来源 SHALL 仅关联本节说法，正文设计依据聚合到该节完整来源参考入口，避免多个同名链接堆叠。

source_digest SHALL 以当前解析蓝图 stableStringify 与 SHA256 计算，只删除根 revision、derived_results 和 review_summary 内 reader_guide/authored_by/questioning/admission/reconciliation；其余事实、generated_graphs 实际内容、数组顺序 MUST 保留，MUST NOT 递归按同名键删除。独立只读 --reader-guide-digest SHALL 返回当前值（JSON 为 reader_guide_source_digest/canonical_path/artifact_sha256），MUST NOT 写文件、运行完整 validator、盖摘要或声称作者已读。作者完成必要改写并确认说明仍适用后 SHALL 记录摘要，再 --write-review --json 并实际打开草稿；质询后 SHALL 一轮定向修订，按来源变化复核摘要并在交付前重渲读成品。renderer/校验/自动物化 MUST NOT 代作者更新摘要。

无 guide SHALL 展示当前字段及完整参考、文首提示“尚未补写评审说明”；事实变化或摘要缺失/错误 SHALL 不展示旧解释、回退当前事实并提示“评审说明需更新”。个别坏小节/引用只诊断并跳过受影响部分，图仍沿自身 freshness。所有展示形状/引用诊断 SHALL 沿 WARN，MUST NOT 改 schema required/type、admission、readiness、run 或原操作结果。文档“当前”只证明忠实投影，MUST NOT 代替说明完整或阅读通过。

guide MUST NOT 固化 CU 数量/ID/修订/依赖；正文施工 SHALL 按当前有效 CU 原 purpose/目标/touches/requires/安全中间态展示。目的、交付和安全中间态 SHALL 在原 purpose、provides/target_predicates 的 description、safe_intermediate_state.description 用完整句子说明；纯润色保持职责含义、提供承诺、依赖、写集与身份，并沿现有未完成资格和 consumer 内容修订 API，MUST NOT 直接改 canonical 或为润色修订已完成/退役 CU。新建/修订/替代 CU SHALL 自动刷新施工段和参考，MUST NOT 要求回改蓝图说明。真实新事实 SHALL 先写原承载，MUST NOT 仅写 guide 或由 renderer 补造未知。

供人评审的蓝图交付（含仅定稿蓝图、尚无 CU）SHALL 将一次“先只读首屏复述现状/变化/结果/范围，再读正文答八问，最后按原 scope 定向核源”合并到已有独立质询，随后一轮定向修订并在交付前重渲，问题沿既有质询输出/报告记录；读者 MUST NOT 继承父上下文 YAML/设计摘要或在答完前读取 YAML，SHALL 以不了解项目代码的评审人视角阅读，不靠框架经验补全正文。读者 SHALL 具体指出缺图解释的关键链路、图错章、只有一段且未回答本章问题的位置，段落少本身 MUST NOT 自动失败。无渲染图像时 SHALL 仍从评审 Markdown 的 Mermaid 源核实现时序的界面步骤/一次跨层交互粒度，指出混讲的独立问题及应拆段落/衔接，MUST NOT 提前读 YAML 或跳过整项图审查；总览例外 SHALL 仅限用户旅程/角色关系图，不以参与者数量代替判断。仅字号/布局/是否需放大 SHALL 标未核验，MUST NOT 把图源或语法检查冒充视觉通过，不新增预览依赖/门禁。八问 SHALL 覆盖十分钟讲清方案、选择/被否方案、调用责任、存储安全/账号隔离、失败恢复、施工/安全中间态、文件用途、原验收编号；十分钟不是计时门禁。八问适用缺口 SHALL 由作者在既有一轮定向修订中处理：事实已有补说明/图、事实矛盾回原设计修正、材料不足明确未决及缺少依据；仍未解决 SHALL 明确披露且 MUST NOT 宣称阅读通过，MUST NOT 将未解释的取舍/调用/恢复归为非关键表达而略过。已能回答问题后的措辞偏好 MAY 如实报告后交接，MUST NOT 新增评分/次数状态、签章、用户签字或无限重试；事实/授权错误仍归原责任方。纯 guide 润色 MUST NOT 要求重做原设计质询。

主 agent SHALL 按 P1 workflow §4“派出独立质询”条目把通用规则及材料位置写入实际派发任务，MUST NOT 依赖质询者自行读取 P1，MUST NOT 附父会话设计结论、目标样稿或宿主答案。任务 SHALL 明确：先只读首屏/正文答八问，答完前不读参考区、YAML 或需求原文；之后首次核源逐条对照本次适用原需求、有效人类裁决、最终设计与验收，沿既有报告引原句/出处及设计/验收位置，MUST NOT 以来源路径、scope 齐全或检查 PASS 代替行为满足。质询者提出删除/收窄明示数据交接、跳转或清栈建议前 SHALL 引受影响原句及适用裁决、说明风险，并给出兼顾原行为与约束的替代；无法兼顾或缺依据 SHALL 沿已有未决决定/待确认说明，MUST NOT 直接删后闭项。返修任务 SHALL 只复核旧意见及修法直接影响的原要求和验收，MUST NOT 每轮重审全部需求。

设计修订 SHALL 优先换实现以满足原需求。作者采纳建议前 SHALL 核需求与授权；涉及原文明示的携带数据、跳转目的地或页面清理时，SHALL 回原文复核，同步步骤、旅程、图、恢复及数据生命周期，核谁持有/谁接收/交接渠道/何时清理及失败无写入标识的情形，MUST NOT 强制明文路由参数交接或将具体样本实现固化成通用模板。必要偏离 SHALL 沿既有未决决定/待确认说明原要求、拟变更、理由和影响，无用户或既有明确授权 MUST NOT 删除或标已裁决；质询建议和作者核对本身 MUST NOT 构成人类变更授权，有效裁决仅在其真实范围生效。该责任 SHALL 复用原质询/报告，MUST NOT 新增文件、持久状态、强制调用轮次、评分、逐句机器比较或签字/准入门。

流程效果 SHALL 以用户相同话术和任务边界的真实回归判断，MUST NOT 手修测试宿主或修改原需求后宣称框架通过。派发原文可见 SHALL 核原文是否转达上述约束；因加密等原因不可见 SHALL 如实标原文未核验，按质询实际是否引原句、给保需求替代或沿原承载待确认判断，MUST NOT 单因不可见阻止验收或声称已核过原文。未发生删减建议 SHALL 不刻意制造意见，仍核最终设计保留原要求；确定性展示验证 MUST NOT 冒充真实流程与实读通过。

发布件指引 SHALL 教完整因果、首次角色解释、已有导航规则的清栈前后例子、S4 与加密分开、验收主题原编号；MUST NOT 放本次宿主目标样稿或业务栈答案。通用好坏示例 SHALL 标明仅示例，不新增业务要求。接受 CU/readiness/指针调和/B1 发布/只读与发布校验 SHALL 零新增模型调用，不自动写说明或盖摘要。B1 agent SHALL 仅改授权草稿，MAY 按事实变化和 source_refs 定向阅读说明，MUST NOT 扩权补盖。公开摘要命令只读 canonical，框架随后登记的根 provenance 参与摘要；当前公开 B1 流程 SHALL 保留原摘要、发布后提示说明需更新并回退当前事实，由后续 component-design 复核已发布 canonical 再记录摘要，MUST NOT 因观感停止 run。

#### Scenario: Draft facts change under the same revision

- **WHEN** 草稿同 revision 修改契约或流程但 guide 仍带旧摘要
- **THEN** 旧说明 SHALL 回退为当前事实与参考，文首提示需更新；原 readiness/准入结果 MUST NOT 因说明失效改变

#### Scenario: Narrative introductions cannot hide decisions or pending facts

- **WHEN** 当前 guide 含 decisions/questions 导读，canonical 另有决策被否方案、headless_assumed 术语、must_review 或 gaps
- **THEN** 第8节 SHALL 仍逐项展示决策名称/选择/理由/已有被否方案，第13节 SHALL 仍展示当前假定术语、must_review 和真实 gap 状态；即使 must_review 未重复登记术语也不能隐藏，不以导读声称已裁决代替事实

#### Scenario: A full save interaction remains complete without merging the entire journey

- **WHEN** 入口、选择、校验、保存和完成包含不同界面步骤，保存自身需要跨页面、业务对象、Repository 和数据库
- **THEN** 实现时序 SHALL 按步骤或一次跨层交互拆分，保存 MAY 保留完整调用返回，后续用户点击结果页完成、清栈及首页刷新 SHALL 属另一界面步骤，成功完成与失败退出分别解释且 MAY 同图分支；MUST NOT 借端到端总览例外合成全过程实现时序或删掉交接来缩图

#### Scenario: Reading feedback cannot silently change an explicit requirement

- **WHEN** 正文八问完成后，质询者因安全/导航等原因拟建议删除或收窄原文明示的数据交接、跳转或清栈行为
- **THEN** 质询者 SHALL 先引原句及适用裁决、说明风险，给兼顾需求与约束的替代，无法兼顾沿原承载待确认；作者 SHALL 核授权并在一轮修订中处理或如实保留未解决，返修只复核旧意见及直接影响的原要求和验收，无授权 MUST NOT 删除、标已裁决或宣称阅读通过

#### Scenario: Independent questioning receives the source-check rules in its task

- **WHEN** 主 agent 按 P1 §4 派出已有独立质询
- **THEN** 实际任务 SHALL 带材料位置、先正文八问后读需求/YAML、首次逐条核适用原需求/裁决/设计/验收、删减建议先引原句并给保需求替代或待确认、返修核旧意见及受影响原要求的规则，MUST NOT 依赖质询者自行读 P1 或传入父设计结论

#### Scenario: An encrypted task is assessed from observable questioning behavior

- **WHEN** 真实回归的派发原文因加密不可见
- **THEN** 报告 SHALL 标原文未核验并按可见质询行为与最终设计核需求保留，MUST NOT 声称已读原文或单因不可见阻止验收；没有删减建议时 MUST NOT 为验收刻意制造意见

#### Scenario: A misplaced table schema only reports its location

- **WHEN** canonical 开发节点声明 table_schema，其余设计有效
- **THEN** 既有展示诊断 SHALL 以 WARN 指明该实际路径及根 contracts[].table_schema 约定，MUST NOT 自动移动数据或改变 admission/readiness；根级合法双形状、未声明及说明/引用/代码字符串中的同名词 MUST NOT 报错位

#### Scenario: Identity or questioning changes without design changes

- **WHEN** 只升 revision 或只更新 questioning/admission/reconciliation 记录
- **THEN** guide SHALL 无需重写；图 freshness SHALL 仍独立按既有机制判定，自动刷新 MUST NOT 调模型

#### Scenario: Invalid local narrative does not damage valid content

- **WHEN** guide 有坏引用/图引用或 prose 标题，但其它说明有效
- **THEN** renderer SHALL 保留有效内容并局部说明缺口，实际标题降级而代码块 # 保留；机器能核引用与集合，MUST NOT 宣称文意无新事实

### Requirement: Blueprint construction preparation preserves authority

validateChangeUnitFeatureProjection 的 designOnly SHALL 不调用依赖未来 plan.design_ref_mappings 的 componentProjectionErrors；合法组件索引与 typed UI 设计无 change_unit SHALL 可进入真实设计 readiness。plan 及后续组件映射检查 SHALL 完整保留，组件选型设计原检查不变，不新增设计期替代门。

Blueprint projection SHALL use canonical CU design references and existing revision/hash, provenance, admission and current-slice checks. Design owners SHALL author the existing acceptance/contracts/use_cases structures on referenced targets during design; references, prose and verification_refs alone SHALL NOT become executable content. Acceptance SHALL use the existing semantic checks. Contracts SHALL preserve design facts, models, interfaces, the explicit files authorization set, runtime lifecycle and required use cases. The entire contracts.change_unit SHALL be authored by plan in Feature contracts.yaml, using the current canonical CU identity and real implementation/test mappings; design projection SHALL omit it, including legacy blueprint mappings. Missing future mappings SHALL not block design readiness, while complete mapping checks SHALL remain at plan and later consumers. A design projection alone SHALL not satisfy pending plan work.

Projection and the review document SHALL share one target selection and content merge function. Selecting a target SHALL inherit its whole typed content. Arrays SHALL merge by the existing projection row identity, deduplicating identical content and rejecting conflicting content with authority_content_conflict. Object-valued keys SHALL only accept identical complete declarations and SHALL NOT merge per key. Shared targets SHALL contain only content all referencing units should inherit; exclusive acceptance, files and use cases SHALL belong to targets referenced only by their unit. Stable design nodes SHALL NOT be copied or versioned to carry a revised or replacement CU mapping. Predicates and touches SHALL NOT filter inherited content or expand authorization. Legitimate sequential writes to the same file SHALL NOT introduce a new overlap gate.

Design readiness SHALL reuse canonical-only read-only projection checks for all non-retired constructable units, including completed units, without materializing artifacts. Feature use-cases SHALL NOT reverse-validate canonical authority; existing definition gaps and plan alignment SHALL return unaligned stage content to plan. The removed pure mode SHALL NOT be reintroduced. Each declared content kind SHALL be checked even when another is absent. Absent content SHALL identify the existing spec/plan responsibility without a new missing-field gate; declared invalid canonical structure, authority, design write sets or conflicts SHALL reuse existing reasons and return not-ready. The review document SHALL only show canonical declarations, valid explanatory narrative and merge conflicts, with identity, handoff validation and source mechanisms explained once at the reference entrance and narrative freshness warnings visible at the opening.

Normal handoff SHALL NOT materialize Feature acceptance/contracts/use-cases files; spec and plan SHALL consume derived inputs and write their own outputs. Explicit materialization remains a current projection export, not an unpublished legacy-CU migration path. Source-stamped files SHALL permit non-conflicting stage supplementation under the same authoritative alignment used by handwritten content. Refresh SHALL only update source/reference identity when unchanged design and CU contract content is provable, preserving business and supplementary bytes; real content changes or unavailable equivalence SHALL retain that Feature's old files and return to the responsible stage without merging or overwriting, while legal canonical pointers and sibling units continue. Canonical invalidity and real I/O/CAS failures SHALL retain existing transactional failure behavior. Materialization MUST validate the complete candidate and sources before writing through existing artifact paths and MUST reject conflicts with existing decisions. Equivalent files SHALL not be rewritten; valid handwritten files SHALL not be silently migrated or overwritten. Source stamps, normalized content and canonical CU bindings SHALL remain verifiable through the same existing path.

Enforcement: `harness/scripts/utils/blueprint-skill-projection.ts`, `harness/scripts/utils/change-unit-design-preparation.ts`, `harness/scripts/prepare-blueprint-design.ts`, `harness/scripts/utils/change-unit-feature-projection.ts`, `harness/scripts/utils/check-acceptance.ts`, `harness/scripts/utils/contract-reference-closure.ts`.

#### Scenario: Only reference strings exist
- **WHEN** the CU has verification_refs but no approved executable acceptance or precise construction content
- **THEN** preparation SHALL return a concrete design gap rather than generate placeholder contracts; absent content alone SHALL not add a handoff gate

#### Scenario: Revision or authority differs
- **WHEN** the bound blueprint revision/hash changes or an external contract conflicts with its authority
- **THEN** old projection SHALL be rejected and the gap SHALL return to its design owner

#### Scenario: Write target is absent
- **WHEN** a referenced construction file is absent from explicit contracts.files
- **THEN** projection SHALL fail without expanding authorization from CU touches

#### Scenario: Legacy mappings do not redefine replacement construction
- **WHEN** shared or exclusive blueprint targets contain legacy change_unit mappings for another CU
- **THEN** common design extraction SHALL omit those mappings without altering canonical history or hiding inherited acceptance/files
- **AND** plan SHALL generate current Feature mappings; missing/unknown/stale IDs and unauthorized files SHALL still fail the existing construction checks

#### Scenario: Declared bad use cases coexist with absent acceptance
- **WHEN** a selected target omits acceptance but declares malformed use_cases
- **THEN** readiness SHALL report the existing invalid-content reason without materializing files, rather than returning early at absent acceptance

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

完整时序 SHALL 复用 generated_graphs 的 graph_id/format/source_view_id/content/node_refs/relation_refs，format=mermaid、source_view_id=runtime。node_refs SHALL 指真实 flow/参与对象承载地址，可多角色共用目标；数据库指已有数据节点/根存储契约，不造 table: 地址。relation_refs MAY 为空，MUST NOT 为每箭头创建顶层 relation/closure 义务。图 SHALL 在既有 derived_results 以同 graph_id 对应 result_id，沿 input_revision/source_fingerprint/decision_fingerprint/status 与 evaluateDerivedConclusionFreshness；事实变化 SHALL 同次重生成，MUST NOT 仅换来源戳。renderer 按 flow 引用原样展示，缺对应结果或 stale 的新时序图 SHALL 原位提示重建、不展示、不改变 readiness；旧 flowchart 不新增迁移门槛。不新增 sequence_diagrams/interactions 字段/schema、图权威文件、hash/签名/状态或自动语义比较器。

原 parser SHALL 只扩 sequenceDiagram 最小子集：participant/actor（可带 as 标签）、->>、-->>、Note over、alt/else/end、空行、%% 注释；核重复声明、消息/注记端点、块配对及原地址。flowchart 当前子集 SHALL 仅支持 flowchart/graph 方向声明、ASCII id、`id["标签"]`、`-->`、`-->|标签|`，不支持 `{}`、subgraph 或注释。超子集/坏端点/块/地址等时序图自身问题及 relation_refs 缺省或空数组的作者展示图问题 SHALL 全部 WARN，renderer 在对应流程或 graph_ids 放置点说明原因且不展示该图，MUST NOT 经 sourceGaps、投影 invalid 或其它汇总阻断 admission/readiness。声明 relation_refs 的关系结构图 MUST 保持原 BLOCKER；真正关系/canonical/契约/来源缺陷仍经原门。确需并发而时序子集不足 SHALL 保留步骤并披露，不假画串行；不扩 activation/loop/par/HTML/include/主题。

canonical generated_graphs 中已有合法图无实际展示出口 SHALL 每图只报一条遗漏 WARN，含 canonical 路径、graph_id/可读名称及作者应在合适说明小节引用的提示，复用文本/JSON/评审参考输出。诊断与 renderer SHALL 共用只读选择判断，消费 inspectBlueprintReaderGuide 解析后真正生效的 sections，共同判断正文放置、对应视图参考结构图选择、未放置时序图参考兜底三个出口，MUST NOT 另读原始 graph_ids 自算、为诊断执行整份 Markdown 渲染或建立平行选择算法/渲染计划。视图结构图 SHALL 遵循原 source_view_id、视图存在性、applicability、evolution_impact 与选择条件；not_applicable 或 verified_unchanged 提前返回时 MUST NOT 仅凭 relation_refs 非空认定已展示，影响待确认 MUST NOT 一概视为不展示。已在任一出口展示 SHALL 不报遗漏，多处引用仍首次绘制、后续回链。

过期/无效说明中的原始 graph_ids MUST NOT 算生效引用，SHALL 继续判断其它参考出口；无 guide MUST NOT 推定所有图遗漏。坏图、按既有规则过期或缺派生依据的图 SHALL 保留原诊断/说明，MUST NOT 重复报成遗漏或改变原 WARN/BLOCKER，MUST NOT 为 flowchart 新增 derived_results 要求。遗漏提醒 MUST NOT 自动放图、补 graph_ids、改 canonical、猜章节、改变参考兜底或新增状态/准入/readiness 门，MUST NOT 检查根本未画的图或用图数衡量充分性。参考已展示 MUST NOT 要求复制进正文消 WARN，位置及图文语义仍由既有阅读复核。

#### Scenario: A valid author graph has no display outlet

- **WHEN** canonical 中的合法旅程流程图未被生效说明引用，也不满足视图结构参考或时序参考兜底的原选择条件
- **THEN** 真实 checker 文本/JSON 与评审参考 SHALL 同源各显示该图一次遗漏 WARN，含路径/id/可读名称，原 canonical、admission 和 readiness SHALL 不变

#### Scenario: Effective guide and actual reference outlets determine display

- **WHEN** guide 过期或小节无效使原 graph_ids 不生效，或者 source 视图不适用/核实未变而提前返回
- **THEN** 合法图无其它实际出口 SHALL 提醒，仍经正文或其它参考出口展示 SHALL 不提醒；影响待确认的视图 SHALL 沿原选择条件判断实际展示，不一概略过

#### Scenario: Existing graph errors do not become omission warnings

- **WHEN** 图已有语法/端点/引用问题，或按原规则过期/缺派生依据，或蓝图根本未画图
- **THEN** 系统 SHALL 保留原诊断与级别而不重复报遗漏，未画图不新增缺图门，flowchart MUST NOT 被新增 derived_results 要求；实际自动结构参考/时序参考已展示的合法图也 SHALL 不提醒

#### Scenario: A malformed sequence diagram does not block valid design

- **WHEN** 其它 canonical 设计有效，时序图超出子集、引用未知参与者、alt 未闭合或 node_refs 地址错误
- **THEN** 图自身诊断 SHALL 为 WARN，原流程说明且不展示该图，真实 admission/readiness 结果 SHALL 不受影响

#### Scenario: A malformed authored overview without relation references does not block valid design

- **WHEN** 其它 canonical 设计有效，作者展示图的 relation_refs 缺省或为空，图使用不支持的 `{}` 判断或有坏端点/地址
- **THEN** 图自身诊断 SHALL 为 WARN，renderer SHALL 在 graph_ids 原位置说明且不展示该图，其它内容保留，真实 admission/readiness SHALL 不受影响

#### Scenario: A malformed relationship structure retains its blocker

- **WHEN** 同样损坏的图声明了非空 relation_refs
- **THEN** 图自身诊断 SHALL 保持原 BLOCKER，关系事实检查 MUST NOT 降级

#### Scenario: Sequence drawing follows current authored calls

- **WHEN** owner 在已有 ordered_steps/接口/存储/恢复设计补全真实调用与完成链，同次生成图及 derived_results 并经 runtime 独立质询
- **THEN** renderer SHALL 展示该当前图，即使 relation_refs 为空；旧/stale/缺派生结果的时序图 SHALL 不冒充当前，不从测试动作与端口列表生成替代箭头

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

App design lens MAY 提出变化轴候选，但只有存在可追溯变化证据且对边界、风险、测试、生命周期或后续成本有实质影响的候选才能进入决策卡。每张卡 MUST 记录变化原因、已知变体、稳定契约、Provider、Consumer、绑定时机、状态/数据 owner、缺失/失败/重复语义、替换或故障验证，并把 `human_decision` 冻结为 `establish_seam|keep_direct`。`establish_seam` 表示建立宿主演进接缝，并 MUST 在 `closure_proofs` 中为 contract compatibility、Provider replacement、absence/failure 和 Consumer no-bypass 各绑定一个互不复用、同时列入 decision tests 的精确证明引用；`keep_direct` 表示保持直接实现并 MUST 给出再提取条件。其它字符串、缺失裁决、复用同一证明、证明未进入 tests，或仅凭 `kind=evolution_candidate` 推断建缝 MUST fail-closed。没有门槛证据的候选 MUST 在进入决策卡前被驳回，不得制造“以后可能会用”的抽象。宿主演进接缝位于宿主代码内部，不得进入 Maison provider 注册面或 `goal_requires/goal_provides`、Change Unit `requires/provides` 命名空间。

#### Scenario: An evidence-backed candidate is kept direct

- **WHEN** 现有多个数据来源证明存在变化轴，但人类裁决 `human_decision=keep_direct`
- **THEN** 蓝图必须保存决策卡、裁决依据和再提取条件；P2/P3 使用普通设计与依赖规则，后续变更满足条件时可重新进入调和

#### Scenario: An evidence-free abstraction is proposed

- **WHEN** AI 仅因“未来可能有第二实现”提出接缝，却没有真实变体、边界、测试或生命周期证据
- **THEN** 候选必须在进入决策卡前被驳回，不生成空接缝、空 Provider 或再提取条件

#### Scenario: An unsupported seam decision is supplied

- **WHEN** evolution candidate 使用 `human_decision=approved` 或其它非冻结枚举值
- **THEN** P1 schema/decision validation MUST fail，而不是让 P2/P3 猜测它是否表示建缝

> **Enforced by (P1 implementation):** `harness/schemas/app-component-blueprint.schema.json`, `harness/scripts/utils/blueprint-evolution-decisions.ts`, `harness/scripts/check-component-blueprint.ts`, `openspec/specs/complex-capability-meta-model/spec.md`

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
| blueprint-review publication | 指定 admitted revision 的确定性评审投影（`derived_from` = artifact/component_id/blueprint_id/revision/source_fingerprint/artifact_sha256/有效 CU 内容绑定） | Maison → 宿主 | 宿主 Story Document / 归档件装配方 | Maison 确定性 review projection renderer | optional | canonical 蓝图和 CU 各保留原设计/施工职责；投影 MUST 相对两者零新设计事实，MUST NOT 反向覆盖 YAML；Maison 从 canonical CU 派生同页施工拆分；宿主可附 spec 等附件，但附件 MUST NOT 成为部件内设计的事实来源 | 宿主未接该接缝 → 外部归档诚实降级（本地文档仍默认交付），核心蓝图链不受影响，不得宣称已归档 | 投影内容契约稳定；同一蓝图/CU 来源与当前 renderer 重算字节确定性一致 | 清理投影副本；canonical YAML 与 revision 历史保留 | 投影包含 canonical 中不存在的设计事实 → 校验失败；同一 revision 出现两份内容不同的投影 → fail-closed |
| blueprint-review feedback | `{feedback_id,kind,source_revision,authority?,decision?,evidence_refs?}`，`kind` ∈ `opinion \| fact_supplement \| suggestion \| authoritative_ruling` | 宿主 → Maison | 既有 P1 reconciliation | 宿主评审系统/评审人 adapter | optional | 只有同时具备 `authority`（有权 owner 标识）、`source_revision`（指向被评审的 revision）与明确 `decision` 语义的 `authoritative_ruling` 才 MAY 进入 `decided_with_authority`；其余三类只能记为意见/事实补充/建议。批次身份（`blueprint_id` **与** `component_id`）与目标蓝图不一致 MUST fail-closed | 无反馈 → 蓝图保持当前 revision，不得自我升格 | 更换评审系统不改变四类分类与 authority 门槛 | 清理未接受反馈；已生成的 revision 与 provenance 保留 | authority 不足却声称裁决、`source_revision` 不指向已存在 revision、批次身份不一致、或试图回写旧 revision → fail-closed。intake 本身 MUST NOT 自动接受任何反馈、MUST NOT 改写任何 revision；**被接受后**，授权裁决与事实补充都落在既有 P1「新事实、权威裁决 MUST 生成新 revision」覆盖面内，MUST 经既有 reconciliation 生成**新** revision；意见与建议 MUST NOT 触发 revision 递进 |

**发布态机器契约 SSOT 与验证入口**（三者 MUST 在发布件内点名落地，MUST NOT 只存在于 dev-only OpenSpec；MUST NOT 新增顶层 CLI）：

| 接缝 | 发布件内 SSOT | 验证入口 |
|---|---|---|
| requirement-source materialization | `harness/schemas/requirement-source-materialization.schema.json`（宿主可读的镜像；**字段语义权威**是 `app-component-blueprint.schema.json#/$defs/currentScopeItem`，校验判据复用 P1 的 current-scope helper，不复制出第二套可漂移语义） | `check:component-blueprint` 既有 CLI 的材料校验模式（`--materialization <path>`）；**该模式 MUST NOT 要求 canonical blueprint 已存在**（物化在建蓝图之前）；解析复用既有 `resolveCurrentScopeSource`，不造 resolver 副本 |
| blueprint-review publication | **复用既有** `harness/schemas/app-component-blueprint.schema.json` + 确定性 `harness/scripts/utils/blueprint-review-projection.ts` renderer | `check:component-blueprint --write-review` 本地生成及既有 `derived_from`/投影一致性校验（`--projection <path>`）；MUST NOT 新建平行 publication schema |
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

### Requirement: Changed development nodes carry an admitted module identity

Every node of an applicable and changed development view MUST declare the existing `module` field; `owner` keeps its responsibility meaning and MUST NOT be reused as the module identity. With a project root, `module` MUST resolve to an admitted module, where the single admitted-module helper `resolveAdmittedModules` returns the current module-catalog modules plus the target modules declared by this blueprint's `architecture_impact` decisions with `change: add_module` or `change: move_module` (whose layer MUST be a current DSL outer layer), plus modules named by `change: retire_module` decisions (a retired module stays admitted after closure placement removes it from the catalog, with no layer, so it never takes part in dependency judgement). The same helper SHALL feed node validation, terminology validation, and `componentDependencyAllowed`, which accepts an optional declared `module → layer` map so a newly declared or moved module acting as consumer is judged by its declared layer under the same DSL rules. For a CU-bound Feature the plan component dependency check SHALL use the same helper result from the canonical blueprint, and a `contracts.modules` layer that differs from the admitted layer SHALL FAIL; non-CU-bound Features keep using contracts layers only for modules outside the catalog. The catalog keeps current-state semantics and MUST NOT be edited during blueprint design. When the catalog is unreadable, module identity is unknown and the current slice MUST be blocked. Nodes of a verified_unchanged development view are not re-judged.

#### Scenario: Node module outside the admitted set
- **WHEN** a changed development node declares a module that is neither in module-catalog nor declared by an add_module, move_module or retire_module decision of the same blueprint
- **THEN** P1 SHALL report `blueprint_node_module_unadmitted` as a BLOCKER

#### Scenario: Newly declared module is admitted everywhere at once
- **WHEN** a blueprint declares `add_module` for a new module with a DSL layer, a changed development node uses that module, a terminology fact maps a new term to it, and the node reuses an existing shared component
- **THEN** P1 SHALL pass node, terminology and component dependency validation using the declared layer
- **AND** closure SHALL require the decided add_module conclusion to be placed through the existing `knowledge_refs` obligation

#### Scenario: Missing module field
- **WHEN** a changed development node omits `module`
- **THEN** P1 SHALL report `blueprint_node_module_missing`

#### Scenario: Retired module placed by closure
- **WHEN** a decided `retire_module` decision names a module used by a changed development node and closure placement then removes that module from module-catalog
- **THEN** P1 and the closure re-validation of the canonical blueprint SHALL still pass, with at most a WARN asking to confirm the module name

#### Scenario: Approved module move in a CU-bound plan
- **WHEN** a blueprint approves `move_module` of a catalog module to a new layer and the CU-bound plan's component reuse is legal only under the new layer
- **THEN** the plan component dependency check SHALL pass
- **AND** without that decision, or when `contracts.modules` declares a layer different from the admitted one, the check SHALL FAIL

> **Enforced by:** `harness/scripts/utils/component-assets.ts`, `harness/scripts/utils/blueprint-views.ts`, `harness/scripts/utils/blueprint-evolution-decisions.ts`, `harness/scripts/utils/component-selection-check.ts`, `harness/schemas/app-component-blueprint.schema.json`, `harness/tests/unit/component-assets.unit.test.ts`

### Requirement: Terminology mapping is a discovery fact confirmed once in the blueprint

A term-to-module mapping SHALL be a `discovery.facts` entry with `subject: term:<original term>`, `value: {canonical_module, confidence: high|medium|low, easily_confused_with: []}` and `provenance.source_kind: glossary|catalog`; the source authority rank SHALL include `glossary` at the same rank as `catalog`. `canonical_module` MUST be an admitted module. Check id `terminology_facts_confirmed` SHALL enforce confirmation: a real user confirmation records `provenance.extraction_method: user_confirmed`; a headless auto-continue records `headless_assumed`, is reported as a WARN for must-review, MUST NOT be recorded as `user_confirmed` and MUST NOT be written back to glossary; a `medium` or `low` fact without either is a BLOCKER so admission cannot pass, unless it is parked by an existing controlled gap with `status: open_decision`, `needed_by` other than the current slice and `verification_refs` containing the fact `subject`, and no gap referencing that `subject` has `needed_by` equal to the current slice or `status: blocker`, in which case it is a WARN (the existing admission rules still force a gap needed by the current slice to be a blocker); `high` is accepted only when glossary has an exact hit with the same canonical module. The confirmation point `spec.terminology` is owned by `component-design`. Independent questioning SHALL include a `terminology:current_scope_items` scope whenever current scope items exist; it only requires a questioning disposition and the machine does not judge full coverage.

#### Scenario: Unconfirmed medium term in interactive design
- **WHEN** a term fact has confidence medium, extraction_method is neither user_confirmed nor headless_assumed, and no future open_decision gap parks it
- **THEN** P1 SHALL report `terminology_facts_confirmed` as a BLOCKER and admission SHALL NOT pass

#### Scenario: Unconfirmed term needed only by a future slice
- **WHEN** the same fact is referenced by an open_decision gap whose `needed_by` is a later slice, and by no gap needed by the current slice or with `status: blocker`
- **THEN** P1 SHALL report it only as a WARN and admission of the current slice SHALL be able to pass

#### Scenario: Unconfirmed term needed by both the current and a future slice
- **WHEN** the same fact is referenced by a future open_decision gap and also by a current-slice gap with `status: blocker`
- **THEN** the future gap SHALL NOT park it, P1 SHALL report `terminology_facts_confirmed` as a BLOCKER and admission SHALL NOT pass

#### Scenario: Headless auto-continue
- **WHEN** the same term fact records `headless_assumed`
- **THEN** P1 SHALL NOT block, SHALL report a must-review WARN, and glossary SHALL remain unchanged with no `user-approved` marker

#### Scenario: Canonical module outside the admitted set
- **WHEN** a term fact's canonical_module is not an admitted module
- **THEN** P1 SHALL report `terminology_facts_confirmed` as a BLOCKER

> **Enforced by:** `harness/scripts/utils/blueprint-discovery.ts`, `harness/scripts/utils/component-blueprint-validator.ts`, `harness/scripts/utils/blueprint-questioning.ts`, `skills/reference/confirmation-registry.yaml`, `harness/tests/unit/component-assets.unit.test.ts`

### Requirement: Architecture impact is a blueprint decision per change item

Architecture impact SHALL be recorded as the flat decision subtype `kind: architecture_impact`, one decision per concrete change item, validated by the existing decision validator. `change` MUST be one of `add_module` (requires `module`, `layer`), `retire_module` (requires `module`; a module no longer in the catalog is only a WARN because closure placement removes it), `move_module` (requires `module`, `from_layer`, `to_layer`), `responsibility_rewrite` (requires an admitted `module`), `dependency_edge` (requires `from`, `to` as outer layer ids or module names and `direction: add|remove`), or `dsl_other` (requires `affected_items[]`), plus `rationale` and the existing owner/provenance/verification_refs/status. Layers MUST be current DSL outer layers. Composite architecture changes MUST be expressed as several decisions; no timing field or state machine is added. A verified_unchanged development view MUST NOT carry architecture_impact decisions. Placement of decided add/retire/move/responsibility changes into catalog or architecture knowledge SHALL use the existing closure `knowledge_refs` obligation.

#### Scenario: Invalid change fields
- **WHEN** a dependency_edge decision lacks `direction`, or an add_module layer is not a DSL outer layer
- **THEN** P1 SHALL report `blueprint_architecture_impact_invalid`

#### Scenario: Unchanged development view masks architecture change
- **WHEN** the development view is verified_unchanged and an architecture_impact decision exists
- **THEN** P1 SHALL report `blueprint_view_unchanged_masks_change` as a BLOCKER

> **Enforced by:** `harness/scripts/utils/blueprint-evolution-decisions.ts`, `harness/scripts/utils/component-closure-knowledge.ts`, `harness/schemas/app-component-blueprint.schema.json`, `harness/tests/unit/component-assets.unit.test.ts`, `harness/tests/unit/change-unit-progression.unit.test.ts`

