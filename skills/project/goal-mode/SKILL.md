# Goal 模式（薄入口）

> **BLOCKER**：本 Skill 是 **goal-runner 的宿主入口**，不实现独立 phase 裁决循环。
> 裁决 SSOT：`harness/scripts/utils/phase-transition-policy.ts` + `goal-runner.ts`。
> 宿主可见能力仅 **slash / 自然语言 / Skill**；**禁止**要求宿主手跑 harness（执行权见 [user-confirmation-ux.md](../../reference/user-confirmation-ux.md) §8.2b · `framework-agent-execution`）。

## 何时使用

用户要求进入 **目标模式 / 全自动（无人值守）**，对某个 **feature** 从指定 phase 推进到终点时，进入本 Skill 并由 **agent 自跑** goal-runner。

「全链路 / 从 spec 到真机 / 一个需求做到尾」等表述属于 **batch_authorized**（对话内多 phase），**不是**本 Skill 的 goal 触发词。

## 宿主怎么触发（用户侧）

| 方式 | 示例 |
|------|------|
| Claude slash | `/goal-mode demo-feature 全自动从 spec 做到 testing` |
| 自然语言 | 「对 `demo-feature` 进入目标模式，无人值守全自动」 |
| Codex/Cursor/generic Skill | 读跳板（skill id `goal-mode`）后进入本 Skill 正文 |

解析用户输入得到：

| 字段 | 必填 | 说明 |
|------|------|------|
| `feature` | 是 | feature slug |
| `requirement` | 否 | 需求描述 |
| `start_phase` / `end_phase` | 否 | 默认 spec→testing |
| `adapter` | 否 | 用户显式指定 agent（如「用 cursor 跑 goal」）→ 校验 ∈ `materialized_adapters` 且入口产物存在 → 映射 `RESOLVED_ADAPTER`；未物化 → **STOP** 引导 `/framework-init`（不在 goal 流程内写项目产物） |

## 运行身份（RESOLVED_ADAPTER）

本 Skill 正文跨宿主共用；**不得**硬编码 `claude` / `cursor` 等。`RESOLVED_ADAPTER` 按下列阶梯解析（优先级从高到低）：

1. **用户显式指定**（输入表 `adapter` 列 / 「用 cursor 跑 goal」等）→ 直接用该值。
2. **入口 / 跳板声明**：刚读过的 slash 或 skills-bridge 跳板内 `> 运行身份（RESOLVED_ADAPTER）：<name>` 行（Claude slash、Cursor/Codex/generic bridge 物化时注入）。
3. **回退**：无法从入口确定身份 → registry **`setup.adapter`** 交互选择（见 [user-confirmation-ux.md](../../reference/user-confirmation-ux.md)）；**永不硬猜**。

若未经跳板直调本 Skill（无身份声明）→ 走阶梯 3。

## Agent 必须执行（勿推给用户）

**BLOCKER**：主 agent 须通过 Shell **自己**启动 goal-runner，读取报告后用自然语言汇报；**不得**在回复里写「请用户执行以下命令」作为唯一出路。

前置（**严格顺序**）：

1. [host-harness-readiness](../../reference/host-harness-readiness.md) Tier_1（`init-readiness.mjs` → 必要时 `npm install`）+ [harness-cli-cwd](../../reference/harness-cli-cwd.md)。**Tier_1 未就绪前禁止**调用任何 harness ts-node 脚本（避免 `@types/node` 缺失型 TSError）。
2. **Personal setup + 确定性写盘**（Case A/B **合并为一条流程**；多 adapter 工程**必须**写出 `framework.local.json`，内层 phase 门控不豁免 `agent_adapter`）：

   1. 按上节阶梯解析 `RESOLVED_ADAPTER`。
   2. 执行 [personal-setup-gate](../../reference/personal-setup-gate.md)：

   ```bash
   cd framework/harness && npx ts-node scripts/check-personal-setup.ts --json --ensure --select-adapter <RESOLVED_ADAPTER> --project-root <repo-root>
   ```

   3. **仅解析 stdout JSON**（`ok`, `code`, `activeAdapter`, `candidates`, `message`, `ensured`）。按 `code` 分流：

   | `code` | 行为 |
   |--------|------|
   | `ok` | 已就绪（或 `--ensure` 已自动写入 `framework.local.json`）→ 继续 |
   | `needs_adapter_choice` | `RESOLVED_ADAPTER` ∉ candidates → registry **`setup.adapter`** 交互选择 → `init-orchestrate --scope personal` 的 **`record-adapter`** 写盘；或 **STOP**→`/framework-init` |
   | `no_materialized_adapter` / `not_in_materialized` / `entry_not_materialized` | 先复核 `--project-root`（须指向含 `framework/` 与 `framework.config.json` 的工程根）→ **STOP**，引导 `/framework-init` |

   4. 若阶梯 2 自动写入了 local.json（`ensured` 含 `auto_selected_adapter`），须在汇报中说明：「我按当前运行宿主选了 `<X>`（个人级 `framework.local.json`，gitignored）；要换别的 adapter 请讲」。

   **边界**：写 `framework.local.json`（个人、gitignored）由 `--select-adapter --ensure` 或 `record-adapter` 完成，**允许**；「不写项目产物」指 `.cursor/**`、`framework.config.json`、物化清单——二者不混为一谈。

### 首次启动

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --feature <feature-slug> \
  --requirement "<需求描述>" \
  --adapter <RESOLVED_ADAPTER> \
  [--start spec] [--end testing] [--dry-run]
```

`--dry-run` 仅用于 agent 自验参数；用户要求真跑时去掉。

#### 启动方式（按宿主 shell 能力分流 · BLOCKER）

goal-runner 是**长任务**（逐 phase 拉起 headless agent，每个数分钟，含重试可达数十分钟）。**绝不能**把它当一条普通阻塞命令塞进有超时的 shell 工具里——否则 shell 工具秒级超时，runner 变孤儿进程后台续跑、agent 误判超时又重复起 run，互相杀子进程（chrys 实测坑）。按宿主 shell 能力二选一：

- **宿主 shell 支持后台启动**（Cursor `is_background` / Claude Code `run_in_background` 等）→ 用宿主的后台模式启动上面的命令，立即拿到控制权。
- **宿主 shell 仅阻塞、无后台、有超时上限**（chrys / opencode 等 TUI 的内置 shell）→ **必须加 `--detach`**：

  ```bash
  cd framework/harness && npx ts-node scripts/goal-runner.ts \
    --feature <feature-slug> --requirement "<需求>" --adapter <adapter> --detach
  ```

  `--detach` 让 goal-runner **秒级 fork 到后台、打印 `{run_id, report_dir, log, pid}` JSON 后 exit 0**——宿主 shell 拿到干净的 0 退出码就返回（不会触发超时杀树），真正的 run 在后台独立跑、逐 phase 拉 headless agent。launcher 的 stdout 只有那行 JSON；后台进程输出全部进 `report_dir/detach.log`，不占用宿主 shell 的管道。**解析该 JSON 取 `run_id`**，随后按下文进入 bounded monitor。

### 续跑

用户说「继续 goal run `<run-id>`」→ agent 自跑（**须带 feature**）：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts \
  --resume <run-id> --feature <feature-slug>
```

**BLOCKER**：主 agent **不得自行循环 `--resume`**；续跑必须由**用户**在对话中显式触发。续跑启动后仍按「运行中进度汇报」进入 bounded monitor；这不是 `--resume` 续跑。

若上次终态为 `HALTED` 或 `DEFERRED`，默认须加 `--force-resume`（冷却期内会被拒绝）；勿在无用户确认时自动续跑。

### manifest（可选，agent 写入后自跑）

复杂参数可写 `goal-manifest.yaml`（schema：`framework/workflows/goal-manifest.schema.yaml`），再：

```bash
cd framework/harness && npx ts-node scripts/goal-runner.ts --manifest <path>
```

## manifest 关键字段

- `feature`：feature slug（**必填**）
- `start_phase` / `end_phase`：起止 phase（默认 spec→testing）
- `dependency_policy`：哪些外部阻塞可 DEFERRED 续行（非 completed）
- `unattended`：写权限/审批/超时（preflight BLOCKER）
- 运行证据：`doc/features/<feature>/goal-runs/<run-id>/`（manifest、events、progress.json、每 phase prompt/输出、goal-report）

### 运行中进度汇报

启动 runner（后台模式或 `--detach`，见上「启动方式」）后，立刻告诉用户 `run_id` 与 `progress.json` 路径。

除非用户明确要求 **fire-and-forget / 后台跑不用汇报**，主 agent 在当前活跃对话轮次内 **必须**进入 bounded monitor。bounded monitor 是只读等待器：它只读 `events.jsonl` / live progress，不启动、不续跑、不杀掉 goal-runner；如果宿主超时杀掉 monitor，本次 goal run 不受影响，下一轮可重新调用。

默认调用：

```bash
cd framework/harness && npx ts-node scripts/goal-monitor.ts \
  --feature <feature-slug> --run-id <run-id|latest> \
  --since-event <last-seen-event-index> \
  --max-seconds 240 --markdown
```

- **宿主工具 timeout 耦合（BLOCKER）**：调用 `goal-monitor --max-seconds N` 时，shell/tool 的 timeout 必须显式设置为 `> N`（建议 `N + 60s`；例如 `--max-seconds 240` 对应工具 timeout ≥300s）。如果宿主默认 timeout 更短（如 120s），必须显式提升；无法提升时把 `N` 降到安全值并循环。
- **循环方式**：monitor 有输出后，向用户汇报并把返回的 `event_index` 记为 `last_seen`；未终态且当前轮次仍活跃时，再启动下一段 bounded monitor。**不要**跑 `goal-status --watch` 常驻。
- **no-op**：若到 `--max-seconds` 仍无通知事件，monitor 会 no-op 退出；agent 可继续下一段 bounded monitor，不得误判 runner 卡死。
- **heartbeat**：低频运行中摘要按事件时间累计 `SOFT_STALL_MS = 10min` 判断，并去重；不是每个 240s monitor 都汇报一次。
- **硬 liveness 异常**：monitor 返回 `notification_kind=liveness`（`STALLED` / `ORPHAN_SUSPECTED`）时，向用户汇报一次并**停止** bounded monitor loop，升级让用户决策（查 `detach.log`、决定是否 `--force-resume` 或停 run）；**不要**继续轮询。monitor 已对同一异常去重（无新事件不复报），硬卡死/孤儿继续 loop 没有意义。
- **跨轮次接管**：如果当前轮次被中断或上下文切换，新轮 agent 必须从 run 目录重新读取 `events.jsonl` / `goal-status` 推导当前状态和最近 verdict；不要假设内存里的 `last_seen` 仍可靠。
- **fire-and-forget**：仅当用户明确要求后台跑不用汇报时，agent 可只给 `run_id`、`progress.json` 和一次性 status 命令，不进入 monitor loop。
- **加速器（Cursor 等支持 `notify_on_output` 的宿主）**：匹配 runner stdout 里程碑行 `GOAL_PHASE` / `GOAL_RUN` 可更快触发一次 monitor；它只是加速器，通知 SSOT 仍是 `events.jsonl` / `goal-monitor`。
- 读 `progress.json` 时若 `generated_at` 很旧，须降级信任；权威活性用 `goal-status` / `goal-monitor`（实时重算锁 pid）。
- 软窗口 `SUSPECTED_STALL` = 安静但可能活着；硬 `STALLED` = 超时/锁孤儿等真异常。
- **活性信号唯一权威 = `goal-status` / `progress.json` / events 心跳（每 ~60s 一拍）；判断「是否卡死」只看这些。**
- **BLOCKER（chrys / opencode 等无流式 headless adapter）**：`phases/<phase>/agent-output.log` 在该 phase **结束前恒为空**（chrys 结束才一次性写 stdout、opencode 流式但中途可长时间静默）——**禁止** tail 该日志判断进度或卡死；看到它空 ≠ runner 卡住。误把空日志当卡死会触发错误的 `--resume` / 重复起 run（chrys 实测坑）。

**边界**：bounded monitor 不是跨轮次唤醒能力。它只能在主 agent 当前轮次仍活着时尽力汇报；若主对话已经结束，真正的推送/唤醒属于宿主或 adapter 增强（如 Claude `ScheduleWakeup` / cron 定时唤醒、Cursor `notify_on_output`）。

## 报告解读（汇报给用户）

终态后 Read `doc/features/<feature>/goal-runs/<run-id>/goal-report.md` + `progress.md`，用自然语言说明：

| 状态 | 含义 |
|------|------|
| `COMPLETED` | 无 DEFERRED，全链 PASS |
| `DEFERRED` / `PARTIAL` | 存在外部阻塞未闭环，**禁止**宣称完成 |
| `HALTED` | FAIL 重试耗尽或 policy 拒绝续行 |

## 与原生 /goal 的关系

- Maison 全链路 SSOT 是本 Skill → agent 自跑 **goal-runner**。
- Claude/Codex 原生 `/goal` 第一版仅为 adapter metadata + 条件模板占位，**不**替代 harness 裁决。

## 禁止

- 在本 Skill 内复刻 `classifyPhaseVerdict` / `resolveAutoChain` 逻辑
- 将 INCOMPLETE 软通过为 PASS 或 completed
- 把 `npx ts-node scripts/goal-runner.ts` 贴给用户让其手动执行
- personal-setup / preflight 门控失败、`no_materialized_adapter`、或任何歧义 → **STOP**，把结论与建议（`/framework-init` 或选 adapter）交回用户；**严禁**自行绕过 goal-runner、**严禁**转入自由改码、**严禁**据单次失败探测自下「项目未物化」结论而不复核 `--project-root`
- 探测失败时须先核对 `--project-root` 指向含 `framework/` 与 `framework.config.json` 的工程根，再下结论
