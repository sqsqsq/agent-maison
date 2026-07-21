# Goal Mode 运维细则（条件加载：实际启动/监控 goal run 时读）

> SSOT 索引见 [`skills/project/goal-mode/SKILL.md`](../project/goal-mode/SKILL.md)。本文承载该 Skill 的深度操作细节与事故知识，触发/命令骨架仍以主文档为准。

## 运行身份（RESOLVED_ADAPTER）解析阶梯

本 Skill 正文跨宿主共用；**不得**硬编码 `claude` / `cursor` 等。

**关键区分（避免误传 `--adapter`）**：解析阶梯只产出 **`requestedAdapter`（请求身份）**；**真正生效的运行身份以 `framework.local.json agent_adapter`（SSOT 权威）为准**——已有合法记录时一律用它，`requestedAdapter` 仅在「首启无 local」或「`--override-adapter` 显式覆盖」时才成为 effective。**local 不是阶梯的一级**，而是阶梯产物之上的权威。

`requestedAdapter` 解析阶梯（优先级从高到低，**永不硬猜 / 永不默认 claude·cursor**）：

1. **用户显式指定**（输入表 `adapter` 列 / 「用 cursor 跑 goal」等）→ 来源 `user_explicit`。
2. **入口 / 跳板声明**：刚读过的 slash 或 skills-bridge 跳板内 `> 运行身份（RESOLVED_ADAPTER）：<name>` 行（Claude slash、Cursor/Codex/generic bridge 物化时注入）→ 来源 `entry_declared`。
3. **回退**：入口无身份声明 → registry **`setup.adapter`** 交互选择（见 [user-confirmation-ux.md](user-confirmation-ux.md)）→ 来源 `registry`；**绝不默认**。

启动 goal-runner 时：**`--adapter` 传 check-personal-setup 返回的 `activeAdapter`（即 SSOT），并用 `--adapter-source` 传上面来源**（写入 manifest `adapter_provenance` 供回溯）；**不得**把未经对账的 `requestedAdapter` 猜测直接当 `--adapter`。goal-runner 会以 local 为权威对账：冲突即 STOP（除非 `--override-adapter`）。

### Personal setup + 确定性写盘（严格顺序）

1. 按上节阶梯解析 `RESOLVED_ADAPTER`。
2. 执行 [personal-setup-gate](personal-setup-gate.md)：`check-personal-setup.ts --json --ensure --select-adapter <RESOLVED_ADAPTER> --project-root <repo-root>`。
3. **仅解析 stdout JSON**（`ok`, `code`, `activeAdapter`, `candidates`, `message`, `ensured`）。按 `code` 分流：

| `code` | 行为 |
|--------|------|
| `ok` | 已就绪（或 `--ensure` 已自动写入 `framework.local.json`）→ 用返回的 `activeAdapter` 作为 `--adapter` 继续 |
| `adapter_conflict` | local 已记录 X 但本次请求 Y≠X → **默认尊重 local（X）**；用户确要换 Y → 永久换走 registry `setup.adapter`+`record-adapter`，仅本次即时换则启动加 `--override-adapter`（会回写 local 留痕）。**不得**静默用 Y 覆盖 |
| `needs_adapter_choice` | `requestedAdapter` ∉ candidates → registry **`setup.adapter`** 交互选择 → `init-orchestrate --scope personal` 的 **`record-adapter`** 写盘；或 **STOP**→`/framework-init` |
| `no_materialized_adapter` / `not_in_materialized` / `entry_not_materialized` | 先复核 `--project-root`（须指向含 `framework/` 与 `framework.config.json` 的工程根）→ **STOP**，引导 `/framework-init` |

4. 若阶梯 2 自动写入了 local.json（`ensured` 含 `auto_selected_adapter`），须在汇报中说明：「我按当前运行宿主选了 `<X>`（个人级 `framework.local.json`，gitignored）；要换别的 adapter 请讲」。

**边界**：写 `framework.local.json`（个人、gitignored）由 `--select-adapter --ensure` 或 `record-adapter` 完成，**允许**；「不写项目产物」指 `.cursor/**`、`framework.config.json`、物化清单——二者不混为一谈。

## 启动方式（survival-first）事故背景

goal-runner 是**长任务**（逐 phase 拉起 headless agent，每个数分钟，含重试可达数十分钟），goal 模式的承诺是**无人值守过夜跑完**。**必须纠正的概念错误**：宿主的"后台启动"（Cursor `is_background` / Claude Code `run_in_background`）只让你**立即拿回控制权**，但进程仍是**会话内子进程**——宿主会话结束 / 活跃 agent 轮次收尾时会被宿主回收（实测：用 `is_background` 直挂的 run 在轮次收尾即被杀，留下"显示运行中的尸体"）。**"拿回控制权" ≠ "进程能活过我的会话"。**

`--detach` 是**真正的 OS 脱离**（`detached:true` + `unref()` + stdio 落 `report_dir/detach.log`）：launcher 秒级 fork 到后台、打印 `{run_id, report_dir, log, pid}` JSON 后 exit 0，真正的 run 在后台独立跑、**活过宿主会话 / 轮次空闲**（实测：Cursor 完全关闭再重开，`--detach` 的 run 毫发无损）。宿主若支持后台模式，可再叠加它让 launcher 那一下也不阻塞，但**存活由 `--detach` 保证，不靠 `is_background`**。launcher 的 stdout 只有那行 JSON；后台进程输出全部进 `report_dir/detach.log`。**解析 JSON 取 `run_id`**。

**机制级护栏**：`goal-runner` 会**阻断**前台启动的无人值守真跑（`approval_mode=never` 且无 `--detach`，非 dry-run/detached-child）→ BLOCKER 退出，提示改用 `--detach`。确为人工前台 / 短任务时，显式加 `--foreground-ok` 放行（降为警告）。这把"一律 `--detach`"从文档约定升为代码约束。

**存活是环境属性**：对 Cursor / 本机已实测 `--detach` 可活过会话。若换到会**整组/整树杀**进程的敌对宿主（部分公司沙箱 / CI），`--detach` 也可能保不住——那种环境须由宿主调度任务（cron / Windows Task Scheduler）托管 run，不能只靠 `--detach`。

## 监控 loop 细则

- **宿主工具 timeout 耦合（BLOCKER）**：调用 `goal-monitor --max-seconds N` 时，shell/tool 的 timeout 必须显式设置为 `> N`（建议 `N + 60s`；例如 `--max-seconds 240` 对应工具 timeout ≥300s）。如果宿主默认 timeout 更短（如 120s），必须显式提升；无法提升时把 `N` 降到安全值并循环。
- **循环方式**：monitor 有输出后，向用户汇报并把返回的 `event_index` 记为 `last_seen`；未终态且当前轮次仍活跃时，再启动下一段 bounded monitor。**不要**跑 `goal-status --watch` 常驻。
- **no-op**：若到 `--max-seconds` 仍无通知事件，monitor 会 no-op 退出；agent 可继续下一段 bounded monitor，不得误判 runner 卡死。
- **heartbeat**：低频运行中摘要按事件时间累计 `SOFT_STALL_MS = 10min` 判断，并去重；不是每个 240s monitor 都汇报一次。
- **硬 liveness 异常**：monitor 返回 `notification_kind=liveness`（`STALLED` / `ORPHAN_SUSPECTED`）时，向用户汇报一次并**停止** bounded monitor loop，升级让用户决策（查 `detach.log`、决定是否 `--force-resume` 或停 run）；**不要**继续轮询。monitor 已对同一异常去重（无新事件不复报），硬卡死/孤儿继续 loop 没有意义。
- **跨轮次接管**：如果当前轮次被中断或上下文切换，新轮 agent 必须从 run 目录重新读取 `events.jsonl` / `goal-status` 推导当前状态和最近 verdict；不要假设内存里的 `last_seen` 仍可靠。
- **fire-and-forget**：仅当用户明确要求后台跑不用汇报时，agent 可只给 `run_id`、`progress.json` 和一次性 status 命令，不进入 monitor loop。
- **monitor 熔断（P1-8，plan 7c4f2e9b——07-17 实测宿主被 monitor 循环占用 2h05m）**：以下任一条件命中，宿主**必须**主动转 fire-and-forget 并交还对话轮次，不得继续轮询：
  1. 连续 **3 轮** bounded monitor（≈12–15min）phase/substep 无推进（same phase + same substep）；
  2. 单 phase 的 monitor 累计等待超过 **30 分钟**；
  3. 单轮对话内 monitor 总时长超过 **30 分钟**（硬上限——2h+ 的占用对用户是事故不是服务）。
  转出话术模板：向用户交代 ①`run_id` 与当前 phase/attempt；②预计耗时与依据（phase 超时预算）；③续看指令（`goal-status --feature <f> --run-id <id>`）；④说明「后台继续跑，完成/求人时可随时用上述命令查看」，然后结束当前轮次。用户后续追问时按 status/monitor 现查现答。
- **加速器**（Cursor 等支持 `notify_on_output` 的宿主）：匹配 runner stdout 里程碑行 `GOAL_PHASE` / `GOAL_RUN` 可更快触发一次 monitor；它只是加速器，通知 SSOT 仍是 `events.jsonl` / `goal-monitor`。
- 读 `progress.json` 时若 `generated_at` 很旧，须降级信任；权威活性用 `goal-status` / `goal-monitor`（实时重算锁 pid）。
- 软窗口 `SUSPECTED_STALL` = 安静但可能活着；硬 `STALLED` = 超时/锁孤儿等真异常。
- **活性信号唯一权威 = `goal-status` / `progress.json` / events 心跳（每 ~60s 一拍）；判断「是否卡死」只看这些。**
- **BLOCKER（chrys / opencode 等无流式 headless adapter）**：`phases/<phase>/agent-output.log` 在该 phase **结束前恒为空**（chrys 结束才一次性写 stdout、opencode 流式但中途可长时间静默）——**禁止** tail 该日志判断进度或卡死；看到它空 ≠ runner 卡住。误把空日志当卡死会触发错误的 `--resume` / 重复起 run（chrys 实测坑）。

**边界**：bounded monitor 不是跨轮次唤醒能力。它只能在主 agent 当前轮次仍活着时尽力汇报；若主对话已经结束，真正的推送/唤醒属于宿主或 adapter 增强（如 Claude `ScheduleWakeup` / cron 定时唤醒、Cursor `notify_on_output`）。

## manifest 关键字段

- `feature`：feature slug（**必填**）
- `start_phase` / `end_phase`：起止 phase（默认 spec→testing）
- `dependency_policy`：哪些外部阻塞可 DEFERRED 续行（非 completed）
- `unattended`：写权限/审批/超时（preflight BLOCKER）
- 运行证据：`<features_dir>/<feature>/goal-runs/<run-id>/`（manifest、events、progress.json、每 phase prompt/输出、goal-report）
