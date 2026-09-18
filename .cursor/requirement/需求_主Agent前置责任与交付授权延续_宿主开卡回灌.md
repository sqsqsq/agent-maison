# 需求文档：主 Agent 的前置责任与交付授权延续（宿主开卡需求回灌）

> 文档性质：**需求输入**，交主干（main / 3.1.0）。不是施工图。
> 起草日期：2026-09-18。代码基线：main `86524114`（单职责路径 plan a9f3c7d2 收口之后）。
> 上位：[动态工作流总纲](../plans/动态工作流_总纲_全阶段Skill独立组合与义务驱动编排_91c4e7a2.plan.md)、[P8 plan](../plans/动态工作流_P8_轻量交互路径与run内范围修订_d2f6a8b1.plan.md)、[单职责路径 plan](../plans/单职责路径_入口到执行的衔接_宿主验收回灌_a9f3c7d2.plan.md)。
> 关联原则：简单优先、减法优先；稳定优先于全面管控（不为防伪造加机制）；宿主跑挂回 maison 侧修；验收必须对准生产路径；收口标准是宿主用同一句原话重跑。

---

## 0. 交办口径

1. 先读本文件，再读 §7 事实索引指到的代码与文档位置；plan 引用的行号必须是实读的当前行号。
2. 本需求是**文字与接线修正**：优先复用既有入口（`--prepare-scope` 候选、首次 harness 调用冻结、`--prepare-run`、request CLI 的 `--prepare-request`），核对后确实缺接线才做最小补接；**不得预设只改文字，也不得预设必须加机制**。
3. 不新增：监控、工作区 clean 门禁、注册表、feature flag、平行文件、新的编排系统。
4. 文档行数预算是硬门禁（`specs/phase-rules/docs-rules.yaml`）：AGENTS 模板 ≤120 行（当前 115），技能 ≤150/250。只能原位改写或行内追加。
5. plan 必须带追溯矩阵（需求条款 ↔ 改动位置 ↔ 验证用例 ↔ 宿主观察点），并先回答 §8 的问题。
6. 上一轮登记的待办 task_d09f8f18（"补测试类请求写之前先 `--prepare-request` 看落点"提到入口层）**并入本需求 R1**，不单做。

## 1. 触发事件（已核实，2026-09-18）

宿主 `D:\1.code\SimulatedWalletForHmos` 集成 `3bcf5bba`、`AGENTS.md`/`CLAUDE.md` 已按模板重生成、事故期记忆已清理后，用户用一句自然语言触发正式需求（银行卡开卡后续流程，四个页面 + 半模态 + RDB + 路由，需求源 `doc/features/原始需求/1-2-银行卡/原始需求.md`）。主 agent 的实际行为（回放其 transcript）：

1. 读了正确的文档：需求源、`bc-openCard-1` 的 `execution-scope.json`、`component-design/SKILL.md`、`docs/operations/project-entry.md`、`app-component-blueprint-workflow.md`、`MIGRATION.md` 前 60 行、`framework.local.json`。
2. 第 34 步决定："先通读代码再动手写代码；框架设计产物（蓝图/CU）交给子 agent 并行做"。
3. 第 40 步派出设计子 agent，任务书写明"只做设计产物，不写产品源码、不启动 run、不跑阶段"——**它完全理解并遵守了设计技能的显式边界**，但把这条边界当成子 agent 的边界而非自己的；同一任务书写"主 agent 正在按此实现代码，蓝图请与之一致"——**设计与实现的依赖方向被倒置**。
4. 主 agent 自己写完 13 个改动文件 + 15 个新文件（页面、半模态、RDB、路由、裁图资源、ohosTest 用例），经框架 hvigor 执行器打包装机，用自写 uitest 驱动脚本走完流程，经 request CLI 跑 UT。
5. 第 106–107 步读了 `goal-mode-entry.ts` 的 `--prepare-scope` 源码，随后向用户提问："是否按 Maison 框架跑完整正式阶段链……这条链工作量很大，前一个需求跑了 4 轮 goal run"，选项为"现在跑完整阶段链 / 先停在这里"。**完整交付授权被当成收尾时可再问一次的可选项**。
6. 全程未生成范围候选（无 `feature.yaml`）、未冻结范围（无 `execution-scope.json`）、未建 run。子 agent 产出 `doc/features/bc-openCard-2/blueprint/component-blueprint.yaml`（revision 2，admitted）与 `open-bank-card-flow/change-unit.yaml`（readiness=ready），蓝图登记 `gap-component-assets-index`。

用户答"先停在这里"，宿主现场整体留档、工作区回到干净状态（见 §5 前提）。

## 2. 根因

**主 agent 的前置责任没有在入口落实**。顺序规则其实存在，但散在三处：设计技能"停在设计交接……外层接收 readiness 后在已有授权内创建 attended Goal"（`skills/project/component-design/SKILL.md:121-122`）、施工入口"选 ready CU → `--prepare-scope` 生成候选 → 推进"（`skills/project/change-unit-progression/SKILL.md:15`）、入口表"完整实现交付"一格的四项输入与两条载体（`templates/AGENTS.md.template:57`）。三处各自守自己的边界，**没有一处写成主 agent 自己要担的责任**：把本次请求接入对应执行路径、对委派出去的工作承担同样的前置、下游产出以上游依据和有效范围为输入。主 agent 把自己的编码活动放在这些职责之外，把框架当成事后验证工具。

同类事故：上一轮 MaskUtil 补单测（先写测试再找怎么跑）、本轮开卡（先写代码再找怎么验）。两者的共同模式是**出口都在，主 agent 动手前的责任没人说**。同一模式还会在"改了架构再补蓝图""跑了真机再补 test-plan"重演。

深层后果：整条链可以在代码写完后"补跑"，review/UT/真机/视觉证据都是真的，看起来全绿，但"设计决定范围、范围约束实现"已不存在，框架退化成事后补文档的流水线。

**流程根因**：P8 与单职责两轮都验证了"正确姿势下机器对不对"和"单职责一句话能否走到正确姿势"，从未验证"完整正式需求一句话能否走到正确姿势"。

**证据边界**（不得写过头）：主 agent 遵守了子 agent 那条显式边界，只支持"把主 agent 责任写清楚值得先试"，不证明"写一句就一定遵守"；收口仍以宿主重跑为准。

## 3. 需求条目

### R1 入口写明主 agent 的前置责任（约束依赖关系，不是固定流水线）

- 在 `templates/AGENTS.md.template` §4.0 判类段增加主 agent 责任，覆盖所有路径，语义为：主 agent 负责把本次请求接入对应执行路径，并对所委派的工作承担同样的前置责任；同一交付单元的下游产出必须以已具备的上游依据和有效范围为输入——**不得边补前置边提前施工，不得要求设计追认已写好的实现**；已有有效输入与证据按规则复用，缺口交回责任方；**无 Feature 的独立测试请求**动手写之前先执行 request CLI `--prepare-request` 确认落点与载体（合并 task_d09f8f18）；**已有 Feature/CU 上下文的测试沿其有效范围和阶段入口执行**，不得把正式交付中的测试拆成独立请求（否则重现"工具跑了、交付链没接上"）。不新增分类机制。
- 三条边界必须同时写明，避免制造"任何事都必须先跑六阶段"的新问题：① 读代码、分析截图等**准备工作可以并行**，禁的是依赖未满足的施工；② 局部 review/UT/testing 请求走各自的 request 准备路径，不强迫建蓝图或 Feature；③ 恢复已有任务复用有效范围与证据，不因新规则重跑完整链。
- 措辞落在既有句子上原位改写或行内追加，不新开小节；模板预算 ≤120 行。
- 验收：smoke 逐字锁定该责任句与三条边界（沿用第一笔的整句锁定做法，`harness/tests/unit/framework-init-entry-contract.unit.test.ts`）。smoke 只证明"规则还在文档里没被删或反转"，不证明 agent 按顺序工作——后者由 §5 宿主重跑观察。

### R2 "完整实现交付"一格改成依赖顺序，候选与冻结分清

- `templates/AGENTS.md.template:57` 当前从"四项输入 → 候选 → 两条载体"起笔，读起来像验证流程。改成依赖顺序：设计交接（admitted blueprint + ready CU）是范围候选的输入 → `goal-mode-entry --prepare-scope` 生成候选并写入 `feature.yaml`、核对投影 → 进入受管执行（不建 run：逐阶段 `harness-runner --phase`，**首次阶段调用冻结 feature 级范围并核对候选指纹**；建 run：`--prepare-run` 以有效范围出生）→ 各阶段产物只在其阶段内产生。**不得写成"prepare-scope 冻结范围"**（`goal-mode-entry.ts:415` 只生成候选；冻结在 `harness-runner.ts:838` 首次阶段调用 / run 出生流程）。
- 明说蓝图/CU 不是可并行赶的文书，是范围的来源。
- `docs/operations/project-entry.md`"主 Agent 与子 Skill"节、`MIGRATION.md` 3.1.0 节对应句子同步，三处口径一致；`skills/project/change-unit-progression/SKILL.md:15` 施工段若措辞不一致同步。
- 验收：smoke 锁定"首次阶段调用冻结"与"候选"的措辞不被写成"prepare-scope 冻结"。

### R3 首次产品修改之前进入受管执行：沿现有实现给出可执行步骤，缺接线才最小补接

- plan 必须核清并写出：不建 run 的路径下，主 agent 在**第一次修改产品源码之前**要完成哪几步，每步对应哪个既有入口与产物：设计交接 → `--prepare-scope` 候选进 `feature.yaml` 并核对投影 → 首次阶段 harness 调用冻结。**开放问题（plan 核清，不预设答案）**：请求动作只含 coding（无 spec/plan）时，主 agent 动手前可用哪个既有入口进入受管执行、首次阶段调用与代码修改的先后是否由代码强制（当前不是既定事实，正是要核的）。**冻结的证明能力要说准**：首次冻结读取当下候选并保存其指纹，只有已有冻结记录时才做前后指纹比较（`feature-execution-scope.ts:453` 附近），它**不能单独证明"这份候选在写代码之前已经存在"**。若选择"事前核候选、事后冻结"，必须明确写出：事前顺序靠 agent 行为与宿主过程验证（§5 H1），机器检查只证明其实际覆盖的一致性，不得冒充历史顺序证明；不为此新增防篡改机制。若现有实现无法在动手前提供受管入口，给出**复用既有入口的最小补接**方案，不新造机制。
- 建 run 的路径：`--prepare-run` 以有效范围出生，本身就在动手前；只需在入口写清"完整交付授权下，创建 run 是主 agent 的事，不交回用户再问"。
- 验收：以现有 `execution-scope.unit.test.ts` / `request-entry.unit.test.ts` 夹具为基础的一条用例，证明"候选写入 → 首次阶段调用冻结 → 候选指纹核对"这条路在 coding-only 请求下真实成立（或证明补接后成立）。

### R4 完整交付授权延续到交付终点

- 用户已授权完整交付（"请完成开发和相应验证"这类原话）时，主 agent 在该授权内完成必要阶段直到完成终点，**不把正式闭环当事后可选项再次询问**；仍须询问的只有既有确认点（真实授权、策展语义、预算、外部不可逆动作、设计缺口澄清）。措辞落在模板 §4.0 与 `project-entry.md` 既有"已有授权不重复询问"句上。
- 验收：smoke 锁定；宿主观察点 H3。

### R5 委派不豁免主 agent

- 入口写明：主 agent 委派子 agent 执行某个 Skill 时，子 agent 的边界是该 Skill 的边界，**主 agent 自己的前置责任不因委派而消失**；不得要求子 agent 按已写好的实现倒推设计。
- 验收：smoke 锁定；宿主观察点 H2。

### R6 验证方式

- 内部：smoke（存在性与关键措辞）+ R3 的一条生产路径用例；行数预算；`npm test` / `openspec:validate` / `check-plan-version` 全绿。
- 宿主：§5 同句重跑，直接观察行为，不由内部测试替代。

## 4. 非目标与边界

- 不加"范围冻结前禁止改源码"的机械拦截，不加"冻结时工作区已有改动"的告警或 clean 门禁：工作区有改动不等于绕过流程（可能是已有工作、合法恢复或用户改动）。若宿主重跑证明文字不够，另立需求，且只考虑告警不考虑拦截。
- 不处理组件资产索引初始化（截图裁出的 PNG 与组件资产索引不是同一类资产；是否缺选型依据看当前 CU 的实际依赖，`unknown` 也不必然合法放行——另案）。
- 不处理"自写真机脚本"本身；其确定问题是执行脱离交付范围与证据消费链，由 R1 的责任句覆盖，不单独判违规。
- 不改 P8 的范围计算、冻结、修订语义；不改 request CLI 的能力。
- 不重开已裁决事项：D1/D2、单职责路径三条调度裁决、分类器已知上限。

## 5. 收口标准（宿主重跑）

**前提**：① 宿主现场整体留档到仓库外目录并回到干净工作区（已跟踪改动 13 个文件、未跟踪产品代码 15 个文件、`doc/features/bc-openCard-2/`、`scratch/`、`doc/requests/`、`doc/reports/`，一个不漏，避免旧蓝图或报告混入新一轮）；② 集成本轮发布件并按 `framework-init`（UPDATE）刷新 `AGENTS.md`/`CLAUDE.md`；③ 宿主 agent 记忆保持清理后状态；④ 用 §1 的同一句原话触发，不附加任何流程提示。

| # | 看什么 | 判不通过的样子 |
|---|---|---|
| H1 | **第一次修改产品源码之前**，设计交接（admitted blueprint + ready CU）与范围候选/有效范围已经成立 | 先写代码再补蓝图；或范围候选在代码之后才出现 |
| H2 | 委派子 agent 做设计时，子 agent 不被要求按已写代码倒推设计；主 agent 自己等设计交接回来再进施工 | 任务书里出现"请与已写代码一致"一类倒置 |
| H3 | 完整交付授权延续到终点：主 agent 自己创建 run 或逐阶段跑链，只在既有确认点停下来问 | 收尾时问"要不要补跑正式阶段链" |
| H4 | coding 前，本次所需的需求、验收与设计输入已具备；需要补产的上游工作先完成；已有有效输入（蓝图/CU/既有契约）直接复用、不为证明顺序再生产一份 spec/plan；实现与验证按本次实际范围在链内执行 | 链外写完代码/跑完真机再"补跑"阶段；或为凑套餐补产已有等价输入的文档 |
| H5 | 准备工作（读代码、看图）可以并行；局部请求不被强迫建蓝图（可用一条"只补测试"的小请求顺带验） | 把所有事都拉成六阶段 |

H1–H5 逐项记录 **达成 / 未达成 / 不适用** 及依据，再给总体结论；"有结论"≠"通过"。已接受的小偏差可留到下一个真实需求继续观察，但不得改记为"原要求已达成"。未达成项回灌到对应条款。

## 6. 提交边界

- 提交须用户 review 同意；不带 AI 署名尾注；落 main，不建分支。
- 与本需求无关的改动不得夹带。

## 7. 事实索引（均已核实，行号以实读为准）

- `templates/AGENTS.md.template:46-60`：§4.0 判类段与四行请求终点表；`:57` 完整实现交付一格；`:60` "阶段不是固定套餐"。当前 115/120 行。
- `skills/project/component-design/SKILL.md:114-122`：Readiness 与后续施工入口；`:121-122` "本 Skill 停在设计交接……用户已授权完整实现时，外层接收 readiness 后在已有授权内创建真实 attended Goal"。
- `skills/project/change-unit-progression/SKILL.md:15`：施工段 = admitted blueprint 且 ≥1 canonical CU → selector 选 ready CU → `--prepare-scope` 生成候选 → Goal Mode 推进。
- `docs/operations/project-entry.md`："主 Agent 与子 Skill"节；"完整交付的机器接线复用 P2 输入协议……由 `goal-mode-entry --prepare-scope` 生成"；"'继续'先读当前 active run……已有授权不重复询问"。
- `MIGRATION.md` 3.1.0 节首段：两个载体二选一、首次调用冻结进 `execution-scope.json`。
- `harness/scripts/goal-mode-entry.ts:415` 附近：`--prepare-scope` 候选生成入口（`prepareFeatureScopeCandidate`）。
- `harness/harness-runner.ts:838`：阶段调用中的 `ensureFeatureExecutionScopeFrozen`（首次冻结 + 候选指纹核对）；`:554` reconcile、`:632` sync-closure 两处同函数。
- `harness/scripts/utils/feature-execution-scope.ts:410`：`ensureFeatureExecutionScopeFrozen`。
- `harness/tests/unit/framework-init-entry-contract.unit.test.ts`：入口/技能 smoke，整句锁定常量做法（`R4_EXECUTOR_SENTENCE`、`UT_CAPABILITY_STOP_SENTENCE`）。
- `docs/concepts/component-assets.md:45` 附近：组件资产可用性与 unknown 边界（本需求非目标的依据）。
- 宿主 transcript：`C:\Users\shengqsq\.claude\projects\D--1-code-SimulatedWalletForHmos\22ef2a09-4b90-48e0-9786-ee246be1456c.jsonl`（第 34/40/106–107 步）。
- 宿主现场：`doc/features/bc-openCard-2/{blueprint/component-blueprint.yaml, open-bank-card-flow/change-unit.yaml}`；无 `feature.yaml`、无 `execution-scope.json`、无 goal-runs。

## 8. 请 plan 先回答的问题

1. R3：coding-only 的不建 run 请求，主 agent 动手前可用哪个既有入口进入受管执行；首次阶段调用与代码修改的先后是否由代码强制；机器检查实际能证明什么、不能证明什么（冻结只存当下候选指纹，不证明候选先于代码存在）；若现有入口不够，复用哪个既有入口做最小补接。
2. R1/R2 的措辞落在模板哪几句上（逐句给出改前/改后），行数如何控制在 120 内。
3. R1 三条边界与 `project-entry.md` 既有"只读请求不因存在可补资料而写盘""无 Feature 的局部 review/UT/testing 使用 request CLI"句子如何合并而不重复。
4. smoke 锁哪几句、各证明什么、不证明什么。
5. 宿主观察点 H1–H5 各对应哪条条款。
