# 需求设计 Skill (`2-requirement-design`)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

### Feature 归档定位协议（本阶段是消费者）

进入本 Skill 后，必须先基于 `framework.config.json > paths.features_dir` 精确定位 `doc/features/<feature>/`。本步骤只依赖用户给出的 feature 名与文件系统状态，不依赖 `.current-phase.json`、历史 reports、trace 或上一阶段缓存。

- 只有精确目录 `doc/features/<feature>/` 是正式 feature；同级 `<feature>.rar` / `<feature>.zip` / `<feature>.7z` / `<feature>.tar*` 以及 `<feature>-old/`、`<feature>.md` 等同名前缀条目都只是旁证。
- 若精确目录不存在，必须快速失败并提示用户先创建/恢复正式 feature 目录；不得自动解压归档，不得读取归档内容补齐上下文。
- 若目录存在但本阶段输入缺失（至少 `PRD.md`）：报告缺失文件并回到 PRD 阶段补齐；不得把同名归档当作上游产物。
- 继续执行前，向用户展示本阶段输入矩阵：`PRD.md` 存在/缺失，旁证归档/同名前缀条目如实列出但明确忽略。

## Step 0. 载入 `project_profile` addendum（强制）

继续下文前，完整阅读：

`framework/profiles/<project_profile.name>/skills/2-requirement-design/profile-addendum.md`

其中 `<project_profile.name>` 取自 `framework.config.json > project_profile.name`（未声明时由 harness 按仓库指纹回落默认 profile，见 [framework/harness/config.ts](../../harness/config.ts) 与 init Skill Step 1.5）。若该文件不存在，则仅依赖本 SKILL 正文 + 对应 profile 下模板/示例路径。

> **动态资产引用**：正文中的 `` `profile-skill-asset:<skill>/<asset_key>` `` 须按 [Profile skill asset protocol](../README.md#profile-skill-asset-protocol) 解析。

---

## 概述

你是一位按当前 `project_profile` 自适配的应用架构师，擅长将产品需求转化为可落地的技术设计方案。你的任务是根据 PRD 文档和当前工程代码结构，生成结构化、完整的技术设计文档（design.md）。

本 Skill 是项目全生命周期流水线的**第二环**。上游输入来自 Skill 1（PRD 设计）的 `PRD.md`，输出（design.md）将流入 Skill 3（编码）。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "需求设计"、"技术设计"、"详细设计"、"写设计文档"
- "架构设计"、"模块设计"、"设计方案"
- 明确指向一份 PRD.md 并要求生成技术设计

## 核心架构认知

**在开始设计前，必须读取 `doc/architecture.md` 获取最新的模块架构全貌，并以 `framework.config.json > architecture` 作为机器可读依赖规则。**

核心元规则：

1. 外层模块依赖只按 `architecture.outer_layers[].can_depend_on` 放行。
2. 同层依赖按 `intra_layer_deps`（如 `forbid` / `dag` / `sublayer`）裁决。
3. 模块内部依赖顺序按 `architecture.module_inner_layers` + `inner_dependency_direction` 裁决。
4. 跨模块访问必须经由 `architecture.cross_module_exports_file` 声明的出口文件。
5. profile 专属目录、语言、模块格式、配置文件与 UI/宿主术语以 Step 0 加载的 profile addendum 为准。

#### 模块在各外层中的典型形态（示意）

> **唯一真源**：外层 id、同层策略、`sublayers` 成员名一律以 `framework.config.json > architecture` + `doc/architecture.md` 为准。下表不绑定任何具体产品域专名或固定分层 id 字面。

| 角色（自然语言） | 常见内层使用（当 `module_inner_layers` 采用 shared→data→domain→presentation 时） |
|-----------------|----------------------------------------|
| 带 UI 的业务模块 | shared / data / domain / presentation 皆可出现 |
| 共享领域 / 平台服务模块 | 常以 shared + data + domain 为主，presentation 常缺省 |
| 基础 UI / 基础工具 | 若最低外层声明 `sublayer`，通常拆成「公共 UI」「公共工具」两组子目录；**子层 id 以 DSL 为准** |

### 五、功能拆分原则

**核心任务：把 PRD 功能点分配到 `doc/module-catalog.yaml` / `doc/architecture.md` 中已声明的模块，并保证跨模块依赖不超过 `outer_layers[].can_depend_on`。** 下列名称均为占位，必须通过 Step 2 的架构阅读替换为真实模块：

1. **页面和 UI 交互** → 对应 Feature/产品模块的 presentation（若该模块在 DSL 中包含此内层）
2. **应用壳 / 主导航** → 壳模块或独立 `FeatureShell` 类模块（以工程现状为准）
3. **细分业务子域** → 独立业务模块，避免单模块堆叠无关域
4. **账号 / 会话横切能力** → catalog 标记的权威模块（外层由 DSL 决定）
5. **通用 UI 组件**（与业务无关）→ 公共 UI 模块或 sublayer
6. **通用工具**（log、格式化等）→ 公共基础模块或 sublayer
7. **跨 Feature 复用的业务能力** → DSL 中处于较深层、被多个上层依赖的模块
8. **无需求不新增模块**：只创建 PRD 实际触点需要的模块集合

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| PRD.md | ✅ | 对应功能的 PRD 文档（Skill 1 输出），路径通常为 `doc/features/{module}/PRD.md` |
| 功能模块名称 | ✅ | 用于确定设计文档归档路径和 Module 命名（如 `home-page`、`card-management`） |
| doc/architecture.md | ✅ | 项目模块架构的唯一事实来源，记录当前所有模块、依赖关系和公共能力清单 |
| 当前工程代码 | ✅ | AI 自动读取，用于分析现有模块结构、确定新模块位置、识别可复用组件 |

**若缺少 PRD.md**：提示用户先运行 Skill 1 生成 PRD 文档。

## 工作流程

### 设计与编码的会话内硬边界（BLOCKER，弱模型必读）

以下规则与实例根**全局入口**的阶段闭环条款**叠加生效**，用于堵住「改了 design 就顺手把实现写完」的常见误routing。

**实现层产物（本小节用语）**：指落在业务模块源代码树内、由 `contracts.yaml` / `design.md`（及本工程等价契约文件）约定为本次 feature **需交付的可编译或可运行实现**的路径上的文件（编程语言与扩展名因实例而异），**不包含**仅限 `doc/features/<feature>/` 以及明文列为文档或门禁脚手架的路径。具体后缀与分层约定以**本实例**与本阶段的 `architecture`/`contracts`/编码规范 Skill 为准，framework **不绑定**某一种扩展名。

1. **请求路由**：用户仅表达「修订 design」「更新技术设计」「改 contracts / Spec」「修复设计段落」「对齐 PRD 调整设计」等，而**未**在同一条或明确承接的指令中同时要求编码（见下条），则**只激活本 Skill**，本轮定性为 **design 迭代**，不是流水线自动滑入 Skill 3。
2. **何谓同时要求编码（示例，非穷举）**：同一条消息里出现「开始编码」「按现行 design 实现 / 落地」「写代码 / 开发」且指向当前 `doc/features/<feature>/`，可视为用户显式授权连续进入 Skill 3。仅有「把设计改对」「补充设计」**不算**编码授权。
3. **design 迭代回合内禁止默写实现层产物**：在未满足上一条「显式编码授权」时，**BLOCKER**：不得新增或修改实现层产物（定义见上）；允许改的仅限设计侧 SSOT 与文档（如 `doc/features/...`、`doc/`、`framework/` 等按本实例约定允许的路径）。若用户需要「design 与实现连续交付」，须在指令中**明示**两用意图。
4. **落盘 → harness → 停等人审（产品闸门）**：每次 `design.md` + Step 11 的 Spec 写入磁盘后，须**立即**进入 Step 13.1 跑 `harness-runner --phase design`（见 Step 13），**禁止**「先改实现再补 design.harness」。Step 13.1 通过后，向用户交付 harness 摘要与设计变更要点；若用户曾表达「要先审 design」或本轮属于 design 修订，则须**等待用户明示「design OK / 可以编码」**之后，才允许进入 Skill 3——**不得**在同一轮 agent 执行流里「写完设计侧 SSOT → 立刻改实现层产物」直连。
5. **历史阶段不免除**：即使用户过去已跑通 coding / review / UT，只要**本轮改动了** `design.md` 或 `contracts.yaml`（等设计侧 SSOT），设计审阅与「明示编码」流程**重新适用**；不得以「以前实现过」为由跳过。

### Step 1: 读取并分析 PRD

1. 读取指定的 `doc/features/{module}/PRD.md` 文件
2. 提取以下关键信息：
   - **功能清单**：所有功能项及其优先级（P0-P3）
   - **页面列表**：PRD 中描述的所有页面及其 UI 组件
   - **业务流程**：核心业务流和异常分支
   - **数据实体**：PRD 中涉及的业务数据结构（实体、配置、状态等）
   - **验收标准**：可量化的验收条件
3. 整理出**功能点清单**供后续逐项映射

### Step 2: 读取架构文档 & 分析当前工程结构

1. **首先读取 `doc/architecture.md`**（项目模块架构的唯一事实来源）：
   - 了解当前已有哪些模块及其状态（已创建 / 已设计 / 规划中）
   - 了解模块间依赖关系全貌
   - 了解 common 模块已暴露的公共能力（可复用的组件、工具、类型）
   - 了解其他功能模块的 PRD/Design 完成情况
2. 结合架构文档，扫描当前工程目录结构做交叉验证：
   - 宿主**模块注册清单**（路径见 `project_profile` addendum；某类宿主常见为工程根级模块清单文件）
   - 各模块内的目录结构和已有文件
   - 架构文档与实际代码的一致性（若不一致，以实际代码为准并标注差异）
3. 确定本次设计涉及的模块：
   - 是否需要**新建**当前 profile 下的模块？
   - 是否需要**修改**已有模块（如 `phone`、`common`）？
   - 新模块在 DAG 中的依赖位置
4. 识别**可复用**的已有组件、工具类、数据模型（优先查阅 architecture.md 的公共能力清单）

### Context Exploration Gate（BLOCKER）

在**功能拆分与 Scope 冻结动作之前**（即进入 **Step 2.5** 之前），必须将探索摘要落盘至 **`doc/features/<feature>/design/context-exploration.md`**（与 `design/phase-completion-receipt.md` 同目录），模板见 [`../../harness/templates/context-exploration.md`](../../harness/templates/context-exploration.md)。

1. **必读**：本 feature `PRD.md`、`acceptance.yaml`、`doc/architecture.md`、`doc/module-catalog.yaml`、实例根 `framework.config.json`（至少 **`architecture` 段**）；完成 **Step 2** 工程结构扫描中规划要打开的关键路径。
2. **宿主专有路径**（模块清单、`srcPath`、路由/资源注册等）：仅按 **Step 0** `profile-addendum.md` 的「Context Exploration」小节。
3. frontmatter 与 **prd** 阶段同质要求；`key_inputs_read` 须覆盖脚本可识别的 **prd**、**acceptance**、**architecture**、**module-catalog**、**framework.config** 子串。
4. 若涉及 ≥2 个 `in_scope_modules` 或复用 **`architecture.md` 公共能力清单**以外的既有实现，且运行时支持只读子 agent，应并行分域探索并在 `subagents_used` 说明；否则 `not_available`。

### Step 2.5: Scope 继承与提议（Scope 守门机制核心）

这是本 Skill 最关键的一步。**在任何模块设计动作之前**，必须先完成 scope 边界的确认和登记：

#### 2.5.1 继承 PRD 的 Scope 声明

1. 读取 `doc/features/{module}/PRD.md` 的 **「Scope 声明」** 章节中的 yaml 代码块。
2. 在脑中（并最终写入 design.md）显式复述一遍 `in_scope_modules` / `out_of_scope_modules` / `rationale`。
3. **从此刻起，本次设计原则上只能规划修改 `in_scope_modules` 列出的模块**。

#### 2.5.2 最小改动原则（强约束）

1. **就地实现优先**：所有逻辑默认实现在 `in_scope_modules` 中最合适的业务模块内，禁止出于"架构美感"把代码提前上提到**更高外层**或未被 scope 授权共享的公共模块。
2. **已有公共能力强制复用**：若发现可能要用公共能力，**先查 `doc/architecture.md > 各模块公共能力清单`**。清单里已有的，直接复用，不新增；清单里没有的，走 2.5.3 的扩展提议流程。
3. **禁止默默扩大**：哪怕你判断"需要在 `<某 out-of-scope 模块>` 增加接口"合理，**也不能直接写入 design.md**。必须先生成 scope 扩展提议给用户，获得明确同意后才继续。

#### 2.5.3 Scope 扩展提议流程（唯一合法的扩大路径）

当且仅当满足以下条件之一时，才允许提议扩展 scope：
- 现有 in_scope 模块**物理上无法**承载某功能（跨层依赖规则不允许）
- `architecture.md` 的公共能力清单中**确实没有**可复用能力，且该能力是多个 Feature 都会需要的

提议格式（必须以此结构输出给用户，等待用户明确答复"同意"后才继续设计）：

```markdown
## ⚠️ Scope 扩展提议（需用户确认）

**PRD 已声明**：
- in_scope_modules: [...]
- out_of_scope_modules: [...]
- rationale: ...

**当前分析发现**需要扩展到以下模块：
- 建议新增 in_scope：`{ModuleName}`
- 原因：{具体描述为何现有模块无法承载}
- 备选方案：{是否考虑过在现有 in_scope 模块内就地实现？为什么不行？}
- 复用检查：{已查阅 architecture.md 公共能力清单，确认无已有能力可复用}

**请用户明确回复**：
- 同意扩展 → 我会在 design.md 的「Scope 声明与继承」章节的 `expansions_with_user_approval` 字段登记，并继续设计
- 不同意 → 我会重新思考如何在原 in_scope 内解决
```

#### 2.5.4 登记用户批准

用户同意扩展后，在 design.md 的「Scope 声明与继承」章节填入结构化字段：

```yaml
expansions_with_user_approval:
  - modules: [<ModuleA>, <ModuleB>]
    reason: "<业务理由模板：需调用某公共能力，当前 contracts 未暴露且多 Feature 将复用>"
    approved_by: "{user_name}"
    approved_at: "2026-04-17"
```

用户未同意的提议**不得**写入 design.md，并退回到 2.5.2 重新尝试就地实现。

#### 2.5.5 输出

本 Step 结束时，设计文档的 `in_scope_modules`（= PRD 继承 ∪ 已批准扩展）已经冻结，后续所有 Step 的模块选择必须在这个集合内。

### Step 3: 功能拆分到模块

这是设计文档的**核心决策步骤**。逐条分析 PRD 功能清单，将每个功能点分配到 **`doc/architecture.md` 列出的模块 + 合法外层 id** 中。

> **前置约束（来自 Step 2.5）**：所有功能点的"分配模块"必须落在 Step 2.5 冻结的 `in_scope_modules` 集合内。若强行想分配到集合外模块，**必须**停下来回到 Step 2.5.3 发起扩展提议，不得直接在拆分表中写出集合外的模块名。

1. **逐功能分析**：对 PRD 中每个功能点，判断其本质应由哪类模块承载，并对照 `outer_layers` 依赖是否允许：
   - 页面/UI 交互 → 选择负责该界面的业务模块（常为较浅外层的 Feature）
   - 会话/身份能力 → 账号/认证权威模块（若存在于 in_scope）
   - 通用 UI 组件 → 公共 UI 模块或 sublayer（若在 in_scope）
   - 通用工具/基础设施 → 声明为平台/系统外层的模块（若在 in_scope）
   - 多个 Feature 共享的业务服务 → 选择在架构中承担“共享业务能力”的模块（若在 in_scope）
   - **若天然归属模块不在 in_scope**：先在 in_scope 中就地实现；实在不行回到 Step 2.5.3

2. **输出功能拆分表**（先于详细设计，供用户确认）：

   | PRD 编号 | 功能名称 | 分配模块 | 所属外层 id | 拆分理由 |
   |----------|----------|----------|-------------|----------|
   | F1 | xxx | `<FeatureModule>` | `<outer_layer_id>` | <说明> |
   | F7 | xxx | `<AuthModule>` | `<outer_layer_id>` | 会话/身份 |
   | — | Toast | `<SharedUiModule>` | `<outer_layer_id>` | 与业务无关的可复用组件 |

3. **确定需要创建/修改的模块列表**：
   - 哪些模块需要**新建**？（仅创建 PRD 实际需要的）
   - 哪些模块需要**修改**？
   - 验证所有模块间依赖关系是否符合 `architecture.outer_layers` 定义的边

4. **用户确认后**，进入详细设计。

### Step 4: 设计模块架构

1. **绘制模块架构图**（Mermaid diagram）：展示本次涉及的所有模块及其依赖关系，标注所属层级
2. **规划目录/文件结构**：精确到每个新增实现文件的完整路径（各层模块使用对应的内部结构）
3. **确定模块配置变更**：列出需要修改的 profile 专属模块配置文件

### Step 5: 设计数据层

按 data model 模板规范，逐个定义：

1. **数据模型**（`data/model/`）：
   - 定义 `interface` 或 `class`，包含所有字段的名称、类型、说明
   - 标注哪些字段是必填/可选
   - 若模型有内聚方法（如格式化、校验），一并定义方法签名

2. **数据仓库**（`data/repository/`）：
   - 定义 Repository 类及其方法签名
   - 标注数据来源（本地模拟 / API 调用 / AppStorage）
   - 明确每个方法的入参、出参、异步策略

3. **端云接口**（`shared/client/`，如有远程数据需求）：
   - 定义请求体和响应体的 interface
   - 标注接口 URL（模拟数据场景可标注 "模拟"）

### Step 6: 设计领域层 / 业务编排（条件式产出 `use-cases.yaml`）

> **v2.1 关键澄清**：`UseCase` 是**文档级业务规约**，不是代码中必须存在的类。
> design 的任务是："**判断是否需要 `use-cases.yaml`，如需要则只描述业务语义，不强行规定实现形态**"。
> 真正的业务编排代码（Coordinator / Flow / Page 命名方法 / 导出函数）由 Skill 3 选择最贴合复杂度的形式落地。

#### 6.1 复杂度判定（决定是否产出 `use-cases.yaml`）

仅当**至少满足下列一条**时，才产出 `doc/features/{module}/use-cases.yaml`：

1. **多 UI 节点共享状态**：≥2 个页面/组件订阅同一业务状态，且互相渲染依赖 `phase` 等字段（典型：跨多页+弹窗的审批/提交流）
2. **多步云侧调用**：一个用户动作会触发 ≥2 次独立的云端请求，且调用顺序受前一次结果影响
3. **存在回滚/补偿分支**：某一步失败需要反向清理已持久化或已修改的状态（云写成功但本地写失败，需回滚云侧；或反之）
4. **多路人机交互**：流程中涉及 ≥2 次真实用户输入（短验、指纹、权限弹框…）

若本 feature **全部条件都不满足**（例：首页一次性加载、单接口查询、单按钮跳转），**不要**产出 `use-cases.yaml`。Skill 5 会走退化模式，基于 `acceptance.yaml` + `dag.yaml` 直接针对 data 层函数写 UT。

#### 6.2 若决定产出 `use-cases.yaml`

产出以下两份文档（代码形态仍由 Skill 3 决定）：

1. **design.md 新增「业务流程 UseCase 清单」章节**（见 `` `profile-skill-asset:2-requirement-design/design_template` `` 的 `## 六、业务流程 UseCase 清单`），含：
   - **业务入口映射表**（ui_bindings 的人话版本）：哪一个页面/组件的哪一个用户动作，应调用哪一个业务函数（命名函数，不写实现，只给签名意图）
   - **状态机 Mermaid**（`stateDiagram-v2`），覆盖所有可预期分支（成功、各类失败、用户取消、回滚）
   - **数据边界清单**：本流程依赖的外部边界（云端接口 / 本地持久化 / 系统服务），引用 `contracts.yaml > interfaces[].class` 中**已存在**的 data 层类，而不是新造 Port 接口
   - **分支清单表**：happy path + 所有可预期失败路径，每条标注对应 AC/BD

2. **`doc/features/{module}/use-cases.yaml`**（Spec 文件，与 `contracts.yaml` 同目录）：
   - Schema 见 `` `profile-skill-asset:5-business-ut/use_cases_schema` ``
   - 规范级样例目录见 `` `profile-skill-asset:5-business-ut/sample_flow_dir` ``
   - 必填字段：`schema_version / feature / use_cases[]`；每个 `use_case` 含 `id / coordinator / ui_bindings / state_model / branches`；`coordinator_file` / `data_boundaries` 可选
   - `coordinator` 只写**符号名**（类名 / `Page.method` / 导出函数名），指向 Skill 3 将要实现（或已存在）的真实代码；**不**强制放在 `domain/usecase/` 下
   - `ui_bindings[].user_actions[].calls` 必须是一个**命名函数符号**（UT 可直接调用）；inline lambda 或匿名箭头函数不算
   - `data_boundaries[].type` 必须与 `contracts.yaml.interfaces[].class` 一一对应；`kind` 取 `cloud` / `storage` / `system`
   - `branches[].linked_acceptance` 至少关联一条 AC/BD；Skill 5 会按此清单 1:1 生成 UT 用例

#### 6.3 **禁止**的反模式（v2.1 明确约束）

- ❌ 在 design / use-cases.yaml 里要求"必须在 `domain/usecase/` 下新建 `XxxUseCase` 类"——代码形态由 Skill 3 决定
- ❌ 为某个 data 层类额外套一层 `XxxPort` 接口**只为了 UT 注入方便**——直接引用既有 data 层类即可，UT 用 Spy/Fake 子类化或原型替换
- ❌ 把 **路由/弹窗/Toast 等 UI 运行时能力**登记为 `data_boundaries`——UI 副作用走 `ui_subscription`（design 与 device-testing-todo 承载），不进 UT；具体禁入符号见宿主 profile addendum
- ❌ 对业务逻辑非常简单的 feature 硬凑 `use-cases.yaml`（如首页一次性加载）——应直接让 Skill 5 基于 data 层函数 + dag 写 UT

### Step 7: 设计展示层

1. **页面组件树**：每个页面拆分为哪些自定义组件（**示意树与宿主页面容器术语**见 `framework/profiles/<project_profile>/skills/2-requirement-design/profile-addendum.md`）
   ```
   <HomePage>
   ├── <SectionA>（复杂组件）
   │   └── <Widget>（基础组件）
   └── <SectionB>（复杂组件）
   ```

2. **组件接口定义**：每个自定义组件的 **Props / 回调**（宿主组件参数与绑定语法见 profile addendum）

3. **状态管理方案**（按宿主最佳实践选型，细则见 profile addendum）：
   - 页面级 / 父子 / 跨页面状态
   - 列表与懒加载数据结构

4. **路由/导航设计**：
   - 页面间跳转关系、栈/路由 API、路由参数定义（**宿主路由栈与容器 API** 见 profile addendum）

5. **Visual parity（与 PRD Visual Handoff 对齐，有界面时）**：
   - 对照 `PRD.md` 中含 `ui_change` 的 yaml 块中的 `authoritative_refs`（路径或设计稿 URL），在 `design.md` 用一小节说明：**各区域 UI 以何真源为准**、相对真源允许的偏差（如占位图、模拟数据）、哪些项落入 `contracts.yaml`（间距档位、资源 key、字号等可测项）。
   - 若 PRD 声明 `ui_change: none` / `reuse_only` / `impl_out_of_band`，本节可写「无新版面，无新增视觉对齐项」。

### Step 8: 构建 PRD 功能映射表

逐项映射 PRD 中的每个功能点到具体的技术实现（应与 Step 3 的功能拆分表一致，但更详细）：

| PRD 功能编号 | 功能名称 | 优先级 | 所属层 | 实现模块 | 模块内层级 | 关键文件 | 实现说明 |
|-------------|----------|--------|--------|----------|-----------|----------|----------|
| F1 | Tab导航 | P0 | `<outer_layer_id>` | `<feature_module>` | presentation | HomePage.<ext> | Tabs框架 |
| F7 | 登录态 | P0 | `<outer_layer_id>` | `<auth_module>` | service | AuthService.<ext> | 会话管理 |

**必须确保**：
- PRD 中每个 P0/P1 功能点都有对应的技术映射行
- 每行的"所属层"和"实现模块"与 Step 3 拆分结果一致
- 跨模块的功能点拆分为多行（一个功能可能涉及多个模块）

### Step 9: 质量门禁自检

生成设计文档后，执行以下自检清单：

```
[ ] 0. Scope 守门（BLOCKER）：design 的「Scope 声明与继承」章节是否存在？in_scope_modules 是否 ⊆ PRD.in_scope_modules ∪ expansions_with_user_approval？是否触碰了 PRD.out_of_scope_modules？
[ ] 1. PRD 映射完整性：PRD 中每个 P0/P1 功能点是否在映射表中有明确条目？
[ ] 2. 架构外层合规：每个模块是否落在 DSL 声明的外层？`can_depend_on` / `intra_layer_deps` 是否全部满足？
[ ] 3. Feature/同层模块合规：若某外层 `intra_layer_deps != dag`，是否遵守禁止互依等约束？若为 `dag`，是否存在非法环？
[ ] 4. 模块最小化：是否只创建了 PRD 功能实际需要的模块？没有多余的模块？
[ ] 5. 功能拆分准确性：每个功能点是否放在了最合适的模块？且分配模块均在 in_scope_modules 内？
[ ] 6. 文件路径合规：所有新增文件路径是否符合各层模块对应的内部结构？
[ ] 7. 数据类型合法：数据模型字段类型是否符合当前 profile 的宿主语言类型系统？
[ ] 8. 接口签名完整：所有函数/方法签名是否包含入参类型和返回类型？
[ ] 9. 无 TBD 项：P0/P1 范围内是否有"待定"、"TBD"、"TODO"等未决项？
[ ] 10. 组件树完整：每个页面是否都有组件拆分方案？
[ ] 11. 状态管理明确：关键数据的状态管理策略是否已明确？
[ ] 12. 路由设计完整：页面间跳转关系是否与 PRD 业务流程图一致？
[ ] 13. UseCase 规约（仅当满足 Step 6.1 复杂度阈值时）：是否在 design.md 产出「业务流程 UseCase 清单」章节（业务入口映射表 + Mermaid 状态机 + 数据边界清单 + 分支清单）？`use-cases.yaml` 是否字段齐全（coordinator / ui_bindings / data_boundaries / state_model / branches）？`data_boundaries[].type` 是否都能在 `contracts.yaml > interfaces[].class` 中找到（无新造 Port）？每个 `ui_bindings[].user_actions[].calls` 是否为命名函数符号（非 inline lambda）？每条 branch 是否都有 linked_acceptance？**未达复杂度阈值的 feature 跳过此项**。
```

**不通过项**：找出具体缺失点，自动补充完善后重新自检，直到全部通过。

### Step 10: 输出与归档

> **顺序纠错**：必须把 `design.md` 写入磁盘后，脚本 harness（Step 13.1）才能读取。**「用户确认」指是否冻结设计并授权进入 Skill 3 写源码**，不是「确认后才允许写入 design.md」——否则会出现「没落盘就跑不了 harness」与「先把代码写完再补 harness」的违规路径。

1. 将（更新后的）设计文档写入：
   ```
   doc/features/{module-name}/design.md
   ```
2. 若 Step 11 已在流水线上执行完毕，确保同目录 Spec（`contracts.yaml` 等）与 design 一致并已保存。
3. 在对话中输出**可读变更摘要**（改了哪些章节/契约、对实现的影响），便于用户审阅；用户若提出修改意见，回到 Step 9（及必要时 Step 11）迭代。
4. **立即进入 Step 13**：归档落盘后**不得**先做编码；必须先跑 Step 13（至少 13.1，零 BLOCKER），再与用户对齐「可否进入 Skill 3」。若本条与「设计与编码的会话内硬边界」冲突，**以更严格的停等规则为准**。

### Step 11: 提取功能级 Spec

设计文档归档后，**必须**同步提取功能级接口契约到 `doc/features/{module-name}/` 目录。Spec 是连接生成层和验证层的枢纽，也是 Skill 3（编码）的强契约基准。

#### 11.1 提取接口契约 (`contracts.yaml`)

从 design.md 中提取结构化接口契约，写入 `doc/features/{module-name}/contracts.yaml`：

**`modules` 章节**（从设计文档「模块架构图」和模块变更摘要提取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `name` | 模块名 | 如 `<FeatureModule>`、`<SharedUiModule>`（与 architecture / catalog 一致） |
| `layer` | 所属外层 id | 必须等于 `architecture.outer_layers[].id` 之一 |
| `format` | profile 声明的模块格式 | |
| `change_type` | 变更类型 | new / modify / migrate_and_modify |
| `package_path` | 物理路径 | 以本工程模块根目录为准 |

**`module_dependencies` 章节**（从模块架构图的依赖箭头提取）

**`data_models` 章节**（从设计文档「数据模型定义」提取）：

| 字段       | 来源                       | 说明                       |
| -------- | ------------------------ | ------------------------ |
| `name`   | 模型名                      | 如 ItemRecord、UserProfile |
| `module` | 所属模块                     |                          |
| `file`   | 完整文件路径                   |                          |
| `kind`   | interface / class / enum |                          |
| `fields` | 字段列表                     | 每个字段含 name、type、required |

**`interfaces` 章节**（从设计文档「服务层接口定义」提取）：

| 字段        | 来源     | 说明                                         |
| --------- | ------ | ------------------------------------------ |
| `module`  | 所属模块   |                                            |
| `layer`   | 内部层级   | 如 data/repository、domain/service           |
| `file`    | 完整文件路径 |                                            |
| `class`   | 类名     |                                            |
| `methods` | 方法列表   | 每个方法含 name、params、return、async、description |

> **UT / mock-plan 门禁（v2.3）**：`interfaces[].methods` 中 **`params` 须含完整类型文本**、`return` 必须填写准确返回类型（含 `Promise<...>`）——下游 Skill 5 的 `ut/mock-plan.yaml` 与 harness `ut_mock_plan_contracts_consistent` 依赖此信息生成可用的类型化 Test Double。

**`components` 章节**（从设计文档「页面组件树」和「状态管理方案」提取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `name` | 组件名 | |
| `module` | 所属模块 | |
| `file` | 完整文件路径 | |
| `kind` | page / component / utility | |
| `state` | @State 变量列表 | |
| `props` | 组件入参 / Props 绑定（宿主装饰器语法见 profile addendum） | |
| `events` | 事件回调列表 | |
| `children` | 子组件列表 | |

**`state_management` 章节**（从「状态管理方案」提取）

**`navigation` 章节**（从「路由/导航设计」提取）

**`files` 章节**（从「目录/文件结构规划」提取完整文件清单）

**`resource_keys` 章节**（从设计文档中涉及的宿主资源引用（如 UI 资源函数调用）提取资源 key 契约；具体语法见本实例 `project_profile` 编码规范）

**`prd_to_code_traceability` 章节**（从「PRD 功能映射表」提取追溯映射）

#### 11.2 补充边界用例 Spec（若 Skill 1 未产出）

若 `doc/features/{module-name}/acceptance.yaml` 已由 Skill 1 产出，检查并补充设计阶段新增的边界场景（如从技术角度发现的新边界用例）。

若 Skill 1 未产出 `acceptance.yaml`（历史原因），则从 PRD.md 中提取并创建。

#### 11.3 （条件式）提取业务流程 UseCase 清单 (`use-cases.yaml`)

**仅当** Step 6.1 的复杂度阈值命中时才产出 `doc/features/{module-name}/use-cases.yaml`；不满足阈值的 feature**不写**该文件，交由 Skill 5 基于 `acceptance.yaml` + `dag.yaml` 直接针对 data 层写 UT。

若需要产出：

- Schema：见 `` `profile-skill-asset:5-business-ut/use_cases_schema` ``
- 参考样例：`` `profile-skill-asset:5-business-ut/sample_flow_use_cases` ``
- 关键强约束：
  - `use_cases[].coordinator` 仅声明**符号名**（类名 / `Page.method` / 导出函数），指向 Skill 3 之后会实现（或已存在）的真实代码；`coordinator_file` 可选，不强制放在 `domain/usecase/`
  - `ui_bindings[].user_actions[].calls` 必须是命名函数（Skill 3 harness 会校验 `named_business_handler`）
  - `data_boundaries[].type` 必须与 `contracts.yaml.interfaces[].class` 一一对应，且是**既有** data 层类（不新造 Port 接口）；`kind` 取 `cloud` / `storage` / `system`
  - `branches` 至少包含 happy path + 每类可预期失败路径，每条必须 `linked_acceptance` 非空
  - 若某条分支找不到对应 AC/BD，回到 Skill 1 补充后再回填

#### 11.4 输出文件与参考

```
doc/features/{module-name}/contracts.yaml
doc/features/{module-name}/use-cases.yaml   (仅复杂 feature；简单 feature 不产出)
```

参考已有示例：`doc/features/<your-feature>/contracts.yaml`（简单 feature，无 use-cases.yaml）、多步流程可参考 `` `profile-skill-asset:5-business-ut/sample_flow_use_cases` ``。

> **为什么这一步如此重要**：`contracts.yaml` 是 Skill 3 编码时的强契约——文件路径、接口签名、组件 Props 必须与 contracts.yaml 一致；`use-cases.yaml`（若存在）是 Skill 5 业务级 UT 的蓝图——DAG 与 UT 用例按 branches 1:1 生成。Harness 也依赖它们做接口一致性验证与 UT 覆盖追溯。未达阈值的简单 feature 不产出 `use-cases.yaml`，避免为测试工具人为引入架构复杂度。

### Step 12: 架构影响判定与（条件式）架构文档更新

`doc/architecture.md` 是**架构契约**而不是 feature 变更日志。**绝大多数 feature 需求（既有模块内新增页面/接口/数据模型/样式修复）都不应动** `architecture.md`——变更历史由 git 与 `doc/features/<feature>/` 承担。

本 Step 的任务是：**先判定本次 design 的架构影响等级，再按等级决定是否更新 architecture.md / module-catalog.yaml / framework.config.json**。

#### 12.1 填写「架构影响声明」(必做，无论结果)

在 design.md 的 `## Scope 声明与继承` 章节下，补齐（或确认）`### 架构影响声明 (architecture_impact)` 子节。模板与字段见 `` `profile-skill-asset:2-requirement-design/design_template` ``：

```yaml
architecture_impact:
  impact: none                  # none | dsl_change | module_set_change | responsibility_rewrite
  affected_items: []
  architecture_md_updates: []
  catalog_updates: []
```

**架构级变更的三类定义**（互斥，任一命中都属于架构级）：

| 取值 | 含义 | 典型触发场景 |
|------|------|-------------|
| `none` | 无架构影响 | 在既有模块内新增页面、接口、数据模型；bug 修复、样式调整；PRD 完全落在已声明的模块集合内 |
| `dsl_change` | `framework.config.json > architecture` 结构变化 | 新增/下线外层、改同层策略（forbid/dag/sublayer）、改内层顺序、改 `cross_module_exports_file`、改外层 `can_depend_on` 矩阵 |
| `module_set_change` | 模块集合变化 | 新增模块、下线模块、把某模块从外层 A 迁到外层 B |
| `responsibility_rewrite` | 模块核心职责大调整 | `module-catalog.yaml` 中某模块的 `primary_responsibility` 被大幅重写（不是单纯新增能力） |

> **判定原则**：**从严判 `none`**。只要不确定是否涉及上述三类，先按 `impact != none` 处理并停下来与用户确认。

#### 12.2 impact = `none` — 本 Step 结束

- `affected_items` / `architecture_md_updates` / `catalog_updates` 全部保留 `[]`。
- **不要**修改 `doc/architecture.md`、`doc/module-catalog.yaml`、`framework.config.json`。
- **不要**在 `architecture.md` 追加任何变更记录——feature 级变更历史由 git 承担。
- 跳到 Step 13。

#### 12.3 impact = `dsl_change`

- 同步修改 [framework.config.json](../../../framework.config.json) 的 `architecture` 段（新增层 / 改同层策略 / 改内层顺序 / 改 `cross_module_exports_file` / 改 `can_depend_on`）。
- 同步修改 [doc/architecture.md](../../../doc/architecture.md) 相应小节：外层架构 Mermaid / 层间依赖表 / 模块内分层 / 物理目录。
- 在 architecture.md 末尾的「架构级变更记录」追加一行：`| YYYY-MM-DD | dsl_change | <具体变化，如 "features 外层 intra_layer_deps 改为 dag"> |`
- 将具体落盘点回填到 design.md `architecture_impact.architecture_md_updates` 数组，供脚本 Harness 核对。

#### 12.4 impact = `module_set_change`

- 更新 [doc/module-catalog.yaml](../../../doc/module-catalog.yaml)：新增 / 删除 / 迁层对应模块条目，见 [Skill 0 catalog-bootstrap](../0-catalog-bootstrap/SKILL.md) Phase A 的增量流程。
- 更新 [doc/architecture.md](../../../doc/architecture.md) 的**极简业务模块清单**（模块名 + 所属外层 + 一句话职责 + 链到 catalog），只增删一行，**不要**扩展为完整模块画像。
- 如因新增模块导致外层依赖边需要修订 → 同时触发 `dsl_change` 流程（二者可叠加出现在同一条 design 中）。
- 在 architecture.md「架构级变更记录」追加一行：`| YYYY-MM-DD | module_set_change | <如 "新增 BillingService 模块（features 外层）"> |`
- 将具体落盘点回填到 `architecture_md_updates` 与 `catalog_updates`。

#### 12.5 impact = `responsibility_rewrite`

- 只修改 [doc/module-catalog.yaml](../../../doc/module-catalog.yaml) 中相应模块的 `primary_responsibility` / `NOT_responsible_for` / `easily_confused_with`。
- 同步修改 [doc/architecture.md](../../../doc/architecture.md) 极简模块清单**那一行**的"一句话职责"文案，保持 catalog 与 architecture 一致。
- **不要**在 architecture.md 里粘贴完整的职责描述或公共能力清单——那是 catalog 的职责。
- 在 architecture.md「架构级变更记录」追加一行：`| YYYY-MM-DD | responsibility_rewrite | <如 "AccountManager.primary_responsibility 重写为 ..."> |`
- 将具体落盘点回填到 `catalog_updates`（必填）与 `architecture_md_updates`（仅那一行的修改）。

#### 12.6 Feature 级变更禁入 architecture.md

以下情形**一律不写入** architecture.md（也不算架构级变更）：

- 在既有模块内新增 / 修改页面、组件、接口、数据模型
- 修 bug、样式调整、文案修改
- PRD `in_scope_modules` 完全落在已存在模块集合内
- 只有 `doc/module-catalog.yaml` 的 `exposed_capabilities_public`（公共能力）新增，而 `primary_responsibility` 未变 —— 这些在 catalog 里记即可

> **为什么这一步这样设计**：architecture.md 是**架构级契约**，负责定义分层 / 模块集合 / 依赖边 / 出口约定；module-catalog.yaml 是**模块画像 SSOT**，负责记录每个模块的细粒度职责与能力；git history + `doc/features/<feature>/` 负责 feature 级变更日志。三者各司其职，避免 architecture.md 被 feature 级变更污染导致心智噪音。

### Step 13: Harness 验证门禁（agent 必须自跑）

> **全局入口 §4.1 明示授权**：本步骤的 harness 与 verifier 调用都由主 agent 自己执行，
> **严禁**仅"告知用户可运行"然后结束对话——属软幻觉，由物理拦截层兜底。

> **顺位（BLOCKER）**：Step 10 + Step 11 落盘结束后的**下一件正事就是本 Step 的 13.1**，不得在宣布设计审阅就绪之前编写或修改**实现层产物**（定义见上文「设计与编码的会话内硬边界」）；「实现改完再补 design.harness」一律视为顺序错误。

所有产出归档后，agent **必须自己**完成下列验证，再宣布设计阶段完成。

#### 13.1 脚本 Harness（确定性检查，agent 通过 Shell 工具自跑）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase design --feature {module-name}
```

agent 执行后必须 Read 退出码与报告文件；BLOCKER 必须修复后重跑。

> ⚠️ **必须通过 `harness-runner.ts` 入口**：直接 `ts-node scripts/check-design.ts` 不会触发任何检查（`check-*.ts` 只是导出 checker 模块，没有 CLI 入口），会静默返回 0 造成"假通过"。

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/design-rules.yaml` — 阶段级通用规则（章节存在性、表格格式、映射覆盖率等）
- `doc/features/{module-name}/contracts.yaml` — 功能级接口契约（文件清单、接口签名）
- `doc/features/{module-name}/acceptance.yaml` — 功能级验收标准(PRD 追溯覆盖率)

**若报告中存在 BLOCKER 级问题**：必须修正设计文档并重新提取 Spec（回到 Step 9），直到零 BLOCKER。

#### 13.2 AI Harness（语义级检查，agent 主动通过 Task 工具触发 verifier 子 agent）

agent 必须主动通过 Task 工具调用 `subagent_type: verifier`（不是"告诉用户去跑"），把 feature / phase / 脚本报告路径传入：

- **Prompt 模板**：`framework/harness/prompts/verify-design.md`（由 verifier 子 agent 自行读取）
- **触发方式**：Task 工具，subagent_type=verifier，prompt 中给出 feature/phase/脚本报告路径
- **语义检查覆盖项**：
  1. 外层依赖矩阵合规性（BLOCKER，`architecture.outer_layers`）
  2. 模块内分层合规性（BLOCKER，`module_inner_layers`）
  3. 模块最小性
  4. 功能拆分合理性
  5. 数据类型合法性（BLOCKER）
  6. P0/P1 无未决项（BLOCKER）
  7. 架构文档一致性
  8. 导航流程一致性
  9. 验收标准到接口追溯

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 13.3 阶段闭环判定（全局入口 §5.1 节 SSOT，四条件缺一不可）

> 下文「物理拦截层」：**部分 adapter** 经 Skill 00 在实例根下发 **Stop hook**，在消息结束前读取 state 并阻断「假完成」（Layer 3 行为与路径见 [framework/agents/README.md](../../agents/README.md)）。**未**配置该能力的 adapter 不设物理层豁免，仍须满足 Layer 1（全局入口 §6.5「反假设条款」）+ Layer 2（完成回执 + `check-receipt.ts`）——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

设计阶段宣布"完成"前必须**同时**满足：

1. `doc/features/<feature>/design/reports/trace.json` 真实存在；
2. 脚本 harness 退出码 0、零 BLOCKER；
3. verifier 子 agent 报告 verdict = PASS；
4. 完成回执 `doc/features/<feature>/design/phase-completion-receipt.md` 已填写并通过 `npx ts-node framework/harness/scripts/check-receipt.ts --feature <feature> --phase design` 校验。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，设计阶段完成，可进入 Skill 3（编码）。物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。

## 输出规范

### 文件路径

| 产出 | 路径 |
|------|------|
| 设计文档 | `doc/features/{module-name}/design.md` |
| 接口契约 Spec | `doc/features/{module-name}/contracts.yaml` |

### 文档结构

设计文档**必须包含以下 9 个章节**（章节细节以模板为准）：

`` `profile-skill-asset:2-requirement-design/design_template` ``

1. **Scope 声明与继承** — 继承 PRD 的 in_scope / out_of_scope，登记用户批准的扩展（Scope 守门起点，不可省略）
2. **模块架构图** — Mermaid diagram，展示模块间依赖关系
3. **目录/文件结构规划** — 精确到每个新增实现文件路径及其职责说明
4. **数据模型定义** — interface/class 定义，含字段类型和说明
5. **页面组件树** — 每个页面拆分为哪些自定义组件，含层级关系
6. **状态管理方案** — 各装饰器的使用策略和数据流向
7. **服务层接口定义** — Repository / UseCase / Client 的函数签名
8. **路由/导航设计** — 页面间跳转关系和参数传递
9. **PRD 功能映射表** — 每个 PRD 功能点到技术实现的逐项映射

### 文档格式
- 使用 Markdown 格式
- 架构图使用 Mermaid 语法
- 数据模型使用当前 profile 的宿主语言或契约格式代码块
- 接口定义使用代码块 + 表格补充说明
- 组件树使用树形文本图

### 辅助模板

数据模型和接口规范可参考以下模板：
- 数据模型模板: `` `profile-skill-asset:2-requirement-design/data_model_template` ``
- 接口规范模板: `` `profile-skill-asset:2-requirement-design/api_spec_template` ``

## 设计决策原则

在遇到需要权衡的技术决策时，遵循以下原则：

1. **简单优先**：在需求允许的前提下选择最简实现，避免过度设计
2. **分层清晰**：宁可多一个文件，也不要违反 `module_inner_layers` 依赖方向
3. **模拟数据**：若暂时无法接入真实后端，在 client/adapter 定义接口，由 repository 或等价数据层用本地替身实现
4. **复用优先**：已有的公共组件/工具优先复用，不重复造轮子
5. **渐进式设计**：P0 功能必须设计完整，P2/P3 功能可标注为"预留扩展点"
6. **可编译导向**：设计方案必须是可直接编码实现的，不含无法落地的抽象描述

## 关联文件

- **项目架构文档**: [doc/architecture.md](../../doc/architecture.md)（必读；仅当 design 声明 `architecture_impact != none` 时按 Step 12 分支更新）
- **模块画像 SSOT**: [doc/module-catalog.yaml](../../doc/module-catalog.yaml)（模块职责 / 公共能力 / 易混点真实来源，非 architecture.md）
- 设计文档模板: `` `profile-skill-asset:2-requirement-design/design_template` ``
- 接口规范模板: `` `profile-skill-asset:2-requirement-design/api_spec_template` ``
- 数据模型模板: `` `profile-skill-asset:2-requirement-design/data_model_template` ``
- 示例设计文档: `` `profile-skill-asset:2-requirement-design/example_design` ``
- 阶段级规约: `framework/specs/phase-rules/design-rules.yaml`
- 功能级 Spec 示例: 见各 feature 目录下 `contracts.yaml`（如 `doc/features/<feature>/contracts.yaml`）
- 脚本 Harness: `framework/harness/scripts/check-design.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-design.md`

## 上游与下游

- **上游输入**:
  - `doc/features/{module}/PRD.md`（Skill 1 输出）
  - `doc/features/{module}/acceptance.yaml`（Skill 1 产出的验收标准 Spec）
  - `doc/architecture.md`（项目架构全貌，跨 Skill 共享）
- **下游消费者**:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **Skill 3 (编码)** | design.md + contracts.yaml | 按文件规划和接口契约逐模块生成代码 |
| **Skill 4 (Code Review)** | design.md + contracts.yaml | 对照检查实现一致性 |
| **Skill 5 (业务级 UT)** | design.md + contracts.yaml | 读取业务流程信息生成 DAG |
| **Harness (验证层)** | contracts.yaml | 脚本/AI 验证代码接口一致性和文件完整性 |

## 约束与注意事项

1. **PRD 是唯一的需求来源**：不得自行添加 PRD 中未提及的功能，若发现 PRD 缺失重要场景，应标注并建议用户回到 Skill 1 补充
2. **严格遵循分层架构**：design.md 中规划的每个文件必须落在正确的层级目录，设计阶段就要杜绝分层违规
3. **宿主生态适配**：组件/接口设计优先使用当前 profile addendum 声明的宿主原生能力，避免自造轮子
4. **宿主类型系统**：数据模型字段类型必须符合当前 profile 的宿主语言类型系统；禁用项以 profile addendum 和阶段规则为准
5. **设计即契约**：design.md 中的接口签名、文件路径、组件 Props 定义将作为 Skill 3 编码的强契约，务必精确
6. **Spec 必须同步产出**：设计文档归档后必须提取 `contracts.yaml`（Step 11），这是下游编码和 Harness 验证的基准。contracts.yaml 的精确度直接影响编码质量和自动化验证的有效性
7. **中文输出**：所有设计文档内容使用简体中文
8. **模块最小化**：只创建 PRD 实际需要的模块。一个功能往往跨多个模块（如 Feature + Auth + SharedUI），但不意味着为每个功能单独新建模块
9. **跨模块拆分是核心能力**：Skill 2 必须把功能点放进**正确的模块 + 合法外层**，保证职责单一、依赖与 DSL 一致
10. **Harness 验证闭环**：设计完成后 agent **必须自己运行** Harness 验证（Step 13），并主动通过 Task 工具触发 `subagent_type: verifier`；确保零 BLOCKER + verifier PASS + 完成回执通过校验后才进入编码阶段（物理拦截层兜底）

---

## Slash / 快捷入口触发时的 trace 约定

当本 Skill 通过适配器下发的 slash（如 `/requirement-design`）或其它等价快捷入口触发时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`doc/features/<feature>/design/reports/<timestamp>/<model>-design/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `design`。
- **必须记录的事件**：
  - `human_interventions`：所有 **Scope 扩展提议**及用户批准/否决记录，`type: scope_expansion_approval`
  - `retries`：`scope_violation` / `architecture_violation` / `contracts_mismatch` 等自修尝试
  - `harness_checks`：`check-design.ts` 的 BLOCKER/MAJOR/WARN 计数
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。

---

## 运行时交付约定（内网 / 弱模型）

本 Skill 在上述客户端运行时，**阶段结束前必须**在以下目录产出交付凭证：

```
doc/features/<feature>/design/reports/<timestamp>/<model>-design/
├── trace.json                # 结构见 framework/harness/trace/trace.schema.json（phase = "design"）
├── gap-notes.md              # 结构见 framework/harness/trace/gap-notes.template.md
├── check-design.report.md    # check-design.ts 的输出
└── verifier.report.md        # verifier 子 agent 跑 verify-design.md 的语义审查报告（可选）
```

**特别提醒（本 Skill 最容易发生的痛点）**：
- Scope 扩展提议是否被用户批准 → 必须记入 `trace.json` 的 `human_interventions`；
- 若模型擅自扩展 scope 被拦截 → 记入 `human_pain_points`，category = `scope_creep`。
