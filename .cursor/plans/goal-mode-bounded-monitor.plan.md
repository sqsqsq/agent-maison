---
name: goal-mode-bounded-monitor
overview: 为 goal 模式新增 bounded monitor，把阶段进度从“用户问了才读状态”改成“主 agent 在当前活跃轮次内按统一事件流主动汇报 phase verdict / 终态 / 异常”，明确跨轮次唤醒属于宿主增强，并修正 progress 已完成阶段 duration 膨胀问题。
version: 2.4.0
todos:
  - id: openspec
    content: 新建 OpenSpec change，明确 goal 模式阶段通知、bounded monitor、fire-and-forget、宿主唤醒边界、max-seconds 与宿主工具 timeout 耦合、跨轮次接管、heartbeat 低频阈值与 progress duration 修正的规格。
    status: completed
  - id: monitor-cli
    content: 新增 goal-monitor CLI，基于 events.jsonl / goal-status 同源投影做有界等待，按事件时间累计判断 heartbeat 低频通知，输出 markdown/json 通知。
    status: completed
  - id: progress-duration
    content: 在 progress projection 中记录 phase ended_at，已完成阶段 duration 使用 ended_at - started_at。
    status: completed
  - id: goal-mode-contract
    content: 更新 goal-mode Skill 与 runbook，把 bounded monitor 从可选 poll 改为当前活跃轮次内的默认强制流程，并定义 fire-and-forget、跨轮次接管、宿主工具 timeout 设置与宿主增强推送边界。
    status: completed
  - id: tests
    content: 补 goal-monitor、phase verdict、run_end、timeout no-op、heartbeat、stale progress、跨轮次 since-event 恢复、duration 固定等单测与 CLI smoke。
    status: completed
  - id: verify
    content: 跑 cd harness && npm test、npm run openspec:validate；发布内容改动后跑 npm run release:verify。
    status: completed
isProject: false
---

# Goal 模式 bounded monitor 阶段通知改造

## Summary

把 goal 模式的进度汇报从“用户问了才读状态”改成“主 agent 启动 runner 后，在当前活跃对话轮次内必须进入 bounded monitor，并在阶段 verdict / 终态 / 异常时主动汇报”。核心监听源统一为 `events.jsonl` / `goal-status`，不依赖具体 adapter 的 stdout，因此覆盖 `cursor`、`claude`、`codex`、`chrys`、`opencode` 等所有 goal 模式 adapter。

重要边界：bounded monitor 不是跨轮次唤醒能力。它只能在主 agent 当前轮次仍活着时尽力汇报；若主对话已经结束，真正的推送/唤醒必须归入宿主或 adapter 增强能力，例如 Claude `ScheduleWakeup` / cron 定时唤醒、Cursor `notify_on_output` 等。

本改造属于 AgentMaison framework 自身演进；按仓库规则，先建 OpenSpec change，再实现、验证、归档。

## Key Changes

- 新增 bounded monitor CLI：`framework/harness/scripts/goal-monitor.ts`。
  - 输入：`--feature <slug>`、`--run-id <id|latest>`、`--since-event <number>`、`--max-seconds <n>`、`--markdown|--json`。
  - 默认行为：阻塞等待到第一个需要通知的事件，或超时退出；不做无限 watch。
  - 默认 `--max-seconds` 使用宿主安全值 240s；实现允许显式覆盖，但文档示例不得超过 300s，避免撞宿主 shell 超时。
  - `goal-monitor` 是纯读取器：它不启动、续跑、杀掉或修改 goal-runner；被宿主超时杀掉也无副作用，agent 可以下一轮重新调用。
  - 需要通知的事件：`phase_verdict`、`run_end`、`STALLED`、`ORPHAN_SUSPECTED`、长时间无 phase 变化但仍 ACTIVE 的 heartbeat tick。
  - heartbeat 低频通知阈值固定为事件时间口径的 `SOFT_STALL_MS = 10min`：使用 snapshot 的 `last_activity_at` / `seconds_since_activity` 与最近 phase 变化事件计算累计静默时长，而不是使用本次 monitor 调用的本地等待时长。
  - heartbeat 通知必须去重：同一 phase 内只有跨过低频阈值或状态摘要发生实质变化时输出，避免每个 240s monitor 都误报。
  - 输出包含：最新 `event_index`、当前状态、已完成阶段、当前阶段、下一动作、证据路径。
  - `--markdown` 输出应可直接贴进主 agent 回复；`--json` 给未来 IDE/plugin 使用。
  - 新建 CLI 的理由：`goal-status --watch` 面向人类持续刷新；`goal-monitor` 面向 agent 做边沿触发、有界等待、单次通知输出，职责不同。

- 调整 `goal-mode` 入口契约。
  - 启动 runner 后，主 agent 必须立即汇报 `run_id` 与 `progress.json`。
  - 主 agent 不得以前台阻塞方式长期占住 shell；必须使用宿主后台能力或 `--detach`，然后进入 monitor。
  - 主 agent 必须在当前活跃轮次内循环调用 bounded monitor，而不是常驻 `--watch`；每轮 monitor 的 `--max-seconds` 必须小于宿主 shell 超时上限。
  - 主 agent 调用 `goal-monitor --max-seconds N` 时，必须把宿主 shell/tool timeout 显式设置为大于 N（建议 `N + 60s`），否则会被工具默认超时提前杀掉。若宿主默认 timeout 更低（如 120s），必须显式提升；无法提升时把 N 降到安全值。
  - 每次 monitor 返回 `phase_verdict` 或 `run_end`，主 agent 必须向用户发一条阶段补报。
  - 无新阶段但仍运行时，最多每 5-10 分钟发一次心跳摘要。
  - 用户明确要求 fire-and-forget 时，可以只汇报 run_id 和查看命令，不持续监控。
  - 若当前轮次被中断或上下文切换，新轮接管时必须从 run 目录重新推导状态，不能假设内存里的 `last_seen` 仍可靠。

- 复用并扩展现有 progress 投影。
  - `goal-monitor` 复用 `buildLiveGoalStatusSnapshot`，避免复制状态判断。
  - 为事件流补充稳定的 event index 语义：按 `events.jsonl` 行号从 0 开始。
  - `--since-event <last_seen>` 在单轮内由 agent 记忆；跨轮次接管时从 `events.jsonl` 和当前快照重建，第一版不强制持久化已通知 marker。
  - 跨轮次接管的退化策略：汇总当前状态和最近 phase verdict，避免漏报；同时不假装知道用户已看过哪些历史通知。
  - monitor 不信任过期 `progress.json`；活性仍以 `goal-status` 同源实时重算为准。
  - `agent-output.log` 只作为阶段摘要材料，不作为活性判断来源。

- 阶段通知内容规则。
  - PASS：一句话说明 `<phase>` 已闭环，列出 harness/verifier/receipt 结果和下一阶段。
  - DEFERRED/PARTIAL：明确不是完成，说明阻塞类别和继续策略。
  - HALTED/FAIL：首段说明失败阶段、失败原因、报告路径和建议动作。
  - RUNNING heartbeat：只报当前阶段、已用时间、最后活性时间、已完成阶段数。
  - 终态：读取 `goal-report.md/json`，给全链路总结。

- 顺手修正 progress Duration 口径。
  - `buildPhaseSpans` 记录 `ended_at`。
  - 已完成阶段 duration 使用 `ended_at - started_at`；正常路径 `ended_at` 取该 phase 的 `phase_verdict.ts`。
  - 历史/恢复事件缺少 verdict ts 时，`ended_at` 回退到下一 phase 的 `phase_start.ts` 或 `run_end.ts`。
  - 当前运行阶段 duration 继续使用 `now - started_at`。
  - 避免已 PASS 阶段的时长随当前时间膨胀。

## Public Interfaces

新增 CLI：

```bash
cd framework/harness
npx ts-node scripts/goal-monitor.ts \
  --feature bc-openCard \
  --run-id 20260624T064833Z \
  --since-event 0 \
  --max-seconds 240 \
  --markdown
```

调用该命令的 agent 必须把宿主 shell/tool timeout 显式设为大于 `--max-seconds`，例如 `--max-seconds 240` 对应工具 timeout 至少 300s；不要依赖 Claude Code Bash 等宿主工具的默认 timeout。

JSON 输出最小字段：

```json
{
  "schema_version": "1.0",
  "run_id": "20260624T064833Z",
  "feature": "bc-openCard",
  "event_index": 42,
  "notification_kind": "phase_verdict",
  "status": "RUNNING",
  "phase": "coding",
  "phase_verdict": "PASS",
  "phase_action": "advance",
  "next_phase": "review",
  "markdown": "..."
}
```

`goal-mode/SKILL.md` 的示例流程改为：

1. 启动 runner，拿到 `run_id`。
2. 向用户报启动信息。
3. 调 `goal-monitor --since-event <last_seen> --max-seconds 240 --markdown`，并把宿主 shell/tool timeout 显式设为至少 300s。
4. 有通知就回复用户并更新 `last_seen`。
5. 未终态且当前轮次仍活跃，则继续下一段 bounded monitor。
6. 若轮次中断，新轮接管时从 `events.jsonl` / `goal-status` 重新推导当前状态和最近阶段变化。

## Test Plan

- Unit tests：
  - `goal-monitor` 在 `phase_verdict PASS` 时输出一次通知，并返回正确 event index。
  - `run_end COMPLETED/HALTED/DEFERRED` 输出终态通知。
  - 无新事件时在 `--max-seconds` 到期后返回 no-op，不误报。
  - heartbeat 多次出现但无 phase 变化时，按 `SOFT_STALL_MS = 10min` 的事件时间累计口径输出低频运行中摘要；单次 240s monitor 不得单独触发心跳通知。
  - 同一 phase 内 heartbeat 摘要去重，避免连续 monitor 每 240s 重复输出。
  - stale `progress.json` 场景走实时投影，不误报 RUNNING。
  - `goal-monitor --max-seconds` 超时返回 no-op 且不修改任何 run 文件。
  - 跨轮次丢失内存 `last_seen` 后，可从 run 目录重新汇总当前状态和最近 verdict。
  - 已完成 phase duration 固定，不随 `nowMs` 增长。

- CLI smoke tests：
  - 构造临时 `goal-runs/<run-id>` fixture，执行 `goal-monitor --json`。
  - 执行 `goal-monitor --markdown`，确认输出含 phase、status、evidence。
  - Windows 路径下验证 `run-id latest`、相对路径、LF 输出正常。

- Documentation tests / snapshot：
  - 更新 `goal-mode/SKILL.md`、`goal-mode-runbook.md` 后检查关键术语：`bounded monitor`、`phase_verdict`、`run_end`、`fire-and-forget`。
  - 确认文档不再把 5-10 分钟 poll 写成可选项，而是默认要求。
  - 确认文档显式说明 bounded monitor 不等于跨轮次推送；跨轮次唤醒属于宿主/adapter 增强。
  - 确认文档示例使用 `--max-seconds 240`，并说明宿主 shell/tool timeout 必须显式大于 `--max-seconds`。
  - 确认文档写清 heartbeat 通知阈值使用事件时间累计口径，不使用本次 monitor 调用耗时。

- Full validation：
  - `cd harness && npm test`
  - `npm run openspec:validate`
  - 若改动发布内容，执行 `npm run release:verify`

## Assumptions

- 默认实现为 framework 通用能力，不为某个 adapter 单独分支。
- 不要求 framework 纯脚本层唤醒已经结束的聊天线程；线程唤醒属于宿主增强能力。
- 第一版 monitor 只负责“有界等待 + 生成通知内容”，真正把消息发给用户仍由主 agent 在当前活跃对话轮次中完成。
- 用户未明确 fire-and-forget 时，goal-mode 默认进入 bounded monitor。
- `GOAL_PHASE` stdout 保留为 Cursor 等宿主的加速信号，但不是通知 SSOT。
- `goal-monitor` 默认 `--max-seconds` 为 240s；如宿主 shell 上限更低，agent 必须取更小值并循环重试；如宿主 shell 默认 timeout 低于 240s，agent 必须显式提升工具 timeout。
- heartbeat 低频阈值固定为 `SOFT_STALL_MS = 10min`，由 `events.jsonl` / live snapshot 的事件时间计算，不由单次 monitor 等待时长决定。
- 跨轮次唤醒能力不放进第一版通用 CLI；后续可作为 adapter 增强接入 Claude `ScheduleWakeup` / cron 或 Cursor `notify_on_output`。
