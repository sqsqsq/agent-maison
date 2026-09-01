---
name: framework-init 误触发纠偏 — Git/SCM L0 路由与 Skill 意图早退
version: 3.0.0
# 独立入口路由纠偏 plan。2026-09-01 宿主事故中，framework-init 被附加/选择的来源未知；
# 已证缺口是 Skill 一旦被选择，canonical/command 入口没有 Git 主动作早退与最新意图终止，
# 因而进入 readiness/S1。init 内核正常，且与 runtime Git dirty/integrity 退场无因果关系。
# 本 plan 只修入口适用性、最新意图切换与模板物化契约，不实施代码、不修改 OpenSpec、
# 不操作宿主、不执行 framework-init、不提交或推送。
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
overview: >
  修复普通 Git/SCM 请求因出现 framework/衍生物名词而误触发 framework-init 的入口契约缺口。
  Skill 的附加/选择来源保持 unknown；skills index 提供机器 description SSOT，bridge 收窄只作防误选。
  canonical/command 在 readiness/S1 前按主动作早退，并在 S1 后尊重最新用户意图；AGENTS 把 Git 固定为 L0。保留完整 S1→S4、
  InitTaskPlan、adapter 确认、无损 UPDATE、物化、cleanup 与 global phases，不新增 router 状态机。
---

# framework-init 误触发纠偏：Git/SCM L0 路由与 Skill 意图早退（d3a7f1c8）

状态：**契约与实施边界已冻结，待实施；本轮仅产出 plan。**

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
              └─ 用户纠正未被建模为“终止当前 Skill、回 L0”
                  └─ 后续同类请求再次进入未设防的入口
```

已证事实只到“Skill 已在上下文中且入口继续执行”，不能从现有记录区分：用户手工附加、Codex UI 自动附加、模型依据 description 选择，还是前一轮 Skill 上下文继续生效。bridge description 从 2026-06-08 起即存在且本次发布未修改，因此它是应收窄的**防误选风险面**，不是已证唯一直接原因。

OpenAI Docs 仅确认 Skill 对象具有 `description` 元数据，并建议把路由指令写得 task-specific、明确哪些工作保持 direct；官方资料没有公开 Desktop Skill 自动选择算法。因此本 plan 不声称 description 必然触发 Desktop 选择：

- [OpenAI Skills API：Skill 含 description](https://developers.openai.com/api/reference/python/resources/skills/methods/create)
- [OpenAI model guidance：Make routing instructions task-specific](https://developers.openai.com/api/docs/guides/latest-model)

已证根因仍发生在 init/harness/Git 检查之前：Skill 一旦被选择，入口没有早退。不能用 init 是否成功、framework 是否 dirty、是否 staged 或已提交来修复。

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
- 逐 adapter 手工复制完整正向/负向触发表。

## 3. 路由契约与优先级

### 3.1 单一优先级

每条消息先识别**主动作**，再看对象名词；优先级从高到低固定如下：

| 优先级 | 当前消息事实 | 结果 |
|---:|---|---|
| 1 | 明确取消/纠正未完成 init：“停止 init”“不要运行 framework-init”“你理解错了”“只提交代码”“只查看 Git 状态”“不要继续刚才的计划” | 立即退出当前 Skill，清空本轮对话里的未执行 S2 意图并回 L0；不再解释成批准 |
| 2 | 主动作是 Git/SCM：status/diff/add/stage/commit/push、整理暂存区、只提交 staged、归档版本控制改动 | L0 direct；即使出现 framework/衍生物、`$framework-init` 文本或 bridge 链接也不运行 readiness/S1 |
| 3 | 明确 init 动作：首次接入发布件、集成新发布件后刷新 config/adapter、创建/迁移 config、明确执行 `/framework-init`、明确重新物化 adapters | 进入 framework-init 适用性通过分支，再执行现有 Tier_1→S1 |
| 4 | 当前未完成流程确有本轮真实 S1 `InitTaskPlan` 已展示，用户回复合法 `计划=...；adapter=...` 批准 | 继续现有 S2→S3；不重新跑一套入口判断或另建状态 |
| 5 | 只有 framework、Framework 产物、衍生物等名词，主动作不明 | 不触发 init；按当前主任务或普通澄清处理 |

“显式 `/framework-init`”指命令式要求执行该 Skill；引用、否定、日志、链接或 `$framework-init` 字面出现不自动胜过 Git 主动作或取消意图。

混合主动作按用户给出的显式顺序拆成两个任务，不把后项名词吸附到前项：例如“commit 完之后跑 `/framework-init`”先以 L0 完成 commit，随后才把明确的第二动作送入 canonical applicability gate；“只提交/停止 init/不要运行 init”则由取消或 Git-only 优先级终止，不得在 commit 后自行续跑。该顺序只来自当前消息，不持久化 route state。

### 3.2 正向适用性闭集

Maison 发布的 description/canonical 只声明以下明确动作；description 收窄用于降低误选风险，不代表 Maison 能证明或控制 Desktop 的选择算法：

- 首次接入 Maison 已验证发布件并初始化项目级 config/入口；
- 集成新发布件后刷新 config、adapter 或 materialized artifacts；
- 创建、补齐或迁移 `framework.config.json`；
- 明确执行 `/framework-init`；
- 明确重新物化 `materialized_adapters`；
- 当前对话已展示本轮真实 S1 plan 后，对 task plan/adapters 的合法批准。

不能把“升级 framework”保留成无宾语、无动作边界的宽触发；它必须落到“已经集成新发布件，现在刷新项目级产物”或明确命令。

### 3.3 Git/SCM L0 排除闭集

以下主动作一律不适用 framework-init：

- `git status` / `git diff`；
- add / stage / commit / push；
- 整理暂存区、只提交当前 staged 文件；
- 整理 Framework 及其物化/衍生文件并提交；
- 查看 Framework 更新产生的 Git 变化；
- 归档、提交或推送版本控制改动。

排除判断只看消息语义，不执行 Git 命令来“确认是不是 Git 请求”。

### 3.4 进入前早退与中途切换

canonical Skill 的结构顺序必须变为：

```text
适用性与最新意图门
  ├─ Git/SCM 或取消 → 返回 L0（零 readiness、零 S1、零 planner/harness）
  └─ 明确 init 动作 → 现有 Tier_1 readiness → S1 → S2 → S3 → S4
```

S1 已运行但 S3 未执行时，最新用户消息是新的权威意图。取消/纠正不会生成持久状态；只需停止当前对话中的未完成 Skill。下一次同类 Git 请求之所以不重进 S1，是因为 Git 主动作本身固定路由 L0，不依赖记忆一个“用户曾取消”的 token。

### 3.5 合法 S2 continuation

`计划=<...>；adapter=<...>` 只有在当前对话中存在以下全部事实时才是 S2 continuation：

1. 该轮已经通过适用性门；
2. 实际运行并展示了当前发布件、本项目、本轮的 S1 `InitTaskPlan`；
3. task plan 与 adapter 选项来自该 S1 输出；
4. 最新消息没有取消或切换为 Git-only 主动作。

没有这些上下文时，这类片段不能独立触发 init。这里使用当前对话事实，不落盘、不加 nonce/token/租约。

## 4. SSOT 收口与文件级改造

### 4.1 当前平行描述事实与机器 SSOT 选择

现状不是“shared bridge 已经是唯一 description SSOT”，且无需新增 Markdown frontmatter parser 来把它变成 SSOT：

| 位置 | 当前角色 | 冲突 |
|---|---|---|
| `agents/shared/agent-bundle/templates/skills-bridge/framework-init/SKILL.md` | Codex/Cursor/Chrys/OpenCode 等 checked-in bridge frontmatter | 当前宽 description 是误选风险面，但不能证明它导致本次选择 |
| `harness/scripts/utils/agent-bundle-paths.ts > BUILTIN_SKILL_BRIDGE_DESCRIPTIONS` | dynamic bridge/inline renderer description | 与 shared bridge 重复同一句，是真实平行 writer |
| `skills/skills.index.yaml` | 已有 id→path/order/description 机器索引 | `loadSkillsIndex()` 已解析 description；`resolveSkillPath()` 当前返回对象尚未投影它，materializer 可复用 loader/entry，而无需新 parser |
| `agents/{claude,codeagent}/templates/commands/framework-init.md` | 显式 slash command metadata/body | 独立描述并直接列出 S0→S4，canonical 链接在末尾，当前可绕过 canonical early-exit |
| `agents/cursor/templates/commands/framework-init.md` | Cursor 显式 slash command；与 `.cursor/skills/framework-init` bridge 同时物化 | description 同样宽；虽正文已是薄链接，仍须纳入 command metadata 单源和 gate-first 验收，不能把 Cursor 当纯 bridge 客户端 |
| `skills/project/framework-init/SKILL.md` | canonical 行为流程 | 只有宽正向触发，无排除/早退/最新意图终止 |

实施不得再加第三个 route map。机器 SSOT 与派生职责冻结如下：

- `skills/skills.index.yaml.description`：framework-init **机器 description 唯一 SSOT**；
- `resolve-skill-path.ts` 现有 `loadSkillsIndex`：description 的唯一生产读取边界；
- dynamic materializer：从 index entry 取 description，删除 `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS`；
- checked-in shared bridge 与 Claude/CodeAgent/Cursor command metadata：派生/机械一致性对象，description 必须等于或由 index 机械投影，不再各自定义触发语义；
- canonical Skill：完整正向/负向/优先级/continuation 行为 SSOT；
- AGENTS template：全局 L0 Git/SCM 分流摘要；
- Claude/CodeAgent/Cursor command body：薄显式命令入口，第一执行动作是读取 canonical 并执行 applicability gate；adapter-specific 内容只保留 interaction renderer/身份差异，不在 canonical 前列 S0→S4；
- 测试 fixture：只断言上述契约，不被生产读取。

不新增独立 frontmatter parser。checked-in bridge 的一致性由现有 YAML/frontmatter 测试工具或测试内有界读取校验；生产 materializer 直接使用已经加载的 index description。

### 4.2 必须修订/审核的文件

| 文件 | 计划动作 |
|---|---|
| `skills/skills.index.yaml` | 作为机器 description SSOT，收窄 framework-init description 为明确 init 动作 + Git/SCM direct 边界；不塞完整例句表 |
| `harness/scripts/utils/resolve-skill-path.ts` | 让既有 index loader 暴露/读取 entry description 供 materializer 复用；不新增 registry 或解析链 |
| `agents/shared/agent-bundle/templates/skills-bridge/framework-init/SKILL.md` | 保持 checked-in 薄跳板；frontmatter description 与 index SSOT 机械一致，作为防误选元数据，不宣称控制 Desktop 选择 |
| `skills/project/framework-init/SKILL.md` | **替换而非追加**现有“触发条件”段，在 Tier_1 标题前放紧凑 applicability/latest-intent gate；压缩相邻重复散文，S1→S4 内核语义不变，最终主干 ≤260 行 |
| `skills/project/framework-init/reference/applicability-and-intent-routing.md`（单一条件加载 reference，若实施需要） | 承载详细正/负例、取消例与 S2 上下文例；canonical 只保留可执行核心优先级，reference 不成为生产 router/第二 registry |
| `harness/scripts/utils/agent-bundle-paths.ts` | 删除整个 `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS` 平行 map，不保留 framework-init special case |
| `harness/scripts/utils/materialize-agent-bundle-skills.ts` | 复用现有 `loadSkillsIndex`/index entry description 生成 dynamic bridge/inline metadata；不读取 shared Markdown frontmatter，不新增 parser |
| `templates/AGENTS.md.template` | 在 4.0 L0 表明确 Git/SCM 操作；说明对象名词不是 Skill 触发；保持 ≤120 行预算，必要时压缩现有散文而非膨胀 |
| `skills/README.md` | 索引摘要收窄，说明 framework-init 前置只针对确有 init 需求，不把普通 Git 任务吸入 Skill |
| `agents/claude/templates/commands/framework-init.md`、`agents/codeagent/templates/commands/framework-init.md`、`agents/cursor/templates/commands/framework-init.md` | 纳入同一显式 command 组；metadata 与 index description 机械一致；第一执行动作必须读取 canonical applicability gate。Claude/CodeAgent 删除或后移 canonical 前的 S0→S4 表，Cursor 保持薄入口但补 gate-first 机器锚，不复制完整负向表 |
| `agents/shared/agent-bundle/templates/rules/framework.mdc` | 仅补“主动作/Skill 路由优先”索引（若 AGENTS/canonical 已足够则不改），避免再造规则正文 |
| `agents/shared/agent-bundle/templates/rules/framework-agent-execution.mdc` | 只做冲突审计；它约束进入 Skill 后的执行权，不承担 NL router，默认不改 |
| `harness/tests/unit/framework-init-routing-contract.unit.test.ts` + `harness/tests/run-unit.ts` | 新建并注册独立 routing-contract suite；只解析 Maison 文本契约/物化入口，不复用 capability contract loader，不实现生产关键词分类器 |

### 4.3 Skill 主干预算迁移

当前 `skills/project/framework-init/SKILL.md` 为 253 行，`specs/phase-rules/docs-rules.yaml` 冻结预算为 260 行，只剩 7 行。实施不得把正向表、负向表、优先级、early-exit、取消和 S2 规则直接追加到主干，也不得上调 260 预算。

迁移方式冻结：

1. 用紧凑 applicability gate **替换**现有 5 行“触发条件”段；在该段内以稳定 `framework-init-routing-contract:start/end` 锚包住 10 个逐字样例及 `expected_route`，作为可静态验证的声明式契约；
2. 合并/删除与新门重复的前置声明和 S2 散文，取得净行数空间；
3. 主干只保留“优先级 + 立即动作 + continuation 前提 + 10 个紧凑样例”；更长解释才可进入至多一个条件加载 reference，样例本身不得只放在测试 fixture；
4. reference 的条件是需要解释适用性歧义、Git/SCM 混装、取消/纠正或裸 S2 回复时读取，不要求每次 init 入口全读，也不重复另一份路由表；
5. `framework-init/SKILL.md ≤ 260`、`skill_body_max_lines=PASS` 是硬验收；预算 override 文件不得改大。

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

新建 `harness/tests/unit/framework-init-routing-contract.unit.test.ts`，并在 `harness/tests/run-unit.ts` 的现有显式 suite registry 注册。不得塞进 `skill-contract.unit.test.ts`：后者只负责 capability `contract.yaml` loader/静态图，与 project Skill Markdown 入口不是同一契约域。新 suite 不建立 runtime router，只机器读取真实文件并断言：

1. index SSOT description 包含明确 init 动作和 Git/SCM direct 边界，bridge/command metadata 与之机械一致；
2. canonical 锚定块内恰有 10 条逐字输入，每条 route label 唯一且与本 plan 5.2 一致；
3. canonical Skill 有正向闭集、Git/SCM 负向闭集、主动作优先、最新意图终止与合法 S2 条件；
4. 适用性早退文本在 `Tier_1 readiness`、`init-readiness.mjs` 与 S1 planner 命令之前；
5. early-exit 明确零 readiness/S1/planner/harness；
6. 取消词不能解释为 `init.task_plan` 或 adapter 批准；
7. 合法 S2 continuation 的本轮 S1 上下文条件仍在；
8. canonical 仍含原 `InitTaskPlan`、S2 registries、S3 两路径与 S4 摘要约束；
9. canonical 主干行数 ≤260，且 applicability gate 的首个动作位于任何 `init-readiness`、S0、Tier_1/S1 执行文本之前；
10. Claude/CodeAgent/Cursor command 的 canonical gate/read 指令均早于 `S0`、`init-readiness` 或其它执行指令。

静态测试验证的是 Maison 发布内容声明，不能声称模型一定正确分类所有自然语言。

### 5.2 测试专用场景 fixture

以下 10 个 `input` 与 `expected_route` 必须逐字落在 canonical Skill 的稳定锚定块中；独立 unit suite 内保留同构 test-only table 作为期望，并解析锚定块做**精确行/表格单元格匹配、唯一性和顺序检查**。不得用“包含 Git/commit 等关键词”的宽松 grep 冒充覆盖，也不得写一个函数把输入分类后与 expected 比较。

正向：

| 输入 | expected_route |
|---|---|
| “首次接入 Maison 发布件并生成 framework.config” | `framework_init` |
| “集成新发布件后刷新全部 adapter” | `framework_init` |
| “执行 /framework-init” | `framework_init` |
| 本轮真实 S1 后“计划=智能；adapter=codex,cursor” | `continue_current_init_s2` |

负向：

| 输入 | expected_route |
|---|---|
| “整理下 framework 及其衍生物并提交，不相关的别动” | `git_l0` |
| “查看 framework 更新产生的 diff” | `git_l0` |
| “只提交当前已暂存的 Framework，业务代码别动” | `git_l0` |
| “git status 后提交，不要 push” | `git_l0` |
| “停止 init，只提交代码” | `exit_init_to_git_l0` |
| “不要继续刚才的 framework-init” | `exit_init` |

测试的证明边界是：Maison canonical 确实逐字发布了这 10 组声明，且它们位于 readiness 前的 applicability gate；它不证明模型对任意改写句都能语义分类。test-only table 不被生产读取，不是第二 router/registry。

### 5.3 模板与物化一致性

复用/扩展：

- `harness/tests/unit/template-renderer.unit.test.ts`：AGENTS L0 Git 路由渲染后存在，placeholder 全替换，跨 active adapter 字节一致；
- `harness/tests/unit/generic-bundle.unit.test.ts`：generic dynamic bridge description 直接来自 skills index，并与 checked-in shared bridge 相同；
- `harness/tests/unit/chrys-opencode-adapter.unit.test.ts`：`.agents` / `.opencode/skill` framework-init bridge 字节一致且 description 等于 index；
- `harness/tests/unit/resolve-skill-path.unit.test.ts`：skills index 覆盖全部 bridge，删除对 `BUILTIN_SKILL_BRIDGE_DESCRIPTIONS` 的双向登记断言，改为 index→checked-in bridge description 机械闭合；
- `harness/tests/unit/init-task-executor.unit.test.ts`：实际 materialize generic/Claude/CodeAgent/Codex/Cursor/Chrys/OpenCode 后，bridge 客户端不分叉；Claude/CodeAgent/Cursor command 的 canonical applicability gate/读取指令必须出现在 `S0`、`init-readiness` 和任何执行命令之前；Cursor 同时断言 `.cursor/commands` 与 `.cursor/skills` 双入口均受控；
- `harness/tests/unit/docs-authoring-lint.unit.test.ts` / docs gate：`framework-init/SKILL.md ≤260` 且 `skill_body_max_lines` PASS，预算 override 保持 260；
- 现有 adapter/check-init consistency suites：adapter yaml 继续指向 shared template，不逐个复制 bridge 文案。

物化验收按职责分两类：bridge 客户端要求 description 逐字来自 index；Claude/CodeAgent/Cursor 显式 command metadata 同样与 index 机械闭合，body 额外要求 canonical gate first。Cursor 是 bridge + command 双入口而非纯 bridge 客户端。不能只检查“存在 canonical 链接”，也不能伪称这些入口当前就是同一物理模板。

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
| A | index description/canonical 正向动作 | 静态契约测试 | 明确接入/刷新/config/显式命令可进入 init；不声称证明 Desktop 选择算法 |
| B | framework 名词 + commit 主动作 | 场景 fixture + AGENTS render | `git_l0`，零 readiness/S1 |
| C | Git status/diff/add/stage/push | 场景 fixture | 全部 L0，不读取 Git 状态来二次判断 |
| D | 消息提及 `$framework-init` 或 bridge 链接但主动作是 Git | canonical 优先级断言 | 只返回“不适用”，不跑 readiness/S1 |
| E | S1 后“停止 init，只提交代码” | 最新意图契约断言 | 退出当前 Skill，不解释为 S2 批准 |
| F | 下一轮再次发送相同 Git 请求 | L0 全局路由断言 | 仍是 Git L0；不靠持久取消 token |
| G | 真实本轮 S1 后合法 plan/adapters 回复 | continuation 契约 + init 定向测试 | 继续 S2→S3，原确认机制不回归 |
| H | 无本轮 S1 上下文的裸 `计划=...；adapter=...` | 场景 fixture | 不独立触发 init |
| I | 全 adapter 物化 | routing-contract + generic/chrys/opencode/init executor suites | description 来自 index；Claude/CodeAgent/Cursor command gate 在 S0/readiness 前；Cursor command+bridge 双入口均覆盖 |
| J | CREATE/UPDATE/config/cleanup/global phases | 既有 init suites | 行为逐项不变 |
| K | 新状态/新 router/Git 输入反向审计 | 源码扫描 | 零新增 |
| L | 发布内容 | `cd harness && npm test` | 全 PASS |
| L2 | Skill 文档预算 | 行数计数 + `skill_body_max_lines` | canonical ≤260，override 仍为 260 |
| M | 宿主人工正向 | 用户部署后输入“集成新发布件后刷新全部 adapter” | 进入 framework-init |
| N | 宿主人工负向 | 用户部署后输入“整理下 framework 及其衍生物并提交，不相关的别动” | 只走 Git L0，不出现 S1 |

## 7. 实施顺序与完成定义

```text
T1 契约/unknown 证据边界冻结
  → T2 index description SSOT + canonical early-exit/预算收缩
  → T3 AGENTS L0 + index 职责对齐
  → T4 物化单源与 adapter 一致性
  → T5 内部路由契约 fixture/tests
  → T6 init 内核定向反回归
  → T7 全验收 + 宿主人工复验话术交付
```

完成必须同时满足：

1. 普通 Git/SCM 请求在 Maison 声明层明确为 L0；
2. canonical early-exit 的文本顺序位于任何 readiness/S1 命令之前；
3. 用户最新取消意图能终止未完成 init；
4. 合法 S2 continuation 未被误杀；
5. skills index 是 framework-init 机器 description 唯一来源，生产物化没有平行 literal map 或新 frontmatter parser；
6. AGENTS 与各 adapter 物化结果闭合；
7. Claude/CodeAgent/Cursor command 不能在 canonical applicability gate 前出现 S0/readiness 执行路径，Cursor 双入口不能漏一面；
8. canonical 主干 ≤260 且不提高 budget；
9. init 内核和 S1→S4 行为未改；
10. 内部测试诚实限定为契约/模板证明，不冒充真实模型路由实测；
11. 宿主验收只交给用户部署新发布件后人工执行两句话。

## 8. 事实冲突与实施注意

1. **Skill 选择来源未知**：宿主证据不能区分手工附加、UI 自动附加、description 选择或上下文续用；description 只能列为防御面，不能写成已证唯一因果。
2. **`skills.index.yaml` 才是现成机器落点**：materializer 已加载 index；若转而把 shared Markdown 设为 SSOT，会新增 frontmatter 生产解析并继续人工维护 index，反而更复杂。故本 plan 改为 index SSOT。
3. **`BUILTIN_SKILL_BRIDGE_DESCRIPTIONS` 是确定的平行 writer**：必须删除并让 materializer 读 index，不能只要求“不比 shared 更宽”。
4. **Claude/CodeAgent command 会绕过 canonical**：两份 command 在末尾才给 canonical 链接，前面已直接列 S0→S4；仅“审核/链接存在”不足，必须 gate first 或薄入口。
5. **Cursor 是双入口且原 plan 漏了 command 面**：`cursor/adapter.yaml` 同时物化 `.cursor/commands` 和 `.cursor/skills`；Cursor command description 同样宽，必须并入显式 command 组。
6. **index description 的精确字段流**：`description` 在 `SkillIndexEntry` 中并由 `loadSkillsIndex()` 解析，但当前 `ResolvedSkillPath`/`resolveSkillPath()` 返回值没有投影它；实施须复用 loader/entry 或显式扩展返回类型，不能假定 resolved 字段已经存在。
7. **canonical 预算只有 7 行余量**：当前 253 行、预算 260；新增入口契约必须替换/压缩并条件加载，禁止上调 override。
8. **当前 canonical 顺序先 readiness 后 S1**：early-exit 必须新增在 Tier_1 之前；只写在 S1 小节内仍会误启动 readiness。
9. **当前 AGENTS L0 只写小修/文案/单文件 bug**：没有 Git/SCM 明示，无法对抗 framework 名词吸附；须在不超过 120 行的前提下补足。
10. **skills/README 称 framework-init 是所有 Skill 前置**：这只约束进入其它 Maison Skill 前的项目就绪，不表示每个普通 L0 Git 请求都要先跑 init；实施必须消除此歧义。
11. **宿主 run 成功不证明路由正确**：成功 UPDATE 只能证明 init 内核健康，不能为误触发辩护，也不能用“反正没坏”降低优先级。
12. **单元测试不能证明所有客户端语义选择**：Maison 只能锁定自己发布的 description/Skill/AGENTS/物化字节；真实 Codex/Claude/Cursor 行为留给发布后人工两句验收。

## 9. 本 plan 的只读/轻量校验

本轮仅允许：

1. `node scripts/check-plan-version.mjs`；
2. 对未跟踪新 plan 使用 `git diff --no-index --check -- NUL <plan>`，不得用对未跟踪文件为空操作的普通 `git diff` 冒充；
3. `git diff --no-index --numstat -- NUL <plan>` 确认字节被实际读取；
4. 检查 CR byte 为 0、文件以 LF 结尾；
5. 检查 frontmatter todos 全为 pending，正文无未登记 `- [ ]`。

不运行产品测试、OpenSpec、framework-init、宿主回归、打包、Git add/commit/push。
