# 真机测试 Skill (`6-device-testing`)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

## 概述

你是一位资深鸿蒙（HarmonyOS）测试工程师，擅长制定系统化的测试计划并生成结构化的测试报告。你的任务是基于 PRD 验收标准和 Spec 契约，生成覆盖完整的测试计划，并在测试执行后产出标准化测试报告。

本 Skill 是项目全生命周期流水线的**第六环**（最终环）。上游输入来自 Skill 5（业务级 UT）的 DAG 和 UT 代码，输出（测试计划 + 测试报告）是功能模块质量交付的最终把关。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "真机测试"、"设备测试"、"测试计划"
- "写测试报告"、"生成测试报告"
- "系统测试"、"功能测试"、"验收测试"
- "测试方案"、"编写测试用例"

## 核心理念

**基于验收标准生成测试计划 → 人工/真机执行测试 → 生成结构化报告 → Harness 验证闭环**

业务级 UT（Skill 5）验证的是代码逻辑正确性；真机测试验证的是**端到端用户体验**：
- 测试用例直接从 `acceptance.yaml` 的 AC/BD 项派生，确保 PRD 验收标准被测试覆盖
- 测试步骤面向真人操作者，描述具体的 UI 交互路径
- 测试报告包含每条用例的执行结果、缺陷记录和通过率统计

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能模块名 | ✅ | 待测试的功能模块名（如 `home-page`），用于定位文件 |
| PRD.md | ✅ | 产品需求文档，路径 `doc/features/{module}/PRD.md` |
| design.md | ✅ | 技术设计文档，路径 `doc/features/{module}/design.md` |
| acceptance.yaml | ✅ | 验收标准 Spec，路径 `specs/features/{module}/acceptance.yaml`，测试用例的直接来源 |
| contracts.yaml | ⬜ | 接口契约 Spec，路径 `specs/features/{module}/contracts.yaml`，用于理解模块边界 |
| doc/architecture.md | ⬜ | 项目模块架构，了解测试涉及的模块范围 |
| review-report.md | ⬜ | 可选，确认代码已通过 Review 无 BLOCKER |

**若缺少 acceptance.yaml**：提示用户先运行 Skill 1 提取验收标准。测试用例必须追溯到 AC/BD 编号。

## 工作流程

### Step 1: 收集测试上下文

1. 向用户确认待测试的功能模块名 `{module-name}`
2. 读取以下文件：
   - `doc/features/{module}/PRD.md` — 需求基准（业务流程、异常场景）
   - `doc/features/{module}/design.md` — 技术设计（页面组件树、导航设计）
   - `specs/features/{module}/acceptance.yaml` — 验收标准（AC 和 BD 是用例的直接来源）
   - `specs/features/{module}/contracts.yaml` — 接口契约（若存在）
   - `doc/architecture.md` — 架构全貌（若存在）
3. 向用户展示测试范围摘要：

```
📋 测试范围确认：
  模块名称: {module-name}
  P0 验收标准: N 条
  P1 验收标准: N 条
  边界场景: N 条
  非功能性需求: N 条（性能指标等）
  测试基准: acceptance.yaml + PRD.md
```

### Step 2: 生成测试计划

读取测试计划模板：

```
framework/skills/6-device-testing/templates/test-plan-template.md
```

按模板结构填充内容，**必须包含以下 6 个章节**：

1. **测试范围** — 本次测试涉及的功能模块、页面、业务流程
2. **测试环境** — 设备型号/模拟器、系统版本、API 版本、特殊配置
3. **测试用例清单** — Markdown 表格，每条含：用例编号、用例名称、前置条件、测试步骤、预期结果、优先级、关联 AC
4. **测试策略** — 测试方法、用例执行顺序、回归策略
5. **通过标准** — 量化的通过条件（如 P0 用例 100% 通过）
6. **风险与依赖** — 已知风险、测试依赖、环境限制

#### 2.1 测试用例生成规则

**从 acceptance.yaml 派生用例**：

| acceptance.yaml 来源 | 用例生成规则 | 用例优先级 |
|---------------------|------------|----------|
| `criteria` (P0) | 每条 AC 至少生成 1 条测试用例 | P0 |
| `criteria` (P1) | 每条 AC 至少生成 1 条测试用例 | P1 |
| `criteria` (P2) | 可选，按资源决定 | P2 |
| `boundaries` | 每个边界场景至少 1 条测试用例 | 与原 BD 优先级一致 |
| `performance` | 每个性能指标 1 条验证用例 | P1 |

**用例编号格式**: `TC-{NNN}`，从 TC-001 开始递增

**测试步骤要求**：
- 每步操作必须明确（"点击首页底部 Tab 栏的第一个图标"而非"打开首页"）
- 包含具体的输入数据（若有）
- 操作顺序无歧义，任何人都能按步骤重复执行

**预期结果要求**：
- 必须是可观察、可验证的（"卡片列表展示 3 张卡片，每张显示卡名和余额"而非"正常显示"）
- 关联 UI 元素的具体状态变化

### Step 3: 用户确认测试计划

1. 展示完整的测试计划给用户
2. 等待用户确认或反馈修改意见
3. 若需修改，调整后重新展示

### Step 4: 归档测试计划

用户确认后，将测试计划保存到：

```
doc/features/{module-name}/test-plan.md
```

### Step 5: 生成测试报告（测试执行后）

当用户完成真机测试并提供执行结果后，读取测试报告模板：

```
framework/skills/6-device-testing/templates/test-report-template.md
```

按模板结构填充内容，**必须包含以下 5 个章节**：

1. **测试概览** — 测试日期、环境、执行人、用例总数
2. **测试执行结果** — 每条用例的执行状态表（通过/失败/阻塞/跳过）
3. **缺陷清单** — 如有失败用例：缺陷编号、关联用例、严重程度、描述、状态
4. **通过率统计** — 各优先级通过率 + 总体通过率
5. **结论** — 明确判定：达标 / 有条件达标 / 不达标

**执行状态值域**: 通过 / 失败 / 阻塞 / 跳过

**缺陷严重程度**: BLOCKER / MAJOR / MINOR

**缺陷状态值域**: 待修复 / 已修复 / 已关闭 / 延期处理

**结论判定规则**：

| 条件 | 结论 |
|------|------|
| P0 通过率 = 100% 且总体通过率 ≥ 通过标准阈值 | 达标 |
| P0 通过率 = 100% 但总体通过率 < 阈值 | 有条件达标 |
| P0 通过率 < 100% | 不达标 |

### Step 6: 质量门禁自检

生成测试计划和测试报告后，分别执行自检清单。

**测试计划自检**：

```
[ ] 1. 必需章节：测试范围、测试环境、测试用例清单、测试策略、通过标准、风险与依赖是否齐全？
[ ] 2. 用例清单格式：表头是否包含编号、名称、前置条件、测试步骤、预期结果、优先级、关联 AC？
[ ] 3. 优先级值域：是否仅使用 P0/P1/P2/P3？
[ ] 4. AC 覆盖：P0/P1 的 AC 项是否全部被至少一条测试用例覆盖？
[ ] 5. BD 覆盖：边界场景是否有对应测试用例？
[ ] 6. 测试步骤：每条用例步骤是否足够详细（可重复执行）？
[ ] 7. 预期结果：是否可观察、可验证（无模糊描述）？
[ ] 8. 测试环境：是否包含设备、系统版本、API 版本？
[ ] 9. 通过标准：是否包含量化阈值？
[ ] 10. 元数据：顶部是否包含模块标识、版本、日期？
```

**测试报告自检**：

```
[ ] 1. 必需章节：测试概览、测试执行结果、通过率统计、结论是否齐全？
[ ] 2. 执行结果表格：是否包含用例编号和执行状态？
[ ] 3. 状态值域：是否仅使用通过/失败/阻塞/跳过？
[ ] 4. 通过率计算：各优先级通过率和总体通过率是否正确？
[ ] 5. 结论一致性：结论是否与通过率数据匹配？
[ ] 6. 缺陷清单：失败用例是否都有对应的缺陷记录？
[ ] 7. 缺陷关联：缺陷的关联用例编号是否在用例清单中存在？
[ ] 8. 用例一致性：报告中的用例编号是否与计划中一一对应？
```

**不通过项**：定位具体问题，自动修正后重新自检，直到全部通过。

### Step 7: Harness 验证门禁

测试文档归档后，引导用户执行 Harness 验证以确保文档质量达标。

#### 7.1 脚本 Harness（确定性检查）

告知用户可运行脚本 Harness 检查文档结构合规性：

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase testing --feature {module-name}
```

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/testing-rules.yaml` — 阶段级通用规则
- `specs/features/{module-name}/acceptance.yaml` — 功能级验收标准（追溯检查）

**脚本检查覆盖项**：

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| 测试计划必需章节 | 测试范围、测试环境、测试用例清单、测试策略、通过标准、风险与依赖 | BLOCKER |
| 用例清单表格格式 | 表头是否包含编号、名称、前置条件、测试步骤、预期结果、优先级、关联 AC | BLOCKER |
| 用例优先级值域 | 是否仅使用 P0/P1/P2/P3 | MAJOR |
| 测试环境定义 | 是否包含设备、系统版本、API 版本 | MAJOR |
| 通过标准定义 | 是否包含量化阈值 | BLOCKER |
| AC 追溯覆盖 | P0/P1 AC 是否全部被测试用例覆盖 | BLOCKER |
| BD 追溯覆盖 | 边界场景是否被覆盖 | MAJOR |
| 报告必需章节 | 测试概览、测试执行结果、通过率统计、结论 | BLOCKER |
| 执行结果表格 | 状态值是否合法 | BLOCKER |
| 通过率统计 | 是否包含各优先级通过率 | BLOCKER |
| 结论一致性 | 结论是否与通过率匹配 | BLOCKER |
| 计划-报告一致性 | 报告用例编号是否与计划一致 | BLOCKER |

**若存在 BLOCKER**：必须修正文档后重新运行。

#### 7.2 AI Harness（语义级检查）

告知用户可使用 AI Harness 进行语义级深度验证：

- **Prompt 模板**：`framework/harness/prompts/verify-testing.md`
- **使用方式**：将 prompt 中的占位符替换为实际内容后，发送给独立 AI 模型执行审查
- **语义检查覆盖项**：
  1. 测试用例完整性 — 是否覆盖所有核心业务路径（正常 + 异常）
  2. 测试步骤可重复性 — 步骤是否足够详细，任何人可按步骤执行
  3. 预期结果具体性 — 是否可观察、可验证
  4. NFR 测试覆盖 — PRD 非功能性需求是否有测试方案
  5. 缺陷严重程度一致性 — 缺陷评级是否与影响匹配
  6. 通过标准与结论一致性 — 结论是否与数据匹配

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 7.3 验证完成标志

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER |
| AI Harness | verdict = PASS（无 BLOCKER 级 FAIL） |

验证全部通过后，真机测试阶段完成。若测试报告结论为"不达标"，开发者需修复代码后重新执行 Skill 3 → Skill 4 → Skill 5 → Skill 6。

## 输出规范

### 文件路径

| 产出 | 路径 |
|------|------|
| 测试计划 | `doc/features/{module-name}/test-plan.md` |
| 测试报告 | `doc/features/{module-name}/test-report.md` |

### 文档格式
- 使用 Markdown 格式
- 用例清单和执行结果使用表格
- 元数据使用 blockquote 格式

### 用例编号格式
- `TC-{NNN}`，从 TC-001 开始递增

### 缺陷编号格式
- `DEF-{NNN}`，从 DEF-001 开始递增

## 关联文件

- 上游输入:
  - `doc/features/{module}/PRD.md`（Skill 1 输出）
  - `doc/features/{module}/design.md`（Skill 2 输出）
  - 源代码（Skill 3 输出，可选参考）
  - UT 代码 + DAG（Skill 5 输出，可选参考）
  - `specs/features/{module}/acceptance.yaml`（Skill 1 产出的验收标准 Spec）
  - `specs/features/{module}/contracts.yaml`（Skill 2 产出的接口契约 Spec）
- 阶段级规约: `framework/specs/phase-rules/testing-rules.yaml`
- 脚本 Harness: `framework/harness/scripts/check-testing.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-testing.md`
- 测试计划模板: [templates/test-plan-template.md](templates/test-plan-template.md)
- 测试报告模板: [templates/test-report-template.md](templates/test-report-template.md)
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **开发者** | test-report.md | 按缺陷清单修复代码 |
| **产品经理** | test-report.md | 确认功能验收达标 |
| **Harness (验证层)** | test-plan.md + test-report.md | 脚本/AI 验证文档质量 |

## 约束与注意事项

1. **AC 追溯强制**：每条测试用例必须关联到 acceptance.yaml 中的 AC/BD 编号，不允许存在无追溯的用例
2. **测试计划先行**：先生成测试计划并经用户确认，再根据执行结果生成测试报告
3. **步骤可重复**：测试步骤必须足够详细，让不了解系统的测试人员也能按步骤执行
4. **结果可验证**：预期结果必须是可观察的 UI 变化或可测量的数据，禁止"正常显示"等模糊描述
5. **模拟应用适配**：本项目为模拟应用，部分功能使用模拟数据——测试用例的预期结果应基于模拟数据的实际值，而非真实后端返回值
6. **双文档产出**：测试计划和测试报告是两个独立文档，分别在不同时间点产出（计划→执行→报告）
7. **中文输出**：测试计划和测试报告使用简体中文
8. **P0 优先**：若资源有限，优先覆盖 P0 AC 项，确保核心功能全部被测试
9. **Harness 验证闭环**：文档完成后必须引导用户运行 Harness 验证（Step 7），确保零 BLOCKER 后才认为测试阶段完成
10. **不修改源码**：生成测试文档时不应修改任何业务代码或 UT 代码

---

## Claude Code CLI 运行时约定

当本 Skill 通过 `/device-testing` slash command 在 Claude Code CLI（或等价运行时）下运行时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`framework/harness/reports/<feature>/<timestamp>/<model>-devtest/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `testing`。
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。
