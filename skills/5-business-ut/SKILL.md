# 业务级 UT Skill (`5-business-ut` · v2)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

## 概述

你是一位资深鸿蒙（HarmonyOS）测试工程师，擅长使用 @ohos/hypium 框架编写 **业务级端到端单元测试**。
你的任务是基于 **`use-cases.yaml`（UseCase 规范）+ DAG（有向无环图）**，结合源代码和 Spec 契约，自动生成**端到端驱动 UseCase 的 UT**。

本 Skill 是项目全生命周期流水线的**第五环**。上游输入来自 Skill 2（`use-cases.yaml`）、Skill 3（UseCase + 页面代码）与 Skill 4（Code Review），输出（UT + DAG + `device-testing-todo.md`）将流入 Skill 6（真机测试）。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "生成 UT"、"生成单元测试"、"写 UT"、"业务级 UT"
- "端到端测试"、"UseCase 测试"、"分支覆盖 UT"
- "生成 SpyPort / 生成打桩类"

## 核心理念（v2）

**`use-cases.yaml` 定义业务流程 + 分支 → DAG 描述每条分支的拓扑 → UT 端到端驱动 UseCase，断言 state 序列与 port 调用序列 → UI 副作用下沉到 Skill 6 真机覆盖。**

| 维度 | v1 老做法 | v2 新做法 |
|------|-----------|-----------|
| 被测单元 | Repository / 单接口 | **UseCase 类**（构造器注入 ports） |
| 流程描述 | 只有 DAG | `use-cases.yaml` + DAG（分支 1:1） |
| Mock 粒度 | MockRepository（笼统） | **SpyPort**（cloud / local 分别 Spy） |
| 用例粒度 | 一个 `it()` 验一条数据接口 | **一个 `it()` 端到端驱动一个 branch** |
| 断言粒度 | 仅数据 | state 序列 + port 调用序列 + 数据 |
| UI 交互 | 部分在 UT 里走 | ✗ 交 Skill 6（`device-testing-todo.md`） |
| AC 过滤 | 全部算 UT 覆盖 | `ut_layer in [unit, both]` 进 UT；`device` 交 Skill 6 |

> **强约束**：UT **禁止** import 任何 `@Component` / `NavPathStack` / `showToast` / `$r` / `@kit.ArkUI` 等 UI 相关符号（由 harness `no_ui_dep_in_ut` BLOCKER 拦截）。

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| **`doc/features/{feature}/use-cases.yaml`** | ✅（有业务流程时） | Skill 2 产出的 UseCase 清单（含 ports / state_model / branches），Skill 5 的 **主规划来源** |
| 源代码（UseCase + Spy 接口） | ✅ | Skill 3 产出的 `domain/usecase/*.ets` 与 `data/api/*.ets`、`domain/port/*.ets` |
| `doc/features/{feature}/contracts.yaml` | ✅ | 接口契约 Spec，port 的接口签名来源 |
| `doc/features/{feature}/acceptance.yaml` | ✅ | 验收标准 Spec，含 `ut_layer / linked_flow / linked_branch` |
| `doc/features/{feature}/design.md` | ✅ | 状态机 Mermaid、UseCase 清单章节 |
| `doc/features/{feature}/PRD.md` | ✅ | 业务流程图和异常场景 |
| `doc/architecture.md` | ✅ | 模块架构全貌 |
| `review-report.md` | ❌ | 可选，用于确认代码已通过 Review |

**若缺少 `use-cases.yaml` 且 `acceptance.yaml` 有 `ut_layer in [unit, both]` 的 AC**：提示用户回到 Skill 2 补齐 UseCase 规范（这是 v2 UT 的前提）。

**若缺少 `acceptance.yaml`**：提示用户先运行 Skill 1。

## 规约参考

| 规约 | 路径 |
|------|------|
| UseCase 规范 Schema | [templates/use-cases-schema.md](templates/use-cases-schema.md) |
| DAG Schema（v2） | [templates/dag-schema.md](templates/dag-schema.md) |
| UT 模板 + SpyPort 模板 | [templates/ut-template.md](templates/ut-template.md) |
| 打桩策略 | [templates/mock-strategy.md](templates/mock-strategy.md) |
| 规范级样例（开卡流程） | [examples/card-opening/](examples/card-opening/) |

## 工作流程（v2）

### Step 1：按 `use-cases.yaml` 规划 DAG 与 UT

1. 读取：
   - `doc/features/{feature}/use-cases.yaml`（若存在）→ 抽取 UseCase 列表及每个 UseCase 的 branches
   - `doc/features/{feature}/acceptance.yaml`（只关注 `ut_layer in [unit, both]` 的 AC/BD）
   - `doc/features/{feature}/PRD.md` / `design.md`（异常场景比对）
   - `doc/features/{feature}/contracts.yaml`（port 接口签名）
   - UseCase 源文件（`02-Feature/{Module}/src/main/ets/domain/usecase/*.ets`）
2. 为每个 UseCase 列一张 **Branch × DAG × UT × AC 清单**：

```markdown
📋 UT 规划清单（UseCase: CardOpeningUseCase）

| # | branch id           | DAG 文件                         | it() 用例                         | linked_acceptance |
|---|---------------------|----------------------------------|-----------------------------------|-------------------|
| 1 | happy_path          | card_opening_happy.dag.yaml      | [BRANCH-happy_path][AC-1] 成功      | AC-1              |
| 2 | validate_fail       | card_opening_validate_fail.yaml  | [BRANCH-validate_fail][AC-2] 校验失败 | AC-2              |
| 3 | sms_fail_rollback   | card_opening_sms_fail.dag.yaml   | [BRANCH-sms_fail_rollback][AC-3] 短验失败回滚 | AC-3 |
| 4 | persist_fail        | card_opening_persist_fail.yaml   | [BRANCH-persist_fail][AC-4] 持久化失败 | AC-4 |

unit/both AC 覆盖率: 100% (AC-1..4)
device AC: AC-5 / AC-6（交 Skill 6，写入 device-testing-todo.md）
```

3. 等待用户确认清单

### Step 2：生成 DAG 文件（v2）

对每个 branch 生成一份 DAG（或合并成同一个 UseCase 的多分支 DAG，只要 branches[] 交集为空、并集覆盖即可）：

1. **必填顶层字段**（由 harness `dag_schema_compliance` BLOCKER 强制）：
   - `flow_id` / `flow_name` / `module` / `version`
   - **`use_case`**（= `use-cases.yaml > use_cases[].class`）
   - **`branches`**（= 该 DAG 覆盖的分支 id 列表）
   - `linked_acceptance` / `entry_point` / `nodes`
2. **节点构建**（使用 v2 节点类型）：
   - `user_trigger`：对应 UseCase.trigger 方法调用
   - `port_call_cloud` / `port_call_local`：对应 `use-cases.yaml > ports[]` 的 method 调用（含 stub_strategy / mock_data）
   - `state_transition`：对应 `state_model.phases` 迁移
   - `assertion`：必须声明 `linked_branch` 或 `linked_acceptance`（两者之一）
3. **UI 副作用不进 DAG**：所有 `NavPathStack.push` / `showToast` 请写入 `device-testing-todo.md`，不要画成节点
4. **验证 DAG**：无环、source 存在、port 名/方法名能回到 `use-cases.yaml`
5. **展示 Mermaid** 给用户确认（按节点类型着色）
6. **写入** `{module}/test/dag/{flow_id}.dag.yaml`

### Step 3：生成 UT 代码（v2 · 按 branch 生成 `it()`）

对每个 UseCase 生成一份 UT 文件，按 branch 一一生成 `it()`：

#### 3.1 UT 骨架

按照 [templates/ut-template.md](templates/ut-template.md) 提供的骨架生成：

```typescript
import { describe, it, expect, beforeEach } from '@ohos/hypium'
import { CardOpeningUseCase, Phase } from '../../../main/ets/domain/usecase/CardOpeningUseCase'
import { SpyCardOpenApi } from './spy/SpyCardOpenApi'
import { SpyCardPersistence } from './spy/SpyCardPersistence'

export default function cardOpeningUseCaseTest() {
  describe('CardOpeningUseCase', () => {
    let api: SpyCardOpenApi
    let storage: SpyCardPersistence
    let useCase: CardOpeningUseCase

    beforeEach((): void => {
      api = new SpyCardOpenApi()
      storage = new SpyCardPersistence()
      useCase = new CardOpeningUseCase(api, storage)
    })

    it('[BRANCH-happy_path][AC-1] 开卡全链路成功', 0, async () => {
      api.whenValidateOpen.returns({ ok: true, token: 't' })
      api.whenApplyCardResource.returns({ cardId: 'c1', holder: 'u1' })
      api.whenVerifySmsCode.returns({ ok: true })

      await useCase.startOpening(bankInfo)
      expect(useCase.state.phase).assertEqual(Phase.WaitingSms)

      await useCase.submitSmsCode('123456')
      expect(useCase.state.phase).assertEqual(Phase.Success)
      expect(api.callLog).assertDeepEquals(['validateOpen', 'applyCardResource', 'verifySmsCode'])
      expect(storage.callLog).assertDeepEquals(['save', 'update'])
    })

    // ... 每个 branch 对应一个 it()
  })
}
```

#### 3.2 SpyPort 代码生成（v2）

为每个 port 在 `{module}/src/ohosTest/ets/test/spy/Spy{PortType}.ets` 生成 SpyPort：

- **实现对应 port 接口**（`contracts.yaml > interfaces[].class`）
- 暴露 `callLog: string[]` 记录调用顺序
- 每个方法一份 `whenXxx.{returns, fails, throws}` preset
- 本地 port 可额外暴露 `currentCards` / `saved` 等可断言的状态
- **禁止** 在 Spy 内部写业务判断

参考模板见 [templates/ut-template.md](templates/ut-template.md) 的 SpyPort 章节。

#### 3.3 每个 `it()` 的三类必备断言

v2 强约束（`it_drives_flow` MAJOR 检查）：

1. **state 序列断言**（≥2 次 `useCase.state.*` expect）
2. **port 调用序列断言**（`assertDeepEquals(spy.callLog, [...])`）
3. **数据 / 错误码断言**（`saved[].cardId` / `errorCode`）

#### 3.4 用例命名（v2 强约束）

`it()` 必须以 `[BRANCH-<id>]` 或 `[AC-<id>]` 开头（两者可组合，如 `[BRANCH-happy_path][AC-1]`）。

#### 3.5 生成流程

对每个 UseCase：

1. 为每个 port 生成 `spy/Spy{PortType}.ets`（若已存在则复用）
2. 为该 UseCase 生成 `{useCaseId}.test.ets`，每个 branch 一个 `it()`
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

### Step 5：质量门禁自检（v2）

```
[ ] 1.  use-cases.yaml 存在并通过 Schema 校验（含 ports.ownership / branches.linked_acceptance）
[ ] 2.  UseCase 源文件无 UI/Nav/Toast 依赖（usecase_class_pure）
[ ] 3.  DAG 合规：顶层声明 use_case + branches[]，节点类型来自 v2 枚举
[ ] 4.  DAG 分工：同 UseCase 所有 DAG 的 branches[] 交集为空、并集覆盖所有非 device_only 分支
[ ] 5.  UT 文件 import 白名单：仅 @ohos/hypium / 被测 UseCase / data/model / spy/
[ ] 6.  SpyPort 完备：每个 port 都有对应 SpyXxx 并通过构造器注入
[ ] 7.  it() 命名：每条 it() 以 [AC-X] 或 [BRANCH-X] 起始
[ ] 8.  it() 驱动力：每条 it() ≥2 次 callLog 断言 + ≥2 次 state 断言
[ ] 9.  AC 覆盖（单元层）：ut_layer in [unit, both] 且 P0/P1 的 AC 100% 对应 it()
[ ] 10. 分支覆盖：use-cases.yaml 中每个非 device_only 分支都有对应 it()
[ ] 11. device-testing-todo.md：每条 ut_layer in [device, both] 的 AC 都已登记
[ ] 12. 测试注册：所有 UT 文件在 List.test.ets 中注册
[ ] 13. 用例独立性：beforeEach 中重建 Spy 与 UseCase
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

### Step 8：Harness 验证门禁

UT 交付后，引导用户执行 Harness 验证以确保 UT 质量达标。

#### 8.1 脚本 Harness（确定性检查）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase ut --feature {feature}
```

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/ut-rules.yaml`
- `doc/features/{feature}/use-cases.yaml`（v2 新增）
- `doc/features/{feature}/contracts.yaml`
- `doc/features/{feature}/acceptance.yaml`

**v2 新增检查覆盖项**：

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| usecase_spec_exists | use-cases.yaml 是否存在（需要时） | BLOCKER |
| usecase_spec_schema | Schema 合规 | BLOCKER |
| usecase_class_pure | UseCase 源文件无 UI/Nav/Toast 依赖 | BLOCKER |
| usecase_class_exists | UseCase 源文件与 class 存在 | BLOCKER |
| dag_linked_usecase | DAG 正确指向 use-cases.yaml | BLOCKER |
| dag_node_type_valid | 节点类型 in v2 枚举集 | BLOCKER |
| no_ui_dep_in_ut | UT 文件无 UI/Nav/Toast 依赖 | BLOCKER |
| ports_all_stubbed | 每个 port 都有 Spy 注入 | BLOCKER |
| it_name_has_ac_or_branch_tag | 用例名带 [AC-X] / [BRANCH-X] 标签 | BLOCKER |
| it_drives_flow | 每个 it() ≥2 port + ≥2 state 断言 | MAJOR |
| branch_coverage_full | 每个 branch 都有对应 it() | BLOCKER |
| ut_case_per_unit_ac | 每条 unit/both 的 P0/P1 AC 都有 it() | BLOCKER |
| acceptance_coverage | 分母只计 ut_layer ∈ {unit, both} | BLOCKER |
| boundary_coverage | 每条 unit/both 的 BD 都有覆盖 | MAJOR |

**若报告中存在 BLOCKER**：必须修正（回到 Step 2 / 3），直到零 BLOCKER。

#### 8.2 AI Harness（语义级检查）

- **Prompt 模板**：`framework/harness/prompts/verify-ut.md`
- **v2 新增语义检查**：
  1. `state_model_completeness` — state_model 是否足以表达所有分支
  2. `port_abstraction_quality` — port 抽象粒度是否合理（不把 UI 当 port、云/本地分离）
  3. `end_to_end_driving` — 每个 it() 是否端到端驱动（trigger + callLog + state 多断言）
  4. `branch_coverage_semantic` — branches 是否涵盖 PRD 中所有异常路径
  5. `device_ac_delegation` — device/both 的 AC 是否都在 device-testing-todo.md 中
  6. `mock_reasonableness` — Spy 预设值是否与 data/model 一致
  7. `test_isolation` — beforeEach 是否重建 Spy/UseCase

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 8.3 验证完成标志

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER |
| AI Harness | verdict = PASS（无 BLOCKER 级 FAIL） |

验证全部通过后，业务级 UT 阶段完成，可进入 Skill 6（真机测试）。

## 关联文件

- 上游输入:
  - `doc/features/{feature}/use-cases.yaml`（Skill 2 v2 产出）
  - UseCase 源代码（Skill 3 v2 产出 of `domain/usecase/*.ets`）
  - `doc/features/{feature}/design.md` / `PRD.md` / `contracts.yaml` / `acceptance.yaml`
- 阶段级规约: `framework/specs/phase-rules/ut-rules.yaml`
- UseCase Schema: [templates/use-cases-schema.md](templates/use-cases-schema.md)
- DAG Schema: [templates/dag-schema.md](templates/dag-schema.md)
- UT / SpyPort 模板: [templates/ut-template.md](templates/ut-template.md)
- 打桩策略: [templates/mock-strategy.md](templates/mock-strategy.md)
- 规范级样例: [examples/card-opening/](examples/card-opening/)
- 脚本 Harness: `framework/harness/scripts/check-ut.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-ut.md`
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **Skill 6 (真机测试)** | `device-testing-todo.md` + UT 代码 + DAG | 真机测试计划与追溯 |
| **Harness (验证层)** | use-cases.yaml + DAG + UT | 脚本/AI 验证 UT 质量 |
| **开发者** | DAG + UseCase 源码 | 理解业务流程，维护 UT |

## 约束与注意事项

1. **UseCase 先行**：若 feature 涉及多步骤业务流程，必须先有 `use-cases.yaml`；否则回到 Skill 2 补齐
2. **分支 1:1 映射**：`use-cases.yaml > branches[]` ↔ DAG branches ↔ UT `it()` 三者严格 1:1（允许 1 个 DAG 覆盖多个 branch，但总并集需覆盖全部）
3. **AC 分层**：只测 `ut_layer in [unit, both]` 的 AC/BD；`device` 的 AC 必须在 `device-testing-todo.md` 中登记，绝不在 UT 里"硬凑"覆盖
4. **Mock 不真调**：UT 中严禁发起真实网络请求、真实系统 API 调用或真实 IO 操作
5. **用例隔离**：每个 `it()` 用例独立运行，在 `beforeEach` 中重建 `Spy + UseCase`
6. **类型安全 Spy**：SpyPort 必须实现对应接口，与 `contracts.yaml` 签名一致
7. **无 UI import 强约束**：UT 中禁止出现 `@Component` / `NavPathStack` / `showToast` / `$r` / `@kit.ArkUI` 等
8. **P0 优先**：先为 P0 AC / 高危 branch 生成 UT，再扩展 P1 / P2
9. **中文注释**：DAG / UseCase / UT 的 description 使用中文，便于业务理解
10. **Harness 验证闭环**：UT 完成后必须引导用户运行 Harness 验证（Step 8），确保零 BLOCKER 后才进入下一阶段
11. **不修改业务源码**：生成 UT 时不应修改 Skill 3 产出的业务代码。若发现代码无法测试（如 UseCase 内嵌 UI 依赖），应记录在交付摘要中反馈 Skill 3

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
