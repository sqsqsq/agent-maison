## Why

2026-08-18 宿主（Windows Claude Desktop 工具环境，包 ca27ac09/3.0.0）回灌 bc-openCard-1 实锤：
agent 进程零绑定零围栏 → supervisor 死亡后 claude 后代脱管野跑真机 **27 分钟**（spawn 壳随 Job 死、
后代 claude 幸存）；三天内同一 run 四次非正常中断，每次 resume 因 goal-report.json 陈旧回滚已
PASS 闭环再孵化新孤儿。需要的不是更多探测、而是**进程所有权单位**：一个进得去、出得来、可验证
生命周期的执行边界。

本 change 只承载 **agent containment（Job Object 围栏）** 与 **supervisor/runner 受控接管**两项；
events-only resume（t1）属既有在飞 change `goal-host-replay-fixes` 的实现欠账（resume rebuild 走
authoritative view + 损坏 fail-closed 已在 spec），不复制、不新立。

## What Changes

- **Windows agent containment（PowerShell P/Invoke guardian 先行，零新增二进制）**：
  agent 在执行任何用户代码前进入 `KILL_ON_JOB_CLOSE` Job——guardian 先
  `CreateJobObject + SetInformationJobObject`（C# 封装 + 读回断言；实测 PS `[ref]`
  marshaling 会让该调用静默失效），再 `CreateProcess(CREATE_SUSPENDED |
  CREATE_BREAKAWAY_FROM_JOB)` → `AssignProcessToJobObject` → `ResumeThread`，
  **杜绝 spawn→assign 竞态**。`CREATE_BREAKAWAY_FROM_JOB`：宿主 Job（flags 含
  BREAKAWAY_OK）环境实测，嵌套下 KILL_ON_JOB_CLOSE 对嵌套成员失效——agent 必须
  显式脱离宿主 Job 单层归属 guardianJob，KILL 才必生效；宿主不允许 breakaway 时
  CreateProcess 失败 → containment 建立失败 fail-closed（绝不静默降级）。
  guardianJob 不设 BREAKAWAY_OK（agent 在其中不能再逃）。
- **句柄唯一所有权（冻结契约）**：guardian 是 Job handle 的**唯一长期持有者**，不向
  runner/agent 复制句柄；guardian 同时等待 runner 与 agent——runner 异常消失→主动
  TerminateJobObject 团灭；guardian 自身被杀→OS 关闭其句柄（同为最后句柄）→团灭；
  正常收尾在 agent 退出后 guardian 退出（Job 关闭杀残留后代，生命周期闭合）。
- **stdio 透传**：agent stdout/stderr 经句柄继承继续抵达 runner 既有消费管道；
  guardian 自身**绝不写 stdout**（NDJSON/attestation 证据流零污染）。
- **fail-closed**：Windows unattended 下 containment 建立失败=invoke 失败如实上浮；
  身份不可核实/缺 token 的绑定=invoke 失败；**无 Job 绑定事件的旧版 run 拒绝 resume**，
  提示人工清理；非 Windows / attended / dry-run 零变化。
- **受控接管（只绑 guardian 身份，不枚举后代）**：invoke 落 `agent_process_bound`
  （ManagedProcessIdentity 四元组逐字段复用：pid + OS 启动时刻严格等值 + executable
  绝对路径 + guardian argv 显式 `run_id/invoke_id` token），收尾落 `agent_process_settled`。
  自动回收仅发生在旧 owner 确死 + 新 epoch 取得后：身份严格匹配→终止 guardian 由 Job
  团灭后代（**不逐个 killProcessTree**）+ `orphan_reclaimed` 事件；guardian 已不存在→依
  唯一持柄契约判定 Job 已关闭；身份不匹配/不可核实→不杀不阻断仅警告；匹配但杀不死→拒绝续跑。
- **goal-status 保持只读**：只投影未闭合绑定与 guardian 存活性，绝不回收。
- **goal-supervise 受控 force**：确认旧 owner（guardian）死亡后才追加 `--force-resume`，
  owner 存活维持退避；cooldown 保留在 runner 端。
- **宿主路由与 spawn 卫生**：生产 spawn 补 `windowsHide:true`；runbook 区分
  Task Scheduler（真无人值守+supervisor 自愈）与用户自开终端（一次性临时路线，无自愈）；
  指引用户可见，不自动安装持久计划任务；不做运行时 Job flags 自动探测/路由。

## Capabilities

### New Capabilities

无（复用既有 `phase_halt` / invoke 失败分类 / `supervisor_observation` 通道，不新增停止机制与状态机）。

### Modified Capabilities

- `goal-runner`：Windows agent containment（guardian 分支）、guardian 绑定/回收契约、
  resume 前接管对账（fail-closed 矩阵）、resume 起点 events-only 已归 goal-host-replay-fixes。
- `harness-gates`：无（gate harness spawn 仅补 `windowsHide`，语义零变化）。

## Impact

- 代码：`harness/scripts/utils/agent-guardian.ps1`（新增）、`agent-containment.ts`（新增）、
  `goal-containment-reconcile.ts`（新增）、`agent-invoke.ts`（guardian 分支 +
  windowsHide）、`goal-runner.ts`（containment 接线 / bound·settled·orphan_reclaimed
  事件 / resume 对账 / gate-harness windowsHide）、`goal-supervise.ts`（受控 force）、
  `goal-progress.ts`（guardian 只读投影）。
- 文档：`docs/operations/goal-mode-runbook.md`（恢复路线分级 + 宿主实测限定措辞）。
- 行为收紧：Windows headless 下 agent 进程结构从「裸 spawn + 登记壳 pid」变为
  「Job 成员 + guardian 唯一持柄」；旧版 run 的接管从「猜测式 killProcessTree」变为
  fail-closed 人工清理。
- 消费者迁移：无（events 新增事件类型与字段向后兼容；guardian 透明于 adapter）。