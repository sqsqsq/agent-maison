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
`design_refs` 与 readiness。两者均不自动启动施工或闭环。

| 谁 | 负责什么 |
|---|---|
| **宿主** | 从你们自己的需求系统**获取**原始材料、按你们的规定**脱敏**、把结果**物化**成项目内的文件；接收 Maison 输出的评审投影并装配成你们的评审 / 归档件；把评审结论按结构化格式送回 |
| **Maison** | 按请求创建或继续设计；完整交接时使蓝图 admitted、首次分解或复用 1..N canonical Change Unit 并派生 readiness；输出确定性的评审投影，被接受的新事实或授权裁决按既有调和规则生成新 revision |

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
| 校验入口 | `check:component-blueprint` 的 `--projection <path>` 模式 |

```bash
npm run check:component-blueprint -- \
  --project-root <宿主工程根> \
  --blueprint <blueprint-id> \
  --projection doc/features/<blueprint-id>/blueprint/component-blueprint.review.md
```

### 4.2 你拿到什么

投影是 Markdown，头部 frontmatter 精确绑定被评审的 revision：

```yaml
---
derived_from:
  artifact: component-blueprint@1
  component_id: <…>
  blueprint_id: <…>
  revision: <n>
  source_fingerprint: sha256:<…>
  artifact_sha256: sha256:<…>
projection: component-blueprint-review@1
---
```

正文包含设计视图（含 `Applicability` 与 `Evolution impact` 两个**正交**维度）、运行时数据流、
权威契约、跨视图关系、独立质询、准入与决策/缺口。

启用工程惯例后，蓝图实际采用的 convention id/source_ref 会由同一 renderer 输出为
`Adopted conventions` 节；仍经同一 `--projection` 校验，宿主不补造另一份惯例正文。
未启用时只有 canonical `providers[]` 中的 `conventions-knowledge` 卡诚实标记不可用，投影不凑空节。

### 4.3 铁律：Story 投影零新事实

- 投影是 canonical YAML 的**单向确定性派生物**。宿主可以重排版式、翻译、套模板生成 Story
  Document；**不能在其中新增、改写或删除设计事实**；
- 宿主可以在 Story Document 后面附加 CU / spec 等**施工附件**，但**附件不成为部件内设计的
  事实来源**——下一次评审、调和与闭环只认 canonical 蓝图；
- 校验会用同一 renderer 重算并比对：不一致即 `publication_projection_added_facts`；
  `derived_from` 未精确绑定 revision 即 `publication_derived_from_mismatch`；
- 宿主没接这条接缝 → **诚实降级**（没有人读投影），核心蓝图链不受影响，但不得宣称已归档。

**归档时点由宿主决定**，Maison 不管。

### 4.4 随包样例

- 有效：[`samples/blueprint-review-projection.valid.md`](samples/blueprint-review-projection.valid.md)
- 无效（投影新增设计事实）：[`samples/blueprint-review-projection.invalid-added-fact.md`](samples/blueprint-review-projection.invalid-added-fact.md)

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
     · 建立蓝图 → 独立质询 → 调和 → admitted
       （小需求得到薄蓝图；未触发的义务是空集，不用空章节凑）
     · 设计准备子流程：0 CU 入口 → 1 个候选 → validator 原子写 1 个 canonical CU
     · readiness → 返回设计交接结果
5. 施工：/change-unit-progression（该 CU 按 L1 lite 或 L2 full 分档施工）
6. 闭环：/component-closure（跨单元组装边为空集合法，退化为追溯核对）
7.（可选）宿主：读评审投影装配 Story Document                      ← 接缝 2
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
  自身流程承载。绑定到 `/component-design` 的知识继续用 `skill_assets`。
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
| `publication_projection_added_facts` | Story Document 模板往投影里塞了额外结论 | 额外内容放在**投影之外**的附件里；投影本身保持零新事实 |
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
