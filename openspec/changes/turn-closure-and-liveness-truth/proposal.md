## Why

宿主 run `20260825T011950Z-eddfb2`（Codex CLI，bc-openCard-1）09:20 起跑、12:11 halt 终局。
coding i3 于 02:58:52Z 打完终稿并**自证 FAIL**（445,503 tokens，结论「应回退 plan」），此后
输出 **65 分钟零变化**，一路空等到 90min 硬超时——**FAIL turn 没有任何收口信号**：

1. 完成探针的四条件含 `receipt_status=passed` + `closure_status=closed`，而真实 FAIL 的回执
   **依设计恒为骨架**（runner 每 invoke 前 force 重写未完成骨架、prompt 明令 FAIL 不得声称
   完成、宿主终局回执即骨架）——探针只识别 PASS 形态闭环证据，对 FAIL 结构上不可命中；
2. Codex 长 turn 自然退出不可依赖（spec/plan/i3 全靠 kill；i4/i5 短 turn 才自然 exit 0）；
3. silent watchdog 默认 0 且 goal-runner 从未 opt-in——一个**从未生效**的第二判死权威。

期间还有两处如实性缺口：活性把 runner **自写 heartbeat** 计入 activityTypes，输出停滞 65
分钟仍恒报 `ACTIVE`；retry prompt 对超时续作**无条件**硬写「NOT a content failure」，而同一
attempt 的 `phase_verdict` 明明同时带着 `timed_out` 与 harness 精修的 `failure_kind`。

本 change 只做**收口真值**：给有 terminal 契约的 adapter 接上契约终态，删除从未生效的假权威，
把活性的工作面与控制面分开，并让超时话术如实并陈两轴。

## What Changes

- **T1（P0）Codex terminal 收口**：`agents/codex/adapter.yaml` 声明 `output_delivery: streaming`
  与 `usage_capture: stdout_json`；`--json` 由 `codexArgv` **独立追加**（尾部，不动既有已验证
  旗标顺序）。terminal 解析器**直接消费 stdout chunk**（跨 chunk 行缓冲，不要求产出
  `agent-events.jsonl`），**只认两个契约终态**：`turn.completed` → `completionObserved`（复用
  既有 grace/kill 与 R8 互斥原语）；`turn.failed` → `terminalFailureObserved`（`completionObserved`
  恒 false，exit 0 时规范化非零，保住 `agentFailed` 语义）。**顶层 `error` 只是诊断**——
  `error → 重试成功 → turn.completed` 是官方合法序列，故 error 不设 completionObserved、
  不触发 settle/kill、**不进** api_disconnected / failure classifier / retry 任何判据。
  **`tool_event_provenance` 明确保持 `none`**：stdout 有 terminal JSONL ≠ 工具调用可审计，
  codex 不入 critic 图片读取解析器注册表，不签发 verified 回执；**不新增** adapter 能力字段。
  同批删除 silent watchdog **生产链**（读侧 `silent_killed` 字段保留兼容历史事件）。
  完成探针**只做文档归位、判据零改动**：明确它是「PASS 形态闭环证据加速器」，放宽四条件=
  死修复+轮内自修复误杀；FAIL 收口责任归 adapter terminal 契约，无契约 adapter 诚实接受
  hard timeout 兜底，不用无效回执冒充信号。
- **T2（P1）活性分离工作面与控制面**：存在未闭合 invoke ∧ `outputSignal='unchanged'` ∧
  **本 run 事件**的 `adapter_probe.output_delivery='streaming'` → 降既有枚举 `SUSPECTED_STALL`；
  查进度补「agent 输出已停滞 X 分钟」（X=now−`agent-output.log` mtime，**不复用**含 heartbeat 的
  `seconds_since_activity`）。`buffered`/`unknown` 不降级。**只观测不干预**：不触发 kill/恢复，
  不新增枚举或第二 reducer。
- **T3（P1）超时话术两轴并陈**：同一 invoke 窗口存在新鲜 harness `FAIL`/`INCOMPLETE` 时，
  超时续作块两轴并陈（transport 说超时+产物在盘、quality 说 harness 判了什么 kind），
  删除无条件「NOT a content failure」断言；**纯超时保持既有文案不变**。只改话术层。

显式非目标：不追 Codex 进程钉住的根因；不改 90min timeout 数值与 3/30 预算语义；不动文书面
与单 turn 推理基线；不新增 liveness 枚举/第二真源；invoke 级日志证据保全另立项。

## Capabilities

### Modified Capabilities

- `goal-runner`：adapter terminal 契约终态收口与失败语义保真；活性工作面/控制面分离；
  超时 retry 话术的两轴如实性。
- `agent-adapters`：Codex 输出交付/用量采集声明与 terminal 事件解析归属边界。

## Impact

- Affected specs: goal-runner、agent-adapters
- Affected code: `agents/codex/adapter.yaml`、新 `harness/scripts/utils/codex-terminal-events.ts`、
  `harness/scripts/utils/agent-invoke.ts`、`harness/scripts/utils/phase-completion-probe.ts`（仅注释）、
  `harness/scripts/utils/goal-progress.ts`、`harness/scripts/utils/goal-runner-phase.ts`、
  `harness/scripts/goal-runner.ts`、`harness/scripts/utils/{vision-canary,goal-preflight}.ts`（判卷信封方言）、
  `docs/operations/adapter-tool-event-provenance.md`
- **诚实边界**：本 change 消除的是「FAIL turn 的 ~60 分钟收口空等」与「活性/话术遮蔽」，
  **不承诺缩短 spec/plan/coding 的单 turn 推理时长**（宿主实测 spec 36min / plan 33min /
  coding 30min，属另一问题）。
- **非 breaking**：Codex 的 stdout 由纯文本变 JSONL 是**运行时形态**变化，判卷侧已同源接入
  信封投影（金丝雀/inline canary）；其余 adapter 零变化。
