---
name: goal 任务进度可视化
overview: 为 AgentMaison goal-runner 增加可信的长任务进度可视化能力：以 append-only events.jsonl 为事实源，派生原子 progress snapshot，提供 watch/JSON/Markdown 三类读侧接口，并让 goal-mode Skill 与外层工具按稳定契约展示阶段、活性、预算、阻塞和最新活动，降低长时间无头执行时的“卡死感”。绑定当前在研版本 2.3.0。
version: 2.3.0
todos:
  - id: progress-contract
    content: "[P0] 定义 goal progress 契约：新增 progress schema / 类型，明确 run_status、phase_status、liveness、budget、estimated_percent、source_freshness；百分比只作为估算且必须可降级为 indeterminate；非终态快照若 generated_at 超 heartbeat 间隔 2–3 倍须降级（纯文件消费者→UNKNOWN，goal-status 按 pid 死/活分流 ORPHAN_SUSPECTED/SUSPECTED_STALL，不猜 STALLED），不得信任 raw status:RUNNING；终态快照（COMPLETED/DEFERRED/PARTIAL/HALTED）一律不降级"
    status: completed
  - id: runner-events
    content: "[P0] goal-runner 写入 phase_start / harness_start / harness_end / heartbeat（覆盖整个 run 全程含 harness 窗口、挂现有 feature 锁 60s interval、substep 标 agent_invoke|harness）等中间态事件，并在 run_start 事件固化 resolved chain（投影优先读事件、缺失再 fallback resolveAutoChain）；progress_snapshot_updated 不默认写入（最多 debug-only 默认关闭）；保留 events.jsonl append-only，不把可变状态反写成事实"
    status: completed
  - id: runner-milestones
    content: "[P1] goal-runner stdout 打印稳定里程碑行（如 GOAL_PHASE phase=<p> event=start|verdict、GOAL_RUN event=end），作为 notify_on_output 锚点的显式轻契约；与“日志正文不作协议”划清边界——里程碑行须当稳定契约维护，正文仍不作协议"
    status: completed
  - id: snapshot-writer
    content: "[P0] 新增 progress-snapshot 生成器：从 events.jsonl + manifest + lock + output log mtime 派生 progress.json / progress.md，采用 tmp+rename 原子写（Windows 下 rename 撞外层 reader 句柄的 EPERM 须重试/退避），支持 resume 与旧 run 兼容"
    status: completed
  - id: stall-detection
    content: "[P0] 活性与疑似卡死判断：基于 last_event_at、feature 锁 heartbeat（仅 .feature.lock 有 60s interval；.runner.lock 无）、agent pid/exit、agent-output.log mtime、phase timeout、silent watchdog、lingering_pipe 输出诊断；软窗口用 QUIET/ATTENTION/SUSPECTED_STALL（仅提示），STALLED 只留给硬条件（phase timeout、silent watchdog kill、isLockStale=真[同机死 pid 立即 stale/跨机 90min TTL]、未闭合 invoke 超时）；须排除已被 recovered:true verdict 关闭的半完成 phase，避免误报；不靠 stdout 猜测"
    status: completed
  - id: status-cli
    content: "[P1] 新增 goal-status CLI：--feature/--run-id latest|id、--json、--markdown、--watch、--tail N；除回显 progress.json 外须实时重算 liveness（锁 pid 存活 + output log mtime）并应用 generated_at 新鲜度降级，作为“是否还活着”的真源；watch 只读 progress.json/events、不持 runner 锁、仅供人在终端"
    status: completed
  - id: skill-integration
    content: "[P1] 更新 goal-mode Skill/runbook（跨宿主）：主干=低频(5–10min)一次性 goal-status --json 定时兜底覆盖静默；notify_on_output 仅宿主支持时加速“有进展/结束”；给降级矩阵（Cursor=通知+定时双轨；Claude Code/Codex/generic=纯定时 poll 或前台跑完再汇报）；同步修订 SKILL.md ~第78行 BLOCKER 措辞，明确周期 poll goal-status 汇报被允许（≠ agent 自行 --resume 循环）"
    status: completed
  - id: outer-adapter-contract
    content: "[P1] 文档化外层对接：IDE/插件/CI 只消费 progress.json 或 goal-status --json；契约写明 generated_at 新鲜度降级规则与“后台 terminal 随 IDE 会话回收→谎报 RUNNING”风险；可选 tail events.jsonl；不解析 agent-output.log 正文作为协议"
    status: completed
  - id: visual-report
    content: "[P2] 生成人可读 progress.md（阶段条、当前 span、预算、最近事件、诊断、下一动作），并在 goal-report.md 链接最终进度快照"
    status: completed
  - id: tests
    content: "[P2] 单测与 fixture 覆盖事件回放、旧 events 兼容、原子快照、stall 分类（软/硬）、generated_at 新鲜度降级、retry 百分比单调/冻结、run_start chain 固化、latest run 选择、watch 输出；新 suite 须在 harness/tests/run-unit.ts 的 CORE_SUITES 注册，否则不被执行；cd harness && npm test 全 PASS；npm run release:verify 在仓库根执行（涉发布件/准备发版时）"
    status: completed
isProject: false
---

# goal 任务进度可视化

> 版本绑定：`package.json.version = 2.3.0`。  
> 本 plan 只定义 AgentMaison 自身的开发蓝图；实施时若改动发布内容，仍须 `cd harness && npm test` 全 PASS。

## 背景

goal 模式的痛点不是“没有一个百分比”，而是用户在几十分钟甚至数小时里看不到可信信号：它到底还活着吗、卡在哪个 phase、是否在等外部条件、有没有烧穿预算、最后一次真实活动是什么。

Maison 现有基础已经不错：

- `goal-runner.ts` 有 deterministic 编排、feature/run 双锁、预算、resume、`events.jsonl`、`goal-report.{json,md}`。
- `agent-invoke.ts` 已有 headless spawn、timeout/tree-kill、`agent-output.log` 流式写入。
- `goal-phase-snapshot.ts` 已把全局 phase reports 复制到 run-scoped 证据目录，避免报告互相覆盖。
- `goal-mode/SKILL.md` 定位为薄入口，适合把“如何对用户汇报运行状态”固化到 Skill，而不是让无头 runner 直接扮演 UI。

缺口是：`events.jsonl` 偏审计，`goal-report` 偏终态；中间缺少一个稳定、可轮询、可展示、可被外层工具消费的 **progress projection**。

## 业界参考与提炼

本 plan 采用这些稳定模式，而不是照搬某个产品 UI：

- GitHub Actions：按 workflow/job/step 展示状态、日志、耗时；失败时能定位到具体 step 和日志行。Maison 对应：phase/substep/最近事件/日志尾部，而不是只给“正在运行”。
- Temporal：Workflow Event History 是 durable append-only log，可用于恢复和审计；长 workflow 也要注意事件数量上限。Maison 对应：`events.jsonl` 继续作为事实源，`progress.json` 只是派生快照。
- LSP Work Done Progress：有 `begin/report/end` 三态；百分比可选，且必须单调，无法保证时应使用 indeterminate。Maison 对应：只在 phase DAG 可估算时显示 `estimated_percent`，否则显示阶段计数和活性。
- OpenTelemetry：把 trace / metrics / logs 分开又可关联。Maison 对应：events 是 trace/log，budget/elapsed 是 metrics，run_id/phase/invoke_id 是关联键。
- OpenAI Agents SDK tracing：agent run 用 trace/span 表达，长任务需考虑导出/刷新时机。Maison 对应：每个 phase、agent invoke、harness run 都应形成可回放 span。

## 设计原则

1. **可信优先**：宁可显示“无法估算，但仍有心跳”，也不显示看似精准的 73%。
2. **事实源不可变**：`events.jsonl` append-only；`progress.json`、`progress.md` 均可重建。
3. **无头 runner 只产信号，不承担 UI**：runner 写事件和快照；CLI、Skill、IDE、浏览器读快照展示。
4. **活性与完成度分离**：完成度回答“走到哪里”，活性回答“是不是还活着”。
5. **外层契约稳定**：外部只读 `progress.json` 或 `goal-status --json`；不要求解析 runner stdout。
6. **隐私与体积可控**：快照只放日志尾部摘要/路径/字节数/mtime，不复制完整 agent 输出。
7. **时间驱动兜底优先**：覆盖"静默卡死"只能靠低频定时 poll（输出驱动的 `notify_on_output` 在无输出时永不触发）。通知是"有进展/结束"的加速器，不是正确性来源。
8. **快照可能过期**：任何消费者都不得无条件信任 `progress.json` 的 `status`；`generated_at` 陈旧（超 heartbeat 间隔 2–3 倍）时须降级，或改用 `goal-status`（实时重算活性）。

## 目标体验

### CLI watch

```text
Goal bc-openCard · run 20260610T084004Z · RUNNING
[prd ✓] [design ✓] [coding ●] [review ·] [ut ·] [testing ·]

Current: coding / agent_invoke cursor-agent -p ...
Liveness: active · last event 18s ago · output log updated 9s ago
Budget: turns 3/20 · wall 31m/240m · phase timeout 19m/60m
Latest: summary.json not yet refreshed; agent-output.log 142 KiB
Next: wait for agent_invoke_end, then harness_start(coding)
```

### 软窗口（疑似，仅提示）

```text
Goal bc-openCard · run 20260610T084004Z · SUSPECTED_STALL
[prd ✓] [design ✓] [coding ~] [review ·] [ut ·] [testing ·]

Current: coding / agent_invoke
Liveness: no event for 12m (soft window > 10m); output log unchanged for 11m; feature lock heartbeat fresh (60s interval)
Diagnosis: runner still alive (lock fresh) but agent quiet; LLM 长思考/等外部条件也会这样，未必卡死
Next: keep waiting; re-poll goal-status in a few min; not yet hard-stale (lock 90m / phase timeout 60m)
```

### 硬窗口（真异常 → STALLED）

```text
Goal bc-openCard · run 20260610T084004Z · STALLED
[prd ✓] [design ✓] [coding !] [review ·] [ut ·] [testing ·]

Current: coding / agent_invoke
Liveness: open agent_invoke_start exceeded phase timeout 60m; or feature lock stale (>90m) with dead pid
Diagnosis: hard threshold crossed; runner will tree-kill on timeout, or lock is orphaned
Next: inspect phases/coding/agent-output.log; expect tree-kill, or reclaim stale lock
```

这类输出的价值是让用户知道"它没有静默消失"，区分"安静但活着"与"真异常"，以及何时需要人工介入。

> 锁信号说明：仅 `.feature.lock` 有 60s `setInterval` heartbeat（`LOCK_HEARTBEAT_MS`），并在 phase 边界手动 `touchLock`；`.runner.lock` 只有 acquire/release，无 interval，liveness 只能用其存在性 + `updated_at`，不要把它当 heartbeat。

## 数据模型

### `progress.json`

路径：`doc/features/<feature>/goal-runs/<run-id>/progress.json`。

建议 schema：

```json
{
  "schema_version": "1.0",
  "run_id": "20260610T084004Z",
  "feature": "bc-openCard",
  "status": "RUNNING",
  "status_reason": null,
  "generated_at": "2026-06-10T10:40:00.000Z",
  "source": {
    "events_path": "doc/features/bc-openCard/goal-runs/20260610T084004Z/events.jsonl",
    "events_count": 42,
    "last_event_at": "2026-06-10T10:39:42.000Z",
    "last_event_type": "heartbeat"
  },
  "chain": {
    "phases": ["prd", "design", "coding", "review", "ut", "testing"],
    "current_phase": "coding",
    "current_index": 2,
    "total": 6,
    "estimated_percent": 38,
    "percent_kind": "estimated"
  },
  "phase": {
    "name": "coding",
    "status": "AGENT_RUNNING",
    "attempt": 1,
    "started_at": "2026-06-10T10:08:00.000Z",
    "elapsed_ms": 1920000,
    "substep": "agent_invoke"
  },
  "liveness": {
    "state": "ACTIVE",
    "last_activity_at": "2026-06-10T10:39:51.000Z",
    "seconds_since_activity": 9,
    "signals": {
      "feature_lock_heartbeat": "fresh",
      "runner_lock": "present",
      "agent_output_log": "updated",
      "child_process": "unknown",
      "lingering_pipe": false
    }
  },
  "budget": {
    "turns_used": 3,
    "turns_limit": 20,
    "wall_elapsed_ms": 1920000,
    "wall_limit_ms": 14400000,
    "phase_timeout_ms": 3600000
  },
  "artifacts": {
    "agent_output_log": "doc/features/bc-openCard/goal-runs/20260610T084004Z/phases/coding/agent-output.log",
    "summary_path": null,
    "goal_report_path": null
  },
  "recent_events": [
    {"ts": "2026-06-10T10:39:42.000Z", "type": "heartbeat", "phase": "coding"}
  ],
  "next_action": "wait_for_agent_invoke_end"
}
```

> **新鲜度降级（BLOCKER 契约）**：`status` 是写快照那一刻的判断，**可能已过期**。runner 被杀（如 Cursor 后台 terminal 随 IDE 会话回收、关窗/重启 IDE）后，`progress.json` 会**永远停在 `status: RUNNING`**。因此读 `progress.json` 时须先比对 `generated_at`，但**仅对非终态快照降级**：
>
> - **仅适用于** `status ∈ {RUNNING, PENDING, WAITING_EXTERNAL}` 等非终态。若 `status ∈ {COMPLETED, DEFERRED, PARTIAL, HALTED}`（终态），**一律不降级**——终态快照不再刷新，`generated_at` 旧是正常的，不得误判成 STALLED/UNKNOWN。
> - **降级目标按消费者能力分流**：纯文件消费者（读不到锁 pid，无法证明任何事）→ 一律降 `UNKNOWN`，**不要猜 STALLED**；`goal-status`（能查锁 pid + `agent-output.log` mtime）→ 实时重算：同机 pid 已死 → `ORPHAN_SUSPECTED`；同机 pid 活但静默超阈值 → `SUSPECTED_STALL`（软）/ `STALLED`（runner_unresponsive，硬）。
> - **跨机分支**：锁 `record.hostname` 与本机不一致时，本地 `isPidAlive` 探测不可信 → **不得判 `ORPHAN_SUSPECTED`**，只能保守降 `UNKNOWN` / `SUSPECTED_STALL`，等 90min TTL 兜底。
> - 触发阈值：`generated_at` 距今超过 heartbeat 间隔的 2–3 倍（如 > 3min）。需要权威活性时一律改调 `goal-status`，不只是回显文件。

### 状态枚举

Run status：

- `PENDING`：manifest 已写，但尚无 `run_start`。
- `RUNNING`：有新鲜活性信号，未终态（含软窗口的 `QUIET`/`SUSPECTED_STALL`，仍归 RUNNING，仅在 liveness 上提示）。
- `STALLED`：仅 **硬条件**满足方可置 STALLED——phase timeout / silent watchdog kill / `isLockStale(record)` 为真且 **pid 仍活（runner_unresponsive：进程在但事件循环/心跳已死）**；不靠 `generated_at` 过期单独推断 STALLED。
- `WAITING_EXTERNAL`：当前或上游是 DEFERRED，可继续或等待外部条件。
- `COMPLETED` / `DEFERRED` / `PARTIAL` / `HALTED`：沿用现有终态；**终态快照不参与新鲜度降级**。
- `UNKNOWN`：证据不足、events 损坏，或非终态快照 `generated_at` 过期且消费者查不到锁 pid（保守降级，不猜 STALLED）。

Phase status：

- `NOT_STARTED`
- `PROMPT_READY`
- `AGENT_RUNNING`
- `AGENT_DONE`
- `HARNESS_RUNNING`
- `PASSED`
- `DEFERRED`
- `FAILED`
- `RETRYING`
- `HALTED`

Liveness state（注意：软状态只表达"安静"，不等于"卡死"）：

- `ACTIVE`：最近事件、输出日志或 feature 锁 heartbeat 新鲜。
- `QUIET`：短时间无输出，但未超过软窗口。
- `ATTENTION` / `SUSPECTED_STALL`：超过软窗口、未见推进，但锁仍新鲜、未到硬阈值——**疑似**，仅提示，不下"卡死"结论（LLM 长思考 / 等外部条件也会这样）。
- `STALLED`：**硬条件**满足（见下），可判定异常。
- `STALLED` 的细分：`isLockStale` 为真**且 pid 仍活** → runner 进程在但无响应（runner_unresponsive，区别于 ORPHAN）。
- `ORPHAN_SUSPECTED`：`isLockStale` 为真**且同机 pid 已死**、却无 `run_end`（锁成孤儿）。跨机 hostname 不一致时探测不了 pid，**不判 ORPHAN**，保守降 UNKNOWN/SUSPECTED_STALL。
- `DONE`：终态。

阈值分层（避免误报；关键纠偏）：

- **软窗口（`QUIET` / `SUSPECTED_STALL`，仅提示）**：`seconds_since_activity` 超过约 5–10 分钟（无新事件 / 输出日志 mtime 不变），但锁仍新鲜、未到 phase timeout。**不要**用 `STALLED` 命名——feature 锁新鲜只证明 runner 进程活着，**不能证明 agent 卡死**；LLM/CLI 数分钟无 stdout 很常见。
- **硬阈值（`STALLED` / `ORPHAN_SUSPECTED`，真异常）**：未闭合 `agent_invoke_start`（且未被 `agent_invoke_recovered` / `recovered:true` verdict 关闭）超过单 phase `timeout_seconds`（默认 3600s）→ runner 自身 tree-kill；或 silent watchdog kill；或 `isLockStale(record)` 为真。
  - **`isLockStale` 三分支矩阵（姊妹 patch 改写，`goal-run-lock.ts:46`）**，progress 须以它为准、不要自行复刻"超 90min 且 pid 死"旧逻辑：
    - 同机（`record.hostname === os.hostname()`）+ pid 已死 → **立即 stale** → `ORPHAN_SUSPECTED`（不再等 90min）。
    - 同机 + pid 仍活 + 心跳 `updated_at` 超 `STALE_LOCK_MS = 90min` → **也 stale** → `STALLED`（runner_unresponsive；旧逻辑下 pid 活着永不 stale，是新增覆盖）。
    - 跨机（hostname 不一致）→ 本地探不了 pid，**只看 TTL**，超 90min → 保守 `UNKNOWN`/`SUSPECTED_STALL`，**不判 ORPHAN**。
  - progress 的软窗口只是"早于硬阈值给人提示"，绝不替代 runner 的硬超时语义。

## 事件扩展

**当前主路径写入 8 种**：`run_start`、`resume`、`agent_invoke_start`、`agent_invoke_end`、`phase_verdict`、`run_end`、`budget_wall_clock`、`budget_turns`。**resume 恢复路径另有 2 种**：`agent_invoke_recovered`、带 `recovered: true` 的 `phase_verdict`（见下文姊妹 patch 对齐）。另有 legacy `agent_invoke`（无 `_start/_end`），仅在 `countAgentInvokeStarts` 做旧 run 兼容读取、当前不再写入；投影时需识别它以兼容历史 events。

> **与姊妹 patch「goal-runner close 挂起修复」（已完成）对齐**：该 patch 已新增以下事件/字段，本 plan 投影须一并识别——
> - `agent_invoke_end` 增 `lingering_pipe` 字段（agent 已退出但 stdio 管道被外部进程持有）；作为 liveness 诊断信号，须在 `progress.json.liveness.signals` 或 `recent_events` 中可见，不等同失败。
> - resume 半完成恢复时编排器补写 `phase_verdict` 带 `recovered: true`，并可追加 `agent_invoke_recovered` 标记事件（`goal-runner-phase.ts:438` 的 `detectHalfCompletedPhaseRecovery`）。
> - **span 重建第三种闭合方式**：现有配对是 `agent_invoke_start` ↔ `agent_invoke_end`；**`agent_invoke_recovered`（及 `recovered:true` verdict）必须作为第三种"闭合该 invoke"的方式**。否则每个经恢复续跑的 run 都会留下永远未闭合的 `agent_invoke_start`，历史回放与当前 run 都被误判 `STALLED`——正踩 plan"避免误报"的红线。投影 span 重建规则与测试 fixture 都须覆盖。

新增事件应只补足“中间态”：

- `phase_start`: phase 进入，含 `phase_index` / `phase_total` / `attempt`。
- `prompt_written`: prompt 文件已写，含 `prompt_path`。
- `heartbeat`: runner 定期写入，**覆盖整个 run（`run_start` → `run_end` 全程，含 harness 执行窗口）**，不只 agent invoke 期间；含 `phase` / `substep`（标注当前在 `agent_invoke` 还是 `harness`）/ `elapsed_ms` / `turns_used` / `lock_updated_at` / `agent_output_mtime` / `agent_output_bytes`。**理由**：harness phase（如 hmos profile 的 `hvigor-runner.ts` 跑 hvigor 编译 / 真机 UT）可能数分钟到十几分钟，期间事件流静默；若 heartbeat 不覆盖，`generated_at` 会超 3min 触发新鲜度降级，造成误报 STALLED/UNKNOWN，正好违背"避免误报"目标。
- `harness_start`: 开始执行 `harness-runner`。
- `harness_end`: harness 进程结束，含 `exit_code` / `duration_ms`。

此外，**`run_start` 事件固化 resolved chain**：写入 `chain: [...]`（由 `resolveAutoChain()` 解析后的有序 phase 链）。投影**优先读事件里的 chain**，缺失再 fallback 实时 `resolveAutoChain()`。否则 workflow 配置在 run 结束后变更，历史 run 的投影会与当时不符。

`progress_snapshot_updated` **不默认写入**：它是"派生快照已更新"的元事件，常写会让 append-only 事实源混入投影层自身状态，甚至形成"写快照→写事件→再刷快照"的循环/写放大。最多作为 **debug-only 且默认关闭**。

注意：

- 不新增高频 stdout 行事件，避免 `events.jsonl` 膨胀；日志细节仍在 `agent-output.log`。
- `heartbeat` 默认 30s 或 60s，一次 goal 几小时也在可控规模内。
- 事件 schema 必须向后兼容：旧 run 可被投影为 `UNKNOWN/RUNNING/HALTED` 等保守状态。

## 投影算法

新增 `harness/scripts/utils/goal-progress.ts`，纯函数优先：

1. 读取 `manifest.json`、`events.jsonl`、已有 `goal-report.json`、lock 文件、当前 phase `agent-output.log` stat。
2. phase 链**优先取 `run_start` 事件里固化的 `chain`**；缺失（旧 run）再 fallback 实时 `resolveAutoChain()`。避免配置漂移导致历史 run 投影失真。
3. 从事件流重建 phase span：
   - `phase_start` 开 span。
   - `agent_invoke_start/end`、`harness_start/end` 作为子 span；**invoke 配对有三种闭合方式**：`agent_invoke_end`、`agent_invoke_recovered`、或 `recovered:true` 的 `phase_verdict`——任一出现即视为该 `agent_invoke_start` 已闭合。
   - `phase_verdict` 关闭 phase；**`recovered:true` 的 verdict 同样视为终态关闭**（标 `PASSED`，并在 diagnostics/`recent_events` 标注 `recovered`），即使该 phase 的 `agent_invoke_start` 未闭合（半完成恢复路径）也按已 advance 处理。
4. 计算完成度：
   - phase 级：已终态 phase / 总 phase。
   - substep 级：仅在当前 phase 内做粗粒度权重，例如 prompt 5%、agent 60%、harness 25%、verdict 10%。
   - 如果缺少必要事件或 resume 状态不连续，`percent_kind = "indeterminate"`，展示 `current_index/total`。
5. 计算活性：
   - 最近事件时间。
   - 最近 `heartbeat` 时间。
   - lock `updated_at`。
   - 当前 `agent-output.log` mtime/size。
   - 未闭合 `agent_invoke_start` 是否超过 timeout——**但先排除已被 `recovered:true` verdict 关闭的 phase**，否则会把已恢复的 run 误判 STALLED。
   - 末条 `agent_invoke_end.lingering_pipe === true`：agent 已退出、管道被外部进程持有；作为诊断（非卡死），区别于"真静默"。
6. 生成 `progress.json` 与 `progress.md`。

写入必须使用 `progress.json.<pid>.tmp` + `rename`，避免外层读到半截 JSON。**Windows 注意**：外层 reader 持有句柄时 `rename` 可能抛 `EPERM`/`EACCES`，须短重试 + 小退避（如 3 次、各 50–100ms），仍失败则跳过本次刷新（下个事件会再写），不得 crash runner。

## stdout 里程碑契约

经核实，现状 `goal-runner.ts` stdout 在 **agent invoke 全程静默**（agent 输出只进 `agent-output.log`，见 `agent-invoke.ts` 的 `createWriteStream` + `bumpActivity`，约 `569-597`），且从不打印 phase 切换/STALLED 行；stdout 唯一稳定行是结尾的 `GOAL_RUN_SUMMARY`（`goal-runner.ts:748`）。因此 `notify_on_output` 在最易卡死的 agent invoke 窗口**没有任何东西可匹配**。

为给输出驱动通知一个稳定锚点，runner 增加**显式里程碑行**（单行、稳定前缀、键值对，作为受维护的轻契约）：

```text
GOAL_PHASE phase=coding event=start index=2 total=6 attempt=1
GOAL_PHASE phase=coding event=verdict result=advance
GOAL_RUN event=end status=COMPLETED run_id=20260610T084004Z
```

边界说明（与"日志正文不作协议"划清）：

- **里程碑行 = 稳定契约**：前缀/键名变更视为破坏性变更，需走版本演进；外层可对其写 `notify_on_output` 正则。
- **日志正文 / agent-output.log 仍不作协议**：内容与 adapter/模型强相关。
- 里程碑行**不能覆盖"静默卡死"**——卡死时恰恰没有新行输出。所以它只是"有进展/结束"的加速器，**正确性仍由时间驱动 poll 兜底**（见外层对接）。

> **可选未来增强（不在第一版）**：既然 runner 进程在 agent 卡死时自身仍活（feature 锁 60s interval 仍在），可让它在 stdout 周期打一行 quiet heartbeat 里程碑（如 `GOAL_HEARTBEAT quiet_s=720`）。这样宿主 `notify_on_output` 用正则匹配 quiet 阈值即可主动推送"软卡死"提醒，定时 poll 只需兜底"runner 本身死掉"，空轮询频率可降到 15–30min。代价是 stdout 行数增多 + 更复杂的正则；第一版不做也完全成立。

## CLI 设计

新增脚本：`harness/scripts/goal-status.ts`。

命令：

```bash
cd framework/harness
npx ts-node scripts/goal-status.ts --feature bc-openCard --run-id latest --json
npx ts-node scripts/goal-status.ts --feature bc-openCard --run-id 20260610T084004Z --markdown
npx ts-node scripts/goal-status.ts --feature bc-openCard --run-id latest --watch --tail 20
```

行为：

- `--json`：输出 `progress.json` 等价结构，适合 IDE/插件/CI。
- `--markdown`：输出短 Markdown，适合 agent 回给用户。
- `--watch`：轮询 progress/events，重绘文本；不写任何 runner 产物，不拿锁。**面向人在终端**；Cursor agent 应改用一次性 `--json/--markdown` + Shell `notify_on_output`，勿在 agent 循环里跑 `--watch`。
- `--tail N`：附带最近 N 条事件摘要，默认不展开 agent log 正文。
- `latest`：从 `goal-runs/*/manifest.json` + `events.jsonl` 选最近 `run_start` 或目录 mtime，忽略 `.feature.lock` 等非 run 目录。

## runner 接入

`goal-runner.ts` 的最小改动：

- `run_start` 事件写入 `chain`（resolved phase 链），并立即写第一份 `progress.json`。
- 每个 phase 前写 `phase_start` 事件 + stdout 里程碑行 `GOAL_PHASE ... event=start`。
- prompt 写盘后写 `prompt_written`。
- **全程**写 `heartbeat` 事件（`run_start` → `run_end`，含 harness 窗口），节奏直接挂在现有 feature 锁 `LOCK_HEARTBEAT_MS`（60_000）的同一 interval 回调上——该 interval 本就全程存在（`goal-runner.ts:311` 的 `setInterval(... touchLock ...)`），天然覆盖全程，不引入第二个定时器；`substep` 字段标注当前在 `agent_invoke` 还是 `harness`，heartbeat 读 `agent-output.log` stat。这同时兜底了快照节流的尾部滞后：phase 边界被节流跳过的状态，最多 60s 后被 heartbeat 刷新。
- `runHarnessPhase()`（现已为 `async` + `createChildSettleWaiter`，`goal-runner.ts:214`）前后写 `harness_start/end`，包住其 `await`。
- `phase_verdict` 后打 stdout 里程碑行 `GOAL_PHASE ... event=verdict result=<...>`；终态打 `GOAL_RUN event=end status=<...>`，**与现有 `GOAL_RUN_SUMMARY` 并存（不合并）**——`GOAL_RUN_SUMMARY` 虽暂无代码消费者，但用户肌肉记忆 / 外部脚本可能 grep 它，并存零成本、少一个决策点。
- `writeProgressSnapshot()` 加轻量节流：距上次写 < N 秒（如 3–5s）则跳过，避免 phase 边界连写多条事件造成写放大；终态 `run_end` 后强制 flush 一次。

开放问题：heartbeat 的写入与 feature 锁 `touchLock` 共用同一 interval 回调，但逻辑分离——lock 写失败不应阻断 progress 写入，反之亦然。`.runner.lock` 无 interval，不参与 heartbeat 节奏。

## 外层对接

### goal-mode Skill（跨宿主）

Skill 不应长篇解释 UI，而应规定主 agent 的行为。**汇报机制是双轨**，缺一不可：

- **主干 = 时间驱动兜底**：runner 长时间运行时，agent 每隔约 5–10min 跑**一次性** `goal-status --json/--markdown`（poll 一帧即退出，非 `--watch` 常驻、非 `--resume` 循环）。这是唯一能覆盖"静默卡死"的路径——输出驱动通知在无输出时不会触发。
- **加速器 = 输出驱动通知（可选）**：宿主支持时（如 Cursor 的 `notify_on_output`）匹配 stdout 里程碑行，把"有进展/结束"更快推给 agent，减少空轮询；不支持的宿主仅靠主干定时 poll。
- 启动 runner 后，立刻告诉用户 `run_id` 与 `progress.json` 路径。
- 终态后读取 `goal-report.md` + `progress.md`，说明完成/阻塞/失败。
- 汇报活性时**经 `goal-status`**（实时重算）而非直接信 `progress.json` 的 raw status；区分软窗口（`SUSPECTED_STALL`，安静但可能活着）与硬 `STALLED`（已判定异常），给证据：最后事件、最后日志更新时间、feature 锁是否新鲜、下一建议。

> **需同步修订的 SKILL.md BLOCKER**：现有 [`skills/project/goal-mode/SKILL.md`](skills/project/goal-mode/SKILL.md) 约第 78 行的 BLOCKER 是按"前台同步 / 主 agent 读完 `goal-report` 再汇报"写的。改为后台启动 + 定时 poll 后，须更新措辞，**明确允许周期性 poll `goal-status` 汇报**（这不是 agent 自行 `--resume` 续跑，续跑仍须用户显式触发）。

### 跨宿主降级矩阵

Skill 是跨宿主的（Cursor / Claude Code / Codex / generic 跳板都存在），不能只写 Cursor：

- **Cursor**：后台 `block_until_ms: 0` 起 runner + `notify_on_output` 匹配里程碑行（加速）+ 定时 `goal-status` poll（兜底）。注意 Cursor 后台 terminal 生命周期绑 IDE 会话，关窗/重启 IDE 会杀 runner → 之后 `progress.json` 谎报 RUNNING，必须靠 `goal-status` 实时重算/新鲜度降级识别。
- **无 `notify_on_output` 的宿主（Claude Code / Codex / generic）**：去掉加速器，纯靠定时 `goal-status` poll；或在不便后台时前台跑完再汇报。
- 所有宿主共用同一 `progress.json` / `goal-status` 契约，差异只在"何时触发读"。

### IDE / 插件 / Web UI

外层只依赖两个入口：

- `progress.json`：稳定文件契约，适合 watch filesystem。
- `goal-status --json`：稳定命令契约，适合无法直接解析路径的外层。

不建议外层直接解析：

- runner stdout：可能被 terminal 截断、重定向、shell 行为影响。
- `agent-output.log` 正文：内容与 adapter/模型强相关，不是协议。
- `.feature.lock`：只作为诊断输入，不是对外 API。

### 无头 CLI 是否合适

合适，但角色要摆正：

- 适合：生产结构化事件、刷新快照、留下可恢复证据。
- 不适合：把 stdout 当 UI 协议、靠交互式 TUI 承载唯一状态、承诺精确百分比。

这意味着 Maison 第一版应优先做 **事件 + 快照 + 一次性 status CLI（agent 定时 poll）+ 稳定里程碑行（可选通知锚点）**，而不是直接做常驻 Web dashboard 或让 agent 跑常驻 `--watch`（`--watch` 仅供人在终端）。Web/插件以后可以自然消费同一 `progress.json` / `goal-status`。

## 可视化报告

新增 `progress.md`，供人和 agent 快速阅读：

```markdown
# Goal Progress - bc-openCard

- Run ID: 20260610T084004Z
- Status: RUNNING
- Current: coding / AGENT_RUNNING
- Liveness: ACTIVE, last activity 9s ago
- Budget: turns 3/20, wall 31m/240m

## Phases

| Phase | Status | Attempts | Duration | Evidence |
|-------|--------|----------|----------|----------|
| prd | PASSED | 1 | 8m | phases/prd/harness/summary.json |
| design | PASSED | 1 | 13m | phases/design/harness/summary.json |
| coding | AGENT_RUNNING | 1 | 31m | phases/coding/agent-output.log |
| review | NOT_STARTED | - | - | - |
| ut | NOT_STARTED | - | - | - |
| testing | NOT_STARTED | - | - | - |

## Recent Activity

- 10:39:42 heartbeat coding agent_invoke
- 10:08:12 agent_invoke_start coding cursor-agent -p ...
```

终态 `goal-report.md` 增加一行链接：`Progress snapshot: progress.md`。

## 测试策略

单测优先放在 `harness/tests/unit/`：

- `goal-progress.unit.test.ts`
  - 新事件完整 happy path → `COMPLETED`、phase 状态正确。
  - 旧 events（无 `phase_start/harness_start`）→ 可保守投影。
  - 未闭合 `agent_invoke_start` + output log 新鲜 → `RUNNING/ACTIVE`。
  - 软窗口：无事件超 5–10min 但锁新鲜、未到 timeout → `SUSPECTED_STALL`（**不是** `STALLED`）。
  - 硬窗口：未闭合 `agent_invoke_start` 超 phase timeout / silent watchdog kill → `STALLED`。
  - 半完成恢复：未闭合 `agent_invoke_start` + 之后 `recovered:true` 的 `phase_verdict`（含/不含 `agent_invoke_recovered`）→ phase 判 advance、**不**报 STALLED（与姊妹 patch 恢复路径对齐）。
  - `agent_invoke_end.lingering_pipe===true` → 诊断为"管道滞留"而非卡死，不误报 STALLED。
  - 锁 stale 分流（`isLockStale` + 无 `run_end`）：同机 pid 已死 → `ORPHAN_SUSPECTED`；同机 pid 仍活 → `STALLED` / runner_unresponsive；跨机 TTL stale → 保守 `UNKNOWN` / `SUSPECTED_STALL`，不判 ORPHAN。
  - 长 harness 窗口（`harness_start` 后数分钟无其他事件）+ heartbeat 仍在 → 不降级，保持 `RUNNING/ACTIVE`（验证 heartbeat 覆盖全程、不误报）。
  - 非终态快照 `generated_at` 过期（> heartbeat 间隔 2–3 倍）：纯文件消费者 → `UNKNOWN`（不猜 STALLED）；`goal-status` pid 死 → `ORPHAN_SUSPECTED`、pid 活但静默 → `SUSPECTED_STALL`。
  - **终态旧快照不降级**：`status ∈ {COMPLETED, DEFERRED, PARTIAL, HALTED}` 且 `generated_at` 很旧 → 原样保留终态，不降 STALLED/UNKNOWN。
  - chain 取自 `run_start` 事件；事件缺失才 fallback `resolveAutoChain`；配置漂移不影响历史 run 投影。
  - 百分比单调；phase retry 不回退（冻结或降级 `indeterminate`）；无法保证时 `indeterminate`。
  - `latest` run 选择忽略锁文件和损坏目录。
  - tmp+rename 写快照，JSON 永远可解析；模拟 Windows `EPERM` 时重试后不 crash。
- CLI 测试：
  - `--json` 输出合法 JSON。
  - `--markdown` 含 phase、liveness、budget、next_action。
  - `--watch` 可用 fake clock/短轮询跑一轮后退出。

验收（注意 cwd 不同）：

```bash
# 开发验收：harness 目录
cd harness && npm test
```

```bash
# 发布门禁：仓库根（release:verify 是根脚本，不在 harness）
npm run release:verify
```

`release:verify` 只有在实施涉及发布件或准备发版时必跑；本 plan 文件本身属于 dev-only。

## 不在第一版范围

- 不做常驻后台服务、不引入数据库、不要求宿主项目根安装依赖。
- 不做复杂浏览器 dashboard；最多生成 `progress.md`，后续再考虑静态 HTML 或 Codex/IDE 插件视图。
- 不尝试从 LLM 文本推断“思考进度”；只展示 runner 可证明的事实。
- 不把 token 统计作为 P0。若 adapter 将来能稳定提供 usage，可扩展到 `budget.tokens_used`。
- 不改变 phase 裁决语义，不把 DEFERRED 伪装成完成。

## 实施顺序

1. 契约先行：`GoalProgressSnapshot` 类型、schema（含 `generated_at` 新鲜度降级）、投影纯函数（chain 优先读 `run_start` 事件）。
2. runner 事件补点：`phase_start`、`harness_start/end`、heartbeat，`run_start` 固化 chain；`progress_snapshot_updated` 不默认写。
3. runner stdout 里程碑行：`GOAL_PHASE`/`GOAL_RUN`（通知锚点轻契约）。
4. 原子快照：节流刷新 `progress.json`（Windows `EPERM` 重试），终态刷新 `progress.md`。
5. CLI：`goal-status --json/--markdown/--watch`，实时重算 liveness + 新鲜度降级。
6. Skill/runbook 接入：双轨（定时 poll 兜底 + 可选通知）、跨宿主降级矩阵、SKILL.md BLOCKER 措辞同步。
7. 单测与 fixtures 补齐（软/硬 stall、新鲜度降级、retry 百分比、chain 固化），CORE_SUITES 注册，再跑 `cd harness && npm test`。

## 参考资料

- GitHub Actions workflow run logs / jobs / steps / durations: <https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs>
- GitHub Actions run history / CLI detail view: <https://docs.github.com/en/actions/how-tos/monitor-workflows/view-workflow-run-history>
- Temporal Event History: <https://docs.temporal.io/workflow-execution/event>
- Language Server Protocol Work Done Progress: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workDoneProgress>
- OpenTelemetry signals: <https://opentelemetry.io/docs/concepts/signals/>
- OpenAI Agents SDK tracing: <https://openai.github.io/openai-agents-python/tracing/>
