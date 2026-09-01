---
name: framework-init 误触发纠偏 — Git/SCM L0 路由与 Skill 意图早退
version: 3.0.0
# 独立入口路由纠偏 plan。2026-09-01 宿主事故中，framework-init 被附加/选择的来源未知；
# 已证缺口是 Skill 一旦被选择，canonical/command 入口没有 Git 主动作早退与最新意图终止，
# 因而进入 readiness/S1。init 内核正常，且与 runtime Git dirty/integrity 退场无因果关系。
# 本 plan 只修入口适用性、最新意图切换与模板物化契约，不实施代码、不修改 OpenSpec、
# 不操作宿主、不执行 framework-init、不提交或推送。
# 2026-09-01 发布后宿主回归又证明：显式 Skill 调用被误当被动提及，Git L0 早退又误终止
# 整个用户任务。T1–T7 保留历史完成事实，本轮只以 T8/T9 重新打开契约与验收。
todos:
  - id: t1-contract-freeze-and-evidence-boundary
    content: T1 冻结事故归因、证据边界、路由优先级与非目标：以宿主 20260901T074531Z run-log/summary 证明唯一真实 S3 是正常 UPDATE、run-global-phases PASS、init 未执行 Git；明确 Skill 被附加/选择的来源未知，bridge description 收窄只是前置防误选，已证根因是被选中后的入口无 Git 主动作早退和最新意图终止；把最新取消意图 > Git/SCM 主动作 L0 > 明确 init 动作 > 有本轮 S1 上下文的合法 S2 continuation 写成单一契约，不引入 Git 判断、router 服务或持久状态。
    status: completed
  - id: t2-shared-description-and-canonical-skill
    content: T2 以现有 `skills/skills.index.yaml.description` 冻结 framework-init 机器 description SSOT：收窄 index 文案，删除 `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS`，materializer 复用现有 index loader，不新增 frontmatter parser；shared bridge/command metadata 作为派生或机械一致性对象。canonical Skill 必须替换并压缩现有触发段而非追加，在 260 行预算内保留紧凑适用性门、主动作优先、最新意图终止与合法 S2 continuation，详细例句进入单一条件加载 reference，早退仍位于 Tier_1/readiness/S1 前。
    status: completed
  - id: t3-agents-l0-route-and-index-alignment
    content: T3 在 `templates/AGENTS.md.template` 的 L0/L1/L2 路由中明确 Git status/diff/add/stage/commit/push、整理暂存区与版本控制归档属于 L0 direct；同步 `skills/README.md` 对 framework-init 前置的适用范围，声明 framework 名词不等于 init 意图，并让 AGENTS/README 摘要与 index description SSOT 机械相容；仅在确有冲突时收窄 shared framework rules，不扩写无关执行规范。
    status: completed
  - id: t4-materialization-single-source-consistency
    content: T4 收口 bridge/command 物化与执行顺序：复用现有 index loader、check-init、adapter template 与 materializer，让 Codex/Cursor/Chrys/Generic/OpenCode bridge description 逐字等于 index SSOT；把 Claude/CodeAgent/Cursor 纳入显式 command 客户端组，command 收窄为薄入口，任何 S0/readiness 文本前必须先读 canonical applicability gate，由 canonical 决定 L0 早退或继续 S0→S4，不复制完整负向表。机器断言 gate/canonical 读取顺序先于 `init-readiness`/S0，保留双入口目录、update_policy 与 interaction renderer。
    status: completed
  - id: t5-internal-routing-contract-fixtures
    content: T5 新建独立 `framework-init-routing-contract` unit suite 并在既有 unit runner 注册，不混入 capability YAML 的 skill-contract suite。canonical 用稳定锚点包住 4 组正向与 6 组负向示例的逐字输入/expected_route；测试只解析锚定块并做精确存在性、唯一性、标签及位置检查，同时读取 skills index、shared bridge、Claude/CodeAgent/Cursor command 与 AGENTS template，断言 description 单源、command/canonical gate 顺序和合法 S2 continuation。不得宽松 grep，也不得把 fixture 变成关键词 router。
    status: completed
  - id: t6-init-core-and-materialization-regression
    content: T6 运行 Maison 内部定向反回归：既有 init probe/planner/executor、CREATE/UPDATE、adapter 确认、cleanup-deprecated、run-global-phases 接线保持不变；index 派生的 description、canonical applicability gate 与 AGENTS L0 在 Claude/CodeAgent/Codex/Cursor/Chrys/Generic/OpenCode 入口中机械闭合；`framework-init/SKILL.md ≤ 260` 且 `skill_body_max_lines` PASS；源码与测试反向证明没有新增 Git 输入、bypass、持久路由状态或 init 内核改造。
    status: completed
  - id: t7-validation-and-host-handoff
    content: T7 按发布内容风险完成 typecheck、定向 suite、最终 `cd harness && npm test`、plan-version 与 diff/LF；交付说明只给宿主人工复验两句——正向“集成新发布件后刷新全部 adapter”应进入 framework-init，负向“整理下 framework 及其衍生物并提交，不相关的别动”应只走 Git L0、不出现 S1。coder 不自动操作 SimulatedWalletForHmos，不把真实宿主/真实 Codex 行为作为 Maison 内部完成阻断项。
    status: completed
  - id: t8-explicit-invocation-and-l0-continuation-handoff
    content: T8 修复显式 Skill 调用与 L0 continuation handoff 契约：平台中性地区分显式选择/调用、被动提及和竞争主动作；Codex 裸 `$framework-init`、各 slash command、bridge 显式选择在无否定/竞争动作时直接进入既有 Tier_1→S1，不再二次澄清；Git/SCM 命中只退出 init 子流程并立即继续完成最新 Git L0 主动作，不解释 init 规则、不询问是否执行、不运行 readiness/S1/planner/harness；route 统一改为 `exit_init_continue_git_l0`，双动作使用 `git_l0_then_framework_init`，保留 S2 批准与全部 init 内核。
    status: completed
  - id: t9-regression-validation-and-host-evidence-handoff
    content: T9 更新 canonical 锚定样例、独立 routing-contract、AGENTS/command/bridge 物化矩阵与宿主人工复验交付：精确覆盖 10 组显式调用/被动提及/Git continuation/双动作输入，断言退出 init 不等于结束本轮、Git 主动作继续完成、零 init 解释/澄清与零 readiness/S1；反向证明无关键词 router、Git 状态判定、config/env key、token/租约/持久 route state。按风险运行定向与完整 Maison 验收，宿主仅由用户用新发布件人工复验。
    status: completed
overview: >
  继续修复 framework-init 意图边界：显式 Skill 调用直接进入 init，被动提及不触发；Git/SCM
  主动作只退出 init 子流程并继续完成 L0 任务，不能把 early-exit 变成结束用户请求。skills index
  仍是 description SSOT，canonical/commands 保持 gate-first，S1→S4 与 S2 批准不变，不新增 router 状态。
---

# framework-init 误触发纠偏：Git/SCM L0 路由与 Skill 意图早退（d3a7f1c8）

状态：**T1–T7 已完成；因 2026-09-01 真实宿主回归重新打开 T8/T9，本轮仅修订 plan、待 review。**

## 0. Plan 身份、授权与边界

| 项 | 冻结值 |
|---|---|
| plan id | `d3a7f1c8` |
| version | `3.0.0` |
| 开发仓 | `D:/1.code/agent-maison-br` |
| 事故宿主 | `D:/1.code/SimulatedWalletForHmos`，只读证据，不由实施者操作 |
| 责任域 | framework-init 的发现 description、适用性早退、最新意图切换、AGENTS L0 与物化一致性 |
| 非责任域 | init planner/executor、runtime Git integrity、goal/provider/Hylyre、真实客户端语义实现 |
| 本轮允许写入 | 仅本 plan 文件 |
| 本轮禁止 | Skill/模板/生产/OpenSpec/宿主修改；framework-init；产品测试；Git add/commit/push |

本 plan 是独立纠偏，不回开 `framework运行时Git解耦_发布件更新不依赖宿主提交_c3d8e1f6`。两者关系只有一条：普通 phase 与宿主 Git 状态解耦后，Git 提交请求仍可能在更上游的自然语言入口被误路由；这是既有触发契约缺口，不是 runtime Git 解耦产生的新机制。

## 1. 只读证据与根因

### 1.1 事故时间线

用户主动作是整理并提交版本控制改动：

> “整理下 framework 及其衍生物并提交，不相关的别动”

实际却发生：

1. Agent 进入 framework-init，执行 readiness/S1 并提出 task plan、materialized adapters 确认；
2. 用户按错误提示给出批准，随后产生一次真实 UPDATE；
3. 用户明确纠正“停止 init，只提交代码”；
4. 再次给出同类 Git 请求后，Agent 又进入 S1。

### 1.2 宿主事实

只读证据：

- `D:/1.code/SimulatedWalletForHmos/framework/harness/reports/_global/init-orchestrate/20260901T074531Z/run-log.json`
- `D:/1.code/SimulatedWalletForHmos/framework/harness/reports/_global/init-orchestrate/20260901T074531Z/summary.md`

证据冻结：

- 只有一次真实 S3/init run；第二次误路由只到 S1；
- 该 run 是 `mode=update`、`decision_mode=smart`，`executed=15`、`skipped=6`、`failed=0`；
- `run-global-phases` 正常完成 catalog/glossary/docs；
- init 执行的是 config、entry/rules、各 adapter 物化、gitignore、cleanup 与 global phase，没有 Git add/commit/push task；
- 因此 planner、executor 和 global phase 不是事故根因，不能为修入口而改写。

### 1.3 已证根因、未知项与防御面

```text
普通 Git/SCM 请求
  └─ framework-init 已被附加/选择（来源 unknown）
      └─ canonical/command 入口没有 Git 主动作适用性早退
          └─ 进入 readiness → S1
              └─ 用户纠正未被建模为“退出 init 子流程、继续完成 L0 主动作”
                  └─ 后续同类请求再次进入未设防的入口
```

已证事实只到“Skill 已在上下文中且入口继续执行”，不能从现有记录区分：用户手工附加、Codex UI 自动附加、模型依据 description 选择，还是前一轮 Skill 上下文继续生效。bridge description 从 2026-06-08 起即存在且本次发布未修改，因此它是应收窄的**防误选风险面**，不是已证唯一直接原因。

OpenAI Docs 仅确认 Skill 对象具有 `description` 元数据，并建议把路由指令写得 task-specific、明确哪些工作保持 direct；官方资料没有公开 Desktop Skill 自动选择算法。因此本 plan 不声称 description 必然触发 Desktop 选择：

- [OpenAI Skills API：Skill 含 description](https://developers.openai.com/api/reference/python/resources/skills/methods/create)
- [OpenAI model guidance：Make routing instructions task-specific](https://developers.openai.com/api/docs/guides/latest-model)

已证根因仍发生在 init/harness/Git 检查之前：Skill 一旦被选择，入口没有早退。不能用 init 是否成功、framework 是否 dirty、是否 staged 或已提交来修复。

### 1.4 发布后真实宿主回归（T8/T9 新证据）

宿主 canonical 与 Maison 源文件一致；以下截图是发布后真实客户端行为，不是覆盖失败、planner/executor 或 runtime Git 问题：

1. `C:/Users/shengqsq/AppData/Local/Temp/codex-clipboard-b30c5a2f-f937-400b-9ff1-2da3e07e6a91.png`
   - 用户单独显式发送 `$framework-init` Skill chip；
   - Agent 因 canonical 的“仅出现 `$framework-init` 不构成 init”而拒绝进入 init，并要求用户再次澄清；
   - 证明旧契约没有区分**显式 Skill 调用**与被动字面提及。
2. `C:/Users/shengqsq/AppData/Local/Temp/codex-clipboard-9b749199-2fce-4610-bbcc-68c1149fd059.png`
   - 用户要求“现在整理下 framework 及其衍生物并提交，不相关的别动”；
   - Agent 正确做到零 readiness/S1，却只解释 init 规则并停止，没有继续整理、暂存和提交；
   - 证明旧验收只覆盖“退出 init”，没有覆盖**回到并完成原 Git L0 主动作**。

T8/T9 不推翻 T1–T7 的历史完成事实：description SSOT、gate-first、零 runtime Git 判定等能力均已成立；这里只纠正显式调用语义、continuation handoff 和相应验收。

## 2. 必须保留与禁止方案

### 2.1 framework-init 内核保持原样

以下能力不因误触发纠偏改变：

1. `Tier_1 readiness → S1 → S2 → S3 → S4` 编排；
2. S1 只读 `InitTaskPlan`；
3. `init.task_plan` / `init.materialized_adapters` / `init.task_decision` 确认；
4. config 无损 CREATE/UPDATE 与 architecture DSL preflight；
5. adapter/entry/rules 物化；
6. `cleanup-deprecated`；
7. `ensure-gitignore` / `harness-install`；
8. `run-global-phases`；
9. S4 run-log/summary 与动态 next steps。

“不完整重构 framework-init”是硬边界：适用性门位于现有流程之前，进入流程后仍执行同一内核。

### 2.2 禁止方案

实施不得引入：

- 新 router 服务、NL 分类模型、状态机或第二份 Skill registry；
- 持久化会话状态、route token、租约、baseline 或场外状态；
- 环境变量/config bypass；
- Git clean/dirty、tracked/untracked、HEAD/ref 作为路由输入；
- 自动提交或以提交成功反推 init 适用性；
- updater 标志、allowlist 或“Git/非 Git 双模式”；
- 对 `init-orchestrate.ts`、`init-task-executor.ts`、goal、provider、Hylyre 的无关重构；
- 修改 runtime Git identity/integrity、Git dirty check、宿主 Git 状态或发布件集成拓扑；
- 扩面处理 provider per-TC binding；
- 逐 adapter 手工复制完整正向/负向触发表。

## 3. 路由契约与优先级

### 3.1 单一优先级

每条消息先识别**主动作**，再看对象名词；优先级从高到低固定如下：

| 优先级 | 当前消息事实 | 结果 |
|---:|---|---|
| 1 | 明确取消/纠正未完成 init | 只退出 framework-init 子流程并清空未执行 S2 意图；同一消息另有 Git 主动作时为 `exit_init_continue_git_l0` 并立即继续，另有代码等主动作时同样继续该动作。只有“不要继续 init”且无其它主动作时才 `exit_init` 并等待 |
| 2 | 用户明确给出多动作及顺序，例如“commit 后执行 `/framework-init`” | `git_l0_then_framework_init`：先完整完成获授权的 Git L0，再进入明确的 framework-init；不得让后续纯 Git 规则吞掉第二动作 |
| 3 | Git-only 主动作：status/diff/add/stage/commit/push、整理暂存区、只提交 staged、归档版本控制改动；即使混有无顺序的 Skill 名称/链接 | `exit_init_continue_git_l0`：零 readiness/S1/planner/harness，零 init 规则解释/澄清，立即按 AGENTS L0 和用户文件范围/push 授权完成 Git 主动作 |
| 4 | 无否定、引用或竞争主动作的显式 framework-init 调用/选择；或明确接入发布件、迁移 config、刷新 adapters | `framework_init`：直接进入既有 Tier_1 readiness→S1，不再询问“是否执行 init”；S3 仍须原 S2 批准 |
| 5 | 当前未完成流程确有本轮真实 S1 `InitTaskPlan` 已展示，用户回复合法 `计划=...；adapter=...` 批准 | `continue_current_init_s2`：继续现有 S2→S3；不重新跑一套入口判断或另建状态 |
| 6 | Skill 名称、链接、framework 名词仅被引用/解释/否定/写日志，或附着在其它明确主动作上 | 被动提及不单独触发 init；继续当前主动作，必要时按普通歧义处理 |

显式调用采用平台中性语义、平台样例仅用于测试：Codex 单独 `$framework-init` chip；Claude/CodeAgent/Cursor/OpenCode 的 `/framework-init`；bridge 型客户端显式选择该 Skill 且无其它主动作。裸显式调用本身就是 init 授权，不得再问一次“是否执行”；但它不替代 S2 对 task plan/adapters 的批准。

混合主动作必须先于 Git-only 裁决：例如“commit 后执行 `/framework-init`”为 `git_l0_then_framework_init`，先完整完成 Git L0，再执行明确的第二动作；不得丢掉第二动作。Git-only 请求则只走 `exit_init_continue_git_l0`，不得在 Git 完成后自行重进 init。顺序只来自当前消息，不持久化 route state。

### 3.2 正向适用性闭集

Maison 发布的 description/canonical 只声明以下明确动作；description 收窄用于降低误选风险，不代表 Maison 能证明或控制 Desktop 的选择算法：

- 首次接入 Maison 已验证发布件并初始化项目级 config/入口；
- 集成新发布件后刷新 config、adapter 或 materialized artifacts；
- 创建、补齐或迁移 `framework.config.json`；
- 显式调用/选择 framework-init：Codex 单独 `$framework-init`，slash 客户端 `/framework-init`，bridge 客户端显式选择 Skill 且无其它主动作；
- 明确重新物化 `materialized_adapters`；
- 当前对话已展示本轮真实 S1 plan 后，对 task plan/adapters 的合法批准。

不能把“升级 framework”保留成无宾语、无动作边界的宽触发；它必须落到“已经集成新发布件，现在刷新项目级产物”或显式 Skill 调用。被引用、解释、否定、记录或与 Git 主动作混装的同名文本不是独立触发。

### 3.3 Git/SCM L0 排除闭集

在 §3.1 优先级 2 的明确有序多动作已经先行裁决后，以下 **Git-only** 主动作一律不适用 framework-init：

- `git status` / `git diff`；
- add / stage / commit / push；
- 整理暂存区、只提交当前 staged 文件；
- 整理 Framework 及其物化/衍生文件并提交；
- 查看 Framework 更新产生的 Git 变化；
- 归档、提交或推送版本控制改动。

排除判断只看消息语义，不执行 Git 命令来“确认是不是 Git 请求”。命中后必须执行 continuation handoff：退出 init 子流程但**不结束本轮用户任务**，不输出 init 规则解释、不询问是否执行 init，立即按用户指定文件范围、staged/unstaged 范围与 push 授权完成原 Git/SCM 主动作。

### 3.4 进入前早退与中途切换

canonical Skill 的结构顺序必须变为：

```text
适用性与最新意图门
  ├─ 取消/纠正 → 纯取消为 exit_init；另有 Git 为 exit_init_continue_git_l0，其它主动作同样继续
  ├─ 明确有序多动作 → git_l0_then_framework_init → 顺序完成两项
  ├─ Git-only 主动作 → exit_init_continue_git_l0 → 零 init 输出/执行，继续并完成 Git L0
  ├─ 显式 Skill 调用且无竞争主动作 → framework_init → Tier_1 readiness → S1 → S2 → S3 → S4
  ├─ 本轮真实 S1 后合法批准 → continue_current_init_s2 → S2 → S3
  └─ 被动提及/其它主动作 → 不单独触发 init，继续当前主动作
```

S1 已运行但 S3 未执行时，最新用户消息是新的权威意图。取消/纠正不会生成持久状态；只停止当前对话中的未完成 init 子流程。若消息还要求提交/查看 Git，必须继续完成该主动作；只有纯“不要继续 init”才退出后等待。下一次同类 Git 请求仍靠当前主动作路由，不依赖“曾取消”的 token。

### 3.5 合法 S2 continuation

`计划=<...>；adapter=<...>` 只有在当前对话中存在以下全部事实时才是 S2 continuation：

1. 该轮已经通过适用性门；
2. 实际运行并展示了当前发布件、本项目、本轮的 S1 `InitTaskPlan`；
3. task plan 与 adapter 选项来自该 S1 输出；
4. 最新消息没有取消或切换为 Git-only 主动作。

没有这些上下文时，这类片段不能独立触发 init。这里使用当前对话事实，不落盘、不加 nonce/token/租约。

## 4. SSOT 收口与文件级改造

### 4.1 T1–T7 已完成的 SSOT 基线

以下均是当前已成立、T8/T9 只做反回归审计的事实，不得重新实施：

- `skills/skills.index.yaml.description` 已是 framework-init **机器 description 唯一 SSOT**；
- dynamic bridge/materializer 已从 index entry 取 description，`BUILTIN_SKILL_BRIDGE_DESCRIPTIONS` 已删除；
- checked-in shared bridge 与 Claude/CodeAgent/Cursor command metadata 已与 index 机械一致；
- canonical applicability gate 已位于 `## 前置声明`、Tier_1 readiness、S1 与 planner/harness 之前；
- Claude/CodeAgent/Cursor command 已是 gate-first 薄入口，Cursor command + bridge 双入口已纳入；
- `templates/AGENTS.md.template` 已明确 Git status/diff/add/stage/commit/push 为 L0 direct；
- 既有独立 `framework-init-routing-contract` suite 已注册；
- init planner/executor、S1→S4、description 物化链与 adapter 拓扑保持原样。

机器职责继续冻结为：index description 是发现元数据 SSOT；canonical 是显式调用/被动提及/优先级/continuation 行为 SSOT；AGENTS 是全局 L0 摘要；command/bridge 是派生入口；fixture 只验证文本契约且不被生产读取。不得新增 route map、frontmatter 生产 parser 或平行 registry。

### 4.2 文件级迁移边界

#### 4.2.1 T1–T7 已完成，仅 audit-only

| 文件/能力 | T8/T9 处理 |
|---|---|
| `harness/scripts/utils/resolve-skill-path.ts` | 只确认继续从既有 index loader 提供 description；不改类型/路由逻辑 |
| `harness/scripts/utils/agent-bundle-paths.ts` | 只确认不存在 `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS` 或其它 literal map；不重做删除 |
| `harness/scripts/utils/materialize-agent-bundle-skills.ts`、`harness/scripts/utils/instance-skill-bridge.ts`、`harness/scripts/utils/init-task-executor.ts` | 只确认 framework root 传递、index description 与物化入口仍单源；无新生产改造 |
| adapter yaml、目录映射、update policy、interaction renderer | 只做现有一致性回归；不改变入口拓扑或 S2 交互 |
| init planner/executor、S1→S4、runtime Git identity/integrity | 不改；仅由既有 suite 证明未回归 |

#### 4.2.2 T8/T9 实际修改文件

| 文件 | 计划动作 |
|---|---|
| `skills/project/framework-init/SKILL.md` | 在**现有** gate/锚定块内原位替换优先级、立即动作和 10 条样例：显式调用、纯取消、有序双动作、Git continuation、合法 S2；不得新增第二 gate/reference/registry |
| `skills/skills.index.yaml` + `agents/shared/agent-bundle/templates/skills-bridge/framework-init/SKILL.md` | 把 slash-only description 原位改为平台中性的“显式选择/调用 framework-init”；shared bridge metadata 机械同步，不改 SSOT 接线或增加第二 writer |
| `agents/claude/templates/commands/framework-init.md`、`agents/codeagent/templates/commands/framework-init.md`、`agents/cursor/templates/commands/framework-init.md` | 保留既有 gate-first 位置；把“立即返回”纠正为“只退出 init 子流程并继续获授权的原主动作”，并声明无竞争动作的显式 slash 直接进入 init，不复制完整路由表 |
| `templates/AGENTS.md.template` | 保留既有 Git L0 行；补“退出 init 子流程不等于结束本轮、继续完成最新 Git 主动作”，仍遵守 ≤120 行预算 |
| `skills/README.md` | 在既有摘要上区分平台中性的显式选择/调用与被动提及，并补 continuation handoff；不恢复“所有请求先 init”的歧义 |
| `harness/tests/unit/framework-init-routing-contract.unit.test.ts` | 替换旧 route table/断言，精确验证 T8 的 10 条输入、六级优先级、gate 位置、command handoff、adapter 入口和禁止机制 |
| `harness/tests/unit/template-renderer.unit.test.ts`、`harness/tests/unit/init-task-executor.unit.test.ts` 及既有 adapter/docs suites | 仅按受影响文本补机械断言与回归；不新建 production router 或新的测试 registry |

### 4.3 Skill 主干预算迁移

当前 `skills/project/framework-init/SKILL.md` 已为 **260/260 行，零余量**；现有 applicability gate 和 `framework-init-routing-contract:start/end` 锚定块均已存在。实施不得追加新段、提高 `specs/phase-rules/docs-rules.yaml` 的 260 行预算或假设仍有 7 行空间。

迁移方式冻结：

1. 原位替换现有 gate 首行、优先级说明和锚定块内旧样例，不新增第二入口门；
2. 10 条 `input/expected_route` 按 §3.1 六级顺序紧凑排列；为新增语义腾出的每一行必须通过删除/合并等量旧 gate 散文取得；
3. 样例本身必须留在 canonical，不得只放测试 fixture；长解释不新增 reference，本轮语义差量由现有 gate 和本 plan SSOT 承载；
4. S1→S4、前置声明与 readiness 不为腾行数而改变语义；
5. `framework-init/SKILL.md ≤ 260`、`skill_body_max_lines=PASS` 是硬验收，合法压缩可少于 260，但预算 override 不得改大。

### 4.4 明确不改的内核

除非定向测试发现直接回归，以下生产实现不改：

- `harness/scripts/init-orchestrate.ts`；
- `harness/scripts/utils/init-task-executor.ts`；
- config builder/merger；
- adapter catalog/confirmation registry；
- cleanup/global phase runner；
- goal/provider/Hylyre；
- runtime Git identity/integrity。

## 5. 测试设计

### 5.1 独立 framework-init routing-contract 静态测试

T5 已新建 `harness/tests/unit/framework-init-routing-contract.unit.test.ts` 并注册到 `harness/tests/run-unit.ts` 的显式 suite registry；T9 在该独立 suite 上更新回归。不得塞进 `skill-contract.unit.test.ts`：后者只负责 capability `contract.yaml` loader/静态图，与 project Skill Markdown 入口不是同一契约域。该 suite 不建立 runtime router，只机器读取真实文件并断言：

1. index SSOT description 包含明确 init 动作和 Git/SCM direct 边界，bridge/command metadata 与之机械一致；
2. canonical 锚定块内恰有 T8 冻结的 10 条逐字输入，顺序与 §3.1 六级优先级及本 plan §5.2 完全一致，每条 route label 唯一；
3. 裸输入值严格等于 `$framework-init`（无“单独”、引号、空格或其它前后缀），slash 与 bridge 显式选择在无否定/竞争动作时同样进入 init；被动引用/解释/否定不触发；
4. 适用性早退文本在 `Tier_1 readiness`、`init-readiness.mjs` 与 S1 planner 命令之前；
5. `exit_init_continue_git_l0` 明确“退出 init 子流程不等于结束本轮”，继续完成最新 Git 主动作，不输出 init 规则解释/澄清、不询问是否执行 init，且零 readiness/S1/planner/harness；
6. “停止 init，只提交代码”不能解释为批准或纯退出，必须继续 Git；纯“不要继续 init”才只 `exit_init`；
7. 合法 S2 continuation 的本轮 S1 上下文条件仍在；
8. canonical 仍含原 `InitTaskPlan`、S2 registries、S3 两路径与 S4 摘要约束；
9. `git_l0_then_framework_init` 保留两项及顺序；Git-only 不得完成后自行重进 init；
10. canonical 主干 ≤260；Claude/CodeAgent/Cursor command 的 canonical gate/read 早于执行指令；源码反向证明零新增关键词 router、Git 状态判定、config/env key、token、租约或持久 route state。

静态测试验证的是 Maison 发布内容声明，不能声称模型一定正确分类所有自然语言。

### 5.2 测试专用场景 fixture

以下 T8 冻结的 10 个 `input` 与 `expected_route` 必须逐字落在 canonical Skill 的稳定锚定块中；允许替换 T1–T7 的旧重复样例，但 canonical 仍须 ≤260 行、不提高预算。独立 unit suite 保留同构 test-only table，并做**精确行/单元格匹配、唯一性和顺序检查**；顺序必须与 §3.1/§3.4 一致，先取消/纠正，再有序双动作、Git-only、显式 init、合法 S2。不得用宽松 grep 或关键词分类函数冒充路由验证。

| 优先级组 | input | expected_route |
|---|---|---|
| 取消/纠正且另有 Git 主动作 | “停止 init，只提交代码” | `exit_init_continue_git_l0` |
| 纯取消/纠正 | “不要继续刚才的 framework-init” | `exit_init` |
| 明确有序双动作 | “commit 后执行 /framework-init” | `git_l0_then_framework_init` |
| Git-only | “整理下 framework 及其衍生物并提交，不相关的别动” | `exit_init_continue_git_l0` |
| Git-only（混有无顺序 Skill 名称） | “$framework-init；现在整理下 framework 及其衍生物并提交，不相关的别动” | `exit_init_continue_git_l0` |
| Git-only | “只提交当前已暂存的 Framework，业务代码别动” | `exit_init_continue_git_l0` |
| 显式 init | `$framework-init` | `framework_init` |
| 显式 init | “执行 /framework-init” | `framework_init` |
| 明确 init 动作 | “集成新发布件后刷新全部 adapter” | `framework_init` |
| 合法 S2 continuation | 本轮真实 S1 后“计划=智能；adapter=codex,cursor” | `continue_current_init_s2` |

第一条显式 init 样例代表 Codex 单独显式选择 Skill；“单独显式选择”只在本说明中出现，不属于 `input`。Markdown code span 仅用于展示，测试解析后的 input 必须严格等于字符值 `$framework-init`，不得包含反引号、“单独”、引号、空格或其它前后缀。

§3.1 优先级 6 的被动提及/其它主动作仍位于 gate 文本最后，并由 §5.1 的静态叙事断言覆盖；它不额外增加第 11 条锚定 input，避免改写 T8 冻结的 10 场景矩阵。

测试的证明边界是：Maison canonical/command/bridge 确实发布这些文本契约，不证明所有客户端对任意改写句都能语义分类。test-only table 不被生产读取，不是第二 router/registry；真实行为仍由新发布件的宿主人工复验定谳。

### 5.3 模板与物化一致性

复用/扩展：

- `harness/tests/unit/template-renderer.unit.test.ts`：AGENTS L0 Git 路由渲染后存在，placeholder 全替换，跨 active adapter 字节一致；
- `harness/tests/unit/generic-bundle.unit.test.ts`：Generic/Chrys 等 bridge 型入口的 dynamic bridge description 直接来自 skills index，并与 checked-in shared bridge 相同；显式选择且无竞争主动作时由 canonical 进入 init；
- `harness/tests/unit/chrys-opencode-adapter.unit.test.ts`：`.agents` / `.opencode/skill` framework-init bridge 字节一致且 description 等于 index；OpenCode 自动注册的 `/framework-init` 服从同一显式调用契约；
- `harness/tests/unit/resolve-skill-path.unit.test.ts`：audit 既有 skills index→checked-in bridge description 机械闭合，并确认已无 `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS` 双向登记；不重做 T1–T7 接线；
- `harness/tests/unit/init-task-executor.unit.test.ts`：实际 materialize Generic/Claude/CodeAgent/Codex/Cursor/Chrys/OpenCode 后，bridge 客户端不分叉；Codex `.codex/skills` 覆盖裸 `$framework-init`，Claude `.claude/commands`、CodeAgent `.cac/commands` 与 Cursor `.cursor/commands` 覆盖 slash，OpenCode `.opencode/skill` 覆盖自动注册 slash，Chrys/Generic 覆盖显式 bridge 选择；Claude/CodeAgent/Cursor command 的 canonical applicability gate/读取指令必须出现在 `S0`、`init-readiness` 和任何执行命令之前；Cursor 同时断言 `.cursor/commands` 与 `.cursor/skills` 双入口均受控；
- `harness/tests/unit/docs-authoring-lint.unit.test.ts` / docs gate：`framework-init/SKILL.md ≤260` 且 `skill_body_max_lines` PASS，预算 override 保持 260；
- 现有 adapter/check-init consistency suites：adapter yaml 继续指向 shared template，不逐个复制 bridge 文案。

物化验收按职责分两类：bridge 客户端要求 description 逐字来自 index；Claude/CodeAgent/Cursor 显式 command metadata 同样与 index 机械闭合，body 额外要求 canonical gate first。Cursor 是 bridge + command 双入口而非纯 bridge 客户端。所有入口共享平台中性的显式调用/被动提及/Git continuation 语义，平台差异只在 fixture 中表达。不能只检查“存在 canonical 链接”，也不能伪称这些入口当前就是同一物理模板或真实客户端已被静态测试证明。

### 5.4 init 内核反回归

使用既有定向 suite 证明没有顺手改造 init：

- `init-orchestrate-smoke`：S1 project/personal probe 只读；
- `init-orchestrate`：CREATE/UPDATE、decision/context、adapter cross-check、smart-auto、run-global-phases non-skippable；
- `init-task-executor`：config、adapter materialization、cleanup-deprecated；
- `template-renderer` / adapter suites：AGENTS 与 bridge 物化一致；
- `docs-authoring-lint` / `check-docs`：canonical Skill 主干预算不回归；
- 源码静态反向断言：route 变更不导入 child_process/Git status，不新增 config/env route key、租约/token/route state。

由于发布内容会变化，最终仍按根 `AGENTS.md` 跑 `cd harness && npm test`。真实宿主、真机、Desktop Codex 不属于 coder 自动验收。

## 6. 验收矩阵

| ID | 场景 | 机器/人工验收 | 期望 |
|---|---|---|---|
| A | Codex 单独显式 `$framework-init` | 锚定 fixture + canonical 静态断言 | `framework_init`；直接进入 Tier_1 readiness→S1，不二次询问是否执行 init |
| B | Claude/CodeAgent/Cursor/OpenCode 显式 `/framework-init`；bridge 显式选择且无竞争动作 | adapter 物化 + routing-contract | `framework_init`；各入口复用平台中性 canonical，不做 Codex special case |
| C | “集成新发布件后刷新全部 adapter” | 场景 fixture + init 定向测试 | `framework_init`；原 S1→S4 与 S2 批准不回归 |
| D | `$framework-init`、链接或 framework 名词被动引用/解释/否定，或与 Git 主动作混装 | canonical 优先级 + 精确 fixture | 被动提及不单独触发；与 Git 混装时为 `exit_init_continue_git_l0`，不得只返回“不适用” |
| E | “整理下 framework 及其衍生物并提交，不相关的别动” | fixture + AGENTS/command/canonical 文本断言 | `exit_init_continue_git_l0`；零 init 解释/询问与零 readiness/S1/planner/harness，并继续整理、暂存和提交指定范围 |
| F | Git status/diff/add/stage/commit/push 或只提交 staged | fixture + AGENTS render | `exit_init_continue_git_l0`；不运行 Git 状态来判路由，按用户文件范围与 push 授权完成 L0 主动作 |
| G | S1 后“停止 init，只提交代码” | 最新意图契约断言 | `exit_init_continue_git_l0`；不解释为 S2 批准或纯退出，停止 init 后继续提交 |
| H | “不要继续刚才的 framework-init”且无其它主动作 | 场景 fixture | `exit_init`；只退出并等待，不自行引入 Git 或 init 动作 |
| I | “commit 后执行 /framework-init” | 有序双动作 fixture | `git_l0_then_framework_init`；先完整完成 Git L0，再执行明确 init，二者均不丢失 |
| J | 真实本轮 S1 后合法 plan/adapters 回复 | continuation 契约 + init 定向测试 | `continue_current_init_s2`；继续 S2→S3，原确认机制不回归 |
| K | 无本轮 S1 上下文的裸 `计划=...；adapter=...` | 场景 fixture | 不独立触发 init |
| L | 全 adapter 物化 | routing-contract + generic/chrys/opencode/init executor suites | Codex 裸 Skill、Cursor 双入口、Claude/CodeAgent slash、OpenCode slash、Chrys/Generic bridge 全覆盖；description 来自 index，command gate 在 S0/readiness 前 |
| M | CREATE/UPDATE/config/cleanup/global phases | 既有 init suites | 行为逐项不变 |
| N | 新状态/新 router/Git 输入反向审计 | 源码扫描 | 零新增关键词 router、Git 状态判定、config/env key、token、租约或持久 route state |
| O | Skill 文档预算 | 行数计数 + `skill_body_max_lines` | canonical ≤260，override 仍为 260 |
| P | 发布内容 | `cd harness && npm test` | 全 PASS；只证明 Maison 文本/模板契约，不冒充真实客户端行为 |
| Q | 宿主人工显式调用 | 用户部署后单独选择 `$framework-init`，或使用适用客户端的 `/framework-init` | 直接进入 init，不再次澄清“是否执行” |
| R | 宿主人工 Git continuation | 用户部署后输入“整理下 framework 及其衍生物并提交，不相关的别动” | 不出现 readiness/S1 或 init 规则解释；继续完成获授权的整理、暂存和提交，且不碰无关文件 |
| S | 宿主人工双动作 | 用户部署后输入“commit 后执行 /framework-init” | 先完成获授权的 Git 提交，再进入 init；Git-only 请求后不得自行续跑 init |

## 7. 实施顺序与完成定义

```text
T1 契约/unknown 证据边界冻结（已完成）
  → T2 index description SSOT + canonical early-exit/预算收缩
  → T3 AGENTS L0 + index 职责对齐
  → T4 物化单源与 adapter 一致性
  → T5 内部路由契约 fixture/tests
  → T6 init 内核定向反回归
  → T7 全验收 + 第一轮宿主人工复验话术交付（T2–T7 均已完成）
  → T8 显式调用/被动提及纠偏 + Git continuation handoff
  → T9 10 场景内部回归 + 完整 Maison 验收 + 新宿主人工复验交付
```

完成必须同时满足：

1. 无否定、引用或竞争主动作的显式 Skill/command/bridge 调用路由为 `framework_init`，直接进入 Tier_1 readiness→S1，不二次询问是否 init；
2. 被动引用、解释、否定或记录 Skill 名称/链接不单独触发 init；
3. 普通 Git/SCM 请求在 Maison 声明层明确为 `exit_init_continue_git_l0`：只退出 init 子流程，不结束本轮，零 init 规则解释/澄清与零 readiness/S1/planner/harness，并继续完成获授权的原主动作；
4. “停止 init，只提交代码”继续提交；纯“不要继续 init”才只 `exit_init` 并等待；
5. `git_l0_then_framework_init` 保留用户指定顺序与两个动作，Git-only 完成后不自行续跑 init；
6. canonical applicability gate 的完整结束位置位于前置声明、流程概述、任何 readiness/S1 命令之前；
7. 合法 S2 continuation 未被误杀，S3 仍须原 S2 批准；
8. skills index 是 framework-init 机器 description 唯一来源，生产物化没有平行 literal map 或新 frontmatter parser；
9. AGENTS 与 Codex/Cursor/Claude/CodeAgent/OpenCode/Chrys/Generic 物化结果闭合，Cursor command+bridge 双入口均覆盖；
10. canonical 主干 ≤260 且不提高 budget；
11. init 内核和 S1→S4 行为未改；
12. 内部测试诚实限定为契约/模板证明，不冒充真实模型路由实测；
13. T9 交付 Q–S 的宿主人工复验话术和证据边界，实施者不自动操作宿主。

## 8. 事实冲突与实施注意

### 8.1 T8/T9 当前事实

1. **Skill 选择来源仍未知**：宿主证据不能区分手工附加、UI 自动附加、description 选择或上下文续用；description 只能列为防御面，不能写成已证唯一因果。
2. **canonical 当前为 260/260 且 gate 已经 first**：只能原位替换/等量压缩现有 gate 与样例，不得重建 gate、追加段落或提高预算。
3. **command 当前缺口是 handoff，不是 gate 位置**：Claude/CodeAgent/Cursor 已先读 canonical，但仍写“若为 Git/退出 init，立即返回”；T8 要把它纠正为只退出 init 子流程并继续最新获授权主动作。
4. **AGENTS 当前已有 Git L0**：T8 只补“退出 init 不等于结束本轮”和完成原 Git 主动作，不重做 L0 分类。
5. **明确有序双动作必须先于 Git-only**：否则“commit 后执行 `/framework-init`”会被更早 Git 规则吞掉第二动作。
6. **裸 Skill chip 不是被动字面出现**：真实 Codex 回归已证明，用户单独选择 `$framework-init` 是显式调用；只有引用、解释、否定、日志记录或与竞争主动作混装才属于被动提及。
7. **宿主 run 成功不证明路由正确**：成功 UPDATE 只能证明 init 内核健康，不能为误触发或错误 handoff 辩护。
8. **单元测试不能证明所有客户端语义选择**：Maison 只能锁定自己发布的 description/Skill/AGENTS/物化字节；真实 Codex/Claude/Cursor 行为留给发布后人工复验。
9. **同名平台入口不等于 Codex special case**：canonical 保持平台中性；Codex `$framework-init`、slash commands、OpenCode 自动注册 slash 与 bridge 显式选择的差异只进入 adapter fixture 和宿主人工复验。

### 8.2 T1–T7 历史缺口（已解决，不得重做）

| 历史缺口 | 当前已完成状态 |
|---|---|
| `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS` 平行 writer | 已删除；materializer 已读 index description |
| Claude/CodeAgent command 在 canonical 前直接执行 S0→S4 | 已改为 gate-first 薄入口；T8 只修 handoff 文案 |
| Cursor command 面遗漏 | 已纳入 command + bridge 双入口验收 |
| description 字段流与 SSOT 未闭合 | index loader、checked-in metadata 与 dynamic materialization 已闭合 |
| applicability gate 晚于前置声明/readiness | gate 已位于标题后第一执行位置，早于前置声明、readiness 与 S1 |
| AGENTS 未明确 Git/SCM L0 | Git status/diff/add/stage/commit/push 已明确为 L0 direct |
| skills/README 的“所有其它 Skill 前置”歧义 | 已补普通 Git/SCM 不因 framework 名词触发 init；T8 只补显式选择和 continuation |

## 9. 本 plan 的只读/轻量校验

本轮仅允许：

1. `node scripts/check-plan-version.mjs`；
2. `git diff --check -- .cursor/plans/framework-init误触发纠偏_Git-SCM-L0路由与Skill意图早退_d3a7f1c8.plan.md`；
3. 检查 plan 的 CR byte 为 0、文件以 LF 结尾；
4. 检查 frontmatter 中 T1–T7 仍为 `completed`、T8/T9 恰为 `pending`，正文无未登记 `- [ ]`。

不运行产品测试、OpenSpec、framework-init、宿主回归、打包、Git add/commit/push。
