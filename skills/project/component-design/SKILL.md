---
name: component-design
description: Formal-requirement entry into the component-internal design stage — materialize sources, confirm formality, build and admit a component evolution blueprint, decompose into 1..N canonical Change Units, and hand off to construction. Use for any formal requirement before spec/plan/change-lite; it stops at design handoff and never enters the P2 selector, Goal Mode or P3 closure.
---

# Component design（正式需求的部件内设计阶段）

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `design.formality_routing`
> —— 正式性判定信息不足时以该确认点提问并停等（选项文案从 confirmation-registry.yaml 逐字引用）；
> 其余步骤沿用被调用 Skill 各自的确认点。

**每一项正式需求都要先经过这里。** 组织侧把这个活动称为 **Story Design**；Maison 侧唯一
canonical 设计产物是**部件演进蓝图**（Component Evolution Blueprint）。

本 Skill 是一个**纯编排入口**：零新 CLI、零新状态、零新 registry。每一步都调用既有能力
（[app-component-blueprint](../app-component-blueprint/SKILL.md) 建蓝图、P2 设计准备子流程
写 CU），自身**不直接写 canonical CU**、不启动 Goal Mode。

## 触发条件

- “新需求 / 要改这个功能 / 这个 Story 怎么做 / 建部件设计 / Story Design”
- `/component-design <blueprint-id>`
- `/spec` 或 `/change-lite` 的正式性兜底复核指回本入口时

## 正式性判定（第 0 步，必答）

> **正式需求**＝有明确交付或验收责任，且拟改变**部件行为、外部契约、数据/NFR、运行语义
> 或架构责任**的事项；不改变这些语义的**纯文档和机械维护**除外。

三条判定纪律：①**上游权威**——上游显式标为正式需求时该分类具权威性，不得用本地启发式降级；
②**信息不足由人确认**——判据不足时问人并等待确认，不猜测、不默认按任一侧处理；③**不加机器门**
——不新增 `track_scoring` 条目、不新增档位、不加机器 BLOCKER，判定结果不是可手改的持久状态字段。

判定为**非正式维护动作** → 不建蓝图，走既有 L0（直接改）或 L1 lite 轨，本 Skill 到此结束。

## 支持范围（诚实声明）

当前**只有 `hmos-app` / App component profile 具备 design lens**。为其它 component type
（Service、Library 等）建蓝图时**明确返回 unsupported / missing design lens 失败**并说明缺什么，
不得强行送入 App 4+1 后宣称已支持；lens 建设由各自 profile 的独立变更承担。

## 编排流程（终点=设计交接）

### 1. 需求源物化（seam：requirement-source-materialization，宿主 → Maison）

宿主负责获取、脱敏并把来源材料落到**项目内**；Maison 只消费项目内可解析的 `source_ref`、
原始字节 `source_sha256`、`provenance` 与 `authority`。Maison 不知道内网标识、token、URL 或
归档 API。

```bash
cd framework/harness
npm run check:component-blueprint -- --project-root <宿主根> --blueprint <blueprint-id> \
  --materialization <物化输入.json>
```

- 契约 schema：`framework/harness/schemas/requirement-source-materialization.schema.json`
- **单一判据**：每项正式需求最终必须形成**至少一个合法 `currentScopeItem`**。达成方式两条，
  都合法、产出同一形状：
  - 来源来自**宿主 / 外部 provider** → 走上面的 `requirement-source-materialization@1` 文件接缝；
  - **直接人工 / inline / 本地文件**输入 → 由蓝图 builder 直接规范化为同一 `currentScopeItem`，
    **不强制额外制造一份 provider manifest**（小正式需求不必为此多产一个 JSON）；
- 两条路径都**不得无来源、凭模型转述**生成 scope item：项目内可解析 `source_ref` + 原始字节
  hash + provenance + authority 一个都不能少；缺来源 → 结构化 blocker（带 owner 与解除条件）；
- 来源 hash 冲突（声明值 ≠ 项目内实际原始字节，或同一 `item_id` 两份不同字节）→ **fail-closed**，
  同时报告双方，禁止 last-write-wins；
- 宿主适配细则与最小示例见
  [宿主适配指南](../../../docs/operations/component-design-host-adaptation.md)。

### 2. 蓝图发现 / 设计 / 质询 / 调和 → admitted

调用 [app-component-blueprint](../app-component-blueprint/SKILL.md) 的既有流程，含组件资产读取、live 检索、decision 与 optional provider 可用性裁决；CU design_refs 引用选型，Feature 仅投影。
current-facts-discovery 前解析 `paths.conventions`（缺失用框架默认值）；文件存在时完整读取，只将适用条目交给既有 fact/provenance/decision 链。`conventions-knowledge` 未启用记 `available=false + not_applicable`，显式配置却不可读记 `unknown|degraded`，不得声称已消费。

**内容深度由本次演进的真实影响面派生**（条件式设计义务），只有一种蓝图协议——**没有
compact/full 档位、没有升级信号、没有升级状态机**：

| 维度 | 语义 | 取值 |
|---|---|---|
| `applicability` | 部件类型固有适用性 | `applicable` / `not_applicable`（后者仍仅限 deployment，且须证据化裁决） |
| `evolution_impact` | 本次演进影响（仅 applicable 视图携带） | `changed` / `verified_unchanged` |

- 至少一个 `applicable` + `changed` 视图；全部 `verified_unchanged` = 本次不构成演进，
  fail-closed；
- `verified_unchanged` 必须带 `unchanged_evidence`（事实依据 + 当前态引用），据此免除
  target/delta 与节点义务；视图内任一节点声明本次 delta 即失败——不变声明不得掩盖真实变化；
- 小正式需求得到**薄蓝图**：未触发的义务表达为空集/不适用的合法结论，不用空章节凑齐形式。

**条件式设计义务**（只在对应事实被发现时触发）：

| 发现 | 义务 |
|---|---|
| 多个 CU | 完成 CU 边界与关系分析（真实依赖、共享资源、可并行性、独立性）；**只有事实要求时**才生成 `requires` 与顺序约束，不得为记录先后伪造依赖边 |
| 共享部件级设计决策 | 只在蓝图裁决一次，各 CU 经 `design_refs` 消费；不在多个 Feature plan 各裁一次 |
| “单独绿 ≠ 整体完成” | Component closure 追加真实组装与组合证据义务 |
| （通用，单/多 CU 都适用） | 每个 CU 的 `safe_intermediate_state` |

### 3. 分解为 1..N canonical Change Unit（经 P2 设计准备子流程）

**本 Skill 自身不写 canonical CU。** 落盘经既有 P2 设计准备子流程完成：

1. 入口 = admitted blueprint —— **canonical CU 数量为 0 是合法入口**；
2. decomposition provider / 设计者只提出**临时候选**（内存 / 临时报告）；
3. **只有 consumer validator** 可以接受候选：校验 schema、canonical identity、设计闭包、
   provenance 与来源权威后，**原子**写出 1..N canonical `change-unit@1`。任一候选不通过即
   整批拒绝、一个字节都不落盘；
4. 重复接受 **fail-closed**：目标 canonical 路径已存在即拒绝，修正已接受单元走新的
   修订 / superseding CU；
5. 派生 design gate / readiness。

一项正式需求只分解出**一个** CU 是正常正向路径，不是退化形态。

### 4. Readiness 与后续施工入口（终点）

派生每个 CU 的设计可施工门与 readiness，输出设计交付结果与下一步建议：

- 施工：[`/change-unit-progression`](../change-unit-progression/SKILL.md)
- 闭环：[`/component-closure`](../component-closure/SKILL.md)

**边界（BLOCKER）**：本 Skill **停在设计交接**——不进入 P2 selector、不进入 Goal Mode 施工
循环、不进入 P3 closure、不选择任何 CU、不启动任何 run。

### 5.（可选）评审投影与反馈回灌

- **publication（Maison → 宿主，optional）**：输出指定 admitted revision 的确定性评审投影
  （`component-blueprint.review.md`），供宿主装配 Story Document / 归档件。投影 `derived_from`
  精确指向该 revision、**零新设计事实**；宿主可在其后附加 CU/spec 施工附件，但**附件不成为
  部件内设计的事实来源**。宿主未接该接缝 → 诚实降级，不宣称已归档。校验：`--projection <path>`。
- **feedback（宿主 → Maison，optional）**：结构化评审反馈必须区分**意见 / 事实补充 / 建议 /
  授权裁决**四类。只有同时具备 `authority`、`source_revision` 与明确 `decision` 语义的
  `authoritative_ruling` 才能进入 `decided_with_authority`。**校验只判候选资格，不代表已被
  接受**——是否接受由蓝图 write owner 裁决；被接受的事实补充与授权裁决才按既有 reconciliation
  生成**新** revision，**不得回写旧 revision**；意见与建议永不触发 revision 递进。契约 schema
  `framework/harness/schemas/blueprint-review-feedback.schema.json`；校验：`--feedback <path>`。

## 完成边界

设计交接完成 = **admitted blueprint + 已分解 1..N canonical CU + 每个 CU 建立 `design_refs`
引用 + 后续施工 readiness**。

注意分层：**合法 `component-blueprint@1` 的判据不含 CU 数量**（P1 不反向依赖 P2）——
`admitted blueprint + 0 CU` 是合法状态、是设计准备子流程的入口；"完整设计交付"才要求 CU。

本结果只代表**设计阶段**完成，不代表任何 Change Unit 已施工、也不代表 Component closure
已成立。

## 关联文件

- 宿主适配唯一人读入口：[component-design-host-adaptation.md](../../../docs/operations/component-design-host-adaptation.md)
- 真实宿主准入与回灌契约：[real-host-admission-and-feedback.md](../../reference/real-host-admission-and-feedback.md)
- 蓝图协议：[app-component-blueprint](../app-component-blueprint/SKILL.md)
