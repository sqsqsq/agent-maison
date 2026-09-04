# App Component Blueprint Skill

为一个 App 部件建立、检查和调和 provider-neutral 的 canonical 蓝图。蓝图是一次演进的设计权威（2026-08-21 裁决：不是部件常驻真源）；本 Skill 不创建 Change Unit、P2 ready set 或 P3 closure。

## 触发条件

- “发现 App 部件 / 建部件蓝图 / 适配 4+1 / 调和蓝图”
- `/app-component-blueprint <blueprint-id>`

> **入口关系（M7）**：**正式需求的常规入口是 [`/component-design`](../component-design/SKILL.md)**
> ——它编排"需求源物化 → 正式性判定 → 本 Skill 建蓝图至 admitted → 分解 1..N 个 canonical
> CU → readiness"。本 Skill 保留为**直接入口**：已明确要建 / 调和某份蓝图时可以直接进入。
> 蓝图是每项正式需求在当前部件内的设计权威，不是"复杂多 CU 才启用的可选路线"；只有一种
> 协议，内容深度由本次演进的真实影响面派生（**没有 compact/full 档位或升级状态机**）。
>
> **支持范围**：当前只有 `hmos-app` / App component profile 具备 design lens。请求为其它
> component type 建蓝图时，返回明确的 unsupported / missing design lens 失败，不得把它们
> 强行送入 App 4+1 视图后宣称已支持。

> 真实宿主的正式需求在进入蓝图前，材料准入与缺失路由见
> [真实宿主准入与回灌契约](../../reference/real-host-admission-and-feedback.md)（适用范围内）；
> 宿主侧三条接缝的适配细则见
> [宿主适配指南](../../../docs/operations/component-design-host-adaptation.md)。

## 正式产物

唯一机器 SSOT（演进工作区布局，硬切无兼容）：

```text
<features_dir>/<blueprint_id>/blueprint/component-blueprint.yaml
```

`<features_dir>` 为 `paths.features_dir`（默认 `doc/features`，经框架解析，不硬编码）。`blueprint_id` 是稳定路径标识，必须是单个安全路径段（`^[A-Za-z0-9][A-Za-z0-9._-]*$`）；一次演进定名后不改，不为展示名改名。`component_id` 保留在 YAML 与所有 ref 中做所有权/一致性核验，**不再充当任何路径键**。不得用 feature 身份定位，不扫描 legacy 目录，不回退旧根 `blueprint/component/`，不建立 registry。同目录生成评审投影 `component-blueprint.review.md`（`derived_from` 指回 YAML），展示视图 current/target/delta、runtime flow、契约 mapping、跨视图关系、质询和准入，不得反向覆盖 YAML。

## 静态 provider 顺序

1. `current-facts-discovery`：读取产品需求、代码、schema、接口、配置、测试及 architecture/catalog/code-graph；当前事实逐项保留 provenance 和冲突。
2. `conventions-knowledge`（optional）：按 `paths.conventions`（缺失用 `doc/conventions.md`）解析；文件存在时必读全文，只把真正适用的 `##` id 交给既有 facts/provenance；默认未启用记 `not_applicable`，显式配置却不可读记 `unknown|degraded`。
3. `se-manual-contracts`：消费 SE/授权 owner 的 operation、DTO、mapping、错误、幂等和 NFR；来源不可达时保持 unknown，不编造字段。
4. `app-design-lens`：回答模块边界、能力接缝、feature flag、生产者/消费者、生命周期、state owner、初始化、发布订阅、UI refresh、进程恢复十个根问题。
5. `independent-design-questioning`：在隔离上下文质询适用视图、关系、flow、根问题，以及适用惯例是否已被相关视图/decision 引用；编写方不得自证。

provider 固定内置并消费同一协议；id 必须唯一，requirement 只允许 `required|optional`，权威与来源规则不得由蓝图作者覆盖。不得动态加载、注册第二个全局 provider 真源，亦不得写 Goal events/receipt/evidence 或 P2/P3 状态。

## 工作流

### 1. 发现与权威分位

- 当前事实优先引用代码/schema/接口/配置/测试；知识资产提供稳定背景，不覆盖本次事实。当前范围的 requirement/goal/invariant/high-risk 必须在 `discovery.inputs.current_scope_items` 形成带稳定 id、可解析 source ref、provenance 和项目内来源实际原始字节 hash 的闭集；revision 可附加但不能替代 hash，并由 `discovery.requirement_traceability` 双向一一映射到真实蓝图稳定地址。
- 惯例文件存在时完整读取，只把适用条目写入 `discovery.facts`：`provenance.source_kind: convention`、`source_ref: <配置路径>#<id>`、`evidence_strength: authoritative`。视图节点与 decision 继续用既有 `provenance` / `verification_refs` 引用同一 source ref；禁止新增 conventions 专用字段。
- 同一语义冲突时保留双方 source ref 与 owner，禁止 last-write-wins。
- 外部契约按 `contract_id` 建 operation→request/response DTO→mapping→error/idempotency/NFR 链；逐段解析项目内 `source_ref` 指向的权威文件/fragment 并真实比对，来源缺失或语义不同即 blocker。
- mapping 只验证权威 wire 字段和显式转换/派生边；禁止将 wire DTO 与领域模型逐字段同形比较。

### 2. 写入同一蓝图

canonical YAML 根对象含 `component_id`、`blueprint_id`、`revision`、`source_fingerprint`、`decision_fingerprint`、整体 provenance，以及 `review_summary`、`design_views`、`decisions_and_gaps`。根/discovery `source_fingerprint` 必须只由规范化 discovery facts 与 current-scope source identity/provenance/revision/hash 重算一致；requirement→blueprint mapping 不进入该指纹，其变化由 revision、artifact hash 和下游 input fingerprint 捕获。所有稳定对象保留 owner、provenance、verification refs；语义替换使用新 id 并记录 `supersedes`。

`evolution_candidate` 的 `human_decision` 只能是 `establish_seam|keep_direct`。前者必须以四个互不复用、同时进入 decision tests 的精确 `closure_proofs` 绑定契约兼容、Provider 替换、缺失/失败与 Consumer no-bypass 证明；后者只保留普通施工语义并记录再提取条件。

4+1 使用固定 view id：`logical`、`runtime`、`development`、`deployment`、`scenarios`。前四项中除 deployment 外，对可执行 App 均为 applicable；deployment 即使不适用也保留证据化裁决。

**两个正交维度（M7）**：`applicability`（部件类型固有适用性，二值 `applicable|not_applicable`，`not_applicable` 仍仅限 deployment）与 `evolution_impact`（本次演进影响，`changed|verified_unchanged`，**只由 applicable 视图携带**）互相独立，不得合并成三态枚举。

- `applicable` + `changed`：全量义务（非 unknown 的 current/target/delta、≥1 可寻址节点、verification_refs）；
- `applicable` + `verified_unchanged`：必须带 `unchanged_evidence`（`evidence_refs` 非空 + `current_state_ref`）与非 unknown 当前态，据此**免除** target/delta 与节点义务；该视图内任一节点声明本次 delta 即失败（不变声明不得掩盖真实变化）；其质询义务是**核实不变声明与依据**，只接受 `answered_with_evidence`；
- **至少一个 `applicable` + `changed` 视图**；全部 `verified_unchanged` = 本次不构成演进，fail-closed；
- 六类 runtime flow 触发条件**只对 `runtime` = `changed` 评估**。

### 3. 运行时流与跨视图检查

逐项裁决六类 flow 触发条件。触发时记录 source-of-truth/reconciliation、trigger idempotency、initial-load freshness、state owner、mutation/publication/subscription cleanup、consumer、failure/recovery、证据和验证引用，并覆盖 cold start、warm resume、page attach/detach、account switch、process recreation、background write。闭环关键集合不得为空；局部 id 唯一，mutation/subscription/consumer 的引用必须解析到真实 flow 对象。

scenario 必须追到 logical/runtime/development 以及适用 deployment；runtime flow 必须追到 logical contract 和 development owner。缺边作为 frontier，不用图或标题补齐。

### 4. 质询、准入与调和

- 独立质询从 canonical YAML 派生 scope，唯一覆盖每个 view/relation/runtime flow 和十个 App 根问题，并逐项给出 evidence、disposition、frontier fingerprint、owner 和 verification refs。
- root questions、contracts/design refs readiness 和 admission status 由实际质询/App lens 及 checker 结果派生，不接受自报布尔值。
- 当前切片依赖的 unknown 必须 blocker；远期 open decision 必须有 owner、needed-by 和解除条件。
- 决策/契约版本/视图适用性变化时，只把 P1 自身派生结果标 stale 并按新 revision 重算；历史保留 provenance。
- 下游发现 `component_blueprint_ref` 的 revision/source_fingerprint/artifact_sha256 不匹配时，在各自权威内重新派生；P1 不代写 ready/closure。

### 5. 检查

在消费者工程的 `framework/harness` 中运行：

```bash
npm run check:component-blueprint -- --project-root <宿主根> --blueprint <blueprint-id>
```

需要解析稳定切片时，传入序列化 `component_blueprint_ref`。target 支持 `blueprint|view|node|relation|flow|decision|contract`；只有 node/flow 强制 `view_id`，decision/contract 是顶层稳定对象，contract 以 `contract_id` 寻址。resolver 在返回 target 前必须先通过 canonical schema/完整性门。蓝图/评审投影/closure 投影同处工作区 `blueprint/` 目录。

只有本轮生成 Mermaid 时才校验其 parser 和引用。未生成图不阻塞；生成图可解析也不替代结构化完整性。

## 完成边界

checker 无 BLOCKER，独立质询完成，当前切片可施工，P1 派生结果与当前 revision/fingerprint 一致。此结果只代表 P1 蓝图完成，不代表 P2 Change Unit 或 P3 Component closure 完成。
