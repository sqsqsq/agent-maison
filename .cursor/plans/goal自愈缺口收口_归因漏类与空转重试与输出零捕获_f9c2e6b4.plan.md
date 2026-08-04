---
name: goal 自愈缺口收口 — 完成证据新鲜度 / 构建事务分流 / 责任类别不被洗白 / 启动入口
version: 3.0.0
# 版本说明：跟随当前 3.0.0 窗口（2026-08-03 用户拍板）。本 plan 决定宿主回归能否走到
# "完整成功"——四项缺陷全在 spec→plan→coding 必经路径上，不修则每次回归都在同一处停等人工。
# 影响：release:check-plans 的 3.0.0 未完成 plan 由 9 条增至 10 条。
overview: >
  立项原则（2026-08-03 用户拍板，codex 复核后收窄）：**不要求用户手工预修宿主作为验收前提**。
  框架应正确区分并自动处理四类情况——agent 可修 / 事务可重试 / 外部等待 / 真正 human-only。
  只有在**不存在不可委托授权**却仍投影 human 时，才算框架缺陷。
  （原稿写成"每一处需要人介入都是框架缺陷"，会推翻已收敛的授权模型：真人签名、视觉确认
  等不可委托授权本来就必须等人；产品代码半成品本就该由 goal agent 自己改。）
  ---
  实证 run `20260803T103413Z-3f72a8`（bc-openCard，无人值守，cursor adapter）：
  spec PASS → plan PASS → **coding HALTED(WAITING/human)**，68 分钟里真正的修复尝试只有一次。
  **根因链（v1 稿判断错误，本稿据证据重写）**：
  ① coding attempt 2/3 的 agent 只跑了 35.330s / 35.329s，**不是"空转"**——五个
  `phase_verdict` 全部带 `completion_observed=true`，包括这两次。框架看到"完成信号"后
  主动 tree-kill 了 agent。
  ② 那个信号是**陈旧回执**：`coding/phase-completion-receipt.md` 的 mtime 是 19:42:25
  （第三次 attempt 进行中），内容却写 `claimed_completion_at: 2026-08-03T19:40:00`
  （早于该 attempt 开始），且 schema **不含任何 invoke_id / attempt_id 绑定**。
  原样复写旧回执即可让 observer 认定"本轮已完成"。
  ③ 违反的是已归档规格 `openspec/specs/goal-runner/spec.md:75` 的**本 attempt 新鲜度**这一条。
  **精确定位**：同规格的"调用前已完整则跳过"分支**已实现且行为正确**——
  `decideSkipAgentInvoke()` 在 `retries>0` 时判"须真跑"，attempt 2/3 本就该真跑。
  漏的是 invocation **内**的 observer 没有身份绑定，于是"启动后立即被终止"照样发生。
  ④ 于是两次 attempt 被瞬间烧掉，预算耗尽 → `assess_halt:phase_verdict:halt; failure_kind=project_build`
  → `normalizeIncidentId` 截成 `assess_halt` → registry 固定 `operator` → **WAITING/human**。
  真实责任类别（内容失败 / 外部条件）在这一步被洗掉。
  ⑤ 构建失败本身是 hvigor `00303149 Configuration Error` / `Path not found: 05-SystemBase\CommFunc`，
  **但该目录真实存在**、根 build-profile 未改、agent 内层同一构建已 verified——
  这是构建环境/复验不一致，**不是依赖缺失**，不该走 ohpm install。
todos:
  - id: t1-completion-evidence-attempt-binding
    content: >
      **完成证据绑定当前 invocation（本 plan 的根因项）。**
      现状实锤：回执 schema 2.0 无 `invoke_id` / `attempt_id`；observer 只认
      "不完整→完整"跃迁（phase-completion-probe.ts:230 起），不校验证据是否属于本次调用。
      于是 attempt 2/3 各被"旧回执原样复写"骗停一次。
      **已归档规格早有要求**（openspec/specs/goal-runner/spec.md:75）：判据须叠加
      **本 attempt 新鲜度**；且调用前证据已完整时 MUST 跳过本次调用。
      **现状精确定位（codex 三轮订正，勿再写成"两条都不满足"）**：调用前的安全跳过
      **已经实现**——`decideSkipAgentInvoke()` 要求 baselineComplete + retries=0 +
      无 handoff 待修 + 证据 run_id 与当前 run 一致，本次 attempt 2/3 因 `retries>0`
      正确地判了"须真跑"。**真正缺的只有一处：invocation 内 observer 没有身份绑定。**
      本项是规格符合性缺陷（缺 attempt 绑定），不是新特性。
      **落地**：① 完成证据增加 `run_id + phase + attempt_id` 三元组——**不加 `invoke_id`**：
      `goal-runner.ts:5832` 的 `invokeId = \`${phase}-${attemptId}\`` 已是该三元组的派生值，
      同时存两份即重复建模；② invocation 内 observer 只认**匹配当前三元组**的完整证据；
      ③ **调用前的跳过判据保持不变**，继续用 `decideSkipAgentInvoke()`——
      它**不得**要求证据匹配"尚未开始的新 attempt"，否则「证据须属当前 attempt」与
      「调用前已完整则跳过」会被实现成互相不可达的两个条件。
      **回归**：attempt 1 完成 → 外层 FAIL → attempt 2 原样复写旧回执 → observer
      **不得**判本轮完成，且该 attempt 不被瞬杀。
    status: completed
  - id: t2-config-error-path-triage
    content: >
      **hvigor `00303149` 按路径存在性分流；不走 ohpm install。**
      现状实锤：`PROJECT_DEPENDENCY_PATTERNS`（hvigor-runner.ts:293）六条 resolve 味正则
      不命中配置错误 → 落兜底 `project_build`。
      **但 v1 稿"漏掉了依赖自愈链"的结论是错的**：`Path not found: 05-SystemBase\CommFunc`
      指向本地工程模块（该目录真实存在、被 build-profile.modules[].srcPath 引用），
      `ohpm install` 不负责创建本地源码目录。强行进 `dispatchDepsInstall` 只会多改依赖状态、
      多跑一条无关命令。
      **正确的最小判据**（结构化输入：错误码 + `At file:` 段，禁止扫散文）。
      **三分支全部定死，不留斜杠**——t3 与 supervisor 必须拿到唯一结论：
        · **路径确实不存在** → `project_config_error`：交 agent 修 build-profile 或恢复本地模块；
        · **路径实际存在** → 构建环境/复验不一致 → **runner 立即原样重跑一次构建事务**
          （不启动 agent、不消耗内容重试预算）；
        · **同一事务重跑后仍报"路径不存在"** → 归 **`external`** → `WAITING/external`，
          **不得**再进入 agent 内容重试；
        · 仅当捕获到**明确的 runner 命令 / cwd / 环境注入错误**时才归 `framework_fault`。
      只有**另外独立命中**真正的依赖解析证据，才允许走 ohpm install。
      **并入原 t2（话术可执行性）**：兜底 suggestion 依据是否解析到 file/line 分叉——
      有则指向源码位置；无（`compile_first_error=(no file)`）则原样呈现首条工程级错误与
      hvigor 的 `* Try:` 原文 + 日志路径，**不得**再说"定位文件/行"。
      验收用**分类函数矩阵测试**，不做"扫描所有 failure kind 中文 suggestion"的元门禁。
    status: completed
  - id: t3-retry-exhaustion-keeps-responsibility-class
    content: >
      **重试耗尽必须保留责任类别，禁止统一洗成 human。**
      现状实锤：产生端发 `assess_halt:phase_verdict:halt; failure_kind=project_build`
      （goal-runner.ts:7755）→ `normalizeIncidentId` 截到首个 `:`（adjudication.ts:317）
      → 命中 registry 的 `assess_halt: { class: 'operator' }`（adjudication.ts:226）
      → **WAITING/human**。带真实原因的所有 assess 侧 halt 都在这一步被抹平。
      注意这不只是文案：`WAITING` 会让 supervisor **永不拉起**
      （goal-supervisor.ts:17 `stale × WAITING → 不拉起`）。
      **落地**：产生端改出**两个稳定事故 id**——
        · `content_retry_exhausted` → TERMINAL（内容反复不过，重启无用）
        · `external_retry_exhausted` → WAITING/external
      并在 registry 显式登记。不再让任意 halt 走通用 `assess_halt → operator`。
      **订正 v1 稿的事实错误**：原稿写"WAITING/external 由 supervisor 决定何时再试"——
      **错**。a4 的语义是 `stale × WAITING → no_op`，换 external 只是把"等人"改成"等环境"，
      **不会**自动重试。本项的收益是**责任归属正确**（可据此决定是否重启、是否求人），
      不是"自动重试"；如需自动重试须走 t2 的构建事务重试，不在本项。
    status: completed
  - id: t4-goal-launch-entry
    content: >
      **goal 启动入口收敛：消除 JS wrapper 与陈旧输入复用。**
      现状实锤：`goal-mode-operations.md:41` 只给 `--requirement "<string>"`；宿主 544 字节
      多行中文需求撞 Windows 引号，agent 每次自造 `launch-*.js` + `*-requirement.txt`
      （scratch/ 下现有两份不同名、不同内容的需求文件，重跑旧 launcher 即把旧需求带进新 run）。
      **落地（已拍板，不再留开放问题）**：
      ① `goal-runner` 与 `goal-mode-entry --prepare-run` **同时**新增
      `--requirement-file <existing-file>`，与 `--requirement` **互斥**；
      ② fresh 启动时按 UTF-8 读取内容并**冻结进 manifest**；
      ③ `--resume` 只读已冻结的 manifest，**不重新读取源文件**；
      ④ 文档以 `--requirement-file` 为多行需求的推荐入口，manifest 保留给确实需要
      完整配置（budget / unattended / dependency_policy）的场景；
      ⑤ 指引明示"不要为启动 goal 写包装脚本"，写成对 agent 的话术 + 预期回报，不是 CLI 清单。
      **防陈旧靠"启动时读取并冻结内容"，不靠禁止复用路径**——权威需求文件本就该长期复用
      （宿主是 `doc/features/原始需求/1-银行卡/原始需求.md`）。因此不再规定临时文件命名与
      清理生命周期，也不需要临时 YAML。
      **v1 稿的"零新旗标"理由作废**：简单性以**调用方要做多少事**衡量，
      逼 agent 手写整份 manifest 比加一个窄旗标更复杂。
    status: completed
isProject: false
---

# goal 自愈缺口收口 (f9c2e6b4)

状态：**v2 已实施 + codex 复核四项修复完毕（2026-08-03）**

## 实施记录（codex 复核后定稿）

初版实现有一处偏差与三处未穿透，均已修：

| 项 | 初版问题 | 定稿做法 |
|---|---|---|
| t1 | 缺 `claimed_attempt_id` 时**在 goal 下也**退回时间戳 = 等于没绑定 | goal（invocation 带 attemptId）**硬绑 run+attempt**，缺任一即判否；时间戳分支只留给非 goal/人工。可行性由 `check-receipt` 在 goal 环境把该字段列为必填保证——agent 收尾跑门禁即被要求补上，同一次调用内自纠 |
| t2 | 探测匹配**任意**八位配置错误码、且允许缺 `At file:`，会吞掉其他配置错误 | 只认 `00303149` **且** `At file:` 非空，否则返回 null 走既有分类 |
| t2 | `blocking_class` 原样落新 kind，策略层只认 `externalBlocked` → 又回去让 agent 改代码，**plan 要求的 WAITING/external 根本没接通** | 复用既有 `externalBlocked` + `INCOMPLETE` 契约（与 ut/testing 设备阻塞同构），并补**生产链**用例：check → verdict → dependency policy → `defer_external*` |
| t4 | manifest override 校验发生在 requirement 解析**之前**，`--manifest + --requirement-file` 未带 override 时内容静默忽略；resume 携该参数同样静默忽略 | 校验挪到解析之后；resume 携 `--requirement-file` **显式 fail-closed**（同 `--vision-lineage` 的禁止静默忽略原则） |

二轮复核再补一项：

| 项 | 问题 | 定稿做法 |
|---|---|---|
| t1 门禁 | `check-receipt` 的 attempt 校验只挂在 `isGoalOrchestrationEnv()` 下，而仓内已实锤 **cursor 工具子进程会丢 `MAISON_GOAL_HEADLESS/RUNNER`、只留 `RUN_ID/ATTEMPT`**（phase-state.ts:107）。agent 侧跑 check-receipt 时校验根本不执行，observer 又已严格要求该字段 → 从"35 秒误杀"变成"跑到 hard timeout" | 谓词改用既有并集 `isGoalOrchestrationEnv() \|\| isAgentSideGoalHarness()`；且**任一 goal 信号在场而 `MAISON_GOAL_ATTEMPT` 缺失**本身即 BLOCKER（传播链异常不得静默降级，与 `MAISON_GOAL_RUN_ID` 同口径） |
| t1 门禁（三轮） | 上条只改了新加的那处，**同文件另外四处 goal 分支仍是单一谓词**：evidence policy 的 `mode/can_collect_usage`、slim 凭证 run 绑定、assumptions ledger、assess 投影。cursor 形态下这些仍被误判成 interactive 而静默跳过 | `main()` 开头一次算准 `inGoalReceiptContext`，全文件五处 goal 分支统一复用（收敛既有规则，非新增抽象）。测试补第四例打**非 attempt 分支**（summary 缺 run_id 须照样 BLOCKER）；变异复验：谓词退回单一信号时四例中三例转红 |

**沉淀纪律（两条）**：
1. 局部函数测试通过 ≠ 状态穿透到最终裁决。新增 failure kind / blocking class 时，
   必须补一条从 check 结果走到 goal action 的链路断言，否则就是语义假绿。
2. **判"是不是 goal"一律用既有并集谓词**，绝不新写 `isGoalOrchestrationEnv()` 单一判据——
   adapter 子进程丢 env 是已实锤形态，单信号判定必翻车。新增门禁尤其要注意：
   门禁被静默跳过，比门禁判错更难发现。

## 判读纠错记录（禁删）

| 轮次 | 我的定性 | 证伪方式 | 错因 |
|---|---|---|---|
| v1 | 两次 35 秒是 **agent 空转**（配额/断流），框架不该计入重试 | events 里五个 `phase_verdict` 全带 `completion_observed=true` | **只看了 `agent_invoke_end` 的时长，没看 `phase_verdict` 的伴随字段**——同一份 events 里就有反证 |
| v1 | `agent-output.log` 恒 0 是因为 cursor 缺 `output_delivery` 声明，框架"退化成不抓" | `agent-invoke.ts:955` 无条件建输出流；`capture_method` 在 `usage` 对象内，是 token 采集口径 | **把两个同名感字段当成一个**（usage.capture_method vs 输出捕获） |
| v1 | 配置错误漏进依赖自愈链，接上 `ohpm install` 即可自愈 | `05-SystemBase/CommFunc` 真实存在；agent 内层同一构建已 verified；ohpm 不创建本地源码目录 | **把"我的推测"（缺 oh_modules）当作前提去设计修复**——推测在 v1 里标了"非定论"，落地却依赖它 |
| v1 | 空转按 external 处置，"由 supervisor 决定何时再试" | `goal-supervisor.ts:17`：`stale × WAITING → 不拉起` | **写 plan 时与自己刚交付的代码语义冲突**（a4 是本人本轮所写） |

**沉淀纪律**：查 goal 事故时，**同一 attempt 的所有事件类型都要看全**——
只挑 `agent_invoke_end` 会漏掉 `phase_verdict` 上的 `completion_observed`，
而后者才是"agent 为什么 35 秒就没了"的答案。

## 实证链（run 20260803T103413Z-3f72a8，可复查）

### 1. 阻断事实

| 阶段 | 结果 | agent 耗时 | completion_observed |
|---|---|---|---|
| spec | PASS | 1591 s | true |
| plan | PASS | 550 s | true |
| coding attempt 1 | FAIL `project_build` | 1804 s | true |
| coding attempt 2 | FAIL `project_build` | **35.330 s** | **true** |
| coding attempt 3 | FAIL → HALT | **35.329 s** | **true** |

### 2. 陈旧回执

`doc/features/bc-openCard/coding/phase-completion-receipt.md`

- 文件 mtime：**2026-08-03 19:42:25**（第三次 attempt 进行中）
- 内容：`claimed_completion_at: "2026-08-03T19:40:00+08:00"`（早于该 attempt 开始）
- schema 2.0 字段全集里**没有** invoke_id / attempt_id

### 3. 洗白链

```
失败重试耗尽
→ assess_halt:phase_verdict:halt; failure_kind=project_build   (goal-runner.ts:7755)
→ normalizeIncidentId 截到首个 ':' → "assess_halt"             (adjudication.ts:317)
→ registry: assess_halt → operator                             (adjudication.ts:226)
→ WAITING / human
→ supervisor: stale × WAITING → 不拉起                          (goal-supervisor.ts:17)
```

### 4. 定性纠正（勿再写错）

- **不是本轮 3.0.0 改动引入的回归**：新投影字段全部正确落盘。但 `normalizeIncidentId`
  的粗粒度归一（t3 要修的）是本轮交付的一部分，属**本轮遗留缺口**，不是外部问题。
- **无法用现有数据证成/证伪"比上个版本更差"**：宿主 goal-runs 只剩两个当日 run，无对照。

## 移出范围

| 项 | 去处 |
|---|---|
| 宿主 build-profile / 依赖 / 产品代码手工预修 | **不作为任何 todo 的前提**（立项原则） |
| adapter `output_delivery` 声明与输出交付实测 | **移出本 plan**——v1 的 t3 前提已被证伪；可作非阻断后续项，不挂本次自愈修复关键路径 |
| "空转"启发式（时长骤降 / 连续 N 次） | **不做**——真因是 t1；仓内已有 `agent_no_output`（goal-runner-phase.ts:489）与 signature+artifact no-progress（goal-failure-classifier.ts:619），再加即第三套启发式 |
| hvigor 其他错误码分类扩展 | 只做 `00303149`，先复现后扩 |
| 宿主 scratch/ 清理 | 不做；框架侧只消除"必须写包装脚本"的成因（t4） |

## 验收方向

- **t1 主验收**：attempt 1 完成 → 外层 FAIL → attempt 2 原样复写旧回执 →
  observer 不判完成、attempt 不被瞬杀。
  **回归护栏**：`decideSkipAgentInvoke()` 的既有正例（同 run、retries=0、无 handoff、
  证据完整 → skip）**必须仍然通过**——身份绑定不得把它变成不可达分支。
- **t2**：以本次 hvigor 日志为 fixture 的分类矩阵——路径不存在 → `project_config_error`；
  路径存在 → 构建事务立即重跑一次且**不启动 agent**、**不减内容重试预算**；
  **重跑后仍报路径不存在 → `external`（WAITING/external），断言此后不再启动 agent、
  不再消耗内容 retry**（防绕回三轮瞬杀的老形态）；
  `(no file)` 时 suggestion 不含"文件/行"指令。
- **t3**：耗尽路径产出 `content_retry_exhausted` / `external_retry_exhausted`，
  registry 显式登记；断言不再出现 `assess_halt` 归一到 operator 的路径。
- **t4**：`--requirement-file` 与 `--requirement` 互斥（同给即 fail-closed）；fresh 读取内容并
  冻结进 manifest；**resume 不重读源文件**（改源文件后 resume，manifest 内容不变）；
  宿主启动无需 JS wrapper。
- **宿主回归（不在框架侧勾选）**：同一 feature 重跑，coding 不再因本链停等人工。

## 硬约束

1. **不要求用户手工预修宿主**作为任何 todo 的前提；但**不得**推翻既有授权模型——
   真人签名 / 视觉确认等不可委托授权仍必须等人。
2. **判据来自结构化输出**（错误码、字段），不扫散文关键词。
3. **不新增第三套启发式分类**；不新增状态枚举、不新建测试床。
4. t3 的收益是**责任归属正确**，**不是自动重试**——不得据此声称 run 会自愈重启。
5. 简单性以**调用方要做多少事**衡量，不以"框架新增多少 surface"衡量（t4 的旗标之争按此裁）。
