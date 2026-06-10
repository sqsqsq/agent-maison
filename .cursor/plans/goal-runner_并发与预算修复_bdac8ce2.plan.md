---
name: goal-runner 并发与预算修复
overview: 从根因（无头 agent 递归自起 goal-runner + 超时不杀进程树产生僵尸 + 锁粒度错误）切断 goal-runner 的 fork-bomb 式自繁殖，再叠加预算跨 resume 持久化、终态守卫、run-scoped 报告快照等纵深防御，杜绝重复并发与 token 失控。
version: 2.3.0
todos:
  - id: nested-guard
    content: "[P0] 递归防护：新增 isGoalHeadlessEnv()（仅 MAISON_GOAL_HEADLESS），goal-runner main() 入口 BLOCKER exit(1)；prompt 加两条禁令（禁起 goal-runner + 证据目录只读）"
    status: completed
  - id: tree-kill
    content: "[P0] 超时治理重写：异步 spawn + 进程树 tree-kill（win32 taskkill /T /F、POSIX kill(-pid)）；记录 kill_attempted/exit/error；SIGINT/SIGTERM handler 回收孤儿+释放锁"
    status: completed
  - id: feature-lock
    content: "[P0] feature 级原子锁：.feature.lock 用 openSync(wx)+ownerId+heartbeat（依赖 P0-2 异步化）；dry-run 也拿锁；run-id 锁降为内层"
    status: completed
  - id: budget-events
    content: "[P1] 预算跨 resume 持久化：拆 agent_invoke_start/end（duration_ms/timed_out/exit_code）按 start 计数；wall-clock 以首个 run_start 为基准；兼容旧 agent_invoke schema"
    status: completed
  - id: terminal-guard
    content: "[P1] 终态守卫（第二道防线）：DEFERRED/HALTED 后默认拒绝自动 resume（需 --force-resume+冷却）；SKILL 续跑改用户显式触发"
    status: completed
  - id: run-scoped-snapshots
    content: "[P1] report 快照：summary/script-report/merged-report/verifier.report/trace 复制到 goal-runs/<run-id>/phases/<phase>/harness/，goal-report 指向快照"
    status: completed
  - id: manifest-cli-policy
    content: "[P2] --manifest 与 --start/--end/--adapter/--requirement 混用不再静默忽略：报错或显式 --override-*"
    status: completed
  - id: agent-failure-policy
    content: "[P2] 门禁以产物为准：复用 stale_summary，harness PASS+fresh→advance+WARN、PASS+陈旧→不 advance（不看 agent exit）；--max-turns 调查 + 静默看门狗 + 报告文案"
    status: completed
  - id: tests
    content: "[P2] 单测覆盖递归防护、feature 锁、tree-kill、预算累计、终态守卫、manifest 策略、agent-failure；cd harness && npm test 全 PASS"
    status: completed
isProject: false
---

# goal-runner 并发与预算修复

> 本版整合 Codex 与 Claude Code 两份 review。**关键修订**：原 plan 把根因误判为「超时被杀 + 无并发锁 + halt→resume 循环」；实际病原体是 **无头 agent 递归自起 goal-runner（fork bomb）** + **超时只杀 shell、node 子树变僵尸** + **锁粒度错（per run-id 拦不住 fresh run）**。下面按「先杀病原体（P0）→ 再做纵深防御（P1/P2）」分级。

## 背景与证据（已核实）

排查对象工程 `D:\1.code\SimulatedWalletForHmos`（**只读，不改动**）；修复对象是框架本体 `d:\1.code\agent-maison`。

主 run `20260609T131225Z` 的 [events.jsonl](D:/1.code/SimulatedWalletForHmos/doc/features/bank-card/goal-runs/20260609T131225Z/events.jsonl) + 当天 11 个 run-id 暴露的事实：

- 单 run-id 内 **14 次 `run_end` + 多次 `resume`**、**同一秒成对 `agent_invoke`**、当天 **~283 次 agent_invoke**（远超 `max_total_turns: 36`），且有 10 个**全新 run-id 的 fresh run**（manifest 相同，都读 `goal-manifest.yaml`）。
- 多处相邻事件正好相隔整 **1 小时** → agent 撞 3600s timeout，但（见下）并未真正退出。

代码层已核实的根因（本版 plan 的立论基础）：

- **递归防护缺失**：[agent-invoke.ts:303](d:/1.code/agent-maison/harness/scripts/utils/agent-invoke.ts) 给所有无头子树注入 `MAISON_GOAL_HEADLESS=1`；[phase-state.ts:73](d:/1.code/agent-maison/harness/scripts/utils/phase-state.ts) 已有 `isGoalOrchestrationEnv()`，但 **goal-runner.ts 入口没用它做拦截** → 无头 phase agent 可自起 goal-runner（`--resume` / fresh / `--dry-run` / `--start testing`），形成 `goal-runner → agent → 僵尸 → 再起 goal-runner` 的自繁殖。
- **超时不杀进程树**：`spawnHeadless`（[agent-invoke.ts:295](d:/1.code/agent-maison/harness/scripts/utils/agent-invoke.ts)）用同步 `spawnSync`/`crossSpawn.sync`；Windows 下 timeout 只终止 `.cmd` 的 cmd.exe 壳，底层 `node index.js -p --force --trust` 子树存活（review 抓到 PID 30668 活 8 小时）。这些带全权限的僵尸 agent 才是后续自起 goal-runner、resume 风暴、`Emulator.exe -delete`/拉模拟器的**行为主体**。
- **锁粒度**：若锁定在 `goal-runs/<run-id>/`，拦不住 10 个 fresh run-id；必须 **per-feature** 主锁。
- **报告指向全局可被覆盖路径**：[goal-runner.ts:402](d:/1.code/agent-maison/harness/scripts/goal-runner.ts) 的 `summary_path` 来自全局 `featurePhaseReportsDir`，后续 run 覆盖后旧报告与现 summary 互相打架。

两个用户问题的诚实归因：

- **"coding 结束但后台还在跑/拉模拟器"**：`end_phase: testing` 后续跑 ut/testing 属设计内（仅文案易误读）；但**后台持续活动的真实主体是僵尸无头 agent**——harness 的 `probeDevices` 只读探测、本身不启动模拟器，可僵尸 agent 带 `--force --trust` 会自主跑 `hdc`/`Emulator.exe`。**递归防护 + 进程树回收后该现象自然消失**。
- **"~2 亿 token"**：证据目录无 token 计数，`200000` 是 `composer-2.5` 的 200K 上下文窗口规格（非消耗量），2 亿来自 Cursor 账号 Usage 全天汇总。真实巨耗 = 递归自繁殖产生的数百次满上下文调用 + 僵尸不退出持续重连烧 token。

## P0 — 切断病原体（必须，优先实施）

### P0-1 递归防护（最便宜、最高 ROI）

- 文件：[goal-runner.ts](d:/1.code/agent-maison/harness/scripts/goal-runner.ts) `main()` 入口；新增 `isGoalHeadlessEnv()`（[phase-state.ts](d:/1.code/agent-maison/harness/scripts/utils/phase-state.ts)）；`buildPhasePrompt`（phase prompt 生成）。
- **只拦 headless（采纳 Codex）**：`isGoalOrchestrationEnv()` 同时检查 `MAISON_GOAL_RUNNER`（runner 拉 harness 时给 `harness-runner` 的环境）与 `MAISON_GOAL_HEADLESS`，直接用它拦截可能误杀测试/嵌套脚本。**新增 `isGoalHeadlessEnv()` 仅检查 `MAISON_GOAL_HEADLESS=1`**，goal-runner 入口用它。
- `main()` 第一步：`if (isGoalHeadlessEnv() && !process.env.MAISON_GOAL_ALLOW_NESTED)` → 打印 BLOCKER 并 `process.exit(1)`。`MAISON_GOAL_ALLOW_NESTED` 仅供单测/内部显式放行。
- phase prompt 增加**两条**明文禁令（环境变量是物理层、prompt 是行为层，双层防护）：
  1. `Do NOT invoke goal-runner / --resume / --manifest; the orchestrator is already running.`
  2. `goal-runs/ 证据目录对 agent 只读：禁止写入 / 补写 events.jsonl 或任何 run 产物。`（根治僵尸 agent 手写伪造事件，见事实修正第 2 条）

### P0-2 异步 spawn + 进程树 tree-kill（重写原 plan「超时治理」）

- 文件：[agent-invoke.ts](d:/1.code/agent-maison/harness/scripts/utils/agent-invoke.ts) `spawnHeadless` / `invokeAgentHeadless`；同步调用点 [goal-runner.ts:349](d:/1.code/agent-maison/harness/scripts/goal-runner.ts)。
- `spawnSync` → 异步 `spawn`（`detached: true` on POSIX）并用 Promise 包成可等待；超时或清理时**杀整棵进程树**：
  - win32：`taskkill /PID <pid> /T /F`。
  - POSIX：`process.kill(-pid, 'SIGTERM')`，宽限后 `SIGKILL`。
- 记录 `timed_out` / `signal` / `exit_code`，**并把 tree-kill 本身的结果落盘**：`kill_attempted` / `kill_exit_code` / `kill_error`（采纳 Codex）——否则最坏情况仍不知子树是否真死。
- **goal-runner 自身被终止时的孤儿回收（采纳 Claude）**：注册 `SIGINT` / `SIGTERM`（及 win32 可捕获范围）handler → tree-kill 在飞的 agent 子树 → 释放 feature 锁 → 退出。残杀风险记录在案：Windows 下 `taskkill /F` 杀 goal-runner 本体时 JS handler 不执行，此时靠 P0-3「heartbeat 过期 + pid 不存活 → 陈旧锁接管」兜底，孤儿 agent 靠 P0-1 递归防护限制破坏力。
- **流式输出（采纳 Claude）**：异步 spawn 后将 agent stdout/stderr **流式**写入 `agent-output.log`（非结束后一次性写），消除现 `maxBuffer: 10MB` 截断风险，并为 P2-8 静默看门狗提供现成活动信号。
- 顺序约束：此项是 `--max-turns` 调查（P2）的前置——不先回收进程树，调小 timeout 只会**提高僵尸产生频率**；也是 P0-3 heartbeat 的前置（同步 `spawnSync` 会冻结事件循环，`setInterval` 刷不动）。

### P0-3 feature 级原子锁（run-id 锁降为内层）

- 文件：新增 `utils/goal-run-lock.ts`；接入 [goal-runner.ts](d:/1.code/agent-maison/harness/scripts/goal-runner.ts) `main()`（`run_start` 之前，`try/finally` 释放）。
- 主锁：`doc/features/<feature>/goal-runs/.feature.lock`，用 `fs.openSync(path, 'wx')` **原子创建**（避免 TOCTOU）。内容 `{ ownerId, pid, hostname, started_at, updated_at }`。
- **heartbeat 依赖 P0-2（采纳 Claude）**：P0-2 异步化后才能用 `setInterval` 刷 `updated_at`；P0-2 先行（推荐，反正同为 P0）。若临时降级，heartbeat 改"每个 phase 边界刷新一次"，且陈旧阈值必须 **> 单 phase 最大时长（3600s）**。
- **dry-run 也拿锁（采纳 Codex）**：默认 dry-run 同样获取 feature 锁，否则 dry-run 与 real-run 并发写 prompt/events/report 仍污染证据目录。
- 获取失败：现有锁 heartbeat 新鲜或 pid 存活 → BLOCKER `exit(1)`；陈旧（heartbeat 超阈值且 pid 不存活）→ 接管。
- 释放：仅当 `ownerId` 匹配才删除（避免 A 误删 B 的锁）。
- 内层补充：保留 `goal-runs/<run-id>/.runner.lock` 防同一 run-id 重复 resume。
- 边界澄清：feature 锁只约束**遵守锁协议的 goal-runner 实例**；对僵尸 agent 直接 `fs` 手写 events.jsonl **无物理约束力**。伪造事件的根治是 P0-1（递归防护消灭僵尸 + prompt 只读禁令），feature 锁不承担此职责。

## P1 — 纵深防御

### P1-4 预算跨 resume 持久化

- 文件：[goal-runner.ts](d:/1.code/agent-maison/harness/scripts/goal-runner.ts) 第 287 行 `totalTurns`、289 行 `startMs`、resume 分支（266–285）；[utils/goal-runner-phase.ts](d:/1.code/agent-maison/harness/scripts/utils/goal-runner-phase.ts)。
- 事件拆分：`agent_invoke` → `agent_invoke_start` + `agent_invoke_end`（含 `duration_ms` / `timed_out` / `signal` / `exit_code`）；预算**按 start 计数**（子进程卡 3600s 时也能看到「正在烧」）。
- `totalTurns` resume 时从 `events.jsonl` 累计历史 start 数为起点；wall-clock 以**首个 `run_start`** 为基准计算 elapsed。
- 新增 `resolveResumedBudget(events)`。
- **旧 schema 兼容（采纳 Claude）**：`resolveResumeFromEvents` 与 `resolveResumedBudget` 必须同时认旧 `agent_invoke` 与新 `agent_invoke_start/end`，否则对已存在 run 目录（如当前这 11 个）resume 时进度/预算判定失真。验收加「旧 events fixture 可被新 parser 正确恢复」。

### P1-5 终态守卫 + 冷却（第二道防线）

- 文件：[goal-runner.ts](d:/1.code/agent-maison/harness/scripts/goal-runner.ts) resume 分支；[skills/project/goal-mode/SKILL.md](d:/1.code/agent-maison/skills/project/goal-mode/SKILL.md) §续跑。
- resume 判据**明确口径（采纳 Codex，第一版保守不自动猜"已消除"）**：默认只要最近 `goal-report.status ∈ {HALTED, DEFERRED}` 就拒绝 `--resume`；放行仅两条——① 显式 `--force-resume`；② 检测到对应 phase 的 run-scoped/全局 `summary` mtime **晚于上次 `run_end`** 且阻塞 `classification` 已变化。叠加冷却（距上次 `run_end` < N 分钟拒绝）。
- SKILL 明确：主 agent **读报告后停下汇报**，续跑必须由**用户**显式触发，禁止主 agent 自循环 resume。
- 定位：递归防护（P0-1）生效后这条压力大减，作为兜底纵深防御保留。

### P1-6 run-scoped 报告快照（修报告与现状打架）

- 文件：[goal-runner.ts](d:/1.code/agent-maison/harness/scripts/goal-runner.ts)（phase 收尾处）；[utils/goal-report-generator.ts](d:/1.code/agent-maison/harness/scripts/utils/goal-report-generator.ts)。
- 每个 phase 通过后，把以下文件复制到 `goal-runs/<run-id>/phases/<phase>/harness/`（**逐项枚举，采纳 Codex**）：`summary.json`、`script-report.json`、`merged-report.md`、`verifier.report.md`、`trace.json`。
- 缺失文件**不写输入契约 `manifest`**（采纳 Codex）：记录到 `goal-report.json` 的 `snapshot_files` 字段（或同目录 `snapshot-manifest.json`），输入与运行期证据分工干净。
- `goal-report` 的 `summary_path` 指向该**快照**，不再指向会被后续 run 覆盖的全局 `<phase>/reports/`（11 个 run 互相覆盖 `<phase>/reports/` 正是旧报告与现状打架的原因之一）。

## P2 — 策略与可观测性收尾

### P2-7 manifest / CLI override 策略（不再静默忽略）

- 文件：[goal-runner.ts](d:/1.code/agent-maison/harness/scripts/goal-runner.ts) argv 解析（172–232）。
- `--manifest` 与 `--start/--end/--adapter/--requirement` 混用时：非显式 override 模式直接报错，或新增 `--override-start/--override-end`，杜绝「想从 testing 续跑实际从 prd 起跑」。

### P2-8 门禁以产物为准（采纳 Claude，**改写**）+ 超时收尾 + 文案

- 文件：[goal-runner.ts](d:/1.code/agent-maison/harness/scripts/goal-runner.ts) verdict 判定（369–396）、[utils/goal-runner-phase.ts](d:/1.code/agent-maison/harness/scripts/utils/goal-runner-phase.ts) `resolvePhaseHarnessVerdict`；[skills/feature/coding/SKILL.md](d:/1.code/agent-maison/skills/feature/coding/SKILL.md)；[utils/goal-report-generator.ts](d:/1.code/agent-maison/harness/scripts/utils/goal-report-generator.ts)。
- **关键修订**：对 cursor adapter，"agent 进程非零退出/超时"是**常态**（昨晚 prd/design 等正常 PASS 阶段的 agent-output.log 结尾都是 `Connection lost, reconnecting`；P0-2 tree-kill 后这些会被统记 `timed_out`）。若按"agent_failed 默认不 advance"会让**每个 phase 进入 PASS→不 advance→retry→再烧一轮**的死循环——正是本 plan 要消灭的浪费。因此**废弃**原 P2-8 / Codex 白名单方案。
- 门禁判据复用框架既有 `stale_summary`（summary mtime 新鲜度），**不看 agent exit**：
  - harness `PASS` 且 summary 为**本次新产物** → `advance` + WARN（`goal-report` 记录 agent `exit` / `timed_out`）。
  - harness `PASS` 但 summary **陈旧**（agent 没干活、吃老本） → **不 advance**。
  - agent 进程状态只做**可观测性记录**，不做门禁——与框架"以产物为门禁"哲学一致。
- `--max-turns` 调查：先 `cursor-agent --help` 验证标志，支持则注入 `unattended.max_turns`；并加「stdout 静默 N 分钟 → 提前 tree-kill」的静默看门狗（建立在 P0-2 之上）。
- 文案澄清：coding 输出改「coding **阶段**完成，goal 仍将继续 review→ut→testing」；`goal-report` 非 COMPLETED 终态加「报告生成 ≠ 所有子进程已退出/goal 已完成」。

### P2-9 单测覆盖

- 文件：`harness/tests/unit/`（扩展 `goal-runner-phase.unit.test.ts`，新增 lock / nested-guard / tree-kill / budget-events 用例）。
- 覆盖：递归防护 BLOCKER 退出、feature 锁（原子创建 / 活锁拒绝 / 陈旧接管 / owner 释放）、tree-kill 回收、预算跨 resume 累计、终态守卫、manifest 混用报错、**门禁以产物为准（agent exit 非零但 fresh PASS → advance + WARN；stale summary → 不 advance）**。

## 验收

- `cd harness && npm test` 全 PASS（AGENTS.md BLOCKER）。
- 以 SimulatedWallet 旧 events 为 fixture（拷入 harness/tests，**不改原工程**）回归：注入 `MAISON_GOAL_HEADLESS=1` 时 goal-runner 立即 BLOCKER 退出；feature 锁使「同一 feature 多实例 / 多 fresh run-id」不再可能；超时路径产生 `timed_out` + `kill_attempted` 且进程树被回收；**旧 `agent_invoke` events fixture 可被新 parser 正确恢复进度/预算**；harness PASS + 陈旧 summary 时不 advance。
- 不改动 `D:\1.code\SimulatedWalletForHmos` 任何文件。

## 事实层小修正（记录在案）

- 模拟器/`Emulator.exe -delete` 是**僵尸无头 agent（--force --trust）**在 testing 阶段自主执行，非 framework 主动启动；P0-1 + P0-2 落地后自然消失。
- `events.jsonl` 中整秒时间戳、`command: cursor-agent (goal run phase)` 的伪造事件，是僵尸 agent 直接用 `fs` 手写「补记录」。**feature 锁对其无物理约束力**（agent 不读锁）；真正根治靠 P0-1（递归防护消灭僵尸 + prompt「证据目录只读」禁令）。

## 优先级速查

- **P0（先做）**：P0-1 递归防护 · P0-2 tree-kill · P0-3 feature 锁
- **P1**：P1-4 预算持久化 · P1-5 终态守卫 · P1-6 报告快照
- **P2**：P2-7 manifest 策略 · P2-8 agent-failure/超时/文案 · P2-9 单测
