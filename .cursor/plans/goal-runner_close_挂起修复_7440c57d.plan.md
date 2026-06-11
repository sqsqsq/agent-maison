---
name: goal-runner close 挂起修复
overview: 修复 goal-runner 在 coding 等阶段「agent 已退出但 orchestrator 永久挂起」的根因——子进程等待只监听 close 事件，被某个继承了 cursor-agent stdio 管道并存活的进程无限阻塞。核心改为持有者无关的 exit 为准 + 有界 grace + 销毁读流强制 resolve；并补 resume 半完成恢复、lock 死 pid 同机快速接管、真实子进程回归测试。绑定在研版本 2.3.0（patch）。已于 2026-06-10 实施完成（cd harness && npm test 718/718 PASS）。
version: 2.3.0
todos:
  - id: await-settled
    content: agent-invoke.ts 抽出 awaitChildSettled：以 exit 为进程终止真值 + grace 等 close；grace 超时则 destroy stdout/stderr 读流并强制 resolve（持有者无关的硬保障）。killProcessTree 仅用于仍存活进程（timeout/silent），exit 路径不再 kill 死 pid。exit code 可能为 null（被信号杀）→ settled 保留 signal 兜底，不把 exitCode 默认成 0
    status: completed
  - id: timeout-silent-resolve
    content: timeout / silent kill 触发 killProcessTree 后走同一 settled 收尾；并补 hard deadline forceSettleAfterKillMs——kill 失败/权限/pid 异常且 exit 事件不来时，到点 destroy 读流 + 强制 resolve，保证任何路径都不永挂
    status: completed
  - id: harness-phase
    content: goal-runner.ts runHarnessPhase 复用同一 settled 语义，替换只挂 close 的等待（line 240）
    status: completed
  - id: observability
    content: AgentInvokeResult 增 lingering_pipe；agent_invoke_end 透传；exit 路径不产生 dead-pid taskkill 的 kill_error 噪声
    status: completed
  - id: resume-halfphase
    content: resume 半完成恢复——events 末尾未闭合 agent_invoke_start(P) 且 P 的 fresh summary.json(mtime 晚于该 agent_invoke_start.ts)=PASS + 同次 receipt 闭合时，合成 advance outcome 从下一 phase（review）起；由编排器追加 phase_verdict(action=advance, recovered=true) 补偿留痕（方式 B），幂等（已有 terminal verdict 或已 recovered 不重复写），并可加 agent_invoke_recovered 标记事件
    status: completed
  - id: lock-stale
    content: goal-run-lock.ts isLockStale——record.hostname===os.hostname() 且 !isPidAlive(pid) 时立即判 stale（防 pid 复用：同机才信任 pid）；跨 host 仍走 90min/TTL 兜底
    status: completed
  - id: tests
    content: 单测+集成——(a) fake child 只发 exit 不发 close → grace 内 resolve；(b) 真实子进程：父打印后退出且拉起孙进程 spawn(...,{stdio:'inherit',detached:true})+unref()，先断言孙进程在 grace 窗口内存活（心跳文件）再验证 helper exit+grace 后 resolve、不永挂（防 Job Object 连带杀导致假通过）；(c) timeout/kill-fail hard deadline→resolve；(d) resume 半完成恢复→startIndex 指向 review；(e) 同机死 pid 锁立即 stale、异机死 pid 非 stale。cd harness && npm test 全 PASS + release:verify
    status: completed
  - id: daemon-hygiene
    content: （可选/P3，独立卫生项，非本挂起根因）goal headless 下 hvigor 收尾 --stop-daemon / 强制 --no-daemon，纳入与 hdc daemon 同型治理，减少常驻 daemon 累积；明确标注与管道挂起无因果
    status: completed
isProject: false
---

# goal-runner `close` 事件挂起修复（持有者无关：exit 为准 + grace + 销毁读流强制 resolve）

> 版本绑定：`package.json.version = 2.3.0`；patch 级（线上挂死 bug）。
> 本版整合 Codex / Claude 两份 review，并据实测证据修正了「管道持有者」的归因。

## 根因（实测确认 + 归因修正）

`spawnHeadlessAsync` 的等待 Promise 只监听 `'close'`（[agent-invoke.ts:511](harness/scripts/utils/agent-invoke.ts)）。Node 语义：`'close'` 要等进程终止**且其 stdio 管道全部关闭**才触发；只要有别的进程继承并持有这对管道，`'close'` 永不触发。cursor-agent（`cursor-agent.cmd`→`cmd.exe`→`node`，stdio=`['ignore','pipe','pipe']`）退出后，仍有进程握着这对管道写端 → 父侧读流永不 EOF → `await` 永挂 → `agent_invoke_end` 永不写 → review/ut/testing 永不启动。1 小时超时的 `killTree(pid)` 因持有者已脱离 pid 子树而抓不到，也救不回。

证据：coding `agent-output.log` 16:59 写完、`summary.json`=PASS（receipt 已闭合）、进程表无 cursor-agent、goal-runner 无子进程，但 `events.jsonl` 冻在 16:53 的 coding `agent_invoke_start`，心跳挂到 17:55（已过 17:53 超时点）。

### 管道持有者归因（修正 Claude review）

经核验，**框架自身的两个常驻 daemon 的 stdio 都是隔离的，均非 goal-runner↔cursor-agent 管道的持有者**：

- **hvigor daemon**：编译用 `spawnSync(..., { stdio: ['ignore', logFd, logFd] })`（[hvigor-runner.ts:1273-1286](profiles/hmos-app/harness/hvigor-runner.ts)）→ daemon 继承的是 `hvigor-build.log` 的 fd，不是 goal-runner 管道。故"hvigor `--daemon` 持有管道"在证据上不成立，强制 `--no-daemon` **不能**修复本挂起。
- **hdc daemon**（实测 pid 33176，`-m` server，仍存活）：`buildHdcSpawnOptions` 不设 stdio（[hdc-runner.ts:82-95](profiles/hmos-app/harness/hdc-runner.ts)）→ `spawnSync` 默认自建 pipe；daemon 继承的是 hdc client 的 spawnSync pipe，非 goal-runner 管道。

→ 最可能的持有者是 **cursor-agent CLI 自身拉起的内部后台进程**（框架不可控）。**结论：修复必须做成"持有者无关"，不能依赖识别或杀死持有者。** 这也是本 plan 的核心设计。

**实验背书（Claude 受控复现）**：用 goal-runner 同款 `['ignore','pipe','pipe']` spawn child，child 以不同形态拉孙进程后退出，对照 exit vs close：
- 非 detached（任意 stdio）→ 孙进程被 libuv Job Object 随父击杀，`close` 立即触发；
- detached + stdio 重定向 logFd（= hvigor daemon 形态）→ 孙进程存活，`close` **仍立即**触发；
- **detached + `stdio:'inherit'`（= 后台辅助进程形态）→ 孙进程存活，`close` 永不触发**（完整复现事故：exit ~49ms 正常，close 干等到超时）。

→ 实验级确认：① hvigor 归因不成立（logFd 重定向 + node 路径 `uv_disable_stdio_inheritance()` 堵隐式句柄泄漏）；② 持有者只能是 detached+inherit 形态进程；③「exit 为准 + grace + destroy 读流 + 强制 resolve」对该形态充分有效。

## 设计原则

- **以 `'exit'` 为进程终止真值**（不受继承管道影响），`'close'` 仅尽量 flush 完整 stdio。
- **销毁读流 + 强制 resolve 是硬保障**：`'exit'` 后给 `'close'` 有界 grace（默认 ~3s）；超时则 `child.stdout?.destroy()` / `child.stderr?.destroy()` 释放父侧句柄并强制 resolve。**不依赖杀死持有者**。
- **kill 仅 best-effort 且只针对存活进程**：`killProcessTree(pid)` 只在 timeout/silent（进程仍活）时调用；`'exit'` 路径下 pid 已死，不再 `taskkill`（避免 no-op + `kill_error` 噪声）。

## 改造点

### 1. `spawnHeadlessAsync` 等待逻辑（主修复，持有者无关）

文件 [harness/scripts/utils/agent-invoke.ts](harness/scripts/utils/agent-invoke.ts) L511–518，抽出可测的 `awaitChildSettled(child, { graceMs })`：

- `child.on('exit', (code, sig))`：记录 `exitCode`/`signal`，启动 grace 定时器。
- `child.on('close', …)`：清 grace、resolve（理想路径，stdio 已完整 flush）。
- grace 超时（`'exit'` 后 `'close'` 未到）：**先 `await outputStream.end()`（保留现 [agent-invoke.ts:524-526](harness/scripts/utils/agent-invoke.ts) 的日志落盘收尾顺序，重构勿丢）** → `child.stdout?.destroy()` / `child.stderr?.destroy()` → resolve，并置 `lingering_pipe: true`。**此路径不调用 killProcessTree**（pid 已死）。
- `child.on('error', …)`：resolve。
- **`exitCode` 类型不扩散（采纳 Codex 终审）**：`AgentInvokeResult.exitCode` 保持 `number`；Node `exit` 的 `code===null`（被信号杀）时归一化为非 0（如 `1`）并另存 `signal`，**不**把 `exitCode` 改成 `number | null`，避免 [goal-runner.ts:571](harness/scripts/goal-runner.ts) 与 `resolvePhaseHarnessVerdict` 整条链连锁修改。

### 2. timeout / silent 收尾保证 resolve（含 hard deadline 兜底）

- `timeoutTimer` / `silentTimer` 触发 `killTree(pid)`（此时进程仍活，kill 有意义）后，经由同一 `awaitChildSettled` 收尾（exit→grace→destroy）保证 resolve，**不再继续干等 `'close'`**。
- **hard deadline（采纳 Codex）**：`killProcessTree` 后 race 一个 `forceSettleAfterKillMs`。若 `taskkill` 失败 / 权限不足 / pid 异常、且连 `'exit'` 都不来，到点直接 `destroy` 读流 + 强制 resolve。**保证任何分支（正常退出 / 超时 / kill 失败）都有终结路径，无永挂可能**。

### 3. `runHarnessPhase` 同源修复

文件 [harness/scripts/goal-runner.ts](harness/scripts/goal-runner.ts) L220–242：harness-runner 链路同样只挂 `'close'`，复用改造点 1 的 settled helper（同样隐患：若 harness 自身拉起继承管道的常驻进程会挂死）。

### 4. result / event 可观测字段

`AgentInvokeResult` 增 `lingering_pipe?: boolean`；`agent_invoke_end` 透传。exit 路径不写出误导性 `kill_error`。不改既有字段语义。

### 5. resume 半完成 phase 恢复（[P1]，修复当前卡住 run）

文件 [harness/scripts/utils/goal-runner-phase.ts](harness/scripts/utils/goal-runner-phase.ts) `rebuildOutcomesFromEvents`（L194，当前**只认 `phase_verdict`**）：

- 现状 bug：当前 run 无 coding 的 `phase_verdict`（只有未闭合的 `agent_invoke_start`）→ resume 认定只完成到 design → **重进 coding 而非 review**（实测确认）。
- 恢复策略：events 末尾存在未闭合 `agent_invoke_start(phase=P)`，且 **P 的 fresh `summary.json` verdict=PASS 且 receipt 已闭合**时，为 P 合成 `advance` outcome，使 `resolveResumeState` 从 P 的下一 phase 起。
- **「fresh summary」严格判定（采纳 Codex）**：`summary.json` 的 `mtime` 必须**晚于该 phase 未闭合 `agent_invoke_start` 的 `ts`**，且 `receipt_status: passed` / `closure_status: closed` 来自**同一次** phase run（与该 summary 同源）。否则会误吃上一次旧的 PASS summary，把这次失败的半完成 phase 错跳过。
- **补偿留痕（已定：方式 B）**：除内存合成 outcome 外，由 **goal-runner 编排器自身**在 resume 时向 `events.jsonl` 追加一条 `phase_verdict(phase=P, verdict=PASS, action=advance, recovered=true)`：
  - `recovered:true` 标记区别于实时写入的正常 verdict，保证 events 自洽、可审计，且后续 resume 直接读到、无需反复推断。
  - **幂等（采纳 Codex）**：若该 phase 已存在 terminal `phase_verdict`、或已追加过 `recovered:true`，**不重复写**。
  - 可选增强：同时追加一条显式 `agent_invoke_recovered` 标记事件（比伪造 `agent_invoke_end` 更干净、审计更清楚；方式 B 本就不伪造 `agent_invoke_end`）。
  - 写入主体是编排器（非 agent），与「goal-runs 证据目录对 **agent** 只读、禁僵尸 agent 补写」原则不冲突——后者防的是无头 agent 伪造事件。
  - 补偿事件应在重建 outcome **之前**追加（顺序：探测半完成 → 幂等检查 → 追加 recovered verdict → `loadEventsJsonl` 重建 → `resolveResumeState`），使重建逻辑无需特判、直接吃到这条 verdict。
- 设计决策：半完成 PASS 恢复**不**强制 `--force-resume`，正常续行即可。

### 6. lock 死 pid 同机快速接管（[P2]）

文件 [harness/scripts/utils/goal-run-lock.ts](harness/scripts/utils/goal-run-lock.ts) `isLockStale`（L46，当前需 `age>90min 且 pid 死`）：

- 增补：`record.hostname === os.hostname() && !isPidAlive(record.pid)` → **立即判 stale**（同机才信任本机 pid 判活，规避 pid 复用误判）。
- 跨 host（`hostname` 不同）仍走 90min/TTL 兜底（无法跨机判活）。
- **`isPidAlive` EPERM 语义勿回归（采纳 Claude 终审）**：`process.kill(pid,0)` 抛 **EPERM = 存活**（仅无权限），**ESRCH 才算死**。现 [goal-run-lock.ts:25-34](harness/scripts/utils/goal-run-lock.ts) 已正确（`EPERM → true`）；本改造点依赖它判活，改动时务必保持，否则会把活锁误判 stale。

### 7. 单测 + 集成测试（[P1] 强化）

[harness/tests/unit/goal-runner-hardening.unit.test.ts](harness/tests/unit/goal-runner-hardening.unit.test.ts) 或新建：

- (a) `EventEmitter` 假 child：只发 `'exit'` 不发 `'close'` → `awaitChildSettled` 在 grace 内 resolve、保留 signal、标记 `lingering_pipe`；不断言 kill 释放管道。
- (b) **真实子进程集成（防假通过，采纳 Claude 实验结论）**：父进程打印后退出，**且拉起孙进程 `spawn(..., { stdio: 'inherit', detached: true })` + `unref()`**——必须 `detached:true`，否则 Windows 把非 detached 子进程放进 kill-on-job-close 的 Job Object，父一退孙进程被连带杀、管道立即关闭、`close` 立即触发 → 测试不构造任何挂起就假通过。**先断言孙进程在 grace 窗口内确实存活（如心跳文件 / pid 探活）**，再验证 helper 在 `exit + grace` 后 resolve、且**不永等 `close`**。
- (c) timeout kill → resolve；并加 **kill 失败 / 无 `'exit'`** 分支 → `forceSettleAfterKillMs` hard deadline resolve。
- (d) resume 半完成恢复：构造无 `phase_verdict`、但有 fresh PASS summary（mtime 晚于 `agent_invoke_start.ts`）+ 未闭合 `agent_invoke_start` 的 fixture → startIndex 指向 review；并验证补偿 verdict 幂等（重复调用不重复写）。
- (e) 同机死 pid 锁 → `isLockStale` = true；异机死 pid → 仍非 stale（除非超 TTL）。

验收：`cd harness && npm test` 全 PASS；`npm run release:verify` 通过。

## 当前卡住 run 的恢复 + 验收（操作）

- **修复落在 agent-maison，但 wallet 跑的是其 framework 拷贝**（`D:\1.code\SimulatedWalletForHmos\framework`）。**resume 前必须先把修复同步/发布到该拷贝**，否则仍跑旧代码、review/ut/testing 照样挂。建议以"同步 wallet framework + 实际 resume 跑通"作为写盘验收，比单测更贴近真实。
- `.feature.lock` 的 pid 20224 已死、已过 90min → resume 可自动清锁。
- 续跑（应从 review 起，依赖改造点 5）：
  `cd D:\1.code\SimulatedWalletForHmos\framework\harness && npx ts-node scripts/goal-runner.ts --resume 20260610T084004Z --feature bc-openCard`
- 孤儿 `hdc.exe`（pid 33176）清理：**已知非根因，移出主流程**——仅在**人工确认其命令行 / 父子关系确属残留**后可选清理，避免误杀当前正在用的 hdc server。

## 不在本次范围 / 独立项

- 不改 phase 裁决/预算/递归防护语义。
- 不深挖 cursor-agent 内部为何起后台进程（外部 CLI 行为；框架侧以持有者无关修复兜住）。
- 改造点 8（daemon 卫生，可选/P3）：goal headless 下 hvigor 收尾 `--stop-daemon` / 强制 `--no-daemon`（[hvigor-runner.ts:1462 stopHvigorDaemon](profiles/hmos-app/harness/hvigor-runner.ts) 已有现成函数），纳入与 hdc daemon 同型治理。**明确：这是减少常驻 daemon 累积的卫生项，与本次管道挂起无因果**，不作为根因修复。
