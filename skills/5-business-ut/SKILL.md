# 业务级 UT Skill (`5-business-ut`)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

## 概述

你是一位资深鸿蒙（HarmonyOS）测试工程师，擅长使用 @ohos/hypium 框架编写业务级端到端单元测试。你的任务是基于 **DAG（有向无环图）** 描述业务流程，结合源代码和 Spec 契约，自动生成含打桩的 UT。

本 Skill 是项目全生命周期流水线的**第五环**。上游输入来自 Skill 3（编码）的源代码和 Skill 4（Code Review）的审查报告（确认代码质量达标），输出（UT 代码 + DAG 文件）将流入 Skill 6（真机测试）。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "生成 UT"、"生成单元测试"、"写 UT"
- "业务级 UT"、"端到端测试"
- "生成业务级测试"、"根据 DAG 生成测试"
- "自动化测试"、"单元测试生成"

## 核心理念

**用 DAG 描述业务流程 → AI 理解流程 + 代码 → 自动生成含打桩的 UT → 验证**

传统 UT 粒度太细（单函数）或太粗（E2E），业务级 UT 以**业务流程**为粒度：
- 一条 DAG 描述一个完整业务流程（如"首页加载数据"、"开卡流程"）
- DAG 节点映射到具体源码函数，AI 根据节点类型自动决定打桩策略
- 断言节点直接关联 PRD 验收标准（AC 编号），确保 UT 验证的是**业务需求**

> **示例说明**：本文档后续出现的 `WalletMain` / `BankCard` / `CardRepository` 等模块名，均以**钱包工程为参考示例**演示 DAG 填法，实际请替换为你自己工程的模块名。

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 源代码 | ✅ | Skill 3 产出的 ArkTS 代码（AI 自动读取） |
| contracts.yaml | ✅ | 接口契约 Spec，路径 `specs/features/{module}/contracts.yaml` |
| acceptance.yaml | ✅ | 验收标准 Spec，路径 `specs/features/{module}/acceptance.yaml`，AC 和 BD 是断言的直接来源 |
| design.md | ✅ | 技术设计文档，路径 `doc/features/{module}/design.md`，了解业务流程和组件树 |
| PRD.md | ✅ | 产品需求文档，路径 `doc/features/{module}/PRD.md`，了解业务流程图和异常场景 |
| doc/architecture.md | ✅ | 模块架构全貌，了解模块间依赖关系 |
| review-report.md | ❌ | 可选，用于确认代码已通过 Review 无 BLOCKER |

**若缺少 acceptance.yaml**：提示用户先运行 Skill 1 提取验收标准。UT 的断言必须追溯到 AC 编号。

**若缺少 contracts.yaml**：提示用户先运行 Skill 2 提取接口契约。DAG 节点的 source 引用依赖契约中的文件和函数。

## DAG Schema 规范

DAG（有向无环图）是本 Skill 的核心数据结构，用 YAML 描述业务流程。完整 Schema 见 [templates/dag-schema.md](templates/dag-schema.md)，以下为核心要素：

### DAG 文件结构

```yaml
flow_id: home_page_load          # 唯一标识，snake_case
flow_name: 首页数据加载流程        # 人类可读名称
module: home-page                 # 所属功能模块
linked_acceptance:                # 关联的验收标准 AC 编号
  - AC-1
  - AC-2

entry_point:                      # 流程入口
  module: WalletMain
  file: presentation/pages/HomePage.ets
  function: aboutToAppear

nodes:
  - id: n1
    type: code_execution
    description: 页面初始化触发数据加载
    source:
      file: 02-Feature/WalletMain/src/main/ets/presentation/pages/HomePage.ets
      function: aboutToAppear
    next: [n2]

  - id: n2
    type: async_call
    description: 从 Repository 获取卡片列表
    source:
      file: 02-Feature/WalletMain/src/main/ets/data/repository/CardRepository.ets
      function: getCardList
    stub_strategy: mock_response
    mock_data:
      success:
        description: 正常返回 3 张卡片
        value: "[mockBankCard, mockTransportCard, mockAccessCard]"
      empty:
        description: 返回空列表
        value: "[]"
    next: [n3]

  - id: n3
    type: conditional_branch
    description: 根据卡片数量决定显示内容
    condition: "cardList.length > 0"
    branches:
      true_branch: [n4]
      false_branch: [n5]

  - id: n4
    type: assertion
    description: 验证卡片列表正常展示
    linked_acceptance: [AC-1]
    assertions:
      - type: state_check
        target: HomePage.cardList
        expected: "length === 3"
      - type: ui_verify
        description: 卡片轮播组件可见

  - id: n5
    type: assertion
    description: 验证空状态页面展示
    linked_acceptance: [AC-2]
    assertions:
      - type: state_check
        target: HomePage.cardList
        expected: "length === 0"
      - type: ui_verify
        description: 空状态引导组件可见
```

### DAG 节点类型

| 节点类型 | 说明 | UT 处理策略 |
|----------|------|------------|
| `code_execution` | 普通同步代码执行 | 直接调用函数 |
| `async_call` | 异步调用（网络/IO/系统 API） | 必须 mock/stub，不发起真实调用 |
| `user_intervention` | 需要用户操作（点击/输入） | 模拟 UI 输入事件 |
| `background_task` | 后台任务（定时器/Worker） | 直接调用回调或使用 fake timer |
| `ui_navigation` | 页面跳转（Navigation/Router） | mock 路由并验证跳转参数 |
| `conditional_branch` | 条件分支 | 生成多条测试用例覆盖每个分支 |
| `assertion` | 断言检查点 | 生成 expect 语句，关联 AC 编号 |

### DAG 文件存放路径

```
{module}/test/dag/{flow_id}.dag.yaml
```

例如：
```
02-Feature/WalletMain/test/dag/home_page_load.dag.yaml
02-Feature/WalletMain/test/dag/card_detail_view.dag.yaml
```

## 工作流程

### Step 1: 读取上下文并规划 DAG

1. 读取功能模块的相关文件：
   - `doc/features/{module}/PRD.md` — 提取业务流程图和异常场景
   - `doc/features/{module}/design.md` — 提取服务层接口和组件树
   - `specs/features/{module}/acceptance.yaml` — 提取验收标准 AC 和边界 BD
   - `specs/features/{module}/contracts.yaml` — 提取接口签名和文件清单
   - `doc/architecture.md` — 了解模块间依赖
2. 读取 contracts.yaml files 列表中的源代码文件
3. 分析业务流程，规划需要生成的 DAG 列表：

```
📋 DAG 规划清单：

业务流程分析完成，规划以下 DAG：

| # | flow_id | 流程名称 | 关联 AC | 节点数 | 优先级 |
|---|---------|---------|--------|--------|--------|
| 1 | home_page_load | 首页数据加载 | AC-1, AC-2 | 5 | P0 |
| 2 | card_detail_view | 卡片详情查看 | AC-3, AC-4 | 4 | P0 |
| 3 | network_offline | 离线场景处理 | BD-1 | 3 | P0 |
| 4 | large_dataset | 大数据量滚动 | BD-2 | 3 | P1 |

AC 覆盖率: P0=100%, P1=100%
BD 覆盖率: 80%
```

4. 等待用户确认 DAG 规划

### Step 2: 生成 DAG 文件

对每个规划的 DAG 执行：

1. **构建节点链**：根据业务流程和源代码，构建 DAG 节点序列
   - 每个节点必须有 `source.file` + `source.function` 指向实际代码
   - `async_call` 节点必须定义 `stub_strategy` 和 `mock_data`
   - `assertion` 节点必须关联 `linked_acceptance`（AC 编号）
   - `conditional_branch` 节点必须定义 `branches`
2. **验证 DAG 合法性**：
   - 无环检测（拓扑排序）
   - source.file 引用的文件必须存在
   - linked_acceptance 引用的 AC 编号必须在 acceptance.yaml 中存在
3. **展示 DAG 给用户确认**（使用 Mermaid 可视化）
4. **写入 DAG 文件**到 `{module}/test/dag/{flow_id}.dag.yaml`

### Step 3: 生成 UT 代码

对每个 DAG 生成对应的测试文件。UT 代码模板见 [templates/ut-template.md](templates/ut-template.md)，打桩策略见 [templates/mock-strategy.md](templates/mock-strategy.md)。

#### 3.1 UT 代码结构

```typescript
import { describe, it, expect, beforeEach, afterEach } from '@ohos/hypium'
// ... 被测代码和 mock 的 import

export default function homePageLoadTest() {
  describe('HomePageLoad', () => {
    // Mock 声明和 setup
    let mockCardRepository: MockCardRepository

    beforeEach(() => {
      // 重置所有 mock 状态，确保用例间隔离
      mockCardRepository = new MockCardRepository()
    })

    afterEach(() => {
      // 清理副作用
    })

    // 正常路径测试 — 关联 AC-1
    it('[AC-1] 首页加载后展示卡片列表', async () => {
      // Arrange: 设置 mock 返回值
      mockCardRepository.setCardList(mockCards)

      // Act: 执行业务流程
      const page = new HomePageForTest(mockCardRepository)
      await page.aboutToAppear()

      // Assert: 验证业务结果（关联 AC-1）
      expect(page.cardList.length).assertEqual(3)
      expect(page.isLoading).assertFalse()
    })

    // 空状态路径测试 — 关联 AC-2
    it('[AC-2] 无卡片时展示空状态页面', async () => {
      // Arrange
      mockCardRepository.setCardList([])

      // Act
      const page = new HomePageForTest(mockCardRepository)
      await page.aboutToAppear()

      // Assert
      expect(page.cardList.length).assertEqual(0)
      expect(page.showEmptyState).assertTrue()
    })

    // 边界场景测试 — 关联 BD-1
    it('[BD-1] 网络断开时展示离线缓存数据', async () => {
      // Arrange
      mockCardRepository.simulateNetworkError()

      // Act
      const page = new HomePageForTest(mockCardRepository)
      await page.aboutToAppear()

      // Assert
      expect(page.showOfflineHint).assertTrue()
    })
  })
}
```

#### 3.2 打桩策略对照表

| DAG 节点类型 | 打桩方式 | 代码模式 |
|-------------|---------|---------|
| `async_call` (Repository) | 创建 Mock 类继承/实现接口 | `class MockXxxRepository { ... }` |
| `async_call` (系统 API) | 替换系统模块方法 | `jest.spyOn(http, 'createHttp').mockReturnValue(...)` |
| `user_intervention` | 直接调用事件处理函数 | `component.onInputChange('test value')` |
| `background_task` | 直接调用回调 | `service.onBackgroundResult(mockResult)` |
| `ui_navigation` | Mock Router 验证参数 | `expect(mockRouter.lastPush).assertEqual('/detail')` |
| `conditional_branch` | 控制输入数据 | 生成多条 it() 覆盖每个分支 |

#### 3.3 生成流程

对每个 DAG 文件：

1. **解析 DAG**：按节点顺序构建执行路径
2. **识别打桩点**：提取所有 `async_call`、`user_intervention`、`background_task` 节点
3. **生成 Mock 类/函数**：根据 contracts.yaml 中的接口签名创建类型安全的 Mock
4. **生成测试用例**：
   - 每条 DAG 路径至少一个 `it()` 用例
   - `conditional_branch` 节点的每个分支各生成一个用例
   - 每个 `assertion` 节点映射为一个或多个 `expect()` 语句
5. **关联 AC 编号**：每个 `it()` 用例的描述中标注关联的 AC/BD 编号
6. **展示 UT 代码给用户确认**
7. **写入 UT 文件**到：
   ```
   {module}/src/ohosTest/ets/test/{flow_id}.test.ets
   ```

### Step 4: 测试注册与配置

1. 确保 ohosTest 模块的 `List.test.ets` 中注册了所有新增测试函数
2. 确认 `@ohos/hypium` 依赖在 ohosTest 的 `oh-package.json5` 中声明
3. 若模块尚无 ohosTest 目录，按鸿蒙标准结构创建：
   ```
   {module}/src/ohosTest/
   ├── ets/
   │   └── test/
   │       ├── List.test.ets       # 测试入口注册
   │       ├── {flow_id}.test.ets  # 各业务流程的 UT
   │       └── mock/               # Mock 工具类
   │           └── MockXxx.ets
   └── module.json5
   ```

### Step 5: 质量门禁自检

```
[ ] 1. DAG 完整性：每个 DAG 文件是否包含 flow_id、flow_name、entry_point、nodes？
[ ] 2. DAG 无环：所有 DAG 是否通过拓扑排序验证（无循环 next 引用）？
[ ] 3. 源码引用：DAG 节点的 source.file 引用的文件是否全部存在？
[ ] 4. AC 覆盖率：P0/P1 验收标准是否全部被 DAG assertion 节点覆盖？
[ ] 5. UT 框架：每个 UT 文件是否正确 import @ohos/hypium？
[ ] 6. 断言有效性：每个 it() 用例中是否包含至少一条 expect 断言？
[ ] 7. Mock 隔离：async_call 节点是否全部有对应的 mock/stub？
[ ] 8. 测试注册：所有 UT 文件是否在 List.test.ets 中注册？
[ ] 9. 用例独立性：每个 it() 是否在 beforeEach 中重置 mock 状态？
[ ] 10. UT 文件命名：是否以 .test.ets 结尾且与 DAG flow_id 对应？
```

**不通过项**：定位具体问题，自动修复后重新检查，直到全部通过。

### Step 6: 输出交付摘要

```markdown
## 业务级 UT 交付摘要

### DAG 文件清单
| flow_id | 流程名称 | 关联 AC | 节点数 | 路径 |
|---------|---------|--------|--------|------|
| home_page_load | 首页数据加载 | AC-1, AC-2 | 5 | WalletMain/test/dag/home_page_load.dag.yaml |
| ... | ... | ... | ... | ... |

### UT 文件清单
| flow_id | 测试函数名 | 用例数 | 路径 |
|---------|-----------|--------|------|
| home_page_load | homePageLoadTest | 3 | WalletMain/src/ohosTest/ets/test/home_page_load.test.ets |
| ... | ... | ... | ... |

### 覆盖率统计
| 指标 | 数值 |
|------|------|
| AC 覆盖率 (P0) | X/N (100%) |
| AC 覆盖率 (P1) | X/N (YY%) |
| BD 覆盖率 | X/N (ZZ%) |
| 总 DAG 数 | N |
| 总测试用例数 | M |

### 质量门禁结果
- [x] DAG 完整性：通过
- [x] DAG 无环：通过
- [x] 源码引用：通过
- [x] AC 覆盖率：P0 100%, P1 100%
- [x] 断言有效性：通过

### 下一步
建议运行 Harness 验证（Step 7），验证通过后可进入 Skill 6（真机测试）。
```

### Step 7: Harness 验证门禁

UT 交付后，引导用户执行 Harness 验证以确保 UT 质量达标。

#### 7.1 脚本 Harness（确定性检查）

告知用户可运行脚本 Harness 做自动化质量检查：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature {module-name}
```

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/ut-rules.yaml` — 阶段级通用规则
- `specs/features/{module-name}/contracts.yaml` — 功能级接口契约
- `specs/features/{module-name}/acceptance.yaml` — 功能级验收标准

**脚本检查覆盖项**：

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| DAG Schema 合规 | flow_id、flow_name、entry_point、nodes[] 必填字段 | BLOCKER |
| DAG 节点类型 | type 是否为预定义枚举值 | BLOCKER |
| DAG 无环 | 拓扑排序验证，next 链无循环 | BLOCKER |
| 源码引用 | DAG source.file 引用的文件是否存在 | BLOCKER |
| UT 框架 import | 是否导入 @ohos/hypium | BLOCKER |
| 断言存在性 | 每个 it() 中是否有 expect | BLOCKER |
| 异步节点打桩 | async_call 节点是否有对应 mock | BLOCKER |
| 测试注册 | UT 文件是否在 List.test.ets 注册 | MAJOR |
| UT 文件命名 | 是否以 .test.ets 结尾 | MAJOR |

**若报告中存在 BLOCKER**：必须修正（回到 Step 3 或 Step 2），直到零 BLOCKER。

#### 7.2 AI Harness（语义级检查）

告知用户可使用 AI Harness 进行语义级深度验证：

- **Prompt 模板**：`framework/harness/prompts/verify-ut.md`
- **使用方式**：将 prompt 中的占位符替换为实际内容后，发送给独立 AI 模型执行审查
- **语义检查覆盖项**：
  1. DAG 流程准确性 — DAG 是否准确反映 PRD/design.md 中的业务流程
  2. 断言有效性 — 断言是否验证有意义的业务逻辑（非仅"函数被调用"）
  3. Mock 合理性 — Mock 数据结构是否与 data/model 一致，值域是否合理
  4. 打桩策略正确性 — 打桩方式是否匹配 DAG 节点类型
  5. 分支覆盖 — conditional_branch 每个分支是否有对应测试用例
  6. 测试隔离性 — 用例间是否独立（beforeEach/afterEach 正确重置）

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 7.3 验证完成标志

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER |
| AI Harness | verdict = PASS（无 BLOCKER 级 FAIL） |

验证全部通过后，业务级 UT 阶段完成，可进入 Skill 6（真机测试）。

## 关联文件

- 上游输入:
  - 源代码（Skill 3 输出）
  - `doc/features/{module}/design.md`（Skill 2 输出）
  - `doc/features/{module}/PRD.md`（Skill 1 输出）
  - `specs/features/{module}/contracts.yaml`（Skill 2 产出的接口契约 Spec）
  - `specs/features/{module}/acceptance.yaml`（Skill 1 产出的验收标准 Spec）
- 阶段级规约: `framework/specs/phase-rules/ut-rules.yaml`
- DAG Schema 参考: [templates/dag-schema.md](templates/dag-schema.md)
- UT 模板参考: [templates/ut-template.md](templates/ut-template.md)
- 打桩策略参考: [templates/mock-strategy.md](templates/mock-strategy.md)
- 脚本 Harness: `framework/harness/scripts/check-ut.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-ut.md`
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **Skill 6 (真机测试)** | UT 代码 + DAG 文件 | 测试计划参考 |
| **Harness (验证层)** | DAG + UT 代码 + acceptance.yaml | 脚本/AI 验证 UT 质量 |
| **开发者** | DAG 文件 | 理解业务流程，维护 UT |

## 约束与注意事项

1. **AC 追溯强制**：每个 assertion 节点和每个 it() 用例必须关联到 acceptance.yaml 中的 AC/BD 编号，不允许存在无追溯的断言
2. **DAG 先行**：先生成 DAG 文件并经用户确认，再生成 UT 代码。DAG 是 UT 的设计蓝图
3. **Mock 不真调**：UT 中严禁发起真实网络请求、真实系统 API 调用或真实 IO 操作。所有外部依赖必须 mock
4. **用例隔离**：每个 it() 用例必须独立运行，在 beforeEach 中重置所有 mock 状态，不依赖执行顺序
5. **类型安全 Mock**：Mock 类必须与 contracts.yaml 中的接口签名类型一致，使用 TypeScript 类型约束
6. **模拟应用适配**：本项目为模拟应用，Repository 使用写死数据——UT 中的 Mock 仍然必须独立于源码 Repository 的实现，以验证接口契约而非实现细节
7. **P0 优先**：先为 P0 AC 项生成 DAG 和 UT，确保核心流程覆盖，再扩展 P1/P2
8. **中文注释**：DAG 的 description 和 UT 的用例名称使用中文，便于业务理解
9. **Harness 验证闭环**：UT 完成后必须引导用户运行 Harness 验证（Step 7），确保零 BLOCKER 后才进入下一阶段
10. **不修改源码**：生成 UT 时不应修改 Skill 3 产出的业务代码。若发现代码无法测试（如缺少依赖注入），应记录在交付摘要中作为改进建议，而非直接修改

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
