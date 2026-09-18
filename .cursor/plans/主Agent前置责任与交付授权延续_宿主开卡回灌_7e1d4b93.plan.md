---
name: 主 Agent 的前置责任与交付授权延续（宿主开卡需求回灌）
version: 3.1.0
parent_goal: complex-capability-construction-75411223
advances:
  - g6-change-unit-feature-pipeline-integration
  - g8-real-host-development-and-governance
relation: core
layer: change-unit
goal_requires:
  - feature-level-frozen-scope
  - single-duty-entry-guidance
goal_provides:
  - principal-agent-precondition-duty
  - full-delivery-authority-continuation
real_host_validation: >
  收口标准是宿主重跑，不是内部全绿。一笔落地后，由用户在 SimulatedWalletForHmos 按需求 §5 前提
  （现场整体留档并回到干净工作区、集成本轮发布件、framework-init UPDATE 刷新 AGENTS.md/CLAUDE.md、
  agent 记忆保持清理后状态）用需求 §1 的同一句原话重跑，按 §6.2 的 H1–H5 逐条记录到 §10。
  fixture 绿不等于宿主通过；smoke 只证明规则还在文档里，不证明 agent 按顺序工作。
parallel_authority_added: false
overview: >
  开卡事故的根因不是门禁漏了，而是主 agent 的前置责任没有在入口落实：顺序规则散在设计技能、
  CU 推进技能与入口表三处，各自守自己的边界，没有一处写成主 agent 自己要担的责任。本 plan 只做
  文字与接线修正：在 AGENTS 模板 §4.0 写明主 agent 的前置责任与三条边界、把「完整实现交付」一格
  从验证流水线改写成依赖顺序（候选与冻结分清）、把完整交付授权延续到终点、写明委派不豁免主 agent，
  并同步 project-entry / MIGRATION / change-unit-progression 三处口径；用整句逐字 smoke 锁住这些
  承诺，用一条 coding-only 无 run 的生产路径用例证明「候选 → 首次阶段调用冻结 → 候选指纹核对」真实成立，
  同时诚实锁住「冻结不证明候选先于代码存在」。不新增监控、clean 门禁、注册表、flag、平行文件、
  确认点或新 CLI；不改 P8 的范围计算、冻结与修订语义；不改 request CLI 的能力。
todos:
  - id: mad-c1-entry-duty-and-order
    content: >
      单笔实施（R1 + R2 + R4 + R5 + R6）：按 §4.1 改四份文档，**全部原位改写或行内追加、零新增行**
      （需求 §0 第 4 条的编辑方式约束，模板保持 115/120）——AGENTS 模板 :49 行内追加主 agent
      前置责任句与委派句、:51 行内追加三条**各自独立成句**的边界（含无 Feature 测试请求先
      `--prepare-request`，合并 task_d09f8f18）、:57「完整实现交付」整格原位改写成依赖顺序并接上
      交付授权延续句（**必须保留 `execution_scope` 一词，否则 entry_template_budget 必需标记 BLOCKER**）；
      project-entry.md :26/:28/:30/:32、MIGRATION.md :7、change-unit-progression/SKILL.md :15 同步。
      smoke 追加进既有 `framework-init-entry-contract.unit.test.ts`（不新建套件、不改 CORE_SUITES），
      按 §3 问题 3 的**十条整句常量**锁定（不用短锚——短锚挡不住句内反转）；R3 的生产路径用例追加进既有
      `execution-scope.unit.test.ts`，**三个独立 root**（A/B/C，B 的失败报告会污染同 root 的后续冻结）。
      验证见 §9。**已落地未提交**，验证原始行见 §10。
    status: completed
  - id: mad-c2-host-rerun-closure
    content: >
      宿主重跑收口（**由用户触发**，不是可选尾巴）：按需求 §5 四条前提复原并刷新宿主入口后，
      用需求 §1 的同一句原话重跑，按 §6.2 的 H1–H5 逐条记录**达成 / 未达成 / 不适用**及依据到 §10，
      再给总体结论。内部全绿不构成收口；本 todo 只有在 H1–H5 全部有结论后才可置 completed；
      未达成项回灌到对应条款。
    status: pending
---

# 主 Agent 的前置责任与交付授权延续（宿主开卡需求回灌）

> 需求输入：[需求_主Agent前置责任与交付授权延续_宿主开卡回灌](../requirement/需求_主Agent前置责任与交付授权延续_宿主开卡回灌.md)（2026-09-18）。
> 上位：[动态工作流总纲](动态工作流_总纲_全阶段Skill独立组合与义务驱动编排_91c4e7a2.plan.md)、[P8](动态工作流_P8_轻量交互路径与run内范围修订_d2f6a8b1.plan.md)、[单职责路径](单职责路径_入口到执行的衔接_宿主验收回灌_a9f3c7d2.plan.md)。
> 本 plan 引用的行号**全部取自 main `86524114` 的当前文件实读**，与需求 §7 各自独立核对；差异见 §2.2。
> a9f3c7d2 的三条教训是本 plan 的写作约束：**写进 plan ≠ 落进代码**（每条验收在 §6 有用例名或观察点）、
> **矩阵里的用例名会腐烂**（收口前用运行日志核完整名，见 §9）、**不发明意图分类器**（本 plan 零分类状态）。
> 另加 a9f3c7d2 §12.4 的已知上限 #1：**整句 smoke 挡不住「在锁定句之外另起一句推翻它」**——本 plan 沿用同一上限，不为它扩建机制。

## 1. 目标与一笔

| 笔 | 条款 | 一句话 |
|---|---|---|
| 1 | R1 + R2 + R4 + R5 + R6 | 入口写明主 agent 的前置责任与三条边界、把完整交付一格改成依赖顺序、授权延续到终点、委派不豁免；整句 smoke 锁住；一条 coding-only 生产路径用例证明受管执行链成立并诚实锁住它证不了的部分 |

**R3 不单独成笔**：它的产出是**结论 + 文字 + 一条用例**，结论已在 §3 问题 1 给出——现有入口够用，
不做接线补接（依据见该节）。文字落在 R2 改写的同一格里，用例与 smoke 同笔落地，拆开只会制造
「模板已改、用例不存在」的欠账（a9f3c7d2 §11 第一轮 M5 同型）。

**为什么一笔而不是两笔**：本轮**零生产行为变化**——四份文档全是文字，两处测试全是新增断言。
a9f3c7d2 分两笔的理由是第一笔动准备期接线、第二笔动结果呈现与范围计算验收面，两者各有独立停点；
本轮没有这个分界，拆开后中间态是「模板教了新顺序、smoke 没锁住」，比不拆更差。

## 2. 事实核对

### 2.1 本 plan 实读的事实（行号取自 main `86524114`）

| # | 事实 | 位置（实读） |
|---|---|---|
| F1 | §4.0 判类段现文：blockquote 两行（两问 + 正式需求定义）+ 正文一段 | `templates/AGENTS.md.template:48-49`（blockquote）、`:51`（正文段） |
| F2 | 请求终点表四行；「完整实现交付」一格从**四项输入**起笔，读起来像验证流程 | 同文件 `:53-54`（表头）、`:55` 显式 Skill、`:56` 查看/设计、**`:57` 完整实现交付**、`:58` 继续 |
| F3 | 「阶段不是固定套餐」与「普通请求由主 Agent 负责」 | 同文件 `:60`、`:62` |
| F4 | **模板当前 115 行**（node 计行，非 PowerShell），预算 120 → **余 5** | `node -e` 实测；门禁 `specs/phase-rules/docs-rules.yaml:91-104`（`max_lines: 120`） |
| F5 | **必需标记五项**：`请求终点` / `完整实现交付` / `execution_scope` / `修正三问` / `红线清单`，缺一即 BLOCKER | `specs/phase-rules/docs-rules.yaml:99-105`。**`execution_scope` 今天只由 `:57` 那格末句承载**（"两条路都按冻结的 `execution_scope` 推进到完成终点"）——改写该格时删掉这个词即门禁红 |
| F6 | `--prepare-scope` **只生成候选**：不创建 run、不 attach、与 `--prepare-run` 互斥；打印 `phase_chain` / `obligations` / `unresolved` / `explanation`；候选已存在且不一致时不静默覆盖 | `harness/scripts/goal-mode-entry.ts:414`（互斥）、`:461-528`（整个分支）、`:511-520`（投影打印）、`:521-527`（differs 非零退出） |
| F7 | **`--prepare-scope` 在 coding-only 请求上是 fail-closed 的**：请求含实现阶段却不含设计阶段时，`contracts.files` 拿不出可核验写集就当场抛（「请求跳过设计阶段直接改代码，但契约没有声明可核验的写集——责任方 plan」） | `harness/scripts/utils/feature-track.ts:559-569`（`requestsDesign` 判定 + 两条 throw）、`:417-429`（`deriveDefinitionContext` 的 contracts/写集来源） |
| F8 | 首次冻结在**阶段调用**里，且在 track 过滤之前 | `harness/harness-runner.ts:833-842`（`ensureFeatureExecutionScopeFrozen`）。全仓共三处调用该函数：`:838`（普通阶段）、`:554`（`--report-reconcile-only --phase testing`——**报告核对出口，不是 coding 的准备入口**）、`:632`（`--sync-closure`——收尾出口，同上） |
| F9 | **无候选则任何阶段都跑不起来**：首次冻结先取候选指纹，`feature.yaml` 无 `execution_scope` 即抛，转成 `execution_scope_frozen` BLOCKER FAIL，suggestion 逐字为「先用 goal-mode-entry --prepare-scope 生成范围候选，再跑阶段。」 | `harness/scripts/utils/feature-execution-scope.ts:453-459`；指纹实现 `feature-track.ts:96-100` |
| F10 | 有冻结记录时**只核对候选指纹**，不重算不沿用；漂移即 BLOCKER | `feature-execution-scope.ts:461-475`（`:468` 漂移分支） |
| F11 | 既无 run 身份、又无冻结记录、却已有阶段产物 → 不选边，BLOCKER | 同文件 `:477-486` |
| F12 | **冻结记录里没有任何代码基线**：字段只有 `frozen_at` 等，无 `base_sha` / `base_commit` | 同文件 `:39`（注释明说 feature 载体没有 `run_base_sha`）、`:55`、`:89`、`:255`；全文件 grep `base_sha` 仅命中该注释 |
| F13 | 无 run 的 diff 基线默认**与工作区比**（`source: 'working_tree'`），只有显式 ref 不可达才 FAIL | `harness/tests/unit/execution-scope.unit.test.ts:1604-1608`（对 `resolveEffectiveDiffBaseline` 的实跑断言） |
| F14 | 建 run 路径的 `run_base_sha` 是**出生时的 commit sha**（write-once），未提交的工作区改动不在其中 | `harness/scripts/utils/goal-run-creation.ts:198-208`、`:391-397` |
| F15 | 专项 request CLI 的 `--prepare-request` **必须同时给 `--request-file` 与 `--report-dir`**，且 phase 白名单只有 `review` / `ut` / `testing` | `harness/scripts/utils/request-phase.ts:200`、`:214-217`（早退分支）；白名单 `harness/scripts/utils/capability-resolution-entry-input.ts:83` |
| F16 | 设计技能已写明「停在设计交接……外层接收 readiness 后在已有授权内创建真实 attended Goal」 | `skills/project/component-design/SKILL.md:121-122`（**该文件 150/150，零余量**） |
| F17 | CU 推进技能施工段：admitted blueprint 且 ≥1 canonical CU → selector 选 ready CU → `--prepare-scope` 生成候选 → Goal Mode 推进 | `skills/project/change-unit-progression/SKILL.md:15`（全文 47 行，预算 150） |
| F18 | project-entry 三处落点：主 Agent 与子 Skill 首段、完整交付机器接线段、「继续」与既有确认点段 | `docs/operations/project-entry.md:26`、`:30`、`:32`（全文 32 行，无行数门禁） |
| F19 | MIGRATION 3.1.0 首节：两个载体二选一、首次调用冻结进 `execution-scope.json` | `MIGRATION.md:5-15`，关键句在 `:7` |
| F20 | smoke 套件的整句锁定做法（两个既有常量） | `harness/tests/unit/framework-init-entry-contract.unit.test.ts:484-491`（`R4_EXECUTOR_SENTENCE`）、`:521-525`（`UT_CAPABILITY_STOP_SENTENCE`）；锚词选取规则写在 `:430-439` 注释 |
| F21 | `request-coding` 模式已存在：经生产 `--prepare-scope --completion-target request --requested-phases coding` 生成候选并断言 `phase_chain === ['coding']` | `harness/tests/unit/execution-scope.unit.test.ts:184-189`、`:253-275`、`:805`（模式清单） |
| F22 | runless 夹具支持 `chain` 与 `completionTarget`，内部直接调生产 `prepareFeatureScopeCandidate` | 同文件 `:1281-1332`（`setupRunlessProject`），request 终点用例先例 `:1334-1382` |
| F23 | 真实 CLI 的无 run 三阶段用例（首次冻结落盘 / 只读复用 / 不造 run / 候选漂移 BLOCKER） | 同文件 `:1920-1965` |
| F24 | `profiles/` 树**没有**第二份入口判类或完整交付文字 | `grep -rn "prepare-scope\|需求路由\|完整实现交付" profiles/` 零命中（两棵树检索纪律，a9f3c7d2 §11 第二轮 M4） |
| F25 | 组件资产 unknown 边界（本需求非目标 §4 第 2 条的依据） | `docs/concepts/component-assets.md:44`（「无 UI 维度为 not_applicable；有 UI 无可读索引为 unknown\|degraded……当前 slice 依赖选型则 blocker」） |

### 2.2 与需求 §7 的差异（两条，均为行号漂移，不改结论）

| # | 需求 §7 写的 | 实读 | 处置 |
|---|---|---|---|
| D1 | `goal-mode-entry.ts:415` 附近为 `--prepare-scope` 候选生成入口 | `:415` 是分支注释首行，`prepareFeatureScopeCandidate` 实际调用在 `:496`，整个分支 `:461-528` | 本 plan 全部按 `:461-528` 引用；结论不变 |
| D2 | `feature-execution-scope.ts:453` 附近「只有已有冻结记录时才做前后指纹比较」 | `:453-459` 是**取候选指纹**（候选缺失即 BLOCKER），前后比较在 `:468` | 两条都成立，但责任不同：`:455-459` 证明「无候选跑不了阶段」，`:468` 证明「候选不得静默漂移」。§3 问题 1 分开写 |

## 3. 需求 §8 五个问题的回答

### 问题 1（R3）— coding-only 无 run 请求：动手前的受管入口、顺序是否由代码强制、机器检查证明什么、要不要补接

**先说结论（实读后得出，不是预设）：现有入口够用，本轮不做接线补接，只改文字。** 四段依据如下。

#### (a) 动手前可用的既有入口：只有 `goal-mode-entry --prepare-scope`，而且它本身就是一道真门

| 候选入口 | 能否在**第一次改产品源码之前**进入 | 依据（实读） |
|---|---|---|
| **`goal-mode-entry --prepare-scope --feature <f> --completion-target <request\|feature> --requested-phases coding[,…] --requested-results … --requirement …`** | **能**——不建 run、不 attach，只把候选写进 `feature.yaml` 并打印范围投影；候选已存在且不一致时非零退出、不静默覆盖 | F6（`goal-mode-entry.ts:461-528`） |
| `harness-runner --phase coding --feature <f>` | **不能**——coding 阶段判的是本次改动，代码还没写时跑它没有意义；它是链的**第一个阶段调用**，不是动手前的准备入口 | F8；链形状见 F21（coding-only 链 = `['coding']`） |
| `harness-runner --sync-closure --phase <p> --feature <f>` | 技术上会在 `:632` 触发同一个冻结函数，**但它是收尾命令**：用它「提前把范围冻上」是语义挪用，且冻结记录里本来就没有代码基线（F12），提前冻结一秒钟也**不增加对「候选与首次源码修改」先后关系的证明** | F8、F12 |
| `goal-mode-entry --prepare-run` | 能，且天然在动手前；但这是**建 run 的路径**，不在本问题射程（需求 R3 第二条只要求入口写清「创建 run 是主 agent 的事，不交回用户再问」） | F6、F14 |
| 专项 request CLI `--prepare-request` | **不适用于 coding**：phase 白名单只有 review/ut/testing，且必须同时给 `--request-file` 与 `--report-dir` | F15 |

**`--prepare-scope` 在 coding-only 上不是走过场，但它是「写集门」不是「设计准入门」**——三件事必须分开写
（codex 第一轮必改 1，经实读确认原稿把机器保证写大了）：

| # | 是什么 | 由谁保证 | 实读依据 |
|---|---|---|---|
| ① **写集门** | 请求含实现阶段却不含设计阶段时，`contracts.files` 必须能解析出**可核验写集并绑定**，否则当场抛「请求跳过设计阶段直接改代码，但契约没有声明可核验的写集——责任方 plan」 | **机器**（`--prepare-scope` fail-closed） | F7（`feature-track.ts:559-569`） |
| ② **设计准入责任**（admitted blueprint + ready CU 是候选的输入） | **不是机器**——写集门只问「写集拿不拿得出来」，**不问这份 contracts 从哪来**：`skills/feature/plan/contract.yaml:10` 的 `contracts` 输入同时收普通 `contracts@1` 与 `derive.blueprint-contracts`；`feature-track.ts:528` 更明写「**无蓝图合法入口（非 CU feature）**」。所以一份手写的普通 `contracts.yaml` 同样能过写集门 | **入口文字 + 主 agent 责任**（`component-design/SKILL.md:121-122` 停在设计交接、`change-unit-progression/SKILL.md:15` 施工段入口前提）；本 plan 的 A3 ① 就是把这条补进入口 | F7、F16、F17 + `plan/contract.yaml:10`、`feature-track.ts:528` |
| ③ **历史先后关系** | **谁都没有**（见 (b)(c) 两节） | — | F12/F13/F14 |

开卡事故里主 agent 从未跑 `--prepare-scope`，所以连①这道门都没被触发；但即便跑了，它也**不会**代替②
去核「这份 contracts 是不是 admitted 蓝图派生的」。

#### (b) 首次阶段调用与代码修改的先后：**代码强制了一半，没强制另一半**（这正是要核清的）

| 命题 | 是否由代码强制 | 依据 |
|---|---|---|
| 候选必须早于**首次阶段调用** | **是**。首次冻结先取候选指纹，`feature.yaml` 无 `execution_scope` 即抛 → `execution_scope_frozen` BLOCKER FAIL，suggestion 逐字指向 `--prepare-scope` | F9（`feature-execution-scope.ts:453-459`） |
| 候选一经冻结不得静默漂移 | **是**。有记录时只比指纹，不等即 BLOCKER | F10（`:468`） |
| 已有阶段产物却说不清权威时不静默归属 | **是**。直接 BLOCKER，指向 correction 或显式 run 身份 | F11（`:477-486`） |
| 候选（或首次阶段调用）必须早于**第一次改产品源码** | **否**。缺的**不是工作区检查**——diff 类检查确实实读工作区、暂存区与未跟踪文件（`harness/scripts/utils/git-diff.ts:205-225`）；缺的是**历史先后关系的证明**：冻结记录里没有任何代码基线（F12），无 run 的 diff 基线默认就是工作区（F13），建 run 那条的 `run_base_sha` 是 commit sha、看不见未提交改动（F14）。三者合起来 = 机器手上没有「候选生成时的代码状态」这个锚，无从比较先后 | F12 + F13 + F14 + `git-diff.ts:205-225` |

**换成事故的形状说人话**（措辞按 codex 必改 1 收紧，不写成"每一道检查都会绿"）：先写 28 个文件、
再跑 `--prepare-scope`、再跑 `--phase coding`，这条链**不会仅仅因为「先写代码、后生成候选」而失败**；
其它检查（写集门、scope 越界、契约闭包、diff 范围、各阶段 checker）仍然各自照常判，**该红的照样红**。
今天在机器面不可见的只有**先后关系**这一维。

#### (c) 冻结实际证明什么、不证明什么（措辞按需求 R3 要求写准）

| 证明 | 不证明 |
|---|---|
| 从**首次阶段调用**起，这个 feature 的有效范围只有一份记录，且磁盘候选未经修订不得改变（F9/F10） | 这份候选在**代码写之前**就已经存在 |
| 任何阶段都跑不了一个没有候选的 feature（F9）——「跑阶段」与「有范围」不可分离 | 设计交接先于编码。写集门（F7）只证明**候选生成那一刻**有可绑定的写集，既不证明这份 contracts 来自 admitted 蓝图（(a)②），也不证明它在代码之前在场 |
| 权威说不清时（有历史产物 / 有活 lock / 已转交 run）不选边（F11、`:435-436`、`:462-467`） | 本次 review 的 diff 就是本次改动的全部（无 run 基线 = 工作区，F13） |

**因此本 plan 采用「事前核候选、事后冻结」并把话写明**：事前顺序由 agent 行为与宿主过程验证
（§6.2 H1），机器检查只证明它实际覆盖的一致性，**不冒充历史顺序证明**；不为此新增防篡改机制。

#### (d) 够不够？——够，不补接；三个补接方案逐条否掉的理由

| 若要补接 | 否掉的理由 |
|---|---|
| 冻结时检查工作区已有改动并告警/拦截 | 需求 §4 第 1 条**明令不做**：工作区有改动不等于绕过流程（已有工作、合法恢复、用户改动都可能）。若宿主重跑证明文字不够，另立需求且只考虑告警 |
| 给 `harness-runner` 加 `--freeze-scope`（一个"先进入受管执行"的空转入口） | **现有候选入口已经能承接这一步**（`--prepare-scope` 就在动手前、且带写集门），需求 R3 也已允许「事前核候选、事后冻结」；再加一个入口只是把同一件事做两遍，且提前冻结**不增加对「候选与首次源码修改」先后关系的证明**（F12：记录里没有代码基线） |
| 把 `--sync-closure` 的冻结出口宣传成「动手前的受管入口」 | 语义挪用 + 需要新文档解释一个收尾命令的第二用途；同样零证明力增量 |

**真正缺的是文字，不是机器**：`:57` 那格今天从「主 Agent 只提供四项输入」起笔，读起来是
「候选怎么生成、两个载体怎么选」的操作说明，**没有一句说这几步必须在动手之前、按什么依赖关系发生**，
也没有一句说**设计交接是候选的输入**（(a)② 指出这一层机器不管）。R2 要求把这格改成依赖顺序——
**那次改写本身就是 R3 的交付**。故 R3 的产出 =
(i) §4.1 A3 的依赖顺序文字（含「设计交接是范围候选的输入」「`--prepare-scope` 只生成候选、不冻结范围」
「首次阶段调用冻结」三句）、(ii) §3 问题 4 / §4.2 B2 的一条生产路径用例
（正向链成立 + 负向锁住「冻结不证明顺序」）、(iii) 本节结论登记进 §5.3 的「放弃的准确性」。

### 问题 2（R1/R2/R4/R5）— 措辞落在模板哪几句、行数怎么控在 120 内

**总账（codex 必改 2 后改法）**：**零新增行**——全部原位改写或行内追加，模板 115 → **115/120，余 5**。
需求 §0 第 4 条与 R1 第三条要求「只能原位改写或行内追加」，**预算合格 ≠ 满足编辑方式约束**，
故初稿「新增一行 blockquote」的写法作废。
`skills/project/component-design/SKILL.md` 150/150 **零余量**，本轮**不改它**——它 `:121-122` 已写明
「停在设计交接」的边界，事故里主 agent 也确实遵守了这条（需求 §1 第 3 步），缺口在主 agent 侧不在设计技能侧。

#### 编辑 A1（R1 + R5）：`templates/AGENTS.md.template:49` **行内追加**（0 行）

改前（`:48-49`，逐字；`:48` 一字不动）：

```markdown
> **两问定路由**：① 本轮要动什么（**范围**）；② 按什么标准算对（**验收语义**）。「不改实现」只回答①，不免除②。
> **正式需求**＝有明确交付或验收责任，且拟改变**部件行为、外部契约、数据/NFR、运行语义或架构责任**的事项；不改变这些语义的**纯文档和机械维护**除外。
```

改后（`:49` **同一行**末尾追加三句，行首 `>` 与原句全部保留）：

```markdown
> **正式需求**＝有明确交付或验收责任，且拟改变**部件行为、外部契约、数据/NFR、运行语义或架构责任**的事项；不改变这些语义的**纯文档和机械维护**除外。**主 Agent 的前置责任**：把本次请求接入对应执行路径。同一交付单元的下游产出必须以**已具备的上游依据和有效范围**为输入——不得边补前置边提前施工，不得要求设计追认已写好的实现。**委派不豁免你**：子 Agent 的边界是它那个 Skill 的边界，不解除你自己的前置责任。已有有效输入与证据按规则复用，缺口交回责任方。
```

**为什么追加在 `:49` 而不是 `:51`**：`:49` 是该节的 blockquote「先读这两句」区、且仍是**行内追加**，
两个约束同时满足；`:51` 已是一段长正文，塞进去等于把主责任藏在操作细节里——事故的根因恰恰是
「这条责任没人说」。追加的三句各自是**完整句**，可独立整句锁定（否则删掉其中一句仍能过，
a9f3c7d2 §11 第一轮 M3 同型）。**醒目标记保留**（`**主 Agent 的前置责任**` / `**委派不豁免你**` 两个粗体引导词）。

#### 编辑 A2（R1 三条边界 + task_d09f8f18）：`templates/AGENTS.md.template:51` **行内追加**（0 行）

改前（`:51` 现文末尾，逐字）：

```
……执行器会从 `framework.local.json` 补齐工具链环境（`DEVECO_SDK_HOME` / JBR）——裸调不会执行这段补齐逻辑。
```

改后（在该句后**同一行**追加）：

```
三条边界。**准备工作（读代码、看截图、查依据）可以并行**，禁的只是依赖未满足就提前施工。**局部 review / UT / testing 请求**走各自的 request 准备路径，不强迫建蓝图或 Feature；**无 Feature 的独立测试请求，落笔写测试之前先跑 `--prepare-request` 确认落点与载体**；**已有 Feature/CU 上下文的测试沿其有效范围和阶段入口执行**，不得把正式交付中的测试拆成独立请求。**恢复已有任务**复用既有有效范围与证据，不因本节重跑完整链。
```

**三条边界各自独立成句（codex 必改 3 的落点）**：初稿用 `；` 把三条串成一句，smoke 只能锁短锚，
单处语义反转（「可以并行」→「不可以并行」）照样过。改成 `。` 分句后，每条边界都是一条**可整句锁定**
的完整句（常量见 §3 问题 3 的 `BOUNDARY_*`），句内任一字被改即失配。
三条边界一次写齐，避免制造「任何事都必须先跑六阶段」的新问题（需求 R1 第二条）。
`--prepare-request` 这半句就是 task_d09f8f18 的入口层落点（F15 决定了措辞只能限定在
「无 Feature 的独立测试请求」——它对 coding 不适用）。

#### 编辑 A3（R2 + R4）：`templates/AGENTS.md.template:57` **整格原位改写**（0 行）

改前（`:57` 逐字，一整行表格单元）：

```
| 完整实现交付 | 主 Agent 只提供四项输入：**完成终点**、**请求结果**、**明确的请求动作**（改代码 / 只验证 / 完整交付 → `--requested-phases`）、**影响判断及其来源路径**；候选由 `goal-mode-entry --prepare-scope` 生成（绑定、指纹、unit/device/visual 派生、code-review 补齐全部由机器完成），核对它打印的范围投影后二选一：**不建 run** 直接 `harness-runner --phase <p> --feature <f>` 逐阶段跑（首次调用机器冻结 feature 级范围记录，之后只读并核对候选指纹），或 `--prepare-run` 创建真实 attended Goal（以转交时 feature 的有效范围出生）；两条路都按冻结的 execution_scope 推进到完成终点 |
```

改后：

```
| 完整实现交付 | **依赖顺序，不是验证流水线**：① **设计交接**（admitted blueprint + ready CU）是范围候选的输入——蓝图与 CU 不是可并行赶的文书，是范围的来源；② `goal-mode-entry --prepare-scope` 生成候选并写入 `feature.yaml`（主 Agent 只提供四项输入：**完成终点**、**请求结果**、**明确的请求动作** `--requested-phases`、**影响判断及其来源路径**；绑定、指纹、unit/device/visual 派生、code-review 补齐全部由机器完成），核对它打印的范围投影——**`--prepare-scope` 只生成候选、不冻结范围**；③ 进入受管执行：**不建 run** 则逐阶段 `harness-runner --phase <p> --feature <f>`，**首次阶段调用**冻结 feature 级范围记录并核对候选指纹；**建 run** 则 `--prepare-run` 创建真实 attended Goal（以转交时 feature 的有效范围出生）；④ 各阶段产物只在其阶段内产生，两条路都按冻结的 `execution_scope` 推进到完成终点。**用户已授权完整交付时，走完这条链到完成终点是主 Agent 自己的事**——不把正式闭环当收尾时可再问一次的可选项，仍须询问的只有既有确认点（真实授权、策展语义、预算、外部不可逆动作、设计缺口澄清）。|
```

**门禁硬点（实施时最容易踩）**：`execution_scope` 是 `entry_template_budget` 的五个必需标记之一
（F5），今天**只由这一格末句承载**。改写时若把它删掉或改成中文，`docs-authoring-lint` 直接 BLOCKER。
改后文本已保留 `` `execution_scope` `` 一词。

#### 编辑 A4（R4）：`docs/operations/project-entry.md:32` **行内追加**（0 行）

改前（`:32` 末段现文）：`……真实授权、策展语义、预算和外部不可逆动作继续使用既有确认点；已有授权不重复询问。init-next-steps 不授予任何后继执行权。`

改后：在「已有授权不重复询问。」后追加 R4 承诺，**与 A3 末句逐字相同**（同一条 smoke 常量
`AUTHORITY_CONTINUATION_SENTENCE` 在两份文件各断言一次，防「只改模板不改文档」）：

```
**用户已授权完整交付时，走完这条链到完成终点是主 Agent 自己的事**——不把正式闭环当收尾时可再问一次的可选项，仍须询问的只有既有确认点（真实授权、策展语义、预算、外部不可逆动作、设计缺口澄清）。
```

#### 编辑 A5（R1 + R5）：`docs/operations/project-entry.md:26` **行内追加**（0 行）

在 `:26` 现文「自然语言由主 Agent 按根入口的正式性判据解释：……」之后追加 A1 的三句
（`PRINCIPAL_DUTY_SENTENCE` / `DELEGATION_SENTENCE` / `REUSE_HANDBACK_SENTENCE`），**与模板逐字相同**——
同一组 smoke 常量在两份文件各断言一次，防「只改模板不改文档」。

#### 编辑 A6（R2）：`docs/operations/project-entry.md:30` **原位改写首句**（0 行）

改前首句：`完整交付的机器接线复用 [P2 输入协议](../concepts/skill-contracts.md)：已有 CU 对应 Feature 的 `feature.yaml.execution_scope` 只承载出生前请求与来源事实候选，**由 `goal-mode-entry --prepare-scope` 生成**——……`

改后：在该句**前**插入依赖顺序一句，其余整段保留：

```
完整交付按依赖顺序发生：设计交接（admitted blueprint + ready CU）是范围候选的输入；`--prepare-scope` **只生成候选、不冻结范围**，冻结发生在**首次阶段调用**（不建 run）或 run 出生时（建 run）。
```

#### 编辑 A7（R2）：`MIGRATION.md:7` **原位改写**（0 行）

改前（`:7` 首两句）：`新请求默认使用 obligation-driven workflow 1.2。完整实现由主 Agent 按实际输入、目标和义务建立 Feature 候选，随后两个载体二选一：交互路径直接逐阶段跑 harness，首次调用由机器把范围冻结进 `doc/features/<feature>/execution-scope.json`；……`

改后：

```
新请求默认使用 obligation-driven workflow 1.2。完整实现先有设计交接（admitted blueprint + ready CU），再由主 Agent 用 `goal-mode-entry --prepare-scope` 按实际输入、目标和义务建立 Feature 候选——该入口**只生成候选、不冻结范围**；随后两个载体二选一：交互路径直接逐阶段跑 harness，**首次阶段调用**由机器把范围冻结进 `doc/features/<feature>/execution-scope.json`；……
```

#### 编辑 A8（R2）：`skills/project/change-unit-progression/SKILL.md:15` **行内改写施工段出口列**（0 行）

改前（`:15` 出口列）：`selector 选一个 ready CU → `goal-mode-entry --prepare-scope` 生成范围候选（主 Agent 只给完成终点、请求结果、明确的请求动作、影响判断及其来源路径；绑定与指纹由机器算）→ 既有 Goal Mode 单并发推进 → `ready_for_component_closure``

改后（只加两处限定，其余不动）：

```
selector 选一个 ready CU → `goal-mode-entry --prepare-scope` 生成范围候选（**在任何产品源码改动之前**；主 Agent 只给完成终点、请求结果、明确的请求动作、影响判断及其来源路径；绑定与指纹由机器算；该入口**只生成候选、不冻结范围**，冻结在**首次阶段调用**或 run 出生时）→ 既有 Goal Mode 单并发推进 → `ready_for_component_closure`
```

#### 三条边界与 project-entry 既有句子怎么合并而不重复（需求 §8 问题 3）

`project-entry.md` 已有两句与边界同域：`:26` 末的「只读请求不因存在可补资料而写盘」、
`:28` 首的「无 Feature 的局部 review/UT/testing 使用已交付的 request CLI，结果隔离在显式报告目录」。

| 边界 | 处置 | 理由 |
|---|---|---|
| ① 准备工作可并行 | **只写模板**，project-entry 不加 | **完整边界集中在模板一处，project-entry 不重复展开**。（第二轮更正：初稿说这条已由 `:26` 末「只读请求不因存在可补资料而写盘」承担——**不成立**，前者约束并发与依赖、后者约束写入，两者不可互相替代。取舍保留，但理由只能是「不在两处各写一套」，不能声称已被覆盖；代价见 §5.3 #4） |
| ② 局部请求走各自 request 准备路径，不强迫建蓝图 | **只写模板**；project-entry 在 `:28` 既有句**行内追加**半句「动手写之前先 `--prepare-request` 确认落点与载体」 | `:28` 已经说清「用哪个 CLI、结果隔离在哪」，缺的只是**时点**。追加半句补时点，不重述 CLI 与隔离 |
| ③ 恢复已有任务复用有效范围与证据 | **只写模板**，project-entry 不加 | **避免重复**：`docs/operations/project-entry.md:32` 首句「"继续"先读当前 active run、冻结 execution_scope 和 successor/revision，不重新选择流程」已经在该文件里承担这条职责，且写得更具体（这一条与 `:26` 不同，确实同域） |

净效果：三条边界的完整表述只有**模板一处**，project-entry 只补一个时点半句；两份文件不出现职责重叠的段落。

### 问题 3（R6）— smoke 锁哪几句、各证明什么、不证明什么

落点：**既有** `harness/tests/unit/framework-init-entry-contract.unit.test.ts` 追加用例
（不新建套件、不动 `harness/tests/run-unit.ts` 的 `CORE_SUITES`），沿用 F20 的整句常量做法与
`:430-439` 的锚词选取规则注释。

**锁定口径（codex 必改 3）**：初稿 S4 只锁四个短锚，对 A2 那段做**单处句内反转**
（「可以并行」→「不可以并行」、「不强迫建蓝图或 Feature」→「必须建蓝图和 Feature」、
「不因本节重跑完整链」→「必须因本节重跑完整链」）照样绿——这是**句内反转**，不属于已接受的
「另起一句推翻」上限。故本轮**每条必要承诺都用整句常量 `includes` 比对**（沿用 `R4_EXECUTOR_SENTENCE`
的做法，F20），仍是六条用例、零新增测试机制；A2 的三条边界为此已改成三条独立完整句（见 §3 问题 2）。

**十条整句常量**（改这些措辞必须同步改本文件常量——这句写进套件头注释）：

| 常量名 | 值（逐字） |
|---|---|
| `PRINCIPAL_DUTY_SENTENCE`（**第二轮扩大：首句纳入**） | `**主 Agent 的前置责任**：把本次请求接入对应执行路径。同一交付单元的下游产出必须以**已具备的上游依据和有效范围**为输入——不得边补前置边提前施工，不得要求设计追认已写好的实现。` |
| `REUSE_HANDBACK_SENTENCE` | `已有有效输入与证据按规则复用，缺口交回责任方。` |
| `DELEGATION_SENTENCE` | `**委派不豁免你**：子 Agent 的边界是它那个 Skill 的边界，不解除你自己的前置责任。` |
| `DESIGN_HANDOFF_SENTENCE` | `**设计交接**（admitted blueprint + ready CU）是范围候选的输入——蓝图与 CU 不是可并行赶的文书，是范围的来源` |
| `CANDIDATE_NOT_FREEZE_SENTENCE` | ``**`--prepare-scope` 只生成候选、不冻结范围**`` |
| `FIRST_PHASE_FREEZE_SENTENCE` | `**首次阶段调用**冻结 feature 级范围记录并核对候选指纹` |
| `BOUNDARY_PARALLEL_SENTENCE` | `**准备工作（读代码、看截图、查依据）可以并行**，禁的只是依赖未满足就提前施工。` |
| `BOUNDARY_LOCAL_REQUEST_SENTENCE` | 取 §3 问题 2 编辑 A2 改后文本里「**局部 review / UT / testing 请求**……不得把正式交付中的测试拆成独立请求。」这一整句（含其中 `--prepare-request` 的反引号），逐字复制为常量。**措辞用「落笔写测试之前」而非「动手写之前」**——后者含子串「手写」，会踩中既有 `D0.2 …` 用例 `:304` 对「手写来源/指纹」的全文禁词断言（§10 偏离 1） |
| `BOUNDARY_RESUME_SENTENCE` | `**恢复已有任务**复用既有有效范围与证据，不因本节重跑完整链。` |
| `AUTHORITY_CONTINUATION_SENTENCE` | `**用户已授权完整交付时，走完这条链到完成终点是主 Agent 自己的事**——不把正式闭环当收尾时可再问一次的可选项，仍须询问的只有既有确认点（真实授权、策展语义、预算、外部不可逆动作、设计缺口澄清）。` |

| # | 用例名 | 断言（逐条，与 §6.1 矩阵一一对应） | 证明 | **不**证明 |
|---|---|---|---|---|
| S1 | `the entry states the principal agent precondition duty` | `PRINCIPAL_DUTY_SENTENCE`（**含首句「把本次请求接入对应执行路径」**）与 `REUSE_HANDBACK_SENTENCE` **两条整句**，在 `templates/AGENTS.md.template` 与 `docs/operations/project-entry.md` **各断言一次**（共 4 条断言） | R1 的核心责任句（含首句）与复用/交回句在两份文档里且未被句内改写。**第二轮阻断**：初稿常量从「同一交付单元……」起笔，把首句改成「不必把本次请求接入对应执行路径。」十条常量仍全绿——核心责任被反转而 smoke 不红 | agent 会照做（→ H1/H4） |
| S2 | `delegation does not exempt the principal agent` | `DELEGATION_SENTENCE` 整句，同两份文件各一次 | R5 的承诺在场且未被句内改写。**与 S1 分成两条常量/两条用例是为了定位**（合并成一条同样挡得住删改——整句 `includes` 一样会红；分开只是让红的时候直接看出动的是 R1 责任句还是 R5 委派句） | 子 agent 任务书里不会出现倒置（→ H2） |
| S3 | `the entry separates the scope candidate from the freeze` | 在 §4.0 节切片内（`template.slice(indexOf('### 4.0 需求路由'), indexOf('### 4.0.1'))`，复用 F20 邻位 `:444` 的既有写法）同时含 `DESIGN_HANDOFF_SENTENCE`、`CANDIDATE_NOT_FREEZE_SENTENCE`、`FIRST_PHASE_FREEZE_SENTENCE` **三条整句** | R2 全部三件事：设计交接是候选的输入、蓝图不是可并行赶的文书、候选与冻结分清（要写成「prepare-scope 冻结范围」必须先删其中一句） | 文档别处没有另起一句推翻它（已知上限，a9f3c7d2 §12.4 #1） |
| S4 | `the entry states the three preparation boundaries` | 在同一 §4.0 节切片内含 `BOUNDARY_PARALLEL_SENTENCE`、`BOUNDARY_LOCAL_REQUEST_SENTENCE`、`BOUNDARY_RESUME_SENTENCE` **三条整句**；另断言 `docs/operations/project-entry.md` 含 `--prepare-request` 时点半句 | 三条边界逐句在场且句内未被反转；task_d09f8f18 的入口层落点在 `BOUNDARY_LOCAL_REQUEST_SENTENCE` 内一并锁住 | 「不强迫建蓝图」在真实请求里被遵守（→ H5） |
| S5 | `full delivery authority continues to the endpoint` | `AUTHORITY_CONTINUATION_SENTENCE` **整句**（含「既有确认点」五项枚举），在模板 §4.0 切片与 `project-entry.md` **各断言一次** | R4 的两半（走到终点是主 agent 的事 + 仍须询问的只有既有确认点）都在 | agent 不会在收尾时再问一次（→ H3） |
| S6 | `the freeze wording is mirrored in the downstream docs` | **结构性断言，措辞如实**：`docs/operations/project-entry.md`（**第二轮补入**，对应 A6）、`MIGRATION.md`（A7）、`skills/project/change-unit-progression/SKILL.md`（A8）**三份都含** `首次阶段调用` 与 `只生成候选、不冻结范围` 两个标记串 **只防这两个标记串在三份下游文档里被删**（不会只改模板而漏掉 project-entry 的依赖顺序句、迁移说明与 CU 推进技能） | **不证明四处口径一致，也不证明这三处的句子语义正确**：三份文件句式与上下文各不相同，本断言只看标记串在不在；语义一致留人工审 diff |

**行数预算不另造断言**：`harness/tests/unit/docs-authoring-lint.unit.test.ts:91-105,278-292` 已对
真实仓库跑 `scanSkillBodyBudget` / `checkEntryTemplateBudget`；本轮模板**零新增行**（115/120），
实施记录里报一次 node 实测行数即可。

**「不新增分类机制」怎么守（codex 建议，取消初稿的反向锚声称）**：初稿在 S4 里声称有一条
「§4.0 不出现新分类状态词」的反向锚，但**没有可执行的禁词集合**，等于空承诺。改为：
① 既有用例 `入口文本与 init 生产代码都没有 router / route state / 普通任务分类`
（`framework-init-entry-contract.unit.test.ts:336-337`，已覆盖 `templates/AGENTS.md.template`）
继续守住既有禁词面，本轮**一行不改**；② 本轮新增文字不引入任何状态/枚举，由**人工审 diff** 保证。
**不扩建禁词门禁。**

**smoke 整体的射程**（写进套件头注释）：它只证明「这十条被锁定的常量还逐字在文档里，
常量**内部**没有被删改或反转」；常量之外的文字改动、以及 S6 那两个标记串所在句子的语义，都不在射程内。
它不证明 agent 按顺序工作——那由 §6.2 的 H1–H5 判；也不证明宿主那份 `AGENTS.md` 已经是新文字
（模板改了不会自动流到宿主，见 §6.2 表下说明）。

### 问题 4（R3）— 一条生产路径用例的设计

落点：**既有** `harness/tests/unit/execution-scope.unit.test.ts` 追加一条 `cases.push`，复用
`setupRunlessProject`（F22）与 `:1920-1965` 的真实 CLI 调用形态（F23）。**不新建文件、不新建夹具。**

用例名（自带诚实边界，避免名字承诺过头）：

```
D1 a coding-only runless request is managed through the candidate, and freezing does not prove it predates the edit
```

**三个场景各自独立建夹具，不在同一个 root 里串（codex 必改 4）**。初稿把「删候选跑 CLI（失败）」
与「恢复候选做首次冻结」写在同一个 root 里前后相接，**跑不通**：冻结失败检查会被
`harness-runner.ts:996-1000` 经 `generateScriptReport` 写进该阶段的 `script-report.json`
（`report-generator.ts:148-150`），而 `phasesWithExistingEvidence`（`feature-execution-scope.ts:665`）
把 `script-report.json` 也算作「这个阶段跑过」，于是恢复候选后的首次冻结会撞上 `:480-486` 的
D1.3 第三行（有阶段产物却无权威 → 拒绝冻结），③ 永远走不到。故三个场景各调一次
`setupRunlessProject({ chain: ['coding'], completionTarget: 'request' })`，各自 `finally` 清理。

夹具共同前置：`setupRunlessProject` 内部用**生产** `prepareFeatureScopeCandidate` 生成候选
（F22 `:1326-1330`），其 `contracts.yaml` 声明 `files: ['src/demo/value.ts']`（`:1313-1316`），
满足 F7 的写集门，coding-only 候选才生成得出来。

| 场景 | 子断言 | 断什么 | 打在哪个生产事实上 |
|---|---|---|---|
| **A**（root #1） | ① 候选形状 | `feature.yaml.execution_scope` 在场；首次冻结后 `execution_scope.phase_chain === ['coding']`、`completion_target === 'request'` | F21/F22：coding-only 请求得到单阶段链 |
| **A** | ③ 首次冻结 + 只读复用 | 真实 CLI 首次 `--phase coding` → `execution-scope.json` 落盘；记录的 `candidate_fingerprint` 等于 `featureScopeCandidateFingerprint(root, feature)`；第二次调用 `frozen_at` 不变 | F9 + F10 |
| **A** | ④ 全程不造 run | `doc/features/<f>/goal-runs` 不存在 | F23 同款断言 |
| **B**（root #2，**此后作废**） | ② **无候选跑不了阶段** | **解析 `feature.yaml`、`delete raw.execution_scope`、写回**（同场景 C 第①步的做法，不是删文件）→ 真实 CLI 跑 `--phase coding` → `execution_scope_frozen` 为 `FAIL` / `BLOCKER`，suggestion 含 `--prepare-scope` | F9（`feature-execution-scope.ts:455-459`）——「必须先经候选入口」的机器面。**该 root 到此为止**：报告已落盘，再冻结必撞 `:480-486` |
| **C**（root #3） | ⑤ **负向：真正制造「候选晚于代码」** | 四步顺序（codex 必改 5）：① **读 `feature.yaml`、`YAML.parse` 后 `delete raw.execution_scope`、写回**（`execution_scope` 是字段不是文件，`fs.rmSync` 删不掉它——第二轮更正），并断言它确实缺失（`featureScopeCandidateFingerprint` 抛错）；② 改 `src/demo/value.ts`；③ 经**生产** `prepareFeatureScopeCandidate` 重新生成候选；④ 首次 `ensureFeatureExecutionScopeFrozen`，断言 `status === 'frozen'` 且 `checks.length === 0` | F12/F13。**断言措辞限定为「该冻结入口不拒绝这个历史顺序」**，不写成「整条阶段链会通过」——本场景没跑 checker，证不了后者。初稿直接复用夹具自带候选，实际顺序仍是「候选→改码→冻结」，反证不了任何东西 |

**候选漂移面（`:468`）不重复造**：`D1 three real runless harness-runner phase calls freeze once and stay run-free`
（F23 `:1954-1963`）已经用真实 CLI 断到 `execution_scope_frozen` BLOCKER，§6.1 直接引用它。

**待核（实施时确认，不在 plan 里当事实写）**：场景 B 依赖「真实 CLI 在候选缺失时把该检查写进
`script-report.json`」——`harness-runner.ts:996-1000` 的代码路径支持这一点，但**尚未实跑验证**；
若实跑发现只走 stderr，则把断言改成读 `combined(result)`（`:1941` 已有该 helper）含那条 suggestion 原文，
判据不变。此外，若实跑证明该报告**不**落盘，场景 B 与 A 理论上可合并——但**不合并**：多一个 root
的成本远低于再踩一次 D1.3。

### 问题 5 — 宿主观察点 H1–H5 各对应哪条条款

| # | 观察点（需求 §5 原文口径） | 对应条款 | 本 plan 的改动点 |
|---|---|---|---|
| H1 | 第一次改产品源码之前，设计交接与范围候选/有效范围已成立 | **R1**（主责任 + 依赖方向）、**R2**（依赖顺序文字）、**R3**（顺序不由代码强制，只能在这里判） | A1、A3、A6、A7、A8 |
| H2 | 委派子 agent 做设计时不被要求按已写代码倒推；主 agent 等设计交接回来再进施工 | **R5** | A1（委派句）、A5 |
| H3 | 完整交付授权延续到终点：主 agent 自己建 run 或逐阶段跑链，只在既有确认点停 | **R4** | A3 末句、A4 |
| H4 | coding 前所需输入已具备；需补产的上游先完成；已有有效输入直接复用、不为凑套餐补文档；实现与验证在链内执行 | **R1**（不得边补前置边施工 + 复用条款）、**R2**（依赖顺序） | A1、A2、A3 |
| H5 | 准备工作可并行；局部请求不被强迫建蓝图（可用一条"只补测试"的小请求顺带验） | **R1 三条边界** | A2（三条边界整段）、A5/A6 的时点半句 |

## 4. 改动点清单

### 4.1 文档（四份，**净 0 行**——全部原位改写或行内追加）

| # | 文件与位置 | 改什么 | 行数 |
|---|---|---|---|
| A1 | `templates/AGENTS.md.template:49` | **行内追加**（行首 `>` 与原句保留）：主 agent 前置责任句（R1）+ 委派句（R5）+ 复用/交回句 | 0（115 → 115） |
| A2 | `templates/AGENTS.md.template:51` | 行内追加**三条独立完整句**的边界 + 无 Feature 测试请求先 `--prepare-request`（R1、task_d09f8f18） | 0 |
| A3 | `templates/AGENTS.md.template:57` | 整格原位改写为依赖顺序 ①–④ + 交付授权延续句（R2、R3 文字面、R4）。**保留 `execution_scope`** | 0 |
| A4 | `docs/operations/project-entry.md:32` | 行内追加 `AUTHORITY_CONTINUATION_SENTENCE` 整句（与 A3 末句逐字相同） | 0 |
| A5 | `docs/operations/project-entry.md:26` | 行内追加 A1 的三句（与模板逐字相同） | 0 |
| A6 | `docs/operations/project-entry.md:28`、`:30` | `:28` 追加时点半句；`:30` 首句前插入依赖顺序一句 | 0 |
| A7 | `MIGRATION.md:7` | 原位改写：设计交接前置 + 「只生成候选、不冻结」+ 「首次阶段调用」 | 0 |
| A8 | `skills/project/change-unit-progression/SKILL.md:15` | 施工段出口列行内加两处限定 | 0 |
| — | `skills/project/component-design/SKILL.md` | **不改**：`:121-122` 已写明停在设计交接（F16），且 150/150 零余量 | — |

### 4.2 测试（两处追加，零新增文件）

| # | 文件 | 改什么 |
|---|---|---|
| B1 | `harness/tests/unit/framework-init-entry-contract.unit.test.ts` | 追加 §3 问题 3 的 S1–S6 六条用例与**十条整句常量**（该节表格逐字给出），放在文件既有常量（`R4_EXECUTOR_SENTENCE` 等，F20）邻位，并在头注释写明「改这些措辞必须同步改本文件常量」。既有的 `入口文本与 init 生产代码都没有 router / route state / 普通任务分类`（`:336-337`）**一行不改** |
| B2 | `harness/tests/unit/execution-scope.unit.test.ts` | 追加 §3 问题 4 的一条用例：**三个独立 root**（A/B/C）、五个子断言 |

### 4.3 OpenSpec

**本轮不新增 delta**，理由：零生产行为变化（四份文档文字 + 两处测试断言），既有
`scope-aware-project-entry` 的入口判类 Requirement 与 `feature-level-frozen-scope` 的冻结语义
都未被改动，新增 Requirement 只会制造一条描述文案的 spec。若 review 认为需要登记，落点是
`openspec/changes/scope-aware-project-entry/specs/skill-contracts/spec.md`（追加一条
`Requirement: The entry states the principal agent's precondition duty`，Enforcement 指向 B1 的用例名），
不新开 change。

## 5. 保留 / 裁剪双清单

### 5.1 新增文字与其可核实的复用目标

| 新增 | 复用目标（点名可核实） |
|---|---|
| A1 的三句 | **行内追加**进既有 `:49` blockquote（零新增行），复用既有两类分类，不新增分类、不新增小节、不新增确认点 |
| A2 的三条边界 | 复用 `:51` 既有正文段与既有 request CLI 概念；`--prepare-request` 复用 `request-phase.ts:214-217` 已交付的准备期出口（F15），**不新增 CLI、不放宽 phase 白名单** |
| A3 的依赖顺序 | 复用 `:57` 既有一格与既有两个载体（`--prepare-scope` / `--prepare-run` / `harness-runner --phase`），**只重排叙述顺序并补三句限定**（设计交接是输入 / 只生成候选不冻结 / 首次阶段调用冻结），不新增入口 |
| A4/A5/A6/A7/A8 | 全部行内追加或原位改写既有句子；A4/A5 与 A1/A3 **逐字相同**（一条 smoke 常量覆盖两处），A6/A7/A8 句式随各文件上下文，只共享标记串（S6 如实写成「同步标记在场」） |
| S1–S6 | 追加进既有 `framework-init-entry-contract.unit.test.ts`（F20 同形状先例），**零新增测试文件、不改 `run-unit.ts`**；禁词面复用既有 `:336-337` 用例，不扩建 |
| R3 用例 | 复用 `setupRunlessProject`（F22）与 `:1920` 的真实 CLI 形态（F23），**不新建夹具**（三个 root 是同一个夹具函数调三次） |

### 5.2 本轮明确不做（需求 §4 + 本 plan 裁剪）

| 不做 | 出处 |
|---|---|
| 「范围冻结前禁止改源码」的机械拦截 | 需求 §4 第 1 条 |
| 「冻结时工作区已有改动」的告警或 clean 门禁 | 需求 §4 第 1 条（工作区有改动 ≠ 绕过流程） |
| 组件资产索引初始化 / 判定 `unknown` 是否合法放行 | 需求 §4 第 2 条；边界依据 F25 |
| 处理「自写真机脚本」本身 | 需求 §4 第 3 条（由 R1 责任句覆盖，不单独判违规） |
| 改 P8 的范围计算、冻结、修订语义；改 request CLI 的能力 | 需求 §4 第 4 条 |
| 重开 D1/D2、单职责路径三条调度裁决、分类器已知上限 | 需求 §4 第 5 条 |
| 新增监控、注册表、feature flag、平行文件、新编排系统、新确认点 | 需求 §0 第 3 条 |
| 给 `harness-runner` 加 `--freeze-scope` 或把 `--sync-closure` 宣传成动手前入口 | §3 问题 1(d)（零证明力增量） |
| 改 `skills/project/component-design/SKILL.md` | §3 问题 2（`:121-122` 已写明边界；150/150 零余量） |
| 新增 OpenSpec change | §4.3 |

### 5.3 放弃的准确性（与取舍逐条对应）

| # | 取舍 | 放弃的准确性 |
|---|---|---|
| 1 | **顺序只落文字，不落机器门禁**（§3 问题 1(d)） | 框架不会拦住「先写代码、再补候选、再跑阶段」这条路——这条链**不会仅因为这个先后**而失败（其它检查仍各自照常判）。是否照做只由宿主 H1 判。需求 §4 明令不加拦截，这是裁决不是遗漏 |
| 2 | **冻结记录不含代码基线**（F12），无 run 的 diff 基线是工作区（F13） | **现有冻结记录与这些检查不能证明**「这份候选是不是在代码之前存在」，也不能证明「本次 review 的 diff 是不是本次改动的全部」。**注意准确表述**：diff 类检查是读工作区的（`git-diff.ts:205-225`），缺的是「候选生成时的代码状态」这个可比对的锚。要拿到这一维，一种做法是在冻结时记录基线——那是另一次改动，且需求 §4 已否掉其告警形态 |
| 3 | **整句 smoke** | 锁定句内部被改即红；在它之外另起一句推翻它（「以下情形不适用……」）看不出来。属全文语义人工 review 范围，不为它扩建机制（沿用 a9f3c7d2 §12.4 #1 的同一上限） |
| 3b | **写集门不是设计准入门**（§3 问题 1(a)②） | `--prepare-scope` 不核这份 contracts 是不是 admitted 蓝图派生的——一份手写的普通 `contracts.yaml` 同样能过（`plan/contract.yaml:10` 两个 source 都收、`feature-track.ts:528` 明写无蓝图合法入口）。「设计交接是候选的输入」这一层**只靠入口文字与主 agent 责任**，由 H1 判 |
| 4 | 三条边界只写在模板一处，project-entry 只补时点半句（§3 问题 2 末表） | 只读 `project-entry.md` 的人读不到完整的三条边界，得回模板。换来的是两份文档不出现职责重叠的段落、不制造第二份口径 |
| 5 | R3 用例的场景 C 只断言**冻结入口本身**不发检查项 | 只证明「该冻结入口不拒绝『候选晚于代码』这个历史顺序」，**不**证明整条阶段链会通过——场景 C 没跑 checker。要证明后者需枚举全部 checker，成本远高于收益 |
| 5b | S6 只断言标记串在场 | 不证明 `docs/operations/project-entry.md`（A6 依赖顺序句）、`MIGRATION.md` 与 `change-unit-progression/SKILL.md` 的上下文语义与模板一致——三份文件句式各异，无法整句同源。语义一致由人工审 diff 承担 |
| 6 | 模板保持 115/120（codex 必改 2 后的改法） | 三句责任文字挤进既有 blockquote 行，该行变得更长；换来的是满足「只能原位改写或行内追加」的编辑方式约束，且余量仍是 5 行 |
| 7 | 不改 `component-design/SKILL.md` | 若将来发现设计技能侧也需要一句「不接受按已写实现倒推的任务书」，该文件 150/150 得先腾行。本轮由 A1 的委派句在主 agent 侧覆盖同一风险 |
| 8 | 文字 ≠ 遵守（需求 §2 证据边界） | 「主 agent 遵守了子 agent 那条显式边界」只支持「把责任写清楚值得先试」，不证明「写一句就一定遵守」。收口仍以宿主重跑为准 |

## 6. 追溯矩阵

### 6.1 需求条款 → 改动位置 → 验证用例 / 观察点

| 条款 | 验收行（逐条） | 改动位置 | 用例名 / 观察点 |
|---|---|---|---|
**对齐口径（codex 必改 3 后半）**：本表每行的「用例名」列**只写 S1–S6 与 R3 用例里真实存在的那条断言**，
不得再出现「反向锚 / 短锚」这类没有对应断言的说法。逐行与 §3 问题 3 的常量表一一对照过。

| 条款 | 验收行（逐条） | 改动位置 | 用例名 / 观察点（点名到断言） |
|---|---|---|---|
| R1 | 入口写明主 agent 负责把本次请求接入对应执行路径、下游产出以上游依据与有效范围为输入 | A1、A5 | S1 `the entry states the principal agent precondition duty` — `PRINCIPAL_DUTY_SENTENCE` 整句（**第二轮扩大后含首句「把本次请求接入对应执行路径」**），模板与 project-entry 各一次 |
| R1 | 不得边补前置边提前施工、不得要求设计追认已写好的实现 | A1、A5 | S1（同一常量的后半句，逐字包含在内） |
| R1 | 已有有效输入与证据按规则复用，缺口交回责任方 | A1、A5 | S1 — `REUSE_HANDBACK_SENTENCE` **整句**（独立常量，非短锚），两处各一次 |
| R1 | 无 Feature 的独立测试请求，动手写之前先 `--prepare-request` 确认落点与载体（合并 task_d09f8f18） | A2、A6（`:28` 时点半句） | S4 `the entry states the three preparation boundaries` — `BOUNDARY_LOCAL_REQUEST_SENTENCE` 整句已含该承诺；另断言 project-entry 含**「落笔写测试之前先跑 `--prepare-request` 确认落点与载体」这半句**（锁的是时点半句，不只是命令名；措辞偏离见 §10 偏离 1） |
| R1 | 已有 Feature/CU 上下文的测试沿其有效范围与阶段入口执行，不拆成独立请求 | A2 | S4（同一常量的末半句，逐字包含在内） |
| R1 | 三条边界同时写明（准备可并行 / 局部请求不强迫建蓝图 / 恢复复用有效范围） | A2 | S4 — `BOUNDARY_PARALLEL_SENTENCE` / `BOUNDARY_LOCAL_REQUEST_SENTENCE` / `BOUNDARY_RESUME_SENTENCE` **三条整句各断一次** |
| R1 | 不新增分类机制 | 无改动（负向） | **既有** `入口文本与 init 生产代码都没有 router / route state / 普通任务分类`（`framework-init-entry-contract.unit.test.ts:336-337`，本轮一行不改）+ 人工审 diff；本轮新增文字不引入状态/枚举。**不扩建禁词门禁** |
| R1 | 触发事件原话在宿主重跑中先核依据、再接入路径 | A1 + A3 | **宿主 H1**（内部无用例，需求 §5 明定） |
| R2 | 「完整实现交付」一格改成依赖顺序，设计交接是候选的输入 | A3 ① | S3 `the entry separates the scope candidate from the freeze` — `DESIGN_HANDOFF_SENTENCE` 整句（§4.0 节切片内） |
| R2 | 候选与冻结分清：不得写成「prepare-scope 冻结范围」 | A3 ②③ | S3 — `CANDIDATE_NOT_FREEZE_SENTENCE` 与 `FIRST_PHASE_FREEZE_SENTENCE` **两条整句都在场** |
| R2 | 明说蓝图/CU 不是可并行赶的文书，是范围的来源 | A3 ① | S3（`DESIGN_HANDOFF_SENTENCE` 的后半句，逐字包含在内——非短锚） |
| R2 | project-entry / MIGRATION / change-unit-progression 三处同步 | A6、A7、A8 | S6 `the freeze wording is mirrored in the downstream docs` — **三份文件各断言两个标记串**（`首次阶段调用` / `只生成候选、不冻结范围`）。**第二轮更正**：初稿声称 project-entry 一侧「由 S1/S4/S5 覆盖」是夸大——那三条查的是责任句 / request 准备时点 / 授权延续，与 A6 的依赖顺序句无关；现由 S6 直接覆盖，**语义一致仍由人工审 diff 承担**（§5.3 #5b） |
| R2 | 模板必需标记不被改丢（`execution_scope`） | A3（保留该词） | **既有** `docs-authoring-lint.unit.test.ts:91-105,278-292`（本轮不改） |
| R3 | 不建 run 路径下动手前的既有入口与每步产物 | §3 问题 1(a) 表 + A3 ①②③ | S3（三条整句＝**三个关键承诺**：设计交接是输入 / 只生成候选不冻结 / 首次阶段调用冻结）+ **宿主 H1**。**S3 不锁**「候选写入 `feature.yaml`」「核对范围投影」「完整命令行」这些步骤细节——完整步骤由 A3 正文承载、由 H1 核验 |
| R3 | 首次阶段调用与代码修改的先后是否由代码强制 | §3 问题 1(b) 表（结论：强制「候选早于阶段调用」，**不**强制「候选早于改代码」） | R3 用例 `D1 a coding-only runless request is managed through the candidate, and freezing does not prove it predates the edit` — 场景 B 子断言②（正向强制面）、场景 C 子断言⑤（负向未强制面） |
| R3 | 冻结的证明能力写准，不冒充历史顺序证明 | §3 问题 1(c) 表 + §5.3 #1/#2/#3b/#5 | R3 用例场景 C 子断言⑤（限定为「该冻结入口不拒绝这个历史顺序」） |
| R3 | 候选指纹核对真实成立 | 无改动（既有生产行为） | 正向：R3 用例场景 A 子断言③；漂移面引用**既有** `D1 three real runless harness-runner phase calls freeze once and stay run-free` |
| R3 | 现有入口不够则给最小补接 | §3 问题 1(d)（结论：够用，三个补接方案逐条否掉） | 无代码用例（plan 正文条款）；登记在 §5.3 #1/#3b |
| R3 | 「写集门 ≠ 设计准入门」这一层由文字承担 | §3 问题 1(a) 三件事表 + A3 ① | S3（`DESIGN_HANDOFF_SENTENCE`）+ **宿主 H1**；上限登记在 §5.3 #3b |
| R3 | 建 run 路径写清「创建 run 是主 agent 的事，不交回用户再问」 | A3 末句（与 R4 同句） | S5 `full delivery authority continues to the endpoint` — **S5 锁的是「授权延续到终点」这一句**；「建 run 具体怎么做」由 A3 ③ 的上下文说明承载，不在 S5 射程内 |
| R4 | 已授权完整交付时主 agent 在授权内完成到终点，不把正式闭环当事后可选项 | A3 末句、A4 | S5 — `AUTHORITY_CONTINUATION_SENTENCE` 整句，模板与 project-entry 各一次 |
| R4 | 仍须询问的只有既有确认点（五项枚举） | A3 末句、A4 | S5（同一整句常量已含该枚举，非短锚） |
| R4 | 行为面 | A3、A4 | **宿主 H3** |
| R5 | 入口写明委派不豁免主 agent 的前置责任 | A1、A5 | S2 `delegation does not exempt the principal agent` — `DELEGATION_SENTENCE` 整句，两处各一次 |
| R5 | 不得要求子 agent 按已写好的实现倒推设计 | A1（`PRINCIPAL_DUTY_SENTENCE` 已含「不得要求设计追认已写好的实现」）+ A3 ① | S1 + S2 + **宿主 H2** |
| R6 | 内部：smoke + R3 一条生产路径用例 | B1、B2 | S1–S6 六条 + R3 一条（§9 用运行日志逐条核完整名） |
| R6 | 内部：行数预算 | A1–A3（本轮零新增行） | **既有** `docs-authoring-lint.unit.test.ts`（不改）+ §9 第 5 步 node 实测 |
| R6 | 内部：`npm test` / `openspec:validate` / `check-plan-version` 全绿 | — | §9 |
| R6 | 宿主：同句重跑，不由内部测试替代 | — | §6.2 H1–H5 |

**空缺检查（逐行统计，不四舍五入）**：上表 **29 行**（初稿 28 → codex 第一轮必改 1 新增
「写集门 ≠ 设计准入门」1 行；另有多行原地改判：短锚改整句、「反向锚」改引既有用例、
S6 覆盖面与措辞两次收紧）。**不再给分类小计**——第二轮核出那张表不是互斥逐行计数
（例如「候选指纹核对真实成立」一行同时指向本批新增断言与既有用例，被重复计入两类），
给了反而制造假精度。**判据仍是逐行可核**：上表每一行的末列都点名到一条具体断言、一个既有用例、
一个宿主观察点或一条 plan 正文结论，**无「有验收行、无对应用例或观察点」的行**。
若实施中发现某行的用例名与实际不符，按 §9 的运行输出核对规则**先改矩阵再收口**，不得让名字腐烂。

### 6.2 宿主重跑观察点 → 条款 → 改动点

| # | 观察点 | 判不通过的样子（需求 §5 原文） | 对应条款 | 本 plan 的改动点 |
|---|---|---|---|---|
| H1 | 第一次修改产品源码之前，设计交接（admitted blueprint + ready CU）与范围候选/有效范围已成立 | 先写代码再补蓝图；或范围候选在代码之后才出现 | R1、R2、R3 | A1、A3、A6、A7、A8 |
| H2 | 委派子 agent 做设计时不被要求按已写代码倒推；主 agent 等设计交接回来再进施工 | 任务书里出现「请与已写代码一致」一类倒置 | R5 | A1（委派句）、A5 |
| H3 | 完整交付授权延续到终点：主 agent 自己创建 run 或逐阶段跑链，只在既有确认点停 | 收尾时问「要不要补跑正式阶段链」 | R4 | A3 末句、A4 |
| H4 | coding 前所需输入已具备；需补产的上游先完成；已有有效输入直接复用、不为凑套餐补一份 spec/plan；实现与验证在链内执行 | 链外写完代码/跑完真机再「补跑」阶段；或为凑套餐补产已有等价输入的文档 | R1、R2 | A1、A2、A3 |
| H5 | 准备工作可并行；局部请求不被强迫建蓝图（可用一条「只补测试」的小请求顺带验） | 把所有事都拉成六阶段 | R1 三条边界 | A2、A6 |

**重跑前提（需求 §5，缺一即结果无效）**：① 宿主现场整体留档到仓库外目录并回到干净工作区
（已跟踪改动 13 个文件、未跟踪产品代码 15 个文件、`doc/features/bc-openCard-2/`、`scratch/`、
`doc/requests/`、`doc/reports/`，一个不漏）；② 集成本轮发布件并按 `framework-init`（UPDATE）刷新
`AGENTS.md`/`CLAUDE.md`——**模板改了不会自动流到宿主**，不刷新则 H1/H3/H5 观察的是旧文字、结果无效；
③ 宿主 agent 记忆保持清理后状态；④ 用需求 §1 的同一句原话触发，不附加任何流程提示。

H1–H5 逐项记录**达成 / 未达成 / 不适用**及依据，再给总体结论；「有结论」≠「通过」。
已接受的小偏差可留到下一个真实需求继续观察，但不得改记为「原要求已达成」。未达成项回灌到对应条款。
**内部全绿不等于收口。**

## 7. 提交边界

| 笔 | 边界 |
|---|---|
| 1 | R1 + R2 + R4 + R5 + R6 一笔：四份文档文字 + 两处测试追加。理由见 §1（零生产行为变化、无独立停点、拆开只会制造半成品中间态） |
| — | 宿主重跑由**用户触发**，是本 plan 的完成条件（frontmatter 第二条 todo），不是可选尾巴 |

- 提交须用户 review 同意；不带 AI 署名尾注；落 main，不建分支。
- 与本需求无关的改动不得夹带。

## 8. 风险与已知上限

| # | 上限 / 风险 | 影响与处置 |
|---|---|---|
| 1 | **先后关系在机器面不可见**（§5.3 #1/#2） | 事故形状今天**不会仅因这个先后**而失败（其它检查仍各自照常判）。本轮只改文字；是否奏效由 H1 判。若 H1 未达成，另立需求且只考虑告警不考虑拦截（需求 §4） |
| 1b | **写集门 ≠ 设计准入门**（§5.3 #3b） | `--prepare-scope` 不核 contracts 是否 admitted 蓝图派生——手写的普通 `contracts.yaml` 同样能过。「设计交接是候选的输入」只由入口文字承担，由 H1 判 |
| 2 | **整句 smoke 挡不住「另起一句推翻」** | 属全文语义人工 review 范围，不扩建机制。**已覆盖的只是「十条被锁定常量内部的改写与反转」**（初稿短锚被 codex 用三处反转打穿）；常量之外的文字仍只靠人工审 diff |
| 3 | **`execution_scope` 必需标记**（F5） | A3 改写时删掉这个词即 `docs-authoring-lint` BLOCKER。已在 todo content 与 §3 问题 2 写明，实施时先跑该套件 |
| 4 | **模板余量 5 行，且 `:49` / `:51` / `:57` 三行都变得很长** | 本轮零新增行（编辑方式约束，需求 §0 第 4 条）；代价是三行可读性下降。后续入口改动只能继续原位改写或行内追加 |
| 5 | **宿主入口不会自动更新** | 必须集成发布件 + `framework-init` UPDATE（§6.2 前提②），否则观察的是旧文字 |
| 6 | **文字 ≠ 遵守**（需求 §2 证据边界） | 只支持「值得先试」，不支持「写一句就一定遵守」 |
| 7 | R3 用例场景 B 的落盘形态**待核** | §3 问题 4 末段已给替代断言口径（改读 `combined(result)`），判据不变；三个 root 隔离的结论不受它影响 |
| 8 | 本 plan 未跑过任何命令 | 只写 plan、零代码改动；§9 的所有验证由实施笔执行并如实记录到 §10 |

## 9. 验证

实施笔完成后执行，输出如实记录到 §10（失败就报失败）：

1. `cd harness && npm test`（含 typecheck）——**先把完整输出写进日志文件再 grep 结论**，不靠截断的终端输出下判断。
2. `npm run openspec:validate`（本轮无 delta，应与改前同值）。
3. `node scripts/check-plan-version.mjs`。
4. `git diff --check`；用 **node** 扫全部改动文件行尾（全 LF，不用 shell 管道猜）。
5. 用 node 实测 `templates/AGENTS.md.template` 行数（门禁计行口径），断言 ≤120；记录实测值。
6. **收口前必做（a9f3c7d2 教训：矩阵里的用例名会腐烂）**：在第 1 步的日志文件里，对 §3 问题 3 的
   S1–S6 与 §3 问题 4 的 R3 用例，各核一次 `run-unit.ts` 打印的「PASS + 完整用例名」；任一条缺失或 FAIL
   即未交付，不得收口。静态 grep 只用于定位定义处，不作交付判据。
7. 全绿后**停点回报，不自行提交**；提交不加任何 AI 署名。**收口标准是宿主重跑**（§6.2）。

## 10. 实施记录

### 单笔（R1 + R2 + R4 + R5 + R6）——2026-09-18，已落地，未提交

**基线（动文件之前跑完，`cd harness && npm test`，完整输出写进日志文件后再取结论）**：
typecheck 通过；unit **`结果：4623 passed, 0 failed (共 4623)`**；fixtures **`结果：46 passed, 0 failed (共 46)`**；
`EXIT=0`。相关套件基线：`Suite [framework-init-entry-contract]  PASS=14  FAIL=0`、
`Suite [execution-scope]  PASS=108  FAIL=0`、`Suite [docs-authoring-lint]  PASS=18  FAIL=0`。

**改动文件（6 个，全部在开发仓；未碰宿主、未碰 `framework/`）**

| 文件 | 改什么 |
|---|---|
| `templates/AGENTS.md.template` | A1（`:49` 行内追加责任/委派/复用三句）、A2（`:51` 行内追加三条边界）、A3（`:57` 整格原位改写）。**零新增行** |
| `docs/operations/project-entry.md` | A5（`:26` 追加三句）、A6（`:28` 追加时点半句、`:30` 首句前插依赖顺序句）、A4（`:32` 追加授权延续整句） |
| `MIGRATION.md` | A7（`:7` 原位改写：设计交接前置 + 只生成候选不冻结 + 首次阶段调用） |
| `skills/project/change-unit-progression/SKILL.md` | A8（`:15` 施工段出口列加三处限定） |
| `harness/tests/unit/framework-init-entry-contract.unit.test.ts` | B1：追加 S1–S6 六条用例与十条整句常量；既有用例一行未改 |
| `harness/tests/unit/execution-scope.unit.test.ts` | B2：`:47` import 补 `featureScopeCandidateFingerprint`；追加 R3 用例（A/B/C 三个独立 root） |

**偏离登记**

| # | 偏离 | 原因与放弃的准确性 |
|---|---|---|
| 1 | R1 边界②的措辞由 plan 写的「**动**手写之前」改为「**落笔**写测试之前」（模板、project-entry、smoke 常量三处同步） | 实跑发现「动手写」含子串 `手写`，会踩中**既有** `D0.2 AGENTS template and entry docs hand the candidate to the machine…` 用例 `:304` 的全文禁词断言（该断言禁的是「手写来源/指纹」，此处是误伤）。两条出路里选了**改我自己的措辞**，没有去削弱那条既有断言——放弃的准确性：新句子的字面比需求 R1 原文（「动手写之前」）窄了一点点，只覆盖「写测试」这个动作；但 R1 这条边界本来就只对「无 Feature 的独立测试请求」生效（`capability-resolution-entry-input.ts:83` 的 phase 白名单决定它对 coding 不适用），语义时点未变 |
| 2 | R3 用例场景 B **不**采用 plan 写的「二选一断言」，改为**直接断言报告落盘** | plan §3 问题 4 的「待核」项**已实跑定谳**：把兜底分支临时换成 `assert(false,'PROBE: fallback branch taken')` 跑一遍，PROBE **没有触发** → 候选缺失时 `execution_scope_frozen` 确实被写进 `script-report.json`（`harness-runner.ts:996-1000` → `generateScriptReport`）。既然兜底分支实测走不到，就是死代码，删掉、直接断报告——用例反而更严。放弃的准确性：该断言绑定了「这条检查写进 script-report.json」这一实现细节，将来若改成只走 stderr 会红（属真实契约变更，该红） |

**中途抓到并修掉的一处回归（如实登记）**：A3 首版改写把原格里的「创建**真实 attended Goal**」
这半句丢了，全量 `npm test` 第一遍红在**既有**用例
`shared AGENTS.md template rendering is independent of active adapter`
（`harness/tests/unit/template-renderer.unit.test.ts:131` 断言渲染产物须同时含 `请求终点` 与 `真实 attended Goal`），
`结果：4629 passed, 1 failed (共 4630)`。**处置＝把丢掉的半句加回 A3**（原格本来就有，属误删不是裁剪），
**没有去改那条既有断言**；改后模板仍 115/120，`template-renderer` 5/5、`framework-init-entry-contract` 20/20。
教训与 a9f3c7d2 同型：整格原位改写时，格内**既有承诺**必须逐条清点，行数预算和必需标记都守住了也不等于没丢东西。

**变异实跑（改坏 → 红 → 还原 → 绿，每条新断言至少一次）**

smoke 面：六条互不重叠的变异**一次性同时注入**，跑 `--filter framework-init-entry-contract`，
结果 `Suite [framework-init-entry-contract]  PASS=14  FAIL=6` ——**恰好是本批六条新用例各红一条，
既有 14 条不受影响**；每条失败信息点名到被破坏的常量，故归因明确：

| 变异 | 落点 | 红在哪条用例（失败信息原文摘要） |
|---|---|---|
| 「把本次请求接入对应执行路径」→「**不必**把…」 | 模板 A1 首句 | `the entry states the principal agent precondition duty` — `templates/AGENTS.md.template 缺主 Agent 前置责任原句（需求 R1 第一条）` |
| 「不解除你自己的前置责任」→「**可以**解除…」 | project-entry A5 | `delegation does not exempt the principal agent` — `docs/operations/project-entry.md 缺「委派不豁免」原句（需求 R5）` |
| 「`--prepare-scope` 只生成候选、不冻结范围」→「`--prepare-scope` **冻结范围**」 | 模板 A3 ② | `the entry separates the scope candidate from the freeze` — `缺原句：候选与冻结分清，不得写成 prepare-scope 冻结范围（需求 R2 第一条）` |
| 「可以并行」→「**不可以**并行」 | 模板 A2 边界① | `the entry states the three preparation boundaries` — `缺边界原句：准备工作可并行（需求 R1 边界①）` |
| 删掉「仍须询问的只有既有确认点（…五项…）」 | project-entry A4 | `full delivery authority continues to the endpoint` — `project-entry 缺交付授权延续原句（需求 R4）` |
| 「只生成候选、不冻结范围」→「生成候选并冻结范围」 | `MIGRATION.md` A7 | `the freeze wording is mirrored in the downstream docs` — `MIGRATION.md 未与入口同步冻结口径标记: 只生成候选、不冻结范围（需求 R2 第三条）` |

全部还原后复跑：`Suite [framework-init-entry-contract]  PASS=20  FAIL=0`（14 既有 + 6 新）。

R3 用例面：两条变异各跑一次 `--filter execution-scope`（每次都只红这一条，其余 108 条不动）：

| 变异 | 证明了什么 | 失败信息原文 |
|---|---|---|
| **MR1**：场景 C 跳过 `dropCandidate` | 场景 C **真的先删候选再改源码**，不是「候选→改码→冻结」的假反例（codex 第二轮 B5 的要害） | `Missing expected exception: 前提：候选应已被删除，否则这条用例证明不了「候选晚于代码」` |
| **MR3**：场景 B 跳过 `dropCandidate` | 场景 B 的「无候选」前提是 setup 真造出来的，不是恰好成立 | `候选缺失时没有 execution_scope_frozen 检查项：["node_options_injection","phase_disabled_by_profile","capability_coding_plan_context"]` |

还原后：`Suite [execution-scope]  PASS=109  FAIL=0`（108 既有 + 1 新）。
变异残留已核：`grep -n "MUTATION\|PROBE"` 两份测试文件**零命中**。

**§9 七步的原始验证行**

| 步 | 命令 | 原始输出行 |
|---|---|---|
| 1 | `cd harness && npm test`（完整输出先写日志再取结论） | `结果：4630 passed, 0 failed (共 4630)`（unit）/ `结果：46 passed, 0 failed (共 46)`（fixtures）/ `EXIT=0`；typecheck `error TS` 零命中；全日志 `^  FAIL ` 计数 **0**。相关套件：`Suite [framework-init-entry-contract]  PASS=20  FAIL=0`、`Suite [execution-scope]  PASS=109  FAIL=0`、`Suite [docs-authoring-lint]  PASS=18  FAIL=0`、`Suite [template-renderer]  PASS=5  FAIL=0` |
| 2 | `npm run openspec:validate`（**仓库根**，harness 下没有这个 script） | `Totals: 45 passed, 0 failed (45 items)` + `[openspec-enforcement] PASS: canonical Enforcement 路径与 glob 均可解析。`（与改前同值；本轮无 delta） |
| 3 | `node scripts/check-plan-version.mjs` | `[check-plan-version] mode=default current=3.1.0` / `[check-plan-version] PASS` |
| 4 | `git diff --check` + node 扫行尾 | `diff --check: clean`；改动 6 文件 + 本 plan **全部 LF**（node 读字节判 `\r\n` 与孤立 `\r`，不用 shell 管道猜） |
| 5 | node 实测模板行数（门禁计行口径） | `lines: 115`（≤120，余 5）；五个必需标记 `请求终点` / `完整实现交付` / `execution_scope` / `修正三问` / `红线清单` 全在场 |
| 6 | 日志里逐条核 `PASS  <完整用例名>` | 本批 7 个用例名各命中 **count=1**（S1–S6 六条 + R3 一条），无缺失、无 FAIL |
| 7 | 停点回报，不自行提交 | 已停点；未 `git commit` / `git push` / 未建分支 / 未碰宿主与 `framework/` |

**基线与终值对账**：unit 4623 → **4630**（+7 ＝ 6 条 smoke + 1 条 R3）；fixtures 46 → 46（不变）。

**代码 review 与独立复跑（2026-09-18）**：codex 第一轮代码 review **阻断 0，判可提交用户审阅**——
但它是**只读源码复核，未独立重跑变异**（变异红/绿由本会话实跑，记录见上）。调度者在其侧独立复跑：
unit **4630/0**、fixtures **46/0**、日志 `^  FAIL ` 行 **0**、openspec **45/45**、`check-plan-version` PASS、
`git diff --check` 干净。review 提出的两处非阻断修正已落地：① 测试注释里「分开常量是因为合并后删半句仍能过」
的理由**不成立**（合并后整句 `includes` 一样会红），改为「分开是为了定位」，只改注释、断言一字未动；
② 本节补记本行。第一条 todo 保持 `completed`。

**一次汇报事故（自查，如实登记）**：全量 `npm test` 第一遍我看了后台任务的 exit code（那是我 `echo "EXIT=$?"` 的退出码，恒为 0）就汇报了「全绿」，实际日志是 `4629 passed, 1 failed`。与记忆里「`cmd|tail` 的 `$?` 是 tail 的退出码」同型。此后改为**先 grep 日志的 `结果：` 行与 `^  FAIL ` 计数**再下判断。

### 宿主重跑（用户触发；在用户提供材料前保持空，不以夹具冒充）

**重跑前提**：见 §6.2 表下四条（需求 §5）。前提未复原时本表不填。

| 轮次 | 日期 | 前提已复原 | H1 | H2 | H3 | H4 | H5 | 回灌到哪一条 |
|---|---|---|---|---|---|---|---|---|
| 一笔后首轮 | | | | | | | | |

## 11. review 记录

| 轮次 | reviewer | 日期 | 阻断 | 必须修正 | 建议 | 总判 | 处置 |
|---|---|---|---|---|---|---|---|
| 第一轮 | codex（调度者逐条对照代码复核） | 2026-09-18 | 5 | — | 3 | 不可进入实施 | **五条阻断 + 三条建议全部接受，无驳回**（每条都打开被引代码实读确认）；逐条见下表 |
| 第二轮 | codex | 2026-09-18 | 1 | — | 3 | 第一轮 B1/B2/B4/B5 与建议 S1/S3 判闭环；十条常量逐字匹配、句内反转全挡住；模板 115/120 核实；夹具隔离成立。**B3 未完全修复** | **一条阻断 + 三条建议全部接受，无驳回**；逐条见「第二轮」分段 |
| 第三轮 | codex | 2026-09-18 | **0** | — | 3（非阻断措辞） | **无阻断，可进入实施**：29 行矩阵逐行核过、R1–R6 覆盖、非目标一致、两个 todo 可执行 | 三条措辞修正全部落地：① §6.1 三处与断言力度对齐（S4 锁时点半句 / S3 锁「三个关键承诺」非完整步骤 / S5 只锁授权延续）；② §11 第二轮记录对准（B3′ 落点写实、S2′ 改为「B 引用 C 的做法，缺失由 B 的失败断言承担」）、§5.3 #5b 补 project-entry；③ 绝对化措辞收到实际证明范围（「证明不了任何顺序 / 不增加任何证明力」→「不增加对候选与首次源码修改先后关系的证明」；「机器永远回答不了」→「现有冻结记录与这些检查不能证明」；S6「不会漏掉依赖顺序句」→「只防两个标记串被删，语义留人工」；「句内反转已覆盖」→「十条被锁定常量内部的改写」） |

### 第一轮（codex，2026-09-18）——逐条处置

| # | 级别 | 意见一句话 | 我实读核到的关键事实 | 落点 |
|---|---|---|---|---|
| B1 | 阻断 | R3 把机器保证写大了：把写集门说成 admitted blueprint 准入门；「全链没有任何一处读工作区状态」也不成立 | **属实两条**：① `skills/feature/plan/contract.yaml:10` 的 `contracts` 输入同时收 `artifact: contracts@1` 与 `derive.blueprint-contracts`，`feature-track.ts:528` 明写「无蓝图合法入口（非 CU feature）」——`:565-569` 只强制**可核验写集与绑定**；② `harness/scripts/utils/git-diff.ts:205-225` 实读 committed / 工作区 / 未跟踪三类文件，缺的是**历史先后关系证明**不是工作区检查 | §3 问题 1(a) 新增「写集门 / 设计准入责任 / 历史先后」三件事表；(b)(c) 两表改写；「每一道检查都会绿」改为「不会**仅因**先写代码后生成候选而失败，其它检查仍各自照常判」（§3 问题 1(b)、§5.3 #1、§8 #1）；新增 §5.3 #3b、§8 #1b、§6.1 一行。**结论「不补接」保留** |
| B2 | 阻断 | A1 新增一行 blockquote 违反「只能原位改写或行内追加」（需求 §0 第 4 条、R1 第三条）；预算合格 ≠ 满足编辑方式 | **属实**：初稿在 `:49` 之后新增第三行 | A1 改为在 `:49` **行内追加**（行首 `>` 与原句保留），醒目引导词保留；模板 115 → **115/120，余 5**；§4.1 表头、§5.1、§5.3 #6、§8 #4、frontmatter todo 同步 |
| B3 | 阻断 | smoke 没做到整句锁定：S4 只锁四个短锚，对 A2 做单处句内反转（可以并行 / 不强迫建蓝图 / 不因本节重跑）照样绿；S1、S5 覆盖不足；矩阵四行的「复用锚 / 反向锚 / 蓝图来源锚 / 确认点锚」与实际断言不对应 | **属实**：短锚反转不是已接受的「另起一句推翻」上限，是**句内反转** | A2 的三条边界改成**三条独立完整句**；§3 问题 3 改为**十条整句常量表** + 六条用例逐条列断言；S1 补 `REUSE_HANDBACK_SENTENCE`、S5 改锁含五项枚举的整句、S3 补 `DESIGN_HANDOFF_SENTENCE`；§6.1 每行改为点名到具体常量/断言，并删去无对应断言的「反向锚」说法 |
| B4 | 阻断 | R3 用例②失败后在同 root 恢复候选做③会被②的报告阻断 | **属实**：`harness-runner.ts:996-1000` 把冻结失败检查经 `generateScriptReport` 写进 `script-report.json`（`report-generator.ts:148-150`），`phasesWithExistingEvidence`（`feature-execution-scope.ts:665`）把它算作「阶段跑过」，再冻结必撞 `:480-486` 的 D1.3 第三行 | §3 问题 4 改为**三个独立 root**（A=①③④、B=②且此后作废、C=⑤），并把这条机制写进正文；§4.2 B2、frontmatter todo 同步 |
| B5 | 阻断 | ⑤ 没有制造「候选晚于代码」：`setupRunlessProject`（`:1326`）返回前已生成候选，实际顺序仍是候选→改码→冻结 | **属实** | 场景 C 改为四步：移除预生成候选并**断言其确实缺失** → 改源码 → 经生产 `prepareFeatureScopeCandidate` 生成候选 → 首次冻结；断言限定为「该冻结入口不拒绝这个历史顺序」，并保留「不代表整条阶段链通过」（§5.3 #5） |
| S1 | 建议 | 否定 `--freeze-scope` 时把 CLI 旗标等同 feature flag 不准确；F8 应补第三个冻结调用入口 | 属实：`harness-runner.ts:549` 的 `--report-reconcile-only --phase testing` 也调同一函数 | §3 问题 1(d) 理由改为「现有候选入口可用 + 需求已允许事前候选/事后冻结 + 零证明力增量」；F8 补三处调用点并标注两处是报告核对 / 收尾出口，非 coding 准备入口 |
| S2 | 建议 | 「同义 / 逐字相同」与 `project-entry.md:26` 原文有出入 | 属实：`:26` 末「只读请求不因存在可补资料而写盘」与「准备工作可以并行」不是同义句 | §3 问题 2 末表两行理由改为「**避免重复**：该职责已由这句承载」；A4/A5 明确写成「与模板逐字相同」（同一常量覆盖两处），A6/A7/A8 明确写成「句式随各文件上下文、只共享标记串」 |
| S3 | 建议 | S6 只是「同步标记在场」不是「四处口径一致」；「不出现新分类状态词」无可执行集合 | 属实 | S6 更名 `the freeze wording is mirrored in the migration and change-unit docs` 并把「不证明」列写实（**已由第二轮 B3′ 再扩为三份文件并更名 `… in the downstream docs`**）；「不新增分类机制」改引既有 `framework-init-entry-contract.unit.test.ts:336-337` + 人工审 diff，**不扩建禁词门禁**（§6.1、§5.3 #5b） |

**codex 第一轮判通过、当时未动的部分**：入口选型「不补接」结论、模板主体语义 / 两个载体 / 四项输入 /
`execution_scope` 必需标记保住、`component-design/SKILL.md` 不改、H1–H5 矩阵完整、保留/裁剪双清单、
一笔提交、风险如实登记。

### 第二轮（codex，2026-09-18）——逐条处置

| # | 级别 | 意见一句话 | 核到的关键事实 | 落点 |
|---|---|---|---|---|
| B3′ | 阻断 | 第一轮 B3 未完全修复：主责任**首句**没被任何常量覆盖；矩阵两处夸大覆盖 | **属实两条**：① `PRINCIPAL_DUTY_SENTENCE` 从「同一交付单元……」起笔，把 A1 首句改成「**不必**把本次请求接入对应执行路径。」十条常量仍全绿——R1 的核心责任被反转而 smoke 不红；② 矩阵声称 project-entry 的 A6 依赖顺序句「由 S1/S4/S5 覆盖」，但那三条分别查责任句 / request 准备时点 / 授权延续，与 A6 无关 | **扩大既有常量**（不新增常量、不新增用例、不新增机制）：`PRINCIPAL_DUTY_SENTENCE` 纳入首句，A5 同步逐字复制；S6 覆盖面从两份扩到三份（补 `project-entry.md`）并更名 `the freeze wording is mirrored in the downstream docs`；§6.1 两行改写——R1 首行注明常量「扩大后含首句」、R2 三处同步行注明「第二轮更正」；第一轮 B3 的状态由本节末段「第一轮 B3 的状态更新」给出 |
| S1′ | 建议 | 「准备工作可以并行」不能由 `project-entry.md:26`「只读请求不写盘」承担——前者约束并发与依赖、后者约束写入 | 属实 | §3 问题 2 末表 ① 行理由改为「完整边界集中在模板一处、project-entry 不重复展开」，并写明初稿那条论证**不成立**；③ 行补明确引用 `project-entry.md:32`（该条确实同域） |
| S2′ | 建议 | `fs.rmSync` 删文件、删不掉 `execution_scope` 字段 | 属实 | 场景 C 的第①步改为「解析 YAML、`delete raw.execution_scope`、写回，并**断言 `featureScopeCandidateFingerprint` 抛错**」；场景 B **引用 C 的同一做法**，其「候选确实缺失」不另设断言——由 B 自己那条失败断言（`execution_scope_frozen` FAIL/BLOCKER + suggestion 含 `--prepare-scope`）承担 |
| S3′ | 建议 | 「九条」实为十条；§6.1 的分类小计不是互斥逐行计数 | 属实：常量表 10 行；「候选指纹核对」一行同时含新增断言与既有用例，被重复计入两类（29 行总数本身正确） | 改「十条整句常量」；**删掉分类小计表**，只保留「逐行末列都点名到具体落点、无空缺」的判据与总行数 |

**第一轮 B3 的状态更新**：判定为「部分修复」——句内反转面已闭环，**首句未覆盖与矩阵夸大两点由第二轮 B3′ 补全**。

## 12. 提交前摘要（给用户审阅）

**结论先行**：这一笔**只改文字 + 加测试，零生产行为变化**。内部全绿（unit 4630/0、fixtures 46/0、
openspec 45/45），codex 代码 review 阻断 0。**但内部全绿不是收口**——这份需求的收口标准是你在宿主
用同一句原话重跑（§6.2 的 H1–H5），那一步还没做。

### 12.1 事故是什么，这一笔解决什么

宿主接到「银行卡开卡后续流程」这句正式需求后，主 agent 读对了所有文档，却**先自己写完 28 个文件**，
再把设计交给子 agent（还在任务书里写「主 agent 正在按此实现代码，蓝图请与之一致」——**设计与实现的
依赖方向被倒置**），全程没生成范围候选、没建 run；收尾时才问你「要不要按框架跑完整正式阶段链」。

根因不是哪个门禁漏了，而是**主 agent 动手前的责任没人说**：顺序规则散在设计技能、CU 推进技能、
入口表三处，三处各守自己的边界，没有一处写成「你自己要担的责任」。

这一笔就是把这条责任写进 agent 真正会读的入口，并把「完整实现交付」那一格从**验证流水线**改写成
**依赖顺序**。

### 12.2 改了哪四份文档（各一句话）

| 文档 | 一句话 |
|---|---|
| `templates/AGENTS.md.template` | §4.0 里写明：**把本次请求接入对应执行路径是主 agent 的责任**、下游产出必须以已具备的上游依据和有效范围为输入、**委派不豁免你**；补三条边界（准备工作可并行 / 局部请求不强迫建蓝图 / 恢复任务复用有效范围）；「完整实现交付」一格改成**设计交接 → 生成候选 → 进入受管执行**的依赖顺序，并写清**授权延续到终点、不把正式闭环当收尾时再问一次的可选项**。全部行内追加或原位改写，**115/120 行没变** |
| `docs/operations/project-entry.md` | 同一组责任句与授权句**逐字同源**搬过去；补「落笔写测试之前先跑 `--prepare-request` 确认落点与载体」的时点；开头补一句依赖顺序 |
| `MIGRATION.md` | 3.1.0 首节改成「先有设计交接，再由主 agent 用 `--prepare-scope` 建候选；**该入口只生成候选、不冻结范围**；冻结在首次阶段调用」 |
| `skills/project/change-unit-progression/SKILL.md` | 施工段补三处限定：候选生成**在任何产品源码改动之前**、只生成候选不冻结、冻结在首次阶段调用或 run 出生时 |

### 12.3 测试证明什么 / 不证明什么

**六条 smoke（`framework-init-entry-contract`，追加进既有套件，既有 14 条一行未改）**

| 锁什么 | 证明 | **不**证明 |
|---|---|---|
| 主 agent 责任句（**含首句**）+ 复用/交回句，模板与 project-entry 各一次 | 这两句还逐字在两份文档里 | agent 会照做 |
| 委派不豁免句，同两处 | R5 承诺在场 | 子 agent 任务书不会倒置 |
| 设计交接是输入 / 只生成候选不冻结 / 首次阶段调用冻结，三句同在 §4.0 | 要把入口写成「prepare-scope 冻结范围」必须先删掉其中一句 | 完整步骤细节（写入 feature.yaml、核对投影、命令行）——那些由正文与 H1 管 |
| 三条边界逐句 | 句内反转（「可以并行」→「不可以并行」）当场红 | 真实请求里会不会被遵守 |
| 授权延续整句（含五项确认点枚举） | R4 两半都在 | agent 不会在收尾时再问 |
| 三份下游文档含两个冻结口径标记串 | 不会只改模板漏掉下游 | 三处口径语义一致——**只看标记串在不在**，语义留人工审 diff |

**共同上限**：smoke 只证明「这十条被锁定的常量还逐字在、常量**内部**没被改写」。常量之外另起一句
推翻它，smoke 看不见——那是人工 review 的范围，不为它扩建机制。

**R3 生产路径用例（`execution-scope`，三个独立 root）**

| 场景 | 证明 | **不**证明 |
|---|---|---|
| A：候选在场 | 真实 CLI 首次阶段调用**确实落盘冻结**、记录的候选指纹＝磁盘候选、之后只读复用、全程不造 run | — |
| B：没有候选 | **没有候选连阶段都跑不起来**（`execution_scope_frozen` BLOCKER FAIL，suggestion 指向 `--prepare-scope`） | — |
| C：**先删候选 → 改源码 → 再生成候选 → 首次冻结** | **冻结入口完全不拒绝这个历史顺序**，一条检查项都不发；冻结记录里没有任何代码基线字段 | 不证明「整条阶段链会通过」（本场景没跑 checker） |

**场景 C 是这一笔最该看的一条**：它把上限钉死了——**框架今天证明不了「候选先于代码」**。
先写代码、后补候选、再跑阶段，这条链**不会仅仅因为这个先后**而失败（其它检查该红照样红）。
需求 §4 明令不加拦截、不加工作区 clean 门禁，所以这一维**只能靠 H1 观察**。

### 12.4 两处偏离 + 一次自纠（都已进 §10）

1. **偏离**：R1 边界②措辞由 plan 写的「**动**手写之前」改为「**落笔**写测试之前」——「动手写」含子串
   `手写`，会踩中**既有**用例对「手写来源/指纹」的全文禁词断言（误伤）。选择改我自己的措辞，
   **没有削弱那条既有断言**。
2. **偏离（原为待核，已实跑定谳）**：plan 给场景 B 写了「报告落盘 / 未落盘」二选一断言。实跑证明
   报告确实落盘，兜底分支是死代码 → 删掉、直接断言，用例反而更严。
3. **自纠**：A3 整格改写时把原格的「创建**真实 attended Goal**」写丢了，全量 `npm test` 第一遍红在
   既有用例 `shared AGENTS.md template rendering is independent of active adapter`
   （`4629 passed, 1 failed`）。**把丢掉的半句加回去**，没动那条既有断言。
   同一轮我还误报过一次「全绿」——看了后台任务 exit code 而不是日志的 `结果：` 行，已改口径。

### 12.5 已知上限（都不阻断，如实登记）

| # | 上限 |
|---|---|
| 1 | **文字 ≠ 遵守**。事故里主 agent 遵守了子 agent 那条显式边界，只支持「把责任写清楚值得先试」，**不证明「写一句就一定遵守」** |
| 2 | **先后关系机器不可见**（§12.3 场景 C）。需求 §4 已裁定不加拦截；若 H1 未达成，另立需求且只考虑告警 |
| 3 | **写集门 ≠ 设计准入门**。`--prepare-scope` 只要求 `contracts.files` 拿得出可核验写集，**不核这份 contracts 是不是 admitted 蓝图派生的**（手写的普通 `contracts.yaml` 同样能过）。「设计交接是候选的输入」这一层只靠入口文字 |
| 4 | **整句 smoke 挡不住「另起一句推翻」**（§12.3 共同上限） |
| 5 | **宿主入口不会自动更新**：模板改了不会流到宿主，必须集成发布件 + `framework-init` UPDATE |
| 6 | codex 代码 review 是**只读源码复核，未独立重跑变异**；变异红/绿由本会话实跑，调度者独立复跑了全量 |

### 12.6 收口还差什么：宿主重跑 H1–H5

**前提（缺一即结果无效）**：① 宿主现场整体留档到仓库外并回到干净工作区（已跟踪 13 个文件、未跟踪产品
代码 15 个文件、`doc/features/bc-openCard-2/`、`scratch/`、`doc/requests/`、`doc/reports/`，一个不漏）；
② 集成本轮发布件；③ 按 `framework-init`（UPDATE）刷新 `AGENTS.md`/`CLAUDE.md`；④ 宿主 agent 记忆保持
清理后状态；⑤ 用需求 §1 的同一句原话触发，**不附加任何流程提示**。

| # | 看什么 | 判不通过的样子 |
|---|---|---|
| H1 | **第一次改产品源码之前**，设计交接与范围候选/有效范围已经成立 | 先写代码再补蓝图；或候选在代码之后才出现 |
| H2 | 委派子 agent 做设计时不被要求按已写代码倒推；主 agent 等设计交接回来再进施工 | 任务书里出现「请与已写代码一致」一类倒置 |
| H3 | 授权延续到终点：主 agent 自己建 run 或逐阶段跑链，只在既有确认点停 | 收尾时问「要不要补跑正式阶段链」 |
| H4 | coding 前输入已具备、需补产的上游先完成、已有输入直接复用、实现与验证在链内执行 | 链外写完代码再「补跑」阶段；或为凑套餐补产已有等价输入的文档 |
| H5 | 准备工作可并行；局部请求不被强迫建蓝图 | 把所有事都拉成六阶段 |

H1–H5 **逐项记录「达成 / 未达成 / 不适用」及依据**，再给总体结论；「有结论」≠「通过」。
已接受的小偏差可留到下一个真实需求继续观察，**但不得改记为「原要求已达成」**。未达成项回灌到对应条款。
全部有结论后，第二条 todo 才可置 `completed`。
