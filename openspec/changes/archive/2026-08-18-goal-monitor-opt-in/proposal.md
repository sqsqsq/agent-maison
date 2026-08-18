## Why

bc-openCard 实测证实：goal 无人值守 run 已经真后台了（`--detach`），但前台对话框没有后台——现行 goal-mode-skill spec 强制「启动 runner 后 MUST 进入 bounded monitor」，宿主 agent 忠实执行，轮询占死当前轮次（08-14~15 会话实锤：多次 goal-monitor + 数十处自制 sleep-10 轮询，工具等待累计 ≈3.5h）。根因是两代设计叠加：bounded-monitor plan 用前台轮询「模拟」推送成了跨宿主默认，后继 unattended-survival plan 已识别该类目错误（`notify_on_output` 只是会话内加速器、`--detach` 下 stdout 全进 detach.log、真跨轮唤醒必须靠宿主调度器）但 L4 顺延，旧默认没被撤。

另外三处地面真值被 review 核实：

- `goal-monitor --max-seconds 0` ≠ 状态查询：默认 `since-event=-1`，分类器按事件序把**最早的**历史 phase_verdict 当新事件报出（goal-monitor.ts 默认游标 + 顺序遍历首个 phase_verdict 即返回）。
- detach launcher 返回 JSON 时 manifest 由子进程稍后才写——启动存活自校验存在竞态，需要一段有界就绪等待窗（≤30s，只查 manifest 落盘 / detach.log 增长 / liveness）。
- "原样保留 Cursor `notify_on_output` 加速器"与根因自相矛盾：`--detach` 下 runner stdout 全进 detach.log，物理上匹配不到里程碑；保留该条还可能诱导 agent 自建 `tail detach.log` 长驻桥。

本 change 只做减法：默认反转为「启动→有界启动握手（≤30s）→汇报→交还轮次、查时再报」，状态查询唯一入口 `goal-status`，monitor 保留为 opt-in 盯守工具（不得当状态查询），禁事件轮询；零代码改动，纯 spec+docs；不复活 L4 cross_turn_wakeup。

## What Changes

- 删除 `Requirement: Goal mode monitors active runs during the current turn`（含「启动后必进 monitor」「fire-and-forget 须显式」两个 Scenario）。
- 新增 `Requirement: Goal mode returns the turn after launching unattended runs`：启动 unattended run 后 SHALL 执行有界启动握手（硬上限 30s，只检查 manifest 落盘 / detach.log 增长 / liveness，超窗 MUST 如实报启动未就绪），随后汇报 run_id / 进度文件 / 续查指令并结束当前轮次；状态查询 SHALL 唯一使用 `goal-status`（`goal-monitor` MUST NOT 用作状态查询）；bounded monitor 仅在用户明确要求盯守时进入；agent MUST NOT 用自制 sleep/poll 循环等待 phase / verdict / run_end 事件（握手为唯一例外）。
- 修改 `Requirement: Goal mode documents monitor timeout coupling`：措辞限定为「当调用 goal-monitor 时」（opt-in 场景），工具语义不变。
- 保留 `Goal mode distinguishes monitoring from wakeup`；goal-runner spec 的 monitor CLI 条目一字不动。

## Impact

- 纯 spec + docs：`skills/project/goal-mode/SKILL.md`、`skills/reference/goal-mode-operations.md`、`docs/operations/goal-mode-runbook.md`。
- 零生产代码改动：`goal-monitor.ts` / `goal-status.ts` / `goal-runner.ts` 不动，monitor 的 CLI 语义、goal-runner spec 条目、熔断阈值全部原样。
- 不新增通知接口、后台 supervisor、调度器或 adapter capability；不实现、不预埋 L4 cross_turn_wakeup。
- 消费者（宿主 framework/ 物化副本）无需迁移步骤；本 change 挂 3.0.0 发布门，重打后生效。MIGRATION.md 无新增条目（无破坏性运行时变更）。