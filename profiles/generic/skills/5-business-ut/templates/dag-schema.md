# DAG Schema 规范

> DAG 是业务级 UT 的核心数据结构，用 YAML 描述一条业务流的拓扑 + 打桩 + 断言。
> AI 按 DAG 把 `use-cases.yaml` 的 `branches[]` 翻译成宿主测试框架的 `it()` / `@Test`（具体框架见 `project_profile` addendum）。
>
> **核心原则**：
> - DAG 是**消费品**，不驱动生产代码形态
> - DAG 描述**现有代码**的调用链，不描述"应该如何抽象"
> - UI 副作用（Toast / 导航 / 动画）**永远不画进 DAG**，交 `device-testing-todo.md`

## 概述

v2 修正后的 DAG 定位：

| 维度 | 内容 |
|---|---|
| DAG 的上游 | `acceptance.yaml` + `use-cases.yaml`（若产出）+ 现有业务代码 |
| DAG 的下游 | 宿主 profile 定义的自动化 UT 源码 |
| 必填元数据 | `flow_id` / `branches[]` / `linked_acceptance` / `entry_point` |
| 可选元数据 | `use_case`（产出了 `use-cases.yaml` 时填；否则省略） |

## 完整 Schema

```yaml
# ============================================================================
# 顶层元数据
# ============================================================================

flow_id: string                    # 唯一标识，snake_case，如 "task_handoff_happy"
flow_name: string                  # 人类可读名称（中文）
module: string                     # feature 模块目录名或与 contracts 对齐的模块名，如 "sample-flow"
version: string                    # 版本号，如 "2.0"

# use_case 仅当产出了 use-cases.yaml 时填；简单 feature 省略
use_case: string | null            # 对应 use-cases.yaml > use_cases[].id

branches:                          # 此 DAG 覆盖的分支 id 列表
  - string                         # 产出了 use-cases.yaml 时：必须是 branches[].id 的子集

linked_acceptance:                 # 关联的 AC 编号
  - string
linked_boundaries:                 # 关联的 BD 编号（可选）
  - string

entry_point:                       # 流程入口 —— 指向**现有代码里 UT 能直接调用的命名函数**
  module: string
  file: string                     # 文件相对路径（相对工程根）
  function: string                 # 命名方法/导出函数名

# ============================================================================
# 节点列表
# ============================================================================

nodes:
  - id: string
    type: enum
    description: string

    source:
      file: string
      function: string
      class: string | null

    next: [string]

    trigger:
      event: string
      simulated_value: string
      from_branch: string

    boundary:
      name: string
      type: string                 # 现有类名，如 "TaskRemoteApi"
      method: string
    stub_strategy: enum
    spy_preset: string
    mock_data:
      success: { description: string, value: string }
      error:   { description: string, value: string }
      empty:   { description: string, value: string }

    transition:
      from_phase: string | null
      to_phase: string
      field_updates: object

    condition: string
    branches:
      true_branch: [string]
      false_branch: [string]

    linked_branch: string
    linked_acceptance: [string]
    assertions:
      - type: enum
        target: string
        expected: string
        description: string | null
```

## 节点类型枚举

| type 值 | 说明 | 必填专属字段 |
|---|---|---|
| `user_trigger` | 模拟"用户事件"——UT 里就是直接 `await coord.xxx(...)` | `trigger.event` |
| `port_call_cloud` | 远端接口调用（真实 data 层类的方法） | `boundary`, `stub_strategy`, `spy_preset` 或（deprecated）`mock_data` |
| `port_call_local` | 本地持久化/系统能力调用 | `boundary`, `stub_strategy`, `spy_preset` 或（deprecated）`mock_data` |
| `state_transition` | 业务流内部 state.phase 迁移 | `transition.to_phase` |
| `ui_subscription` | UI 因某 state 变化而渲染（占位） | `transition.to_phase` + `subscriber` |
| `assertion` | UT 断言点 | `linked_branch` 或 `linked_acceptance`，`assertions` |
| `conditional_branch` | 条件分支（保留；优先多 DAG 表达） | `condition`, `branches` |
| `code_execution` | 纯同步计算（保留兼容） | `source` |
| `async_call` | 通用异步调用（保留兼容；优先用 port_call_*） | `source`, `stub_strategy`, `spy_preset` 或（deprecated）`mock_data` |
| `background_task` | 后台任务（保留兼容） | `source`, `task` |
| ~~`user_intervention`~~ | 已弃用 → `device-testing-todo.md` | — |
| ~~`ui_navigation`~~ | 已弃用 → `device-testing-todo.md` | — |

> 关于 `ui_subscription`：本节点类型**不是** UT 关心的对象，只是在 design 阶段为了把"state → UI 反应"的映射可视化而保留的占位节点，方便 Skill 6 从 DAG + `use-cases.yaml > ui_bindings` 生成真机测试清单。UT 扫描时会跳过。

## 断言类型枚举

| assertions[].type | 说明 | target 格式 |
|---|---|---|
| `state_check` | 业务编排 state 字段值 | `flow.state.<field>` / `<coordinator>.state.<field>` |
| `port_call_log` | Spy 调用序列 | `spyCloud.callLog` / `spyLocal.callLog` |
| `data_check` | 数据完整性（持久化/内存） | `spyLocal.saved[0].taskId` |
| `error_check` | 错误态 | `flow.state.errorCode` |
| ~~`ui_verify`~~ | 已弃用 → `device-testing-todo.md` | — |

## 打桩策略枚举

| stub_strategy | 说明 |
|---|---|
| `mock_response` | 返回预设的成功/空响应 |
| `mock_error` | 结构化错误返回 |
| `throw` | 抛异常（网络/磁盘异常） |
| `mock_delay` | 模拟延迟（测加载态） |

## 约束规则

1. **节点类型封闭**：`type` 必须来自上述枚举
2. **无环**：`next` 链可拓扑排序
3. **入口可达**：所有节点从 `entry_point` 对应节点可达
4. **assertion 终止**：`next` 通常为 `[]`
5. **追溯强约束**：assertion 节点必须有 `linked_branch` 或 `linked_acceptance` 之一
6. **boundary 一致性**（当 `use_case` 非空时）：`boundary.name` / `type` / `method` 必须在 `use-cases.yaml > data_boundaries` 中有对应声明
7. **source 存在性**：`source.file` 引用的文件在工程中必须存在
8. **ID 唯一**：DAG 内 `nodes[].id` 不重复
9. **mock 表达**：`port_call_*` / `async_call` 节点应优先使用 `spy_preset` 引用 `ut/mock-plan.yaml`。旧字段 `mock_data` **deprecated**（仍可被旧 harness/工具阅读；新 feature 勿用字面量 `value` 充当代类型）。
10. **UI 副作用禁入**：DAG 中禁止出现路由 push、Toast、真实点击等节点（请用 `ui_subscription` 占位或交 `device-testing-todo.md`）
11. **分支覆盖（当 `use_case` 非空时）**：同 UseCase 的所有 DAG 的 `branches[]` 必须并集覆盖 `use-cases.yaml > branches[].id`，且互不重叠

## 示例：远端受理失败（中性 · 路径占位）

> 与 `examples/sample-flow/use-cases.yaml` 中 `enqueue_fail` 分支对齐；`entry_point.file` 请替换为真实源码路径。

```yaml
flow_id: sample_flow_enqueue_fail
flow_name: 远端受理失败
module: sample-flow
version: "2.0"

use_case: task_handoff
branches: [enqueue_fail]
linked_acceptance: [AC-2]

entry_point:
  module: HandoffCoordinator
  file: "<source_root>/<module>/domain/HandoffCoordinator.<ext>"
  function: submitDraft

nodes:
  - id: n1
    type: user_trigger
    description: 用户提交草稿
    trigger:
      event: submitDraft
      simulated_value: "{ title: 'demo' }"
      from_branch: enqueue_fail
    next: [n2]

  - id: n2
    type: port_call_cloud
    description: 远端拒绝受理
    boundary: { name: remoteApi, type: TaskRemoteApi, method: enqueue }
    stub_strategy: mock_error
    mock_data:
      error: { description: "REMOTE_REJECT", value: "{ ok: false, code: 'REMOTE_REJECT' }" }
    next: [n3]

  - id: n3
    type: state_transition
    description: 进入失败态
    transition:
      from_phase: Enqueuing
      to_phase: Failed
      field_updates: { errorCode: "'REMOTE_REJECT'" }
    next: [n4]

  - id: n4
    type: assertion
    description: 不应写入本地 pending
    linked_branch: enqueue_fail
    linked_acceptance: [AC-2]
    assertions:
      - type: state_check
        target: coord.state.phase
        expected: "Phase.Failed"
      - type: port_call_log
        target: spyLocal.callLog
        expected: "[]"
```

## 可视化

```mermaid
flowchart TD
    n1["n1: submitDraft<br/>user_trigger"]:::trg
    n2["n2: remoteApi.enqueue<br/>port_call_cloud FAIL"]:::cloudFail
    n3(["n3: → Failed<br/>state_transition"]):::state
    n4["n4: assert no local writes<br/>assertion"]:::assert

    n1 --> n2 --> n3 --> n4

    classDef trg   fill:#ffe0b2,stroke:#f57c00
    classDef cloudFail fill:#ffcdd2,stroke:#c62828
    classDef state fill:#e1bee7,stroke:#7b1fa2
    classDef assert fill:#fff59d,stroke:#fbc02d
```

## 与 Skill 6 的分工

| 想表达的内容 | 应出现在 |
|---|---|
| 按钮点击、下拉刷新、真实键盘输入、Toast / 路由转场 / 动画 | `device-testing-todo.md`（Skill 6 真机） |
| `coord.xxx()` 业务入口调用（按 `ui_bindings.user_actions.calls`） | ✅ DAG `user_trigger` + UT `await` |
| Spy 打桩的边界调用 | ✅ DAG `port_call_*` |
| state.phase / state.errorCode 迁移 | ✅ DAG `state_transition` + `assertion` |
| "某页/组件在 phase=X 时应显示/跳转" | ⚠️ DAG 可写 `ui_subscription`（占位，UT 忽略）；真正的断言写入 `device-testing-todo.md` |
