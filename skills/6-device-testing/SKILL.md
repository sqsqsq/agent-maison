# 真机测试 Skill (`6-device-testing`)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

### Feature 归档定位协议（本阶段是消费者）

进入本 Skill 后，必须先基于 `framework.config.json > paths.features_dir` 精确定位 `doc/features/<feature>/`。本步骤只依赖用户给出的 feature 名与文件系统状态，不依赖 `.current-phase.json`、历史 reports、trace 或上一阶段缓存。

- 只有精确目录 `doc/features/<feature>/` 是正式 feature；同级 `<feature>.rar` / `<feature>.zip` / `<feature>.7z` / `<feature>.tar*` 以及 `<feature>-old/`、`<feature>.md` 等同名前缀条目都只是旁证。
- 若精确目录不存在，必须快速失败并提示用户先创建/恢复正式 feature 目录；不得自动解压归档，不得读取归档内容补齐上下文。
- 若目录存在但本阶段输入缺失（至少 `PRD.md`、`design.md`、`acceptance.yaml`；`device-testing-todo.md` 按下文兼容规则处理）：报告缺失文件并回到上游阶段补齐；不得把同名归档当作上游产物。
- 继续执行前，向用户展示本阶段输入矩阵：`device-testing-todo.md` / `PRD.md` / `design.md` / `acceptance.yaml` / `contracts.yaml(可选)` / `use-cases.yaml(可选)` 存在/缺失，旁证归档/同名前缀条目如实列出但明确忽略。

## Step 0. 载入 `project_profile` addendum（强制）

继续下文前，完整阅读：

`framework/profiles/<project_profile.name>/skills/6-device-testing/profile-addendum.md`

其中 `<project_profile.name>` 取自 `framework.config.json > project_profile.name`（未声明时由 harness 按仓库指纹回落默认 profile，见 init Skill Step 1.5）。若该文件不存在，则仅依赖本 SKILL 正文 + 对应 profile 下模板/示例路径。

> **动态资产引用**：正文中的 `` `profile-skill-asset:<skill>/<asset_key>` `` 须按 [Profile skill asset protocol](../README.md#profile-skill-asset-protocol) 解析。

---

## 概述

你是一位按当前 `project_profile` 自适配的设备/系统测试工程师，擅长制定系统化的测试计划并生成结构化的测试报告。你的任务是基于 PRD 验收标准和 Spec 契约，生成覆盖完整的测试计划，并在测试执行后产出标准化测试报告。

本 Skill 是项目全生命周期流水线的**第六环**（最终环）。上游输入来自 Skill 5（业务级 UT）的 DAG 和 UT 代码，输出（测试计划 + 测试报告）是功能模块质量交付的最终把关。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "真机测试"、"设备测试"、"测试计划"
- "写测试报告"、"生成测试报告"
- "系统测试"、"功能测试"、"验收测试"
- "测试方案"、"编写测试用例"

## 核心理念

**消费 Skill 5 的 `device-testing-todo.md` + 基于验收标准生成测试计划 → 人工/真机执行测试 → 生成结构化报告 → Harness 验证闭环**

业务级 UT（Skill 5）验证的是 UseCase / state / port 的业务逻辑正确性；真机测试验证的是**端到端用户体验**。
v2 起，AC/BD 层面已显式分层为 `ut_layer ∈ {unit, device, both}`：

- **`ut_layer = unit`**：UT 已充分覆盖，本 Skill 不再重复测试（除非 both）
- **`ut_layer = device`**：UT 不覆盖，**必须**由本 Skill 真机覆盖
- **`ut_layer = both`**：UT 覆盖业务侧（state/port/数据），本 Skill 补做 UI 侧（Toast / 跳转 / 渲染 / 用户交互）

Skill 5 会产出一份 `doc/features/{module}/device-testing-todo.md`，把所有 `device / both` AC/BD 逐条列出、标注 UT 已覆盖的部分与真机需补验的部分。**本 Skill 必须消费这份 todo**，作为测试用例的首要派生来源。

- 测试用例优先从 `device-testing-todo.md` 派生，其次从 `acceptance.yaml` 中剩余的 `device / both` AC/BD 派生
- 测试步骤面向真人操作者，描述具体的 UI 交互路径
- 测试报告包含每条用例的执行结果、缺陷记录和通过率统计

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能模块名 | ✅ | 待测试的功能模块名（如 `home-page`），用于定位文件 |
| **device-testing-todo.md** | ✅（v2） | Skill 5 产出的真机测试待办，路径 `doc/features/{module}/device-testing-todo.md`，**测试用例的首要派生来源** |
| PRD.md | ✅ | 产品需求文档，路径 `doc/features/{module}/PRD.md` |
| design.md | ✅ | 技术设计文档，路径 `doc/features/{module}/design.md` |
| acceptance.yaml | ✅ | 验收标准 Spec，路径 `doc/features/{module}/acceptance.yaml`，用于补充 device/both AC/BD |
| use-cases.yaml | ⬜（v2） | UseCase 规范，路径 `doc/features/{module}/use-cases.yaml`，了解 UT 已覆盖的分支 |
| contracts.yaml | ⬜ | 接口契约 Spec，路径 `doc/features/{module}/contracts.yaml`，用于理解模块边界 |
| doc/architecture.md | ⬜ | 项目模块架构，了解测试涉及的模块范围 |
| review-report.md | ⬜ | 可选，确认代码已通过 Review 无 BLOCKER |

**若缺少 `device-testing-todo.md`**：如果 `acceptance.yaml` 中存在 `ut_layer ∈ {device, both}` 的 AC/BD，说明 Skill 5 还未按 v2 输出待办清单，提示用户补做 Skill 5 的 Step 6。若 acceptance.yaml 完全没有 device/both 标注，则按老流程从 acceptance.yaml 直接派生用例（兼容模式）。

**若缺少 acceptance.yaml**：提示用户先运行 Skill 1 提取验收标准。测试用例必须追溯到 AC/BD 编号。

## 工作流程

### Step 1: 收集测试上下文

1. 向用户确认待测试的功能模块名 `{module-name}`
2. 读取以下文件：
   - **`doc/features/{module}/device-testing-todo.md`** — ★ v2 首要来源（来自 Skill 5 Step 6）
   - `doc/features/{module}/PRD.md` — 需求基准（业务流程、异常场景）
   - `doc/features/{module}/design.md` — 技术设计（页面组件树、导航设计）
   - `doc/features/{module}/acceptance.yaml` — 验收标准，按 `ut_layer` 过滤出本 Skill 需要关注的项
   - `doc/features/{module}/use-cases.yaml` — 若存在，了解 UT 已覆盖的 branch（避免重复测业务逻辑）
   - `doc/features/{module}/contracts.yaml` — 接口契约（若存在）
   - `doc/architecture.md` — 架构全貌（若存在）
3. 按 `ut_layer` 统计本 Skill 的测试范围，向用户展示：

```
📋 测试范围确认（v2 · ut_layer 过滤后）：
  模块名称: {module-name}
  device-testing-todo.md: 存在/缺失
  device AC: N 条（仅真机覆盖）
  both AC:   N 条（UT + 真机共同覆盖，本 Skill 关注 UI 侧）
  unit AC:   N 条（已由 UT 覆盖，本 Skill 不重复）
  边界场景（device/both）: N 条
  非功能性需求: N 条（性能指标等）
  测试基准: device-testing-todo.md + acceptance.yaml（filter ut_layer∈{device,both}）
```

### Step 1.5: 打包与装机（profile capability）

在进入生成测试计划（Step 2）之前，若当前 `project_profile`（见 `framework.config.json > project_profile`）将 **`device_test.build` / `device_test.install`** 声明为 **BLOCKER**，你必须与用户对齐「能在真机上跑的同一套包」：

1. **读取宿主指南**：完整阅读  
   `framework/profiles/<project_profile.name>/skills/6-device-testing/profile-addendum.md`，其中的宿主 toolchain、环境与 harness 变量以 **单一宿主附录为 SSOT**；根 SKILL 不复述宿主专有名词。
2. **与用户确认打包维度（必选语义）**  
   - **product**：枚举宿主工程中可用的制品维度（附录列出如何用宿主 tooling 读取 **`products`** 清单）；默认应与宿主侧的 **`preferredProduct`/`detectProduct` 语义**一致（仍为宿主附录用语）。  
   - **buildMode**：宿主侧的 **`debug`（默认）** 或 **`release`**；需在会话或环境里记下所选组合供 **`testing` harness** 复现。附录 **`testing-build-conventions.ts`** 说明可用的 **`HARNESS_DEVICE_TEST_*`** 变量。
3. **执行链路（中性措辞）：** 经由 **`capability-registry`** → **`dispatchDeviceTestBuild`** 产出 signed 应用程序包；再 **`dispatchDeviceTestInstall`** 触发设备安装步骤（宿主附录写明等价 CLI）。宿主实现在 **`profiles/<name>/harness/providers/device-test-build.ts`** 与 **`device-test-install.ts`**；日志与结构化摘要的约定文件名见宿主 **`profile-addendum`**（同一 **`reports/<feature>/testing/`** 目录下）。
4. **与文档门禁的顺序**：本仓储 **`testing` 脚本 harness** 会在校验 Markdown 计划/报告之前尝试 **`device_test.build` → `device_test.install`**（profile **SKIP** 则整条 SKIP）。可先撰写文档再由 harness 触发包链路；若 BLOCKER 失败，须先修复宿主 toolchain / 设备再继续闭环。
5. **外部自动化**：Framework 负责「包已在设备上」之前的宿主门禁；后续第三方自动化/UI+Mock 不负责替代宿主打包（单向衔接）。

### Step 2: 生成测试计划

读取测试计划模板：

```
framework/profiles/<project_profile.name>/skills/6-device-testing/templates/test-plan-template.md
```

按模板结构填充内容，**必须包含以下 6 个章节**：

1. **测试范围** — 本次测试涉及的功能模块、页面、业务流程
2. **测试环境** — 设备型号/模拟器、系统版本、API 版本、特殊配置
3. **测试用例清单** — Markdown 表格，每条含：用例编号、用例名称、前置条件、测试步骤、预期结果、优先级、关联 AC
4. **测试策略** — 测试方法、用例执行顺序、回归策略
5. **通过标准** — 量化的通过条件（如 P0 用例 100% 通过）
6. **风险与依赖** — 已知风险、测试依赖、环境限制

#### 2.1 测试用例生成规则（v2 · ut_layer 感知）

**优先级 1：从 `device-testing-todo.md` 派生**（v2 新增 · 首要来源）

Skill 5 产出的 `device-testing-todo.md` 已经为每条 `device / both` AC/BD 整理了：

- UT 已经验证的业务语义（state / port 调用 / 数据）
- 真机侧需要补验的 UI 层要点（Toast 文案、NavPathStack.push 目标、按钮禁用态、转场动画、输入焦点等）

**派生规则**：

- 每条 device AC → 至少 1 条测试用例（优先级承袭 AC）
- 每条 both AC → 至少 1 条测试用例，**关注点限定为 UI 层**（业务逻辑已由 UT 覆盖，真机不重复断言数据）
- `device-testing-todo.md` 里的 checklist 子项可以合并为 1 条 TC 的多个测试步骤

**优先级 2：从 `acceptance.yaml` 过滤派生**（兜底）

当 todo 中缺失或 acceptance.yaml 存在 device/both AC 但 todo 未登记时，按如下规则派生：

| acceptance.yaml 来源（filter `ut_layer ∈ {device, both}`） | 用例生成规则 | 用例优先级 |
|-----------------------------------------------------------|------------|----------|
| `criteria` (P0) | 每条 AC 至少生成 1 条测试用例 | P0 |
| `criteria` (P1) | 每条 AC 至少生成 1 条测试用例 | P1 |
| `criteria` (P2) | 可选，按资源决定 | P2 |
| `boundaries` | 每个边界场景至少 1 条测试用例 | 与原 BD 优先级一致 |
| `performance` | 每个性能指标 1 条验证用例 | P1 |

**不再生成**：`ut_layer = unit` 的 AC 不出现在真机测试计划中，避免与 UT 重复。

**用例编号格式**: `TC-{NNN}`，从 TC-001 开始递增

**测试步骤要求**：
- 每步操作必须明确（"点击首页底部 Tab 栏的第一个图标"而非"打开首页"）
- 包含具体的输入数据（若有）
- 操作顺序无歧义，任何人都能按步骤重复执行

**预期结果要求**：
- 必须是可观察、可验证的（"列表展示 3 条数据项，每条显示标题与可量化数值字段"而非"正常显示"）
- 关联 UI 元素的具体状态变化
- 对 `both` AC，聚焦 UI 侧可观察点（Toast 文案、页面跳转、UI 状态），不重复断言 UT 已验证的 state/port

**追溯字段（v2 新增）**：

每条用例的"关联 AC"字段除了 AC/BD id，还应记录：

- `linked_flow` + `linked_branch`（若 AC 来自 `use-cases.yaml` 的某个分支）
- `ut_layer`（`device` / `both`，用于追溯本用例的分工出处）

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
framework/profiles/<project_profile.name>/skills/6-device-testing/templates/test-report-template.md
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
[ ] 4. device-testing-todo.md 消费（v2）：todo 中每一条真机待办是否至少生成 1 条 TC？
[ ] 5. device/both AC 覆盖：acceptance.yaml 中 ut_layer ∈ {device, both} 的 P0/P1 AC 是否 100% 被 TC 覆盖？
[ ] 6. 不重复：ut_layer = unit 的 AC 是否已从本计划中剔除（避免与 UT 重复）？
[ ] 7. 测试步骤：每条用例步骤是否足够详细（可重复执行）？
[ ] 8. 预期结果：是否可观察、可验证（无模糊描述）？
[ ] 9. 测试环境：是否包含设备、系统版本、API 版本？
[ ] 10. 通过标准：是否包含量化阈值？
[ ] 11. 元数据：顶部是否包含模块标识、版本、日期？
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

### Step 7: Harness 验证门禁（agent 必须自跑）

> **全局入口 §4.1 明示授权**：本步骤的 harness 与 verifier 调用都由主 agent 自己执行，
> **严禁**仅"告知用户可运行"然后结束对话——属软幻觉，由物理拦截层兜底。

测试文档归档后，agent **必须自己**完成下列验证，再宣布真机测试阶段完成。

#### 7.1 脚本 Harness（确定性检查，agent 通过 Shell 工具自跑）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase testing --feature {module-name} --summary --failures-only
```

agent 执行后必须 Read 退出码与报告文件；BLOCKER 必须修复后重跑。
优先读取 `framework/harness/reports/<feature>/testing/summary.json`；其中 `testing_run_status` 的 `can_claim_done` 必须为 `YES`，否则不能宣称真机测试阶段完成。

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/testing-rules.yaml` — 阶段级通用规则
- `doc/features/{module-name}/acceptance.yaml` — 功能级验收标准（追溯检查）

**脚本检查覆盖项**：

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| 真机构包（可选宿主 BLOCKER） | profile `device_test.build`：宿主门禁产出 signed 应用包 | BLOCKER / SKIP |
| 真机装机（可选宿主 BLOCKER） | profile `device_test.install`：将上一步包安装到已连接设备 | BLOCKER / SKIP |
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

agent 必须主动通过 Task 工具调用 `subagent_type: verifier`（不是"告诉用户去跑"），把 feature / phase / 脚本报告路径传入：

- **Prompt 模板**：`framework/harness/prompts/verify-testing.md`（由 verifier 子 agent 自行读取）
- **触发方式**：Task 工具，subagent_type=verifier，prompt 中给出 feature/phase/脚本报告路径
- **语义检查覆盖项**：
  1. 测试用例完整性 — 是否覆盖所有核心业务路径（正常 + 异常）
  2. 测试步骤可重复性 — 步骤是否足够详细，任何人可按步骤执行
  3. 预期结果具体性 — 是否可观察、可验证
  4. NFR 测试覆盖 — PRD 非功能性需求是否有测试方案
  5. 缺陷严重程度一致性 — 缺陷评级是否与影响匹配
  6. 通过标准与结论一致性 — 结论是否与数据匹配

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 7.3 阶段闭环判定（全局入口 §5.1 节 SSOT，四条件缺一不可）

> 下文「物理拦截层」：**部分 adapter** 经 Skill 00 在实例根下发 **Stop hook**，在消息结束前读取 state 并阻断「假完成」（Layer 3 行为与路径见 [framework/agents/README.md](../../agents/README.md)）。**未**配置该能力的 adapter 不设物理层豁免，仍须满足 Layer 1（全局入口 §6.5「反假设条款」）+ Layer 2（完成回执 + `check-receipt.ts`）——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

真机测试阶段宣布"完成"前必须**同时**满足：

1. `framework/harness/reports/<feature>/testing/trace.json` 真实存在；
2. 脚本 harness 退出码 0、零 BLOCKER；
3. verifier 子 agent 报告 verdict = PASS；
4. 完成回执 `doc/features/<feature>/testing/phase-completion-receipt.md` 已填写并通过 `npx ts-node framework/harness/scripts/check-receipt.ts --feature <feature> --phase testing` 校验。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，真机测试阶段完成。物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。
若测试报告结论为"不达标"，开发者需修复代码后重新执行 Skill 3 → Skill 4 → Skill 5 → Skill 6。

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
  - **`doc/features/{module}/device-testing-todo.md`（Skill 5 v2 产出的真机待办清单，★首要来源）**
  - `doc/features/{module}/PRD.md`（Skill 1 输出）
  - `doc/features/{module}/design.md`（Skill 2 输出）
  - `doc/features/{module}/use-cases.yaml`（Skill 2 v2 输出，了解 UT 已覆盖分支）
  - 源代码（Skill 3 输出，可选参考）
  - UT 代码 + DAG（Skill 5 输出，可选参考）
  - `doc/features/{module}/acceptance.yaml`（Skill 1 产出的验收标准 Spec；按 ut_layer 过滤使用）
  - `doc/features/{module}/contracts.yaml`（Skill 2 产出的接口契约 Spec）
- 阶段级规约: `framework/specs/phase-rules/testing-rules.yaml`
- 脚本 Harness: `framework/harness/scripts/check-testing.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-testing.md`
- 测试计划模板: `` `profile-skill-asset:6-device-testing/test_plan_template` ``
- 测试报告模板: `` `profile-skill-asset:6-device-testing/test_report_template` ``
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **开发者** | test-report.md | 按缺陷清单修复代码 |
| **产品经理** | test-report.md | 确认功能验收达标 |
| **Harness (验证层)** | test-plan.md + test-report.md | 脚本/AI 验证文档质量 |

## 约束与注意事项

1. **AC 追溯强制**：每条测试用例必须关联到 acceptance.yaml 中的 AC/BD 编号（推荐同时标注 `ut_layer` 与 `linked_flow/linked_branch`），不允许存在无追溯的用例
2. **分层分工（v2）**：`ut_layer = unit` 的 AC/BD 由 UT 独家覆盖，**不要**出现在本 Skill 的测试计划中；`device / both` 才是本 Skill 的范围
3. **device-testing-todo.md 优先（v2）**：若 Skill 5 产出了 todo 清单，按 todo 派生测试用例；acceptance.yaml 作为兜底来源
4. **测试计划先行**：先生成测试计划并经用户确认，再根据执行结果生成测试报告
5. **步骤可重复**：测试步骤必须足够详细，让不了解系统的测试人员也能按步骤执行
6. **结果可验证**：预期结果必须是可观察的 UI 变化或可测量的数据，禁止"正常显示"等模糊描述
7. **模拟应用适配**：本项目为模拟应用，部分功能使用模拟数据——测试用例的预期结果应基于模拟数据的实际值，而非真实后端返回值
8. **双文档产出**：测试计划和测试报告是两个独立文档，分别在不同时间点产出（计划→执行→报告）
9. **中文输出**：测试计划和测试报告使用简体中文
10. **P0 优先**：若资源有限，优先覆盖 P0 AC 项，确保核心功能全部被测试
11. **Harness 验证闭环**：文档完成后 agent **必须自己运行** Harness 验证（Step 7），并主动通过 Task 工具触发 `subagent_type: verifier`；确保零 BLOCKER + verifier PASS + 完成回执通过校验后才认为测试阶段完成（物理拦截层兜底）
12. **不修改源码**：生成测试文档时不应修改任何业务代码或 UT 代码

---

## Slash / 快捷入口触发时的 trace 约定

当本 Skill 通过适配器下发的 slash（如 `/device-testing`）或其它等价快捷入口触发时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`framework/harness/reports/<feature>/<timestamp>/<model>-devtest/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `testing`。
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。
