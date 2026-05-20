# 业务级 UT Skill (`5-business-ut` · v2.1)

> **用户确认 UX**：[user-confirmation-ux.md](../reference/user-confirmation-ux.md) · `ut.plan_confirm` / `ut.mock_plan` / `ut.src_mutation` / `ut.dag_confirm`。

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

**Harness 运行时前置**：执行本 Skill 中任意 `harness-runner` / `npx ts-node harness-runner.ts` / `check-receipt.ts`（依赖 harness npm）前，须满足 [Host harness readiness · Tier_1](../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../reference/harness-cli-cwd.md)（harness 之后用 `cd framework/harness && npx ts-node scripts/check-receipt.ts`）。

### Feature 归档定位协议（本阶段是消费者）

进入本 Skill 后，必须先基于 `framework.config.json > paths.features_dir` 精确定位 `doc/features/<feature>/`。本步骤只依赖用户给出的 feature 名与文件系统状态，不依赖 `.current-phase.json`、历史 reports、trace 或上一阶段缓存。

- 只有精确目录 `doc/features/<feature>/` 是正式 feature；同级 `<feature>.rar` / `<feature>.zip` / `<feature>.7z` / `<feature>.tar*` 以及 `<feature>-old/`、`<feature>.md` 等同名前缀条目都只是旁证。
- 若精确目录不存在，必须快速失败并提示用户先创建/恢复正式 feature 目录；不得自动解压归档，不得读取归档内容补齐上下文。
- 若目录存在但本阶段输入缺失（至少 `PRD.md`、`design.md`、`contracts.yaml`、`acceptance.yaml`）：报告缺失文件并回到上游阶段补齐；不得把同名归档当作上游产物。
- 继续执行前，向用户展示本阶段输入矩阵：`PRD.md` / `design.md` / `contracts.yaml` / `acceptance.yaml` / `use-cases.yaml(可选)` 存在/缺失，旁证归档/同名前缀条目如实列出但明确忽略。

## Step 0. 载入 `project_profile` addendum（强制）

继续下文前，完整阅读：

`framework/profiles/<project_profile.name>/skills/5-business-ut/profile-addendum.md`

（未声明 `project_profile` 时由 harness 按仓库指纹回落默认 profile；若路径不存在则仅依赖本文与 profile 树下模板/示例。）

> **动态资产引用**：正文中的 `` `profile-skill-asset:<skill>/<asset_key>` `` 须按 [Profile skill asset protocol](../README.md#profile-skill-asset-protocol) 解析。

---

## 概述

你是资深**宿主侧业务级 UT** 工程师。UT 运行框架、测试文件扩展名、编译与执行链路以当前 `project_profile` addendum 与 `ut.compile` / `ut.run` capabilities 为准；其它 profile（如文档型 generic）可能在 harness 层禁用编译/装机规则，勿把宿主特例硬编码为全局真理。

你的任务是作为**既有代码的消费者**：读懂业务编排源码（由 Skill 3 自选形态……

本 Skill 是项目全生命周期流水线的**第五环**。上游输入来自 Skill 2（`use-cases.yaml`，**条件式**）、Skill 3（业务编排源代码 + UI）与 Skill 4（Code Review），输出（UT + DAG + 可选 `ut/reports/ac-coverage.json`）将流入 Skill 6（真机测试；消费 `acceptance.yaml` > `device_focus`）。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "生成 UT"、"生成单元测试"、"写 UT"、"业务级 UT"
- "端到端测试"、"UseCase 测试"、"分支覆盖 UT"
- "生成 SpyPort / 生成打桩类"

## 核心理念（v2.1）

**UT 是既有代码的消费者，不驱动架构**：

- 🟢 **复杂 feature（有 `use-cases.yaml`）**：按 `ui_bindings[].user_actions[].calls` 声明的**命名函数**直接调用；在 `data_boundaries` 处打桩；断言 state 序列 + 调用序列 + 持久化数据。
- 🟢 **简单 feature（无 `use-cases.yaml`）**：按 `acceptance.yaml` + `dag.yaml`，直接针对 data 层函数 / Repository / 导出工具函数写 UT，覆盖数据契约与边界异常即可，不要硬凑 UseCase 架构。
- 🔴 **UI 层绝对禁入 UT**：不 import profile addendum 声明的 UI/资源/页面运行时符号；由 harness 对应 BLOCKER 拦截。
- 🔴 **不要为了 UT 反过来改架构**：不要求新建特定目录或接口形态；若代码可测性差（如业务嵌在 inline lambda 中），反馈 Skill 3 抽出命名方法，不要在 UT 里实例化 UI 组件。

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
| UI 交互 | 部分在 UT 里走 | ✗ 交 Skill 6（`acceptance.yaml` > `device_focus`） |
| AC 过滤 | 全部算 UT 覆盖 | `ut_layer in [unit, both]` 进 UT；`device` 交 Skill 6 |

### Harness：`ut.compile` / `ut.run` capability

- **默认命令**由当前 profile provider 实现；中立 Skill 只要求通过 harness 触发，避免 agent 手拼宿主命令。
- **产物路径**、装机/运行方式、日志格式由 profile addendum 与 provider 定义。
- **失败归因**：若 `check-ut` 报命令形态不匹配，应优先核对 profile provider 命令形态，**不要**未经对齐就按依赖缺失处理或进入 Skill 6。

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| **`doc/features/{feature}/use-cases.yaml`** | ⚠️（仅复杂 feature） | Skill 2 产出（仅当满足复杂度阈值）；含 `coordinator / ui_bindings / data_boundaries / state_model / branches`，Skill 5 的**主规划来源** |
| 业务编排源代码 | ✅ | Skill 3 产出；代码形态由 Skill 3 自选（Page 命名方法 / `Flow` 类 / 导出函数）。UT 按 `ui_bindings.user_actions.calls` 或 acceptance.yaml 指向的函数直接调用 |
| data 层源代码 | ✅ | `data/repository/*.<ext>`、`shared/client/*.<ext>` 等；UT 在 profile 允许的边界上打桩 |
| `doc/features/{feature}/contracts.yaml` | ✅ | 接口契约 Spec，`data_boundaries[].type` 必须来自这里的 `interfaces[].class` |
| `doc/features/{feature}/acceptance.yaml` | ✅ | 验收标准 Spec，含 `ut_layer`；简单 feature 时是主规划来源 |
| `doc/features/{feature}/ut/testability-audit.md` | ✅ | Step 1.5 可测性预检（覆盖全部 unit/both AC/BD） |
| `doc/features/{feature}/ut/mock-plan.yaml` | ⚠️ | Step 1.6 Test Double Plan；存在 L0/L1/L2 可测项时 **必填** |
| `doc/features/{feature}/design.md` | ✅ | 状态机 Mermaid、UseCase 清单章节（若有） |
| `doc/features/{feature}/PRD.md` | ✅ | 业务流程图和异常场景 |
| `doc/architecture.md` | ✅ | 模块架构全貌 |
| `review-report.md` | ❌ | 可选，用于确认代码已通过 Review |

**若缺少 `use-cases.yaml`**：不阻塞本 Skill。按 acceptance.yaml + dag.yaml 直接针对 data 层 / 导出函数写 UT；harness 会以 WARN 提示而非 BLOCKER。**严禁**为此回过头去要求 Skill 2 补 use-cases.yaml 以套入架构（除非确实符合复杂度阈值）。

**若缺少 `acceptance.yaml`**：提示用户先运行 Skill 1。

## 规约参考

| 规约 | 路径 |
|------|------|
| UseCase 规范 Schema | `` `profile-skill-asset:5-business-ut/use_cases_schema` `` |
| DAG Schema（v2） | `` `profile-skill-asset:5-business-ut/dag_schema` `` |
| UT 模板 + Spy 模板（子类化既有类 / 原型替换） | `` `profile-skill-asset:5-business-ut/ut_template` `` |
| 打桩策略 | `` `profile-skill-asset:5-business-ut/mock_strategy` `` |
| 可测性预检模板 | `` `profile-skill-asset:5-business-ut/testability_audit_template` `` |
| mock-plan Schema | `` `profile-skill-asset:5-business-ut/mock_plan_schema` `` |
| 规范级样例（中性多步流程） | `` `profile-skill-asset:5-business-ut/sample_flow_dir` `` |

## UT 可测性 / mock-plan 策略决议（v2.3）

以下结论按本仓库计划书落地，作为 Skill 5 的 **SSOT** 口径：

1. **存量 feature 迁移**：已在历史版本通过 UT harness 的 feature，**仅当再次进入 Skill 5 并变更 UT 相关产物时** 回补 `ut/testability-audit.md` 与 `ut/mock-plan.yaml`；**新 feature 自 v2.3 规则生效起一律强制**（与 `ut-rules.yaml` 中 BLOCKER 一致）。
2. **L3 + option_b 接缝白名单**：仅允许 **构造注入、包装 wrapper、提取命名方法、setter 注入** 等显式接缝；**禁止**「换一种全局单例」式改造敷衍 UT。
3. **可测性预检的独立切入**：如只想完成 Step 1.5/1.6（产出 `testability-audit.md` / `mock-plan.yaml`）后暂停，请在 `/business-ut`（Cursor 即 `5-business-ut` 跳板）入口中明确告知 agent，**不**再提供独立 `/ut-audit` slash 或跳板；完整 UT 闭环仍由 `/business-ut` 收尾。

## 工作流程（v2.1）

### Step 1：规划 DAG 与 UT（按是否有 `use-cases.yaml` 分两条路径）

### Context Exploration Gate（BLOCKER）

在输出下文 **「UT 规划清单」**（进入 HARD STOP 确认门）之前，必须将探索摘要落盘至 **`doc/features/<feature>/ut/context-exploration.md`**，模板见 [`../../harness/templates/context-exploration.md`](../../harness/templates/context-exploration.md)。

1. **必读**：`PRD.md`、`design.md`、`contracts.yaml`、`acceptance.yaml`；若存在 `use-cases.yaml` 须读；被测命名入口与 `data_boundaries` 对应源码；**Step 0** addendum 中 **UT 目录、套件注册、测试框架与 import 禁入** 等宿主约定。
2. `key_inputs_read` 须覆盖 **acceptance**、**contract**、**prd**、**design** 子串；若存在 `use-cases.yaml`，条目中须能匹配 **use-case** 或 **`use-cases.yaml`**。
3. 若多 `branch` / 多 `use_case` 或 Spy 边界 **≥3**，且运行时支持只读子 agent，应并行分域探索并记入 `subagents_used`；否则 `not_available`。

先读取全部上游输入：

- `doc/features/{feature}/use-cases.yaml`（**若存在**）
- `doc/features/{feature}/acceptance.yaml`（只关注 `ut_layer in [unit, both]` 的 AC/BD）
- `doc/features/{feature}/PRD.md` / `design.md`
- `doc/features/{feature}/contracts.yaml`（data_boundary type 必须在 `interfaces[].class` 中）
- 业务编排源代码（Skill 3 自选了 Page 方法 / `Flow` 类 / 导出函数）

> **HARD STOP — 规划确认门**（`ut.plan_confirm` · user-confirmation-ux §3.1）：Step 1 结束后必须先向用户展示「UT 规划清单」。**gate**：`1=确认清单` / `2=调整清单`。禁止直接进入 Step 2/3 写 DAG 或 UT。清单必须包含：
> - 本轮覆盖的 `AC/BD/branch`，以及不覆盖项和原因（如 `device` 交 Skill 6）；
> - 每个 `it()` 的名称、被测入口、Spy/Stub 边界、核心断言（状态 / 返回值 / callLog / 持久化）；
> - 将要新增或修改的 DAG / **profile 规定的测试源文件** / 套件注册入口路径；
> - 明确声明「本轮不改业务源码」。若确需改 `src/main`，必须先走文末约束 #12 的单独授权流程，不能把它混在规划确认里。
>
> 用户未确认前，agent 只能继续补充说明或调整规划，不得写文件。

#### 路径 A：存在 `use-cases.yaml` —— 按 branches × ui_bindings 规划

为每个 use_case 列一张 **Branch × DAG × UT × AC 清单**：

```markdown
📋 UT 规划清单（use_case: `task_handoff`，coordinator: `HandoffCoordinator`）

ui_bindings 入口（来自 use-cases.yaml）:
- TaskComposerPage.role=entry, user_actions[].calls = "coord.submitDraft"
- ConfirmDialog.role=dialog, user_actions[].calls = "coord.confirm"

| # | branch id       | DAG 文件                           | it() 用例                              | linked_acceptance |
|---|-----------------|-------------------------------------|----------------------------------------|-------------------|
| 1 | happy_path      | task_handoff_happy.dag.yaml         | [BRANCH-happy_path][AC-1] 成功          | AC-1              |
| 2 | enqueue_fail    | task_handoff_enqueue_fail.dag.yaml  | [BRANCH-enqueue_fail][AC-2] 远端拒绝    | AC-2              |

unit/both AC 覆盖率: 100%
device-only AC: （在 acceptance.yaml 填写 device_focus）
```

#### 路径 B：无 `use-cases.yaml` —— 按 acceptance.yaml 直接规划

按 `ut_layer ∈ {unit, both}` 的 AC/BD 逐条列清单，指向具体的 **被测 data 层函数** 或 **导出业务函数**：

```markdown
📋 UT 规划清单（feature: demo-dashboard，无 use-cases.yaml）

| # | AC/BD id | 被测单元                         | DAG 文件             | it() 用例                     |
|---|----------|----------------------------------|----------------------|-------------------------------|
| 1 | AC-1     | DashboardRepository.fetchWidgets | dashboard_ut.dag.yaml | [AC-1] 列表契约完整 |
| 2 | AC-2     | DashboardRepository.fetchSummary | dashboard_ut.dag.yaml | [AC-2] 摘要契约完整 |
| 3 | BD-1     | DashboardRepository.fetchSummary(empty) | dashboard_ut.dag.yaml | [AC-2][BD-1] 空列表回落 |
```

**等待用户确认清单后进入 Step 1.5（可测性预检）；不得跳过 Step 1.5/1.6 直接进入 Step 2。**

#### Step 1 输出格式（必须使用）

```markdown
## UT 规划清单（等待确认）

覆盖范围：
- unit/both：AC-1、AC-2、BD-1
- device-only：AC-3（acceptance.device_focus，不进 UT）

用例矩阵：
| it() | AC/BD/branch | 被测入口 | Spy/Stub 边界 | 核心断言 |
|------|--------------|----------|---------------|----------|
| [AC-1] xxx | AC-1 | Flow.submitDraft | SpyTaskRemoteApi | phase=Success；callLog=[enqueue,finalize] |

将写入文件：
- `<layer>/<Module>/test/dag/xxx.dag.yaml`
- `<layer>/<Module>/src/<profile-test-root>/...`（目录名以 addendum 为准）

业务源码：
- 不修改 `src/main`。
```

### Step 1.5：可测性预检（testability-audit.md）【HARD STOP】

在生成 DAG / mock-plan / **profile 定义的单测源文件**之前，必须为 **acceptance.yaml 内每条 `ut_layer ∈ {unit, both}` 的 AC/BD** 写一条可测性结论，归档：

`doc/features/{feature}/ut/testability-audit.md`

1. **按模板撰写**：`` `profile-skill-asset:5-business-ut/testability_audit_template` ``（L0–L3 定义、依赖 kind/seam、YAML 形态）。
2. **对每条 unit/both 项给出**：
   - `testability_level`（L0/L1/L2/L3）
   - 关键 `dependencies`（含 `global_singleton` / `inline_lambda` 等，以便 harness 与人工审阅）
   - `verdict`：`testable` | `downgrade_device` | `needs_seam`
3. **若为 L3（不可测或只能高成本测）**：**必须 STOP**，向用户展示 `recommendation.option_a`（降级 device-only）与 `option_b`（源码改造 + gap-notes 授权），迫使用户选择并在文档中填写 `selected: option_a | option_b`：
   - **option_a**：在 `acceptance.yaml` 对应条目填写 `device_focus`（真机要点；harness 校验非空）
   - **option_b**：**不得**在 gap-notes 登记前改 `src/main`；登记 `approved_src_mutations[]` 后按约束 #12 执行接缝改造（仅此路径可解除 L3 在 UT 层的硬阻塞）

> 用户未对 **全部 L3 项** 做完 a/b 选择前，禁止进入 Step 1.6 / Step 2 / Step 3。

### Step 1.6：Test Double Plan（mock-plan.yaml）【HARD STOP】

在 Step 2 之前产出类型骨架，路径：

`doc/features/{feature}/ut/mock-plan.yaml`

1. **规格**：`` `profile-skill-asset:5-business-ut/mock_plan_schema` ``（imports、`spies[]`、methods、presets、`ts_expr` **必须**含 `as Type` 或 `new ...(`）。
2. **权威对齐**：`spies[].target_class` / `methods[].name` 必须可在 `contracts.yaml > interfaces[]` 中找到；**禁止**在稍后的 Spy 类里脱离 plan 自由发挥字段或方法签名。
3. **与 Step 3 的关系**：生成 `SpyXxx` / `FakeXxx` 时 **1:1 翻译** mock-plan（preset id、方法名、返回/异常预设），UT 中切换分支时只调用 plan 中声明的 preset（例如 `spy.applyPreset('success')` 一类封装），避免在 `it()` 内手写无类型字面量。
4. **用户确认**（`ut.mock_plan`：`1=确认 mock-plan` / `2=调整`）：展示计划中的 spy 边界与 preset 列表，明确本轮是否仅文档级 mock-plan（不改业务源码）；若需 option_b 接缝，仍走约束 #12。

> 无 L0/L1/L2 可测项（例如全部为 L3 且选 option_a）时，mock-plan 由 harness `ut_mock_plan_present` SKIP；**一旦出现可测等级为 L0/L1/L2 的 AC/BD，mock-plan 强制**。

### Step 2：生成 DAG 文件

对每个 branch 生成一份 DAG（或合并成同一个 use_case 的多分支 DAG，只要 branches[] 交集为空、并集覆盖即可）：

1. **必填顶层字段**（由 harness `dag_schema_compliance` BLOCKER 强制）：
   - `flow_id` / `flow_name` / `module` / `version`
   - `entry_point` / `nodes`
   - **若 `use-cases.yaml` 存在**：另需 `use_case`（= `use-cases.yaml > use_cases[].id`）+ `branches[]`（= 该 DAG 覆盖的分支 id 列表）
   - `linked_acceptance`
2. **节点构建**：
   - `user_trigger`：对应业务入口命名函数调用（ui_bindings.user_actions.calls）
   - `port_call_cloud` / `port_call_local`：对应调用的 data_boundary（节点字段 `boundary` = `data_boundaries[].name`；旧字段 `port` 兼容）；**推荐**在此类节点与 `async_call` 上声明 `spy_preset`（引用 `mock-plan.yaml` 的 `presets[].id`）。旧字段 `mock_data` **仍可读但已 deprecated**（过渡期与 `spy_preset` 共存）。
   - `state_transition`：对应 `state_model.phases` 迁移
   - `assertion`：必须声明 `linked_branch` 或 `linked_acceptance`（两者之一）
   - `ui_subscription`（v2.1 新）：**仅用于文档化 UI 对 state 的订阅**，UT 忽略；真机要点写入 acceptance `device_focus`
3. **UI 副作用不进 UT 断言**：`NavPathStack.push` / `showToast` 只能作为 `ui_subscription` 节点记录，或在 Skill 1 的 `acceptance.yaml` > `device_focus` 中声明，不要画成 `port_call_*` 或 `assertion` 节点
4. **验证 DAG**：无环、source 存在、`boundary` 名回到 `use-cases.yaml > data_boundaries[].name`（若存在 use-cases.yaml）
5. **展示 Mermaid** 给用户确认（`ut.dag_confirm`：`1=确认DAG` / `2=修改DAG`；按节点类型着色）
6. **写入** `{module}/test/dag/{flow_id}.dag.yaml`

### Step 3：生成 UT 代码（按 branch 或 AC 生成 `it()`）

**mock-plan 优先**：若已产出 `ut/mock-plan.yaml`，Spy 类与 preset 行为必须与其一致；DAG 节点上的 `spy_preset` 仅做追溯，UT 内切换预设时仍以 plan 为真源。

#### 3.1 UT 骨架（路径 A：有 use-cases.yaml）

按照 `` `profile-skill-asset:5-business-ut/ut_template` `` 提供的骨架生成。**直接调用 `ui_bindings.user_actions.calls` 声明的命名函数**，**不 new `@Component struct`**：

```typescript
import { describe, it, expect, beforeEach } from '@ohos/hypium'
import { HandoffCoordinator, Phase } from '../../../main/ets/domain/flow/HandoffCoordinator'
import { SpyTaskRemoteApi } from './spy/SpyTaskRemoteApi'
import { SpyTaskLocalStore } from './spy/SpyTaskLocalStore'

export default function taskHandoffFlowTest() {
  describe('HandoffCoordinator', () => {
    let api: SpyTaskRemoteApi
    let store: SpyTaskLocalStore
    let coord: HandoffCoordinator

    beforeEach((): void => {
      api = new SpyTaskRemoteApi()
      store = new SpyTaskLocalStore()
      coord = new HandoffCoordinator(api, store)
    })

    it('[BRANCH-happy_path][AC-1] 提交流程成功', 0, async () => {
      api.whenEnqueue.returns({ ok: true, jobId: 'j1' })
      api.whenAck.returns({ ok: true })
      await coord.submitDraft({ title: 'demo' })
      expect(coord.state.phase).assertEqual(Phase.Pending)
      await coord.confirm({ token: 't1' })
      expect(coord.state.phase).assertEqual(Phase.Success)
      expect(api.callLog).assertDeepEquals(['enqueue', 'ack'])
      expect(store.callLog).assertDeepEquals(['savePending', 'finalize'])
    })
  })
}
```

#### 3.1B UT 骨架（路径 B：无 use-cases.yaml）

简单 feature 直接针对 data 层或导出函数写 UT：

```typescript
import { describe, it, expect, beforeEach } from '@ohos/hypium'
import { DashboardRepository } from '../../../main/ets/data/repository/DashboardRepository'

export default function dashboardRepoTest() {
  describe('demo-dashboard', () => {
    let repo: DashboardRepository
    beforeEach((): void => { repo = new DashboardRepository() })

    it('[AC-1] DashboardRepository 契约完整', 0, async () => {
      const widgets = await repo.fetchWidgets()
      expect(widgets).not.assertNull()
      expect(widgets.length).assertLarger(0)
      expect(widgets[0].id).not.assertUndefined()
    })
  })
}
```

#### 3.2 打桩代码（v2.1 · 不再强制 Port 接口）

v2.1 的打桩针对 **`use-cases.yaml > data_boundaries[].type` 所指的既有 data 层类**，有三种合法形式（任选其一）：

- **形式 1：子类化** — `class SpyTaskRemoteApi extends TaskRemoteApi { ... }`，override 实际方法；暴露 `callLog: string[]` 和每个方法一份 `whenXxx.{returns, fails, throws}` preset
- **形式 2：原型方法替换** — `TaskRemoteApi.prototype.enqueue = (...)`（`afterEach` 必须恢复）
- **形式 3：若 data 层已用 DI 注入的接口/抽象类** — 直接提供该接口的 Spy 实现

**统一约束**：
- **禁止**为打桩方便额外创建 `XxxPort` 接口
- **禁止**在 Spy 内部写业务判断（业务判断必须留在 coordinator / 命名业务函数里）
- 若采用形式 2，`afterEach` 必须恢复原型，避免跨用例污染

参考模板见 `` `profile-skill-asset:5-business-ut/ut_template` `` 的打桩章节。

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

**允许的 import 类别**（细则与**测试框架包名**见 profile addendum）：测试框架、被测命名业务入口、data 层与被允的 Spy/Fake、同目录替身。

**禁止的符号清单**由 **profile** 实现（`harness/ut-ui-import-ban.ts` + addendum），脚本仅在与 phase-rules 声明一致时启用。

#### 3.6 生成流程

1. 为每个 data_boundary（或路径 B 的直接依赖）在 **profile 规定的测试源码树** 下生成 `spy/`（或等价目录）替身（已存在则复用）
2. 为每个 use_case（路径 A）或每组 AC（路径 B）生成一份 **profile 规定的测试文件**（扩展名与命名模式见 addendum，如 `*.test.<ext>`），每个 branch / AC 一个 `it()`
3. 展示给用户确认
4. 写入文件

### Step 4：测试注册与配置

1. 确保 **测试套件注册入口**（由 profile 约定文件名，如 `<suite_registry>.<ext>`）登记了所有新增用例
2. 确认测试框架依赖在 **profile 声明的测试模块包描述** 中声明（常见为宿主侧的包清单文件）
3. 若模块尚无测试源码目录，按 **profile 标准目录** 创建（路径见 addendum，如 `<module>/<profile-test-root>/...`）

```
{module}/src/<profile-test-root>/
├── ...
│   └── <suite_registry>.<ext>        # 测试入口聚合
│   └── <feature>.test.<ext>          # 分文件用例
│   └── spy/                          # Spy / Fake
└── module.json5（若需要）
```

### Step 5：质量门禁自检（v2.1）

```
[ ] 1.  use-cases.yaml（若存在）通过 schema 校验：含 coordinator / ui_bindings / data_boundaries / state_model / branches
[ ] 2.  named_business_handler（若有 use-cases.yaml）：ui_bindings[].user_actions[].calls 每个符号在代码中都能找到**命名符号**——传统函数 / 类方法 / 类字段函数（`handler = () => {}`）/ 顶层命名 const 赋值 均合法
[ ] 3.  boundary_matches_contracts（若有 use-cases.yaml）：data_boundaries[].type 都能在 contracts.yaml > interfaces[].class 中找到
[ ] 4.  DAG 合规：顶层含 flow_id / flow_name / entry_point / nodes；若有 use-cases.yaml 则另含 use_case（= id）和 branches[]
[ ] 5.  DAG 分工：同 use_case 所有 DAG 的 branches[] 交集为空、并集覆盖所有非 device_only 分支
[ ] 6.  ut_import_whitelist（BLOCKER）：UT 未 import profile 禁止清单中的 UI / 资源运行时符号（完整表见 addendum + `ut-ui-import-ban`）
[ ] 7.  boundaries_all_stubbed：每个 data_boundary 都有 Spy/Fake/Stub 子类化或原型替换的证据
[ ] 8.  it() 命名：每条 it() 以 [AC-X] 或 [BRANCH-X] 起始
[ ] 9.  it() 驱动力：
         - 路径 A：每条 it() 调用命名入口 + ≥2 次 callLog 断言 + ≥2 次 state/phase 断言
         - 路径 B：每条 it() ≥2 次 expect，覆盖数据契约
[ ] 10. AC 覆盖（单元层）：ut_layer in [unit, both] 且 P0/P1 的 AC 100% 对应 it()
[ ] 11. 分支覆盖（若有 use-cases.yaml）：每个非 device_only 分支都有对应 it()
[ ] 12. device 层 AC：Skill 1 的 acceptance.yaml 已为 ut_layer∈{device,both} 填写 device_focus；DAG 的 ui_subscription 要点与 device_focus 一致
[ ] 13. 测试注册：所有 UT 文件在 **profile 声明的套件入口** 中注册
[ ] 14. 用例独立性：beforeEach 重建替身；若用原型替换方案，afterEach 还原
```

**不通过项**：定位具体问题，自动修复后重新检查，直到全部通过。

### Step 6：UT 机器回执（与 Skill 6 衔接）

**不再**产出 `device-testing-todo.md`（已废弃）。真机要点由 Skill 1 写入 `acceptance.yaml` > `device_focus`。本步在 harness PASS 后由脚本写出：

`doc/features/{feature}/ut/reports/ac-coverage.json`（unit 层覆盖摘要，**非** acceptance SSOT）。

若发现 device/both AC 缺 `device_focus`，应回到 Skill 1 补全，而非新建平行 todo 文件。

### Step 7：输出交付摘要

```markdown
## 业务级 UT 交付摘要（v2）

### UseCase 清单（来自 use-cases.yaml）
| UseCase | branches 数 | UT 文件 | DAG 数 |
|---------|-------------|---------|--------|
| TaskHandoff | 2 | task_handoff.test.<ext> | 2 |

### DAG 文件清单
| flow_id | use_case | branches | 关联 AC |
|---------|----------|----------|---------|
| task_handoff_happy | TaskHandoff | [happy_path] | AC-1 |
| ... |

### UT 文件清单
| 文件 | 测试函数 | 用例数（= branches 数） |
|------|---------|-------------------------|
| task_handoff.test.<ext> | taskHandoffFlowTest | 2 |

### 覆盖率统计
| 指标 | 数值 |
|------|------|
| unit/both P0 AC 覆盖率 | X/N (100%) |
| unit/both P1 AC 覆盖率 | X/N (YY%) |
| BD 覆盖率（unit/both） | X/N (ZZ%) |
| 分支覆盖率（branches） | M/M (100%) |
| 交 Skill 6 的 device AC | K 条（见 acceptance.yaml device_focus） |

### 下一步
- 运行 Harness 验证（Step 8）
- 进入 Skill 6：按 acceptance `device_focus` 派生 test-plan
```

### Step 7.5：UT 编译闭环（必要出口）

> v2.2 新增：**UT 编译/宿主静态检查是 Skill 5 的必要出口条件**。光"写完"不算，必须让当前 profile 的 `ut.compile` capability 实际通过；本步骤要求 agent 自己跑闭环。

#### 7.5.1 静态 tsc 自检（TypeScript Compiler API）

> 这一步 harness 在 `ut_tsc_compiles` 中自动跑；agent 不用手敲，但要看 harness 报告：若 FAIL，按 details 中的 `file:line:col TSxxxx message` 直接定位修。

#### 7.5.2 profile UT 编译

**首选方式（v2.3 起推荐）**：通过 harness 触发，由 profile provider 处理底层命令拼装、环境变量注入与平台路径转义：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature <feature-name>
```

> **不要**让 agent 自己手敲宿主 UT 编译命令。目标 task / 模块定位 / env 注入由 harness 与 profile provider 封装，日志会落到 `doc/features/<feature>/ut/reports/` 便于排错。

#### 7.5.3 自闭环修复策略

1. `ut.compile` 对应规则 FAIL → 进入修复；
2. 完整 Read `doc/features/<feature>/ut/reports/` 下的失败日志；
3. 按错误类型分类：
   - UT 调用的被测函数签名不符 → 修 UT；
   - UT import 路径错误 → 修 UT；
   - 类型注解与被测实际类型不匹配 → 修 UT；
   - `project_dependency_missing` / `Cannot find module` → **先**按 [Host harness readiness · Tier_1](../reference/host-harness-readiness.md) 核对 harness 自身 `npm install` / `node_modules/ts-node`（Tier_1 细节以该 SSOT 为准）。若 Tier_1 已满足仍判定为宿主工程依赖问题，不要让用户手工猜，展示方案：A) 用户确认后执行当前 profile 的依赖安装命令并重跑；B) 仅读取依赖清单输出缺失项；C) registry/权限不确定时先确认内网源；
   - **若错误根因在业务源码** → 进入 Step 7.5.4 严格流程，**禁止**自行动手；
4. 修完再跑直到 exit code = 0。

#### 7.5.4 触及业务源码时的 HARD STOP

只要错误根因落在 **`UT_SRC_PROTECTED_PREFIXES`** 所覆盖的业务源码树（前缀由 `framework/harness/scripts/check-ut.ts` 结合实例 DSL/profile 推导，而非写死单层名）：

1. **立即停手**，向用户输出请求：
   - 拟变更文件路径；
   - 拟修改 / 抽取的函数签名；
   - 为何 UT/Spy/Stub 层不能规避；
   - 影响面（会触发 Skill 3 的哪些 BLOCKER 重跑）。
2. 用户**书面同意**前不得修改任何源码文件；
3. 同意后把授权登记到 `doc/features/<feature>/ut/reports/gap-notes.md > approved_src_mutations[]`（含时间戳、文件、变更摘要、用户原话）；
4. 否则触发 harness `ut_no_src_mutation` BLOCKER FAIL。

### Step 7.6：UT 装机运行闭环（必要出口）

> v2.2 新增：UT 必须**实际跑通**，不是只会"看起来对"。当前 profile 的 `ut.run` BLOCKER 会强制此步；若 profile 声明 SKIP，则以 harness verdict 为准。

#### 7.6.1 探测设备

按当前 profile addendum 声明的方式探测可运行目标。

输出非空才能进 7.6.2；输出 `[Empty]` 或为空：

- **不允许**继续往下跑后宣称 PASS；
- **不允许**用"本地无设备"为由把 harness 标绿；
- 必须先：准备当前 profile 要求的设备/运行环境，重新探测；
- 只有探测到设备后才能继续。

#### 7.6.2 装机执行

**首选方式（v2.3 起推荐）**：通过 harness 触发，由当前 profile 的 `ut.run` provider 执行安装/运行/结果解析链路：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature <feature-name>
```

一次 `--phase ut` 可同时触发 `ut.compile` + `ut.run`；日志与 summary 落到 `doc/features/<feature>/ut/reports/`，运行报告 details 会包含 provider 声明的失败阶段标签，方便定位。

> **不要**让 agent 自己手敲宿主测试命令；必须通过 harness 与 profile provider。

#### 7.6.3 自闭环修复策略

1. 解析 `ut.run` 报告中的测试统计；
2. failed > 0：
   - 读 `doc/features/<feature>/ut/reports/hdc-test.log` 完整内容；
   - 找到 failure 用例的 `OHOS_REPORT_STATUS: stack=...` 堆栈；
   - 按堆栈定位：是 UT 逻辑错？Spy 预设值错？还是被测业务真有 bug？
   - **业务真有 bug 时**：仍走 7.5.4 的 HARD STOP 流程，先报告再改；
3. total = 0：报告会标 `失败阶段：no_pass` 或 `run`——通常是测试入口没启动或 profile 测试配置不匹配；按 profile addendum 核对测试入口配置；
4. 失败阶段是 `metadata` / `artifact_not_found` / `install` → 回 7.5（先把 build 跑过）或检查当前 profile 的 toolchain 配置；
5. 修完再跑直到 failed = 0 且 total > 0。

#### 7.6.4 绝不允许

- 把"无设备"标成 SKIP / PASS 上交；
- 用环境变量跳过 `ut.run` BLOCKER（harness 会转成 FAIL）；
- "我修过 UT 了，但没跑就交"——必须真的装机跑过且全部 PASS；
- 因为找不到 profile toolchain 就把规则状态写成 SKIP；必须按 profile addendum 补齐工具链配置后重跑。

### Step 8：Harness 验证门禁（agent 必须自跑）

> **全局入口 §4.1 明示授权**：本步骤的 harness 与 verifier 调用都由主 agent 自己执行，
> **严禁**仅"告知用户可运行"然后结束对话——属软幻觉，由物理拦截层兜底。

UT 交付后，agent **必须自己**完成下列验证，再宣布 UT 阶段完成。

#### 8.1 脚本 Harness（确定性检查，agent 通过 Shell 工具自跑）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature {feature} --summary --failures-only
```

agent 执行后必须 Read 退出码与报告文件；BLOCKER 必须修复后重跑。
优先读取 `doc/features/<feature>/ut/reports/summary.json`，禁止用 `grep` 解析完整控制台日志。

若 `summary.next_action = rerun_with_HARNESS_DIFF_BASE_REF_working` 或 `ut_no_src_mutation` 报 `stale_diff_base`，agent 必须自动重跑一次：

```bash
HARNESS_DIFF_BASE_REF=working npx ts-node harness-runner.ts --phase ut --feature {feature} --summary --failures-only
```

重跑后如果仍有 working 侧业务源码改动，才进入 Step 7.5.4 / 约束 #12 的 HARD STOP 授权流程；禁止要求用户"批量授权历史变更"。

若 `summary.next_action = resolve_project_dependencies_then_rerun` 或 `ut_compile`（及兼容别名 `ut_hvigor_build`）报 `project_dependency_missing`，按 Step 7.5.3 的依赖缺失分支处理，不得只要求用户手工执行宿主 IDE / 包管理器操作而不给出 harness 侧可复现路径。

每次 harness 运行后，agent 必须把 `ut_run_status` 的状态面板完整贴给用户；禁止只用 `grep` 展示局部 PASS/FAIL。尤其当 `ut_compile` 失败导致 `ut_run`（及兼容别名 `ut_hvigor_test`）短路时，必须明确说：

> 当前不能宣称 UT 通过；**宿主测试模块未在真机/模拟器上实际执行**（详见 profile 的 `ut.run` 能力说明）。

状态面板格式：

```text
UT 阶段状态：
- 静态/结构规则：PASS/FAIL
- tsc 静态编译：PASS/FAIL
- 宿主测试模块编译（**profile 声明的测试编译能力 / 等价命令**）：PASS/FAIL
- 真机/模拟器执行：PASS/FAIL/未执行
- 源码改动检查：PASS/FAIL
- 当前是否可以宣称 UT 完成：是/否
```

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
  5. `device_ac_delegation` — device/both 的 AC 是否已声明 device_focus
  6. `stub_reasonableness` — 替身预设值是否与 data/model 一致、跨用例无污染
  7. `test_isolation` — beforeEach / afterEach 是否正确隔离

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 8.3 阶段闭环判定（全局入口 §5.1 节 SSOT，四条件缺一不可）

> 下文「物理拦截层」：**部分 adapter** 经 Skill 00 在实例根下发 **Stop hook**，在消息结束前读取 state 并阻断「假完成」（Layer 3 行为与路径见 [framework/agents/README.md](../../agents/README.md)）。**未**配置该能力的 adapter 不设物理层豁免，仍须满足 Layer 1（全局入口 §6.5「反假设条款」）+ Layer 2（完成回执 + `check-receipt.ts`）——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

UT 阶段宣布"完成"前必须**同时**满足：

1. `doc/features/<feature>/ut/reports/trace.json` 真实存在；
2. 脚本 harness 退出码 0、零 BLOCKER；
3. verifier 子 agent 报告 verdict = PASS；
4. 完成回执 `doc/features/<feature>/ut/phase-completion-receipt.md` 已填写并通过 `cd framework/harness && npx ts-node scripts/check-receipt.ts --feature <feature> --phase ut` 校验。

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
  - data 层源代码（`data/repository/*.<ext>` / `shared/client/*.<ext>` 等）
  - `doc/features/{feature}/design.md` / `PRD.md` / `contracts.yaml` / `acceptance.yaml`
- 阶段级规约: `framework/specs/phase-rules/ut-rules.yaml`
- UseCase Schema: `` `profile-skill-asset:5-business-ut/use_cases_schema` ``
- DAG Schema: `` `profile-skill-asset:5-business-ut/dag_schema` ``
- UT / Spy 模板: `` `profile-skill-asset:5-business-ut/ut_template` ``
- 打桩策略: `` `profile-skill-asset:5-business-ut/mock_strategy` ``
- 规范级样例: `` `profile-skill-asset:5-business-ut/sample_flow_dir` ``
- 脚本 Harness: `framework/harness/scripts/check-ut.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-ut.md`
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **Skill 6 (真机测试)** | `acceptance.yaml`（device_focus）+ UT + DAG | 真机 test-plan 与追溯 |
| **Harness (验证层)** | use-cases.yaml + DAG + UT | 脚本/AI 验证 UT 质量 |
| **开发者** | DAG + 业务编排源码 | 理解业务流程，维护 UT |

## 约束与注意事项

1. **UT 是消费者，不驱动架构**：**绝对禁止**为了 UT 反向要求 Skill 2/3 新增特定目录下的 `XxxUseCase` 类或 Port 接口。若业务嵌在 `onClick = () => {}` 内，应反馈 Skill 3 抽出命名方法，而不是在 UT 里实例化 **UI 组件**。
2. **use-cases.yaml 非必需**：仅复杂 feature（多 UI 共享状态 / 多步云调用 / 含回滚分支）才有该文件；简单 feature 直接按 acceptance.yaml + dag.yaml 针对 data 层写 UT，不要硬凑。
3. **分支 1:1 映射**（路径 A）：`use-cases.yaml > branches[]` ↔ DAG branches ↔ UT `it()` 严格 1:1（允许 1 个 DAG 覆盖多个 branch，但总并集需覆盖全部）
4. **AC 分层**：只测 `ut_layer in [unit, both]` 的 AC/BD；`device` 的 AC 须在 acceptance `device_focus` 中声明，绝不在 UT 里"硬凑"覆盖
5. **Mock 不真调**：UT 中严禁发起真实网络请求、真实系统 API 调用或真实 IO 操作
6. **用例隔离**：每个 `it()` 用例独立运行，在 `beforeEach` 中重建替身；原型替换方案必须在 `afterEach` 还原
7. **替身类型契合**：`SpyXxx` 子类化或 `XxxPort.prototype.method = ...` 必须与 contracts.yaml 中的既有类签名一致
8. **ut_import_whitelist 强约束**：UT 仅允许 profile addendum 与 `ut-ui-import-ban` 定义的白名单 import
9. **P0 优先**：先为 P0 AC / 高危 branch 生成 UT，再扩展 P1 / P2
10. **中文注释**：DAG / UT 的 description 使用中文，便于业务理解
11. **Harness 验证闭环**：UT 完成后 agent **必须自己运行** Harness 验证（Step 8），并主动通过 Task 工具触发 `subagent_type: verifier`；确保零 BLOCKER + verifier PASS + 完成回执通过校验后才进入下一阶段（物理拦截层兜底）
    - 若 `ut_no_src_mutation` 报告 committed 历史变更多、working tree 变更少，优先怀疑 diff 基线过旧；可设置 `HARNESS_DIFF_BASE_REF=working` 只检查当前工作区。**禁止**要求用户"批量授权所有历史变更"。
12. **【HARD STOP — 不可绕过】禁止擅自修改业务源码**：Skill 5 阶段 agent 对 **受保护业务源码前缀**（定义见 `check-ut.ts` 与 profile，不再写死 `02-Feature` 等目录名）下、且**非 profile 声明的测试/夹具源目录**内任何文件的修改，**必须**满足以下全部条件：
    1. **动手前**显式向用户提出请求（`ut.src_mutation` · freeform + portable；**须先展示完整变更描述**）：

       ```text
       1. 授权改源码
       2. 拒绝
       3. 先看 diff
       ```

       请求中必须包含：
       - 拟变更的文件路径；
       - 拟抽取/新增的函数签名（或修改 diff 摘要）；
       - **为何不能通过只修改 UT / DAG / use-cases.yaml 规避**该变更的技术理由；
       - 预估影响面（会触发 Skill 3 harness 的哪些规则重跑）。
    2. 用户**书面同意**后方可动手（对话中明确 "同意" / "approved" / "OK" 等正面表述）；
    3. 动手后必须把授权纪要写入 `doc/features/<feature>/ut/reports/<timestamp>/<model>-ut/gap-notes.md > approved_src_mutations[]`：包含时间戳、文件路径、变更摘要、用户确认原话/链接。
    4. **未登记的 src/main 变更一律视为违规**，会触发 harness `ut_no_src_mutation` BLOCKER；
    5. **特别禁止**以下常见"便利性"借口直接动手：
       - "named_business_handler 报错 → 顺手抽个函数/改成命名字段" → 必须先问；
       - "UT 无法访问私有成员 → 把 private 改成 public" → 必须先问；
       - "UT 需要某个工具函数 → 顺手新增一个" → 必须先问；
       - "导入路径不便 → 顺手改 barrel 导出" → 必须先问。
    违反 HARD STOP 的行为会被后续 Skill 4（Code Review）追溯并标记为质量事件。
    > 推荐替代路径：优先在 UT/Spy 侧用原型替换、`as unknown as T` 注入等方式绕过可测性障碍；确需源码变更时优先选择"抽出命名方法 / 导出函数 / 普通 class"而非新造 Port / UseCase 类。

---

## Slash / 快捷入口触发时的 trace 约定

当本 Skill 通过适配器下发的 slash（如 `/business-ut`）或其它等价快捷入口触发时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`doc/features/<feature>/ut/reports/<timestamp>/<model>-ut/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `ut`。
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。

---

## 运行时交付约定（内网 / 弱模型）

```
doc/features/<feature>/ut/reports/<timestamp>/<model>-ut/
├── trace.json             # phase = "ut"
├── gap-notes.md
├── check-ut.report.md
└── verifier.report.md     # verifier 跑 verify-ut.md（可选）
```
