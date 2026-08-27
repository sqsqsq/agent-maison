# Design — agent containment and takeover（plan c6a9e4d2 t2/t3）

## 1. Guardian 进程协议

`agent-guardian.ps1`（PowerShell P/Invoke 先行方案；实测通过顺序见 §5）参数：

| 参数 | 说明 |
|------|------|
| `-RunnerPid` | runner（goal-runner）pid——guardian 同时等待 runner 与 agent |
| `-Token` | `run_id/invoke_id`，**明文进 argv**（t3 身份四元组第四槽位核验面） |
| `-AgentJson` | `Base64(UTF-16LE(JSON))`：`{argv, cwd}`（prompt 走 stdin 继承，不进命令行） |

### 1.1 时序（无 spawn→assign 竞态）

```
CreateJobObjectW
  → SetInformationJobObject(JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
  → CreateProcessW(CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
                   lpApplicationName=绝对路径, bInheritHandles=TRUE, 继承 stdio 句柄)
  → AssignProcessToJobObject(job, hProcess)   // 失败 → TerminateProcess 挂起进程 + exit 2
  → ResumeThread(hThread)                      // 此刻 agent 已是 Job 成员
  → OpenProcess(SYNCHRONIZE, RunnerPid) + WaitForMultipleObjects(2, handles, INFINITE)
```

- runner 先消失 → `TerminateJobObject` → guardian exit 3；
- agent 先退出 → 透传 agent exit code 退出（Job 关→KILL 残余后代→管道 EOF→runner close）；
- guardian 失败路径 exit code：1=参数/解码；2=containment 建立失败（agent 未放行）；
  3=runner 消失；0/其它=agent 退出码透传（0 唯一成功语义，无需在 runner 区分主体）。

### 1.2 句柄所有权（冻结）

- Job handle 只存在于 guardian 进程；runner/agent 从未获得（无句柄复制）。
- guardian 退出 = 最后句柄关闭 = KILL_ON_JOB_CLOSE 生效（团灭含 breakaway 拒绝的全部后代）。
- agent stdout/stderr/stdin 经 `STARTF_USESTDHANDLES` 继承 guardian 的 stdio 句柄；
  runner 侧消费管道零改动；guardian 成功路径零输出（写 stderr 前缀 `[maison-guardian]` 仅限失败路径）。

### 1.3 平台实测校准（2026-08-18 本机）

- 无路径 appname 的 CreateProcessW 在本机宿主安全面下被拦截（ERROR_PATH_NOT_FOUND /
  ERROR_INVALID_PARAMETER）——guardian 一律把 binary（含 cmd.exe）解析为**绝对路径**
  （`where.exe` 解析；shim 经 `SystemDirectory\cmd.exe /D /S /C` 包裹）。
- PowerShell 5.1 把 uint P/Invoke 返回值映射为 Int32（0xFFFFFFFF→-1），直接比较会抛
  InvalidCastException——ResumeThread/WaitForMultipleObjects 以语义化封装（bool/int）暴露。
- `.ps1` 必须以 **UTF-8 with BOM** 保存（PS 5.1 无 BOM 按 ANSI 解析中文注释会错乱）。

## 2. Node 侧接线

`agent-invoke.ts: spawnHeadlessChild`：

- `opts.containment` 非空且 win32 → spawn `powershell.exe -File agent-guardian.ps1 …`；
  child.pid 即 **guardian** pid；kill(killProcessTree) 杀 guardian = 整树团灭（语义兼容）。
- containment 结构性不可用（powershell/脚本缺失）→ 立即失败桩（spawn-error 同构），
  绝不绕过 containment 放行。
- 非 win32 / 无 containment / dry-run：既有 spawn 路径零变化（另补 `windowsHide:true`）。

`goal-runner.ts`：

- 每次真实 invoke（win32 && !dryRun）传 `containment: {runId, invokeId}`；
- `onActiveChild` 同步取 guardian 身份（`defaultProcessProbe().identify(pid)`）→
  身份不可得/命令行缺 token → **立即团灭本次 invoke** + `guardianBoundError` 覆盖
  invoke 结果为失败（fail-closed，绝不宣称已受控）；
- invoke 前（onActiveChild 内）落 `agent_process_bound`，invoke 结束后落
  `agent_process_settled`（在 `agent_invoke_end` 之后追加）。

## 3. 接管对账（零副作用分类 → 调用方决策）

`goal-containment-reconcile.ts`（纯函数 + 探针注入）：

| 状态 | 判定 | 处置 |
|------|------|------|
| `no_unclosed_bounds` | 无未闭合绑定（或已全部 settled） | 继续 |
| `legacy_run` | 有 invoke 史但**从未**出现 bound（旧版 run） | **fail-closed**：拒绝 resume / supervise 不拉起，人工清理 |
| `guardian_gone` | 探针 identify=null | 唯一持柄契约 = Job 已关，无需回收 |
| `guardian_alive_matching` | pid + startedAtMs 严格等值 + executable 等值 + commandLine 含 token | 新 epoch 下终止 guardian（taskkill **无 /T**），Job 团灭后代 |
| `guardian_identity_unverifiable` | PID 重用 / exe 不符 / 命令行不可读 / 缺 token | 不杀、不阻断，仅警告 |

杀后确认：探针复核消失才算回收（不凭 taskkill 退出码）；匹配但杀不死 → 拒绝续跑。

自动回收前置（plan 冻结）：① 旧 owner 确死（lock 接管 / beacon stale）；② 新 epoch
已取得（run_start）；③ guardian 身份严格匹配。缺一不回收。

## 4. supervisor 受控 force

`goal-supervise.ts` resume 分支（决策核保持纯函数不变）：

- `guardian_alive_matching` → 旧 owner 未死 → 维持退避不拉起（落
  `supervisor_observation{action:'owner_alive'}`，去重）；
- `legacy_run` → 不拉起，落 `legacy_needs_manual` 观察，人工清理；
- `guardian_identity_unverifiable` → 警告后照常；
- `guardian_gone` → 确认旧 owner 死亡 → runnerArgs 追加 `--force-resume`（受控 force；
  cooldown 语义保留在 runner 端，force 不 bypass cooldown）。

## 5. 实测留证（Windows 本机，真实执行，全部通过）

### 5.1 KILL_ON_JOB_CLOSE 的两处真实障碍（2026-08-18 本机实测定谳）

1. **PS `[ref]` marshaling 静默失效**：PowerShell 5.1 以 `[ref]` 传 blittable struct 给
   `SetInformationJobObject` 时，kernel32 收到空数据——**返回 True 但 flags 全零**
   （Query 读回 0x0），KILL 形同虚设。**同一代码在 C# `ref` 路径读回一致**
   （`CreateKillOnCloseJob` 内建读回断言）。guardian 的 Job 创建因此收进 C#。
2. **宿主嵌套 Job**：宿主（Claude Desktop 工具环境）所有进程在宿主 Job 内
   （flags=0x3C00 = BREAKAWAY_OK|SILENT_BREAKAWAY_OK|KILL_ON_JOB_CLOSE）。嵌套下
   自建 Job 的 KILL_ON_JOB_CLOSE / TerminateJobObject 对嵌套成员**均不生效**
   （close 句柄后成员存活，纯 C# 最小实验复现；与宿主事故形态自洽——宿主 job 杀
   runner、claude 因 breakaway 逃逸幸存三大事故）。**对策：agent 以
   CREATE_BREAKAWAY_FROM_JOB 显式脱离宿主 Job**，使其唯一归属于 guardianJob
   （单层）→ KILL 必生效；guardianJob 不设 BREAKAWAY_OK（agent 在其中不能再逃）；
   宿主不允许 breakaway 时 CreateProcess 失败 → containment 建立失败 fail-closed。
   另留执行面兜底：`TerminateJobMembers`（OS 权威枚举成员 + TerminateProcess，
   不登记、非对账真源）覆盖任何残余特殊情况。

### 5.2 验收矩阵（本机真实执行）

- [x] guardian 主链路：agent 在 Job 内运行、stdout 透传、退出码透传（exit 0）
- [x] 硬杀 guardian 场景 B：`taskkill /F /PID <guardian>`（无 /T）→ 12s 后
      壳（cmd）与 CLI 后代（ping 链）整树 0 残留（OS KILL_ON_JOB_CLOSE 生效；
      P1-6 handle 前置 + 移除成员枚举后复验通过）
- [x] 硬杀 runner 场景 A：`taskkill /F /PID <runner>` → guardian 观察 runner
      消失 → 主动团灭 → 12s 后 0 残留（guardian、壳、CLI 全清；复验通过）
- [x] 宿主杀掉 guardian 的独立观测（实验中被宿主周期清杀多次）：每次 guardian
      一死，agent 全树随 Job 关闭消失——**无一次孤儿残留**（此前的核心事故形态）
- [x] claude -p 在禁 breakaway Job 内完整事件流（hook→init→assistant→result 全量
      经 stdout 透传）；`claude --version` 经 guardian exit 0
- [x] claude -p 零输出等待现象：与 Job/containment 无关（同为宿主环境的会话并发
      排队——bash 直连同样受 rate_limit 五小时限额约束；dbg 环境并发低时 Job 内
      一次跑通）。该等待正是 guardian 等待语义的设计场景，runner 超时树杀兜底
      （kill guardian = 团灭，本轮全套验证）
- [x] breakaway 兼容性结论：claude（含 claude.cmd shim 链）在禁 breakaway
      guardianJob 内可正常启动与运行——adapter 不硬依赖 breakaway，无需停止实施

## 6. 一轮 review 修订（2026-08-19，全部吸收）

| # | 意见 | 修订 |
|---|------|------|
| P0-1 | 多未闭合 guardian 只处理最后一个 | `reconcileGuardianOwnership` 改为 `outcomes[]` **逐一对账全部**未闭合绑定；`orphan_reclaimed` 视为闭合事件；goal-status 投影全部 binds + `any_alive` 聚合 |
| P0-2 | 绑定失败可能被标 settled 留野跑进程 | 身份读取 `identifyWithRetry`（有界重试，CIM 可见延迟）；四元组完整校验含绝对 executable；绑定失败→kill→`awaitGuardianGone` 复验；未证明消失→不落 settled+`phase_halt(agent_containment_unresolved)` 阻断续跑（新 incident 注册） |
| P1-3 | supervise force 接线不完整 | **所有允许拉起分支统一追加受控 `--force-resume`**；行为测试（进程内 main + 注入 probe/spawn：owner 存活不拉起；gone/no_unclosed 拉起带 force） |
| P1-4 | legacy 无解除路径 | legacy 判据收窄为「从未有 bound **且存在未闭合 invoke**」；已闭合旧 run 可恢复；`--force-resume` 显式确认（`legacy_run_override` 审计事件）；supervisor 不代其确认 |
| P1-5 | resume BLOCKER 留僵尸 run_start | legacy/杀不死拒绝路径改走 `concludeStartupBlocker`（run_end HALTED 收口） |
| P1-6 | runner handle 在 agent resume 后才打开（PID 重用竞态） | **OpenProcess(SYNCHRONIZE) 先于 CreateProcess**；失败即 exit 2 不建 agent |
| P1-7 | argv quoting 不完整 | quoting/转义收归 Node 侧单点（`quoteWindowsArg` 标准 CommandLineToArgvW 反向含尾部反斜杠处理；cmd 分支 `%`→`%%`，实测表）；guardian 只 `CreateProcess(appName, commandLine)` |
| P1-8 | strict loader 空文件当合法真源 | resume 检查补：0 事件 / 无 authoritative `run_start` → fail-closed |
| P1-9 | guardian LF 红线 | `agent-guardian.ps1` 转 LF（保留 UTF-8 BOM），字节断言 |
| P2 | TerminateJobMembers 64 位步长错误 | **整段裁掉**（breakaway 后单层 Job 主契约成立，KILL_ON_JOB_CLOSE 必兜底；去掉平行执行面） |

修订后行为面测试：`agent-containment.unit.test`（18 例：quoting 表 / 多未闭合逐一对账 / orphan_reclaimed 闭合 / legacy 收窄与解除 / supervise 受控 force 行为 / identifyWithRetry / settle 条件接线 / shim 解包两形态 / 真实 guardian argv 回显无损 / 真实活进程 + identify 恒 null 不得误判死亡）。

## 7. 二轮 review 修订（2026-08-19，两条阻断已闭环 + 一项宿主级新未知项如实上报）

| # | 意见 | 修订 |
|---|------|------|
| P0 | `identify()===null` 不得当作 guardian 死亡证明（CIM 暂不可见/查询失败/解析失败均可产生 null） | 死亡判定**剥离 CIM**：新增独立 PID existence 通道 `pidExists`（win32 `Get-Process -Id`，非 WMI/CIM API 面；确定性否定语义）。`classifyBound` 先 exists 后 identify：exists=false → `guardian_gone`；exists=true 且 identify null → `identity_unverifiable`（不杀不阻断警告）。`awaitGuardianGone` 改用 exists 通道轮询。绑定失败路径：**同步** `terminateGuardianProcessOnly` + `awaitGuardianGone(pid)`（不再 `void kill()` 异步未等待）；未证明消失 → `guardianStillAlive` → 不落 settled + `agent_containment_unresolved` halt。行为测试：真实活进程 + identify 恒 null → 判「未证明死亡」；真实死亡被确定性捕获 |
| P1 | `.cmd` 参数 `%` 转义仍会展开环境变量（`%%` 在 cmd /C 下被折叠还原后展开，实测 `a%MAISON_QTEST%b → aEXPANDEDb`） | **不再经 cmd /C 执行 shim**：新增 `unpackCmdShim` 把 npm 生成的 .cmd/.bat **解包到 direct 目标**——exe 形态（claude/opencode：`"%dp0%\node_modules\...\bin\<name>.exe" %*` → 提取 exe 绝对路径）与 node 形态（`"%_prog%" "%dp0%\...\cli.js" %*` → node.exe（dp0\node.exe 存在优先，否则 PATH）+ 入口 js，node direct 执行）；其它形态 fail-closed（不堆叠字符转义规则）。删 `buildCmdShimCommandLine/escapeArgForCmd`。真实 guardian argv 回显测试覆盖 `%VAR%`/空/空格/引号/尾反斜杠/`&|<>^()!`。顺带补 `where.exe` spawnSync `windowsHide:true` |
| 新 P0 未知项 | **guardian 在 node-spawn 形态下 2s 级进程消失且 node 侧无 exit 事件**（本宿主实测 12+ 组对照：bash/有 console 父形态正常，node 父形态下 guardian 进程消失、agent 被团灭、驱动等待 exit 事件不触发）——含 `-WindowStyle Hidden`/`CREATE_NEW_CONSOLE`/`windowsHide:false`/stdin pipe 全形态对照 | **已闭环（三轮 review 定谳）**：① 早前「CREATE_NEW_CONSOLE 实验失败」系 C# 常量缺失（guardian 秒退 exit 1 被误读为挂）；② 根因 = **console 类 agent（cmd/claude/powershell 等）在无控制台环境（node runner 的 guardian 无 conhost）下挂起等待控制台分配** → guardian 等待 agent 超过 ~8s 被宿主清杀（guardian 特有；裸 powershell 30s 自然存活）；③ 修复 = guardian 以 **CREATE_NEW_CONSOLE + STARTF_USESHOWWINDOW + SW_HIDE** 为 agent 创建**隐藏控制台**。复验矩阵（纯异步驱动）：cmd echo 452ms exit 0 / ps echo 1017ms exit 0 / claude --version（shim 解包 direct）exit 0 / 30s 心跳 agent 全程 guardian 存活 + agent 完成后 exit 0 + CLOSE 事件正常。窗口卫生保持（SW_HIDE 不可见）。agent 卡顿期若仍被清杀，则 KILL_ON_JOB_CLOSE 团灭 agent（零孤儿目标不变，实测多次） |