# Code Review Skill (`4-code-review`)

> **用户确认 UX**：[user-confirmation-ux.md](../reference/user-confirmation-ux.md) · `review.module_name` / `review.report_save` / `review.ok_to_ut` / `phase.next_step`。

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

**Harness 运行时前置**：执行本 Skill 中任意 `harness-runner` / `npx ts-node harness-runner.ts` / `check-receipt.ts`（依赖 harness npm）前，须满足 [Host harness readiness · Tier_1](../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../reference/harness-cli-cwd.md)（harness 之后用 `cd framework/harness && npx ts-node scripts/check-receipt.ts`）。

**Personal setup（BLOCKER）**：跑 harness 前须 [personal-setup-gate](../reference/personal-setup-gate.md)：`check-personal-setup.ts --json --ensure`；仅解析 JSON。

### Feature 归档定位协议（本阶段是消费者）

进入本 Skill 后，必须先基于 `framework.config.json > paths.features_dir` 精确定位 `doc/features/<feature>/`。本步骤只依赖用户给出的 feature 名与文件系统状态，不依赖 `.current-phase.json`、历史 reports、trace 或上一阶段缓存。

**跨会话 Resume Gate（BLOCKER，AGENTS §5.2）**：若 receipt 可能已存在，须**先**自跑 `check-receipt.ts`（或 `harness-runner --sync-closure`）。exit 0 → 该 phase 已闭环，**停等 `phase.next_step`**，禁止仅凭 stale state/summary 判未闭环或重跑本阶段。

- 只有精确目录 `doc/features/<feature>/` 是正式 feature；同级 `<feature>.rar` / `<feature>.zip` / `<feature>.7z` / `<feature>.tar*` 以及 `<feature>-old/`、`<feature>.md` 等同名前缀条目都只是旁证。
- 若精确目录不存在，必须快速失败并提示用户先创建/恢复正式 feature 目录；不得自动解压归档，不得读取归档内容补齐上下文。
- 若目录存在但本阶段输入缺失（至少 `design.md`、`contracts.yaml`、`acceptance.yaml`）：报告缺失文件并回到上游阶段补齐；不得把同名归档当作上游产物。
- 继续执行前，向用户展示本阶段输入矩阵：`design.md` / `contracts.yaml` / `acceptance.yaml` / `PRD.md(可选)` 存在/缺失，旁证归档/同名前缀条目如实列出但明确忽略。

## Step 0. 载入 `project_profile` addendum（强制）

继续下文前，完整阅读：

`framework/profiles/<project_profile.name>/skills/4-code-review/profile-addendum.md`

其中 `<project_profile.name>` 取自 `framework.config.json > project_profile.name`（未声明时由 harness 按仓库指纹回落默认 profile，见 init Skill Step 1.5）。若该文件不存在，则仅依赖本 SKILL 正文 + 对应 profile 下模板/示例路径。

> **Agent 行为规约（BLOCKER）**：完整阅读 [`agent-behavioral-principles.md`](../reference/agent-behavioral-principles.md)。**Research Sub-Phase 完成前禁止执行 Step 2 审查清单。**

> **动态资产引用**：正文中的 `` `profile-skill-asset:<skill>/<asset_key>` `` 须按 [Profile skill asset protocol](../README.md#profile-skill-asset-protocol) 解析。

---

## 概述

你是一位按当前 `project_profile` 自适配的代码审查员，擅长基于宿主语言与编码规范做质量审查。你的任务是基于 Spec 契约和编码规范，对 Skill 3 产出的源代码进行系统化 Code Review，生成结构化的审查报告。

本 Skill 是项目全生命周期流水线的**第四环**。上游输入来自 Skill 3（编码）的源代码，审查报告将指导开发者修复问题；修复后**具备**进入 Skill 5（业务级 UT）的**资格**，默认仍须 **`review.ok_to_ut` / `phase.next_step`** 授权。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "代码审查"、"Code Review"、"CR"
- "审查代码"、"检查代码质量"、"代码走查"
- "Review 代码"、"生成审查报告"

**上游 coding 闭环 alone 不触发（BLOCKER）**：仅因 Skill 3 四件套 PASS、读完 `phase-completion-receipt.md` / trace、或 Skill 3 正文「可进入 Skill 4」**不得**激活本 Skill。须用户 **review 触发意图**、**batch 授权**（user-confirmation-ux §8.2）、或 **`coding.ok_to_review` / `phase.next_step`** 确认后再进入。

### 审查与改动权的硬边界（BLOCKER）

1. **只审不改（默认）**：用户仅表达「帮忙 Code Review」「出审查报告」「走查」「看看有没有问题」而未明示「按 CR 结论直接改代码 / 顺带修掉」时，**只产出结构化审查产物**（如 `review-report.md`）；**BLOCKER**：不得批量修改仓库中的**实现层产物**（定义见 Skill 2「设计与编码的会话内硬边界」）。
2. **代改须有授权**：若在审查同时要求修代码／改实现，用户须在指令中**明示**（同一条或可追溯的接续消息）；未经明示，至多给出建议与定位，不写补丁。
3. **与 Harness 顺位**：review 阶段的脚本 harness（见工作流程末段）不因「顺带修一点」而被跳过或后补；若以代改为目标，须在闭环中说明 touch 了哪些契约内文件并接受 `review`/后续 `coding` 相关规则复检。

## 核心审查维度

审查基于以下 Spec 规约和参考文档进行，确保审查标准统一、客观、可追溯：

| 审查维度 | 主要依据 | 严重级别 |
|----------|---------|---------|
| 架构合规性 | `doc/architecture.md` + `framework.config.json > architecture` | BLOCKER |
| 模块内四层分层 | `framework/specs/phase-rules/coding-rules.yaml` | BLOCKER |
| 接口一致性 | `doc/features/{module}/contracts.yaml` | BLOCKER |
| 文件完整性 | `doc/features/{module}/contracts.yaml` | BLOCKER |
| 资源引用完整性 | `framework/specs/phase-rules/coding-rules.yaml` | BLOCKER |
| 命名规范 | `framework/specs/phase-rules/coding-rules.yaml` | MAJOR |
| 硬编码字符串 | `framework/specs/phase-rules/coding-rules.yaml` | MAJOR |
| 异常处理 | `doc/features/{module}/acceptance.yaml` | MAJOR |
| 业务逻辑正确性 | `doc/features/{module}/design.md` | MAJOR |
| 数据所有权 | `framework/specs/phase-rules/coding-rules.yaml` | MAJOR |
| 模拟数据隔离 | `framework/specs/phase-rules/coding-rules.yaml` | MINOR |

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能模块名 | ✅ | 待审查的功能模块名（如 `home-page`），用于定位文件 |
| design.md | ✅ | 技术设计文档，路径 `doc/features/{module}/design.md` |
| contracts.yaml | ✅ | 接口契约 Spec，路径 `doc/features/{module}/contracts.yaml` |
| acceptance.yaml | ✅ | 验收标准 Spec，路径 `doc/features/{module}/acceptance.yaml` |
| coding-rules.yaml | ✅ | 编码阶段规约，路径 `framework/specs/phase-rules/coding-rules.yaml` |
| doc/architecture.md | ✅ | 项目模块架构的唯一事实来源 |
| 源代码 | ✅ | AI 自动读取 contracts.yaml files 列表中的所有文件 |
| PRD.md | ❌ | 可选，用于验证功能覆盖完整性 |

**若缺少 contracts.yaml**：提示用户先运行 Skill 2 或 Skill 3 确保 Spec 文件已生成。

**上下文缺失处理**：脚本 harness 会把缺失输入归类为 `review_context`：
- `missing_review_report`：本阶段应生成或补齐 `review-report.md`，然后重跑 harness。
- `missing_contracts`：回到 design 阶段补齐 `contracts.yaml`，不要让用户手工猜源码边界。
- `missing_acceptance`：回到 PRD 阶段提取 `acceptance.yaml`，不要跳过验收追溯。
- `missing_source_from_contracts`：先确认 coding 阶段是否完成；若 `contracts.files` 过期，回到 design/coding 同步契约。

review 阶段不执行宿主包管理器的**依赖安装命令**，也不使用 `HARNESS_DIFF_BASE_REF=working`；这些属于 coding/UT 的构建与 diff 自愈职责。

## 工作流程

### Step 1: 收集审查上下文

1. 向用户确认待审查的功能模块名 `{module-name}`（`review.module_name`：`1=确认` / `2=修改`）
2. 读取以下文件：
   - `doc/features/{module}/design.md` — 技术设计基准
   - `doc/features/{module}/PRD.md` — 需求基准（若存在）
   - `doc/architecture.md` — 架构全貌
   - `framework/specs/phase-rules/coding-rules.yaml` — 编码阶段规约
   - `doc/features/{module}/contracts.yaml` — 接口契约
   - `doc/features/{module}/acceptance.yaml` — 验收标准
3. 根据 `contracts.yaml > files` 列表，读取所有源代码文件
4. 向用户展示审查范围摘要：

```
📋 审查范围确认：
  模块名称: {module-name}
  涉及模块: [从 contracts.yaml modules 提取]
  源代码文件: N 个实现文件
  审查基准: coding-rules.yaml + contracts.yaml + acceptance.yaml
```

### Step 1.5: Research Sub-Phase（Context Exploration Gate · BLOCKER）

在**逐步执行审查清单（Step 2）之前**，必须完成本 Step。

1. **必读**：Step 1 列出的**全部待审源文件**（须 Read 每个文件）；`design.md`、`contracts.yaml`、`acceptance.yaml`、`coding-rules.yaml`。
2. **复合评分触发**：填写 frontmatter 变更信号；harness 评分 ≥ 60 或 L4 架构级变更时 MUST explore 子 agent；否则 sequential 须满足量化阈值。
3. 落盘 `doc/features/<feature>/review/context-exploration.md`，**`schema_version: "1.1.0"`**，`source_code_paths` 覆盖待审文件。

### Step 2: 系统化审查

按照审查检查清单逐维度执行审查。完整检查清单见 `framework/profiles/<project_profile.name>/skills/4-code-review/templates/review-checklist.md`，以下为核心审查流程：

#### 2.1 架构合规性审查（BLOCKER 级）

1. **外层依赖合规**：逐文件检查 import / 包依赖是否违反 `outer_layers[].can_depend_on` 与同层 `intra_layer_deps` 策略
2. **模块内分层**：验证 import 是否遵循宿主 profile 声明的内层顺序（常见：`shared→data→domain→presentation`，以 DSL 为准）
3. **文件完整性**：对照 `contracts.yaml > files` 检查每个文件是否存在
4. **资源引用完整性**：检查每个**宿主声明的资源引用调用**所引用的 key 是否在资源定义中存在（具体 API 见 profile addendum）

#### 2.2 接口一致性审查（BLOCKER 级）

1. **数据模型一致**：对比 `contracts.yaml > data_models` 和实际代码中的 class/interface 定义
   - 字段名、类型、是否必填是否一致
   - enum 值是否一致
2. **接口签名一致**：对比 `contracts.yaml > interfaces` 和实际代码中的方法实现
   - 方法名、参数（名称+类型）、返回类型、async 标记
3. **组件 Props 一致**：对比 `contracts.yaml > components` 和实际组件的装饰器声明
   - 宿主状态与参数绑定装饰器所声明的变量、事件回调（语法见 profile addendum）

#### 2.3 编码规范审查（MAJOR 级）

1. **命名规范**：模块名 PascalCase、组件 struct 名与文件名一致、资源 key snake_case
2. **硬编码字符串**：presentation 层是否存在未通过**宿主资源机制**引用的 UI 文本
3. **禁止 any 类型**：代码中是否存在 `: any`、`as any`、`<any>`
4. **async/await 模式**：是否存在 `.then()/.catch()` 回调链（排除 Promise.all 等）

#### 2.4 业务逻辑审查（MAJOR 级）

1. **异常处理完整性**：对照 `acceptance.yaml > boundaries` 检查每个异常场景是否有代码处理
2. **业务流程正确性**：对照 `design.md` 服务层接口和组件树，验证数据流转和状态管理
3. **PRD 验收标准覆盖**：对照 `acceptance.yaml > criteria` 的 P0/P1 项，验证代码是否有对应实现

#### 2.5 数据层审查（MAJOR/MINOR 级）

1. **数据所有权合规**：presentation 层是否绕过 Repository 直接操作数据源
2. **模拟数据隔离**：模拟数据是否封装在 data/repository 内部，上层是否与数据来源解耦

### Step 3: 生成审查报告

读取审查报告模板：

```
framework/skills/4-code-review/templates/review-report-template.md
```

按模板结构填充内容，**必须包含以下 6 个章节**：

1. **审查范围** — 审查涉及的模块列表和文件范围
2. **审查方法** — 本次审查使用的维度和基准文档
3. **问题清单** — Markdown 表格，每条含：编号、严重程度、分类、问题描述、涉及文件、修复建议
4. **问题统计** — 按严重程度（BLOCKER/MAJOR/MINOR/INFO）的计数汇总
5. **修复建议摘要** — 高优先级问题的汇总修复方案
6. **结论** — 明确的审查结论（通过/有条件通过/不通过）

**问题分类必须使用以下预定义类别**：

| 分类 | 说明 | 对应规约 |
|------|------|---------|
| 分层违规 | 模块内或模块间依赖方向违规 | coding-rules.yaml: layer_compliance / inter_module_dependency |
| 接口不一致 | 实际代码与 contracts.yaml 定义不一致 | coding-rules.yaml: interface_signature_consistency |
| 资源引用 | 宿主资源 key 缺失或资源文件缺失 | coding-rules.yaml: resource_integrity |
| 命名规范 | 文件名/组件名/资源 key 不符合命名约定 | coding-rules.yaml: naming_conventions |
| 硬编码 | presentation 层存在硬编码 UI 文本 | coding-rules.yaml: no_hardcoded_strings |
| 逻辑错误 | 业务逻辑实现与 design.md 不一致 | coding-rules.yaml: business_logic_correctness |
| 异常处理 | acceptance.yaml 边界场景未覆盖 | coding-rules.yaml: error_handling_completeness |
| 性能 | 列表未使用 LazyForEach 等性能问题 | 编码规范 |
| 安全 | 数据泄漏、权限缺失等安全问题 | 编码规范 |
| 其他 | 不属于以上分类的问题 | — |

**严重程度判定规则**：

| 级别 | 适用场景 |
|------|---------|
| BLOCKER | 架构分层违规、接口签名不一致、文件缺失、资源引用缺失 |
| MAJOR | 命名规范违规、硬编码字符串、异常处理缺失、逻辑错误 |
| MINOR | 模拟数据隔离不彻底、代码风格问题、注释不完善 |
| INFO | 改进建议、最佳实践推荐 |

**结论判定规则**：

| 条件 | 结论 |
|------|------|
| BLOCKER > 0 | 不通过 |
| BLOCKER = 0 且 MAJOR > 0 | 有条件通过 |
| BLOCKER = 0 且 MAJOR = 0 | 通过 |

### Step 4: 质量门禁自检

生成报告后，执行以下自检清单（逐项检查，不通过则自动修正）：

```
[ ] 1. 审查范围：是否明确列出了所有审查模块和文件？
[ ] 2. 问题清单格式：表格是否包含编号、严重程度、分类、问题描述、涉及文件、修复建议六列？
[ ] 3. 严重程度：是否全部使用 BLOCKER/MAJOR/MINOR/INFO 四级？
[ ] 4. 分类：是否全部使用预定义类别？
[ ] 5. 问题统计：各级别计数是否与问题清单一致？
[ ] 6. 修复建议：每条问题是否有具体可操作的修复建议（非"请修复"式模糊表述）？
[ ] 7. 结论一致性：结论是否与问题统计匹配（BLOCKER>0→不通过）？
[ ] 8. 涉及文件：问题清单中引用的文件路径是否真实存在？
[ ] 9. 问题准确性：每条问题是否有代码证据（文件路径 + 行号或关键代码片段）？
[ ] 10. 元数据：报告头部是否包含模块标识、审查日期、审查版本？
```

**不通过项**：定位具体问题，自动修正后重新自检，直到全部通过。

### Step 5: 输出与归档

1. 将审查报告展示给用户确认（`review.report_save`：`1=确认落盘` / `2=修改后再落盘`）
2. 用户确认后，将报告保存到项目文档目录：
   ```
   doc/features/{module-name}/review-report.md
   ```
3. 若用户要求修改，根据反馈调整后重新走 Step 4 自检

### Step 6: Harness 验证门禁（agent 必须自跑）

> **全局入口 §4.1 明示授权**：本步骤的 harness 与 verifier 调用都由主 agent 自己执行，
> **严禁**仅"告知用户可运行"然后结束对话——属软幻觉，由物理拦截层兜底。

审查报告归档后，agent **必须自己**完成下列验证，再宣布 Review 阶段完成。

#### 6.1 脚本 Harness（确定性检查，agent 通过 Shell 工具自跑）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase review --feature {module-name}
```

agent 执行后必须 Read 退出码与报告文件；BLOCKER 必须修复后重跑。

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/review-rules.yaml` — 阶段级通用规则（章节存在性、表格格式、严重程度值域等）

**脚本检查覆盖项**：

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| 必需章节 | 审查范围、审查方法、问题清单、问题统计、修复建议、结论是否存在 | BLOCKER |
| 问题清单表格 | 表头是否包含编号、严重程度、分类、问题描述、涉及文件、修复建议 | BLOCKER |
| 严重程度值域 | 是否仅使用 BLOCKER/MAJOR/MINOR/INFO | BLOCKER |
| 分类值域 | 是否仅使用预定义分类 | MAJOR |
| 问题统计 | 各级别计数是否与问题清单一致 | MAJOR |
| 结论一致性 | 结论是否与 BLOCKER 数量匹配 | BLOCKER |
| 元数据 | 报告头部是否有模块标识、审查日期、审查版本 | MINOR |
| 涉及文件存在性 | 问题清单中引用的文件路径是否真实存在 | BLOCKER |

**若报告中存在 BLOCKER**：必须修正报告（回到 Step 4），直到零 BLOCKER。

#### 6.2 AI Harness（语义级检查，agent 主动通过 Task 工具触发 verifier 子 agent）

agent 必须主动通过 Task 工具调用 `subagent_type: verifier`（不是"告诉用户去跑"），把 feature / phase / 脚本报告路径传入：

- **Prompt 模板**：`framework/harness/prompts/verify-review.md`（由 verifier 子 agent 自行读取）
- **触发方式**：Task 工具，subagent_type=verifier，prompt 中给出 feature/phase/脚本报告路径
- **语义检查覆盖项**：
  1. 审查维度覆盖度 — 是否涵盖所有关键维度
  2. 问题准确性（BLOCKER）— 引用的文件路径和代码位置是否真实
  3. 修复建议可操作性 — 是否包含具体修改文件/方法/步骤
  4. 误报率 — 是否存在代码实际正确但被标记为问题的情况
  5. BLOCKER 与结论一致性（BLOCKER）— BLOCKER>0 是否对应"不通过"
  6. 编码规则追溯 — 问题分类是否对应 coding-rules.yaml 中的规则

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 6.3 阶段闭环判定（全局入口 §5.1 节 SSOT，四条件缺一不可）

> 下文「物理拦截层」：**部分 adapter** 经 Skill 00 在实例根下发 **Stop hook**，在消息结束前读取 state 并阻断「假完成」（Layer 3 行为与路径见 [framework/agents/README.md](../../agents/README.md)）。**未**配置该能力的 adapter 不设物理层豁免，仍须满足 Layer 1（全局入口 §6.5「反假设条款」）+ Layer 2（完成回执 + `check-receipt.ts`）——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

Review 阶段宣布"完成"前必须**同时**满足：

1. `doc/features/<feature>/review/reports/trace.json` 真实存在；
2. 脚本 harness 退出码 0、零 BLOCKER；
3. verifier 子 agent 报告 verdict = PASS；
4. 完成回执 `doc/features/<feature>/review/phase-completion-receipt.md` 已填写并通过 `cd framework/harness && npx ts-node scripts/check-receipt.ts --feature <feature> --phase review` 校验。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，Review 阶段完成。**具备**进入 Skill 5 的**资格**；**不授权**自动开 Skill 5。

**闭环停等（BLOCKER，user-confirmation-ux §8）**：须 **`review.ok_to_ut`** 或 **`phase.next_step`** 停等（除非 batch 授权 §8.2）。物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。

#### 6.3 验证完成标志

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER |
| AI Harness | verdict = PASS（无 BLOCKER 级 FAIL） |

验证全部通过后，Code Review 阶段完成。若审查报告结论为"不通过"或"有条件通过"，开发者需修复代码后重新执行 Skill 3 → Skill 4。全部问题修复后，**具备**进入 Skill 5（业务级 UT）的**资格**；须 **`review.ok_to_ut` / `phase.next_step`** 或 batch 授权后再进入 UT。

## 输出规范

### 文件路径

| 产出 | 路径 |
|------|------|
| 审查报告 | `doc/features/{module-name}/review-report.md` |

### 文档格式
- 使用 Markdown 格式
- 问题清单使用表格
- 元数据使用 blockquote 格式

### 问题编号格式
- `CR-{NNN}`，从 CR-001 开始递增

## 关联文件

- 上游输入:
  - `doc/features/{module}/design.md`（Skill 2 输出）
  - 源代码（Skill 3 输出）
  - `doc/features/{module}/contracts.yaml`（Skill 2 产出的接口契约 Spec）
  - `doc/features/{module}/acceptance.yaml`（Skill 1 产出的验收标准 Spec）
- 阶段级规约: `framework/specs/phase-rules/review-rules.yaml`
- 编码规约参考: `framework/specs/phase-rules/coding-rules.yaml`
- 脚本 Harness: `framework/harness/scripts/check-review.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-review.md`
- 审查报告模板: [templates/review-report-template.md](templates/review-report-template.md)（通用，仍位于本 Skill 树内）
- 审查检查清单: `` `profile-skill-asset:4-code-review/review_checklist` ``
- 下游消费者:

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **开发者** | review-report.md | 按问题清单修复代码 |
| **Skill 5 (业务级 UT)** | 修复后的源代码 | 基于修复后的代码生成 UT |
| **Harness (验证层)** | review-report.md | 脚本/AI 验证报告质量 |

## 约束与注意事项

1. **基于 Spec 审查**：所有审查结论必须可追溯到具体的 Spec 规则（coding-rules.yaml）或契约（contracts.yaml），避免主观判断
2. **准确性优先**：每条问题必须有具体代码证据（文件路径 + 关键代码），不允许泛泛而谈或猜测
3. **零误报目标**：宁可漏报也不误报——若不确定是否为问题，降级为 INFO 或不报告
4. **修复建议可操作**：每条问题的修复建议必须具体到修改哪个文件的哪段代码，提供代码示例或明确步骤
5. **模拟数据容忍**：本项目为模拟应用，数据全部写死——对模拟数据的类型合法性检查应适度宽容
6. **中文输出**：审查报告使用简体中文
7. **不要重复 Harness 已覆盖的检查**：Skill 4 是人工级别的深度审查，应关注语义正确性和架构合理性，确定性结构检查（文件存在、分层合规等）由 Harness 脚本自动完成
8. **Harness 验证闭环**：报告完成后 agent **必须自己运行** Harness 验证（Step 6），并主动通过 Task 工具触发 `subagent_type: verifier`；确保零 BLOCKER + verifier PASS + 完成回执通过校验后才认为 Review 阶段完成（物理拦截层兜底）

---

## Slash / 快捷入口触发时的 trace 约定

当本 Skill 通过适配器下发的 slash（如 `/code-review`）或其它等价快捷入口触发时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`doc/features/<feature>/review/reports/<timestamp>/<model>-review/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `review`。
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。

---

## 运行时交付约定（内网 / 弱模型）

```
doc/features/<feature>/review/reports/<timestamp>/<model>-review/
├── trace.json                 # phase = "review"
├── gap-notes.md
├── check-review.report.md
└── verifier.report.md         # verifier 跑 verify-review.md（可选）
```
