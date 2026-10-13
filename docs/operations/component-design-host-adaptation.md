# 部件内设计阶段：宿主适配指南

> **受众**：把自己的需求管理 / 评审 / 归档系统接到 AgentMaison 的**宿主工程开发者**。
>
> **定位**：这是宿主适配的**唯一人读入口**。它只串联解释三条接缝的方向、时点、责任和最小
> 接入流程；**精确字段真值在发布件内的 schema 与 checker 里**（本文逐条点名），本文不复制
> 出第二套可漂移的协议描述。
>
> **适用框架版本**：3.1+。
>
> **样例值都是示例，不是约定**：本文与 `samples/` 下所有样例中的 `ledger-app-blueprint`、
> `ledger`、`requirements/ledger.md`、各 `sha256:` 与 `revision` 都取自 framework 自己的
> 开发夹具，**接入时必须整体替换为你们工程的真实事实**——blueprint id、component id、项目内
> 来源路径、该路径下文件的实际原始字节 hash、被评审的实际 revision。样例的价值在于**形状与
> 失败语义**，不在于这些值。

---

## 1. Maison 与宿主的责任边界

AgentMaison 从 3.1 起把**部件演进蓝图**定位为"每项正式需求在当前架构部件内的设计权威"
（组织侧常把这个活动称为 **Story Design**）。它不是"复杂需求才启用的可选路线"。

创建、继续、查看、质询与调和设计都从
[`/component-design`](../../skills/project/component-design/SKILL.md) 进入，宿主无需调用内部 P1。
入口按请求和已有产物从未完成步骤继续：草稿继续设计与质询；只读不改 canonical，重入或重跑
checker 不自动升 revision；只有被接受的新事实、权威裁决或冲突解决才按既有规则修订。
用户要求完整交接时，admitted 且 0 CU 的蓝图经既有设计准备流程首次分解；已有 CU 复用，
不重复创建。局部请求不强制分解或交接；完整交接仍要求 admitted 蓝图、1..N canonical CU、
`design_refs`、readiness 与当前人读文档链接。两者均不自动启动施工或闭环。

| 谁 | 负责什么 |
|---|---|
| **宿主** | 从你们自己的需求系统**获取**原始材料、按你们的规定**脱敏**、把结果**物化**成项目内的文件；接收 Maison 输出的评审投影并装配成你们的评审 / 归档件；把评审结论按结构化格式送回 |
| **Maison** | 按请求创建或继续设计；完整交接时使蓝图 admitted、首次分解或复用 1..N canonical Change Unit 并派生 readiness；输出确定性的评审投影，被接受的新事实或授权裁决按既有调和规则生成新 revision |

### 1.1 设计期内容与下游分工

设计 owner 在 canonical 蓝图完成 4+1：场景（+1）与旅程、逻辑边界和模型、运行顺序与分支/恢复、开发目录/文件与组件、适用部署落点和外部配套；同时写清选择与被否方案、质量属性、数据生命周期和验收。实读应能回答需求/范围、当前问题、工作方案、模块责任、选择依据、CU 交付与安全中间态、风险验收七问。详细程度取决于真实关切，不按行数压缩必要细节。

会被 CU 引用的设计目标在设计期写入已有 `acceptance`、`contracts`、`use_cases` 结构。验收含 AC/BD/NFR、优先级、步骤/预期、分层与 focus；契约保留类型/接口、模型、组件、目录/文件和状态，**整个 contracts.change_unit 由 plan 在 Feature contracts.yaml 生成**；用例含阶段、主路径/分支及预期，新写 expected_port_calls，旧 expected_boundary_calls 经共同归一化兼容、冲突诊断。来源权威仍按既有 provenance 校验。`contracts.files` 是唯一施工写集，目录表、`touches`、图和 `source_ref` 都不能扩大它。

引用一个目标即整体继承其设计内容。共享目标 S 只放所有引用者都承担的验收、合法写集和用例；CU-A 引 S+A、CU-B 引 S+B，专属 AC/BD/NFR、files 和用例放 A/B。数组沿已有行身份去重并合并，同身份不同内容拒绝；对象只接受完全相同内容，不逐键拼接。`module_dependencies`、`navigation`、`resource_keys`、acceptance 的 `flows` 等对象分别集中在一个承载目标。存量蓝图 change_unit 不参与共同设计合并；当前 Feature 映射仍由 plan 原门校验。设计节点保持语义稳定，不因 CU 替代或修订复制版本节点。不能按 predicate 隐藏误继承的验收或文件，合法先后写同一文件不自动判错。

六类可选表达为背景/目标/范围、被否方案、术语含义、场景旅程、部署参与方/上线协同、质量属性/数据生命周期，位置与形状见 [P1 写作约定](../../skills/reference/app-component-blueprint-workflow.md#2-写入同一蓝图)。真正缺失每节一行集中提示，明确未知/不适用分别保留；形状错误由原 validator 给 WARN，不增加缺字段门禁、不改 schema。模型字段的可选 `description/source_ref` 沿现有加载/投影透传，展示保留有值事实、真实非法形状如实说明；来源只引用设计期已有材料，不把未来施工文件当输入。

没有 ui-spec 依据时，P0 真机验收保留步骤、预期、分层与 focus，不编 `linked_flow`、checkpoint、屏幕流程或元素 ID。spec 得到真实 UI 依据后，只补未声明的键，保留原权威预期并通过现有对齐与 P0 检查。**正常交接不提前物化 Feature 文件**，spec/plan 直接消费已有 typed 推导输入，各写本阶段产物；投影带用例时 plan 必须写 use-cases.yaml 供真实业务 UT，required_outputs 不只看文件存在。带戳旧文件的合法补充只是兼容兜底，不删戳绕过；设计/CU 内容未变才仅更新来源身份，保留业务和补充字节，真内容变化退责任，不合并。叙述文件只按 required_outputs 产出，合法手写文件不强制迁移。精确边界见[蓝图设计输入](../concepts/blueprint-design-inputs.md)。

标题与本次改变分别写 review_summary.title/summary，概述末在既有叙述中连起总体方案；通用决策选择写 conclusion、rationale 解释原因。term.value.meaning 结合 glossary 说明与需求语境提炼，sample_usage 是消歧示例而非定义；模型字段 description 表达约束/单位。发布 payload、失败 handling/retry 和根 contracts[].table_schema 的列/约束/默认值/JSON 编码由专用表格展示，原文存在就不能假报未记录。

设计 owner/App lens/独立质询沿现有问题检查存储的库名/版本、安全级别/是否加密、主键唯一、升级及敏感字段（table_schema + data_domains.security + 既有叙述）；逐项核真实依赖失败与用户中断，已有 selection/OTP 等内容归 boundaries/failure_recovery，真缺才补，不为 mock 编外部故障。错误/幂等键、涉及跨会话重复卡时的策略与主键明确；quality_attributes 对兼容、安全隐私、UX 深浅色/无障碍、打点/性能给实际结论，不涉及给理由，不凑量化阈值。包括 App lens 与质询在内的新叙述用项目语言。这些不增加机器字段/scope/阻断，也不降级现有 typed、来源、授权及 P0 检查。

完整调用由设计 owner 在现有 flow contracts.state_management[].ordered_steps 字符串写明页面→业务对象→Repository→实际 helper/数据库，以及真实 caller/callee、参数/结果、等待/回调、失败分叉和完成/导航/消费者。typed 接口与根存储契约提供同源细节；table_schema 保留单表与库级 tables[]，精确内容约定见[存储内容约定](../concepts/blueprint-design-inputs.md#存储内容约定)。设计 agent 同次生成 generated_graphs 的 sequenceDiagram，graph_id 对应 derived_results.result_id、复用原版本/指纹/状态，原 runtime scope 独立质询核图文一致。图派生非权威，不新增交互 schema 或每箭头 relation；renderer 不从测试动作/端口顺序猜 caller。支持语法与短例见 [P1 时序写作](../../skills/reference/app-component-blueprint-workflow.md#完整调用设计与时序图)。

同一未完成交付的活动 CU 仅在无运行或已停住时，经 consumer 内容修订接点提交旧精确 ref 与候选，保留 ID/Feature/目录、框架 revision +1；running/锁竞争 busy，普通重复接受仍拒绝。历史完成、成功终局缺投影及损坏记录不冒充未完成，退役前身不改；修订后停住 run 沿既有 binding 缺口回 plan，保留历史与累计预算，不自动改旧产物或启动施工。完成后新增工作及拆分/合并/迁移才用新身份。

### 1.2 部署视图与外部参与方

deployment 是否适用依据部件固有的运行拓扑：平台、进程、独立持久化和外部边界；不随单次需求切换。适用性与本次 `evolution_impact` 正交，适用 deployment 仍进入已有独立质询；不适用保留依据。适用时所有场景（含纯本地场景）的 `deployment_refs` 都要指向本部件实际运行节点，外部节点不能代替本部件落点。

云服务、HA、配置台等外部节点只记录当前事实，`current_state = target_state`，不声明变化。蓝图根级 contracts 只登记本部件实际消费/提供的接口，由消费 CU 的 `design_refs` 认领契约及指向外部节点的 relation，并承担本部件这一侧的证据。外部方自己的施工中本部件不消费的部分，阻挡切片时用既有 gap 与 CU blocker 说明解除条件，其余写 `coordination/rollout`，不建根级 contract、不冒充本部件 CU 已完成外部施工。rollout 表示配套顺序，不转成 `requires` 或执行授权。

**Maison 明确不关心、也不应知道**：内网需求单号、访问 token、内网 URL、评审系统 API、归档
接口、你们的权限模型、归档时点。这些全部留在宿主侧。Maison 只认：

- **项目内相对路径**的 `source_ref`（可带 `#fragment`）
- 该路径下文件的**原始字节 sha256**
- `provenance`（来源种类 / 证据强度 / 提取方式 / 观测时间）
- `authority`（谁为这份材料负责、上游是否显式标为正式需求）

---

## 2. 三条接缝一览

三条接缝**方向不同、owner 不同、彼此独立**。特别注意 publication 与 feedback 方向相反，
**不是**同一条接缝的两半，不要用一个 provider 同时做两件事。

| # | 接缝 | 方向 | 触发时点 | 生产者 | 消费者 | required/optional |
|---|---|---|---|---|---|---|
| 1 | `requirement-source-materialization` | **宿主 → Maison** | 建立 / 更新蓝图**之前** | 宿主 story 类扩展 | Maison 蓝图 builder（`discovery.inputs.current_scope_items`） | 来源来自宿主/外部 provider 时 **required**（见 §3.0） |
| 2 | `blueprint-review-publication` | **Maison → 宿主** | 蓝图 admitted **之后**、需要人读评审或归档时 | Maison 确定性 renderer | 宿主 Story Document / 归档件装配方 | **optional** |
| 3 | `blueprint-review-feedback` | **宿主 → Maison** | 评审产生结论**之后** | 宿主评审系统 / 评审人 adapter | Maison 既有 reconciliation | **optional** |

```text
        ┌──────────────────────────── 宿主 ────────────────────────────┐
        │  需求系统 ──①物化──▶ 项目内文件                              │
        │                          │                                   │
        │  Story Document ◀──②投影─┤                                   │
        │        │                 │                                   │
        │  评审结论 ──③反馈────────▶│                                   │
        └──────────────────────────┼───────────────────────────────────┘
                                   ▼
                     Maison：蓝图 admitted → 1..N canonical CU
```

---

## 3. 接缝 1：requirement-source-materialization（宿主 → Maison）

### 3.0 什么时候必须用这条接缝

**单一判据**：每项正式需求最终必须形成**至少一个合法 `currentScopeItem`**（项目内可解析
`source_ref` + 原始字节 hash + provenance + authority）。达成方式有两条，**都合法、产出同一
形状**：

| 输入来自 | 走哪条 |
|---|---|
| 你们的需求系统 / 外部 provider | **必须**用本节的 `requirement-source-materialization@1` 文件接缝 |
| 直接人工、inline、或已在项目内的本地文件 | 由蓝图 builder 直接规范化为同一 `currentScopeItem`，**不必额外制造一份 provider manifest** |

也就是说：**小正式需求由人直接给需求文本时，不需要为此多产一个 JSON**；这条接缝是给"有宿主
provider 参与"的场景用的。但两条路径都**不得无来源、凭模型转述**生成 scope item。

### 3.1 契约与校验入口

| 项 | 值 |
|---|---|
| 发布件内 schema（SSOT） | `framework/harness/schemas/requirement-source-materialization.schema.json` |
| artifact 标识 | `requirement-source-materialization@1` |
| 校验入口 | `check:component-blueprint` 的 `--materialization <path>` 模式（**没有新的顶层 CLI**） |
| 来源解析 | 复用既有 `resolveCurrentScopeSource`：项目相对路径 + 原始字节 hash |

```bash
cd framework/harness
npm run check:component-blueprint -- \
  --project-root <宿主工程根> \
  --blueprint <blueprint-id> \
  --materialization doc/requirements/ledger-materialization.json \
  --json
```

### 3.2 你要产出什么

宿主把需求材料**落到项目内**（例如 `doc/requirements/<name>.md`），再产出一份物化清单指向
它们。清单每一项对应蓝图里的一个 `current_scope_item`：

| 字段 | 含义 | 必填 |
|---|---|---|
| `item_id` | 稳定 id，跨 revision 保持同一语义身份 | ✅ |
| `kind` | `requirement` / `goal` / `invariant` / `high_risk` | ✅ |
| `source_ref` | **项目内相对路径**，可带 `#fragment` 定位片段 | ✅ |
| `source_sha256` | 该文件**原始字节**的 `sha256:<64 hex>` | ✅ |
| `source_revision` | 你们系统里的版本标识（可选，**不能替代内容 hash**） | — |
| `provenance` | `source_kind` / `source_ref` / `observed_at` / `evidence_strength` / `extraction_method` | ✅ |
| `authority.owner` | 谁为这份材料负责 | ✅ |
| `authority.formality` | `formal_requirement` / `non_formal_maintenance` / `unspecified` | ✅ |

> `provenance.source_ref` 必须与顶层 `source_ref` 逐字一致。
>
> `authority.formality` = `formal_requirement` 时，**上游分类具有权威性**——Maison 不会用本地
> 启发式把它降级。填 `unspecified` 表示"上游没分类"，入口会**问人**，不会猜。

### 3.3 失败行为（照此实现你的 adapter）

| 情况 | Maison 行为 |
|---|---|
| 正式需求**缺**物化材料 | 结构化 **blocker**（带 owner 与解除条件）；**不会**凭转述补造 scope item |
| `source_ref` 在项目内解析不到 / 不是文件 | `materialization_source_unresolvable` |
| 带 `#fragment` 但文件里找不到该片段 | `materialization_source_unresolvable` |
| 声明 `source_sha256` ≠ 文件实际原始字节 | `materialization_source_hash_mismatch`，**同时报告两值**，不按任一侧取胜 |
| 同一 `item_id` 出现两份不同字节 | `materialization_source_conflict`，**fail-closed**，禁止 last-write-wins |
| `blueprint_id` / `component_id` 与目标工作区不一致 | `materialization_blueprint_mismatch` / `materialization_component_mismatch`（跨工作区材料不得混用） |
| 缺 `authority.owner` | `materialization_authority_missing` |

### 3.4 随包样例

- 有效：[`samples/requirement-source-materialization.valid.json`](samples/requirement-source-materialization.valid.json)
- 无效（hash 冲突）：[`samples/requirement-source-materialization.invalid-hash.json`](samples/requirement-source-materialization.invalid-hash.json)

---

## 4. 接缝 2：blueprint-review-publication（Maison → 宿主）

### 4.1 契约与校验入口

| 项 | 值 |
|---|---|
| 发布件内 schema（SSOT） | **复用** `framework/harness/schemas/app-component-blueprint.schema.json`（**没有平行的 publication schema**） |
| renderer | `framework/harness/scripts/utils/blueprint-review-projection.ts`（确定性、单向派生） |
| 产物 | 工作区内 `<features_dir>/<blueprint_id>/blueprint/component-blueprint.review.md` |
| 生成与校验入口 | `check:component-blueprint --write-review` 默认本地生成；`--projection <path>` 同源校验 |

```bash
npm run check:component-blueprint -- \
  --project-root <宿主工程根> \
  --blueprint <blueprint-id> \
  --projection doc/features/<blueprint-id>/blueprint/component-blueprint.review.md
```

### 4.2 你拿到什么

默认本地文档由 Maison 生成：

```bash
npm run check:component-blueprint -- --project-root <宿主工程根> --blueprint <blueprint-id> --write-review
```

写入 resolver 定位的蓝图同目录，不支持第二输出路径。只有当前可解析、身份有效的蓝图即可生成；草稿显示准入与缺口，检查失败仍按原结论退出。无参 checker 只读展示文档当前/过期/缺失及重建命令；`--write-review` 不与材料模式混用。内容变化后的调用结束前重建，包含局部修改、草稿和质询写回；不升 revision、不重签或重做设计。接受、readiness、整批持锁指针调和与 B1 自动刷新；文档失败只披露和重建，不影响原业务结论。

投影是 Markdown，头部 frontmatter 精确绑定蓝图身份和当前有效 CU 内容：

```yaml
---
derived_from:
  artifact: component-blueprint@1
  component_id: <…>
  blueprint_id: <…>
  revision: <n>
  source_fingerprint: sha256:<…>
  artifact_sha256: sha256:<…>
  change_units:
    - change_unit_id: <unit-id>
      binding: bound
      identity_neutral_digest: <digest> # 仅 canonical 能确定原架构相关集合时提供
projection: component-blueprint-review@6
---
```

正文按概述、场景（+1）、逻辑、运行、开发、部署、取舍、质量属性/合规、验收、施工拆分、风险/待决项和编号速查组织。模型字段/枚举、接口参数/返回、完整有序步骤/分支、异常恢复、被否方案和 AC/BD/NFR 使用专用表格，不递归 dump 对象或把完整对象压成 JSON。内容只来自 canonical 蓝图与 CU，外部材料须先由设计 owner 消费形成设计事实；renderer 不读取需求原文、Feature 的 use-cases.yaml 或外部 catalog 自行补设计。

Maison 直接从 canonical CU 收集目的、交付、模块/touches、显式依赖、约束和安全中间态，精确 supersedes 生成已替代小节。逐 CU 与生产投影共用纯选取/合并逻辑，保留实际继承范围与合并冲突；完整 AC/BD/NFR 仅文档第 9 章，展示身份为来源目标加条目编号，两个目标各自 AC-1 保留；完整 files 清单仅开发视图一次，CU 以编号/链接追溯范围。文首阅读说明集中一次“是否通过交接校验见 readiness”等机制声明；可读标签优先已有 label/name/含义、缺时短 ID，框架状态枚举中文化，API/类型/自由业务状态保原名，不推断业务结论。稳定锚点/链接目标保留，原内部地址可留追溯附录；需求追溯只列真实直接引用、不裁决覆盖。readiness/run/完成状态独立，完成情况链接原 closure 投影。

单元格统一取值保留 string/number/bool/list，false/0 非空；已知业务键用专用格式，陌生业务键一层键值、不递归 dump，深层已有声明暂未展开如实说明。按所在结构排除机制元数据，来源/验证引用保留；不产空表/整空列，每节一行集中源缺项，缺失不冒充不适用。

概述跨视图图只用 canonical relations；运行阶段图只连各 branch.expected_phase_seq 相邻项，按起止对去重保留分支来源，首分支作具名基准，不把到 Success 当完整完成；模块图只 contracts 根级 module_dependencies，已声明模块补层级/变化、其它仅名称，不合成冲突并集。三类图复用 flowchart/parser，逐边追真实来源，不造稳定地址；结构图按完整地址区分同名节点、CU 依赖只 requires。完整时序展示设计期生成的 generated_graphs，relation_refs 可为空。超子集/端点/块/坏地址等时序图自身问题一律 WARN、原流程说明且不展示，不经 sourceGaps/invalid 影响准入/readiness；flowchart 原级别不变。缺对应派生结果或 stale 的时序图提示重建、不展示，缺图不加门也不证明人读完整。代码骨架不入蓝图。

相同 DTO/模型需核字段/语义/约束/来源后复用，保留 nullable 与 required 等差异；UI/恢复/验收/写集只主责处完整展示，其余链接，并保留每 CU 精确范围和多源关联，不全局删同值列。显式空对象/数组为“无”，false/0 保真，缺项汇总仅处理 renderer 标记、不改作者文本；框架枚举按消费字段中文化，未知值/API/自由状态原样。

页面清单来自 components.kind/useCases.ui_bindings；场景视图集中页面与交互截图，每张已登记图片一次，追溯表等其它位置链接；journey_steps 中 J5/JR1/JR2 等完成后去向文本保留。本批不生成页面导航图：navigation 只有 config_files，不从共享动作连页面边或由文字去向推路由。renderer 只输出已登记图片引用，不读外部图像字节作新设计事实/绑定输入。验证 A 是 canonical/CU/图片原样隔离副本、只验证展示；B 另存明确补完整调用步骤及派生图的设计变体，验证生成/质询和真实 Mermaid 预览，不混入 A、不声称原样副本凭空四图。原宿主不执行会写指针/文档的 readiness；用户集成发布件后在原工作区定向补时序、按既有修订复检文档/readiness，保留其它有效设计、不重置重做。设计专项不代替后续施工端到端验收。

owner 指针待升版时保留 CU 自身契约，模块/设计链接待绑定，合并集合标“待指针升版后显示”，不填假摘要、不承诺 carry-forward。当前精确绑定的 CU 若某层级相关性须靠外部 catalog 才能确定，则省略中立摘要，精确绑定与声明集合仍展示；原摘要算法/字段不变，不把省略变成新增来源缺口或阻断。单项坏 CU 不妨碍其余设计展示，缺口附 id/路径/原因；生成成功不等于来源完整或准入通过。内部刷新与外层补生成按整个尝试最终状态汇总，实际写入路径保留。

### 4.3 交接 readiness 的独立结论

指针调和非 busy 后，readiness 对全部未退役（含已完成旧 CU）且原设计判定 constructable 的单元，复用 `deriveBlueprintSkillInput` 默认只读模式完整检查 canonical acceptance/contracts/use_cases。另一类 absent 不漏掉已声明的坏 use_cases；Feature 的阶段用例不反向参与设计投影，未对齐当前设计时由既有定义缺口和 plan 对齐门交 plan 重建。absent 提示“设计期未写入，将由 spec/plan 补”并明确责任，不新增缺字段机器门禁；canonical 已声明的坏形状、来源、写集或冲突为 invalid，复用原原因使 perUnit blocked/not-ready，不等运行中再首次发现。

校验不物化 Feature 产物、不产 phase PASS/receipt、不重启旧 CU、不选择施工。未来 plan 映射缺失不阻断设计交接，设计投影也不证明 plan 已完成。prepare-blueprint-design 保留显式投影导出用途。不能证明 Feature 可安全刷新时保留原文件，合法 canonical CU 指针照常升版，由既有绑定或定义缺口安排 spec/plan；真实写入失败或依赖并发变化仍沿原事务回滚。不回滚用户已修订的 canonical 蓝图，文档结果与 readiness 结论分别报告。

designOnly 不调用依赖未来 plan.design_ref_mappings 的 componentProjectionErrors；合法组件索引/typed UI 设计无需提前写 change_unit。plan 及后续组件映射检查完整保留，组件选型设计仍经原门，不新增替代检查。

### 4.4 铁律：投影相对蓝图与 CU 零新事实

- 投影是 canonical 蓝图与 CU 的单向确定性派生物。宿主自由重排/翻译的 Story Document 是外部附件，不交给 canonical 投影一致性校验，不反向成为设计权威。
- 宿主仍可附 spec 等附件；部件设计权威继续在蓝图，CU 保持施工契约职责。
- 同一收集/renderer 全文比对，蓝图变化为 `publication_derived_from_mismatch`，CU 集合/内容变化为 `publication_change_units_mismatch`，旧格式为 `publication_projection_format_stale`；可同时报告。相同来源/格式正文不同为 `publication_projection_content_mismatch`，不推断新增事实或格式升级。来源缺口为 `publication_change_units_unresolved`，不能声称来源完整。
- 上述差异从当前 canonical 重建即可；旧 @1 格式不用修改 canonical revision。宿主没接外部接缝时，本地文档仍默认交付，外部归档诚实降级。

**归档时点由宿主决定**，Maison 不管。

### 4.5 随包样例

- 有效：[`samples/blueprint-review-projection.valid.md`](samples/blueprint-review-projection.valid.md)
- 历史无效样例（投影新增设计事实，保留旧 @5 格式，单独校验同时报格式过期）：[`samples/blueprint-review-projection.invalid-added-fact.md`](samples/blueprint-review-projection.invalid-added-fact.md)；当前正文新增事实反例由测试在当前有效投影上追加事实后验证。

完整样例由一个充实的框架表达夹具生成，展示两个 CU 共享/专属目标与 4+1 细节；它不是真实需求，不能替代宿主下一项正式需求从设计写作、只读校验到下游实际投影消费的验收。

---

## 5. 接缝 3：blueprint-review-feedback（宿主 → Maison）

### 5.1 契约与校验入口

| 项 | 值 |
|---|---|
| 发布件内 schema（SSOT） | `framework/harness/schemas/blueprint-review-feedback.schema.json` |
| artifact 标识 | `blueprint-review-feedback@1` |
| 校验入口 | `check:component-blueprint` 的 `--feedback <path>` 模式（reconciliation intake） |

```bash
npm run check:component-blueprint -- \
  --project-root <宿主工程根> \
  --blueprint <blueprint-id> \
  --feedback doc/reviews/ledger-r2-feedback.json
```

### 5.2 四类反馈必须显式区分

| `kind` | 含义 | 额外要求 | 能否成为设计权威 | 校验通过后是什么 |
|---|---|---|---|---|
| `opinion` | 意见 | — | ❌ | 只记录，**不进入 reconciliation** |
| `fact_supplement` | 事实补充 | 必须带 `evidence_refs` | ❌（作为证据被消费） | **事实候选**——可进入 reconciliation |
| `suggestion` | 建议 | — | ❌ | 只记录，**不进入 reconciliation** |
| `authoritative_ruling` | **授权裁决** | 必须同时带 `authority`（`owner` + `role`）与 `decision`（`verdict` ∈ accept/reject/amend + `rationale`） | ✅ | **裁决候选**——可进入 reconciliation |

**只有** `authoritative_ruling` 且 authority、`source_revision`、决策语义三者齐备，才能进入
`decided_with_authority`。缺任一项 → `review_feedback_authority_insufficient`，只能记为
意见 / 建议。非 `authoritative_ruling` 携带 `decision` → `review_feedback_non_ruling_carries_decision`。

> **校验通过 ≠ 已被接受。** `--feedback` 只判**候选资格**：它没有"Maison 已接受"这个输入，
> 因此不会、也不能声称任何反馈已被采纳或已升 revision。是否接受由蓝图的 write owner 裁决。

### 5.3 被**接受的**反馈产生新 revision，不回写旧 revision

```text
revision N（被评审）
   │
   ├── opinion / suggestion ──────────────▶ 只记录，永不进入 reconciliation
   │
   ├── fact_supplement（带 evidence）─┐
   └── authoritative_ruling（authority + source_revision + decision）─┤
                                      │  ← intake 到此为止：**只判候选资格**
                                      ▼
                          蓝图 write owner 裁决是否接受
                                      │（接受）
                                      ▼
                          经既有 reconciliation ──▶ revision N+1
                             · 受影响的 P1 派生结论标 stale 并按新 revision 重算
                             · revision N 原样保留为历史，不被修改
```

**`--feedback` 的输出是候选，不是结果**：`authoritativeRulingCandidateIds` /
`factSupplementCandidateIds` / `requiresReconciliation`。它们表示"够格进入 reconciliation"，
**不表示已被接受、更不表示已升 revision**。未被接受的候选不改变任何 revision。

- `source_revision` 必须指向**当前** canonical revision；指向旧 revision →
  `review_feedback_stale_source_revision`（这正是"不得回写旧 revision"的机器表达）；
- `target_ref` 必须能在该 revision 内解析为蓝图稳定地址（`view:` / `view:…/node:` /
  `relation:` / `decision:` / `contract:` / `view:runtime/flow:` 等）；否则
  `review_feedback_target_unresolvable`。

### 5.4 随包样例

- 有效：[`samples/blueprint-review-feedback.valid.json`](samples/blueprint-review-feedback.valid.json)
- 无效（authority 不足却声称裁决）：[`samples/blueprint-review-feedback.invalid-authority.json`](samples/blueprint-review-feedback.invalid-authority.json)

---

## 6. 两条最小接入流程

### 6.1 单 CU 正式需求（最常见）

```text
1. 宿主：拉取需求 → 脱敏 → 写入 doc/requirements/<name>.md
2. 宿主：产出 materialization 清单（1 项，authority.formality=formal_requirement）
3. 校验：check:component-blueprint --materialization …            ← 接缝 1
4. Maison：/component-design <blueprint-id>
     · 正式性确认（上游已标 formal_requirement → 直接采信）
     · 完成 4+1 与目标上的 acceptance/contracts/use_cases → 独立质询 → 调和 → admitted
       （按真实影响展开必要细节；未触发的义务是空集，不用空章节凑）
     · 设计准备子流程：0 CU 入口 → 1 个候选 → validator 原子写 1 个 canonical CU
     · 默认只读 readiness 完整校验 → 返回当前人读文档链接与独立交接结论
5. 施工：/change-unit-progression（该 CU 按 L1 lite 或 L2 full 分档施工）
6. 闭环：/component-closure（跨单元组装边为空集合法，退化为追溯核对）
7. Maison：默认本地文档已生成并链接；（可选）宿主装配 Story Document                      ← 接缝 2
8.（可选）宿主：评审结论回灌，授权裁决生成新 revision              ← 接缝 3
```

### 6.2 多 CU 正式需求

与 6.1 相同，差别在第 4 步蓝图内部会**额外触发**条件式设计义务：

- **CU 边界与关系分析**：真实依赖、共享资源、可并行性、独立性。**只有事实要求时**才写
  `requires` 与顺序约束——不得为了记录"我想先做 A 再做 B"伪造依赖边（顺序意图放优先级）；
- **共享部件级决策**（数据真源、状态 owner、外部契约、迁移顺序）：**只在蓝图裁决一次**，各
  CU 通过 `design_refs` 消费，不在多个 Feature plan 里各裁一次；
- **组合闭环义务**：当"各 CU 单独绿了仍不能证明整体完成"时，closure 追加真实组装与组合证据。

设计准备子流程一次接受整批候选并**原子**写出 N 个 canonical CU：任一候选不通过就整批拒绝、
一个字节都不落盘。施工阶段仍是**单并发**——一次一个 CU。

---

## 7. Story 类扩展的职责映射

如果你们已经有一个自制的 `/story` 类扩展，按下表改接，不要保留平行的设计语义：

| 原扩展里的逻辑 | 改接到 |
|---|---|
| 上游拉料 / 脱敏 / 落盘 | **接缝 1** 的 requirement-source provider |
| Story 设计文档的**设计部分**（方案、取舍、被否方案、部件级决策） | 由 **`/component-design` + 部件演进蓝图**取代——这是唯一 canonical 设计产物 |
| Story 归档 / 发布到评审系统 | **接缝 2** 的 publication consumer（读 admitted revision 的投影后装配） |
| 评审意见拉回 / 落到设计文档 | **接缝 3** 的 review-feedback provider（四类分类 + authority 门槛） |
| “先写 spec 再反向装配设计文档”的 spec 入口 | **改接蓝图生成的 CU**——正式需求的 spec 一律位于蓝图与 CU 之后 |

> **为什么要换**：把设计语义留在评审载体里，会让评审文档同时是"派生物"又是"有判断的设计
> 真源"，形成平行真源。蓝图承担设计权威后，Story Document 可以安心做零新事实的投影。

### 7.1 用 extension 承载三条接缝

Maison 3.1 的 `/extension` 是这三条接缝的静态输入通道，不是插件运行时。宿主把自己的 Story
能力写成 `doc/extensions/skills/<id>/SKILL.md`，并在 manifest 1.1 的 `provides.skills[]` 声明；
该 Skill 负责按宿主规则调用已经可用的工具、脱敏、落盘，再显式调用 `/component-design`：

```text
extension Skill
  → 宿主工具获取 / 脱敏 / 项目内落盘
  → mcp_actions.produces: requirement-source-materialization@1
  → check:component-blueprint --materialization …
  → /component-design
  → 读取 component-blueprint.review.md 装配 Story Document
  →（可选）mcp_actions.produces: blueprint-review-feedback@1
  → check:component-blueprint --feedback …
```

- manifest 只写 `tool / required / severity / produces / usage`，不写 server、URL、token、command
  或登录配置；工具执行与凭据均归宿主，Maison 只验证仓内产物。
- `phase_bindings` 只管 Feature phases，**没有** `before_component_design`；设计前置动作由扩展 Skill
  自身流程承载。设计前知识使用可选 `provides.skill_assets.component-design.knowledge`（如 `knowledge/design-background.md`，相对扩展根安全解析）；`assembleKnowledge` 与根 component-design Skill 在 P1 discovery 前读取。extension 优先于 profile 的 `assets.component-design.knowledge`；均未声明合法，已声明却不可读不静默回退，不新增 audience。
- `/extension inspect` 只在产物实际 `artifact` 被识别且通过既有 validator 后，才把 materialization /
  feedback 标成 `evidenced` 并显示 `/component-design` 与接缝名；`usage` 文本不参与判断。工具可见性
  只标 `agent_self_report`，不冒充完成证据。
- 最小 manifest 见 [`samples/extension-m7-manifest.yaml`](samples/extension-m7-manifest.yaml)。其中路径与
  tool id 是示例，接入时须替换为真实项目值。

---

## 8. 适配检查清单

在宣称"宿主已接入"之前，逐项验证：

- [ ] 物化清单通过 `--materialization` 校验（正例 PASS）
- [ ] 故意改一个 `source_sha256` → 校验 FAIL 且**同时报告声明值与实际值**
- [ ] 故意让同一 `item_id` 出现两份不同字节 → fail-closed，不是后写取胜
- [ ] 正式需求缺物化材料时，你的流程会**停下**并报 blocker，而不是凭转述继续
- [ ] 评审投影通过 `--projection` 校验（正例 PASS）
- [ ] 新需求实读 4+1 各视图与模型/接口/步骤/分支/验收子表，七问能由实际内容回答，图表关系与 CU 一致
- [ ] 两 CU 引用共享/专属目标时，各自实际继承的验收与 files 可核对，对象冲突没有被逐键拼接或隐藏
- [ ] readiness 的默认完整检查与文档声明集合分别报告；后续 spec/plan 实际消费同源 typed 内容，来源戳与规范化物化内容可核对
- [ ] 适用的 P0 真机 UI 关联来自真实 ui-spec，只补缺键且保留原验收预期；表达夹具不代替这项真实宿主证据
- [ ] 在投影里加一句 canonical 中不存在的设计结论 → 校验 FAIL
- [ ] 投影装配出的 Story Document **没有**成为下一轮设计的输入
- [ ] 反馈清单通过 `--feedback` 校验（正例 PASS）
- [ ] 去掉 `authority` 后仍标 `authoritative_ruling` → 校验 FAIL
- [ ] 把 `source_revision` 改成旧 revision → 校验 FAIL
- [ ] 合法授权裁决走完 reconciliation 后，产生的是**新** revision，旧 revision 字节未变

## 9. 验证命令速查

```bash
cd framework/harness

# 蓝图本体
npm run check:component-blueprint -- --project-root <root> --blueprint <id>

# 接缝 1
npm run check:component-blueprint -- --project-root <root> --blueprint <id> --materialization <path> --json

# 接缝 2
npm run check:component-blueprint -- --project-root <root> --blueprint <id> --projection <path> --json

# 接缝 3
npm run check:component-blueprint -- --project-root <root> --blueprint <id> --feedback <path> --json

# CU 与闭环
npm run check:change-unit      -- --project-root <root> --blueprint <id> --unit <cu-id>
npm run check:component-closure -- --project-root <root> --blueprint <id>
```

`--json` 输出含 `status`、`host_seam_modes`（本次评估了哪几条接缝）与 `issues[]`。

## 10. 常见错误

| 症状 | 真因 | 处理 |
|---|---|---|
| `materialization_source_unresolvable` | `source_ref` 用了绝对路径、项目外路径，或 `#fragment` 在文件里不存在 | 改成项目内相对路径；fragment 必须是文件内真实出现的文本 |
| `materialization_source_hash_mismatch` | 物化后又改了文件，hash 没重算 | 重算 hash；不要用 `source_revision` 顶替内容 hash |
| `materialization_authority_missing` | 只填了 `formality` 没填 `owner` | 两者都要——`owner` 是"谁负责"，`formality` 是"上游怎么分类" |
| `publication_projection_content_mismatch` | 相同来源/格式的投影正文不同 | 从 canonical 蓝图/CU 重建；自由 Story Document 作为外部附件 |
| `publication_change_units_mismatch` / `publication_projection_format_stale` | CU 内容/集合或 renderer 格式变更 | 执行 --write-review，无需改 canonical revision |
| `publication_derived_from_mismatch` | 用了旧 revision 的投影，或手改了 frontmatter | 重新生成投影 |
| `review_feedback_authority_insufficient` | 评审系统只给了"同意/不同意"，没有 owner+role 或没有 rationale | 补齐；补不齐就老实标成 `opinion` |
| `review_feedback_stale_source_revision` | 评审是针对 revision N 做的，期间蓝图已到 N+1 | 反馈必须针对当前 revision；先重新评审，或让裁决方确认在新 revision 上仍成立 |
| `review_feedback_target_unresolvable` | `target_ref` 用了展示标题而不是稳定地址 | 从投影正文里取稳定 id（`view:…`、`view:…/node:…`、`relation:…`、`decision:…`、`contract:…`） |
| 蓝图校验报 `blueprint_evolution_impact_no_changed_view` | 所有视图都标了 `verified_unchanged` | 本次不构成演进——要么它其实不是正式需求，要么漏标了真正改动的视图 |
| 蓝图校验报 `blueprint_view_unchanged_masks_change` | 视图标了 `verified_unchanged`，里面却有节点声明了本次 delta | 把该视图改回 `changed`，或修正节点 |

---

## 11. 明确不在本文范围

- **不涉及任何内网敏感实现**：需求单号、token、URL、评审系统 API、归档接口都留在宿主侧，
  Maison 既不需要也不接收；
- 不规定你们的评审系统、权限机制或归档时点；
- 不提供把宿主 Story 扩展改造成 adapter 的具体代码——本文给的是契约、失败语义与验证方式，
  实现由宿主自己按语言与工程习惯完成。

组件库存接入沿 [组件资产 SSOT](../concepts/component-assets.md)：所有蓝图增加静态 optional component-assets Seam Card，changed development 的 UI 节点经五级选型 decision 接入原 CU design_refs。宿主只提供可选 index/catalog 输入，不另建 provider registry；无资产时按 UI 维度和 needed_by 如实保留 unknown/gap。

development 节点的模块身份：3.1.0 起 `applicable` + `changed` 的 development 视图中每个节点都须填 `module`（module-catalog 模块，或本蓝图 `architecture_impact` 的 add_module / move_module / retire_module 决策声明的模块；`owner` 仍只表示责任方）。宿主在途蓝图升级后须补该字段，否则 P1 报 `blueprint_node_module_missing`（填了但不是获准模块报 `blueprint_node_module_unadmitted`）。CU 的可修改模块集合由 `touches` 指向节点的 `module` 派生，spec/plan 只投影。
