# PRD 设计 Skill (`1-prd-design`)

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths**（如 feature 文档目录、`module-catalog.yaml`、`glossary.yaml` 等）及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

### Feature 归档定位协议（PRD 阶段是创建者）

进入本 Skill 后，必须先基于 `framework.config.json > paths.features_dir` 解析目标归档路径，默认是 `doc/features/<feature>/`。本步骤只依赖用户给出的 feature 名与文件系统状态，不依赖 `.current-phase.json`、历史 reports、trace 或上一阶段缓存。

- 若 `doc/features/<feature>/` 已存在且是目录：在该目录内续写/更新 `PRD.md` 与 `acceptance.yaml`，不要扫描同级同名前缀条目来替代它。
- 若该目录不存在：可以创建该目录作为本 feature 的正式归档目录。
- 若同级存在 `<feature>.rar` / `<feature>.zip` / `<feature>.7z` / `<feature>.tar*` 等归档，或 `<feature>-old/`、`<feature>.md` 等同名前缀条目：仅作为旁证展示给用户，不得自动解压、不得把它们当正式 feature、不得优先读取其内容。
- 若精确路径 `doc/features/<feature>` 已存在但不是目录：必须停下来请用户确认 feature 名称或清理/恢复路径，不能覆盖该文件。

## 概述

你是一位资深产品经理，专精鸿蒙（HarmonyOS）应用的产品需求文档（PRD）撰写。你的任务是根据用户提供的文字描述和界面截图，生成结构化、可执行的 PRD 文档。

本 Skill 是项目全生命周期流水线的**第一环**，其输出（PRD.md）将作为后续需求设计、编码、测试等阶段的输入。

## 触发条件

当用户的请求包含以下意图时激活本 Skill：
- "写PRD"、"产品需求"、"PRD设计"、"分析需求"
- "需求文档"、"功能规划"、"产品设计"
- 提供了界面截图并要求分析功能

## 工作流程

### Step 1: 收集输入

向用户确认以下信息（缺失项需主动询问）：

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能文字描述 | ✅ | 用户想要实现的功能意图和场景说明 |
| 界面截图 | ✅ | 目标应用的真实界面截图，用于参考 UI 布局和交互模式 |
| 功能模块名称 | ✅ | 用于确定文档归档路径（如 `home-page`、`card-management`） |
| 竞品截图 | ❌ | 可选，用于补充交互参考 |

### Step 1.5: 术语消歧（BLOCKER，必做，不可跳过）

> **本步骤是 PRD 阶段 Scope 守门机制的真正入口。**
> 用户的自然语言描述中经常出现与模块字面相似但语义错位的术语
> （最典型：「卡中心」≠「卡管理」CardManager；「我的」≠「账号」AccountManager）。
> 弱模型若直接进入 Step 2 截图分析并写 PRD，非常可能把错误术语映射固化进文档。
>
> **本步骤就是把"隐式的术语理解"变成"显式的术语映射表"，交给用户逐条人工确认。**

#### 1.5.1 必读输入

- [doc/glossary.yaml](../../doc/glossary.yaml) — 业务术语 ↔ 权威模块映射表
- [doc/module-catalog.yaml](../../doc/module-catalog.yaml) — 每个模块的职责画像（含 `NOT_responsible_for` / `easily_confused_with`）

#### 1.5.2 执行步骤

1. **提取业务名词**
   从用户的原始需求文字中，抽出所有可能指代"功能 / 页面 / 模块 / 能力"的业务名词（含中文和英文），不要自行合并或重命名。

2. **逐个查询 glossary**
   对每个名词，在 `doc/glossary.yaml` 里做匹配：
   - **精确命中 `term`** → 置信度 `high`，记录 `canonical_module`
   - **命中 `aliases`** → 置信度 `high`，记录 `canonical_module` 并注明来自别名
   - **未命中** → 置信度 `low`，进入下一步在 catalog 里找候选

3. **未命中则查询 module-catalog 找 Top-3 候选**
   对每个未命中术语，在 `doc/module-catalog.yaml` 的 `typical_business_terms` / `one_liner` / `responsibilities` 里做子串匹配，给出候选模块 Top-3，附每个候选的 `NOT_responsible_for`（让用户直观判断"是不是真的选错了"）。置信度统一 `low`。

4. **对每个已命中术语，强制检查 `easily_confused_with`**
   即便已精确命中，若该术语 / 其 `canonical_module` 存在 `easily_confused_with`，**必须在映射表里显示该混淆项**，置信度从 `high` 降级为 `medium`。这一步是本 Skill 的核心反模式：**"命中不等于正确，混淆项必须亮给用户看"**。

5. **生成「术语映射表」并停下来等人工确认**
   以下面的格式输出为 PRD 的前置章节：

   ```markdown
   ## 0. 术语映射表（用户确认前不得生成后续章节）

   | 原始术语 | 权威模块 | 所属层 | 置信度 | 易混项（必读） | 用户确认 |
   |---------|---------|--------|--------|---------------|---------|
   | 卡中心 | WalletMain | 02-Feature | medium | 卡管理 (CardManager) — 卡中心是 UI 页面，卡管理是后端能力 | [ ] |
   | 添卡入口 | WalletMain | 02-Feature | high | — | [ ] |
   | （未命中示例）X | 候选①：A / 候选②：B / 候选③：C | — | low | 各候选的 NOT_responsible_for 简述 | [ ] |
   ```

   - **所有行的「用户确认」必须为 `[x]` 才允许生成 PRD 正文**（这是 BLOCKER）。
   - 即使置信度是 `high` 也必须人工确认（按项目约定，不启用 auto-approve）。
   - 用户如对某条映射不满意，要求修正 → AI 把修正后的映射写入本表并再次等用户确认。

6. **回写 glossary（用户批准后）**
   所有用户确认过的**新术语**或**被修正过的术语映射**，必须在 PRD 归档前追加或更新到 `doc/glossary.yaml`（带 `confidence_hint: "user-approved on YYYY-MM-DD"`），作为下一次复用的种子。
   **不得**在未获得用户明确同意时修改 glossary。

#### 1.5.3 强约束

1. **禁止在 Step 1.5 完成前进入 Step 2**。
2. **禁止跨过本步骤**——即便用户说"简单需求直接写 PRD"，也要输出一张极简的映射表（至少列出需求中出现的主要业务名词）。
3. 映射表必须放在 PRD 的 `## 0. 术语映射表` 章节。`check-prd.ts` 会强制校验：
   - 该章节存在
   - 所有行的「用户确认」列为 `[x]`
   - `canonical_module` 字段的值必须存在于 `doc/module-catalog.yaml` 的模块名集合里
   - **每一行的「权威模块」必须同时出现在 Scope 声明的 `in_scope_modules` 或 `out_of_scope_modules` 里**（`terminology_modules_within_scope` BLOCKER）——写了某术语的消歧归属，却忘把对应模块声明进 Scope，属于典型自相矛盾。
4. 若任何一条映射的置信度是 `medium/low` 且用户未确认，`terminology_mapping_table` BLOCKER 会 FAIL，阻塞后续流程。
5. **兜底网**：若 `doc/glossary.yaml` 里的某术语（含 aliases）在 PRD 正文出现但未进本映射表，`glossary_terms_used_in_body` WARN 会提示——可能是作者把业务术语当成"普通词"写进正文。补进映射表即可清 WARN；若确认只是偶然带过的非业务用词，忽略 WARN 也不阻断流程。

#### 1.5.4 反模式（禁止）

- ❌ "卡中心"直接当作 `CardManager`，因为"看起来差不多"
- ❌ 置信度一律标 `high`，让用户全量打钩了事
- ❌ 用户在聊天里口头说了"OK"，但没把 `[ ]` 改成 `[x]` 就继续
- ❌ Step 2 截图分析中又出现了未在映射表里的新业务名词，却没有回到 Step 1.5 补条目
- ❌ 术语映射表写了 `卡中心 → CardManager`，但 Scope 声明的 in/out_of_scope_modules 里都没有 CardManager（自相矛盾）

---

### Step 2: 截图分析

仔细分析用户提供的界面截图，提取以下信息：

1. **页面整体布局**：顶部导航栏、内容区域划分、底部标签栏等
2. **UI 组件清单**：按钮、卡片、列表项、图标、文字标签、输入框、弹窗等
3. **交互线索**：可点击元素、滑动区域、切换动作、跳转目标
4. **视觉层次**：主次信息的排列、颜色/字号的层级关系
5. **数据展示**：页面上展示了哪些动态数据（金额、卡号、状态等）

### Step 3: 生成 PRD 初稿

读取 PRD 文档模板：

```
framework/skills/1-prd-design/templates/prd-template.md
```

按模板结构填充内容，**必须包含以下 10 个章节**：

0. **术语映射表** — Step 1.5 产物，所有映射必须 `[x]` 已确认（BLOCKER 起点）
1. **功能概述** — 一句话描述该功能模块的核心价值
2. **Scope 声明** — 本需求允许修改哪些模块、明确不改哪些模块、为什么（Scope 守门机制第二道）
3. **目标用户与使用场景** — 明确谁在什么场景下使用
4. **功能清单** — 每项含：功能名、优先级（P0-P3）、描述
5. **页面/界面描述** — 从截图提取的布局、组件、交互动作详细描述
6. **业务流程图** — 使用 Mermaid flowchart 描述核心业务流
7. **异常/边界场景处理** — 网络异常、空数据、权限不足等
8. **非功能性需求** — 性能、兼容性、安全性要求
9. **验收标准** — 可量化、可测试的条件列表

> **Scope 声明必须与术语映射表一致**：`in_scope_modules` 的所有条目必须来自映射表里已确认的 `canonical_module`，不允许出现映射表未涉及的模块。

#### Step 3.1 Scope 声明填写规则（必读）

Scope 声明是 Skill 2（Design）和 Skill 3（Coding）能否"不扩大改动范围"的唯一依据，**必须在生成 PRD 正文前先确定**：

1. 通读需求描述 + 截图，识别要实现的功能。
2. 对照 `doc/architecture.md` 的"模块清单"，判断哪些模块**必须改**（= `in_scope_modules`）、哪些模块**看似相关但本需求不需要改**（= `out_of_scope_modules`）。
3. 在 `rationale` 中回答一个问题："如果后续 Skill 2 想把逻辑提到公共模块，我是否同意？不同意的理由是什么？"
4. `in_scope_modules` 的模块名必须使用 PascalCase，且与 `doc/architecture.md` 保持一致（如 `BankCard`、`WalletMain`，**不要**使用 `bank-card` 或 `bank_card`）。
5. 如果确实判断不清楚，宁可把 scope 声明得窄一些（只列最核心那 1 个模块），让 Skill 2 遇到问题时触发用户确认流程，也不要先写得宽松留"后路"。

### Step 4: 质量门禁自检

生成初稿后，执行以下自检清单（逐项检查，不通过则自动修正）：

```
[ ] 1. 功能概述：是否为一句简洁明确的描述？（非"xxx功能"这种空泛表述）
[ ] 2. Scope 声明：是否有 yaml 代码块？in_scope_modules 是否至少 1 项且与 architecture.md 模块名一致？rationale 是否真正解释了"为什么不改 out_of_scope_modules"？
[ ] 3. 目标用户：是否明确了用户角色？使用场景是否具体？
[ ] 4. 功能清单：是否每项都有 P0-P3 优先级标注？描述是否具体到可实现？
[ ] 5. 界面描述：是否覆盖了截图中所有可见的 UI 元素？布局描述是否可复现？
[ ] 6. 业务流程图：Mermaid 语法是否正确？是否覆盖了主路径和关键分支？
[ ] 7. 异常场景：是否至少覆盖了网络异常、数据为空、权限不足三种基本场景？
[ ] 8. 非功能性需求：是否有具体的量化指标（如页面加载 < 2s）？
[ ] 9. 验收标准：每条标准是否可测试、可量化？是否与功能清单一一对应？
```

**不通过项**：找出具体缺失点，自动补充完善后重新自检，直到 9 项全部通过。

### Step 5: 输出与归档

1. 将 PRD 文档展示给用户确认
2. 用户确认后，将文档保存到项目文档目录：
   ```
   doc/features/{module-name}/PRD.md
   ```
3. 若用户要求修改，根据反馈调整后重新走 Step 4 自检

### Step 6: 提取功能级 Spec

PRD 归档后，**必须**同步提取功能级规约文件到 `doc/features/{module-name}/` 目录。Spec 是连接生成层（Skill）和验证层（Harness）的枢纽，也是后续 Skill（编码、UT、测试）的参照基准。

#### 6.1 提取验收标准

从 PRD.md 中提取结构化验收标准，写入 `doc/features/{module-name}/acceptance.yaml`：

**`criteria` 章节**（从 PRD「验收标准」提取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | 验收标准编号 | 如 AC-1、AC-2 |
| `prd_function` | 功能清单编号 | 如 F1、F2，建立追溯链 |
| `priority` | 功能清单优先级 | P0/P1/P2/P3 |
| `description` | 验收标准描述 | 可测试的验收条件 |
| `testable` | 固定 true | 所有 AC 必须可测试 |
| `verification_steps` | 从描述中提炼 | 具体的验证操作步骤列表 |
| `expected_result` | 从描述中提炼 | 可观察的预期结果 |
| `data_constraints` | 从描述中提炼 | 数据约束（数量、具体值等，可选） |
| `ut_layer` | **必填** | UT 分层：`unit`（仅 Hypium 业务 UT 覆盖）/ `device`（仅真机 UI 自动化覆盖）/ `both`（两层都需要覆盖）。详见下方《6.1.1 ut_layer 分层指引》 |
| `ut_focus` | 若 ut_layer ∈ {unit, both} 必填 | 简要说明 UT 要断言什么（如"state 最终为 Success；storage.save 被调用；save 数据字段完整"）；不写具体代码，只点明关切点 |
| `linked_flow` | 若 ut_layer ∈ {unit, both} 建议填 | 指向 `doc/features/{feature}/use-cases.yaml > use_cases[].id`，如 `card_opening` |
| `linked_branch` | 若 ut_layer ∈ {unit, both} 建议填 | 指向该 use_case 的 `branches[].id`，如 `sms_fail_rollback` |

**`boundaries` 章节**（从 PRD「异常/边界场景处理」提取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | 边界编号 | 如 BD-1、BD-2 |
| `prd_exception` | 异常场景编号 | 如 E1、E2 |
| `scenario` | 场景标识 | 如 network_offline、empty_data |
| `description` | 场景描述 | |
| `handling` | 处理方式 | PRD 中定义的处理策略 |
| `expected_behavior` | 预期行为 | 处理后的可观察结果 |
| `ut_layer` | **必填** | 同 `criteria.ut_layer` |
| `ut_focus` | 若 ut_layer ∈ {unit, both} 必填 | 简要说明 UT 关切点 |
| `linked_flow` / `linked_branch` | 若 ut_layer ∈ {unit, both} 建议填 | 同 `criteria` 字段 |

#### 6.1.1 ut_layer 分层指引

一条 AC / BD 应该归到哪一层，按以下规则判定（从严判 `device`）：

| ut_layer | 典型特征 |
|---|---|
| `unit` | 验收点是业务流程/数据/状态层面：数据是否加载成功、Repository 是否返回预期、UseCase 分支是否进入预期 state、本地持久化是否回滚 |
| `device` | 验收点是 UI 表现/真人交互：Tab 切换动画、点击区域是否可达、Toast 是否出现、键盘/输入焦点、`navPathStack.pushPath` 的真实跳转、深色模式主题切换 |
| `both` | 既有数据/状态断言，又强依赖真实 UI 反馈（如"点击卡片后跳转到详情页且详情页数据正确"） |

**原则**：
1. **纯 UI/交互 AC 必须落 device**——UT 里用 Fake NavPathStack / spy showToast 的做法已被明确禁止（见 ut-rules.yaml `no_ui_dep_in_ut` BLOCKER）
2. **业务流程分支必须落 unit**——"成功/失败/取消/回滚"这类状态流转由 UseCase 在 UT 中端到端覆盖
3. **ut_layer = both 的 AC**：必须拆出"业务部分" 与 "UI 部分"分别在 `ut_focus` 中写清，UT 只承担业务部分，UI 部分由 Skill 6 覆盖

**`performance` 章节**（从 PRD「非功能性需求」提取）：

| 字段 | 来源 | 说明 |
|------|------|------|
| `id` | NFR 编号 | 如 NFR-1 |
| `metric` | 指标名称 | 如"页面首屏加载" |
| `threshold` | 量化阈值 | 如 "<= 1.5s" |

**`coverage_summary` 章节**（自动统计）：

统计 P0/P1/P2 功能的 AC 覆盖率，确保每个 P0/P1 功能至少有一条 AC 覆盖。

#### 6.2 输出文件与参考

```
doc/features/{module-name}/acceptance.yaml
```

参考已有示例：`doc/features/home-page/acceptance.yaml`

> **为什么这一步如此重要**：`acceptance.yaml` 是后续 Harness 验证编码完整性、Skill 5 生成 UT 断言、Skill 6 生成测试用例的基准。若不提取，下游无法自动验证。

### Step 7: Harness 验证门禁（agent 必须自跑）

> **CLAUDE.md 4.1 节明示授权**：本步骤的 harness 与 verifier 调用都由主 agent 自己执行，
> **严禁**仅"告知用户可运行"然后结束对话——属软幻觉，由物理拦截层兜底。

Spec 文件提取完成后，agent **必须自己**完成下列验证，再宣布 PRD 阶段完成。

#### 7.1 脚本 Harness（确定性检查，agent 通过 Shell 工具自跑）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase prd --feature {module-name}
```

agent 执行后必须 Read 退出码与报告文件；BLOCKER 必须修复后重跑。

> ⚠️ **一定要通过 `harness-runner.ts` 入口**：直接 `ts-node scripts/check-prd.ts` 不会触发任何检查（`check-*.ts` 只是导出 checker 模块，没有 CLI 入口），会静默返回 0 造成"假通过"。

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/prd-rules.yaml` — 阶段级通用规则（章节存在性、表格格式、优先级合法性、追溯完整性等）
- `doc/features/{module-name}/acceptance.yaml` — 功能级验收标准（若存在则加载；PRD 阶段通常不依赖）

**若报告中存在 BLOCKER 级问题**：必须修正 PRD 并重新提取 Spec（回到 Step 4），直到零 BLOCKER。

#### 7.2 AI Harness（语义级检查，agent 主动通过 Task 工具触发 verifier 子 agent）

agent 必须主动通过 Task 工具调用 `subagent_type: verifier`（不是"告诉用户去跑"），把 feature / phase / 脚本报告路径传入：

- **Prompt 模板**：`framework/harness/prompts/verify-prd.md`（由 verifier 子 agent 自行读取）
- **触发方式**：Task 工具，subagent_type=verifier，prompt 中给出 feature/phase/脚本报告路径
- **语义检查覆盖项**：
  1. 功能概述清晰度
  2. 使用场景具体性
  3. 功能描述可执行性
  4. 验收标准可测试性（BLOCKER 级）
  5. UI 组件术语规范
  6. 模拟范围意识
  7. 业务流程分支覆盖
  8. 使用场景到页面追溯

**若 AI 报告中存在 BLOCKER 级 FAIL**：修正后重新验证。

#### 7.3 阶段闭环判定（CLAUDE.md 5.1 节 SSOT，四条件缺一不可）

> 下文「物理拦截层」是 adapter 中立术语：`claude` adapter 即 `.claude/hooks/check-phase-completion.mjs` 注册的 Stop hook（由 `00-framework-init` 从 [framework/agents/claude/templates/](../../agents/claude/templates/hooks/check-phase-completion.mjs) 下发）；`generic` / `cursor` adapter 暂无等价物，仍以 Layer 1（CLAUDE.md/AGENTS.md §6.5 反假设条款）+ Layer 2（完成回执 + check-receipt.ts）兜底——**没有 Stop hook ≠ 豁免 BLOCKER**，少跑一项即任务失败。

PRD 阶段宣布"完成"前必须**同时**满足：

1. `framework/harness/reports/<feature>/prd/trace.json` 真实存在；
2. 脚本 harness 退出码 0、零 BLOCKER；
3. verifier 子 agent 报告 verdict = PASS；
4. 完成回执 `doc/features/<feature>/prd/phase-completion-receipt.md` 已填写并通过 `npx ts-node framework/harness/scripts/check-receipt.ts --feature <feature> --phase prd` 校验。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，PRD 阶段完成，可进入 Skill 2（需求设计）。物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。

## 输出规范

### 文件路径

| 产出 | 路径 |
|------|------|
| PRD 文档 | `doc/features/{module-name}/PRD.md` |
| 验收标准 Spec | `doc/features/{module-name}/acceptance.yaml` |

### 文档格式
- 使用 Markdown 格式
- 流程图使用 Mermaid 语法
- 功能清单使用表格
- 验收标准使用有序列表

### Spec 格式
- 使用 YAML 格式
- 遵循 `doc/features/home-page/acceptance.yaml` 的结构模式
- 所有 ID 字段（AC-N、BD-N、NFR-N）保持唯一

### 优先级定义

| 优先级 | 含义 | 说明 |
|--------|------|------|
| P0 | 必须实现 | 核心功能，缺失则模块不可用 |
| P1 | 应当实现 | 重要功能，影响核心体验 |
| P2 | 最好实现 | 增强功能，提升用户体验 |
| P3 | 可以延后 | 锦上添花，不影响基本使用 |

## 关联文件

- PRD 模板: [templates/prd-template.md](templates/prd-template.md)
- 功能卡片模板: [templates/feature-card.md](templates/feature-card.md)
- 示例 PRD: [examples/example-prd.md](examples/example-prd.md)
- 阶段级规约: `framework/specs/phase-rules/prd-rules.yaml`
- 功能级 Spec 示例: `doc/features/home-page/acceptance.yaml`
- 脚本 Harness: `framework/harness/scripts/check-prd.ts`
- AI Harness Prompt: `framework/harness/prompts/verify-prd.md`

## 下游消费者

本 Skill 的输出将被以下 Skill 和 Harness 消费：

| 消费者 | 消费的产出 | 用途 |
|--------|-----------|------|
| **Skill 2 (需求设计)** | PRD.md | 读取功能清单，生成技术设计文档 |
| **Skill 3 (编码)** | acceptance.yaml | 参照验收标准和边界用例实现代码 |
| **Skill 5 (业务级 UT)** | acceptance.yaml | 参照验收标准生成 UT 断言 |
| **Skill 6 (真机测试)** | acceptance.yaml | 参照验收标准生成测试用例 |
| **Harness (验证层)** | acceptance.yaml | 脚本/AI 验证编码和 UT 的完整性 |

## 约束与注意事项

1. **截图是关键输入**：截图中的 UI 细节是 PRD 界面描述的主要依据，不可忽略截图中的任何可见元素
2. **鸿蒙生态适配**：描述 UI 组件时优先使用 ArkUI 组件术语（如 `Column`、`Row`、`List`、`Tabs`、`Navigation`）
3. **模拟数据标注**：涉及真实后端（支付网关、银行接口等）的功能，若当前阶段无法接入真实服务，应在 PRD 中标注为"模拟数据"
4. **不要过度设计**：PRD 关注"做什么"而非"怎么做"，技术实现细节留给 Skill 2
5. **中文输出**：所有 PRD 内容使用简体中文

---

## Claude Code CLI 运行时约定

当本 Skill 通过 `/prd-design` slash command 在 Claude Code CLI（或等价运行时）下运行时，**必须**在阶段结束时产出一份 trace 凭证：

- **路径约定**：`framework/harness/reports/<feature>/<timestamp>/<model>-prd/trace.json`
  - `<feature>`：功能名，与 `doc/features/<feature>/` 对应
  - `<timestamp>`：`YYYYMMDD-HHmmss` 格式
  - `<model>`：实际运行的模型标识，如 `minimax-2.5` / `glm-4.5` / `claude-sonnet-4`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `prd`。
- **痛点回填**：同目录下再产出一份 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。
- **用途**：trace.json 是内网弱模型试运行的主要回传物，用于驱动 skills/spec/harness 的下一轮迭代。**不要省略**。

---

## 运行时交付约定（Claude Code CLI / 内网弱模型）

当本 Skill 由 Claude Code CLI 或等价 agent 运行时（尤其是内网弱模型场景），**阶段结束前必须**在以下目录产出交付凭证：

```
framework/harness/reports/<feature>/<timestamp>/<model>-prd/
├── trace.json          # 结构见 framework/harness/trace/trace.schema.json（phase = "prd"）
├── gap-notes.md        # 痛点回传，结构见 framework/harness/trace/gap-notes.template.md
└── check-prd.report.md # check-prd.ts 的输出（若已运行）
```

用途：
1. 内网弱模型跑动后将 trace.json + gap-notes.md 回传给 Cursor 侧迭代 skills / specs / harness；
2. 对比不同模型在同一 feature 上的表现；
3. 定位"框架没兜住的问题"，驱动下一波改造。
