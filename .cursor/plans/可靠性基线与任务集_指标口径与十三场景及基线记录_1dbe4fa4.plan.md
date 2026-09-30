---
name: 可靠性基线与任务集 — 指标口径、十三个事故场景、基线记录（总纲 272acb5f 的 P1）
version: 3.1.0
overview: >
  总纲 272acb5f 的第一份子 plan。只做度量，不改任何运行时行为：`harness/scripts/**`、`harness/harness-runner.ts`、
  `profiles/**/harness/*.ts`、`skills/**`、`specs/**` 一个字节不动。
  交付四样东西：①指标采集脚本，读框架既有记录加观察记录，算出总纲 §4 的六项指标；②十三个场景的确定性重放套件
  （release-only），每个场景取自一次真实事故，复用既有真实链路与运行时测试 helper 搭建；③场景登记表，记录每个场景的
  期望与基线实测，作为 P2–P4 说明收益的依据；④基线：确定性层在当前 HEAD 的实测，加真实 agent 层在宿主的实测。
  真实 agent 层需要真实模型与真机，由宿主侧执行，结果是本 plan 的交付项，取得之前上位 P1 不得关闭。
  采集器把"框架是否宣称完成""记录与当前义务是否有效""独立验收结果"分开记录，事件信号只作候选，人工救场由观察记录确认。
  不建 benchmark 平台、不建 A/B 系统、不建新的持久层、不给生产代码加测试缝、不新增事件字段。
todos:
  - id: t1-metrics-collector
    content: >
      §3：指标采集。TS 采集器放 `harness/tests/utils/reliability-metrics.ts`（tests 目录不进发布件），只 import 既有纯函数，
      不复制公式；入口 `scripts/reliability-metrics.mjs` 按仓内先例用 harness 的 ts-node 起子进程。三类事实分开输出，
      停止状态保留原始 disposition；事件信号输出为候选，与观察记录关联后才计为已确认的人工救场。
      单测 `scripts/tests/reliability-metrics.unit.mjs`，夹具取真实 writer 的完整产物，不裁剪 heartbeat。
    status: completed
  - id: t2-scenario-suite
    content: >
      §4：十三个场景的确定性重放套件 `harness/tests/unit/reliability-scenarios.unit.test.ts`，登记为 release-only；
      场景登记表 `harness/tests/fixtures/reliability-scenarios/registry.json` 记期望与基线实测。套件只对"基线已满足的期望"
      和"正确失败、正确暂停、正确交还"下断言，未达标的差距只打印。驱动层按 §4.1 核实后的结论，做不到的如实降层。
    status: completed
  - id: t3-observation-and-host-procedure
    content: >
      §5：观察记录模板；宿主执行程序（两个任务覆盖四个场景、请求文本、初始现场恢复步骤与存档可恢复性核对、
      S1 故障条件的设置与还原、要记录的环境差异、宿主话术）；宿主历史参考值及其观察记录。
    status: completed
  - id: t4-baseline-record-and-docs
    content: >
      §6：确定性层基线写入登记表与实施记录；同步 release-only 套件在发版清单与测试 README 中的列举；
      全量 `npm test`、`--filter reliability-scenarios`、`npm run release:check-plans-test` 各单独跑一次收口。
    status: completed
  - id: t5-host-real-agent-baseline
    content: >
      §5.2，宿主侧执行：在宿主同步下一个候选包之前，按执行程序取得真实 agent 层基线与独立验收，写入观察记录并由指标脚本
      出表。责任方为宿主操作者。取得之前本 plan 与上位 P1 均不得关闭。
    status: pending
---

# 可靠性基线与任务集

上位：[任务完成可靠性总纲 272acb5f](./任务完成可靠性总纲_统一原则与恢复闭环及可靠性验收_272acb5f.plan.md) §4、§5.1。

## 1. 目标与冻结范围

**目标**：让"可靠性"可计算、可回归。P2–P5 每一份的收益，都用本 plan 交付的场景与指标来说明。

**冻结范围**

| 允许改 | 不允许改 |
|---|---|
| `scripts/` 下新增脚本、单测、观察记录 | `harness/scripts/**`、`harness/harness-runner.ts` |
| `harness/tests/**` 下新增套件、夹具、工具 | `profiles/**/harness/*.ts`（测试目录除外） |
| 既有测试文件里给函数加 `export`，或把嵌在 `runAll` 内的夹具函数移到顶层，行为不变 | `skills/**`、`specs/**`、`agents/**`、`templates/**` |
| `harness/tests/run-unit.ts` 的套件登记 | 任何事件字段、任何生产测试缝 |
| 发版清单与测试 README 中的套件列举 | |

本 plan 完成后，任何场景的运行时行为与 `3315f9a6` 相同。

## 2. 术语

| 术语 | 含义 |
|---|---|
| 任务 | 一个 feature 的一次交付尝试：从一句请求开始，到不再有人或框架推进为止。运行记录上是"上一次可信完成之后"的一串 run，边界口径沿用 c4e7a9b2 的交付周期 |
| 三类事实 | 框架是否宣称完成；记录与当前义务是否有效；独立验收结果。三者分开记录，互不作为前提 |
| 停止状态 | 任务最后一个 run 的原始状态：`status`、`halt_reason`、`run_disposition`、`run_wait_kind`、是否带探针、有无 `run_end` |
| 操作者动作 | 为了让任务继续，人或外部脚本额外发出的命令或修改。由观察记录确认 |
| 独立验收 | 不依赖框架自己产物的结果检查。确定性层由场景自己的断言承担；真实 agent 层由人工或测试驱动记录 |
| 观察记录 | 框架产物里没有、由人工或测试驱动补写的事实，见 §5.1 |

## 3. 指标采集（t1）

### 3.1 三类事实与派生结论

采集器对每个任务输出三类事实，不把它们压成一个标签：

| 事实 | 取值 | 依据 |
|---|---|---|
| 框架是否宣称完成 | 是、否 | 任务最后一个 run 的有效 `run_end` 为 CHAIN_SLICE_COMPLETED，或本任务内签发了新的完成记录 |
| 记录与当前义务 | 记录自洽与否；当前义务是否全部覆盖；有无阻塞项 | `inspectCompletionRecord` 只说明记录自洽；当前义务缺口、漂移、后续阻塞由 `assessFeature` 另行给出 |
| 独立验收 | 通过、失败、未验收 | 场景独立断言或观察记录 |

派生结论只在无歧义时给出：

| 结论 | 条件 |
|---|---|
| 正确完成 | 宣称完成，且独立验收通过 |
| 错误完成 | 宣称完成，且独立验收失败。**不以记录有效为前提** |
| 未验收的完成 | 宣称完成，独立验收为未验收。不计入正确完成 |
| 未完成 | 未宣称完成。保留原始停止状态，不强行归类 |

"未完成"不要求没有完成记录。演进任务里旧的完成原件可以仍然存在，判据是本任务没有签发新的完成记录。

停止状态按原始字段输出，并列出以下几种组合供阅读，出现表外组合时标"未分类"：

| 原始组合 | 读法 |
|---|---|
| TERMINAL | 结构上无法继续 |
| WAITING，等待类型 human | 等人 |
| WAITING，等待类型 external，带探针 | 可唤醒等待 |
| WAITING，等待类型 external，不带探针 | 等外部条件，但没有唤醒手段 |
| RECOVERY_PENDING、RESUME_READY | 可恢复 |
| 最后一个会话段没有 `run_end` | 进程已不在，原因未知 |

### 3.2 六项指标

| 指标 | 计算 | 标注 |
|---|---|---|
| 正确自主完成 | 结论为正确完成，且已确认的非必要操作者动作为 0 | 操作者动作未知时标"未知"，不计入分子 |
| 自动恢复 | 前提里登记了可恢复故障的任务中，已确认操作者动作为 0 且正确完成的比例 | 同上 |
| 人工救场次数 | 已确认的操作者动作数，产品决策单列 | 见 §3.3 |
| 观察到的错误完成数 | 结论为错误完成的任务数 | 只描述本次运行 |
| 恢复成本 | 从首个故障事件到"原故障对应的验证通过或任务完成"的墙钟时间、活跃时长、agent 调用数、无影响阶段重跑数 | 墙钟与活跃时长分列；未恢复的任务标"未恢复"，中途出现的 PASS 不作为终点 |
| 重复运行稳定性 | 同一场景多次独立运行的结果分布 | 首轮记"未测" |

同一个任务覆盖多个场景时，任务分母只计一次。

### 3.3 事件信号是候选，人工救场由观察记录确认

事件里没有"谁发的命令、传了什么旗标"。以下信号只作为"恢复或配置变化候选"输出：

| 候选信号 | 为什么不能直接当人工救场 |
|---|---|
| HALTED 之后出现 `resume` 且之间没有 `supervisor_restart` | attended 会话的宿主桥会自行选择恢复，没有 supervisor 事件不等于用户发了命令 |
| 任务内新增一个由 supersede 连起来的 run | supervisor 在需要后继时会自动以 supersede 拉起新 run，重启记录写在源 run |
| `manifest_identity_rebase`、`fresh_run_override` | 一次操作者动作可以同时产生多个信号 |
| 相邻 run 的模型钉值不同 | 同上 |
| `feature.yaml` 的范围修正记录 | 同上 |

确认规则：

- 观察记录的每条操作者动作写明执行者、是否必要、关联的事件（run 与事件序号或时间）。
- 一条动作可以关联多个候选信号，计一次。
- 没有被任何观察记录关联的候选信号，输出为"未确认"。信息不足时不猜。
- 任务的 run 列表以经过审计的 supersede 血缘为主。启动即失败、没有落 supersede 事件的 run，由观察记录补入；
  `manifest.successor_of` 只作为候选线索显示，不当作生产授权。

### 3.4 "无影响阶段的重跑数"

事件里没有按尝试记录的输入指纹，本 plan 也不新增字段。

- **确定性层**：登记表为每个场景声明"不受本次扰动影响的阶段"。采集器数扰动之后这些阶段的 `agent_invoke_start`，是精确值。
- **真实 agent 层**：只给代理指标并明确标注。可用信号是 testing 多次尝试的构建指纹相同，以及 verifier 证据被复用的阶段又被调用了 agent。

### 3.5 实现约束

- 采集器只 import 既有纯函数。已核实可用的导出：`partitionExecutionSessions`（goal-runner-phase.ts:340）、
  `foldBudgetLineage`（:679）、`resolveResumedBudget`（:718）、`resolveEffectiveRunEnd`（:795）、`loadEventsJsonl`（:930）、
  `filterAuthoritativeEvents`（:979）、`countAgentInvokeStarts`（:284）、`reduceRunState`（run-state-reducer.ts:96）、
  `inspectCompletionRecord` 与 feature-assessment.ts 的 `assessFeature`。
- 计数与计时用 authoritative 事件，排除 dry-run。`run_created` 会被 authoritative 过滤丢掉，需要它时用原始加载。
- 已知的坑必须有对应单测：
  - 一个 run 可以有多个 `run_end`，以 `resolveEffectiveRunEnd` 为准；
  - `run_end` 缺 `halt_reason` 时，回退到同一会话段最后一条 `phase_halt`；
  - `phase_verdict.action` 不等于实际转移，要读其后的停机或回退事件；
  - 本 run 的回退数读实际的 `phase_backtrack_requested` 事件数，不读事件里的累计字段；
  - 没有 `run_start` 的 run，正式执行的活跃时长为 0。这个 0 指正式执行计时，不代表启动没有耗时；
  - `heartbeat` 里的累计值是血缘折叠值，不得当作本 run 的值；
  - 按阶段数调用用 `agent_invoke_start`，不用 `phase_start.attempt`；
  - 归因字段只作原样输出，不当作真实根因。
- 采集器不写任何文件到被分析的工程，不调用会写盘的函数。`assess.ts` 的入口默认写 `next.json`，不使用它。
- 评估宿主的完成记录时，框架根传宿主安装的那一份，否则门禁指纹对不上。
- 入口 `scripts/reliability-metrics.mjs` 为 ESM，带 isMain 守卫，按 `candidate-release.mjs` 的先例用 harness 的 ts-node 起子进程。
  输出 JSON 与 Markdown 两种。
- 停机原因原样输出，附 `INCIDENT_REGISTRY` 已有的类别。归入总纲 §5.3 六类是 P3 的工作，本 plan 不预先做。

### 3.6 单测夹具

夹具取真实 writer 的完整产物，不裁剪、不改写：宿主 run be091c、0457a6、ae92d8、f829b8 的 `events.jsonl` 与 `manifest.json`，
以及场景套件产出的事件。heartbeat 参与既有的会话分段与时长计算，去掉会改变结果，所以保留。夹具只读。

§3.3 的四个反例与 §3.1 的错误完成反例用固定输入构造，事件形状取自上述真实产物或生产 writer：

| 反例 | 期望输出 |
|---|---|
| attended 会话自行恢复 | 候选 1 条，已确认人工救场 0 |
| supervisor 自动拉起后继 | 候选 1 条，已确认人工救场 0 |
| 启动即失败的 run 由观察记录补入任务 | 任务含该 run，操作者动作按观察记录计 |
| 一条动作关联恢复、身份改写、模型变化三个信号 | 已确认人工救场 1 |
| 宣称完成，独立验收失败，完成记录有效 | 错误完成 |
| 宣称完成，独立验收失败，完成记录无效 | 错误完成 |

新采集器的单测由 `npm run release:check-plans-test` 执行。根 `npm test` 只转发 harness 测试，不会跑它。

## 4. 场景套件（t2）

### 4.1 十三个场景

驱动层：

| 驱动层 | 含义 |
|---|---|
| 真实链路 | `runGoalRuntimeChain({ realHarness: true })`，harness 是真实子进程，agent 是脚本化回调 |
| 运行时链 | `runGoalRuntimeChain`，harness 为测试桩，用于需要控制 agent 调用结果或设备门的场景 |
| 子进程 | `goal-run-driver.ts`，用于崩溃与停放 |
| 函数级 | 直接调用生产函数 |

脚本化回调不会自行理解语义。凡是期望里含"AI 理解并裁决"的部分，确定性层只验证框架一侧的行为，语义判断留给真实 agent 层。

| 编号 | 场景 | 驱动层 | 做法与边界 | 期望 |
|---|---|---|---|---|
| S1 | 模型永久不兼容 | 运行时链 | 正式调用一支返回完整的 400 错误信封；金丝雀一支用既有的 `__testing_setCanaryProbeInvoke`，先例见 goal-canary-hard-cli 套件 | 有获准替代则自动恢复；无获准替代或型号被钉死则带明确理由交还 |
| S2 | 瞬时 API 失败 | 运行时链 | 写真实形状的输出日志，并确认实际命中了瞬时重试分支。只改 stderr 不够 | 正确完成，操作者动作 0 |
| S3 | 完成后蓝图升版 | 真实链路 | lifecycle-evolution 的 `bumpAndReconcile` 与 `evolve`；保留 `authorHooks` 对默认失败执行器的覆盖 | 正确完成，只重跑受影响阶段 |
| S4 | 验收实质变化 | 真实链路 | lifecycle-evolution L1b；保留 L1c "不对齐就不能完成" 的反例 | 正确完成，最终验收用新文本，旧证据不得自动有效 |
| S5 | 参考图与需求排除冲突 | 函数级加运行时链 | 候选生成用 `withA2Runtime`，它现在嵌在 `runAll` 内，需移到顶层；推进用 `testingGateChecks` 让真实检查与 writer 控制 | 正确完成，产品中没有排除内容 |
| S6 | 排除内容已被实现 | 真实链路 | coding 回调多写一个需求排除的元素，独立断言检查产品源码 | 正确完成，排除内容被发现并移除 |
| S7 | 非关键描述冲突 | 真实链路 | 写明冲突的具体位置、披露落在哪个产物；另给一个"未披露"的反例 | 正确完成，差异被披露 |
| S8 | 进程中断 | 子进程 | 崩溃后恢复。现成驱动不能证明自动拉起：恢复命令由测试发出，如实计为操作者动作，自动拉起段记为未覆盖 | 正确完成，操作者动作 0 |
| S9 | 真机暂不可用 | 子进程 | 先停放后显式恢复。测试发出的恢复如实计入，不隐去 | 可唤醒等待后正确完成 |
| S10 | 纯身份或时间戳漂移 | 函数级 | 引用的先例是评估与出生范围推导，不是扰动后真跑链。区分新格式与旧快照，后者仍会重跑 | 无影响阶段重跑 0 |
| S11 | 真实产品回归 | 真实链路 | real-chain-seams RC-9。两支：回退后修好；始终不修。是否修复依据实际回退事件 | 修好一支正确完成；不修一支未完成，**不得宣称完成** |
| S12 | 合法人工暂停 | 运行时链 | 选真实的人类授权类阻断，检查恢复上下文 | 未完成，停止状态为等人，恢复上下文完整 |
| S13 | 执行者错误拒修后被纠正 | 运行时链 | 第一轮 coding 不改，第二轮修复。确定性层只验证证据仍然驱动回退、最终源码被修复 | 正确完成，产品符合目标 |

S4 与 S10 成对：都可能呈现为绑定或新鲜度问题，一个必须补验，一个不得重跑。

**视觉采集段的如实说明**：真实链路套件驱动不了视觉采集。`check-testing.ts` 直接 spawn `hylyre screenshot`，没有 profile 级替换口子。
本 plan 不改生产代码，登记表里写"公开入口未覆盖采集段"。要不要开缝由 P2 决定。

**驱动层以 helper 的真实能力为准**。实施时逐条核对并确认扰动真正命中了目标分支；做不到时降一层并在实施记录写明原因。
函数级覆盖和未执行到的分支，不得写成完整任务的实测。

### 4.2 独立断言

由场景自己写，直接检查产品源码或产物内容，不读框架的结论字段。例：S6 检查产品源码里是否还有被排除的元素。

### 4.3 场景登记表与断言策略

`harness/tests/fixtures/reliability-scenarios/registry.json`，每个场景一条：

| 字段 | 含义 |
|---|---|
| `id`、`title`、`source_incident` | 编号、名称、来源事故 |
| `premise` | 前提，例如 S1 的"无获准替代" |
| `driver_layer`、`coverage_note` | 驱动层与未覆盖说明 |
| `unaffected_phases` | 不受扰动影响的阶段 |
| `expected` | 总纲期望 |
| `baseline` | 基线实测：三类事实、停止状态、操作者动作数、无影响阶段重跑数、记录时的提交 |

`baseline` 是报告，不是断言对象。套件的断言分三种：

| 情况 | 处理 |
|---|---|
| 基线已经满足期望 | 直接断言期望 |
| 期望本身就是正确失败、正确暂停、正确交还：S11 不修一支、S12、S1 无获准替代一支 | 直接断言期望 |
| 基线未达期望 | 只打印差距，不下断言。由修复它的那份 plan 补上行为断言 |

这样真实改善不会让套件变红，坏行为也不会因为被记录而长期保持绿色。

### 4.4 套件登记

- 文件 `harness/tests/unit/reliability-scenarios.unit.test.ts`，导出 `runAll`。
- `run-unit.ts` 的 `CORE_SUITES` 加一条 `releaseOnly: true`，放在既有三条 release-only 之后。套件在进程内跑 `goalMain`，排在 device-session 之后。
- id 取 `reliability-scenarios`，与既有套件 id 互不为子串。
- run-unit 没有"文件存在但未登记"的元检查，登记是否生效由 `--filter reliability-scenarios` 实跑验证。
- 设置环境变量 `RELIABILITY_RESULTS_OUT` 时，套件把每个场景的实测写到该路径，供指标脚本读取。未设置时不写任何文件。

### 4.5 耗时预算

真实链路一条约 1 到 2 分钟。整套预计 15 分钟以内。套件为 release-only，日常 `npm test` 只校验文件存在。

## 5. 观察记录与真实 agent 层（t3、t5）

### 5.1 观察记录

位置 `scripts/reliability/observations/<标签>.json`，随开发仓版本管理，不进发布件。它是一个小文件，不是新的存储层。

| 字段 | 含义 |
|---|---|
| `label`、`recorded_at` | 标签与记录时间 |
| `framework_source_commit` | 被测框架的 source_commit |
| `initial_state` | 宿主提交、工作区状态、初始现场存档的路径与校验和 |
| `environment` | adapter 与版本、实际生效的模型与推理强度、设备、视觉 provider、adapter 用户配置中的默认模型 |
| `tasks[].scenarios`、`tasks[].feature`、`tasks[].runs` | 覆盖的场景、feature、run 列表，含由观察补入的 run |
| `tasks[].interventions[]` | 每次操作者动作：种类、时间、内容、执行者、是否必要、关联的事件。种类取 `rescue_command`、`manual_file_edit`、`config_change`、`reauthorization`、`product_decision` |
| `tasks[].independent_acceptance` | 独立验收结果、执行者、依据 |
| `tasks[].source` | 这条观察是谁、依据什么写的 |

### 5.2 真实 agent 层

**责任**：真实 agent 层需要真实模型与真机，由宿主操作者执行。结果是本 plan 的交付项，对应 t5。

**规模**：首轮四个场景，定位冒烟，重复稳定性记"未测"。

**两个任务覆盖四个场景**，分母各计一次：

| 任务 | 覆盖场景 | 请求 | 说明 |
|---|---|---|---|
| 甲 | S1 | "完成开卡需求 bc-openCard-2 的交付" | 在 S1 故障条件下起跑。任务在启动处被阻断时，后面的场景没有执行到，不算覆盖 |
| 乙 | S5、S6、S11 | 同一句 | 在可运行配置下起跑。三个场景在宿主当前现场同时存在 |

不给逐步救场话术。执行过程中任何人工动作都写进观察记录。

**S1 的故障条件**来自 adapter 用户配置里的默认模型，两份 framework 配置无法重建它，执行程序单列：

- 起跑前把 adapter 默认模型设为当前账号不支持的型号，运行结束后还原；设置与还原都写进观察记录的环境一栏，不计为救场。
- 宿主 run be091c 是同一框架版本、同一现场下已经发生的一次真实记录，可作为任务甲的基线，观察记录据实补写。

**初始现场**：已于 2026-09-28 存档在 `dist/reliability-baseline/host-initial-state-20260928/`，含宿主提交号、
已跟踪文件的改动补丁、未跟踪文件包、feature 目录包、两份配置与校验和。宿主 `doc/features/` 被其 `.gitignore` 忽略，
所以 feature 目录单独打包。执行程序要包含一步可恢复性核对：在临时目录解包，与清单和校验和比对。
场外的恢复检查点未存档，恢复现场后起的是新 run，前提是不依赖旧 run 的场外状态。

**可比性**：基线与改后运行从同一存档恢复。每次运行记录模型、推理强度、adapter 版本、设备、视觉 provider。
任何一项不同都写进观察记录，不做归一。

**时机**：基线必须在宿主同步下一个候选包之前取得，此时宿主框架是 `074a4c3c`。

### 5.3 宿主历史参考值

用指标脚本对宿主该 feature 在 f829b8 之后的 run 算一份参考值，观察记录按已知事实填写并逐条标注来源。
这份数据跨多个框架版本，初始现场也不同，只作参考，不与受控基线混算，也不能替代 t5。

## 6. 基线记录与文档（t4）

- 确定性层：在当前 HEAD 跑 `--filter reliability-scenarios`，把实测写入登记表的 `baseline`。
- 把基线表写入本 plan 的实施记录，并在总纲文末追加实施记录。
- 发版清单与测试 README 中 release-only 套件的列举加上新套件。

## 7. 验收

| 编号 | 验收 | 验证方式 |
|---|---|---|
| A1 | 禁止范围零改动 | 完整 diff 按 §1 允许路径逐项核对，不只看禁止路径 |
| A2 | 指标脚本对 be091c 输出：未宣称完成；状态 HALTED，原因 `canary_cli_hard_failure`，WAITING 加 external，不带探针；无 `run_start`；正式调用 0，正式执行活跃时长 0 | 单测加实跑 |
| A3 | 对 f829b8 输出：会话 5 段，其中 1 段无 `run_end`；`resume` 候选 4 条；有效终态 CHAIN_SLICE_COMPLETED。人工次数以观察记录为准 | 单测 |
| A4 | 对 ae92d8 输出：agent 调用 8 次；本 run 实际回退 1 次；最终 `backtrack_limit`；恢复成本标"未恢复" | 单测 |
| A5 | 采集器不向被分析工程写任何文件 | 单测：运行前后对工程目录做文件清单与哈希比对 |
| A6 | §3.6 的六个反例输出符合期望 | 单测 |
| A7 | 十三个场景各有一条可复跑的实测，并逐个确认扰动命中目标分支；函数级覆盖与未覆盖段在登记表中标明 | `--filter reliability-scenarios` |
| A8 | S11 不修一支、S12、S1 无获准替代一支的本次实测符合期望 | 同上，检查实测而非登记表 |
| A9 | 全量 `npm test` 通过，release-only 套件在默认模式下只校验存在 | 全量单独跑一次 |
| A10 | 新采集器单测通过 | `npm run release:check-plans-test` |
| A11 | `scripts/` 与 `harness/tests/**` 不进发布件 | `release:pack` 后核对清单 |
| A12 | 初始现场存档可恢复 | 临时目录解包，与清单和校验和比对 |
| A13 | 真实 agent 层基线与独立验收已取得，宿主框架为 `074a4c3c` | 观察记录与指标脚本出表。宿主侧 |

## 8. 保留、裁剪、不做

| 保留 | 裁剪 | 不做 |
|---|---|---|
| 既有纯函数与既有测试 helper | 把结果压成单一标签 | benchmark 平台、A/B 系统、新持久层 |
| 既有 release-only 机制 | 把事件信号直接计为人工救场 | 新增事件字段、生产测试缝 |
| 交付周期边界口径 | "实测必须等于登记值"的快照断言 | 把停机原因归入六类故障 |
| 原始 disposition | | 为通过验收修改生产分类 |

## 9. 风险

| 风险 | 处置 |
|---|---|
| 场景在所列驱动层做不到 | 降一层并如实记录，不改生产代码 |
| 套件耗时超出预算 | 先保证十三个场景齐全，再合并共享同一次链路的场景 |
| 宿主基线迟迟未取得 | t5 保持未完成，上位 P1 不关闭；maison 侧 P2 可以开工，但宿主不得先同步新候选包 |
| 宿主产物进入夹具 | 只取 events 与 manifest，不取产品源码；夹具只读 |

## 10. 实施顺序与验证

1. t1，先红后绿，单测过滤跑。
2. t2，逐场景实施，每个场景先写独立断言与期望，再接驱动。
3. t3。
4. t4，全量 `npm test`、`--filter reliability-scenarios`、`npm run release:check-plans-test` 各单独跑一次。
5. t5 由宿主操作者执行。

迭代期间只跑过滤套件。实施由 opus 执行，实现 review 由 codex 执行，提交须用户批准。

## 11. Review 记录

### codex 首轮（2026-09-28）

结论：不宜直接开工，4 项必须修复。逐条核实后全部采纳。

| 意见 | 核实 | 处置 |
|---|---|---|
| [P1] 五种终局判据漏掉真实状态，也可能漏报错误完成 | 属实。be091c 是 HALTED 加 WAITING/external、不带探针，五种都套不上；错误完成不应以记录有效为前提 | §3.1 改为三类事实分开记录，停止状态保留原始字段；A2 改写 |
| [P2] 把生命周期事件当成人工救场 | 属实。attended 宿主桥会自行恢复；supervisor 会自动以 supersede 拉后继；be091c 没有 supersede 事件 | §3.3 改为候选加观察确认，补去重与归因规则；§3.6 补四个反例 |
| [P2] 恢复成本的终点与时间单位偏离总纲 | 属实。ae92d8 在 testing 失败后 coding 先 PASS、随后 testing 再失败并停机；裁剪 heartbeat 会改变分段结果 | §3.2 墙钟与活跃时长分列，终点绑定原故障的验证通过；夹具不裁剪；§3.5 补过滤与回退计数口径 |
| [P2] 真实 agent 基线被缩成程序交付 | 属实 | 新增 t5 与 A13；§5.2 写明责任、两个任务、S1 故障条件、存档可恢复性核对 |
| 驱动层逐场景修正 | 采纳 | §4.1 按核实结论重写，S10 降为函数级，S8、S9、S13 写明边界 |
| 快照式棘轮会让改善必红 | 采纳 | §4.3 改为三种断言策略；删除原 A7 |
| 验收逐项意见 | 采纳 | §7 重写，A8 改查实测并补 S1 无替代一支，新增 A10、A12 |
| 删除"原行内改不增行"与精确行号 | 采纳 | §6 只保留同步目标 |

## 12. 实施记录

### t1 指标采集（2026-09-28，未提交）

**改动文件**（全部新增，均在 §1 允许路径内）

| 文件 | 内容 |
|---|---|
| `harness/tests/utils/reliability-metrics.ts` | 采集器。导出 `collectReliability`（t2 直接 import）、`computeMetrics`、`deriveConclusion`、`renderMarkdown` 与全部类型；`require.main` 分支供入口子进程调用 |
| `scripts/reliability-metrics.mjs` | ESM 入口，isMain 守卫，按 candidate-release 先例以 `harness/node_modules/ts-node/dist/bin.js --transpile-only` 起子进程，参数经环境变量 `RELIABILITY_METRICS_OPTIONS` 传 JSON。参数：`--project --feature --framework-root --runs --runs-dir --observations --scenario-results --format json\|md` |
| `scripts/tests/reliability-metrics.unit.mjs` | node:test 21 例，全部经真实入口跑，由 `npm run release:check-plans-test` 执行 |
| `scripts/tests/fixtures/reliability/<run>/{events.jsonl,manifest.json}` | 宿主 be091c、0457a6、ae92d8、f829b8 原样副本（`cmp` 逐字节一致，heartbeat 保留，LF） |

**口径落地要点**

- 只 import 既有函数：`partitionExecutionSessions`、`foldBudgetLineage`、`resolveEffectiveRunEnd`、`loadEventsJsonl`、`filterAuthoritativeEvents`、
  `countAgentInvokeStarts`、`extractSupersedeTargets`、`reduceRunState`、`INCIDENT_REGISTRY`、`assessFeature`（内部即 `inspectCompletionRecord`），
  另用 `classifyGoalRunsDir` 列 run、`resolveChangeUnitExpectedExecution` 取期望链（与 goal-status 只读调用同源）、`readFeatureFrozenScope` 读范围修订。
  `resolveResumedBudget` 未用（分段结果已够）。
- 任务分组：交付周期边界 B = `assessFeature().record` ok 时的 run_id（与出生时算边界同源）；B 之后未被他人 supersede 的 run 为头，
  血缘由 `foldBudgetLineage` 的 `loadEvents` 注入口记录访问到的 run，并按其 `ancestorEvents` 判定哪些在本周期（不复制闭包逻辑）。
  血缘里 events 缺失的 run 单列 `missing_runs`。`--runs` 显式给出时合成一个任务。观察记录的 run 与多个血缘组相交时，以其第一条 run 所在组为主，
  其余并入并标 `observation`；观察补入的启动即失败 run 标 `observation`。`manifest.successor_of` 只进 `successor_clues`。
- 三类事实分开：`claimed_complete`（最后一个 run 的有效 run_end 为 CHAIN_SLICE_COMPLETED，或任务内 run 目录有完成记录原件）、
  `record`（只有 events/manifest 时 `evaluable:false` 并写原因）、`acceptance`（观察记录或场景结果，缺省未验收）。结论按事实推导，
  场景结果里的存量结论一律重算。
- 停止状态原样输出 status / halt_reason / run_disposition / run_wait_kind / has_probe（最后一段最后一条 phase_halt 带非空 `probe`）/ has_run_end，
  附 §3.1 读法（表外 = `unclassified`，已宣称完成时读法为空）与 INCIDENT_REGISTRY 原样类别。
- 候选信号：`resume_without_supervisor`、`supersede_successor`（每个带 supersede 事件的 run 一条）、`manifest_identity_rebase`、`fresh_run_override`、
  `model_pin_change`（相邻 run 的 `adapter_model_pin` 不同，锚在后一个 run 的第 0 条事件）、`scope_revision`。观察动作的 `related_events`
  按 run + event_index 或 ts 关联，一条动作可确认多个候选、计一次；无观察记录时操作者动作为未知。
- 恢复成本：（首版只算首个故障，已由下方"返修 1"改为按故障逐条，以返修为准）首个故障 = 第一条 FAIL 裁决或 phase_halt；终点 = 其后同一阶段的 PASS 裁决，或（已宣称完成时）CHAIN_SLICE_COMPLETED run_end。
  墙钟、正式段活跃时长（段区间与窗口求交）、agent 调用分列；未恢复标 `unrecovered`，数值计到任务末并标 `measured_to: task_end`。
- 无影响阶段重跑：给出 `unaffected: {phases, after}` 时数扰动点之后这些阶段的 `agent_invoke_start`（精确）；否则只给代理值并标注。

**验证**

| 项 | 结果 |
|---|---|
| 红 | 先写测试，入口不存在：21 例 1 过 20 败（`p1-t1-red.log`，过的一例是夹具 heartbeat 计数） |
| 绿 | 21/21（`p1-t1-green.log`）；中途一例反例 2 失败，原因是测试构造时后继 run 用了带模型钉值的 manifest，多出一条真实的 `model_pin_change` 候选，改为沿用源 run 的 manifest 后通过，采集器未改 |
| A2 | be091c：未宣称完成；HALTED / canary_cli_hard_failure；WAITING + external，无探针，读法"等外部条件，但没有唤醒手段"；run_start 0；正式调用 0；正式活跃 0（孤儿段时长 >0 另列） |
| A3 | f829b8：会话 5 段，1 段无 run_end；resume 候选 4 条；run_end 4 条，有效终态 CHAIN_SLICE_COMPLETED（下标 508） |
| A4 | ae92d8：调用 8；实际回退 1（累计字段 2 原样另列）；backtrack_limit / TERMINAL；恢复成本 unrecovered（首个故障下标 84 testing FAIL） |
| A5 | 夹具目录 8 个文件清单与 sha256 前后一致 |
| A6 | 六个反例全部符合期望；另加"宣称完成、验收失败、记录无法评估 → 错误完成"一例 |
| §3.5 各坑 | 多个 run_end、halt_reason 回退到 phase_halt（f829b8 第 4 段 visual_ledger_integrity）、verdict.action ≠ 实际转移、回退数不读累计字段、无 run_start 正式时长 0、heartbeat 累计值、按 agent_invoke_start 计数（f829b8 testing 9 次）、归因原样输出，各有单测 |
| 反向变异 | ①回退数改读 `backtracks_used` → A4 红；②终点改为"故障后首个 PASS" → A4 与"--runs ae92d8"两例红；③候选直接计为已确认 → 反例 1–4 红。三处均已还原（`p1-t1-mutation-m{1,2,3}.log`，还原后 `cmp` 一致） |
| A10 | `npm run release:check-plans-test` 51/51 通过（含既有单测） |
| typecheck | `cd harness && npm run typecheck` 通过 |
| 宿主实跑 | 对宿主真实工程出表（`p1-t1-host-run.md`）。跑前跑后宿主 `git status --short` 均 24 行；`doc/features/bc-openCard-2`（1500 文件）与 `framework/`（3700 文件）树哈希前后一致 |

**宿主实跑要点**：交付周期边界 = f829b8（记录 ok，但当前义务未覆盖 7 条、阻塞 4 条）。分成两个任务：
ae92d8（含 97af3f、0457a6，HALTED backtrack_limit / TERMINAL；候选 4 条均未确认）与 be091c（HALTED canary_cli_hard_failure / WAITING external 无探针）。
两者均未宣称完成、未验收、操作者动作未知；错误完成 0。be091c 的 `successor_of` 指向 f829b8，只作线索。

**偏离与放弃的准确性**

1. §3.3 写"`feature.yaml` 的范围修正记录"。实际修订载体是 run 的 `scope_revised` 事件与 feature 冻结记录 `execution-scope.json` 的 `revisions`
   （feature.yaml 只是候选，修订不写它），采集器读这两处。放弃的准确性：无，只是载体名称按代码更正。
2. §3.4 真实 agent 层的两个代理信号（testing 多次尝试构建指纹相同、verifier 证据复用阶段又被调用）在 events 中没有对应字段。
   改为给上界代理：首个故障后、故障前已 PASS 的其他阶段又被调用 agent 的次数。放弃的准确性：代理值包含合法回退造成的重跑，只能作上界。
3. resume 候选不只取"HALTED 之后"，也包括"上一段没有 run_end（进程已不在）"之后的 resume，否则 A3 的 4 条对不上（f829b8 下标 135 之前一段无 run_end）。
   候选本身不计为动作，不影响人工次数。
4. （已由返修 2 撤销）宣称完成只认 `CHAIN_SLICE_COMPLETED`（按 §3.1 字面），legacy `COMPLETED` 不计。
5. 首个故障没有阶段（启动期停机）时，只有任务完成能作为恢复终点。
6. 记录与当前义务是 feature 当前状态（`assessFeature` 一次），挂到每个任务上，并用 `issued_in_task` 标明完成记录是否由本任务签发；不是任务结束时刻的历史快照。
7. 观察记录任务条目在 §5.1 字段之外可选接受 `recoverable_fault`（自动恢复指标的分母依据）与 `unaffected`（无影响阶段精确计数的入参）。
   t2 调 `collectReliability` 时按同一形状传入。
8. A5 单测只覆盖只读 events/manifest 的模式（该模式不调用 `assessFeature`）。完整工程模式的"不写盘"由宿主实跑的 feature 目录与 framework 目录树哈希、
   `git status` 行数验证；两棵树之外（例如用户目录、系统临时目录）未核对。

#### 返修（2026-09-28，调度者两处口径意见，未提交）

**返修 1：任务未完成时任务级恢复成本不得显示"已恢复"。** 首版宿主实跑里 ae92d8 任务（含 97af3f、0457a6）停在 backtrack_limit，
任务行却是"已恢复：墙钟 2998 min"：只算了首个故障（97af3f 的 ut 停机），终点取 ae92d8 的 ut PASS，后面 testing 的故障不在计算范围内。

- `RecoveryCost` 改为按故障逐条输出 `faults[]`（`FaultCost`：run、事件下标、时间、阶段、类型、verdict、并入事件中最后一个非空 halt_reason、
  recovered/unrecovered、终点、墙钟、活跃时长、agent 调用数、`measured_to`）。原 `first_failure` / `endpoint` 字段删除。
- 切分：失败事件 = FAIL 裁决或 phase_halt。同一阶段在被该阶段 PASS 之前的失败并入同一条（紧随 FAIL 的停机、回退后再 FAIL 都并入），PASS 之后再失败是新故障；
  终点 = 该阶段的 PASS 裁决，或成功封卷的 run_end（任务完成，关闭全部未关故障）。其它阶段的 PASS 不作终点。
- 任务级：无故障 = `no_failure`；全部故障已恢复且任务宣称完成 = `recovered`（窗口到最后一个终点）；否则 `unrecovered`，墙钟、活跃、调用计到任务末并标 `task_end`。
  run 明细里的单 run 恢复成本用同一函数，"宣称完成"取该 run 的有效终态。
- Markdown 任务表"恢复成本"一栏只显示任务级状态，另起"故障明细"一节逐条列出。
- 夹具新增 97af3f 的 events.jsonl 与 manifest.json（宿主原样复制，`cmp` 一致，LF）；A5 清单随之为 10 个文件，默认分组用例改为 ae92d8 任务含 f829b8/97af3f/0457a6、无缺失。

**返修 2：宣称完成的封卷态与 `inspectCompletionRecord` 一致。** verify-feature-completion.ts 的 `RUN_END_LINEAGE_OK` / `NON_TERMINAL_OK`（:776–778）
接受 `CHAIN_SLICE_COMPLETED` 与 legacy `COMPLETED`，两者均未导出，§1 冻结生产代码不能加 export，所以采集器里定义同一集合 `SEALED_COMPLETE_STATUSES` 并注明出处。
宣称完成、停止状态读法、故障的"任务完成"终点都用它。偏离 4 随之撤销。

**验证**

| 项 | 结果 |
|---|---|
| 红 | 先改测试：23 例 20 过 3 败（A4 新结构、多 run 任务、legacy COMPLETED），`p1-t1-r2-red.log` |
| 绿 | 23/23，`p1-t1-r2-green.log` |
| 多 run 任务（97af3f + 0457a6 + ae92d8，`--runs`） | 任务级 unrecovered、计到任务末；faults = 97af3f#21 ut → ae92d8#49 该阶段 PASS，已恢复；0457a6#23 coding（FAIL retry → FAIL halt → phase_halt 并为一条，halt_reason no_progress_guard）→ ae92d8#17 该阶段 PASS，已恢复；ae92d8#84 testing，未恢复 |
| A4 | ae92d8 单 run：故障 1 条（testing#84，两次 FAIL 与停机并为一条），未恢复，计到任务末 |
| legacy COMPLETED | f829b8 事件最后 run_end 的 status 改为 COMPLETED：宣称完成、依据 run_end、读法为空、恢复成本 recovered |
| 反向变异 | ④任务级状态改回"只看首个故障" → 多 run 用例红；⑤封卷集合只留 CHAIN_SLICE_COMPLETED → legacy 用例红；②′"任何阶段的 PASS 都关闭故障" → A4 与多 run 用例红。均已还原（`p1-t1-r2-mutation-{m4,m5,m2b}.log`，还原后 `cmp` 一致） |
| A10 | `npm run release:check-plans-test` 53/53 |
| typecheck | `cd harness && npm run typecheck` 通过 |
| 宿主实跑 r2 | `p1-t1-host-run-r2.md`。跑前跑后宿主 `git status --short` 均 24 行；`doc/features/bc-openCard-2`（1500 文件）与 `framework/`（3700 文件）树哈希前后一致 |

**宿主实跑 r2 要点**：ae92d8 任务改为"未恢复：墙钟 3049.0 min，活跃 67.1 min，调用 11（计到任务末）"。故障明细三条同上一行多 run 用例
（ut 已恢复 2998.0 min / 活跃 16.1 min / 6 次调用；coding 已恢复 20.2 min / 3.4 min / 2 次；testing 未恢复 30.5 min / 4 次）；
be091c 一条 coding 阶段 canary_cli_hard_failure 未恢复。其余事实与首版一致。

#### 口径修正：重复运行稳定性按"场景 + 分支"分组（2026-09-28，未提交）

t2 偏离 12 指出的问题：`computeMetrics` 按 `scenarios` 分组，同一场景的不同分支（前提不同）被当成重复运行。

- 分组键改为"场景 + 分支键"（`<场景>/<scenario_meta.branch>`）；没有分支键的任务（观察记录）只按场景。一个键下只有一次运行时输出"未测"。
- `TaskReport` 加可选字段 `scenario_meta?: { branch?: string }`（场景套件结果本来就带，t2 写出的形状不变），采集器只读 `branch`。
- 单测 `scripts/tests/reliability-metrics.unit.mjs` 新增一例："S1 两个不同分支各一次 → 两键各为未测；S2 同一分支两次 → 分布"。
  先红（`p1-t3-stab-red.log`：旧口径输出 `{S1: 分布, S2: 分布}`）后绿（`p1-t3-stab-green.log`）。
- 放弃的准确性：入口 `--scenario-results` 仍只收一个文件，多次套件运行要做重复稳定性时须把多份结果的 `tasks` 合进一个文件；首轮本来记"未测"，未扩入口。

### t2 场景套件（2026-09-28，未提交）

**改动文件**（均在 §1 允许路径内；生产代码零改动）

| 文件 | 内容 |
|---|---|
| `harness/tests/unit/reliability-scenarios.unit.test.ts`（新增） | 十三个场景 18 个分支的驱动、独立断言、期望判定；事实一律由 `collectReliability` 求出（逐分支以 `runIds` + 观察记录形状调用）；导出 `runAll`、`runScenarios`、`SCENARIOS`；`RELIABILITY_RESULTS_OUT` 设置时写 `{schema, recorded_at, tasks: TaskReport[] + scenario_meta}`，未设置不写文件；进程内 `process.exit` 在场景期间拦成异常（不让启动期 BLOCKER 带走整个 run-unit） |
| `harness/tests/fixtures/reliability-scenarios/registry.json`（新增） | 每场景一条：id、title、source_incident、premise、driver_layer、coverage_note、unaffected_phases、expected；分支放 `branches[]`（key、label、premise、recoverable_fault、unaffected_phases、expected、`assertion`、可选 coverage_note、baseline） |
| `harness/tests/run-unit.ts` | `CORE_SUITES` 末尾（三条 release-only 之后，device-session 之后）加 `reliability-scenarios`，`releaseOnly: true` |
| `harness/tests/unit/goal-runner-testing-integrity.unit.test.ts` | 只加 `export`：`PRODUCT_FILE`、`FEATURE`、`writeFile`、`currentBuildFpOf`、`writeCleanTesting`、`PRODUCT_ASSERTION_CHECK`、`runRealVisualGate` |
| `harness/tests/unit/real-chain-seams.unit.test.ts` | 只加 `export`：`withProject`、`codingBacktrackRequested` |
| `harness/tests/unit/lifecycle-evolution.unit.test.ts` | 只加 `export`：`BLUEPRINT_ID`、`project`、`assess`、`brief`、`withSnapshot`、`withHost`、`commit`、`evolve`、`authorHooks`、`bumpBlueprint`、`bumpAndReconcile`、`successorChain`、`freshness`、`handWrittenCompletion`、`specFirstCuHooks` |
| `harness/tests/unit/goal-park-resume.unit.test.ts` | 只加 `export`：`sealLegacyInvokes`、`runDriver` |
| `harness/tests/unit/goal-runner-repair-convergence.unit.test.ts` | A2 夹具（`A2_FEATURE`、`A2_QUOTE`、`a2Write`、`a2NfcDefect`、`withA2Runtime`、`a2Collect`、`A2_EXCLUDED`、`A2_DONE`）自 `runAll` 内原样移到顶层并导出，行为不变 |

**逐场景驱动层与覆盖**（命中证据每个分支都断言；详见登记表 coverage_note）

| 场景 | 驱动层（实际） | 命中证据 | 覆盖说明 / 未覆盖段 |
|---|---|---|---|
| S1 无获准替代 | 运行时链 | `phase_halt canary_cli_hard_failure` | 金丝雀缝 `__testing_setCanaryProbeInvoke` 返回宿主形状 400（codex exec 行 + 生产 scanner 求 excerpt）；零正式调用 |
| S1 有获准替代 | 运行时链 | run1 `phase_halt adapter_cli_hard_failure` | 400 按阶段注入（coding、未钉模型），不按 argv 型号判定；框架无获准替代载体，替代由测试以 `--supersede <run1> --adapter-model gpt-5.5` 起后继（计 1 次操作者动作，确认 supersede 与 model_pin_change 两个候选）。同 run `--resume` 有 5 分钟冷却且 `--force-resume` 不豁免；截断链后继（`--start coding`）在测试桩 harness 下被上游 closure 环境指纹判 stale 拒启，后继只能从 spec 起——本分支不计无影响阶段重跑 |
| S2 | 运行时链 | `transient_api_retry_scheduled` | 输出日志用 2026-07-29 codeagent 断网实采原形（claude 同源 writer）；哨兵只认 claude 内核 / chrys，故 adapter=claude（宿主夹具补 `CLAUDE.md`；preflight 的 binary 门要求本机 PATH 有 `claude`）；断流轮 gate FAIL 经真实 writer 落盘；真实 5s 退避 |
| S3 | 真实链路 | 后继 supersede 审计事件 + 出生链 | lifecycle `evolve`（真 harness，authorHooks 覆盖默认失败执行器）；蓝图升版计产品决策、`--supersede` 计操作者动作；无影响阶段取 spec/plan（投影验收由调和刷新），CU 源链 coding/review/ut 都消费被改验收，不声明为无影响 |
| S4 对齐 / L1c 反例 | 真实链路 | 出生链含 spec；spec 门 `authoritative_content_aligned` 执行（PASS / FAIL） | 每支各起一个宿主（handWrittenCompletion 先真跑一条后继造完成记录，再真跑验收变化后继）；“旧证据不得自动有效”取升版后、起后继前的 `assessFeature().complete`（期望判定，不是独立验收） |
| S5 | 函数级 + 运行时链 | 真实 `checkVisualDiff` 执行且 `[requirement_excluded]` 生效；函数级排除项 warn | 每轮 testing 由真实 visual gate + 真实 writer 决定推进；coding 替身按提示词字面行事（出现 NFC 返修指令即加 NFC）；visual-diff 由测试写（公开入口未覆盖采集段） |
| S6 | 真实链路 | coding 回调注入排除元素 | 需求加一句排除并按新需求重做候选、提交；独立断言查 `src/main/ets` |
| S7 披露 / 未披露反例 | 真实链路 | 派生计划冲突写入；`derived_selector_contract` WARN | 冲突 A 位置：派生 Hylyre 计划 TC-002 第 1 步 `{"touch":{"by_id":"all_banks"}}`（屏 id 当元素 id）；披露落点 testing `script-report.json` 的 `derived_selector_contract`（MINOR WARN，点名 all_banks）。反例冲突 B：spec.md F1=P0 与 acceptance AC-2（F1）=P1（作者材料原有），六阶段 script-report 均未披露；反例与主支共用同一次链路 |
| S8 | 子进程 | 崩溃段 `run_end.reason=uncaught_exception` + `phase_backtrack_requested` | goal-run-driver crash_scope_in_run → resume_after_crash_scope；驱动 resume 前手工修 contracts（manual_file_edit）与 `--resume`（rescue_command，确认 resume 候选）都计入；supervisor 自动拉起段未覆盖 |
| S9 | 子进程 | 停放 exit 2 + `device_not_ready` 停机；停放时读法 `waiting_external_wakeable` | device_park → resume_with_device_ready；设备门为注入桩；`sealLegacyInvokes` 追补绑定事件（桩代际补丁）与 `--resume` 都计入；supervisor 探针唤醒段未覆盖 |
| S10 旧快照 / 新格式 | 函数级 | 纯身份升版调和成功 | 无影响阶段重跑取出生链预判（`resolveSuccessorExecutionScope`）中已执行阶段的个数，**覆盖**采集器的该字段并标注“函数级、未真跑后继链”；新格式复用 S3 宿主（其 supersede 候选属 S3，在 S10 显示未确认） |
| S11 修好 / 始终不修 | 真实链路（attended 宿主桥） | `phase_backtrack_requested testing→coding` 且候选为 `testing_failure_routing_*` | RC-9 形态；是否补 id 依据本 run 权威事件里的实际回退事件 |
| S12 | 运行时链（attended） | `phase_halt executor_waiting` | detached 执行器按退出码重写 status，waiting 只能从 attended 传输到达；helper 的 attended 回调只回 passed/failed，故测试侧临时替换 `AttendedGoalPhaseExecutor.prototype.execute` 在 coding 返回 waiting（不改生产文件）；真实 attended 宿主产生 waiting 的一侧未覆盖 |
| S13 | 运行时链 | 回退 ≥1 且拒修轮已发生 | 证据由产品现状求出（源码无“已开卡”→ 已执行断言失败，经真实 writer 落 FAIL + 候选）；确定性层只验证证据是否仍驱动回退、源码是否最终被修复，不声明“裁判纠正执行者” |

**基线实测**（`--filter reliability-scenarios` 2026-09-28 实跑，HEAD `3315f9a6` + 工作区未提交的 t1/t2；已写入登记表各分支 `baseline`）

| 场景 / 分支 | 宣称完成 | 记录与当前义务 | 独立验收 | 结论 | 停止状态（status / halt_reason / disposition，读法） | 操作者动作 | 无影响阶段重跑 | 达期望 | 断言策略 |
|---|---|---|---|---|---|---|---|---|---|
| S1 无获准替代（金丝雀 400） | 否 | 不可评估¹ | 失败（未交付） | 未完成 | HALTED / canary_cli_hard_failure / WAITING+external（等外部条件，无唤醒手段） | 0 | 代理 0 | 是 | correct_stop |
| S1 有获准替代（正式调用 400） | 是 | 不可评估¹ | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 1 | 不计（驱动限制） | 否 | gap_only |
| S2 瞬时 API 失败 | 是 | 不可评估¹ | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 0 | 0 | 是 | baseline_met |
| S3 完成后蓝图升版 | 是 | ok / complete | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 1（supersede）+ 产品决策 1 | 0 | 是 | baseline_met |
| S4 spec 对齐 | 是 | ok / complete | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 1 + 产品决策 1 | 不声明 | 是 | baseline_met |
| S4 L1c 反例 | 否 | ok / 未完成 | 失败 | 未完成 | HALTED / no_progress_guard / WAITING+human（等人） | 1 + 产品决策 1 | 代理 0 | 是 | baseline_met |
| S5 参考图与需求排除冲突 | 是 | 不可评估¹ | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 0 | 0 | 是 | baseline_met |
| S6 排除内容已被实现 | 是 | ok / complete | **失败** | **错误完成** | CHAIN_SLICE_COMPLETED | 0 | 0 | 否 | gap_only |
| S7 冲突 A 披露 | 是 | ok / complete | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 0 | 不声明 | 是 | baseline_met |
| S7 反例：冲突 B 未披露 | 是 | ok / complete | 失败 | 错误完成² | CHAIN_SLICE_COMPLETED | 0 | 不声明 | 是（反例） | baseline_met |
| S8 进程中断 | 是 | 不可评估¹ | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 2（手工修 contracts + --resume） | 0 | 否 | gap_only |
| S9 真机暂不可用 | 是 | 不可评估¹ | 通过 | 正确完成（停放时读法=可唤醒等待） | CHAIN_SLICE_COMPLETED | 2（追补绑定事件 + --resume） | 0 | 否 | gap_only |
| S10 旧快照 | 是（旧记录） | ok / 升版后未完成 | 通过 | 正确完成³ | CHAIN_SLICE_COMPLETED | 0（产品决策 1） | **3**（函数级预判 coding/review/ut） | 否 | gap_only |
| S10 新格式 | 是 | ok / complete | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 0（产品决策 1） | 0（函数级，预判出生链为空） | 是 | baseline_met |
| S11 回退后修好 | 是 | ok / complete | 通过 | 正确完成 | CHAIN_SLICE_COMPLETED | 0 | 0 | 是 | baseline_met |
| S11 始终不修 | 否 | absent | 失败 | 未完成 | HALTED / backtrack_fingerprint_repeat / TERMINAL（结构上无法继续） | 0 | 0 | 是 | correct_stop |
| S12 合法人工暂停 | 否 | 不可评估¹ | 失败（未交付） | 未完成 | HALTED / executor_waiting / WAITING+human（等人），manifest 在、run-control 已释放、spec/plan PASS 保留 | 0 | 代理 0 | 是 | correct_stop |
| S13 执行者拒修后被纠正 | 否 | 不可评估¹ | 失败 | 未完成 | HALTED / backtrack_fingerprint_repeat / TERMINAL | 0 | 0 | 否 | gap_only |

¹ 运行时链 / 子进程夹具是 spec-driven（1.1）桩宿主，`assessFeature` 抛错，采集器如实标“无法评估”。
² 冲突 B 是 real-chain 作者材料原有的优先级不一致，框架宣称完成且未披露——按口径就是错误完成，不是反例造出来的假象。
³ S10 旧快照的“宣称完成”来自源 run 的旧完成记录（本分支没有新 run）；升版后当前义务已不完整，函数级预判后继要重跑 coding/review/ut 三段。

**断言与差距**

- 断言期望（baseline_met）：S2、S3、S4 两支、S5、S7 两支、S10 新格式、S11 修好——基线已满足，断言期望（含 S2/S11 的 spec/plan 零重跑、S3 的 spec/plan 零重跑）。
- 断言期望（correct_stop）：S1 无获准替代、S11 始终不修、S12——本次实测均符合（plan A8）。
- 只打印差距（gap_only）：S1 有获准替代（需操作者 1 次）、S6（错误完成：排除元素留在产品里）、S8 / S9（各需操作者 2 次）、S10 旧快照（纯身份漂移仍预判重跑 3 段）、S13（拒修轮后证据没有再驱动回退，`backtrack_fingerprint_repeat` 终局停机）。
- 每个分支都断言扰动命中目标分支（命中证据见上一张表）。

**验证**

| 项 | 结果 |
|---|---|
| `cd harness && npm run test:unit -- --filter reliability-scenarios` | 18/18 PASS，整套 597 s（`p1-t2-suite.log`）。分驱动耗时：S1 3.1 s（两支）、S2 6.6 s、S10 旧快照 35.7 s、S3 + S10 新格式 112.1 s、S4 对齐 76.5 s / 反例 48.9 s、S5 1.5 s、S6 65.6 s、S7 65.4 s（两支同链）、S8 7.2 s、S9 7.0 s、S11 修好 84.9 s / 不修 76.0 s、S12 0.9 s、S13 1.7 s |
| 结果文件与出表 | `RELIABILITY_RESULTS_OUT=p1-t2-scenario-results.json`；`node scripts/reliability-metrics.mjs --scenario-results … --format md` → `p1-t2-scenarios-baseline.md`（正确自主完成 11/18，自动恢复 1/4，人工救场 8 + 产品决策 5，错误完成 2） |
| typecheck | `cd harness && npm run typecheck` 通过（`p1-t2-typecheck.log`） |
| `npm run release:check-plans-test` | 53/53（`p1-t2-check-plans-test.log`） |
| `node scripts/check-plan-version.mjs` | PASS |
| 改过 export / 移过夹具的既有套件 | 见下方“回归” |
| 行尾 | 新增与改动的 8 个文本文件经 node 扫描均 LF、末行有换行 |

**回归**（改过 export / 移过夹具的既有套件，各自 `--filter` 单跑一次，日志 `p1-t2-regress-<id>.log`）

| 套件 | 结果 | 耗时 |
|---|---|---|
| goal-runner-repair-convergence（A2 夹具移到顶层） | 33/33 | 3 s |
| goal-park-resume | 3/3 | 10 s |
| goal-runner-testing-integrity | 84/84 | 134 s |
| real-chain-seams | 8/8 | 352 s |
| lifecycle-evolution | 14/14 | 504 s |

**反向变异**（`p1-t2-mutation.log` / `p1-t2-mutation-results.json`；两处同时注入跑 S6、S11，跑后从备份还原并 `cmp` 一致）

1. S6 去掉独立断言（独立验收恒通过）：采集器结论由 `wrong_completion` 变成 `correct_completion`——独立断言确实决定错误完成的判定（plan A8 意图）。
2. S11 始终不修一支把期望改成“宣称完成”：该用例转红（`期望未达成（correct_stop）`），其余两例仍绿。

**偏离与放弃的准确性**

1. 登记表结构：每场景一条，分支放 `branches[]`，并新增字段 `assertion`（baseline_met / correct_stop / gap_only）作为断言策略的唯一出处。§4.3 字段表没有它；放弃的准确性：无。
2. S1 有获准替代：框架没有“获准替代型号”的载体，替代由测试以 `--supersede --adapter-model` 给出并计 1 次操作者动作；同 run `--resume` 受 5 分钟冷却（`--force-resume` 不豁免）；截断链后继在测试桩 harness 下被上游 closure 环境指纹判 stale 拒启，后继从 spec 起。放弃的准确性：该分支不计无影响阶段重跑；400 按调用阶段注入，不校验 argv 里的实际型号。
3. S2 adapter 取 claude（生产哨兵只认 claude 内核与 chrys 信封），宿主夹具补 `CLAUDE.md`；preflight binary 门要求本机 PATH 有 `claude` CLI（与既有套件依赖 codex / cursor CLI 同性质）。
4. S4 两支各起一个宿主（不合并）；“旧证据不得自动有效”读 `assessFeature().complete`，属于对框架行为的期望判定，不进独立验收。
5. S5 visual-diff 由测试写入（视觉采集段公开入口未覆盖，与 §4.1 说明一致）；运行时链 harness 为测试桩，testing 轮由真实 `checkVisualDiff` + 真实 writer 决定。
6. S7 反例与主支共用同一次链路，反例冲突用作者材料原有的 F1 优先级不一致，没有另造第二条链；披露判据 = testing `script-report.json` 非 PASS 检查的 details 点名 `all_banks`。
7. S8 / S9：驱动在恢复前的手工修 contracts、`sealLegacyInvokes` 追补绑定事件、`--resume` 全部计为操作者动作；supervisor 自动拉起 / 探针唤醒段未覆盖。
8. S10 函数级：无影响阶段重跑数取出生链预判中已执行阶段的个数，覆盖了采集器的该字段并在 note 中标明；三类事实仍取采集器。新格式分支复用 S3 宿主。
9. S12：helper 的 attended 回调只回 passed/failed，测试侧临时替换 `AttendedGoalPhaseExecutor.prototype.execute` 在 coding 返回 waiting（不改生产文件、不新增生产缝）；真实 attended 宿主产生 waiting 的一侧未覆盖。
10. 扰动点：后继 run 的 `run_created` 不在 authoritative 时间线里，采集器找不到它，扰动点改取首个 `run_start`（S3、S4）。
11. 套件在场景期间把进程内 `process.exit` 拦成异常（生产启动期 BLOCKER 会在进程内调用 exit，曾把整个 scratch 进程带走）；只影响本套件执行期。
12. 采集器口径发现（未改 t1，留给 t4 / 调度者裁决）：`computeMetrics` 的重复运行稳定性按 `scenarios` 分组，同一场景的不同分支（前提不同）被当成重复运行，出表里 S1/S4/S7/S10/S11 显示为分布而不是“未测”；首轮应读作“未测”。
13. t4 的同步项（发版清单与测试 README 的 release-only 列举、全量 `npm test`）不在本 todo，未做。

### t3 观察记录与宿主执行程序（2026-09-28，未提交）

**改动文件**（均在 §1 允许路径内，全部 LF）

| 文件 | 内容 |
|---|---|
| `scripts/reliability/observations/TEMPLATE.json`（新增） | §5.1 字段，外加 t1 已接受的可选 `recoverable_fault`、`unaffected`；占位值，经 `--runs-dir 夹具 --observations TEMPLATE.json` 实跑可解析 |
| `scripts/reliability/observations/host-history-20260928.json`（新增） | 宿主历史参考值的观察记录，事实来源 `p1-t3-host-history-facts.md`，逐条写 `source` |
| `scripts/reliability/baselines/host-history-20260928.md`（新增） | 带观察记录重跑采集器的 Markdown 出表，文件头注明生成命令与"只作参考" |
| `scripts/reliability/README.md`（新增） | 指标脚本用法与参数；观察记录写法与候选关联步骤；确定性层跑法与 `RELIABILITY_RESULTS_OUT` 出表；真实 agent 层执行程序（§5.2 全部要素） |

**宿主历史观察记录要点**

- 一个任务 `host-history-bc-openCard-2`：run 97af3f、0457a6、ae92d8、be091c。be091c 没有 supersede 事件，由观察记录补入（出表标 `observation`），
  原本单独成组的 be091c 任务并入。
- `framework_source_commit` 按 run 分列（844606b3 之后未核 / 4d3871eb / 4d3871eb + 手工补丁 / 074a4c3c），标注"跨版本、初始现场不同，只作参考，不与受控基线混算"；
  `initial_state` 未存档，写明现场差异。
- 操作者动作 7 条，全部 `necessary: false`（事实文件第 8 条是"停机后需要但尚未执行"的动作，不计入，写进 `notes`）。关联（动作编号为 `interventions[]` 下标，从 0 起，与出表一致）：
  动作 1（接续话术起跑 0457a6）→ 0457a6#2 supersede；动作 5（ae92d8 钉 gpt-5.5 并枚举三个 supersede）→ ae92d8#2 supersede 与 ae92d8#0 模型钉值变化，计一次；
  动作 6（be091c 起跑未钉模型）→ be091c#0 模型钉值变化（gpt-5.5 → 无）。同步框架包、手工 npm install、手工打补丁、话术写错致杀 run 四条没有对应候选，`related_events` 留空或只指向上下文事件。
  0457a6#14 的 resume 由谁发出事实文件没有写，不关联，保持未确认。
- 独立验收 `fail`：按事实文件写 ae92d8 失败截图的人工结论（半模态溢出、"同意并继续"被裁切不推进；结果页有需求排除的 NFC 卡）；其余 run 未验收写在 basis。
- 场景标 S1、S6、S11（400 模型不支持 / 结果页含排除的 NFC / testing 两轮 FAIL 的产品缺陷），S5 未单独观察到不列；`recoverable_fault: true`（ae92d8 钉模型后越过了模型不支持）。

**出表要点**（`baselines/host-history-20260928.md`；交付周期边界 f829b8；记录 ok，当前义务未覆盖 7、阻塞 4）

| 项 | 值 |
|---|---|
| 任务数 | 1 |
| 宣称完成 / 独立验收 / 结论 | 否 / 失败 / 未完成 |
| 停止状态 | HALTED / canary_cli_hard_failure / WAITING+external，不带探针（等外部条件，但没有唤醒手段） |
| 已确认的操作者动作 | 7（产品决策 0）；候选 5 条，已确认 4、未确认 1（0457a6#14 resume） |
| 正确自主完成 | 0/1 |
| 自动恢复 | 0/1 |
| 人工救场次数 | 7 |
| 观察到的错误完成数 | 0 |
| 恢复成本 | 未恢复：墙钟 5193.1 min、活跃 67.1 min、调用 11（计到任务末）；故障 4 条：97af3f ut、0457a6 coding 已恢复，ae92d8 testing、be091c coding 未恢复 |
| 重复运行稳定性 | S1、S6、S11 均未测 |
| 无影响阶段重跑 | 代理 0 |

宿主 `git status --short` 在两次实跑（无观察记录看候选、带观察记录出表）前后均为 24 行。

**A12 可恢复性核对**（按 README §4.3 的步骤在系统临时目录实做，做完已删）

| 步骤 | 结果 |
|---|---|
| `sha256sum -c SHA256SUMS` | 补丁、未跟踪包、feature 包三项 OK |
| 两份配置 | sha256 与宿主现有文件一致（0af17673…、95e2ea3f…），写入 README |
| 宿主提交 025d1b6b | 存在 |
| `git archive` 取 13 个已改文件原版 + `git apply --check` / `apply` | 通过 |
| 未跟踪包清单 vs `untracked-files.txt` | 一致（11 个） |
| feature 包 | 1497 个文件 |
| `host-status.txt` 的 24 个路径在解包目录中都存在 | 是 |
| 与宿主现有文件比对 | 11 个未跟踪文件与 feature 目录（`diff -rq` 0 差异）逐字节相同；13 个打过补丁的文件忽略 CR 后相同（宿主 `core.autocrlf=true`，`git archive` 出 CRLF） |

**偏离与放弃的准确性**

1. **存档不完整（需调度者裁决）**：`feature-dir.tgz` 只含 `open-card-flow-v2/`。同属 bc-openCard-2 且被 `.gitignore` 忽略的 `blueprint/`（CU 引用的蓝图与契约权威）、
   旧 CU `open-card-flow/`、`doc/features/原始需求/` 不在存档里，恢复现场时不会被还原。蓝图最后修改于 09-24，早于存档，当前内容即存档时刻内容。
   我没有改动存档（它由调度者建立），README 写明缺口与补档命令、以及"未补档前每次跑完核对这几处"。放弃的准确性：若 t5 的运行改了蓝图，按现存档恢复后第二个任务的现场与第一个不同。
   **更正（2026-09-28，codex 首轮返修第 9 项）**：上面“只含 `open-card-flow-v2/`、原始需求不在存档里”有误——`feature-dir.tgz` 同时含 `open-card-flow-v2/`（1466）与 `doc/features/原始需求/`（31），
   共 1497 个文件，tar 列表里中文路径显示为八进制转义，当时看漏。调度者已补档 `feature-dir-bc-openCard-2-full.tgz`：整个 `doc/features/bc-openCard-2`（`blueprint/` 2、`open-card-flow/` 32、`open-card-flow-v2/` 1466，共 1500，与磁盘逐一对上；
   补档时宿主未变化：HEAD 025d1b6b、状态 24 行、最新 run 仍是 be091c），在 bc-openCard-2 子树上取代 `feature-dir.tgz`；`SHA256SUMS` 覆盖四个文件，校验全部 OK。
   仍未存档：`~/.maison` 场外检查点、`doc/features` 下其它 feature、构建缓存。README 的存档清单、恢复步骤（bc-openCard-2 用 full 包、原始需求取自 `feature-dir.tgz`）与可恢复性核对已按此更新，缺口说明与补档命令已删；存档目录未改动。
2. 观察记录的 `framework_source_commit` 在历史记录里是按 run 分列的对象，不是模板里的单个字符串；采集器不读该字段。
3. 动作的 `actor` 在事实文件没写明时写"未核"，没有推断。
4. README 的恢复步骤用 `git reset --hard` + `git clean -fd` 重置宿主工作区，是给宿主操作者的破坏性步骤，已写明"先确认没有要保留的东西"。本次 A12 只在临时目录做，未碰宿主工作区。

### t4 文档同步（2026-09-28，未提交；全量测试由调度者执行）

- `docs/operations/release-checklist.md` 第 13 行 release-only 列举加 `reliability-scenarios`，只补列举。
- `harness/tests/README.md` 里没有 release-only 套件的列举（全文无 real-chain / release-only 字样），按"只补列举、不扩写"未新增内容。放弃的准确性：测试 README 不列 release-only 套件，与改前一致。
- 确定性层基线写入登记表与实施记录已在 t2 完成；总纲文末的实施记录、全量 `npm test`、`--filter reliability-scenarios` 收口跑留给调度者，t4 保持 pending。

**验证**（日志在会话 scratchpad）

| 项 | 结果 |
|---|---|
| `npm run release:check-plans-test` | 54/54（`p1-t3-check-plans-test.log`，含新增口径用例） |
| `cd harness && npm run typecheck` | 通过（`p1-t3-typecheck.log`） |
| `cd harness && npm run test:unit -- --filter docs` | docs-authoring-lint 18/18（`p1-t3-docs.log`） |
| `node scripts/check-plan-version.mjs` | PASS |
| A11 `npm run release:pack` | 通过；清单 1225 个文件，根 `scripts/`（排除 60）与 `harness/tests/`（排除 893）零条目，zip 列表同样零条目。打包前后 `git status --short` 一致。注意：打包覆盖了 `dist/framework-3.1.0.zip` 与 `.manifest.json`（`dist/` 不进版本库） |
| 行尾 | 新增与改动的 7 个文本文件经 node 扫描均 LF、末行有换行、无 BOM |

### codex 实现 review 首轮返修（2026-09-28，未提交）

九项全部属实（第 9 项是文档更正）。每项先写复现用例跑红，再改实现变绿；日志在会话 scratchpad `p1-t2-r1-*.log`。

**逐项**

| # | 核实结论 | 改动点 | 红 → 绿 |
|---|---|---|---|
| 1 | 属实。`runFacts` 用原始事件求有效终态与最后会话，dry 会话的 `run_end` 会改写正式结论 | `reliability-metrics.ts` `runFacts`：有效终态 `resolveEffectiveRunEnd(run.auth)`，最后会话与探针取最后一个 authoritative 段；`sessions` 仍列原始段（含 `mode: dry`）作明细 | 新增 2 例（正式 HALTED 后追加 dry 完成段；完成后追加 dry HALTED 段，dry 事件按 `setAppendEventBaseFields({dry_run:true})` 全段打标）红 → 绿 |
| 2 | 属实。任务内顺序与交付周期过滤都按 run id 字典序 | `orderRuns`：supersede 审计事件的目标先于后继，其余按起始时刻（首个事件 ts，缺则 `manifest.created_at`，均毫秒）；交付周期改为起始时刻不早于边界 run（边界 run 缺时回退旧的 id 比较） | 新增 1 例（同秒源 run HALTED、字典序更小的后继完成：应输出后继终态、正向恢复时间）红 → 绿。**边界比较没有单独的红用例**：边界来自完成记录，需完整工程目录，`--runs-dir` 夹具构造不出；它与顺序共用同一个 `createdMs` 口径 |
| 3 | 属实。`interventions` 缺失经 `?? []` 变成已知零次 | `operatorFacts`：只有 `interventions` 是数组才算已知（空数组 = 明确零次），缺字段 = 未知；`TEMPLATE.json` 的动作 `content` 与 README 字段表写明“没有动作写 `[]`，缺字段按未知处理” | 新增 2 例（缺字段 → 未知、不计自主完成与自动恢复分子；显式 `[]` → 零次）前者红 → 绿。场景套件所有分支原本就显式传数组，未改 |
| 4 | 属实。S10 两支用源 run 的历史完成生成了“正确完成”，并把预判阶段数覆盖进 `unaffected_reruns.exact` | 套件：函数级分支改为 `prediction`（不调采集器、不产任务）；`evaluateOutcome` 断言函数级分支不得产出任务；结果文件新增 `predictions`。采集器：`scenarioResults[].predictions` 原样进 `function_level_predictions`，不进任务与指标，Markdown 末尾单列“函数级预判，未执行任务” | 采集器新增 1 例红 → 绿；套件跑 S10：旧快照分支“不得产出任务”红（`p1-t2-r1-item4-suite-red.log`）→ 绿 |
| 5 | 属实。S7 两分支同一工程同一 run 各写一条任务 | `buildResultsDoc`：按 `taskKey`（工程根 + run 列表）汇总，同一任务只写一次，独立验收取各分支最差（任一失败即失败），结论由采集器重算；分支检查另列 `branches[]` 指回任务。S7 驱动给两分支同一份独立验收（涵盖冲突 A、B 两项）与任务标签 `S7` | 自检 1 例（A 通过、B 失败 → 1 个任务、验收失败、正确完成分子 0）红 → 绿 |
| 6 | 属实。反例在 baseline_met 下强制独立验收为 fail，锁死当前框架缺陷 | 反例改为自检里的固定输入：缺少披露的 script-report → `s7Disclosed` 判未披露，带披露的 → 判已披露。真实链路的冲突 B 改为分支 `undisclosed-in-chain`（期望“差异被披露”，gap_only）；冲突 A 分支期望改为“宣称完成且冲突 A 被披露” | 自检 1 例（假设框架已披露冲突 B，按登记策略评估不得转红）红 → 绿 |
| 7 | 属实。命中只看 `gates.length` 与另一份函数级夹具的 warn | `s5ExclusionHit(gates)`：运行时这份 gate 的 details 同时含 `[requirement_excluded]` 与 `result_nfc_card` | 自检 1 例红 → 绿；另把运行时 visual-diff 的排除缺陷去掉，S5 以“扰动未命中目标分支”失败（`p1-t2-r1-mut7b.log`），已还原 |
| 8 | 属实。独立验收依赖驱动封装的 `goal.main()` 返回码与阶段事件 | `s9Acceptance(host, _frameworkOutcome)` 只看产品源码与测试侧 testing 桩写下的结果；返回码与 ut/testing 执行证据移到期望检查 | 自检 1 例（同一产品证据、改变返回码，独立验收不变）红 → 绿 |
| 9 | 文档更正（调度者已补档并核对） | `scripts/reliability/README.md` 存档清单、恢复步骤、可恢复性核对按实情更新；删缺口说明与补档命令；t3 偏离第 1 条追加更正 | 可恢复性核对命令在临时目录实跑：四个文件校验 OK、full 包 1500、原始需求 31；存档目录未改 |

**顺带澄清**：S1 有获准替代分支的无影响阶段重跑，登记表与实测都是采集器的**代理值 2**（未给无影响阶段时的上界代理）。它来自驱动限制——截断链后继被测试桩 harness 拒启，后继只能从 spec 起，spec/plan 各重跑一次——不作无影响阶段重跑结论。t2 基线表里写的“不计（驱动限制）”即指这个代理值不作结论，统一表述为“代理 2（驱动限制，不作结论）”。

**反向变异**（跑后从备份还原，`cmp` 一致）

| 变异 | 结果 |
|---|---|
| 第 3 项改回“有观察记录即已知”（缺字段当零次） | “缺 interventions 字段”用例转红，显式 `[]` 用例仍绿（`p1-t2-r1-mut3.log`） |
| 第 5 项改回逐分支各写一条任务 | 自检 5 转红：“同一 run 应只汇总一个任务，实得 2”（`p1-t2-r1-mut5-7.log`） |
| 第 7 项改回只查 `gates.length` | 自检 7 转红：“只有 gate 执行、没有排除证据时不得判命中”（同上） |
| 第 7 项补充：去掉运行时排除缺陷 | S5 以“扰动未命中目标分支”失败（`p1-t2-r1-mut7b.log`） |

**修正后的基线**（`--filter reliability-scenarios` 22/22：4 条自检 + 18 个分支，598 s；已写入登记表 `baseline`；出表 `p1-t2-scenarios-baseline-r2.md`）

| 场景 / 分支 | 宣称完成 | 记录与当前义务 | 独立验收 | 结论 | 停止状态 | 操作者动作 | 无影响阶段重跑 | 达期望 | 策略 |
|---|---|---|---|---|---|---|---|---|---|
| S1 无获准替代 | 否 | 不可评估 | 失败（未交付） | 未完成 | HALTED / canary_cli_hard_failure / WAITING+external（无唤醒手段） | 0 | 代理 0 | 是 | correct_stop |
| S1 有获准替代 | 是 | 不可评估 | 通过 | 正确完成 | 完成 | 1 | 代理 2（驱动限制，不作结论） | 否 | gap_only |
| S2 | 是 | 不可评估 | 通过 | 正确完成 | 完成 | 0 | 0 | 是 | baseline_met |
| S3 | 是 | ok / complete | 通过 | 正确完成 | 完成 | 1 + 产品决策 1 | 0 | 是 | baseline_met |
| S4 对齐 | 是 | ok / complete | 通过 | 正确完成 | 完成 | 1 + 产品决策 1 | 不声明 | 是 | baseline_met |
| S4 L1c 反例 | 否 | ok / 未完成 | 失败 | 未完成 | HALTED / no_progress_guard / WAITING+human | 1 + 产品决策 1 | 代理 0 | 是 | baseline_met |
| S5 | 是 | 不可评估 | 通过 | 正确完成 | 完成 | 0 | 0 | 是 | baseline_met |
| S6 | 是 | ok / complete | 失败 | **错误完成** | 完成 | 0 | 0 | 否 | gap_only |
| S7（一个任务，两分支） | 是 | ok / complete | 失败（冲突 B 未披露） | **错误完成** | 完成 | 0 | 不声明 | 冲突 A 分支：是；冲突 B 分支：否 | A baseline_met / B gap_only |
| S8 | 是 | 不可评估 | 通过 | 正确完成 | 完成 | 2 | 0 | 否 | gap_only |
| S9 | 是 | 不可评估 | 通过（产品 + testing 桩结果） | 正确完成 | 完成 | 2 | 0 | 否 | gap_only |
| S10 旧快照 | — | — | — | **函数级预判，未执行任务** | — | — | 预判 3（不是实际重跑） | 否 | gap_only |
| S10 新格式 | — | — | — | **函数级预判，未执行任务** | — | — | 预判 0 | 是 | baseline_met |
| S11 修好 | 是 | ok / complete | 通过 | 正确完成 | 完成 | 0 | 0 | 是 | baseline_met |
| S11 始终不修 | 否 | absent | 失败 | 未完成 | HALTED / backtrack_fingerprint_repeat / TERMINAL | 0 | 0 | 是 | correct_stop |
| S12 | 否 | 不可评估 | 失败（未交付） | 未完成 | HALTED / executor_waiting / WAITING+human | 0 | 代理 0 | 是 | correct_stop |
| S13 | 否 | 不可评估 | 失败 | 未完成 | HALTED / backtrack_fingerprint_repeat / TERMINAL | 0 | 0 | 否 | gap_only |

汇总（任务 15 个；S10 两支是预判，不计；S7 两分支合为 1 个任务）：正确自主完成 8/15，自动恢复 1/4，人工救场 8 次（另有产品决策 3），错误完成 2（S6、S7），重复运行稳定性全部“未测”。
与 t2 首版的差别：任务数 18 → 15（S10 两支移出、S7 合并）；正确自主完成 11/18 → 8/15（S10 两个历史完成不再算，S7 冲突 A 不再单独算正确完成）；产品决策 5 → 3（S10 两条随预判移出）；错误完成仍是 2，但构成从“S6 + S7 反例”变成“S6 + S7 整体任务”。

**验证**

| 项 | 结果 |
|---|---|
| `npm run release:check-plans-test` | 60/60（`p1-t2-r1-check-plans-test.log`；采集器新增 6 例） |
| `cd harness && npm run test:unit -- --filter reliability-scenarios` | 22/22，598 s（`p1-t2-r1-suite.log`） |
| `cd harness && npm run typecheck` | 通过 |
| `node scripts/check-plan-version.mjs` | PASS |
| 行尾 | 改动的 7 个文本文件经 node 扫描均 LF、末行有换行、无 BOM |

**改动文件**：`harness/tests/utils/reliability-metrics.ts`、`scripts/tests/reliability-metrics.unit.mjs`、`harness/tests/unit/reliability-scenarios.unit.test.ts`、`harness/tests/fixtures/reliability-scenarios/registry.json`、
`scripts/reliability/observations/TEMPLATE.json`、`scripts/reliability/README.md`、本 plan（本节与 t3 偏离第 1 条的更正）。生产代码与存档目录未改；另一位实施者对“重复运行稳定性按场景 + 分支分组”的改动保留未动。

**偏离与放弃的准确性**

1. 第 2 项的交付周期边界没有独立的红用例（见上表），只由与顺序共用的起始时刻口径覆盖。放弃的准确性：边界比较若另有错误，本轮单测抓不到。
2. 起始时刻优先取首个事件（`run_created`）的 ts，其次 `manifest.created_at`。首版先取 `created_at` 时，既有“反例 4”转红：夹具复用了 ae92d8 的 manifest，`created_at` 与事件时间不一致。真实 run 两者一致，所以改成以事件时间为准。
3. 结果文件 schema 升为 `reliability-scenario-results/2`（`tasks` 去重 + `predictions` + `branches`）；采集器只读 `tasks` 与 `predictions`。
4. 第 8 项的 `s9Acceptance` 保留第二个参数（框架结论），只供自检证明独立验收不读它；实现里不使用。
5. 第 4 项新增 `evaluateOutcome` 对“函数级”驱动层的结构断言（函数级分支不得产出任务），属于套件自身的约束，不是场景期望。
6. `scripts/reliability/baselines/host-history-20260928.md`（t3 产出）没有按新口径重出。宿主 run 的 id 秒级时间戳互不相同，第 2 项不改变它们的顺序；第 1 项只影响含 dry 会话的 run；第 3 项对已写 `interventions` 的宿主观察记录没有影响。

### t4 收口（2026-09-28，未提交，调度者执行）

| 项 | 结果 |
|---|---|
| codex 返修确认（gpt-6-astra，xhigh，只读静态） | **通过**。8 条 P2 与第 9 项文档更正全部关闭，无新增阻断，无撤回。五个既有测试文件经完整 diff 核实只有 `export` 与函数位置移动，原有测试行为未变 |
| 全量 `cd harness && npm test`（单独跑） | EXIT=0；unit 4883 passed / 0 failed；fixtures 46 passed / 0 failed |
| `--filter reliability-scenarios` | 22/22，598 s（返修后实施方所跑，其后无代码改动） |
| `npm run release:check-plans-test` | 60/60（同上） |
| 宿主历史参考表按返修后口径重出 | 与已存档的 `baselines/host-history-20260928.md` 正文逐字一致，未更新文件；宿主 HEAD 与 `git status --short` 行数（24）未变 |

非阻断遗留（codex 建议，未做）：交付周期边界筛选没有独立用例。后续触及该筛选时补一个同秒、随机后缀逆序的边界用例。

t5（宿主真实 agent 基线）仍是 pending，责任方为宿主操作者，须在宿主同步下一个候选包之前完成。本 plan 与上位 P1 在 t5 取得之前不关闭。
