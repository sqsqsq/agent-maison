# 真机测试 Skill (`6-device-testing`)

> **用户确认 UX**：[user-confirmation-ux.md](../reference/user-confirmation-ux.md) · `testing.module_name` / `testing.packaging` / `testing.plan_confirm` / `phase.next_step`。

## 前置（依赖初始化 Skill 产物）

本工程须先完成 [`00-framework-init`](../00-framework-init/SKILL.md)：实例根下已有有效的 `framework.config.json`，且本 skill 与 harness 所依赖的 **paths** 及 **`architecture` 段**已由初始化写入或与之一致。未完成 `/framework-init` 前请勿执行本 skill。

**Harness 运行时前置**：执行本 Skill 中任意 `harness-runner` / `npx ts-node harness-runner.ts` / `check-receipt.ts`（依赖 harness npm）前，须满足 [Host harness readiness · Tier_1](../reference/host-harness-readiness.md) 与 [Shell cwd 契约](../reference/harness-cli-cwd.md)（harness 之后用 `cd framework/harness && npx ts-node scripts/check-receipt.ts`）。宿主打包/装机/设备工具链仍以本 Skill 的 profile addendum（Tier_2）为 SSOT。

### Feature 归档定位协议（本阶段是消费者）

进入本 Skill 后，必须先基于 `framework.config.json > paths.features_dir` 精确定位 `doc/features/<feature>/`。本步骤只依赖用户给出的 feature 名与文件系统状态，不依赖 `.current-phase.json`、历史 reports、trace 或上一阶段缓存。

- 只有精确目录 `doc/features/<feature>/` 是正式 feature；同级 `<feature>.rar` / `<feature>.zip` / `<feature>.7z` / `<feature>.tar*` 以及 `<feature>-old/`、`<feature>.md` 等同名前缀条目都只是旁证。
- 若精确目录不存在，必须快速失败并提示用户先创建/恢复正式 feature 目录；不得自动解压归档，不得读取归档内容补齐上下文。
- 若目录存在但本阶段输入缺失（至少 `PRD.md`、`design.md`、`acceptance.yaml`）：报告缺失文件并回到上游阶段补齐；不得把同名归档当作上游产物。
- 继续执行前，向用户展示本阶段输入矩阵：`PRD.md` / `design.md` / `acceptance.yaml` / `contracts.yaml(可选)` / `use-cases.yaml(可选)` / `test-plan.md(本阶段产出)` 存在/缺失；若仍存在 legacy `device-testing-todo.md` 仅作 WARN 提示迁移，**不得**作为 SSOT。

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

### 模式分支：标准 feature vs 即席（ad-hoc）

| 模式 | 典型输入 | 是否走 `doc/features/<正式 feature>/` |
|------|----------|----------------------------------------|
| **标准** | 「对 `home-page` 做真机测试」、已存在需求目录 | ✅ 必须存在 `PRD.md` / `design.md` / `acceptance.yaml` 等，按 Step 1–7 与 `harness-runner --phase testing --feature <名>` 闭环 |
| **即席** | 仅描述 **bundle id / 外部应用** + **自然语言操作步骤**，不指向本仓库某 feature | ❌ 不消费需求目录；用占位 feature 目录名 **`_adhoc`**（见下文 Step 4.B） |

**即席识别启发**（满足多条即可视为即席）：用户给出 `com.xxx.yyy` 类 bundle 字符串且步骤像「打开应用 → 点某按钮 → …」；或**未**提供与本仓库 `doc/features/` 下已有目录匹配的 feature 名，且核心诉求是「当场跑一遍 UI 流程」而非「完成某需求的 testing 阶段门禁」。

## 核心理念

**从 `acceptance.yaml`（`ut_layer` + `device_focus`）派生 test-plan → Hylyre/真机执行 → 结构化报告 → Harness 验证闭环**

业务级 UT（Skill 5）验证的是 UseCase / state / port 的业务逻辑正确性；真机测试验证的是**端到端用户体验**。
v2 起，AC/BD 层面已显式分层为 `ut_layer ∈ {unit, device, both}`：

- **`ut_layer = unit`**：UT 已充分覆盖，本 Skill 不再重复测试（除非 both）
- **`ut_layer = device`**：UT 不覆盖，**必须**由本 Skill 真机覆盖
- **`ut_layer = both`**：UT 覆盖业务侧（state/port/数据），本 Skill 补做 UI 侧（Toast / 跳转 / 渲染 / 用户交互）

真机要点以 **`acceptance.yaml` 的 `device_focus`** 为 SSOT（Skill 1 写入）；Skill 5 可选产出 `ut/reports/ac-coverage.json` 机器回执，**非** SSOT。

- 测试用例**从 `acceptance.yaml` 过滤 `ut_layer ∈ {device, both}`** 派生/更新 `test-plan.md`（见 [acceptance-layering.md](../../docs/concepts/acceptance-layering.md)）
- 测试步骤面向真人操作者，描述具体的 UI 交互路径
- 测试报告包含每条用例的执行结果、缺陷记录和通过率统计

## 输入

| 输入项 | 必需 | 说明 |
|--------|------|------|
| 功能模块名 | ✅ | 待测试的功能模块名（如 `home-page`），用于定位文件 |
| PRD.md | ✅ | 产品需求文档，路径 `doc/features/{module}/PRD.md` |
| design.md | ✅ | 技术设计文档，路径 `doc/features/{module}/design.md` |
| acceptance.yaml | ✅ | 验收 SSOT（含 `ut_layer` / `device_focus`），**test-plan 派生来源** |
| use-cases.yaml | ⬜（v2） | UseCase 规范，路径 `doc/features/{module}/use-cases.yaml`，了解 UT 已覆盖的分支 |
| contracts.yaml | ⬜ | 接口契约 Spec，路径 `doc/features/{module}/contracts.yaml`，用于理解模块边界 |
| doc/architecture.md | ⬜ | 项目模块架构，了解测试涉及的模块范围 |
| review-report.md | ⬜ | 可选，确认代码已通过 Review 无 BLOCKER |

**若缺少 `device_focus`**：对 `ut_layer ∈ {device, both}` 的 AC/BD，提示回到 Skill 1 补全 `device_focus`（harness `acceptance_device_focus_present` 为 BLOCKER）。

**若缺少 acceptance.yaml**：提示用户先运行 Skill 1 提取验收标准。测试用例必须追溯到 AC/BD 编号。

## 工作流程

### Step 1: 收集测试上下文

1. 向用户确认待测试的功能模块名 `{module-name}`（`testing.module_name`：`1=确认` / `2=修改`）
2. 读取以下文件：
   - `doc/features/{module}/acceptance.yaml` — ★ 验收 SSOT（按 `ut_layer∈{device,both}` + `device_focus` 派生用例）
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
  legacy device-testing-todo.md: 存在则 WARN 迁移
  device AC: N 条（仅真机覆盖）
  both AC:   N 条（UT + 真机共同覆盖，本 Skill 关注 UI 侧）
  unit AC:   N 条（已由 UT 覆盖，本 Skill 不重复）
  边界场景（device/both）: N 条
  非功能性需求: N 条（性能指标等）
  测试基准: acceptance.yaml（filter ut_layer∈{device,both}，要点见 device_focus）
```

### Step 1.5: 打包与装机（profile capability）

在进入生成测试计划（Step 2）之前，若当前 `project_profile`（见 `framework.config.json > project_profile`）将 **`device_test.build` / `device_test.install`** 声明为 **BLOCKER**，你必须与用户对齐「能在真机上跑的同一套包」：

1. **读取宿主指南**：完整阅读  
   `framework/profiles/<project_profile.name>/skills/6-device-testing/profile-addendum.md`，其中的宿主 toolchain、环境与 harness 变量以 **单一宿主附录为 SSOT**；根 SKILL 不复述宿主专有名词。
2. **与用户确认打包维度（必选语义）**（`testing.packaging` · user-confirmation-ux §3.2）  
   展示 product / buildMode 推荐值后附：`1=确认` / `2=修改`。  
   - **product**：枚举宿主工程中可用的制品维度（附录列出如何用宿主 tooling 读取 **`products`** 清单）；默认应与宿主侧的 **`preferredProduct`/`detectProduct` 语义**一致（仍为宿主附录用语）。  
   - **buildMode**：宿主侧的 **`debug`（默认）** 或 **`release`**；需在会话或环境里记下所选组合供 **`testing` harness** 复现。附录 **`testing-build-conventions.ts`** 说明可用的 **`HARNESS_DEVICE_TEST_*`** 变量。
3. **执行链路（中性措辞）：** 经由 **`capability-registry`** → **`dispatchDeviceTestBuild`** 产出 signed 应用程序包；再 **`dispatchDeviceTestInstall`** 触发设备安装步骤（宿主附录写明等价 CLI）。宿主实现在 **`profiles/<name>/harness/providers/device-test-build.ts`** 与 **`device-test-install.ts`**；日志与结构化摘要的约定文件名见宿主 **`profile-addendum`**（同一 **`reports/<feature>/testing/`** 目录下）。
4. **与文档门禁的顺序**：本仓储 **`testing` 脚本 harness** 会在校验 Markdown 计划/报告之前尝试 **`device_test.build` → `device_test.install` → `device_test.run`**（profile **SKIP** 则对应步骤 SKIP）。**Hylyre ensure**（venv / pip / doctor）在 **`device_test.run`** 内自动执行，**不是** Skill 入口的独立步骤。可先撰写文档再由 harness 触发包链路；若 BLOCKER 失败，须先修复宿主 toolchain / 设备再继续闭环。
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

**从 `acceptance.yaml` 过滤派生**（`ut_layer ∈ {device, both}`，`device_focus` 为步骤要点 SSOT）

**派生规则**：

- 每条 device AC → 至少 1 条测试用例（优先级承袭 AC；步骤来自 `device_focus`）
- 每条 both AC → 至少 1 条测试用例，**关注点限定为 UI 层**（业务逻辑已由 UT 覆盖，真机不重复断言数据；步骤来自 `device_focus`）
- 同一 AC 的多个 `device_focus` 子要点可合并为 1 条 TC 的多步

按如下规则派生：

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
2. **`testing.plan_confirm`**：`1=确认测试计划` / `2=修改计划`
3. 若需修改，调整后重新展示并再次编号确认

### Step 4: 归档测试计划

用户确认后，将测试计划保存到：

```
doc/features/{module-name}/test-plan.md
```

### Step 4.5 真机自动化 · 派生可执行计划（profile `device_test.run`）

若 `project_profile` 将 **`device_test.run`** 声明为 **BLOCKER** 且未 **SKIP**，你必须在跑一次 **`testing` harness** 之前，从顶层 **`test-plan.md`**（自然语言步骤表）生成 Hylyre 可消费的 **派生计划**。本小节是 agent 在会话内执行的**操作协议**；具体 JSON 形态、宿主 CLI、`HYLYRE_APP_STORE_DIR` 与「即席」落盘约定见 **profile addendum「真机自动化」** 与模板 `` `profile-skill-asset:6-device-testing/test_plan_hylyre_template` ``。

**门禁提示**：`device_test.run` 未 SKIP 时，脚本以顶层 **`test-plan.md`** 为 **SSOT** 校验 Hylyre 派生覆盖：派生表中的 TC ∪ **`explicit_skip_tc_ids`**（派生 md 的 YAML frontmatter 或同目录 **`derive-manifest.json`**）须覆盖顶层全部 `TC-xxx`；否则 **BLOCKER**，并更新 **`derive-hint-from-plan.json`**（`schema: 2`，含 `missing_tc_ids`、`rejected_placeholder_paths` 等）。含 **烟测占位** 等标记的派生文件 **无效**；多目录并存时按 **`test-plan.hylyre.md` 的 mtime** 选最新有效派生（**不再**按目录名字典序）。若仅有占位/缺用例，FAIL 并写 hint。另可用 CLI：`cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>`。

#### Step 4.5.1 解析 TC 表

1. 打开 `doc/features/<feature>/test-plan.md`，定位含 **「测试用例清单」** 的章节。
2. 读取 **第一条**用例行表（与 harness 对 `test-plan.md` 的解析一致）：列须覆盖 **用例编号 / 用例名称 / 前置条件 / 测试步骤 / 预期结果 / 优先级 / 关联 AC**。
3. 为每一行建立一项工作项：`TC-xxx`、自然语言 `测试步骤`、预期结果、优先级（供 Step 5 对齐）。

#### Step 4.5.2 发现 selector（按顺序尝试）

对每条 TC 的每一步自然语言，按下列优先级找 **稳定定位**，再映射到 Hylyre JSON 的 `by_id` / `by_text` / `by_type` 等（示例见 profile addendum）：

1. **`contracts.yaml`**：`components`、资源键、与 UI 相关的 id/描述。
2. **`design.md`**：组件树、按钮/入口文案、路由名。
3. **`doc/app-snapshot-cache/<bundle>/`**：历史 **`hylyre app page save`** 写入的页面结构（framework 在每次 **`runHylyreDeviceTest`** 结束后会尝试执行 **`app page save`**，失败不阻断 run）。
4. （可选）设备连线时：`python -m hylyre dump-ui`（或附录中的探索子命令）抓取当前屏，再回填 design/contracts。

仍无可靠 selector 的 TC：**不写入**派生表行，但必须在派生文件 **frontmatter** 或 **`derive-manifest.json`** 登记 **`explicit_skip_tc_ids`**（否则 harness 判为覆盖不完整）；并在 Step 5 顶层 **test-report.md** 标 **跳过** 并写原因。

#### Step 4.5.3 翻译为 Hylyre JSON 步骤

- 将每步操作译为 **单行裸 JSON**（**禁止** Markdown 反引号包裹单元格内容）。
- 允许的根键以 Hylyre `planned_step_keys` 为准（含 **`touch` / `input` / `swipe` / `scroll` / `back` / `home` / `wait_for` / `assert_toast`** 等；见 profile addendum 与 `framework/harness/scripts/utils/hylyre-planned-step-keys.ts`）。
- **推荐 canonical 形态**：direct 根键，如 `{"touch":{"by_text":"添加管理卡片"}}`；`{"action":{"type":"touch",…}}` 为兼容形态，勿与 direct 混用。
- **禁止**在步骤列写 `start_app`（harness 已 `aa start` 预启）；**禁止** `dump_ui` / CLI 命令名作为根键。
- 同格多步用 **`;` 或 `；`** 拼接；**禁止** `<br/>`；格内禁止未转义 `|`。
- 派生前可读 `npm run derive-hylyre-plan-hint` / `derive-adhoc-hylyre-hint` 输出；若 `snapshot_cache_empty: true` 先 warmup 或 `dump-ui`。
- 模板与范例：**test-plan-hylyre-template.md**（已无反引号示例）。

#### Step 4.5.4 裁决与跳过登记

- 维护「**进入派生** / **跳过**」两份清单；跳过的须在 Step 5 报告中逐条可见。
- 派生表中的 **用例编号** 必须 ⊆ 顶层 `test-plan.md`（否则 harness **extra** FAIL）；顶层每一个 TC 必须 **出现于派生表** 或 **`explicit_skip_tc_ids`** 登记中（否则 harness **missing** FAIL）。

#### Step 4.5.5 落盘

- 创建目录：`doc/features/<feature>/testing/reports/<timestamp>/hylyre/`（`<timestamp>` 建议本地 sort 友序，如 `20260519-143000`）。
- 写入 **`test-plan.hylyre.md`**：锚点 **`## 测试用例清单`** + **7 列表头**（顺序固定），自 profile 模板拷贝表头行。
- 随后由你（agent）触发 **`harness-runner --phase testing --feature <feature>`**（见 Step 7）；宿主顺序为 **build → install → ensure Hylyre → run plan**（profile 未 SKIP 时）。

**profile 为 generic / `device_test.run` 为 SKIP**：跳过 §4.5 与 Hylyre，按该 profile 的人工或其它自动化约定执行。

### Step 4.B 即席模式（ad-hoc · 不绑正式需求）

当本回合按上文「模式分支」判定为 **即席**：

1. **Derive hint**（机械切分 NL + cache 提示，**不跑机**、**不**把 NL 翻译成 Hylyre JSON）：
   ```bash
   cd framework/harness && npm run derive-adhoc-hylyre-hint -- \
     --bundle <bundleId> --steps "打开应用->点击…->…"
   ```
   或等价：`npm run adhoc-device-test -- --bundle <bundleId> --steps "…"`（仅 derive，写 `derive-adhoc-last.json`，stderr `ADHOC_DERIVE_FILE=`）。
   关注 `snapshot_cache_empty`、`cache_layout_expected`、`cache_layout_mismatch`、`selector_hints`、`steps_file_contract`、`observation_steps`、`forbidden_in_steps`。
2. **Agent 写 Hylyre JSON**：读 derive 的 `steps_file_contract`、`step_shape_catalog`；**可选** `steps_file_minimal_example`（仅 touch 机械映射，**可整段替换**）。手写 **`doc/features/_adhoc/testing/staging/test-steps.json`**（`steps_file_contract.recommended_write_path`；探索/汇总类 NL **不进** steps）。**禁止**向 `framework/harness/` Write 即席 steps / trace / report；**禁止**向 `doc/app-snapshot-cache/<bundle>/` 根目录 Write page JSON（cache 仅 `pages/` 由 page save 写入）。写后**先** `npm run lint-adhoc-steps -- --file <path>`（可加 `--normalize`），通过后再跑机（**STEP-TOUCH** / **STEP-002 start_app** 须在 lint 阶段清零）。
3. **执行**（勿手工拼 `hdc` / `hylyre`）：
   ```bash
   cd framework/harness && npm run adhoc-device-test -- \
     --bundle <bundleId> \
     --plan path/to/test-plan.hylyre.md
   ```
   或 `--steps-file path/to/test-steps.json`（推荐 staging 路径）。执行报告**永远**落在 `doc/features/_adhoc/testing/reports/<timestamp>/hylyre/`（stderr **`ADHOC_HYLYRE_RUN_DIR=`** / **`ADHOC_TRACE_FILE=`**）；steps-file 路径仅作输入。可选：`--ability MainAbility`、`--skip-explore`、`--accept-cold-start`（**仅跳过 snapshot warmup**，非 UI 复位）、`--skip-page-save`、`--dump-ui-only`、`--observe-ui`。**默认 execute 冷重启**（`hdc aa force-stop` + `aa start`）；保留 Nav 栈调试加 **`--continue-session`**。stderr：`ADHOC_COLD_RESTART=`、`ADHOC_UI_RESET_RECOMMENDED=`（读固定 `device-test-run.meta.json`，非本次新 timestamp trace）、`ADHOC_CACHE_LAYOUT_MISMATCH=`、`ADHOC_STEPS_OUTSIDE_CANONICAL=1`（steps 不在 `doc/features/_adhoc/` 时 warn）。
4. **观察汇总决策树**（含「查看/汇总/所有/列表」类 NL）：
   - touch 步骤**只写到导航终点**；**禁止**在 steps-file 写 `dump_ui`（STEP-002）
   - run 成功后：`npm run adhoc-device-test -- --bundle <id> --dump-ui-only` → stderr `ADHOC_DUMP_UI_PATH=`
   - 汇总：`npm run summarize-adhoc-dump -- --file <dump路径>` → `ADHOC_SUMMARY_JSON=`
   - 或 touch-only NL：`--observe-ui --steps "…"`（复杂 NL → `ADHOC_NEED_AGENT_STEPS=1`）
5. **进度锚点**：stderr 含 `ADHOC_PHASE=`、`ADHOC_RUN_DONE=`；run 结束后**先**交付 cases 摘要，再 dump/汇总。

#### Hylyre 误导性报错对照（即席必读）

| 报错关键词 | 真实含义 | 先做 |
|-----------|---------|------|
| 「非 JSON」+ action 示例 | 步骤未被识别为 JSON（**常见：反引号**） | 去掉反引号；读 `plan-lint.json` |
| `--plan` 不能、`--steps-file` 能跑 | Markdown 表格格式问题 | agent 修正 plan 或改用 `--steps-file` |
| start_app 相关失败 | 重复冷启或嵌套 `action.type` | 删步骤内 start_app；预启交给 harness |
| STEP-002 禁止 dump_ui | 观察型 NL 误写进 steps | 导航 run 后用 `--dump-ui-only`，勿写进 JSON |
| `wait requires seconds` | `wait` 误用 `timeout` 或缺 `seconds` | 改用 `{"wait":{"seconds":N}}`；写前跑 `lint-adhoc-steps` |
| `Unsupported touch payload` / STEP-TOUCH | touch 嵌套 `selector` | 改用 `{"touch":{"by_text":"…"}}`；写前跑 `lint-adhoc-steps` |

5. 使用保留目录名 **`_adhoc`**；**bundle** 必须用户声明。默认 **单 TC-001**；步骤 **裸 JSON 数组**、**不含 start_app**。
6. **不跑** `harness-runner --feature _adhoc`；执行链 **`ensureHylyreReady`** → resolve ability →（可选）warmup → lint → run。**禁止**未 ensure 前让用户 pip install。
7. **不写** receipt / verifier；交付 **`trace.json` cases[]** 摘要；观察型另交付 dump 汇总。
8. **ensure 失败**：Read `hylyre-doctor.log` / `hylyre-ready.meta.json` 后 agent 重跑。
9. **快照**：默认 run 后 `app page save`；`--skip-page-save` 或 `--observe-ui` 可跳过。
10. **结果 SSOT**：`ADHOC_TRACE_FILE=` / `ADHOC_DERIVE_FILE=` / `ADHOC_HYLYRE_RUN_DIR=`；**禁止 glob timestamp**。
11. **重跑 / UI 复位**：execute **默认冷重启**（清 Nav 栈）；前次 run 非全 pass 后**禁止**在未复位时假设仍在首页 Tab。`--continue-session` 显式保留 Nav 栈；若见 `ADHOC_UI_RESET_RECOMMENDED=1` 须去掉 `--continue-session` 或确认已冷重启。`--accept-cold-start` **只**跳过 snapshot warmup，**不能**代替冷重启。
12. **warmup 软失败**：仍继续 run（`[WARN]`）。

### Step 5: 生成测试报告（测试执行后）

**标准模式**下，在 **`testing` harness PASS** 且 Hylyre 已写出 `testing/reports/<timestamp>/hylyre/trace.json` 之后，读取测试报告模板：

```
framework/profiles/<project_profile.name>/skills/6-device-testing/templates/test-report-template.md
```

#### Step 5.1 自 Hylyre trace 回填执行状态（必做）

1. 读取 **`doc/features/<feature>/testing/reports/device-test-timing.json`**（harness 在 `device_test.run` 成功后写入）。填充测试概览 **「真机流水线耗时」** 表（区分 `build_reused` / `install_reused` 与 `hapBuiltAt`）；在执行结果表增加 **耗时** 列（来自 `cases[].duration_ms`，格式如 `12.4s`）。
2. 解析 **`trace.json`**：`cases[]` 中每条含 **`id`**（与派生表 `用例编号` 对齐）、**`status`**（**通过 / 失败 / 阻塞 / 跳过**）、**`notes`**（可选）。
3. **构建行集**：
   - 对 **派生表中出现**的 TC：以 **`cases[]`** 为准写状态与备注；若某 TC 无 case 记录但 run 整体失败 → 标 **阻塞** 或 **失败** 并注原因。
   - 对 **仅在顶层 `test-plan.md`、未进派生表**的 TC：**跳过**，备注示例：「缺少稳定 selector，需补 design.md / contracts.yaml」。
4. **不要**与 Hylyre 状态枚举混用其它字样（门禁与 receipt 校验依赖一致词表）。

#### Step 5.2 模板五章与结论

按模板填充 **测试概览 / 测试执行结果 / 缺陷清单 / 通过率统计 / 结论**：

1. **测试概览** — 日期、环境、执行人、**计划 TC 总数**、**纳入自动化的 TC 数**、**跳过数**。
2. **测试执行结果** — 表：用例编号、状态、备注（可含 hylyre `notes`）。
3. **缺陷清单** — 失败用例对应缺陷编号、严重度、状态。
4. **通过率统计** — 按 P0/P1/… 与总体。
5. **结论** — **达标 / 有条件达标 / 不达标**（规则同下表）。

**执行状态值域**: 通过 / 失败 / 阻塞 / 跳过

**缺陷严重程度**: BLOCKER / MAJOR / MINOR

**缺陷状态值域**: 待修复 / 已修复 / 已关闭 / 延期处理

**结论判定规则**：

| 条件 | 结论 |
|------|------|
| P0 通过率 = 100% 且总体通过率 ≥ 通过标准阈值 | 达标 |
| P0 通过率 = 100% 但总体通过率 < 阈值 | 有条件达标 |
| P0 通过率 < 100% | 不达标 |

**即席模式**：无强求写 `doc/features/<正式>/test-report.md`；可将摘要写入对话，或将一份简短 markdown 存于同次 `.../_adhoc/.../hylyre/` 旁供用户自取。

### Step 6: 质量门禁自检

生成测试计划和测试报告后，分别执行自检清单。

**测试计划自检**：

```
[ ] 1. 必需章节：测试范围、测试环境、测试用例清单、测试策略、通过标准、风险与依赖是否齐全？
[ ] 2. 用例清单格式：表头是否包含编号、名称、前置条件、测试步骤、预期结果、优先级、关联 AC？
[ ] 3. 优先级值域：是否仅使用 P0/P1/P2/P3？
[ ] 4. acceptance device 层：每条 ut_layer∈{device,both} 的 AC/BD 是否至少生成 1 条 TC（步骤对齐 device_focus）？
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

> **Hylyre ensure**：本步骤 **agent 自跑** `testing` harness 时，profile **`device_test.run`** 会在跑 plan 前自动 **`ensureHylyreReady`**（创建/对齐 `.hylyre/venv`、vendor wheel pip 安装/升级、可选 `hylyre doctor`）。vendor 发布件更新后，**用户只需用自然语言重新发起 Skill 6**；本 Step 7 自跑 harness 即会自动 ensure/升级，无需用户单独安装命令、手删 venv 或直接执行 harness 脚本（`HYLYRE_PYTHON` / `auto_install=false` 除外，见 profile addendum）。

> **全局入口 §4.1 明示授权**：本步骤的 harness 与 verifier 调用都由主 agent 自己执行，
> **严禁**仅"告知用户可运行"然后结束对话——属软幻觉，由物理拦截层兜底。

测试文档归档后，agent **必须自己**完成下列验证，再宣布真机测试阶段完成。

#### 7.1 脚本 Harness（确定性检查，agent 通过 Shell 工具自跑）

```bash
cd framework/harness && npx ts-node harness-runner.ts --phase testing --feature {module-name} --summary --failures-only
```

agent 执行后必须 Read 退出码与报告文件；BLOCKER 必须修复后重跑。
优先读取 `doc/features/<feature>/testing/reports/summary.json`；其中 `testing_run_status` 的 `can_claim_done` 必须为 `YES`，否则不能宣称真机测试阶段完成。

脚本读取以下 Spec 文件执行自动化检查：
- `framework/specs/phase-rules/testing-rules.yaml` — 阶段级通用规则
- `doc/features/{module-name}/acceptance.yaml` — 功能级验收标准（追溯检查）

**脚本检查覆盖项**：

| 检查类型 | 检查内容 | 严重级别 |
|----------|---------|---------|
| 真机构包（可选宿主 BLOCKER） | profile `device_test.build`：宿主门禁产出 signed 应用包 | BLOCKER / SKIP |
| 真机装机（可选宿主 BLOCKER） | profile `device_test.install`：将上一步包安装到已连接设备 | BLOCKER / SKIP |
| 真机自动化（profile capability） | profile `device_test.run`：消费派生测试用例并产出原始 report + trace | BLOCKER / SKIP |
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

> **标准 feature 模式**适用下文四条件。**即席（`_adhoc`）模式**不宣称「某需求 testing 阶段闭环」：不写 receipt、不强求本机 `harness-runner testing --feature _adhoc` PASS、不要求 verifier；以向用户交付 **`trace.json` 摘要**（及可选本地 hylyre 报告）为主。

真机测试阶段宣布"完成"前必须**同时**满足：

1. `doc/features/<feature>/testing/reports/trace.json` 真实存在；
2. 脚本 harness 退出码 0、零 BLOCKER；
3. verifier 子 agent 报告 verdict = PASS；
4. 完成回执 `doc/features/<feature>/testing/phase-completion-receipt.md` 已填写并通过 `cd framework/harness && npx ts-node scripts/check-receipt.ts --feature <feature> --phase testing` 校验。

| 验证层 | 通过条件 |
|--------|---------|
| 脚本 Harness | 零 BLOCKER（agent 自跑） |
| AI Harness | verdict = PASS（agent 通过 Task 触发 verifier） |
| 完成回执 | check-receipt.ts 退出码 0 |
| trace.json | 文件存在且 schema 合法 |

四项全部通过后，真机测试阶段完成（最终环）。**闭环停等（BLOCKER）**：须 **`phase.next_step`** 汇报交付摘要并停等；**禁止**因「流水线已走完」而自动开其它 Skill。物理拦截层会读 `framework/harness/state/.current-phase.json` 与上述四份凭证决定能否放行。
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
  - **`doc/features/{module}/acceptance.yaml`（含 device_focus，★派生 test-plan 的 SSOT）**
  - `doc/features/{module}/PRD.md`（Skill 1 输出）
  - `doc/features/{module}/design.md`（Skill 2 输出）
  - `doc/features/{module}/use-cases.yaml`（Skill 2 v2 输出，了解 UT 已覆盖分支）
  - 源代码（Skill 3 输出，可选参考）
  - UT 代码 + DAG（Skill 5 输出，可选参考）
  - `doc/features/{module}/acceptance.yaml`（Skill 1 产出的验收标准 Spec；按 ut_layer 过滤使用）
  - `doc/features/{module}/contracts.yaml`（Skill 2 产出的接口契约 Spec）
- 阶段级规约: `framework/specs/phase-rules/testing-rules.yaml`
- 脚本 Harness: `framework/harness/scripts/check-testing.ts`
- 派生提示 JSON（缺失派生计划时由 check-testing 写入）：`doc/features/<feature>/testing/reports/derive-hint-from-plan.json`
- 顶层计划结构化抽取 CLI：`cd framework/harness && npm run derive-hylyre-plan-hint -- --feature <feature>`
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
3. **acceptance.yaml 派生**：按 `ut_layer∈{device,both}` 与 `device_focus` 生成/更新 test-plan；勿再维护 `device-testing-todo.md`
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

- **路径约定**：`doc/features/<feature>/testing/reports/<timestamp>/<model>-devtest/trace.json`
- **Schema**：[framework/harness/trace/trace.schema.json](../../framework/harness/trace/trace.schema.json)，`phase` 字段填 `testing`。
- **痛点回填**：同目录 `gap-notes.md`，模板见 [framework/harness/trace/gap-notes.template.md](../../framework/harness/trace/gap-notes.template.md)。
