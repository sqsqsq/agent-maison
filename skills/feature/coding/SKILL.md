# 编码 Skill (`coding`)

> **用户确认 UX**：[user-confirmation-ux.md](../../reference/user-confirmation-ux.md) · `coding.scope_stop` / `coding.module_batch` / `coding.deps_abc` / `coding.ok_to_review` / `phase.next_step`。

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`framework-init`](../../project/framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

**Harness 运行时前置**：执行本 Skill 中任意 `harness-runner` / `npx ts-node harness-runner.ts` / `check-receipt.ts`（依赖 harness npm）前，须满足 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../../reference/harness-cli-cwd.md)（harness 之后用 `cd framework/harness && npx ts-node scripts/check-receipt.ts`）。

**Personal setup（BLOCKER）**：跑 harness 前须 [personal-setup-gate](../../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

### Feature 归档定位协议（本阶段是消费者）

进入本 Skill 后，必须先基于 `framework.config.json > paths.features_dir` 精确定位 `doc/features/<feature>/`。本步骤只依赖用户给出的 feature 名与文件系统状态，不依赖 `.current-phase.json`、历史 reports、trace 或上一阶段缓存。

**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：若 receipt 可能已存在，须**先**自跑 `check-receipt.ts`（或 `harness-runner --sync-closure`）。exit 0 → 该 phase 已闭环，**停等 `phase.next_step`**，禁止仅凭 stale state/summary 判未闭环或重跑本阶段。

- 只有精确目录 `doc/features/<feature>/` 是正式 feature；同级 `<feature>.rar` / `<feature>.zip` / `<feature>.7z` / `<feature>.tar*` 以及 `<feature>-old/`、`<feature>.md` 等同名前缀条目都只是旁证。
- 若精确目录不存在，必须快速失败并提示用户先创建/恢复正式 feature 目录；不得自动解压归档，不得读取归档内容补齐上下文。
- 若目录存在但本阶段输入缺失（至少 `plan/plan.md`、`contracts.yaml`、`acceptance.yaml`）：报告缺失文件并回到上游阶段补齐；不得把同名归档当作上游产物。
- 继续执行前，向用户展示本阶段输入矩阵：`plan.md` / `contracts.yaml` / `acceptance.yaml` 存在/缺失，旁证归档/同名前缀条目如实列出但明确忽略。

## Step 0. 载入 `project_profile` addendum（强制）

继续下文前，完整阅读：

`framework/profiles/<project_profile.name>/skills/coding/profile-addendum.md`

其中 `<project_profile.name>` 取自 `framework.config.json > project_profile.name`（未声明时由 harness 按仓库指纹回落默认 profile，见 [framework/harness/config.ts](../../../../harness/config.ts) 与 init Skill S2.1（`project_profile`））。若该文件不存在，则仅依赖本 SKILL 正文 + 对应 profile 下已迁移的模板/参考文件路径。

> **Agent 行为规约（BLOCKER）**：完整阅读 [`agent-behavioral-principles.md`](../../reference/agent-behavioral-principles.md)（原则 3 Surgical · 原则 4 Verify）。**Research Sub-Phase 完成前禁止写入第一个实现层源文件。**

> **动态资产引用**：若正文出现 `` `profile-skill-asset:<skill>/<asset_key>` ``，须按 [Profile skill asset protocol](../../../README.md#profile-skill-asset-protocol) 解析。编码规范/脚手架/宿主易错手册等权威文件亦可通过清单键 `coding_standards`、`module_scaffold`、`arkts_pitfalls` 等定位（见当前 profile 的 `skills/skill-assets.yaml`）。

---

## 概述

你是一位资深**宿主应用**开发工程师。具体技术栈、源码扩展名、模块格式、编译/测试工具链以 Step 0 加载的 `project_profile` addendum 与 profile capabilities 为准。你的任务是根据实现计划（plan.md）逐模块生成与 **design contracts** 对齐、且可通过本仓库 harness 的出口检查的实现代码。

本 Skill 是项目全生命周期流水线的**第三环**。上游输入来自 plan 阶段的 `plan.md`，输出（源码）将流入 code-review（Code Review）。

> **⚠️ 开工前必读（弱模型环境尤其重要）**
>
> 1. **Profile 编码补充**：完整阅读 `framework/profiles/<project_profile.name>/skills/coding/profile-addendum.md`。若 addendum 声明了宿主语言易错手册、资源规范或导出规则，写对应文件前必须先回顾相关条目，写完后对照自检。
> 2. **Scope 守门（新）**：本次编码的 git diff 不得越界到 plan.md `in_scope_modules` 之外。Harness 的 `diff_within_scope` 规则会在 Step 7 阻断 BLOCKER。因此写代码时一旦发现要改 in_scope 之外的模块，**立刻停下来**（`coding.scope_stop`：`1=回 plan 阶段 走 Scope 扩展` / `2=收窄实现`），回到 plan 阶段 的 Step 2.5.3 走 scope 扩展提议。
> 3. **逐文件 Lint 门禁（新）**：Step 3 已强化为"单文件 Lint 不过不得进入下一个文件"，**严禁批量生成多个文件后再统一 lint**。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "开始编码"、"实现功能"、"写代码"、"开发模块"
- "生成代码"、"编码实现"、"落地实现"
- 明确指向一份 plan.md 并要求实现

### 进入本 Skill 的前置闸门（BLOCKER）

用于避免「用户只想改 plan，agent 却默认实现代码」以及「plan.harness 滞后在编码之后」。

1. **纯设计请求不得入境**：当前消息若仅在修订 `plan.md`、`contracts.yaml`、use-cases 或plan 说明（例如「修正 plan」「更新 plan 文档」「对齐 spec 改 plan」），而**没有**上表所列编码意图，**视为未激活本 Skill**：不得新增或修改**实现层产物**（定义见 plan 阶段「plan 与编码的会话内硬边界」），不得执行下文 Step 2 及之后的实现步骤；应回到 plan 阶段。
2. **plan 刚修订则须先有 harness 顺位**：若在本会话或紧邻的上一轮中，agent 刚写入/更新过当前 feature 的 `plan.md` 或 Step 11 Spec，则在对**任何**实现层产物落笔之前，必须已对该 feature 执行 `harness-runner.ts --phase plan` 且脚本层零 BLOCKER（或已向用户如实报告 FAIL 并在修复后重跑至 PASS）。**禁止**「实现先改、plan.harness 后补」。
3. **与人审闸门对齐**：当 plan 阶段 的「plan 与编码的会话内硬边界」适用时（典型：用户要先审 design），须取得用户**明示**可以编码后，才允许执行本 Skill 的实现步骤；不得把「设计文档已保存」默认等同「用户已批准实现」。
4. **连续执行须用户写明**：若用户希望「design 定稿后立即编码」，须在指令中**同时**表达设计侧定稿要求与编码侧开工要求（可写在同一条消息）；agent 不得仅凭「帮你改设计」类模糊表述自行贯穿 plan 阶段→3。

## 核心架构认知

**开始编码前，必须读取 `doc/architecture.md` 获取最新的模块架构全貌，并以 `framework.config.json > architecture` 作为机器可读依赖规则。**

核心元规则：

1. 外层依赖按 `architecture.outer_layers[].can_depend_on` 裁决。
2. 同层依赖按 `intra_layer_deps` 裁决。
3. 模块内部依赖按 `architecture.module_inner_layers` + `inner_dependency_direction` 裁决。
4. 跨模块访问必须经由 `architecture.cross_module_exports_file` 声明的出口文件。
5. profile 专属目录、语言、模块格式、配置文件与资源规范以 Step 0 addendum 为准。

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| plan.md | ✅ | 对应功能的实现计划（plan 阶段 输出），路径通常为 `doc/features/{module}/plan/plan.md` |
| contracts.yaml | ✅ | 接口契约 Spec（plan 阶段 产出），路径为 `doc/features/{module}/contracts.yaml`，定义了接口签名、数据模型、文件清单等强契约 |
| acceptance.yaml | ✅ | 验收标准 Spec（spec 阶段 产出），路径为 `doc/features/{module}/acceptance.yaml`，定义了验收标准和边界用例 |
| ui-spec.yaml | ⚠️→✅ | **ui_change=new_or_changed 时必填**；路径 `doc/features/{module}/spec/ui-spec.yaml`（组件树 + token + 资产 + 逐字文案 SSOT） |
| 原始需求截图 | ⚠️→✅ | **ui_change=new_or_changed 时必填**；须 `Read` Visual Handoff `authoritative_refs` 指向的原图（强 VL 推荐） |
| use-cases.yaml | ⚠️ | 业务流程 UseCase Spec（plan 阶段 产出；**仅**多 UI 共享状态 / 多步云调用 / 含回滚分支的复杂 feature 才会有该文件），路径为 `doc/features/{module}/use-cases.yaml`，定义了每个 UseCase 的 coordinator / ui_bindings / data_boundaries / state_model / branches |
| doc/architecture.md | ✅ | 项目模块架构的唯一事实来源，了解五层架构全貌和已有模块状态 |
| spec.md | ❌ | 可选，用于交叉验证功能完整性 |
| 当前工程代码 | ✅ | AI 自动读取，用于理解现有模块结构和避免冲突 |

**若缺少 plan.md**：提示用户先运行 plan 阶段 生成设计文档，或提供等效的功能描述和文件规划。

**若缺少 contracts.yaml 或 acceptance.yaml**：提示用户先确认 spec 阶段/2 是否已提取 Spec 文件。若 Spec 不存在但 plan.md 和 spec.md 存在，可从中提取。

## 工作流程

### Step 1: 读取并解析 plan.md + Spec 契约

1. 读取指定的 `plan.md` 文件
2. 读取对应的功能级 Spec 文件（编码时的**强契约基准**）：
   - `doc/features/{module}/contracts.yaml` — 接口签名、数据模型、文件清单、组件 Props 的精确契约
   - `doc/features/{module}/acceptance.yaml` — 验收标准和边界用例，用于确保代码覆盖所有业务场景
3. 提取以下关键信息（**以 contracts.yaml 为权威来源**，plan.md 为补充上下文）：
   - **涉及哪些 Module**（格式按当前 profile）及其依赖关系 ← `contracts.yaml > modules` + `module_dependencies`
   - **每个 Module 内涉及哪些层和文件** ← `contracts.yaml > files`
   - **数据模型**（data/model/ 下的 interface / class）← `contracts.yaml > data_models`
   - **数据仓库**（data/repository/ 下的 CRUD 接口）← `contracts.yaml > interfaces`
   - **业务编排层**（v2.1：条件性产出 — 仅在触发 `use-cases.yaml` 复杂度阈值时；代码形态按 Step 3.5 三选一）← plan.md + `use-cases.yaml`（若有）
   - **组件树**（presentation 层的页面和复杂组件构成）← `contracts.yaml > components`
   - **端云接口**（shared/client/ 下的请求定义）← plan.md
   - **路由配置**（`contracts.yaml > navigation`；宿主侧页面注册文件见 profile addendum）
   - **验收标准和边界用例** ← `acceptance.yaml > criteria` + `boundaries`
   - **资源 Key 契约** ← `contracts.yaml > resource_keys`

4. 输出**模块 × 层**的实现清单；**`coding.module_batch`**：`1=继续下一模块` / `2=修改本模块`。

```
📋 待实现清单（按模块和层级排列）：

🔷 Module: common (<profile-format>) — 公共基础模块
  [shared/constant]  CommonTypes.<ext> — 全局通用类型
  [shared/utils]     FormatUtils.<ext> — 格式化工具

🔷 Module: feature_demo（`<profile-format>`）— 示例功能模块
  [shared/client]    DemoApiClient.<ext> — 列表数据接口
  [shared/constant]  DemoConstants.<ext> — 功能常量
  [shared/components] ListRowView.<ext> — 列表行基础视图
  [data/model]       ItemInfo.<ext> — 条目数据模型
  [data/model]       BannerInfo.<ext> — Banner 数据模型
  [data/repository]  ItemRepository.<ext> — 条目数据仓库
  [data/repository]  BannerRepository.<ext> — Banner 数据仓库
  [domain/actions 或 Page 内命名方法，按复杂度自选] loadDemoPage — 示例数据加载逻辑（本例复杂度低，推荐 Page 命名方法而非独立类）
  [presentation/components] ItemCarousel.<ext> — 轮播复杂组件
  [presentation/components] ActionGrid.<ext> — 快捷操作宫格组件
  [presentation/pages] DemoHomePage.<ext> — 演示首页

🔷 Module: app-shell (<profile-format>) — 主入口
  [presentation/pages] Main.<ext> — 主框架
  [配置] 更新宿主工程声明的**页面注册**与**资源清单**（文件名因 profile 而异；常见键名见 profile addendum，如页面列表、路由表、字符串表等）
```

### Step 2: 确定实现顺序

遵循**双重自底向上**原则：

**第一维度——模块间顺序**（自最底公共层向产品壳 / Feature）：

- 严格顺序由 **`doc/architecture.md` 与 `framework.config.json > architecture`** 声明；脚本 harness 会校验 `outer_layers` / `intra_layer_deps`。
- 计划实施时：**被依赖方先于依赖方**落地（自底向上）。

**第二维度——模块内顺序**：

- 遵循当前 profile addendum 的「模块内分层」约定（常见：`shared → data → domain → presentation`，以实例 DSL 为准）。

**综合顺序示例**（占位示意，**禁止**照抄模块名；请替换为架构 SSOT 中的真实依赖链）：

```
1. <systembase_func>（工具 / log 等）
2. <systembase_ui>（公共 UI）
3. <businessbase_xxx>（横切能力）
4. <feature_xxx>：shared → data → … → presentation
5. <product_shell>（入口 / 产品壳）
6. 资源与模块包配置
```

### Step 2.5: Research Sub-Phase（Context Exploration Gate · BLOCKER）

在**写入第一个实现层源文件之前**（即进入 **Step 3** 之前），必须完成本 Step。

#### Step 2.5a 视觉真源 Read（ui_change=new_or_changed 时 · BLOCKER）

1. **必须 `Read`**：`authoritative_refs` 指向的**每一张原图** + `ui-spec.yaml` 全文。
2. UI 实现以 **原图 + ui-spec 的 token / 组件树 / 逐字文案 / 资产 key** 为准；禁止占位图标、全局主题色、泛化文案 silently 替代。
3. 资产缺失须按 ui-spec `assets[]` 显式 `placeholder`，不得静默替换。
4. **弱模型**：若无法看图，仍须完整读取 ui-spec 文本 SSOT（提取阶段应用强 VL/人工 gate）。
5. **模型档位**：Read 原图步骤推荐强 VL；纯编码步骤可用内网弱模型（见 ui-spec.md 解耦说明）。

#### Step 2.5b Context Exploration（与原流程衔接）

1. **必读**：`plan.md`、`contracts.yaml`、`acceptance.yaml`、`use-cases.yaml`（若有）、architecture DSL、跨模块出口；**打开 contracts 涉及的已有源码**（`source_code_paths` ≥ 3）。
2. **默认 subagent**：coding 阶段**默认 MUST** explore 子 agent 分片阅读；**仅** L1 trivial 可豁免（见 `change_intent` / `estimated_loc_delta`）。无 subagent 时用 `sequential` + 倍率阈值。
3. 落盘 `doc/features/<feature>/coding/context-exploration.md`，**`schema_version: "1.1.0"`**，Code Facts + `decisions_unlocked` 非空。

### Step 3: 逐模块逐层生成代码（强制逐文件 Lint 门禁）

对每个实现项执行以下**严格的单文件闭环**，**禁止批量生成多个文件后再统一验证**：

1. **开文件前的自检（针对弱模型尤为重要）**
   - 重读 profile addendum 声明的宿主语言易错手册中与当前文件类型相关的 2-3 条。
   - 声明当前上下文：哪个 Module、哪个层、依赖了哪些已完成的代码。
   - **Scope 守门**：确认当前要写的文件路径是否在 `doc/features/{feature}/plan/plan.md` 的 `in_scope_modules` 对应模块内；若不是，停下来，不得继续。

2. **生成代码**：严格按照 `contracts.yaml` 的强契约（文件路径 / 接口签名 / 数据模型 / 组件 Props / 资源 Key 一致），并覆盖 `acceptance.yaml > boundaries` 定义的异常处理。

3. **写入文件**：仅写入**当前这一个**文件。

4. **单文件 Lint 门禁（BLOCKER，禁止跳过）**：
   - 立即对刚写入的文件执行 `ReadLints`。
   - 有任何 error → 原地修复，再次 `ReadLints`，直到零 error。
   - 有 warning → 评估是否可修（不可忽略）。
   - **只要当前文件 Lint 未过，不得开始写任何其他文件**。这条规则对弱模型尤其重要：弱模型在长上下文中容易累积错误，批量生成后再统一 lint 会把"一个小错误"放大为"多个文件间的连锁错误"。

5. **单文件自校对**：对照 **profile addendum 列出的宿主语言易错手册**中与当前文件相关的条目。

6. **层间依赖检查**：验证本文件的 `import` 语句未违反模块内四层依赖（shared ← data ← domain ← presentation）和模块间五层依赖矩阵。

7. **展示给用户并等待确认**：输出本文件代码并说明关键决策。用户有修改意见则调整后重新走 3-6 步；确认通过后才进入下一个文件。

> **弱模型特别提示**：
> - 假设你的上下文窗口"大但不可靠"——上一个文件的细节（变量名、类型、资源 key）你可能"记得但记错"。
> - 写下一个文件前，**主动用 `ReadLints` / `grep` / `Read` 去验证你引用的符号**，不要凭记忆 import。
> - 每个文件都是独立的 lint 单元，不要期待"等几个文件都写完一起修"——弱模型的"一起修"在实践中会漏。

### Step 3.5: 业务编排与命名入口约束（v2.1）

**触发条件**：仅当 `doc/features/{feature}/use-cases.yaml` 存在时才执行本步骤。
**核心原则**：v2.1 **不再强制** "必须在 `domain/usecase/` 下新建 `XxxUseCase` 类"、"必须新造 `XxxPort` 接口" 这类代码形态硬规则。由本 Skill 按复杂度自选最贴合的形式，但**必须**满足 `named_business_handler` 规则。

#### 3.5.1 业务编排代码形态（三选一，按复杂度渐进）

根据 `use-cases.yaml` 中 `coordinator` 字段的命名风格和业务复杂度，自选落地形态：

| 形态 | 何时选用 | 物理位置 | 示例 |
|------|---------|---------|------|
| **A. Page 命名方法** | 单页面内的线性业务流（1~3 步调用），无跨 UI 状态共享 | `presentation/pages/XxxPage.<ext>` 内的命名 `async` 方法 | `HomeTabPage.loadHomeData()` |
| **B. 普通协调类（Flow / Coordinator）** | 多 UI 共享状态、多步调用、可能有回滚 | 放在模块业务语义最贴合的目录（优先 `domain/` 或 `shared/` 均可），是一个**非 UI 组件**的普通 class | `domain/flow/CheckoutFlow.<ext>` 中的 `class CheckoutFlow` |
| **C. 导出命名函数** | 工具化 / 无状态的业务编排 | `domain/` 或 `shared/` 下的宿主语言文件，`export async function xxx(...)` | `domain/home/loadHomeData.<ext>` 中的 `export async function loadHomeData()` |

**关键约束（适用于 A / B / C 三种形态）**：

1. `use-cases.yaml > ui_bindings[].user_actions[].calls` 引用的必须是**真实存在的命名符号**，与代码中**完全一致**（business-ut Harness 的 `named_business_handler` BLOCKER 会严格校验）。合法形态包括：
   - 传统 `function xxx() {}` / `async function xxx() {}`
   - 类/对象方法 `xxx() {}` / `async xxx() {}`
   - 顶层导出 `export function xxx` / `export const xxx = ...`
   - **宿主语言类字段函数**（若当前 profile 支持）：`handleClick = async () => {}`、`handleClick: () => void = () => {}`、`handleClick = function() {}`
   - 顶层 `const/let/var xxx = () => {}`
2. **禁止匿名 inline lambda 承载业务**：UI 的 `.onClick(() => { 做一堆业务 })` 这种**匿名**写法**禁止**用于 `use-cases.yaml` 列出的入口；必须先有命名符号（传统函数 / 命名类字段函数 / 命名 const）再被 `onClick` 转发
3. 每次 `calls` 引用的实体必须是 UT 可直接调用的（无需构造 **UI 组件**、无需 UI runtime）——形态 A 需要把业务代码从 UI 结构中抽成 `class`/`function`，或选形态 B/C
4. **禁止新造 Port 接口**：`data_boundaries` 的 `type` 必须是 `contracts.yaml` 已登记的**既有** data 层类（Repository / Client 等）。UT 通过 Spy/Fake/Stub 子类化或原型替换实现打桩，不要求额外抽象接口

#### 3.5.2 业务编排代码的禁用 import（BLOCKER）

**宿主具体禁入符号清单**（声明式 UI 组件、资源宏、Toast 等）见：

`framework/profiles/<project_profile>/skills/coding/profile-addendum.md`

以下为**中立约束**：形态 B / C 的源文件以及形态 A 中的命名方法体**内**，禁止 import **任何 UI / 导航 / 资源运行时** API（含仅为类型引用），除非 profile 明确豁免。

#### 3.5.3 UI 层的最小改造（按 `ui_bindings` 落地）

对每个 `ui_bindings[]` 条目：

- `role: entry | progress | dialog | result | passive`：按角色实现
- `subscribes: [state.phase, state.xxx]`：UI 层用 `@Watch` 或状态订阅翻译为渲染/跳转/Toast
- `user_actions[].calls = <symbol>`：UI 的 `onClick` 只做"参数准备 + 转发调用"，**不写业务分支**

> 形态 B / C 时：页面通过构造时注入（或通过 DI 容器 / 单例持有），例如持有 `CheckoutFlow` 实例；UT 中可用 Spy 边界在同一类上直接实例化验证。

#### 3.5.4 自检（每完成一个业务编排文件后立即执行）

```bash
# 仅示意：在业务编排源文件上扫描「profile addendum 披露的 UI 禁入关键字」
# （PowerShell 示例，路径与 pattern 请按宿主文档替换）
Select-String -Path "<path>/<Flow>.<ext>" -Pattern "<profile-ui-symbols>"
```

命中任一关键字 → 立即停下来改正。

**命名入口一致性自检**：
1. 打开 `doc/features/{feature}/use-cases.yaml`
2. 对每个 `ui_bindings[].user_actions[].calls`，在代码中 `grep` 该符号
3. 确认：(a) 确实存在；(b) 是**命名符号**——传统函数/类方法/类字段函数（`handleClick = async () => {}`）/命名 `const` 赋值 的箭头函数 **都算合法**；仅**匿名直接挂载**在 UI 事件上（如 `.onClick(() => { 一堆业务 })`）的写法不合法

business-ut Harness 会用 `named_business_handler` BLOCKER 严格校验该项，本 Skill 内自检能节省回环成本。

### Step 4: 模块配置与资源文件

功能代码全部完成后，统一处理配置：

**模块级配置（每个新模块）**：
1. profile 声明的模块包描述文件 — 模块包描述和依赖声明
2. profile 声明的模块构建配置文件
3. `{层目录}/{ModuleName}/src/main/module.json5` — 模块元数据
4. profile 声明的根级模块清单 — 注册新模块
5. profile 声明的根级依赖清单 — 添加模块间依赖

**资源文件（每个 Module 内）**：字符串 / 颜色 / 尺寸 / 媒体等——以 **profile** 声明的资源目录与文件名为准（目录布局见 addendum）。

**路由配置**：**产品壳 / 宿主入口模块**需按.Navigation 约定注册各 Feature 的**页面**；若使用系统路由表，在 profile 声明的 **`route_map.json`** 路径维护映射（详情见 addendum）。

### Step 5: 质量门禁自检

所有模块完成后，执行最终自检：

```
[ ] 1. 模块完整性：plan.md 中涉及的所有 Module 是否已创建并正确配置？
[ ] 2. 分层合规性：每个文件是否位于正确的层级目录？是否存在反向依赖？
[ ] 3. 文件完整性：plan.md 中规划的所有文件是否已全部创建？
[ ] 4. 接口一致性：组件/函数签名是否与 plan.md 定义一致？
[ ] 5. 编译检查：执行 ReadLints，确认零 error？
[ ] 6. 资源引用：界面文本与样式是否均通过 **宿主声明的资源机制** 引用（API 形态见 addendum）？
[ ] 7. 页面注册：新增页面是否已按 **navigation / 页面注册文件** 声明（见 profile addendum）？
[ ] 8. 无硬编码字符串：界面文本是否已消除违规硬编码（以 phase-rules + profile 为准）？
[ ] 9. DAG 合规性：模块间依赖方向是否正确？无循环依赖？
[ ] 10. 导入完整：所有 import 语句是否完整，路径是否正确？
[ ] 11. 命名入口完整性（若 use-cases.yaml 存在）：`ui_bindings[].user_actions[].calls` 所列每个符号是否都能在代码中找到对应命名方法 / 函数 / 导出符号（非 inline lambda）？业务编排源文件（形态 B / C）是否**零**UI/Nav/Toast/AppStorage import？
[ ] 12. UI 层副作用翻译（若 use-cases.yaml 存在）：UI 的 `onClick` 是否只做"参数准备 + 转发调用命名函数"？Toast/导航是否通过订阅业务 state（`@Watch` 或等价）翻译，而非 `onClick` 内部硬编码分支？
[ ] 13. 视觉 parity（ui_change=new_or_changed）：主题色 token 是否已应用到 `$r('app.color.*')`？真实资产 key 是否非占位？ui-spec 逐字文案是否落入 string 资源？组件树 major 节点是否在 contracts.components 有对应？
```

**不通过项**：定位具体问题，自动修复后重新检查，直到全部通过。

### Step 6: 输出交付摘要

```markdown
## 编码交付摘要

### 模块变更
| Module | 格式 | 变更类型 | 说明 |
|--------|------|----------|------|
| common | <profile-format> | 新增/修改 | 说明 |
| feature_demo | <profile-format> | 新增 | 说明 |
| app-shell | <profile-format> | 修改 | 说明 |

### 新增文件（按模块×层级）
| Module | 层级 | 文件路径 | 说明 |
|--------|------|----------|------|
| feature_demo | shared/client | DemoApiClient.<ext> | 列表接口 |
| feature_demo | data/model | ItemInfo.<ext> | 条目数据模型 |
| ... | ... | ... | ... |

### 质量门禁结果
- [x] 模块完整性：通过
- [x] 分层合规性：通过（零反向依赖）
- [x] 文件完整性：通过
- [x] DAG 合规性：通过
- [x] 编译检查：通过（0 error）

### 下一步
- 运行 Harness 验证（Step 7）；四件套 PASS 后 **`coding.ok_to_review` / `phase.next_step` 停等**（user-confirmation-ux §8），**禁止**同一执行流自动开 code-review
```

### Step 6.5: 真实编译闭环（必要出口）

> v2.2 新增：**编译/宿主静态检查是 coding 的必要出口条件**，不是可选项。本步骤要求 agent **自己**执行当前 profile 声明的 `coding.compile` capability、读取日志、定位问题、修复并重跑，直到零 error。对应 BLOCKER 会在 Step 7 强制兜底；本 Step 是 coding 自检的最后一道。

#### 6.5.1 执行真实编译

**首选方式（v2.3 起推荐）**：通过 harness 触发，避免 agent 自己拼复杂宿主命令时出错；profile provider 负责具体工具链参数与环境注入：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature <feature-name> --summary --failures-only
```

`coding.compile` BLOCKER 的具体 provider 与日志格式由当前 profile 声明；完整日志与 summary 落在 `doc/features/<feature>/coding/reports/` 下。PASS 另需命中 profile provider 声明的成功哨兵，避免「退出码 0 但输出异常」误判。
优先读取 `doc/features/<feature>/coding/reports/summary.json`；其中 `coding_run_status` 的 `can_claim_done` 必须为 `YES` 才能进入 verifier + receipt。

> **不要**让 agent 自己手敲完整宿主编译命令行；具体命令应由 profile provider 或 harness 封装。

profile 专属命令形态、超时与性能调优说明放在对应 `framework/profiles/<profile>/` addendum 或 provider 文档中；中立 Skill 不假设某个工具链一定存在。

#### 6.5.2 自闭环修复策略

1. **看 verdict**：harness 报告里 profile compile capability 状态为 PASS 才算编译过；FAIL 进入修复闭环。
2. **读完整日志**：harness 把日志写到 `doc/features/<feature>/coding/reports/`（agent 必须 Read 完整内容，不允许只看前 100 行就猜）。
3. **按错误类型分类**：
   - 宿主语言语法 / 类型错误 → 回到 Step 3 修文件；
   - `project_dependency_missing` / `Cannot find module` 等依赖缺失 → **先**按 [Host harness readiness · Tier_1](../../reference/host-harness-readiness.md) 核对 harness 自身 `npm install` / `node_modules/ts-node`（Tier_1 细节以该 SSOT 为准）。若 Tier_1 已满足，harness 会在同一次 run 内自动 `ohpm install` 并重编译（profile 声明 `coding.deps_install` 时）；agent **不得**要求用户手工安装。仅当 `project_dependency_install_failed`（registry/鉴权/网络）时按 ohpm 日志向用户求助；`project_dependency_undeclared` 时 agent **自补** oh-package.json5 声明后重跑。
   - profile 包描述 / 模块依赖错误 → 回到依赖章节补依赖；
   - 资源引用（**宿主资源 API**，见 profile）缺失 → 回到资源声明章节补声明。
4. **修完 → 再跑**：重复 6.5.1，直到 profile compile capability PASS。
5. **绝不允许**：
   - 把编译失败定性为"环境问题"绕过；
   - 用环境变量跳过当前 profile 的 BLOCKER compile capability（harness 会把它转成 FAIL）；
   - "改了就不验"——必须真的过一次 harness 编译规则才算闭环。

#### 6.5.3 工具链不可用怎么办

若 harness 报告 profile compile capability FAIL 且 details 指向宿主工具链不可用：

1. 检查 `framework.config.json` 是否存在当前 profile 要求的 toolchain 配置，且路径/命令在文件系统中存在；
2. 未配置 / 路径错误 → 运行 profile 提供的探测脚本（若有），或参考 [framework/skills/project/framework-init/SKILL.md](../../project/framework-init/SKILL.md) 走完整配置流程；
3. 配置后再次跑 6.5.1。

**绝不允许**：因为找不到工具就把规则状态写成 SKIP 或 PASS 上交，也不允许用跳过环境变量绕过。

### Step 7: Harness 验证门禁（agent 必须自跑，不得仅"告知用户"）

> **v2.4 强约束（呼应全局入口 §4.1）**：本步骤是编码阶段的**必要出口**。
> agent **必须自己**通过 Shell 工具执行下述 harness 命令、读取报告、判定 verdict；
> **严禁**只在回复里写"建议用户运行"、"可使用以下命令"然后直接结束对话——
> 这种行为已经被全局入口 §6.5「反假设条款」明确列为软幻觉，由物理拦截层兜底。

编码阶段的 Harness 是**价值最高**的验证环节——它能自动检测文件缺失、接口偏离、分层违规、资源引用错误等编码常见问题。

#### 7.1 脚本 Harness（确定性检查，agent 自跑）

agent 必须自己执行（不是"提醒用户"，是 agent 通过 Shell 工具直接运行）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature {module-name} --summary --failures-only
```

执行后 agent **必须**：

1. Read 退出码（0 = PASS，非 0 = FAIL）；
2. Read `doc/features/<feature>/coding/reports/` 下的报告文件，逐条核对 BLOCKER；
3. 优先 Read `summary.json`，确认 `coding_run_status.can_claim_done=YES`；
4. **若有 BLOCKER 或 `can_claim_done=NO`**：自己回到 Step 3 修复，重跑，直到零 BLOCKER 且状态面板允许完成；
   - 若 `summary.next_action = rerun_with_HARNESS_DIFF_BASE_REF_working` 或 `diff_within_scope` 报 `stale_diff_base`：必须自动重跑一次 `HARNESS_DIFF_BASE_REF=working npx ts-node harness-runner.ts --phase coding --feature <feature>`。重跑后若仍有越界文件，才进入 scope 扩展提议或撤销误改流程。
   - 若 `summary.next_action = resolve_project_dependencies_then_rerun` 或 compile capability 报 `project_dependency_missing`：harness 应已自动安装；若仍 FAIL，读 `ohpm-install.log` 与 `failure_kind` 按 Step 6.5.2 处理，**不得**只要求用户手工 `ohpm install`。
   - 若 `summary.next_action = declare_dependencies_then_rerun` 或 `failure_kind = project_dependency_undeclared`：agent 自补 oh-package.json5 依赖声明后重跑。
   - 若 `summary.next_action = resolve_dependency_install_blocker_then_rerun` 或 `failure_kind = project_dependency_install_failed`：按 ohpm 日志 registry/鉴权/网络原因处理，必要时向用户求助。
5. **不得**让用户"自行运行验证"；用户运行只是**额外**的复核渠道，不是 agent 的退出条件。

#### 7.1.1 脚本 / 编译 FAIL 时用户可见汇报（BLOCKER）

harness **非 0 退出**或 `summary.json` 中 `coding_run_status.can_claim_done=false` 时，向用户的**首段**必须是脚本结论，**禁止**先问「是否进入 code-review（Code Review）」或并列展示「verifier PASS + 脚本 FAIL」暗示可推进。

**必须同步执行**（禁止后台 harness + 并行 verifier）：

1. Read `doc/features/<feature>/coding/reports/summary.json`：`verdict`、`next_action`、`compile_first_error`（若有）、`run_statuses`
2. Read 编译日志路径（`coding_compile` details 中的 `日志落盘` / `元数据` 路径；profile 落盘文件名见 addendum），摘录**第一条**错误：`文件:行 — 消息`
3. 按下列模板汇报（可增删细节，但五项不可缺）：

```markdown
## Coding 阶段：未完成（脚本 harness FAIL）

- **脚本 verdict**: FAIL | blocker_count: N | can_claim_done: NO
- **编译** (`coding_compile`): FAIL
- **首条错误**: `<path>:<line> — <message>`
- **归因**: `<failure_kind>`（若错误不在本 feature contracts.modules，仍须写明「全工程编译未通过」）
- **下一步**: `<summary.next_action>` → 按 Step 6.5.2 处理（harness 自动安装 / agent 补声明 / 安装失败才求助用户）

**禁止**：提议 code-review；用 verifier PASS 代替脚本 PASS；称「无法确认是否编译」而不读日志。
```

**`--clear-state`**：仅当用户**明示放弃**当前 feature 的 coding 阶段（如「放弃 coding」「不闭环了」）时可用；**禁止**为进入 code-review 或消除 Stop hook 而 clear-state。

> ⚠️ **必须通过 `harness-runner.ts` 入口**：直接 `ts-node scripts/check-coding.ts` 不会触发任何检查（`check-*.ts` 只是导出 checker 模块，没有 CLI 入口），会静默返回 0 造成"假通过"。

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/coding-rules.yaml` — 阶段级通用规则
- `doc/features/{module-name}/contracts.yaml` — 功能级接口契约
- `doc/features/{module-name}/acceptance.yaml` — 功能级验收标准

**脚本检查覆盖项**：

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| 文件完整性 | contracts.yaml 中列出的所有文件是否存在 | BLOCKER |
| 分层合规 | 模块内 import 是否违反 shared→data→domain→presentation | BLOCKER |
| 模块间依赖 | import 是否违反五层架构依赖矩阵 | BLOCKER |
| 资源引用完整性 | 宿主资源引用 API 是否与资源定义一致 | BLOCKER |
| 硬编码字符串 | presentation 层是否存在未走资源机制的 UI 文本 | MAJOR |
| 模块导出 | 每个需跨模块访问的模块是否通过 DSL 声明的出口正确导出 | BLOCKER |
| 模块注册 | 新模块是否在宿主构建清单中注册（文件名因 profile 而异） | BLOCKER |
| 页面注册 | 新增页面是否在宿主**页面注册 / 路由清单**中登记 | BLOCKER |
| 命名规范 | 模块名/组件名/文件名/资源 key 是否符合命名约定 | MAJOR |
| 禁止 any | 代码中是否存在 any 类型 | MAJOR |

**若报告中存在 BLOCKER**：必须修正代码（回到 Step 3），直到零 BLOCKER。

#### 7.2 AI Harness（语义级检查，agent 主动通过 Task 工具触发 verifier 子 agent）

agent 必须主动通过 Task 工具调用 verifier 子 agent（不是"告诉用户去跑"）：

- **Prompt 模板**：`framework/harness/prompts/verify-coding.md`
- **触发方式**：通过 Task 工具调用 `subagent_type: verifier`，prompt 中传入 feature / phase / 脚本报告路径，子 agent 会自行读取 `verify-coding.md` 并产出报告
- **语义检查覆盖项**：
  1. 业务逻辑正确性 — 代码是否正确实现了 plan.md 描述的业务流程
  2. 异常处理完整性 — acceptance.yaml boundaries 中的每个异常场景是否有对应处理
  3. 接口签名一致性（BLOCKER）— 实际代码签名是否与 contracts.yaml 一致
  4. 组件 Props 一致性 — 实际 UI 状态/Props/事件是否与 contracts.yaml components 一致
  5. 数据所有权合规 — presentation 层是否绕过 Repository 直接操作数据
  6. 模拟数据隔离 — 模拟数据是否封装在 Repository 内部
  7. spec 验收标准覆盖 — acceptance.yaml criteria 中的 P0/P1 AC 是否都有代码实现

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 7.3 阶段闭环判定（全局入口 §5.1 SSOT）

> 下文「物理拦截层」：**部分 adapter** 经 framework-init 在实例根下发 **Stop hook**，在消息结束前读取 state 并阻断「假完成」（Layer 3 行为与路径见 [framework/agents/README.md](../../../../agents/README.md)）。**未**配置该能力的 adapter 不设物理层豁免，仍须满足 Layer 1（全局入口 §6.5「反假设条款」）+ Layer 2（完成回执 + `check-receipt.ts`）——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

**编码阶段宣布"完成"前，必须同时满足以下四条**（物理拦截层会按此判据拦截"假完成"）：

1. **trace.json 真实存在**：`doc/features/<feature>/coding/reports/trace.json` 已写入。
2. **脚本 harness PASS**：`harness-runner.ts --phase coding --feature <feature>` 退出码 0，零 BLOCKER。
3. **verifier 子 agent PASS**：通过 Task 工具触发 `subagent_type: verifier`，子 agent 报告 verdict = PASS。
4. **完成回执通过校验**：填写 `doc/features/<feature>/coding/phase-completion-receipt.md`（模板见 [framework/harness/templates/phase-completion-receipt.md](../../../../harness/templates/phase-completion-receipt.md)），并通过 `cd framework/harness && npx ts-node scripts/check-receipt.ts --feature <feature> --phase coding` 校验。

四条缺一不可。**仅靠口头"完成"不算闭环**——物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier 子 agent） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，编码阶段完成，**具备**进入 code-review（Code Review）的**资格**；**不授权**自动开 code-review。

**闭环停等（BLOCKER，user-confirmation-ux §8）**：须 **`coding.ok_to_review`** 或 **`phase.next_step`**（确认菜单 + portable 编号）停等，**禁止**读完 receipt/trace 后在同一执行流 Read code-review 并写 review（除非 batch 授权 §8.2）。

## 编码规范

生成代码时必须遵守以下规范（**完整条款以当前 `project_profile` 的 `templates/coding-standards.md` 为准**；以下为中立速记）：

### 核心规则速记

1. **分层规则**：每个 Module 内遵循架构 DSL 声明的内层顺序，禁止反向依赖
2. **模块格式**：按当前 profile 的模块格式与导出规则实现
3. **组件命名**：PascalCase；文件名与宿主「组件/类型」命名约定一致
4. **页面实现**：按宿主壳层与 Feature 页的分工实现（入口装饰符与路由页面形态见 profile addendum）
5. **资源引用**：界面文案/色值/尺寸走宿主资源系统（引用 API 见 profile addendum）
6. **数据所有权**：业务数据变更经 Repository（或实例协议规定的边界），presentation 不直接碰数据源
7. **复杂组件**：封装交互闭环时使用宿主推荐的组件生命周期与刷新模式
8. **异步操作**：使用宿主推荐的异步范式（如 `async/await`）
9. **列表性能**：大列表使用宿主推荐的懒加载/虚拟化机制

## 常用参考

- Profile 编码 addendum: `framework/profiles/<profile>/skills/coding/profile-addendum.md`
- Profile 宿主语言/组件/API 参考：以 addendum 中列出的 `reference/` 与 `templates/` 为准
- 编码规范完整版: `` `profile-skill-asset:coding/coding_standards` ``（解析规则见 [Profile skill asset protocol](../../../README.md#profile-skill-asset-protocol)）

## 关联文件

- 上游输入:
  - `doc/features/{module}/plan/plan.md`（plan 阶段 输出）
  - `doc/features/{module}/contracts.yaml`（plan 阶段 产出的接口契约 Spec）
  - `doc/features/{module}/acceptance.yaml`（spec 阶段 产出的验收标准 Spec）
- 阶段级规约: `framework/specs/phase-rules/coding-rules.yaml`
- 脚本 Harness: `framework/harness/scripts/check-coding.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-coding.md`
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **code-review (Code Review)** | 源代码 + contracts.yaml | 审查代码与契约的一致性 |
| **business-ut (业务级 UT)** | 源代码 + acceptance.yaml | 基于验收标准生成 UT |
| **Harness (验证层)** | 源代码 + contracts.yaml + acceptance.yaml | 脚本/AI 验证编码质量 |

## 约束与注意事项

1. **contracts.yaml 是强契约**：文件路径、接口签名、数据模型、组件 Props 必须与 `contracts.yaml` 定义一致。若发现 Spec 有明显问题（类型错误、API 不存在、分层违规），先向用户指出并确认修正方案，修正后同步更新 contracts.yaml
2. **逐模块逐层交付**：按 Module 和层级分批生成代码；每批 **`coding.module_batch`** 编号确认后再继续
3. **模拟数据优先**：若本轮无法接入真实后端，在 shared/client（或宿主等价层）定义接口，由 data/repository 用本地替身数据实现
4. **中文注释**：代码中非显而易见的业务逻辑使用中文注释说明意图
5. **渐进式实现**：先实现 P0 核心功能确保可运行，再叠加 P1/P2 功能
6. **不破坏现有代码**：修改现有文件时，只做增量修改，不改动无关代码
7. **编译可达**：每完成一个层级后，代码应处于可编译状态
8. **模块导出**：需要跨模块访问的 API 必须通过 DSL 声明的出口导出，未导出的内容为模块私有
9. **边界场景覆盖**：代码必须处理 `acceptance.yaml > boundaries` 中定义的所有异常场景（网络异常、空数据、功能暂不支持等）
10. **Harness 验证闭环**：编码完成后 agent **必须自己运行** Harness 验证（Step 7），并主动通过 Task 工具触发 `subagent_type: verifier`；确保零 BLOCKER + verifier PASS + 完成回执通过校验后才进入下一阶段（物理拦截层兜底）

---

## Slash / 快捷入口触发时的 trace 约定

当本 Skill 通过适配器下发的 slash（如 `/coding`）或其它等价快捷入口触发时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`doc/features/<feature>/coding/reports/<timestamp>/<model>-code/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `coding`。
- **必须记录的事件**（针对弱模型迭代最关键）：
  - `tool_calls`：`ReadLints`（或等价宿主静态检查）的 `count` 和 `failed_count`（每文件一次的调用频率是弱模型健康度的核心指标）
  - `retries`：`lint_error` / `language_rule_violation`（及与 `trace.schema.json` 示例一致其它 trigger）每次自修尝试次数，`related_file` 必填；具体宿主 profile 可能在 addendum 中把坑位自修挂到上述中性 trigger，或附 `notes` 说明
  - `human_pain_points`：**宿主语言**工程可复用 schema 中细分标签（如某 profile 的 pitfalls 清单）；其它 profile 优先用 `compile_correctness` 等 schema 枚举内中性分类（见 `trace.schema.json`）
  - `harness_checks`：`check-coding.ts` 的结果，特别是 `diff_within_scope` 是否通过
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../../../framework/harness/trace/gap-notes.template.md)。

---

## 运行时交付约定（内网 / 弱模型）

```
doc/features/<feature>/coding/reports/<timestamp>/<model>-coding/
├── trace.json                 # phase = "coding"
├── gap-notes.md
├── check-coding.report.md     # 包含 diff_within_scope 结果
└── verifier.report.md         # verifier 跑 verify-coding.md（可选）
```

**本 Skill 最容易发生的痛点（记入 `human_pain_points`）**：
- `arkts_correctness`（见 schema：兼容某宿主语言的工单分类标签）或更中性的 `compile_correctness`：**宿主语言**语法/API 与设计约束不一致；具体坑位清单见当前 `project_profile` addendum 指向的易错参考；
- `contracts_mismatch`：实现与 `contracts.yaml` 签名/路径/资源 key 不一致；
- `scope_creep`：`git diff` 出现 design `in_scope_modules` 外的文件。

每次在 retry 一个文件时（lint 重跑、scope 越界回退），记入 `retries` 字段。
