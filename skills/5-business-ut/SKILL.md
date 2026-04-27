# 业务级 UT Skill (`5-business-ut` · v2.1)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

## 概述

你是一位资深鸿蒙（HarmonyOS）测试工程师，擅长使用 @ohos/hypium 框架编写 **业务级端到端单元测试**。
你的任务是作为**既有代码的消费者**：读懂业务编排源码（由 Skill 3 选择代码形态落地 —— 可能是 Page 命名方法、普通 `Flow`/`Coordinator` 类、或导出函数），结合 **`use-cases.yaml` 规约（若存在）** 或 **`acceptance.yaml` + `dag.yaml` 的退化路径**，**直接调用已存在的命名函数**，在 `data_boundaries`（既有 data 层类）处打桩，生成端到端覆盖的 UT。

本 Skill 是项目全生命周期流水线的**第五环**。上游输入来自 Skill 2（`use-cases.yaml`，**条件式**）、Skill 3（业务编排源代码 + UI）与 Skill 4（Code Review），输出（UT + DAG + `device-testing-todo.md`）将流入 Skill 6（真机测试）。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "生成 UT"、"生成单元测试"、"写 UT"、"业务级 UT"
- "端到端测试"、"UseCase 测试"、"分支覆盖 UT"
- "生成 SpyPort / 生成打桩类"

## 核心理念（v2.1）

**UT 是既有代码的消费者，不驱动架构**：

- 🟢 **复杂 feature（有 `use-cases.yaml`）**：按 `ui_bindings[].user_actions[].calls` 声明的**命名函数**直接调用；在 `data_boundaries` 处打桩；断言 state 序列 + 调用序列 + 持久化数据。
- 🟢 **简单 feature（无 `use-cases.yaml`）**：按 `acceptance.yaml` + `dag.yaml`，直接针对 data 层函数 / Repository / 导出工具函数写 UT，覆盖数据契约与边界异常即可，不要硬凑 UseCase 架构。
- 🔴 **UI 层绝对禁入 UT**：不 import `@Component` / `struct` / `NavPathStack` / `showToast` / `$r` / `$rawfile` / `AppStorage` / `LocalStorage` / `@kit.ArkUI` / `@kit.ArkGraphics`。由 harness `ut_import_whitelist` BLOCKER 拦截。
- 🔴 **不要为了 UT 反过来改架构**：不要求新建 `domain/usecase/*.ets` 类、不要求新造 `XxxPort` 接口；若代码可测性差（如业务嵌在 inline lambda 中），反馈 Skill 3 抽出命名方法，不要在 UT 里 new `@Component struct`。

### v2 → v2.1 的关键澄清

| 维度 | v2 老表述 | v2.1 新表述 |
|------|-----------|-------------|
| 被测单元 | **UseCase 类**（必须在 domain/usecase/） | **命名业务入口**（Page 方法 / 普通 Flow 类 / 导出函数，由 Skill 3 自选） |
| 外部依赖抽象 | `ports[]`（必须新造 Port 接口） | `data_boundaries[]`（引用 contracts.yaml 中既有 data 层类） |
| UseCase 代码 | 强制产物 | **不存在**；`use-cases.yaml` 只是文档规约 |
| use-cases.yaml | 有 `unit/both` AC 就必须产出 | 仅复杂 feature（多 UI 共享状态 / 多步云调用 / 含回滚分支）产出 |
| Stub 形式 | `SpyXxxPort`（实现 Port 接口） | `SpyXxx / FakeXxx / StubXxx`（**子类化既有类**）或 **原型方法替换** |
| DAG use_case | 指向 UseCase class 名 | 指向 `use-cases.yaml > use_cases[].id`（无 use-cases.yaml 则可省） |

### 与其他阶段的边界

| 维度 | v1 老做法 | v2.1 做法 |
|------|-----------|-----------|
| 用例粒度 | 一个 `it()` 验一条数据接口 | **一个 `it()` 端到端驱动一个 branch**（或无 use-cases.yaml 时覆盖一条 AC/BD） |
| 断言粒度 | 仅数据 | state 序列 + data_boundary 调用序列 + 数据 |
| UI 交互 | 部分在 UT 里走 | ✗ 交 Skill 6（`device-testing-todo.md`） |
| AC 过滤 | 全部算 UT 覆盖 | `ut_layer in [unit, both]` 进 UT；`device` 交 Skill 6 |

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| **`doc/features/{feature}/use-cases.yaml`** | ⚠️（仅复杂 feature） | Skill 2 产出（仅当满足复杂度阈值）；含 `coordinator / ui_bindings / data_boundaries / state_model / branches`，Skill 5 的**主规划来源** |
| 业务编排源代码 | ✅ | Skill 3 产出；代码形态由 Skill 3 自选（Page 命名方法 / `Flow` 类 / 导出函数）。UT 按 `ui_bindings.user_actions.calls` 或 acceptance.yaml 指向的函数直接调用 |
| data 层源代码 | ✅ | `data/repository/*.ets` / `shared/client/*.ets` 等；UT 通过子类化（SpyXxx）或原型替换在这些边界上打桩 |
| `doc/features/{feature}/contracts.yaml` | ✅ | 接口契约 Spec，`data_boundaries[].type` 必须来自这里的 `interfaces[].class` |
| `doc/features/{feature}/acceptance.yaml` | ✅ | 验收标准 Spec，含 `ut_layer`；简单 feature 时是主规划来源 |
| `doc/features/{feature}/design.md` | ✅ | 状态机 Mermaid、UseCase 清单章节（若有） |
| `doc/features/{feature}/PRD.md` | ✅ | 业务流程图和异常场景 |
| `doc/architecture.md` | ✅ | 模块架构全貌 |
| `review-report.md` | ❌ | 可选，用于确认代码已通过 Review |

**若缺少 `use-cases.yaml`**：不阻塞本 Skill。按 acceptance.yaml + dag.yaml 直接针对 data 层 / 导出函数写 UT；harness 会以 WARN 提示而非 BLOCKER。**严禁**为此回过头去要求 Skill 2 补 use-cases.yaml 以套入架构（除非确实符合复杂度阈值）。

**若缺少 `acceptance.yaml`**：提示用户先运行 Skill 1。

## 规约参考

| 规约 | 路径 |
|------|------|
| UseCase 规范 Schema | [templates/use-cases-schema.md](templates/use-cases-schema.md) |
| DAG Schema（v2） | [templates/dag-schema.md](templates/dag-schema.md) |
| UT 模板 + Spy 模板（子类化既有类 / 原型替换） | [templates/ut-template.md](templates/ut-template.md) |
| 打桩策略 | [templates/mock-strategy.md](templates/mock-strategy.md) |
| 规范级样例（开卡流程） | [examples/card-opening/](examples/card-opening/) |

## 工作流程（v2.1）

### Step 1：规划 DAG 与 UT（按是否有 `use-cases.yaml` 分两条路径）

先读取全部上游输入：

- `doc/features/{feature}/use-cases.yaml`（**若存在**）
- `doc/features/{feature}/acceptance.yaml`（只关注 `ut_layer in [unit, both]` 的 AC/BD）
- `doc/features/{feature}/PRD.md` / `design.md`
- `doc/features/{feature}/contracts.yaml`（data_boundary type 必须在 `interfaces[].class` 中）
- 业务编排源代码（Skill 3 自选了 Page 方法 / `Flow` 类 / 导出函数）

#### 路径 A：存在 `use-cases.yaml` —— 按 branches × ui_bindings 规划

为每个 use_case 列一张 **Branch × DAG × UT × AC 清单**：

```markdown
📋 UT 规划清单（use_case: card_opening，coordinator: CardOpenFlow）

ui_bindings 入口（来自 use-cases.yaml）:
- CardSelectPage.role=entry, user_actions[].calls = "flow.chooseCard"
- SmsDialog.role=dialog, user_actions[].calls = "flow.confirmSms"

| # | branch id           | DAG 文件                         | it() 用例                         | linked_acceptance |
|---|---------------------|----------------------------------|-----------------------------------|-------------------|
| 1 | happy_path          | card_opening_happy.dag.yaml      | [BRANCH-happy_path][AC-1] 成功      | AC-1              |
| 2 | validate_fail       | card_opening_validate_fail.yaml  | [BRANCH-validate_fail][AC-2] 校验失败 | AC-2              |
| 3 | sms_fail_rollback   | card_opening_sms_fail.dag.yaml   | [BRANCH-sms_fail_rollback][AC-3] 短验失败回滚 | AC-3 |
| 4 | persist_fail        | card_opening_persist_fail.yaml   | [BRANCH-persist_fail][AC-4] 持久化失败 | AC-4 |

unit/both AC 覆盖率: 100% (AC-1..4)
device AC: AC-5 / AC-6（交 Skill 6，写入 device-testing-todo.md）
```

#### 路径 B：无 `use-cases.yaml` —— 按 acceptance.yaml 直接规划

按 `ut_layer ∈ {unit, both}` 的 AC/BD 逐条列清单，指向具体的 **被测 data 层函数** 或 **导出业务函数**：

```markdown
📋 UT 规划清单（feature: home-page，无 use-cases.yaml）

| # | AC/BD id | 被测单元                         | DAG 文件             | it() 用例                     |
|---|----------|----------------------------------|----------------------|-------------------------------|
| 1 | AC-1     | HomeRepository.getServiceEntries | home_page_ut.dag.yaml | [AC-1] 首页服务入口数据契约完整 |
| 2 | AC-2     | HomeRepository.getPromoList      | home_page_ut.dag.yaml | [AC-2] 首页推广位数据契约完整   |
| 3 | BD-1     | HomeRepository.getPromoList(空)  | home_page_ut.dag.yaml | [AC-1][BD-1] 推广列表为空仍可回落 |
```

**等待用户确认清单后进入 Step 2**。

### Step 2：生成 DAG 文件

对每个 branch 生成一份 DAG（或合并成同一个 use_case 的多分支 DAG，只要 branches[] 交集为空、并集覆盖即可）：

1. **必填顶层字段**（由 harness `dag_schema_compliance` BLOCKER 强制）：
   - `flow_id` / `flow_name` / `module` / `version`
   - `entry_point` / `nodes`
   - **若 `use-cases.yaml` 存在**：另需 `use_case`（= `use-cases.yaml > use_cases[].id`）+ `branches[]`（= 该 DAG 覆盖的分支 id 列表）
   - `linked_acceptance`
2. **节点构建**：
   - `user_trigger`：对应业务入口命名函数调用（ui_bindings.user_actions.calls）
   - `port_call_cloud` / `port_call_local`：对应调用的 data_boundary（节点字段 `boundary` = `data_boundaries[].name`；旧字段 `port` 兼容）
   - `state_transition`：对应 `state_model.phases` 迁移
   - `assertion`：必须声明 `linked_branch` 或 `linked_acceptance`（两者之一）
   - `ui_subscription`（v2.1 新）：**仅用于文档化 UI 对 state 的订阅**，UT 忽略，供 device-testing-todo 生成
3. **UI 副作用不进 UT 断言**：`NavPathStack.push` / `showToast` 只能作为 `ui_subscription` 节点记录，或直接写入 `device-testing-todo.md`，不要画成 `port_call_*` 或 `assertion` 节点
4. **验证 DAG**：无环、source 存在、`boundary` 名回到 `use-cases.yaml > data_boundaries[].name`（若存在 use-cases.yaml）
5. **展示 Mermaid** 给用户确认（按节点类型着色）
6. **写入** `{module}/test/dag/{flow_id}.dag.yaml`

### Step 3：生成 UT 代码（按 branch 或 AC 生成 `it()`）

#### 3.1 UT 骨架（路径 A：有 use-cases.yaml）

按照 [templates/ut-template.md](templates/ut-template.md) 提供的骨架生成。**直接调用 `ui_bindings.user_actions.calls` 声明的命名函数**，**不 new `@Component struct`**：

```typescript
import { describe, it, expect, beforeEach } from '@ohos/hypium'
import { CardOpenFlow, Phase } from '../../../main/ets/domain/flow/CardOpenFlow'
import { SpyCardOpenApi } from './spy/SpyCardOpenApi'
import { SpyCardStore } from './spy/SpyCardStore'

export default function cardOpenFlowTest() {
  describe('CardOpenFlow', () => {
    let api: SpyCardOpenApi
    let store: SpyCardStore
    let flow: CardOpenFlow

    beforeEach((): void => {
      api = new SpyCardOpenApi()
      store = new SpyCardStore()
      flow = new CardOpenFlow(api, store)
    })

    it('[BRANCH-happy_path][AC-1] 开卡全链路成功', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' })
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' })
      api.whenVerifySmsCode.returns({ ok: true })

      // 对应 ui_bindings[CardSelectPage].user_actions.calls = "flow.chooseCard"
      await flow.chooseCard(bankInfo)
      expect(flow.state.phase).assertEqual(Phase.WaitingSms)

      // 对应 ui_bindings[SmsDialog].user_actions.calls = "flow.confirmSms"
      await flow.confirmSms('123456')
      expect(flow.state.phase).assertEqual(Phase.Success)
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource', 'verifySmsCode'])
      expect(store.callLog).assertDeepEquals(['save', 'update'])
    })

    // ... 每个 branch 对应一个 it()
  })
}
```

#### 3.1B UT 骨架（路径 B：无 use-cases.yaml）

简单 feature 直接针对 data 层或导出函数写 UT：

```typescript
import { describe, it, expect, beforeEach } from '@ohos/hypium'
import { HomeRepository } from '../../../main/ets/data/repository/HomeRepository'

export default function homePageUtTest() {
  describe('home-page', () => {
    let repo: HomeRepository
    beforeEach((): void => { repo = new HomeRepository() })

    it('[AC-1] 首页服务入口数据契约完整', 0, async () => {
      const entries = await repo.getServiceEntries()
      expect(entries).not.assertNull()
      expect(entries.length).assertLarger(0)
      expect(entries[0].id).not.assertUndefined()
    })
  })
}
```

#### 3.2 打桩代码（v2.1 · 不再强制 Port 接口）

v2.1 的打桩针对 **`use-cases.yaml > data_boundaries[].type` 所指的既有 data 层类**，有三种合法形式（任选其一）：

- **形式 1：子类化** — `class SpyCardOpenApi extends CardOpenApi { ... }`，override 实际方法；暴露 `callLog: string[]` 和每个方法一份 `whenXxx.{returns, fails, throws}` preset
- **形式 2：原型方法替换** — `CardOpenApi.prototype.validateOpen = jest.fn(...)`（`afterEach` 必须恢复）
- **形式 3：若 data 层已用 DI 注入的接口/抽象类** — 直接提供该接口的 Spy 实现

**统一约束**：
- **禁止**为打桩方便额外创建 `XxxPort` 接口
- **禁止**在 Spy 内部写业务判断（业务判断必须留在 coordinator / 命名业务函数里）
- 若采用形式 2，`afterEach` 必须恢复原型，避免跨用例污染

参考模板见 [templates/ut-template.md](templates/ut-template.md) 的打桩章节。

#### 3.3 每个 `it()` 的必备断言

v2.1 约束（`it_drives_flow` MAJOR 检查）：

**路径 A（有 use-cases.yaml）**：
1. **命名入口驱动**（调用 `ui_bindings.user_actions.calls` 声明的函数）
2. **调用序列断言**（`assertDeepEquals(spy.callLog, [...])` 至少 1 次）
3. **状态多阶段断言**（对 `phase` / `errorCode` 等字段 ≥2 次 expect，覆盖中间态与终态）

**路径 B（无 use-cases.yaml）**：
- 每个 `it()` 至少 2 次 `expect`，覆盖数据契约字段与边界情形

#### 3.4 用例命名（强约束）

`it()` 必须以 `[BRANCH-<id>]` 或 `[AC-<id>]` 开头（两者可组合，如 `[BRANCH-happy_path][AC-1]`）。

#### 3.5 import 白名单（BLOCKER · `ut_import_whitelist`）

UT 文件**只允许** import 以下来源：

- `@ohos/hypium`
- 被测业务编排符号（Flow 类 / 导出函数 / Page 类 **但只用其命名方法**，**不 new struct**）
- 被测/依赖的 `data/model/*`、`data/repository/*`、`shared/client/*` 等 data 层符号
- 同目录 `spy/` / `fake/` / `stub/` 目录的替身

**禁止**（由 harness BLOCKER 拦截）：
`@Component` / `@Entry` / `@Preview` / `struct` / `NavPathStack` / `NavDestination` / `showToast` / `$r(` / `$rawfile(` / `AppStorage` / `LocalStorage` / `@kit.ArkUI` / `@kit.ArkGraphics`。

#### 3.6 生成流程

1. 为每个 data_boundary（或路径 B 的直接依赖）在 `{module}/src/ohosTest/ets/test/spy/` 下生成替身（已存在则复用）
2. 为每个 use_case（路径 A）或每组 AC（路径 B）生成一份 `.test.ets`，每个 branch / AC 一个 `it()`
3. 展示给用户确认
4. 写入文件

### Step 4：测试注册与配置

1. 确保 `List.test.ets` 中注册了所有新增测试函数
2. 确认 `@ohos/hypium` 依赖在 ohosTest 的 `oh-package.json5` 中声明
3. 若模块尚无 ohosTest 目录，按下列标准结构创建：

```
{module}/src/ohosTest/
├── ets/
│   └── test/
│       ├── List.test.ets              # 测试入口注册
│       ├── card_opening.test.ets      # UseCase UT
│       └── spy/
│           ├── SpyCardOpenApi.ets
│           └── SpyCardPersistence.ets
└── module.json5
```

### Step 5：质量门禁自检（v2.1）

```
[ ] 1.  use-cases.yaml（若存在）通过 schema 校验：含 coordinator / ui_bindings / data_boundaries / state_model / branches
[ ] 2.  named_business_handler（若有 use-cases.yaml）：ui_bindings[].user_actions[].calls 每个符号在代码中都能找到**命名符号**——传统函数 / 类方法 / 类字段函数（`handler = () => {}`）/ 顶层命名 const 赋值 均合法
[ ] 3.  boundary_matches_contracts（若有 use-cases.yaml）：data_boundaries[].type 都能在 contracts.yaml > interfaces[].class 中找到
[ ] 4.  DAG 合规：顶层含 flow_id / flow_name / entry_point / nodes；若有 use-cases.yaml 则另含 use_case（= id）和 branches[]
[ ] 5.  DAG 分工：同 use_case 所有 DAG 的 branches[] 交集为空、并集覆盖所有非 device_only 分支
[ ] 6.  ut_import_whitelist（BLOCKER）：UT 文件未 import @Component / struct / NavPathStack / showToast / $r / $rawfile / AppStorage / LocalStorage / @kit.ArkUI / @kit.ArkGraphics 等
[ ] 7.  boundaries_all_stubbed：每个 data_boundary 都有 Spy/Fake/Stub 子类化或原型替换的证据
[ ] 8.  it() 命名：每条 it() 以 [AC-X] 或 [BRANCH-X] 起始
[ ] 9.  it() 驱动力：
         - 路径 A：每条 it() 调用命名入口 + ≥2 次 callLog 断言 + ≥2 次 state/phase 断言
         - 路径 B：每条 it() ≥2 次 expect，覆盖数据契约
[ ] 10. AC 覆盖（单元层）：ut_layer in [unit, both] 且 P0/P1 的 AC 100% 对应 it()
[ ] 11. 分支覆盖（若有 use-cases.yaml）：每个非 device_only 分支都有对应 it()
[ ] 12. device-testing-todo.md：每条 ut_layer in [device, both] 的 AC 都已登记；DAG 的 ui_subscription 节点均已翻译成真机条目
[ ] 13. 测试注册：所有 UT 文件在 List.test.ets 中注册
[ ] 14. 用例独立性：beforeEach 重建替身；若用原型替换方案，afterEach 还原
```

**不通过项**：定位具体问题，自动修复后重新检查，直到全部通过。

### Step 6：输出 `device-testing-todo.md`（v2 · 与 Skill 6 衔接）

为每个 feature 产出一份 `doc/features/{feature}/device-testing-todo.md`，把 `ut_layer in [device, both]` 的 AC/BD 逐条登记：

```markdown
# 真机测试待办 — {feature}

本文件由 Skill 5 自动产出，供 Skill 6 消费。每条对应 acceptance.yaml 中 ut_layer ∈ {device, both} 的 AC/BD，
UT 已通过 state/port 断言覆盖的业务侧逻辑，真机侧需补做 UI / 交互 / 渲染层面的验证。

## 真机覆盖项

### AC-5 开卡成功后页面跳转到结果页（ut_layer=device）

- **来源**：acceptance.yaml > AC-5
- **linked_flow / linked_branch**：card_opening / happy_path
- **UT 已保证**：`useCase.state.phase === Success`
- **真机需验证**：
  - [ ] 点击"下一步"按钮后，导航栈栈顶为 `CardOpenResultPage`
  - [ ] 路由参数包含 `{ cardId: 'c1' }`
  - [ ] 页面转场动画自然

### BD-2 短验失败弹出错误 Toast（ut_layer=device）

- ...
```

### Step 7：输出交付摘要

```markdown
## 业务级 UT 交付摘要（v2）

### UseCase 清单（来自 use-cases.yaml）
| UseCase | branches 数 | UT 文件 | DAG 数 |
|---------|-------------|---------|--------|
| CardOpeningUseCase | 4 | card_opening.test.ets | 4 |

### DAG 文件清单
| flow_id | use_case | branches | 关联 AC |
|---------|----------|----------|---------|
| card_opening_happy | CardOpeningUseCase | [happy_path] | AC-1 |
| ... |

### UT 文件清单
| 文件 | 测试函数 | 用例数（= branches 数） |
|------|---------|-------------------------|
| card_opening.test.ets | cardOpeningUseCaseTest | 4 |

### 覆盖率统计
| 指标 | 数值 |
|------|------|
| unit/both P0 AC 覆盖率 | X/N (100%) |
| unit/both P1 AC 覆盖率 | X/N (YY%) |
| BD 覆盖率（unit/both） | X/N (ZZ%) |
| 分支覆盖率（branches） | M/M (100%) |
| 交 Skill 6 的 device AC | K 条（见 device-testing-todo.md） |

### 下一步
- 运行 Harness 验证（Step 8）
- 进入 Skill 6（真机测试）消费 device-testing-todo.md
```

### Step 7.5：UT 编译闭环（必要出口）

> v2.2 新增：**UT 编译是 Skill 5 的必要出口条件**。光"写完"不算，必须 hvigor 实际编译过。harness 会通过 `ut_tsc_compiles`（静态 tsc）和 `ut_hvigor_build`（hvigor 实编）双层兜底；本步骤要求 agent 自己跑闭环。

#### 7.5.1 静态 tsc 自检（TypeScript Compiler API）

> 这一步 harness 在 `ut_tsc_compiles` 中自动跑；agent 不用手敲，但要看 harness 报告：若 FAIL，按 details 中的 `file:line:col TSxxxx message` 直接定位修。

#### 7.5.2 hvigor 真实编译

**首选方式（v2.3 起推荐）**：通过 harness 触发，让 `hvigor-runner.ts` 处理底层命令拼装、环境变量（`DEVECO_SDK_HOME` / `JAVA_HOME`）注入、Windows 含空格安装路径转义。`ut_hvigor_build` 内部跑的是 `hvigor genOnDeviceTestHap`（不再是 v2.2 的 `OhosTestCompileArkTS`，后者是 hvigor 内部 task，CLI 不能直接调用）：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature <feature-name>
```

> **不要**让 agent 自己手敲 `hvigorw --mode module ... @ohosTest`。v2.3 起目标 task / 模块定位 / env 注入比 v2.2 复杂，自行拼装大概率翻车；harness 把这些都封装好了，且日志会落到 `framework/harness/reports/<feature>/ut/hvigor-ut-build.log` 便于排错。

#### 7.5.3 自闭环修复策略

1. `ut_hvigor_build` FAIL → 进入修复；
2. 完整 Read `framework/harness/reports/<feature>/ut/hvigor-ut-build.log`；
3. 按错误类型分类：
   - UT 调用的被测函数签名不符 → 修 UT；
   - UT import 路径错误 → 修 UT；
   - 类型注解与被测实际类型不匹配 → 修 UT；
   - **若错误根因在业务源码** → 进入 Step 7.5.4 严格流程，**禁止**自行动手；
4. 修完再跑直到 exit code = 0。

#### 7.5.4 触及业务源码时的 HARD STOP

只要错误根因落在 `02-Feature/**/src/main/**`、`01-Business/**/src/main/**`、`00-Common/**/src/main/**`：

1. **立即停手**，向用户输出请求：
   - 拟变更文件路径；
   - 拟修改 / 抽取的函数签名；
   - 为何 UT/Spy/Stub 层不能规避；
   - 影响面（会触发 Skill 3 的哪些 BLOCKER 重跑）。
2. 用户**书面同意**前不得修改任何源码文件；
3. 同意后把授权登记到 `framework/harness/reports/<feature>/ut/gap-notes.md > approved_src_mutations[]`（含时间戳、文件、变更摘要、用户原话）；
4. 否则触发 harness `ut_no_src_mutation` BLOCKER FAIL。

### Step 7.6：UT 装机运行闭环（必要出口）

> v2.2 新增：UT 必须**实际跑通**，不是只会"看起来对"。`ut_hvigor_test` BLOCKER 会强制此步。

#### 7.6.1 探测设备

```bash
hdc list targets
```

输出非空才能进 7.6.2；输出 `[Empty]` 或为空：

- **不允许**继续往下跑后宣称 PASS；
- **不允许**用"本地无设备"为由把 harness 标绿；
- 必须先：在 DevEco Studio 启动模拟器 / 接入真机，重新探测；
- 只有探测到设备后才能继续。

#### 7.6.2 装机执行

**首选方式（v2.3 起推荐）**：通过 harness 触发——v2.2 的 `hvigorw test` 路径在 HAR / HSP 库模块上根本走不通（要求 `TestAbility.ets` 而库模块没有），v2.3 改为 `genOnDeviceTestHap` 出 ohosTest HAP → `hdc install -r` 装机 → `hdc shell aa test` 触发 hypium → 解析 `OHOS_REPORT_RESULT`。这条链路全部封装在 `ut_hvigor_test` BLOCKER 内部：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature <feature-name>
```

实测一次 `--phase ut` 同时触发 `ut_hvigor_build`（出包）+ `ut_hvigor_test`（装机执行），两段日志合并落到 `framework/harness/reports/<feature>/ut/hdc-test.log`；运行报告里 `ut_hvigor_test` 的 details 会包含失败阶段标签（`metadata` / `hap_not_found` / `install` / `run` / `no_pass`），方便定位。

> **不要**让 agent 自己手敲 `hvigorw ... test`。v2.3 起这条命令对 HAR 库模块直接报 `srcEntry file '...TestAbility.ets' does not exist`，不是工具坏掉而是路径根本不对——必须走 hdc + aa test。harness 已经处理。

#### 7.6.3 自闭环修复策略

1. 解析 `ut_hvigor_test` 报告中的 hypium 统计（harness 会从 `hdc shell aa test` 输出里扒 `Tests run: N, Failure: F, Error: E, Pass: P, Ignore: I`）；
2. failed > 0：
   - 读 `framework/harness/reports/<feature>/ut/hdc-test.log` 完整内容；
   - 找到 failure 用例的 `OHOS_REPORT_STATUS: stack=...` 堆栈；
   - 按堆栈定位：是 UT 逻辑错？Spy 预设值错？还是被测业务真有 bug？
   - **业务真有 bug 时**：仍走 7.5.4 的 HARD STOP 流程，先报告再改；
3. total = 0：报告会标 `失败阶段：no_pass` 或 `run`——通常是测试 ability 没启动 / `testRunner` 路径错 / module name 错；先核对 `<module>/src/ohosTest/module.json5` 与 `AppScope/app.json5` 的 `bundleName`；
4. 失败阶段是 `metadata` / `hap_not_found` / `install` → 回 7.5（先把 build 跑过）或检查 `framework.config.json > toolchain.devEcoStudio.installPath`；
5. 修完再跑直到 failed = 0 且 total > 0。

#### 7.6.4 绝不允许

- 把"无设备"标成 SKIP / PASS 上交；
- 用 `HARNESS_SKIP_HVIGOR_TEST=1` 跳过（harness 会转成 BLOCKER FAIL）；
- "我修过 UT 了，但没跑就交"——必须真的装机跑过且全部 PASS；
- 因为找不到 `hdc` 就把规则状态写成 SKIP——`hdc` 由 DevEco SDK 的 `toolchains` 提供，正常配过 `framework.config.json > toolchain.devEcoStudio.installPath` 后 PATH 即可命中；如仍找不到，需手工把 `<installPath>/sdk/<api>/toolchains` 加入 PATH。

### Step 8：Harness 验证门禁（agent 必须自跑）

> **CLAUDE.md 4.1 节明示授权**：本步骤的 harness 与 verifier 调用都由主 agent 自己执行，
> **严禁**仅"告知用户可运行"然后结束对话——属软幻觉，由物理拦截层兜底。

UT 交付后，agent **必须自己**完成下列验证，再宣布 UT 阶段完成。

#### 8.1 脚本 Harness（确定性检查，agent 通过 Shell 工具自跑）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature {feature}
```

agent 执行后必须 Read 退出码与报告文件；BLOCKER 必须修复后重跑。

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/ut-rules.yaml`
- `doc/features/{feature}/use-cases.yaml`（v2 新增）
- `doc/features/{feature}/contracts.yaml`
- `doc/features/{feature}/acceptance.yaml`

**v2.1 检查覆盖项**：

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| usecase_spec_recommended | 复杂度达阈值时建议产出 use-cases.yaml | WARN |
| usecase_spec_schema | use-cases.yaml schema 合规（coordinator / ui_bindings / data_boundaries） | BLOCKER |
| usecase_ui_bindings_nonempty | 每个 use_case 的 ui_bindings & user_actions 非空 | BLOCKER |
| boundary_matches_contracts | data_boundaries[].type 在 contracts.yaml > interfaces[].class 中 | MAJOR |
| named_business_handler | ui_bindings.user_actions.calls 所列每个符号是命名符号（函数/类方法/类字段函数/命名 const）而非匿名 inline lambda | BLOCKER |
| dag_linked_usecase | DAG.use_case 回指 use-cases.yaml > use_cases[].id | BLOCKER |
| dag_boundary_matches_spec | port_call_* 节点 boundary = data_boundaries[].name | MAJOR |
| dag_node_type_valid | 节点类型合法（含 v2.1 新增 ui_subscription；user_intervention/ui_navigation 已 deprecated） | BLOCKER |
| ut_import_whitelist | UT 文件 import 仅限白名单（禁 UI 符号） | BLOCKER |
| ut_tsc_compiles | UT 文件 tsc --noEmit 零 Error（v2.2 新增，方案 A 静态编译护城河） | BLOCKER |
| boundaries_all_stubbed | 每个 data_boundary 都有 Spy/Fake/Stub 或原型替换 | BLOCKER |
| it_name_has_ac_or_branch_tag | 用例名带 [AC-X] / [BRANCH-X] 标签 | BLOCKER |
| it_drives_flow | 路径 A 严格判；路径 B 退化为 ≥2 expect | MAJOR |
| branch_coverage_full | 每个 branch 都有对应 it() | BLOCKER |
| ut_case_per_unit_ac | 每条 unit/both 的 P0/P1 AC 都有 it() | BLOCKER |
| acceptance_coverage | 分母只计 ut_layer ∈ {unit, both} | BLOCKER |
| boundary_coverage | 每条 unit/both 的 BD 都有覆盖 | MAJOR |

**若报告中存在 BLOCKER**：必须修正（回到 Step 2 / 3），直到零 BLOCKER。

#### 8.2 AI Harness（语义级检查，agent 主动通过 Task 工具触发 verifier 子 agent）

agent 必须主动通过 Task 工具调用 `subagent_type: verifier`（不是"告诉用户去跑"），把 feature / phase / 脚本报告路径传入：

- **Prompt 模板**：`framework/harness/prompts/verify-ut.md`（由 verifier 子 agent 自行读取）
- **触发方式**：Task 工具，subagent_type=verifier，prompt 中给出 feature/phase/脚本报告路径
- **v2.1 语义检查**：
  1. `state_model_completeness` — state_model 是否足以表达所有分支（若有 use-cases.yaml）
  2. `ui_bindings_completeness` — ui_bindings 是否覆盖所有 UI 节点、命名语义是否清晰（若有 use-cases.yaml）
  3. `end_to_end_driving`（BLOCKER）— 每个 it() 是否端到端驱动（命名入口 + callLog + state 多断言，或退化判断）
  4. `branch_coverage_semantic` — branches 是否涵盖 PRD 中所有异常路径（若有 use-cases.yaml）
  5. `device_ac_delegation` — device/both 的 AC 是否都在 device-testing-todo.md 中
  6. `stub_reasonableness` — 替身预设值是否与 data/model 一致、跨用例无污染
  7. `test_isolation` — beforeEach / afterEach 是否正确隔离

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 8.3 阶段闭环判定（CLAUDE.md 5.1 节 SSOT，四条件缺一不可）

> 下文「物理拦截层」是 adapter 中立术语：`claude` adapter 即 `.claude/hooks/check-phase-completion.mjs` 注册的 Stop hook（由 `00-framework-init` 从 [framework/agents/claude/templates/](../../agents/claude/templates/hooks/check-phase-completion.mjs) 下发）；`generic` / `cursor` adapter 暂无等价物，仍以 Layer 1（CLAUDE.md/AGENTS.md §6.5 反假设条款）+ Layer 2（完成回执 + check-receipt.ts）兜底——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

UT 阶段宣布"完成"前必须**同时**满足：

1. `framework/harness/reports/<feature>/ut/trace.json` 真实存在；
2. 脚本 harness 退出码 0、零 BLOCKER；
3. verifier 子 agent 报告 verdict = PASS；
4. 完成回执 `doc/features/<feature>/ut/phase-completion-receipt.md` 已填写并通过 `npx ts-node framework/harness/scripts/check-receipt.ts --feature <feature> --phase ut` 校验。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，业务级 UT 阶段完成，可进入 Skill 6（真机测试）。物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。

## 关联文件

- 上游输入:
  - `doc/features/{feature}/use-cases.yaml`（Skill 2 v2.1 产出，仅复杂 feature）
  - 业务编排源代码（Skill 3 v2.1 产出，代码形态由 Skill 3 自选：Page 命名方法 / `Flow`/`Coordinator` 普通类 / 导出函数，**不强制** `domain/usecase/` 目录）
  - data 层源代码（`data/repository/*.ets` / `shared/client/*.ets` 等）
  - `doc/features/{feature}/design.md` / `PRD.md` / `contracts.yaml` / `acceptance.yaml`
- 阶段级规约: `framework/specs/phase-rules/ut-rules.yaml`
- UseCase Schema: [templates/use-cases-schema.md](templates/use-cases-schema.md)
- DAG Schema: [templates/dag-schema.md](templates/dag-schema.md)
- UT / Spy 模板: [templates/ut-template.md](templates/ut-template.md)
- 打桩策略: [templates/mock-strategy.md](templates/mock-strategy.md)
- 规范级样例: [examples/card-opening/](examples/card-opening/)
- 脚本 Harness: `framework/harness/scripts/check-ut.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-ut.md`
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **Skill 6 (真机测试)** | `device-testing-todo.md` + UT 代码 + DAG | 真机测试计划与追溯 |
| **Harness (验证层)** | use-cases.yaml + DAG + UT | 脚本/AI 验证 UT 质量 |
| **开发者** | DAG + 业务编排源码 | 理解业务流程，维护 UT |

## 约束与注意事项

1. **UT 是消费者，不驱动架构**：**绝对禁止**为了 UT 反向要求 Skill 2/3 新增 `domain/usecase/XxxUseCase.ets` 或 `XxxPort` 接口。若业务代码无法直接从 UT 调用（例如业务嵌在 `onClick = () => {}` 内），应反馈 Skill 3 抽出命名方法 / 函数，而不是在 UT 里 new `@Component struct`。
2. **use-cases.yaml 非必需**：仅复杂 feature（多 UI 共享状态 / 多步云调用 / 含回滚分支）才有该文件；简单 feature 直接按 acceptance.yaml + dag.yaml 针对 data 层写 UT，不要硬凑。
3. **分支 1:1 映射**（路径 A）：`use-cases.yaml > branches[]` ↔ DAG branches ↔ UT `it()` 严格 1:1（允许 1 个 DAG 覆盖多个 branch，但总并集需覆盖全部）
4. **AC 分层**：只测 `ut_layer in [unit, both]` 的 AC/BD；`device` 的 AC 必须在 `device-testing-todo.md` 中登记，绝不在 UT 里"硬凑"覆盖
5. **Mock 不真调**：UT 中严禁发起真实网络请求、真实系统 API 调用或真实 IO 操作
6. **用例隔离**：每个 `it()` 用例独立运行，在 `beforeEach` 中重建替身；原型替换方案必须在 `afterEach` 还原
7. **替身类型契合**：`SpyXxx` 子类化或 `XxxPort.prototype.method = ...` 必须与 contracts.yaml 中的既有类签名一致
8. **ut_import_whitelist 强约束**：UT 中禁止 import `@Component` / `struct` / `NavPathStack` / `showToast` / `$r` / `$rawfile` / `AppStorage` / `LocalStorage` / `@kit.ArkUI` / `@kit.ArkGraphics`
9. **P0 优先**：先为 P0 AC / 高危 branch 生成 UT，再扩展 P1 / P2
10. **中文注释**：DAG / UT 的 description 使用中文，便于业务理解
11. **Harness 验证闭环**：UT 完成后 agent **必须自己运行** Harness 验证（Step 8），并主动通过 Task 工具触发 `subagent_type: verifier`；确保零 BLOCKER + verifier PASS + 完成回执通过校验后才进入下一阶段（物理拦截层兜底）
12. **【HARD STOP — 不可绕过】禁止擅自修改业务源码**：Skill 5 阶段 agent 对 `02-Feature/**/src/main/**`、`01-Business/**/src/main/**`、`00-Common/**/src/main/**` 等**非 ohosTest/test 目录**下**任何文件的修改**，**必须**满足以下全部条件：
    1. **动手前**显式向用户提出请求（禁止先改后问、禁止边改边问），请求中必须包含：
       - 拟变更的文件路径；
       - 拟抽取/新增的函数签名（或修改 diff 摘要）；
       - **为何不能通过只修改 UT / DAG / use-cases.yaml 规避**该变更的技术理由；
       - 预估影响面（会触发 Skill 3 harness 的哪些规则重跑）。
    2. 用户**书面同意**后方可动手（对话中明确 "同意" / "approved" / "OK" 等正面表述）；
    3. 动手后必须把授权纪要写入 `framework/harness/reports/<feature>/<timestamp>/<model>-ut/gap-notes.md > approved_src_mutations[]`：包含时间戳、文件路径、变更摘要、用户确认原话/链接。
    4. **未登记的 src/main 变更一律视为违规**，会触发 harness `ut_no_src_mutation` BLOCKER；
    5. **特别禁止**以下常见"便利性"借口直接动手：
       - "named_business_handler 报错 → 顺手抽个函数/改成命名字段" → 必须先问；
       - "UT 无法访问私有成员 → 把 private 改成 public" → 必须先问；
       - "UT 需要某个工具函数 → 顺手新增一个" → 必须先问；
       - "导入路径不便 → 顺手改 barrel 导出" → 必须先问。
    违反 HARD STOP 的行为会被后续 Skill 4（Code Review）追溯并标记为质量事件。
    > 推荐替代路径：优先在 UT/Spy 侧用原型替换、`as unknown as T` 注入等方式绕过可测性障碍；确需源码变更时优先选择"抽出命名方法 / 导出函数 / 普通 class"而非新造 Port / UseCase 类。

---

## Claude Code CLI 运行时约定

当本 Skill 通过 `/business-ut` slash command 在 Claude Code CLI（或等价运行时）下运行时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`framework/harness/reports/<feature>/<timestamp>/<model>-ut/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `ut`。
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。

---

## 运行时交付约定（Claude Code CLI / 内网弱模型）

```
framework/harness/reports/<feature>/<timestamp>/<model>-ut/
├── trace.json             # phase = "ut"
├── gap-notes.md
├── check-ut.report.md
└── verifier.report.md     # verifier 跑 verify-ut.md（可选）
```
