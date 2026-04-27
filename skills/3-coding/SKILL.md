# 编码 Skill (`3-coding`)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

## 概述

你是一位资深鸿蒙（HarmonyOS）应用开发工程师，擅长 ArkTS 和 ArkUI 声明式开发。你的任务是根据技术设计文档（design.md）逐模块、逐层生成高质量的可编译代码。

本 Skill 是项目全生命周期流水线的**第三环**。上游输入来自 Skill 2（需求设计）的 `design.md`，输出（源码）将流入 Skill 4（Code Review）。

> **⚠️ 开工前必读（弱模型环境尤其重要）**
>
> 1. **ArkTS 易错手册**：[reference/arkts-pitfalls.md](reference/arkts-pitfalls.md) — 收录了 `@State` 初始化、`$r()` 资源引用、`ForEach keyGenerator`、`Router vs NavPathStack`、HAR `Index.ets` 导出等 15 条弱模型反复踩的坑。**每写一个 `.ets` 文件前必须至少回顾相关条目，写完后对照自检。**
> 2. **Scope 守门（新）**：本次编码的 git diff 不得越界到 design.md `in_scope_modules` 之外。Harness 的 `diff_within_scope` 规则会在 Step 7 阻断 BLOCKER。因此写代码时一旦发现要改 in_scope 之外的模块，**立刻停下来**，回到 Skill 2 的 Step 2.5.3 走 scope 扩展提议。
> 3. **逐文件 Lint 门禁（新）**：Step 3 已强化为"单文件 Lint 不过不得进入下一个文件"，**严禁批量生成多个文件后再统一 lint**。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "开始编码"、"实现功能"、"写代码"、"开发模块"
- "生成代码"、"编码实现"、"落地实现"
- 明确指向一份 design.md 并要求实现

## 核心架构认知

**开始编码前，必须读取 `doc/architecture.md` 获取最新的模块架构全貌。以下是架构核心规则摘要，详细的模块清单和状态以 architecture.md 为准。**

> **通用化说明**：本节的层级名称、模块名（`WalletMain` / `BankCard` / `CardManager` / `CommFunc` 等）均以**钱包工程为参考示例**。实际层数、层名、模块名以本工程 `framework.config.json` 的 `architecture` 段与 `doc/architecture.md` 为准；下方依赖规则（自上而下 DAG、模块内 upward、跨模块走 `Index.ets`）则是 framework 守住的通用元规则。

### 一、外层模块架构（示例：钱包工程 5 层）

参考实例采用 **5 层模块架构**，依赖方向**只能自上而下**。模块命名统一采用**大驼峰（PascalCase）**。

```
┌─────────────────────────────────────────────────────────────────┐
│  01-Product（产品层）                                            │
│    Phone (HAP) — 唯一的 HAP，仅放 Ability 入口代码               │
├─────────────────────────────────────────────────────────────────┤
│  02-Feature（特性层）— 内部按依赖关系分 3 个子层级                 │
│    顶层:   WalletMain — 公共页面（首页/设置等）                    │
│    中间层: SwipeCard — 刷卡/二维码支付                            │
│    底层:   BankCard / TransportCard / AccessCard / ...（按需）    │
├─────────────────────────────────────────────────────────────────┤
│  03-CommonBusiness（公共业务层）                                  │
│    CardManager / ConfigManager / PersistManager / ...（按需）    │
│    同层可互相依赖（DAG，禁循环）                                   │
├─────────────────────────────────────────────────────────────────┤
│  04-BusinessBase（业务基座层）                                    │
│    AccountManager — 华为账号登录管理                              │
├─────────────────────────────────────────────────────────────────┤
│  05-SystemBase（系统基座层）                                      │
│    CommFunc — 系统功能封装（log/状态机/util等）                    │
│    CommUI  — 公共UI组件（基础页面/弹框/Toast/卡片组件等）           │
└─────────────────────────────────────────────────────────────────┘
```

### 物理目录结构

模块按所属层级放置在层目录下，层目录以 `{序号}-{层名}` 命名：

```
{ProjectRoot}/
├── 01-Product/Phone/              (HAP)
├── 02-Feature/WalletMain/         (HAR, 按需新增)
├── 03-CommonBusiness/              (按需创建)
├── 04-BusinessBase/AccountManager/ (HAR)
├── 05-SystemBase/CommFunc/         (HAR)
├── 05-SystemBase/CommUI/           (HAR)
├── build-profile.json5             ← srcPath 如 "./01-Product/Phone"
└── oh-package.json5                ← 依赖路径如 "file:./05-SystemBase/CommFunc"
```

创建新模块或迁移旧模块时，`build-profile.json5` 的 `srcPath` 和 `oh-package.json5` 的依赖路径必须使用层目录前缀。

**层间依赖规则速查表**：

| 依赖方 ↓ \ 被依赖方 → | 01-Product | 02-Feature | 03-CommonBusiness | 04-BusinessBase | 05-SystemBase |
|----------------------|-----------|-----------|------------------|----------------|--------------|
| **01-Product** | — | ✅ | ✅ | ✅ | ✅ |
| **02-Feature** | ❌ | ⚠️ 见子层级规则 | ✅ | ✅ | ✅ |
| **03-CommonBusiness** | ❌ | ❌ | ⚠️ DAG，禁循环 | ✅ | ✅ |
| **04-BusinessBase** | ❌ | ❌ | ❌ | — | ✅ |
| **05-SystemBase** | ❌ | ❌ | ❌ | ❌ | ⚠️ CommUI→CommFunc 单向 |

**02-Feature 子层级**：WalletMain（顶层）可依赖所有 Feature → SwipeCard（中间层）可依赖 Feature 底层 → BankCard 等（底层）不可依赖任何 Feature。

### 二、模块内部结构（统一四层）

**所有模块**统一采用 shared → data → domain → presentation 四层内部结构。不同层级的模块按实际需要填充对应层，允许省略不需要的层。

| 内部层 | 子目录 | 职责 | 依赖规则 |
|--------|--------|------|----------|
| **shared** | `client/` | 端云请求定义 | 无内部依赖 |
| | `constant/` | 常量、枚举、通用类型 | 同上 |
| | `components/` | 基础 UI 组件 | 可依赖同层 constant/utils |
| | `utils/` | 纯函数工具类 | 可依赖同层 constant |
| | `log/`、`livedata/`、`theme/` 等 | 功能域子目录（SystemBase 模块常用） | 同上 |
| **data** | `model/` | 业务数据类型 + 内聚方法 | 可依赖 shared 层 |
| | `repository/` | 数据仓库（CRUD + 数据所有权） | 可依赖同层 model + shared/client |
| **domain** | `usecase/` | 复杂业务逻辑，编排多个 repository | 可依赖 data + shared |
| | `service/` | 核心服务逻辑（BusinessBase/CommonBusiness 常用） | 可依赖 data + shared |
| **presentation** | `components/` | 复杂组件（用户操作→逻辑→数据变更→UI刷新闭环） | 可依赖全部下层 |
| | `pages/` | NavDestination 页面 | 可依赖全部下层 |

**层间依赖绝对禁令**：shared ← data ← domain ← presentation，禁止反向。检测到反向依赖视为 **BLOCKER**。

#### 各层模块的典型填充

- **Feature 模块**（如 WalletMain）：四层均有内容
- **BusinessBase / CommonBusiness 模块**（如 AccountManager）：shared/constant + data/model + domain/service（通常无 presentation）
- **SystemBase / CommUI**：shared/theme + presentation/components
- **SystemBase / CommFunc**：仅 shared 层（log/、utils/ 等功能域子目录）

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| design.md | ✅ | 对应功能的技术设计文档（Skill 2 输出），路径通常为 `doc/features/{module}/design.md` |
| contracts.yaml | ✅ | 接口契约 Spec（Skill 2 产出），路径为 `doc/features/{module}/contracts.yaml`，定义了接口签名、数据模型、文件清单等强契约 |
| acceptance.yaml | ✅ | 验收标准 Spec（Skill 1 产出），路径为 `doc/features/{module}/acceptance.yaml`，定义了验收标准和边界用例 |
| use-cases.yaml | ⚠️ | 业务流程 UseCase Spec（Skill 2 产出；**仅**多 UI 共享状态 / 多步云调用 / 含回滚分支的复杂 feature 才会有该文件），路径为 `doc/features/{module}/use-cases.yaml`，定义了每个 UseCase 的 coordinator / ui_bindings / data_boundaries / state_model / branches |
| doc/architecture.md | ✅ | 项目模块架构的唯一事实来源，了解五层架构全貌和已有模块状态 |
| PRD.md | ❌ | 可选，用于交叉验证功能完整性 |
| 当前工程代码 | ✅ | AI 自动读取，用于理解现有模块结构和避免冲突 |

**若缺少 design.md**：提示用户先运行 Skill 2 生成设计文档，或提供等效的功能描述和文件规划。

**若缺少 contracts.yaml 或 acceptance.yaml**：提示用户先确认 Skill 1/2 是否已提取 Spec 文件。若 Spec 不存在但 design.md 和 PRD.md 存在，可从中提取。

## 工作流程

### Step 1: 读取并解析 design.md + Spec 契约

1. 读取指定的 `design.md` 文件
2. 读取对应的功能级 Spec 文件（编码时的**强契约基准**）：
   - `doc/features/{module}/contracts.yaml` — 接口签名、数据模型、文件清单、组件 Props 的精确契约
   - `doc/features/{module}/acceptance.yaml` — 验收标准和边界用例，用于确保代码覆盖所有业务场景
3. 提取以下关键信息（**以 contracts.yaml 为权威来源**，design.md 为补充上下文）：
   - **涉及哪些 Module**（HAP/HAR）及其依赖关系 ← `contracts.yaml > modules` + `module_dependencies`
   - **每个 Module 内涉及哪些层和文件** ← `contracts.yaml > files`
   - **数据模型**（data/model/ 下的 interface / class）← `contracts.yaml > data_models`
   - **数据仓库**（data/repository/ 下的 CRUD 接口）← `contracts.yaml > interfaces`
   - **业务编排层**（v2.1：条件性产出 — 仅在触发 `use-cases.yaml` 复杂度阈值时；代码形态按 Step 3.5 三选一）← design.md + `use-cases.yaml`（若有）
   - **组件树**（presentation 层的页面和复杂组件构成）← `contracts.yaml > components`
   - **端云接口**（shared/client/ 下的请求定义）← design.md
   - **路由配置**（新增 NavDestination 页面需要注册的路径）← `contracts.yaml > navigation`
   - **验收标准和边界用例** ← `acceptance.yaml > criteria` + `boundaries`
   - **资源 Key 契约** ← `contracts.yaml > resource_keys`

4. 输出**模块 × 层**的实现清单供用户确认：

```
📋 待实现清单（按模块和层级排列）：

🔷 Module: common (HAR) — 公共基础模块
  [shared/constant]  CommonTypes.ets — 全局通用类型
  [shared/utils]     FormatUtils.ets — 格式化工具

🔷 Module: wallet_home (HAR) — 首页功能模块
  [shared/client]    HomeApiClient.ets — 首页数据接口
  [shared/constant]  HomeConstants.ets — 首页常量
  [shared/components] BaseCardView.ets — 基础卡片组件
  [data/model]       CardInfo.ets — 卡片数据模型
  [data/model]       BannerInfo.ets — Banner 数据模型
  [data/repository]  CardRepository.ets — 卡片数据仓库
  [data/repository]  BannerRepository.ets — Banner 数据仓库
  [domain/actions 或 Page 内命名方法，按复杂度自选] loadHomeData — 首页数据加载逻辑（本例复杂度低，推荐 Page 命名方法而非独立类）
  [presentation/components] CardSwiper.ets — 卡片轮播复杂组件
  [presentation/components] FunctionGrid.ets — 功能宫格复杂组件
  [presentation/pages] HomePage.ets — 首页(NavDestination)

🔷 Module: phone (HAP) — 主入口
  [presentation/pages] Index.ets — 主 Navigation 框架
  [配置] 更新 main_pages.json、route_map、string.json 等
```

### Step 2: 确定实现顺序

遵循**双重自底向上**原则：

**第一维度——模块间顺序**（五层架构自底向上）：
```
05-SystemBase (CommFunc → CommUI)
  → 04-BusinessBase (AccountManager)
    → 03-CommonBusiness (CardManager 等)
      → 02-Feature (底层BankCard等 → 中间层SwipeCard → 顶层WalletMain)
        → 01-Product (Phone)
```
被依赖的模块先实现，确保下层模块代码就绪后，上层模块可正常引用。

**第二维度——模块内顺序**：
- Feature 层模块（4 层）：`shared → data → domain → presentation`
- CommonBusiness / BusinessBase 模块：`constant → model → service`
- SystemBase 模块：按功能域顺序实现

**综合顺序示例**（以首页功能为例）：
```
1. CommFunc（log/utils 等基础能力）
2. CommUI（Toast/基础页面组件等公共UI）
3. AccountManager（账号登录/状态管理）
4. WalletMain/shared → WalletMain/data → WalletMain/presentation
5. Phone（Ability 入口更新）
6. 资源文件和模块配置
```

### Step 3: 逐模块逐层生成代码（强制逐文件 Lint 门禁）

对每个实现项执行以下**严格的单文件闭环**，**禁止批量生成多个文件后再统一验证**：

1. **开文件前的自检（针对弱模型尤为重要）**
   - 重读 [reference/arkts-pitfalls.md](reference/arkts-pitfalls.md) 中与当前文件类型（@Component / Repository / UseCase / Model / Index.ets）相关的 2-3 条。
   - 声明当前上下文：哪个 Module、哪个层、依赖了哪些已完成的代码。
   - **Scope 守门**：确认当前要写的文件路径是否在 `doc/features/{feature}/design.md` 的 `in_scope_modules` 对应模块内；若不是，停下来，不得继续。

2. **生成代码**：严格按照 `contracts.yaml` 的强契约（文件路径 / 接口签名 / 数据模型 / 组件 Props / 资源 Key 一致），并覆盖 `acceptance.yaml > boundaries` 定义的异常处理。

3. **写入文件**：仅写入**当前这一个**文件。

4. **单文件 Lint 门禁（BLOCKER，禁止跳过）**：
   - 立即对刚写入的文件执行 `ReadLints`。
   - 有任何 error → 原地修复，再次 `ReadLints`，直到零 error。
   - 有 warning → 评估是否可修（不可忽略）。
   - **只要当前文件 Lint 未过，不得开始写任何其他文件**。这条规则对弱模型尤其重要：弱模型在长上下文中容易累积错误，批量生成后再统一 lint 会把"一个小错误"放大为"多个文件间的连锁错误"。

5. **单文件自校对（对照 arkts-pitfalls.md）**：
   - 快速扫一遍本文件，确认没有命中 `arkts-pitfalls.md` 里 15 条中任一"❌ 错"模式。
   - 命中则立即修复，重新走第 4 步。

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
| **A. Page 命名方法** | 单页面内的线性业务流（1~3 步调用），无跨 UI 状态共享 | `presentation/pages/XxxPage.ets` 内的命名 `async` 方法 | `HomeTabPage.loadHomeData()` |
| **B. 普通 ArkTS 协调类（Flow / Coordinator）** | 多 UI 共享状态、多步云调用、可能有回滚 | 放在模块业务语义最贴合的目录（优先 `domain/` 或 `shared/` 均可），是一个**非 `@Component` 的普通 class** | `domain/flow/CardOpenFlow.ets` 中的 `class CardOpenFlow` |
| **C. 导出命名函数** | 工具化 / 无状态的业务编排 | `domain/` 或 `shared/` 下的 `.ets` 文件，`export async function xxx(...)` | `domain/home/loadHomeData.ts` 中的 `export async function loadHomeData()` |

**关键约束（适用于 A / B / C 三种形态）**：

1. `use-cases.yaml > ui_bindings[].user_actions[].calls` 引用的必须是**真实存在的命名符号**，与代码中**完全一致**（Skill 5 Harness 的 `named_business_handler` BLOCKER 会严格校验）。合法形态包括：
   - 传统 `function xxx() {}` / `async function xxx() {}`
   - 类/对象方法 `xxx() {}` / `async xxx() {}`
   - 顶层导出 `export function xxx` / `export const xxx = ...`
   - **ArkTS 类字段函数**（v2.2 放宽）：`handleClick = async () => {}`、`handleClick: () => void = () => {}`、`handleClick = function() {}`
   - 顶层 `const/let/var xxx = () => {}`
2. **禁止匿名 inline lambda 承载业务**：UI 的 `.onClick(() => { 做一堆业务 })` 这种**匿名**写法**禁止**用于 `use-cases.yaml` 列出的入口；必须先有命名符号（传统函数 / 命名类字段函数 / 命名 const）再被 `onClick` 转发
3. 每次 `calls` 引用的实体必须是 UT 可直接调用的（无需构造 `@Component`、无需 UI runtime）——形态 A 需要把业务代码从 struct 中抽成 `class`/`function`，或选形态 B/C
4. **禁止新造 Port 接口**：`data_boundaries` 的 `type` 必须是 `contracts.yaml` 已登记的**既有** data 层类（Repository / Client 等）。UT 通过 Spy/Fake/Stub 子类化或原型替换实现打桩，不要求额外抽象接口

#### 3.5.2 业务编排代码的禁用 import（BLOCKER）

形态 B / C 的源文件以及形态 A 中的命名方法体**内**，**禁止** import 下列任一符号（即使只是类型引用）：

```
@Component, @Entry, @Preview, @Builder, @State, @Prop, @Link（除非形态 A，且这些仅用于 struct 本身的 UI 状态声明，不允许流入业务方法内的数据模型）
NavPathStack, NavDestination, NavPathInfo from @kit.ArkUI
$r, $rawfile, getUIContext, getContext, UIContext, PromptAction
AppStorage, LocalStorage
showToast, Toast 等 Toast 辅助函数
```

> 形态 A 特殊说明：Page 命名方法**可以**读取 `this.xxx`（struct 状态）并赋值，但**必须**保证：方法主体内调用的下层函数、传给 data 层的参数，都是普通数据模型类型；UI 副作用（Toast / 路由 / 弹框）用 `@Watch` 或在方法返回后由 UI 层翻译。

#### 3.5.3 UI 层的最小改造（按 `ui_bindings` 落地）

对每个 `ui_bindings[]` 条目：

- `role: entry | progress | dialog | result | passive`：按角色实现
- `subscribes: [state.phase, state.xxx]`：UI 层用 `@Watch` 或状态订阅翻译为渲染/跳转/Toast
- `user_actions[].calls = <symbol>`：UI 的 `onClick` 只做"参数准备 + 转发调用"，**不写业务分支**

> 形态 B / C 时：页面通过构造时注入（或通过 DI 容器 / 单例持有），例如 `@State private flow: CardOpenFlow = new CardOpenFlow(cardApi, cardStore)`；UT 中同样的 `CardOpenFlow` 可以用 `new CardOpenFlow(new SpyCardApi(), new SpyCardStore())` 直接实例化。

#### 3.5.4 自检（每完成一个业务编排文件后立即执行）

```bash
# Windows PowerShell —— 禁用 UI 符号扫描（仅形态 B / C 的纯业务文件严格执行）
Select-String -Path "<path>/CardOpenFlow.ets" -Pattern "NavPathStack|showToast|@Component|@Consume|\$r\(|getUIContext|AppStorage|LocalStorage"
```

命中任一关键字 → 立即停下来改正。

**命名入口一致性自检**：
1. 打开 `doc/features/{feature}/use-cases.yaml`
2. 对每个 `ui_bindings[].user_actions[].calls`，在代码中 `grep` 该符号
3. 确认：(a) 确实存在；(b) 是**命名符号**——传统函数/类方法/类字段函数（`handleClick = async () => {}`）/命名 `const` 赋值 的箭头函数 **都算合法**；仅**匿名直接挂载**在 UI 事件上（如 `.onClick(() => { 一堆业务 })`）的写法不合法

Skill 5 Harness 会用 `named_business_handler` BLOCKER 严格校验该项，本 Skill 内自检能节省回环成本。

### Step 4: 模块配置与资源文件

功能代码全部完成后，统一处理配置：

**模块级配置（每个新 HAR 模块）**：
1. `{层目录}/{ModuleName}/oh-package.json5` — 模块包描述和依赖声明（依赖路径使用相对于模块的层目录路径）
2. `{层目录}/{ModuleName}/build-profile.json5` — 模块构建配置
3. `{层目录}/{ModuleName}/src/main/module.json5` — 模块元数据
4. 根目录 `build-profile.json5` — 注册新模块，`srcPath` 使用层目录路径（如 `"./05-SystemBase/CommFunc"`）
5. 根目录 `oh-package.json5` — 添加模块间依赖，路径使用层目录路径（如 `"file:./05-SystemBase/CommFunc"`）

**资源文件（每个 Module 内）**：
1. **`main_pages.json`**：注册所有新增页面路径
2. **`string.json`**：添加所有界面文本资源，中文同步到 `zh_CN/`
3. **`color.json`**：添加颜色资源，深色模式同步到 `dark/`
4. **`float.json`**：添加尺寸/间距资源
5. **媒体资源**：图标等放入 `resources/base/media/`

**路由配置**：
- phone 模块中的 Navigation 需要注册各功能模块的 NavDestination 页面
- 如使用系统路由表，需在对应模块的 `resources/base/profile/` 下配置 `route_map.json`

### Step 5: 质量门禁自检

所有模块完成后，执行最终自检：

```
[ ] 1. 模块完整性：design.md 中涉及的所有 Module 是否已创建并正确配置？
[ ] 2. 分层合规性：每个文件是否位于正确的层级目录？是否存在反向依赖？
[ ] 3. 文件完整性：design.md 中规划的所有文件是否已全部创建？
[ ] 4. 接口一致性：组件/函数签名是否与 design.md 定义一致？
[ ] 5. 编译检查：执行 ReadLints，确认零 error？
[ ] 6. 资源引用：所有 $r('app.xxx.yyy') 引用的资源是否已定义？
[ ] 7. 页面注册：所有新增 NavDestination 页面是否已注册到路由配置？
[ ] 8. 无硬编码字符串：界面文本是否全部通过 $r() 引用？
[ ] 9. DAG 合规性：模块间依赖方向是否正确？无循环依赖？
[ ] 10. 导入完整：所有 import 语句是否完整，路径是否正确？
[ ] 11. 命名入口完整性（若 use-cases.yaml 存在）：`ui_bindings[].user_actions[].calls` 所列每个符号是否都能在代码中找到对应命名方法 / 函数 / 导出符号（非 inline lambda）？业务编排源文件（形态 B / C）是否**零**UI/Nav/Toast/AppStorage import？
[ ] 12. UI 层副作用翻译（若 use-cases.yaml 存在）：UI 的 `onClick` 是否只做"参数准备 + 转发调用命名函数"？Toast/导航是否通过订阅业务 state（`@Watch` 或等价）翻译，而非 `onClick` 内部硬编码分支？
```

**不通过项**：定位具体问题，自动修复后重新检查，直到全部通过。

### Step 6: 输出交付摘要

```markdown
## 编码交付摘要

### 模块变更
| Module | 格式 | 变更类型 | 说明 |
|--------|------|----------|------|
| common | HAR | 新增/修改 | 说明 |
| wallet_home | HAR | 新增 | 说明 |
| phone | HAP | 修改 | 说明 |

### 新增文件（按模块×层级）
| Module | 层级 | 文件路径 | 说明 |
|--------|------|----------|------|
| wallet_home | shared/client | HomeApiClient.ets | 首页接口 |
| wallet_home | data/model | CardInfo.ets | 卡片数据模型 |
| ... | ... | ... | ... |

### 质量门禁结果
- [x] 模块完整性：通过
- [x] 分层合规性：通过（零反向依赖）
- [x] 文件完整性：通过
- [x] DAG 合规性：通过
- [x] 编译检查：通过（0 error）

### 下一步
建议运行 Harness 验证（Step 7），验证通过后再运行 Skill 4 (Code Review)。
```

### Step 6.5: 真实编译闭环（必要出口）

> v2.2 新增：**编译是 Skill 3 的必要出口条件**，不是可选项。本步骤要求 agent **自己**执行 hvigor 编译、读取日志、定位问题、修复并重跑，直到零 error。`coding_hvigor_build` BLOCKER 会在 Step 7 强制兜底；本 Step 是 Skill 3 自检的最后一道。

#### 6.5.1 执行真实编译

**首选方式（v2.3 起推荐）**：通过 harness 触发，避免 agent 自己拼复杂 hvigor 命令时出错（quoting、`-p module=...@<target>` 形态、`DEVECO_SDK_HOME` / `JAVA_HOME` 注入、Windows 含空格安装路径转义等都已在 `hvigor-runner.ts` 内部处理好）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature <feature-name>
```

`coding_hvigor_build` BLOCKER 内部会按 `contracts.yaml > modules` 调用项目级 `hvigor assembleApp` 一次性出全 HAP；日志落 `framework/harness/reports/<feature>/coding/hvigor-build.log`。

> **不要**让 agent 自己手敲 `hvigorw --mode module ...`。v2.3 起命令形态、所需环境变量、含空格路径等综合考虑较多，自行拼装容易翻车；harness 已经封装了这一切。

#### 6.5.2 自闭环修复策略

1. **看 verdict**：harness 报告里 `coding_hvigor_build` 状态为 PASS 才算编译过；FAIL 进入修复闭环。
2. **读完整日志**：harness 把日志写到 `framework/harness/reports/<feature>/coding/hvigor-build.log`（agent 必须 Read 完整内容，不允许只看前 100 行就猜）。
3. **按错误类型分类**：
   - `ArkTS:ERROR` / `error TSxxxx` → 类型 / 语法错误，回到 Step 3 修文件；
   - `oh-package.json5` / 模块依赖错误 → 回到 `oh_package_dependencies` 章节补依赖；
   - 资源引用 (`$r('app.string.xxx')`) 缺失 → 回到资源声明章节补声明。
4. **修完 → 再跑**：重复 6.5.1，直到 `coding_hvigor_build` PASS。
5. **绝不允许**：
   - 把编译失败定性为"环境问题"绕过；
   - 用 `HARNESS_SKIP_HVIGOR=1` 跳过（harness 会把它转成 BLOCKER FAIL）；
   - "改了就不验"——必须真的过一次 harness 编译规则才算闭环。

#### 6.5.3 工具链不可用怎么办（"未找到 hvigor" 类失败）

v2.3 起 hvigor 工具链路径**应通过 `framework.config.json > toolchain.devEcoStudio.installPath` 显式声明**，而不是依赖项目根 `hvigorw.bat`（现代 DevEco Studio ≥ 5.0 不再生成它）。若 harness 报告 `coding_hvigor_build` FAIL 且 details 含「未找到 hvigor / hvigorw」：

1. 检查 `framework.config.json` 是否存在 `toolchain.devEcoStudio.installPath`，且路径在文件系统中存在；
2. 未配置 / 路径错误 → 跑 `npx ts-node framework/harness/scripts/detect-deveco.ts` 让工具自动探测推荐 installPath，或参考 [framework/skills/00-framework-init/SKILL.md](../00-framework-init/SKILL.md) Step 5.6 走完整配置流程；
3. 配置后再次跑 6.5.1。

**绝不允许**：因为找不到工具就把规则状态写成 SKIP 或 PASS 上交，也不允许把 `HARNESS_SKIP_HVIGOR` 设为 1 绕过。

### Step 7: Harness 验证门禁（agent 必须自跑，不得仅"告知用户"）

> **v2.4 强约束（呼应 CLAUDE.md 第 4.1 节）**：本步骤是编码阶段的**必要出口**。
> agent **必须自己**通过 Shell 工具执行下述 harness 命令、读取报告、判定 verdict；
> **严禁**只在回复里写"建议用户运行"、"可使用以下命令"然后直接结束对话——
> 这种行为已经被 CLAUDE.md 第 6 节第 5 条「反假设条款」明确列为软幻觉，由物理拦截层兜底。

编码阶段的 Harness 是**价值最高**的验证环节——它能自动检测文件缺失、接口偏离、分层违规、资源引用错误等编码常见问题。

#### 7.1 脚本 Harness（确定性检查，agent 自跑）

agent 必须自己执行（不是"提醒用户"，是 agent 通过 Shell 工具直接运行）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase coding --feature {module-name}
```

执行后 agent **必须**：

1. Read 退出码（0 = PASS，非 0 = FAIL）；
2. Read `framework/harness/reports/<feature>/coding/` 下的报告文件，逐条核对 BLOCKER；
3. **若有 BLOCKER**：自己回到 Step 3 修复，重跑，直到零 BLOCKER；
4. **不得**让用户"自行运行验证"；用户运行只是**额外**的复核渠道，不是 agent 的退出条件。

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
| 资源引用完整性 | $r() 引用的 key 是否在资源 JSON 中定义 | BLOCKER |
| 硬编码字符串 | presentation 层是否存在未通过 $r() 引用的 UI 文本 | MAJOR |
| HAR 导出 | 每个 HAR 模块是否有 Index.ets 并正确导出 | BLOCKER |
| 模块注册 | 新模块是否在 build-profile.json5 中注册 | BLOCKER |
| 页面注册 | NavDestination 页面是否在 main_pages.json 中注册 | BLOCKER |
| 命名规范 | 模块名/组件名/文件名/资源 key 是否符合命名约定 | MAJOR |
| 禁止 any | 代码中是否存在 any 类型 | MAJOR |

**若报告中存在 BLOCKER**：必须修正代码（回到 Step 3），直到零 BLOCKER。

#### 7.2 AI Harness（语义级检查，agent 主动通过 Task 工具触发 verifier 子 agent）

agent 必须主动通过 Task 工具调用 verifier 子 agent（不是"告诉用户去跑"）：

- **Prompt 模板**：`framework/harness/prompts/verify-coding.md`
- **触发方式**：通过 Task 工具调用 `subagent_type: verifier`，prompt 中传入 feature / phase / 脚本报告路径，子 agent 会自行读取 `verify-coding.md` 并产出报告
- **语义检查覆盖项**：
  1. 业务逻辑正确性 — 代码是否正确实现了 design.md 描述的业务流程
  2. 异常处理完整性 — acceptance.yaml boundaries 中的每个异常场景是否有对应处理
  3. 接口签名一致性（BLOCKER）— 实际代码签名是否与 contracts.yaml 一致
  4. 组件 Props 一致性 — @State/@Prop/Events 是否与 contracts.yaml components 一致
  5. 数据所有权合规 — presentation 层是否绕过 Repository 直接操作数据
  6. 模拟数据隔离 — 模拟数据是否封装在 Repository 内部
  7. PRD 验收标准覆盖 — acceptance.yaml criteria 中的 P0/P1 AC 是否都有代码实现

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 7.3 阶段闭环判定（CLAUDE.md 5.1 节 SSOT）

> 下文「物理拦截层」是 adapter 中立术语：`claude` adapter 即 `.claude/hooks/check-phase-completion.mjs` 注册的 Stop hook（由 `00-framework-init` 从 [framework/agents/claude/templates/](../../agents/claude/templates/hooks/check-phase-completion.mjs) 下发）；`generic` / `cursor` adapter 暂无等价物，仍以 Layer 1（CLAUDE.md/AGENTS.md §6.5 反假设条款）+ Layer 2（完成回执 + check-receipt.ts）兜底——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

**编码阶段宣布"完成"前，必须同时满足以下四条**（物理拦截层会按此判据拦截"假完成"）：

1. **trace.json 真实存在**：`framework/harness/reports/<feature>/coding/trace.json` 已写入。
2. **脚本 harness PASS**：`harness-runner.ts --phase coding --feature <feature>` 退出码 0，零 BLOCKER。
3. **verifier 子 agent PASS**：通过 Task 工具触发 `subagent_type: verifier`，子 agent 报告 verdict = PASS。
4. **完成回执通过校验**：填写 `doc/features/<feature>/coding/phase-completion-receipt.md`（模板见 [framework/harness/templates/phase-completion-receipt.md](../../harness/templates/phase-completion-receipt.md)），并通过 `npx ts-node framework/harness/scripts/check-receipt.ts --feature <feature> --phase coding` 校验。

四条缺一不可。**仅靠口头"完成"不算闭环**——物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier 子 agent） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，编码阶段完成，可进入 Skill 4（Code Review）。

## 编码规范

生成代码时必须遵守以下规范（完整规范见 [templates/coding-standards.md](templates/coding-standards.md)）：

### 核心规则速记

1. **分层规则**：每个 Module 内严格遵循 shared → data → domain → presentation 4 层架构，禁止反向依赖
2. **模块格式**：phone 为 HAP，其余为 HAR；HAR 模块需要正确导出 Index.ets
3. **组件命名**：PascalCase，组件文件名与 struct 名一致
4. **页面实现**：功能模块的页面基于 NavDestination 实现，仅 phone 的主入口用 `@Entry`
5. **资源引用**：界面文本用 `$r('app.string.xxx')`，颜色用 `$r('app.color.xxx')`，尺寸用 `$r('app.float.xxx')`
6. **数据所有权**：业务数据的增删改查必须通过 Repository，不允许 presentation 层直接操作数据源
7. **复杂组件**：自带生命周期管理，完成「用户操作 → 逻辑执行 → 数据变更 → UI 刷新」闭环
8. **异步操作**：使用 `async/await`，不使用裸 Promise 回调链
9. **列表性能**：超过 20 项的列表必须用 `LazyForEach` + `IDataSource`

## 常用参考

- **⭐ ArkTS 易错手册（弱模型必读）**: [reference/arkts-pitfalls.md](reference/arkts-pitfalls.md)
- ArkUI 组件模式速查: [reference/arkui-patterns.md](reference/arkui-patterns.md)
- 鸿蒙 API 用法速查: [reference/harmony-api-guide.md](reference/harmony-api-guide.md)
- 模块脚手架规范: [templates/module-scaffold.md](templates/module-scaffold.md)
- 编码规范完整版: [templates/coding-standards.md](templates/coding-standards.md)

## 关联文件

- 上游输入:
  - `doc/features/{module}/design.md`（Skill 2 输出）
  - `doc/features/{module}/contracts.yaml`（Skill 2 产出的接口契约 Spec）
  - `doc/features/{module}/acceptance.yaml`（Skill 1 产出的验收标准 Spec）
- 阶段级规约: `framework/specs/phase-rules/coding-rules.yaml`
- 脚本 Harness: `framework/harness/scripts/check-coding.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-coding.md`
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **Skill 4 (Code Review)** | 源代码 + contracts.yaml | 审查代码与契约的一致性 |
| **Skill 5 (业务级 UT)** | 源代码 + acceptance.yaml | 基于验收标准生成 UT |
| **Harness (验证层)** | 源代码 + contracts.yaml + acceptance.yaml | 脚本/AI 验证编码质量 |

## 约束与注意事项

1. **contracts.yaml 是强契约**：文件路径、接口签名、数据模型、组件 Props 必须与 `contracts.yaml` 定义一致。若发现 Spec 有明显问题（类型错误、API 不存在、分层违规），先向用户指出并确认修正方案，修正后同步更新 contracts.yaml
2. **逐模块逐层交付**：按 Module 和层级分批生成代码并等待用户确认，控制每次输出在一个可审阅的粒度
3. **模拟数据优先**：本项目为模拟应用，涉及真实后端（支付网关、银行接口等）的部分在 shared/client 中定义接口，由 data/repository 用模拟数据实现
4. **中文注释**：代码中非显而易见的业务逻辑使用中文注释说明意图
5. **渐进式实现**：先实现 P0 核心功能确保可运行，再叠加 P1/P2 功能
6. **不破坏现有代码**：修改现有文件时，只做增量修改，不改动无关代码
7. **编译可达**：每完成一个层级后，代码应处于可编译状态
8. **HAR 导出**：HAR 模块需要通过 `Index.ets` 导出对外暴露的 API，未导出的内容为模块私有
9. **边界场景覆盖**：代码必须处理 `acceptance.yaml > boundaries` 中定义的所有异常场景（网络异常、空数据、功能暂不支持等）
10. **Harness 验证闭环**：编码完成后 agent **必须自己运行** Harness 验证（Step 7），并主动通过 Task 工具触发 `subagent_type: verifier`；确保零 BLOCKER + verifier PASS + 完成回执通过校验后才进入下一阶段（物理拦截层兜底）

---

## Claude Code CLI 运行时约定

当本 Skill 通过 `/coding` slash command 在 Claude Code CLI（或等价运行时）下运行时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`framework/harness/reports/<feature>/<timestamp>/<model>-code/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `coding`。
- **必须记录的事件**（针对弱模型迭代最关键）：
  - `tool_calls`：`ReadLints` 的 `count` 和 `failed_count`（每文件一次的调用频率是弱模型健康度的核心指标）
  - `retries`：`lint_error` / `arkts_pitfall` 每次自修尝试次数，`related_file` 必填
  - `human_pain_points`：逐条记录 ArkTS 错误类型（对照 `arkts-pitfalls.md` 的 15 条）
  - `harness_checks`：`check-coding.ts` 的结果，特别是 `diff_within_scope` 是否通过
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。

---

## 运行时交付约定（Claude Code CLI / 内网弱模型）

```
framework/harness/reports/<feature>/<timestamp>/<model>-coding/
├── trace.json                 # phase = "coding"
├── gap-notes.md
├── check-coding.report.md     # 包含 diff_within_scope 结果
└── verifier.report.md         # verifier 跑 verify-coding.md（可选）
```

**本 Skill 最容易发生的痛点（记入 `human_pain_points`）**：
- `arkts_correctness`：ArkTS 语法/API 错误，需命中 `arkts-pitfalls.md` 的哪一条；
- `contracts_mismatch`：实现与 `contracts.yaml` 签名/路径/资源 key 不一致；
- `scope_creep`：`git diff` 出现 design `in_scope_modules` 外的文件。

每次在 retry 一个文件时（lint 重跑、scope 越界回退），记入 `retries` 字段。
