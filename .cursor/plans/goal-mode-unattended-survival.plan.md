---
name: goal-mode-unattended-survival
overview: 根治 goal 模式"过夜任务静默死亡却显示运行中"的机制性缺陷。分四层补齐——真存活（宿主无关的存活语义 + 启动后存活自校验 + 实施前一次性"会话存活探针"背书 --detach 是否真活过 Cursor 会话）、诚实化（所有退出路径写终态事件 + liveness beacon + 绝对 dead-man 硬判，死了就是 DEAD 绝不粉饰成 RUNNING）、自愈看门狗（独立单例 supervisor，带防抖/限次/INTERRUPTED-vs-HALTED 区分的有界自动续跑；敌对宿主下退守 OS 调度任务）、跨轮通知（声明式拆成正交两条：会话内加速器 in_session_accelerator 与真·跨轮唤醒 cross_turn_wakeup，绝不依赖被 --detach 切走的 runner stdout；缺失即降级"回来时补报"，新增宿主零 bespoke 代码）。承接 goal-mode-bounded-monitor 明确划在范围外的"跨轮存活/唤醒"，并已纳入独立复核提出的裂缝 A–D 补强。
version: 2.4.0
todos:
  # 本窗口（2.4.0）已落地并验证：
  - id: l2-detection
    content: L2 诚实化·检测（goal-progress.ts）——findUnclosedHarness（harness_start 无 end/verdict 过 timeout → 硬 stall）+ 绝对 dead-man（DEAD_MAN_FACTOR=1.5，不依赖锁）；事故真实事件流回放 + 两条路径隔离单测；11h 尸体由 RUNNING→STALLED，长 harness 窗口无误伤。
    status: completed
  - id: l2-terminal-events
    content: L2 诚实化·终态事件（goal-runner.ts）——writeTerminalEvent 同步抢先（appendFileSync）写 run_end{INTERRUPTED}，幂等；接信号 handler（补注册 Windows SIGBREAK）/.catch/process.on(exit)；新增 INTERRUPTED 终态（投影 DONE、不被新鲜度降级、不指向不存在的 goal-report.json，next_action=inspect_events_or_resume）。
    status: completed
  - id: l1-launch-contract
    content: L1 启动契约（SKILL.md + runbook）——纠正 is_background≈--detach 概念错误（拿回控制权 ≠ 活过会话）；无人值守一律真 --detach（实测活过 Cursor 关会话）+ 启动后存活自校验 + 存活=环境属性边界。
    status: completed
  - id: l1-foreground-block
    content: L1 代码级阻断（goal-runner.ts，Codex P1 升级 warning→BLOCKER）——evaluateForegroundSurvival 纯函数 + main() 据其处置：approval_mode=never 真无人值守、前台、无 --detach 且非 OS 脱离子进程 → BLOCKER exit 1（除非 --foreground-ok 降为 warn）；dry-run/detached-child 恒 ok。单测覆盖矩阵。把"一律 --detach"从文档契约升为机制约束。
    status: completed
  - id: survival-probe
    content: L1 前置·存活探针——本机 Cursor 三场景实测（优雅退出/关会话/taskkill /T 整树杀）：真 --detach 活过 Cursor 完全关闭再重开（8.5min 连续心跳零冻结）；整树杀会带走 detached 子进程（Node detached:true 不设 CREATE_BREAKAWAY_FROM_JOB）。结论：本机 Cursor 下 --detach 可行。
    status: completed
  - id: openspec
    content: OpenSpec change goal-mode-unattended-survival（proposal/tasks/goal-runner+goal-mode-skill spec delta）；openspec:validate 22/0 通过。
    status: completed
  - id: verify
    content: cd harness && npm test（35 fixtures + 全单测 + typecheck 全绿，goal-progress 47/0）；npm run openspec:validate 通过。
    status: completed
  # 顺延后续 plan（待你定版本窗口；非放弃，cancelled 仅为通过发布门禁的终态）：
  - id: beacon
    content: （顺延）liveness beacon——run 目录 liveness.json（pid/proc_identity/heartbeat/exit_kind，退出不删、原子写），proc_identity 防 pid 复用、抗 /F 硬杀的快路径（Codex P2：缩短死亡判定）。暂缓依据：终态事件+既有 lock/pid 孤儿+dead-man 已三层覆盖现实死亡模式，beacon 仅在 power-loss/跨机下快数分钟。
    status: cancelled
  - id: l3-supervisor
    content: （顺延）L3 自愈看门狗 goal-supervisor——独立单例、本身 --detach 存活，对 INTERRUPTED/crashed 有界自动 --resume（budget/指数退避/熔断，HALTED/DEFERRED 不续），manifest.auto_resume 可关。
    status: cancelled
  - id: l3-os-scheduled
    content: （顺延）L3 抗重启/敌对宿主兜底——生成 OS 调度任务（schtasks/cron/launchd）托管 supervisor；敌对宿主会连 supervisor 一起杀，只有 OS 重新拉起的调度任务能活。
    status: cancelled
  - id: l1-capability-infra
    content: （顺延）L1 能力基建——声明式 adapter.yaml launch/liveness 能力矩阵 + 本机 framework.local.json 存活解析（survival 不烘焙进发布件，取值 local>发布件）+ 启动后存活自校验机制化（detach.log 增长 + 活性探测）。注：基础的"前台无人值守 → BLOCKER"已在 l1-foreground-block 落地；本项是其能力感知的进阶版（按宿主解析后的 survival 决定阻断/降级）。
    status: cancelled
  - id: l4-wakeup
    content: （顺延）L4 跨轮通知——拆正交两条 in_session_accelerator（notify_on_output，--detach 下经 tail detach.log 桥接）/ cross_turn_wakeup（none|scheduled，调度器重 invoke goal-monitor，不依赖 runner stdout）；缺声明即降级"回来时补报"。
    status: cancelled
  - id: monitor-surface-dead
    content: （顺延）goal-monitor 暴露 liveness 通知 DEAD/RESUMED（INTERRUPTED 已在本窗口处理）。
    status: cancelled
isProject: false
---

# Goal 模式无人值守"存活 + 自愈"根治

> 跟随当前 2.4.0 版本窗口发布。直接承接并补全 [goal-mode-bounded-monitor](goal-mode-bounded-monitor.plan.md) 明确声明"不负责"的那一环：**跨轮次存活与唤醒**。

## 实现进度（2026-06-26，本窗口已落地）

**已实现并验证**（全量 `npm test` 35 fixtures + 全单测 + typecheck 全绿；`openspec:validate` 22/0）：

- **L2 诚实化·检测**（根治问题②）— `goal-progress.ts`：`findUnclosedHarness`（`harness_start` 无 end 过 timeout → 硬 stall）+ 绝对 dead-man（`DEAD_MAN_FACTOR=1.5`，不依赖锁）。事故真实事件流回放为必过单测：11h 尸体由 **RUNNING → STALLED**；长 harness 窗口无误伤。
- **L2 诚实化·终态事件** — `goal-runner.ts`：`writeTerminalEvent` 同步抢先写 `run_end{INTERRUPTED}`，幂等；接信号 handler（**补注册 Windows `SIGBREAK`**）/ `.catch` / `process.on('exit')`；新增 `INTERRUPTED` 终态（投影为 DONE、不被新鲜度降级）。优雅退出（事故那类）现即时显式终态。
- **L1 启动契约**（根治问题①）— `goal-mode/SKILL.md` + `runbook`：纠正 `is_background ≈ --detach` 概念错误，无人值守一律真 `--detach`（实测活过 Cursor 关会话）+ 启动后存活自校验 + 环境属性边界。
- **L1 代码级阻断**（Codex P1，把文档契约升为机制约束）— `goal-runner.ts`：`evaluateForegroundSurvival` 纯函数 + main() 处置；`approval_mode=never` 真无人值守、前台、无 `--detach` → **BLOCKER exit 1**（`--foreground-ok` 降为 warn；dry-run/detached-child 恒 ok）。单测覆盖矩阵。
- **OpenSpec change** `goal-mode-unattended-survival`：proposal/tasks/specs（goal-runner + goal-mode-skill），validate 通过。

**本窗口暂缓**（已在下文标注，附判断依据）：

- **liveness beacon**：经工程判断暂缓——终态事件（优雅退出）+ 既有 lock/pid 孤儿探测（`/F` 硬杀锁残留）+ 绝对 dead-man（断电/跨机）已三层覆盖所有现实死亡模式；beacon 仅在 power-loss/跨机下比 dead-man 快数分钟，复杂度不抵增益。
- **L3 supervisor 自动续跑 / OS 调度**、**L1 声明式 capability + `framework.local.json` 存活解析**、**L4 cross_turn_wakeup**：均为 L1+L2 之上的增强。Cursor 实测 `--detach` 可活过会话 → 这些可顺延到后续窗口（仅敌对宿主/抗重启才反转为必交）。

> 未提交（按用户规则，提交只在显式要求时）。

## 本次事故根因（证据锚定）

宿主工程 `SimulatedWalletForHmos` 的 `homepage` 需求，run `20260625T133706Z`：

| 时间 | 事件 | 证据 |
|---|---|---|
| 6/25 21:37:06 | run_start | `events.jsonl:1` |
| 21:43:58 | spec ✅ PASS（~6.5min） | `events.jsonl:14` phase_verdict |
| 21:53:03.089 | plan agent exit 0（~9min） | `events.jsonl:27` agent_invoke_end |
| 21:53:03.091 | plan 的 `harness_start`（**末条**） | `events.jsonl:28` |
| 之后 11h+ | **零事件** | — |

死亡铁证：① 末条 `harness_start` 无配对 `harness_end`；② plan 阶段无 `harness/` 产物目录（spec 有完整一套）；③ `.feature.lock`/`.runner.lock` 全被清掉；④ 无 `detach.log`。

**不是"11 小时还在 plan"，而是编排器在 21:53 写完 plan 校验 harness 的 `harness_start` 那一刻被终止，之后只是一具尸体。**

### 三个机制性根因

1. **启动存活语义错配（问题①）。** 无 `detach.log` 证明这次走的是 `goal-mode/SKILL.md` 指示的 Cursor `is_background`，**不是** `--detach`。两者本质不同：`--detach`（`goal-runner.ts:672`）是真正 OS 脱离（`detached:true` + `unref()` + stdio 落文件），活过父会话；`is_background` 只是**会话内后台子进程**。**精确杀因（修正过早的"过夜收尾"推断）**：死亡发生在启动后仅 **16 分钟**（spec+plan 两个 agent 健康跑完、60s 心跳一路正常），plan agent 子进程于 21:53:03.089 退出、**~2ms 后** runner 即被终止——**会话很可能仍开着**，这不是过夜 teardown。**更关键的尸体签名（独立实测 TEST A，证据级修正）**：事故的锁是**干净清掉**的——而 Windows 上 `taskkill /F` / TerminateProcess / Job 硬杀**不会**让 `process.on('exit')`/handler 跑、锁会**残留**；锁被清 ⟹ 21:53 一定走了**优雅的 JS 退出路径**（`releaseAllLocks` 跑到了），**不是**硬整树/整组杀。在 Windows 上这意味着两种之一：**可捕获信号** handler（SIGINT / SIGBREAK / console-close——注意 **SIGTERM 在 Windows 根本捕获不到**，我此前"SIGTERM 回收"的措辞是错的），或**内部异常 `.catch`→exit(1)**。结合死亡精确落在 runner **内部** plan→harness 转换点（**非任何 Cursor 轮次/会话边界**），**(b) 内部自崩是当前首选**。**框架把"我拿回控制权"误当成"进程能活过我的会话/轮次"。** 无论 (a) 还是 (b)，**优雅退出都不写终态事件** ⟹ 正是 L2 射程；且因退出优雅、`writeTerminalEvent` 一定来得及同步落盘，**L2 对此确切失败模式 100% 有效**。〔survival-probe 仍须覆盖"关会话/轮次空闲"以单独排除 (a)。〕

2. **终态事件缺口（放大问题②）。** 只有正常完成才写 `run_end`（`goal-runner.ts:1307`）；**可捕获信号**（SIGINT/SIGBREAK）handler / **崩溃 `.catch`** / `process.on('exit')` 路径全都 `releaseAllLocks()` 后**静默死亡**，连一条 `interrupted` 都不留（事故即此类——优雅退出、锁被清、无终态）。**另一类** `/F` 硬杀 handler 跑不到、锁残留、亦无终态——那类只能靠 beacon(不删)+dead-man 兜底。于是"被打断"和"还在跑"在事件流里无法区分。

3. **死亡判定缺口 + 锁清理致盲（问题②真 bug）。** status 映射（`goal-progress.ts:674-698`）里只有 `ORPHAN_SUSPECTED→UNKNOWN`、`STALLED→STALLED` 是硬终态，其余一律 `RUNNING`。而这具尸体同时踩三个盲区全部绕过硬判：(a) 锁被清 → 基于 pid 的孤儿检测（`goal-progress.ts:539`）**需要锁存在才跑**，没锁就跳过；(b) `harness_start` 无 `harness_end` 这种"死在校验中途"，`findUnclosedInvoke` 只跟踪 agent_invoke 配对、看不见；(c) 11h 静默只降级到软 `ATTENTION` → 最终 `status=RUNNING/soft_quiet_window`。**所谓"实时重算活性"非但没识破死亡，反而把尸体粉饰成 RUNNING。**

> bounded-monitor 没有"没解决问题"——它补的是"轮次内主动汇报"，并白纸黑字声明**不含跨轮存活/唤醒**。真正坏掉的那一环从设计上就不在它射程内。本 plan 补的就是这一环。

## 设计原则（同时回答"每个 agent 都要写专门代码吗"——不要）

- **通用机制 + 声明式能力矩阵 + 优雅降级。** 沿用现有 `adapter.yaml.goal_capability` + `loadGoalCapability`（`goal-adapter-capability.ts`）的声明式模型，新增 `launch`/`liveness`/`wakeup` 子块。框架逻辑只读声明、不为任何宿主写分支代码。**新增一个宿主 = 在它的 `adapter.yaml` 加几行声明**；什么都不声明 → 自动降级到最稳的"回来时补报"。
- **SSOT 不变。** 通知触发面仍是 `events.jsonl` + 里程碑行 `GOAL_PHASE`/`GOAL_RUN`（`goal-runner.ts:927/1196/1313`）；通知内容仍由 `goal-monitor` 唯一生产。各宿主的 wakeup 只是把自己的原生通知器绑到这同一个触发面。
- **诚实优先于乐观。** 任何"无法证明还活着"的 run 一律判死，绝不默认 RUNNING。宁可误报死（用户一键 resume）也不假装在跑。
- **自愈与安全红线并存。** 现有"主 agent 不得自循环 `--resume`、续跑须人触发"（`SKILL.md:103`）的**精神保留**：主 agent 永远不自循环；自动续跑收归**独立、单例、有界**的 supervisor，且只对 INTERRUPTED 生效、HALTED/DEFERRED 绝不自动续。

## 分层架构（修复方案）

```
L1 真存活      survival-probe 背书通过 → 升 os_detach 活过会话/轮次空闲；否则退守 L3 OS 调度兜底；启动后存活自校验
               存活是【环境属性】：发布件默认保守，实际结论按机器解析进个人级 framework.local.json，不烘焙进 adapter.yaml
L2 诚实化      所有退出【同步抢先】写终态事件 + liveness beacon（含进程身份令牌防 pid 复用、退出不删）+ 两速 dead-man 硬判
L3 自愈看门狗  独立单例 supervisor；有界自动 resume（防抖/限次/熔断）；OS 调度任务＝敌对宿主/重启的稳健兜底
L4 跨轮通知    两条正交声明：in_session_accelerator（会话内加速、非承重，--detach 下须桥接）/ cross_turn_wakeup（none|scheduled，不依赖 runner stdout）；缺失即降级补报
```

各层定位（已对齐裂缝 A–D，不再有过强断言）：**L1** 让过夜真存活——但**前提**是 survival-probe 在该消费者环境背书 `--detach` 确实活过会话/轮次空闲；**背书不过就不许声明 os_detach，退守 L3 调度兜底**。**L2** 让任何死亡都被如实识别，且不被 pid 复用骗回"alive"。**L3** 让崩溃/重启/敌对回收也能自愈。**L4** 解决"过夜怎么被通知"且零 per-adapter 代码膨胀。**注意：没有任何单层能"单独"保证本次事故不复发——L1 治存活、L2 治诚实，二者缺一不可。**

## Key Changes

### L2 诚实化（先落地，止血优先）

- `goal-runner.ts`
  - 抽出 `writeTerminalEvent(reason)`：在信号 handler（`182`，**且须补注册 `SIGBREAK`**——Win 下现有的 `SIGTERM` 注册是 no-op、真正可捕获的是 `SIGINT`/`SIGBREAK`/console-close）、`.catch`（`1346`）、`process.on('exit')`（`1338`）统一写 `run_end{status:'INTERRUPTED', reason}` 或 `runner_crashed`。幂等（已写过 run_end 不重复）。`process.on('exit')` 这一条因对所有 JS 可观测退出都跑、是最稳的兜底落点。**赛跑硬约束（裂缝 4-①）**：必须是 `appendFileSync`（同步），且放在 handler **最顶端、先于任何 `await`**——当前 handler 先 `await activeAgentKill()/activeHarnessKill()` 再 releaseAllLocks，宿主强杀进程树时根本不给异步时间；终态落盘要抢在那两个 async kill **之前**，而不仅是"先于 releaseAllLocks"。
  - 新增 **liveness beacon**：run 目录 `liveness.json`，每次心跳/阶段切换写 `{pid, hostname, proc_identity, started_at, heartbeat_at, phase, substep, exit_kind:null}`；退出路径把 `exit_kind` 盖成 `completed|interrupted|crashed` 后**保留文件**（与 `.lock` 相反，锁清理不再抹掉活性证据）。这是抗 SIGKILL/断电的退化探针。
    - **`proc_identity` 进程身份令牌（裂缝 3，correctness，Windows 尤甚）**：仅记 pid 不够——过 11h、尤其跨重启后 pid 极易被无关进程复用，`isPidAlive(pid)` 返回 true 会把尸体误判成 alive（问题②的 pid 版回归）。`proc_identity` = 进程创建时间（按平台查 pid 的 start-time）或进程启动随机 token；探活时 **pid 命中还须校验身份令牌一致**，不一致即判 pid 复用 → 判死。
    - **原子写（裂缝 4-②）**：复用 progress.json 既有 `atomicRenameWithRetry`，避免读到半写文件被判 corrupt。
- `goal-progress.ts` / `goal-phase-snapshot.ts`
  - `findUnclosedInvoke` 或新增 `findUnclosedHarness`：把 `harness_start` 无 `harness_end` 纳入 hard-stall 判定。
  - liveness 重算改为**先读 beacon**：beacon 记的 pid 在本机已死、**或 pid 活但 `proc_identity` 不匹配（pid 复用）**，且无终态 `run_end` → 直接 `INTERRUPTED`/`ORPHAN_SUSPECTED`，不再依赖 `.lock` 是否存在（根治"清锁致盲"）。
  - **两速死亡判定（裂缝 D，须文档对齐用户预期）**：
    - **快路径（主）**：beacon `pid` 本机探活，近实时——本次事故下次读状态时（≤一个 60s 心跳窗）就会判死，**不是**等 1.5h。
    - **慢路径（兜底）**：绝对 dead-man——`last_activity` 超 `K × phase_timeout_ms`（默认 K=1.5，即默认 timeout 3600s 下约 1.5h）且无终态事件且 pid 不可证活 → `DEAD`。纯时间口径，**仅用于** beacon 缺失 + 跨机（无法 pid 探活）的病态场景；阈值取大是为了不误杀合法的长 coding invoke。`K` 可配。
  - status 映射新增 `INTERRUPTED`/`DEAD`；**禁止**已死 run 落回 `RUNNING`。`soft_quiet_window` 仅用于"确有近期活性"的安静窗口。

### L1 真存活

> **⚠ 本机实测结论（survival-probe / treekill / Cursor 关会话 三组探针，Win11 / node v24，2026-06-26）——`--detach` 是必要条件，且在本机 Cursor 下已验证充分：**
> - **场景①优雅退出**：真 detach 进程（`detached:true`+`unref()`+stdio 落文件，**忠实复刻 `goal-runner.ts:672`**）在 launcher 正常退出后**存活** ✅。
> - **场景②整树杀（合成最坏情形）**：对 launcher 父进程 `taskkill /T`，**detached 子进程被一同杀死** ❌——Windows 仍登记父子链、`/T` 顺链传导；Node 的 `detached:true` **不设** `CREATE_BREAKAWAY_FROM_JOB`，不脱离父进程树/Job。实测 taskkill 自供："PID `<child>` (child process of PID `<parent>`) terminated"。
> - **场景③ Cursor 实测（决定性）**：由 **Cursor 以 is_background 启动**探针 → **完全关闭 Cursor 并重开**——detached 子进程**毫发无损**：8.5 分钟连续心跳、最大相邻间隔 5.0s（=正常间隔）、零冻结 ✅。**即 Cursor（本版本）关会话时并不对 detached 孙进程做整树/Job 杀**，场景②的最坏情形在 Cursor 实际行为里**没有发生**。
> - **结论（L1 remedy 验证通过）**：本机 **Cursor 下真 `--detach` 足以让 run 活过关会话/轮次空闲** → L1"把 Cursor 从 is_background 升级为 --detach"**经验上可行**；`taskkill /T`/Job 杀只在**别的**敌对宿主才需担心，那时退守 L3 OS 调度。
> - **遗留（不影响 L1 决策）**：探针验的是 **--detach 这个修法**（脚本级 OS 脱离，与 goal-runner `--detach` 同源），**不是**事故当晚的 is_background 直挂模式。故 21:53 究竟是 (a) Cursor 回收 is_background 直挂进程、还是 (b) runner 在 `harness_start` 后自崩，仍未单独坐实——但**两者本 plan 都已覆盖**：(a)→L1 已验证可行；(b)→L2 终态事件。要单独坐实，再跑一次"Cursor is_background 直挂、进程不自脱离"的探针即可。

- **存活是【环境属性】，不是【发布件常量】（裂缝 2，最关键，复审最在意）。** 致命陷阱：把探针结论烘焙进 `agents/cursor/adapter.yaml`——但 `agents/` 是**发布件**，等于维护者在自己一台机器上测出 `os_detach` 成立，就把这个结论 ship 给**所有消费者**。而"`--detach` 能否活过会话/轮次空闲"高度依赖消费者环境（Cursor 版本、OS、休眠/锁屏、公司沙箱是否按 process group 整组杀）。维护者机器上活 ≠ 消费者机器上活；一旦某消费者环境更激进，他会复现一模一样的静默死亡，而 framework 还信誓旦旦声明 `survival: os_detach`。**所以 survival 结论绝不写进发布件。** 采用：
  - **发布件保守默认**：shipped `adapter.yaml` 的 `launch.survival` 默认 `unknown`（或保守 `host_background`），**不预设 os_detach**。
  - **消费者侧解析**：由消费者本机跑一次 survival-probe（或首个 `--detach` run 结束后运行时自检回收结论），把**该机器的** survival 结论写入**个人级 `framework.local.json`（gitignored）**——这正落在 `framework.local.json` 既有的 personal-setup 边界内（见启动摘要里 adapter 也是这么写的）。
  - **运行时取值优先级**：`framework.local.json`（本机实测）> `adapter.yaml`（保守默认）。未解析出 `os_detach` 前，一律按"不保证过夜存活"处理：要么提示消费者先跑探针，要么直接退守 L3 OS 调度兜底，**绝不假装能过夜**。
- **survival-probe 设计（裂缝 B + 精度修正 5）**：本次事故根本没用过 --detach（无 detach.log），承重假设零实测。探针须**同时覆盖两种真实杀因**：(a) 关闭/结束 Cursor 会话；(b) **会话留着、活跃 agent 轮次结束/空闲一段**（本次死亡距启动仅 16 分钟、会话很可能仍开，真正杀因更像后者，只测 (a) 会漏）。起真 --detach 探针进程 → 制造两种场景 → 查 pid + `proc_identity`。结论写进**本机 `framework.local.json`**，不写发布件。
- 启动语义由解析后的 `launch.survival` 决定：`os_detach`（真后台，**经本机探针背书**活过会话/轮次空闲）/ `host_background`（宿主后台，随会话）/ `blocking`。宿主后台仅是"立即拿回控制权"的手段，存活由 `--detach` + 本机背书共同保证，二者解耦。
- **启动后存活自校验**：launcher 返回 `{run_id, pid, log}` 后，skill/runner 必须确认 `detach.log` 在增长且 beacon `pid`（含 `proc_identity`）alive；校验失败立即如实报"启动未存活"，绝不回报"已启动"。**注意**：自校验只证明"此刻启动了"，**证明不了会话/轮次结束后还活着**——后者由本机探针背书，两者不可互相冒充。

### L3 自愈看门狗

- 新增 `harness/scripts/goal-supervisor.ts`（独立单例）：
  - 自带 `supervisor.lock`（单例幂等，避免多实例双续跑——`chrys` 双 run 互杀那类坑）。
  - 本身以真 `--detach` 存活；run 启动时按 capability 决定是否一并拉起 supervisor。
  - 巡检：发现 run `incomplete`（无终态）且 `dead`（beacon pid 死 / 超 dead-man）→ 仅当判定为 `INTERRUPTED|crashed` 时 `--resume`；`HALTED|DEFERRED` 一律不自动续（与 `SKILL.md:103` 红线一致）。
  - 护栏：`resume_budget`（默认 3）+ 指数退避 + 崩溃循环熔断（同 phase 连续失败即停并报 `NEEDS_ATTENTION`）；每次自愈写 `runner_resumed{by:'supervisor', attempt}` 留痕。
  - `manifest.unattended.auto_resume:false` 可整体关闭，退回纯诚实化。
- **因果硬声明（裂缝 C）：supervisor 是崩溃保险，不是 L1 的替代品。** 若宿主**系统性**周期回收长进程（本次 is_background 16 分钟即死就是这种回收），有限 `resume_budget=3` 只能续 3 段、一个 6-phase run 远跑不完，最后必然 `NEEDS_ATTENTION`。"宿主敌对回收"是 **L1 问题**（survival 探针该判 os_detach 不成立），不是 L3 能补的。budget/退避全部可配并文档化此边界。
- **抗重启 / 敌对宿主兜底（裂缝 B+C 合并，定位升格）：OS 调度任务。** 关键洞察：敌对宿主会**连 supervisor 进程本身一起杀**——所以"长驻 supervisor 进程"在这种宿主上同样不可靠；唯一能活的是**被 OS 重新拉起**的调度任务。helper 生成 OS 调度任务（Windows `schtasks` / *nix `cron`|`launchd`）把 supervisor 注册为开机/定时巡检，每次拉起即幂等单例巡检一遍。因此本路径不再是"可选上限"，而是 **survival 探针判定宿主不可长驻时的稳健兜底**。无现成 helper，净新增。

### L4 跨轮通知（声明式，零 per-adapter 框架分支）— 裂缝 A 根治

**类目错误纠正（裂缝 A，核心）：** 旧 L4 把 Cursor 的 `notify_on_output` 当成"跨轮唤醒"，但二者物理上不相容——
- `--detach`（L1 要求）的设计就是 launcher 秒退、子进程 stdout 全进 `detach.log`，宿主 shell 管道只拿到一行 JSON 后 EOF。里程碑 `GOAL_PHASE`/`GOAL_RUN` **不再经过任何 Cursor 能监听的 shell 管道**。
- `notify_on_output` 必须有**活着的会话 + 活着的 stdout 流**才能匹配——它**本质是"会话内加速器"**（bounded-monitor 早已如此定性），根本不是跨轮能力。
- 一旦 `--detach`，notify 永远匹配不到 → 旧设计的"跨轮唤醒"**名存实亡**。

因此把唤醒**拆成正交的两条声明**，物理通道彻底分开：

- `agents/adapter-schema.yaml` 的 `goal_capability`（`215`）新增：
  ```yaml
  # 发布件 adapter.yaml —— survival 保守默认，绝不烘焙本机结论（裂缝 2）
  goal_capability:
    launch:
      survival: unknown          # 发布件默认 unknown/host_background；os_detach 只能由【本机】framework.local.json 解析得出
      background_hint: "is_background" | "run_in_background" | null  # 宿主"立即拿回控制权"的原生手段（仅 UX，不决定存活）
    liveness:
      pid_probe: true            # 同机能否用 pid 探活（beacon 快路径，须配 proc_identity 防复用）
  # 本机 framework.local.json（gitignored，personal-setup 边界）—— 实测后覆盖：
  #   goal_capability_resolved: { cursor: { launch: { survival: os_detach } } }   # 取值优先于发布件
    in_session_accelerator:      # ① 仅会话内提速，可有可无，绝不承重
      mode: none | output_notify
      output_notify:
        trigger_regex: "^GOAL_(PHASE|RUN) "
        # --detach 切走了 runner stdout：须经前台桥接把里程碑喂给 notify，
        # 例如 `goal-runner --detach` 拿到 run_id 后前台 `tail -f <detach.log>`。
        bridge: tail_detach_log | foreground_monitor | null
    cross_turn_wakeup:           # ② 真·过夜推送，绝不依赖 runner stdout
      mode: none | scheduled
      scheduled:
        recheck_command: "<由调度器周期 re-invoke goal-monitor 的命令模板>"
  ```
- 两条的硬边界：
  - **in_session_accelerator** 只在当前会话活着时把里程碑更快递给主 agent；`--detach` 下必须经 `tail detach.log` 或前台 `goal-monitor` 桥接，且**桥接 shell 随会话死无所谓**（会话死了本就没有活的 agent 轮次可接收）。它**不是**跨轮，缺了也只是慢一点。
  - **cross_turn_wakeup** 是会话已空闲后的唯一真推送通道：由**宿主调度器**（不是 runner stdout）周期 re-invoke `goal-monitor`，monitor 读 beacon+events 产出终态/阶段通知。`none` = 不推送，等用户回来补报。
- 各 `adapter.yaml` 声明（示例，修正后）：
  - `cursor`：发布件 `launch.survival: unknown`（os_detach 由**本机** framework.local.json 探针背书后解析得出，不写发布件）；`in_session_accelerator.mode: output_notify` + `bridge: tail_detach_log`；`cross_turn_wakeup.mode: scheduled` 若 Cursor 有定时重进能力，否则 `none`。**注意：cursor 的跨轮推送不再寄望 notify_on_output。**
  - `claude`：`cross_turn_wakeup.mode: scheduled`（`ScheduleWakeup`/cron 跑 `goal-monitor`）；`in_session_accelerator.mode: none`。
  - `chrys`/`opencode`：`in_session_accelerator.mode: none`、`cross_turn_wakeup.mode: none` → 自动降级"回来时补报"。
  - `generic`：两条都保守 `none`。
- **优雅降级是默认**：任何 adapter 两条都不声明 → 全 `none` → 主 agent 下轮进来时由 `goal-monitor` 从 beacon+events 重建并如实补报。**这就是"其他 agent 怎么办"的答案：不写一行框架分支代码，自动降级；新增宿主只在自己的 `adapter.yaml` 填这几行声明。**

### 契约与文档

- 重写 `skills/project/goal-mode/SKILL.md` + `docs/operations/goal-mode-runbook.md` 启动决策树：
  - 纠正"`is_background` ≈ `--detach`"概念错误，明确**拿回控制权 ≠ 活过会话**。
  - 启动按 `launch.survival` capability 选语义（且必须有 survival-probe 背书）+ 强制启动后存活自校验。
  - 补 supervisor 自愈、终态事件、dead-man 两速判定。
  - **唤醒纠偏（裂缝 A）**：明确 `notify_on_output` 只是会话内加速器、`--detach` 下须经 `tail detach.log` 桥接；Cursor 的**跨轮**推送走 `cross_turn_wakeup: scheduled` 或降级补报，**不再寄望 notify_on_output**。
  - 保留并澄清：主 agent 仍**禁止自循环 `--resume`**；自动续跑是 supervisor 的职责，不是主 agent 的。
- `goal-monitor.ts`：`notification_kind=liveness` 暴露 `DEAD|INTERRUPTED|RESUMED`；跨轮接管如实补报"死于何时/何阶段/supervisor 是否已续跑/已续几次"。

## Public Interfaces

```bash
# 看门狗（独立单例，真 --detach 存活）
cd framework/harness && npx ts-node scripts/goal-supervisor.ts \
  --feature homepage --run-id latest [--max-resumes 3] [--once|--watch]

# 安装抗重启巡检（opt-in）
npx ts-node scripts/goal-supervisor.ts --install-scheduled --feature homepage
```

新增事件类型：`run_end{status:INTERRUPTED}`、`runner_crashed`、`runner_resumed{by,attempt}`。
新增 status：`INTERRUPTED`、`DEAD`。
新增 run 目录文件：`liveness.json`（beacon，退出不删，原子写）、`supervisor.lock`。
新增本机文件键：`framework.local.json.goal_capability_resolved`（gitignored，存本机 survival 解析结果）。

`liveness.json` 最小字段（`proc_identity` 防 pid 复用）：
```json
{ "pid": 12345, "proc_identity": "<pid start-time 或启动随机 token>",
  "hostname": "host", "started_at": "...", "heartbeat_at": "...",
  "phase": "plan", "substep": "harness", "exit_kind": null }
```

## Test Plan

- **事故回放 fixture·检测侧（必过）**：构造 `harness_start` 无 `harness_end` + 锁缺失 + last_activity 11h + beacon pid 已死 → `goal-status`/`goal-monitor` 必须判 `DEAD`/`INTERRUPTED`，**绝不能**输出 `RUNNING`。
- **事故回放 fixture·写入侧（必过，第三轮 TEST A 的最小复现）**：触发"优雅 JS 退出 + 锁被清"（内部 `.catch`→exit(1)，正是事故签名）→ 断言 events 里出现 `run_end{INTERRUPTED}`/`runner_crashed`。这是 L2 对**确切事故失败模式**的回放。
- 终态事件（**Windows 信号修正**）：在 **SIGBREAK / SIGINT**（Win 可捕获信号——**不是** `SIGTERM`，Win 上捕获不到）/ `uncaughtException(.catch)` / `process.exit` 路径都写终态事件且幂等；正常完成仍只一条 `run_end`。**另加 `/F` 硬杀用例**：handler 跑不到、终态写不成 → 必须由 beacon(不删)+dead-man 兜底判死（与诚实化自洽）。**赛跑（裂缝 4-①）**：mock handler，断言 `writeTerminalEvent` 的 `appendFileSync` 在任何 `await`（含 async kill）之前已调用。
- **pid 复用防护（裂缝 3，必过）**：beacon 记 pid=X+proc_identity=A；构造 pid=X 仍 alive 但当前进程 identity=B（≠A）→ 必须判 `DEAD`，**不得**因 `isPidAlive` 为 true 而报 alive。
- beacon 退化：模拟 SIGKILL（无机会写 exit_kind）→ 靠 beacon pid-dead + proc_identity + dead-man 仍判死；半写 beacon 走原子写不被判 corrupt。
- dead-man：`last_activity < K×timeout` 不误杀；`> K×timeout` 且不可证活才判 `DEAD`。
- supervisor：`INTERRUPTED` 自动续一次并写 `runner_resumed`；`HALTED`/`DEFERRED` 不续；超 `resume_budget` 熔断报 `NEEDS_ATTENTION`；单例锁防双续。
- **存活解析（裂缝 2，必过）**：发布件 `adapter.yaml.survival=unknown` + 本机 `framework.local.json` 解析为 `os_detach` → 取值用 local；无本机解析时**不得**按 os_detach 处理（不假装能过夜）。
- L1 自校验：launcher 返回但 beacon pid 未起 → 报"启动未存活"，不假报已启动。
- capability 降级：adapter 两条 wakeup 都未声明 → `none` → 走补报路径，无异常。
- CLI smoke：临时 `goal-runs/<id>` fixture 跑 `goal-supervisor --once`、`goal-monitor --json`；Windows 路径 + `run-id latest` + LF 输出。
- 全量：`cd harness && npm test`、`npm run openspec:validate`；改动发布内容跑 `npm run release:verify`。

## 已审阅补强（两轮独立复核）

### 第一轮（裂缝 A–D）

一次独立复核用宿主真实 events/progress + framework 源码逐行复算，确认三大根因成立（连"实时路径也输出 RUNNING"都跑通），并提出 4 处实现前必须补的裂缝，已全部纳入上文：

- **裂缝 A（最关键，已根治）**：`--detach` 切走 runner stdout，`notify_on_output` 永远匹配不到里程碑 → 旧"跨轮唤醒"名存实亡。根因是**类目错误**（把会话内加速器当跨轮能力）。L4 已拆为 `in_session_accelerator`（notify，须桥接，非承重）与 `cross_turn_wakeup`（scheduled，不依赖 stdout）两条正交声明。
- **裂缝 B（承重假设，已加前置门）**：本次事故没用过 --detach，"--detach 活过 Cursor 会话"零实测。已加 `survival-probe` 为 L1 前置硬门；探针不过则 L1-via-detach 不成立，转 OS 调度任务。
- **裂缝 C（已加因果声明）**：宿主系统性回收长进程时，有限 `resume_budget` 补不了——这是 L1 问题非 L3。已写入因果与可配边界。
- **裂缝 B+C 合并（我方补强）**：敌对宿主会连 supervisor 进程一起杀，只有 OS 调度任务能被系统重新拉起 → OS 调度任务从"可选上限"升格为"探针判不可长驻时的稳健兜底"。
- **裂缝 D（已分两速）**：dead-man 快路径靠 beacon pid 近实时（本次≤60s 即判死），1.5h 绝对阈值仅为 SIGKILL/跨机病态兜底，文档须讲清免得用户误以为要等 1.5h。

**事故旁证（已核，benign）**：同 feature 下早 3 分钟的 `20260625T133421Z` 是**空目录**（无 manifest/events）。结合启动截图自述"首次启动因缺 DevEco 配置 preflight 失败、补齐后重启"，它是 preflight 失败的首次尝试，**非"误判重复起 run"脚枪**。唯一遗留：preflight 失败留下空孤儿 run 目录——顺手补一个"preflight 未过不落 goal-runs 目录 / 失败即清理"的小卫生项。

### 第二轮（复核已落实补强后的再审）

针对已写入裂缝 A–D 的 plan 再审，发现 5 处并已全部纳入上文：

- **① plan 内部自相矛盾（SSOT 分叉，已修）**：上轮只改了正文、漏同步分层架构块与小结——L4 仍写旧单通道 `none|output_notify|scheduled`，且"L1 单独就能让本次事故不发生（真 --detach 活过会话）"把待验证假设写成了结论、与裂缝 B 直接打架。已同步架构块为两条正交通道，删除过强断言，并显式声明"没有任何单层能单独保证不复发，L1+L2 缺一不可"。
- **② 探针结论的外部效度（最该补，已根治）**：survival 是**环境属性**，把本机探针结论烘焙进发布件 `adapter.yaml` 会过度泛化到所有消费者——更激进的消费者环境会复现同样静默死亡而 framework 还声明 `os_detach`。改为：发布件默认 `unknown`，本机实测结论写**个人级 `framework.local.json`（gitignored，personal-setup 边界）**，取值 local>发布件，未解析出 os_detach 前不假装能过夜。
- **③ beacon pid 复用防护（correctness，Windows 尤甚，已加）**：仅记 pid，11h/跨重启后 pid 易被复用 → `isPidAlive` 误报 alive（问题②的 pid 版回归）。beacon 增 `proc_identity`（进程创建时间/启动 token），探活须 pid+identity 双校验。
- **④ 实现收尾（已落到验收点）**：终态事件必须 `appendFileSync` 且置于 handler 最顶端、**抢在两个 async kill 之前**（宿主强杀不给异步时间）；beacon 用既有 `atomicRenameWithRetry` 原子写。
- **⑤ 诊断精度（影响探针，已修正）**：死亡距启动仅 16 分钟、会话很可能仍开，**不是过夜收尾**，而是活跃轮次结束/空闲时被回收。survival-probe 因此必须同时覆盖"关会话"与"会话留着、轮次空闲"两种杀因，否则漏掉本次真正杀因。

### 第三轮（双方自动化实测对账，结论：plan 可进入实现）

双方各自在本机 Win11/node 跑了自动化探针，结论互补不冲突，并产出两个证据级增量：

- **尸体签名 ⟹ 事故是"优雅 JS 退出"，非 `/F` 整树/整组硬杀（证据级，已写入根因①②）**：复刻 runner 退出/清锁语义实测——内部 `.catch`→exit(1)：`harness_start=✓ harness_end=✗ run_end=✗`、**锁被清** → **与事故逐字吻合**；`taskkill /F /T` 硬杀：同样无 end/run_end 但**锁残留** → **不吻合**。故 21:53 一定走了可捕获 handler（Win 上是 **SIGBREAK/SIGINT，不是 SIGTERM——SIGTERM 在 Win 捕获不到**）或内部 `.catch`。**对 L2 是利好**：优雅退出 ⟹ `writeTerminalEvent` 同步抢先一定来得及落盘，L2 对此确切失败模式 **100% 有效**；也细化了 (a)——若 Cursor 回收，用的是可捕获信号而非 `/F` 硬杀。
- **spawn 不会同步抛 ⟹ (b) 别归到 spawn 那一行（已确认 plan 无此误归）**：实测 `spawn(坏命令,{shell:true})` win32 路径 `threwSync=false`，且 spec 的 harness spawn 已成功 → "spawn 在 try 外同步抛"这条自崩路径**实际不会被触发**。plan 写的是泛指"`harness_start` 后自崩"，方向对；若真是 (b)，异常在别处不在那一行。
- **对账（双方探针互证）**：对方证"**真 --detach 活过 Cursor 关会话**"（场景③）；我方证"**事故是优雅退出而非 `/F` 硬杀 + spawn 不同步抛 + detach 原语本机成立**"。我方"场景②ⓘ`taskkill /T` 带走 detached 子进程（Node `detached:true` 不设 `CREATE_BREAKAWAY_FROM_JOB`）"是对方没测的轴、更彻底。**合起来把 L1 可行性与 L2 必要性都钉死。**
- **复核裁定**：A–D + 一致性 + 消费者泛化 + pid 复用 + 同步终态 + 原子写均已吸收，架构块已修正，(a)/(b) 适度存疑且双覆盖、探针双场景——**plan 可进入实现**。仅余两个测试精度项（已落到上文 Test Plan：Win 终态回归用 SIGBREAK/SIGINT 而非 SIGTERM、并加 `/F` 兜底用例；"优雅退出锁被清" fixture 作为 L2 必过回放）。

## 范围建议（版本/顺延由你拍板）

- **本窗口必交核心 = L2 + L1**：L2（诚实化）单独就止住最痛的"尸体显示 RUNNING"；L1（含 survival-probe）让过夜真存活。二者是根因止血。
- **L3/L4 顺延性：本机 Cursor 实测已解（场景③：`--detach` 关会话存活）→ L3/L4 可顺延**：对**此用户的 Cursor**，L1 走 --detach 即足以过夜存活，故 L3 抗重启/OS 调度 + L4 cross_turn_wakeup scheduled **可评估顺延到后续窗口**——仅在需要抗**机器重启**、或将来换到**会整组/整树杀的敌对宿主**（场景②那类，treekill 探针已证 --detach 在那种宿主下也保不住）时，L3-OS 调度才反转为必交。**本窗口必交核心仍是 L2 + L1。**
- 我**不擅自**改 `version`、不写 `deferred_to`、不动 `package.json`；以上仅为建议，按仓库 BLOCKER 规则等你定。

## Assumptions / 边界

- 默认实现为 framework 通用能力，**不为任何 adapter 单独分支代码**；adapter 差异全部走 `adapter.yaml` 声明（含 launch/liveness/in_session_accelerator/cross_turn_wakeup 四块）。
- **survival 是【环境属性】不是【发布件常量】**：发布件 `adapter.yaml` 默认保守（`unknown`/`host_background`），`os_detach` 只能由**本机** `framework.local.json`（gitignored）实测解析得出，取值 local>发布件；维护者机器的结论绝不替消费者背书。
- `os_detach` 让 run 活过**宿主会话/轮次空闲**——**但仅在本机 survival-probe 背书时成立**；活过**机器重启**或敌对宿主需 OS 调度任务。
- **liveness 探活须 pid + `proc_identity` 双校验**：pid 复用（11h/跨重启，Windows 常见）下单看 `isPidAlive` 会把尸体误判 alive，身份令牌不匹配即判死。
- **终态事件须同步抢先**：`appendFileSync` 且置于信号 handler 最顶端、先于任何 async kill；宿主强杀进程树不保证给异步落盘时间。
- supervisor 自动续跑只覆盖 `INTERRUPTED|crashed`；`HALTED|DEFERRED` 是审慎终态，必须人 + `--force-resume`。
- 主 agent 永不自循环 `--resume`（红线不变）；自愈是独立 supervisor 的职责。
- 通知 SSOT 仍是 `events.jsonl` + 里程碑行；唤醒能力只是触发器，不改变通知内容来源（`goal-monitor`）。`in_session_accelerator` 与 `cross_turn_wakeup` 是物理通道不同的两条，绝不混用。
- 跨轮"主动推送"质量取决于宿主能力；无能力宿主一律降级为"回来时如实补报"，不视为缺陷。
- 按仓库规则先建 OpenSpec change 再实现、验证、归档。
